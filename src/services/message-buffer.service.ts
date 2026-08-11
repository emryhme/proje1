/**
 * MessageBufferService — AI Mesaj Buffer & Debounce Sistemi
 *
 * Mimari:
 * - Her konuşma için ayrı buffer (storeId:channel:externalUserId)
 * - Kullanıcı hızlı mesaj gönderirse timer resetlenir, tek AI çağrısı yapılır
 * - Postback / Interactive buton eventleri buffer'a GİRMEZ
 * - Race condition koruması: processing flag
 * - Redis-ready abstraction (şimdilik in-memory Map)
 * - Multi-tenant isolation: storeId scope'u
 */

import { env } from '../config/env';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface BufferedMessage {
  text: string;
  timestamp: number;
}

export interface BufferState {
  messages: BufferedMessage[];
  timer: ReturnType<typeof setTimeout> | undefined;
  processing: boolean;
  storeId: string;
  channel: string;
  externalUserId: string;
  createdAt: number;
  lastActivityAt: number;
}

export type ConversationKey = string;

// Callback signature that will be provided by WebhookController
export type BufferFlushCallback = (
  conversationKey: ConversationKey,
  storeId: string,
  channel: string,
  externalUserId: string,
  combinedText: string
) => Promise<void>;

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Debounce süresi (ms). .env'den override edilebilir. Default: 1500ms */
const BUFFER_MS = parseInt(process.env.AI_MESSAGE_BUFFER_MS || '1500', 10);

/**
 * Hareketsiz buffer'ı belleğe temizlemek için maksimum süre (ms).
 * 10 dakika boyunca hiçbir aktivite yoksa state silinir.
 */
const STALE_CLEANUP_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────
// In-Memory Store (Redis-ready abstraction)
// ─────────────────────────────────────────────

const bufferMap = new Map<ConversationKey, BufferState>();

/** Periyodik temizleme: her 5 dakikada stale buffer'ları sil */
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of bufferMap.entries()) {
    if (!state.processing && now - state.lastActivityAt > STALE_CLEANUP_MS) {
      if (state.timer) clearTimeout(state.timer);
      bufferMap.delete(key);
      console.log(`[MessageBuffer] CLEANUP key=${key} (stale > ${STALE_CLEANUP_MS / 1000}s)`);
    }
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

/**
 * Conversation key üretir.
 * Format: storeId:channel:externalUserId
 * storeId yoksa "default" kullanılır (single-tenant).
 */
export function buildConversationKey(storeId: string, channel: string, externalUserId: string): ConversationKey {
  const safeStore = (storeId || 'default').toLowerCase().trim();
  const safeChan = (channel || 'instagram').toLowerCase().trim();
  const safeUser = (externalUserId || '').trim();
  return `${safeStore}:${safeChan}:${safeUser}`;
}

// ─────────────────────────────────────────────
// MessageBufferService
// ─────────────────────────────────────────────

export class MessageBufferService {

  /**
   * Mesajı buffer'a ekle ve debounce timer'ı başlat/resetle.
   *
   * @param storeId     Mağaza ID'si (multi-tenant isolation)
   * @param channel     Kanal (instagram, messenger, vb.)
   * @param externalUserId  Kullanıcının platform-specific ID'si (senderId)
   * @param text        Kullanıcıdan gelen metin
   * @param onFlush     Buffer flush olduğunda çağrılacak callback
   */
  public static addMessage(
    storeId: string,
    channel: string,
    externalUserId: string,
    text: string,
    onFlush: BufferFlushCallback
  ): void {
    // Boş mesajları yoksay
    const normalizedText = (text || '').trim();
    if (!normalizedText) {
      console.log(`[MessageBuffer] IGNORED empty message (user=${externalUserId})`);
      return;
    }

    const key = buildConversationKey(storeId, channel, externalUserId);
    const now = Date.now();

    let state = bufferMap.get(key);

    // Eğer bu key için buffer yoksa veya şu an işleniyorsa yeni buffer oluştur
    if (!state || state.processing) {
      if (state?.processing) {
        // Mevcut buffer işleniyorken gelen mesaj → yeni buffer aç
        console.log(`[MessageBuffer] NEW_BUFFER (processing active) key=${key} text="${normalizedText}"`);
        setTimeout(() => {
          MessageBufferService.addMessage(storeId, channel, externalUserId, normalizedText, onFlush);
        }, BUFFER_MS + 50);
        return;
      }
      state = {
        messages: [],
        timer: undefined,
        processing: false,
        storeId,
        channel,
        externalUserId,
        createdAt: now,
        lastActivityAt: now
      };
      bufferMap.set(key, state);
    }

    // Duplicate message detection (aynı metin 500ms içinde iki kez geldiyse ekleme)
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.text === normalizedText && now - lastMsg.timestamp < 500) {
      console.log(`[MessageBuffer] IGNORED duplicate message (user=${externalUserId}) text="${normalizedText}"`);
      return;
    }

    state.lastActivityAt = now;

    // Mesajı buffer'a ekle
    state.messages.push({ text: normalizedText, timestamp: now });
    console.log(`[MessageBuffer] ADD key=${key} text="${normalizedText}" (buffer size=${state.messages.length})`);

    // Timer'ı sıfırla (debounce)
    if (state.timer) {
      clearTimeout(state.timer);
      console.log(`[MessageBuffer] TIMER_RESET key=${key}`);
    }

    // Yeni timer başlat ( exact 1500ms )
    state.timer = setTimeout(() => {
      MessageBufferService.flush(key, onFlush);
    }, BUFFER_MS);
  }

  /**
   * Buffer'ı flush eder: mesajları birleştirir ve AI callback'ini çağırır.
   */
  private static async flush(key: ConversationKey, onFlush: BufferFlushCallback): Promise<void> {
    const state = bufferMap.get(key);
    if (!state) return;
    if (state.processing) {
      console.warn(`[MessageBuffer] FLUSH_SKIP key=${key} (already processing)`);
      return;
    }
    if (state.messages.length === 0) {
      bufferMap.delete(key);
      return;
    }

    // Race condition koruması
    state.processing = true;
    state.timer = undefined;

    // Zaman sırasına göre sırala ve birleştir
    const orderedMessages = [...state.messages].sort((a, b) => a.timestamp - b.timestamp);
    const combinedText = orderedMessages.map(m => m.text).join('\n');

    console.log(`[MessageBuffer] FLUSH key=${key} messages=${orderedMessages.length}`);
    console.log(`[AI] sender=${state.externalUserId} bufferedMessages=${orderedMessages.length} invocation=1`);
    console.log(`[MessageBuffer] AI_TRIGGER key=${key} combinedText="${combinedText}"`);

    // Buffer'ı temizle (flush başlamadan önce)
    state.messages = [];

    try {
      await onFlush(key, state.storeId, state.channel, state.externalUserId, combinedText);
      console.log(`[MessageBuffer] AI_COMPLETE key=${key}`);
    } catch (err: any) {
      console.error(`[MessageBuffer] AI_ERROR key=${key} error="${err?.message || err}"`);
    } finally {
      state.processing = false;
      state.lastActivityAt = Date.now();

      // Flush sonrası state temizleme
      if (state.messages.length === 0) {
        bufferMap.delete(key);
      }
    }
  }

  /**
   * Buffer'ı manuel olarak temizler (test / shutdown için).
   */
  public static clear(key: ConversationKey): void {
    const state = bufferMap.get(key);
    if (state?.timer) clearTimeout(state.timer);
    bufferMap.delete(key);
  }

  /**
   * Buffer'daki mevcut mesajları okur (salt okunur, test için).
   */
  public static getBuffer(key: ConversationKey): BufferedMessage[] {
    return bufferMap.get(key)?.messages || [];
  }

  /**
   * Aktif buffer sayısını döndürür (monitoring için).
   */
  public static getActiveBufferCount(): number {
    return bufferMap.size;
  }

  /**
   * Aktif buffer key listesini döndürür (test/monitoring için).
   */
  public static getActiveKeys(): ConversationKey[] {
    return Array.from(bufferMap.keys());
  }

  /**
   * Belirli bir key için işleniyor mu?
   */
  public static isProcessing(key: ConversationKey): boolean {
    return bufferMap.get(key)?.processing === true;
  }

  /**
   * Debounce süresini döndürür (config'den okunur).
   */
  public static getDebounceMs(): number {
    return BUFFER_MS;
  }
}
