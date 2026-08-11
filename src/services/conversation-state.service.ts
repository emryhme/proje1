/**
 * ConversationStateService — Sohbet Durumu State Machine
 *
 * Her konuşma için bağımsız state tutar.
 * Multi-tenant safe: key = storeId:channel:userId
 *
 * State Akışı:
 * BROWSING
 *   → SELECTING_PRODUCT   (ürün konuşulmaya başlandı)
 *   → SELECTING_COLOR      (ürün bulundu, renk soruldu)
 *   → SELECTING_SIZE       (ürün bulundu, beden soruldu)
 *   → SELECTING_QUANTITY   (beden/renk seçildi, adet soruldu)
 *   → CART_CONFIRM         (adet seçildi, sepete ekle onayı)
 *   → CART_REVIEW          (sepet gözden geçiriliyor)
 *   → CHECKOUT_CONFIRMATION (ödeme onayı)
 *   → ORDER_CREATED        (sipariş oluşturuldu)
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

import { recentPostbacksMap } from '../controllers/webhook.controller';

export type ConvState =
  | 'BROWSING'
  | 'SELECTING_PRODUCT'
  | 'SELECTING_COLOR'
  | 'SELECTING_SIZE'
  | 'SELECTING_QUANTITY'
  | 'CART_CONFIRM'
  | 'CART_REVIEW'
  | 'CHECKOUT_CONFIRMATION'
  | 'ASKING_ADDRESS'
  | 'ASKING_PHONE'
  | 'ORDER_CREATED';

export type ConvAction =
  | 'PRODUCT_SELECTED'
  | 'COLOR_SELECTED'
  | 'SIZE_SELECTED'
  | 'QUANTITY_SELECTED'
  | 'CONFIRM_ADD_TO_CART'
  | 'VIEW_CART'
  | 'PROCEED_CHECKOUT'
  | 'CHECKOUT_CONFIRM'
  | 'ORDER_CREATED'
  | 'CANCEL'
  | 'ADD_MORE'
  | 'RESET';

export interface ConversationStateData {
  state: ConvState;
  storeId: string;
  channel: string;
  userId: string;

  // Product context (backend validated, never from AI)
  shortCode?: string;
  productCode?: string;
  productName?: string;
  productPrice?: number;
  productStock?: number;
  availableSizes?: string[];
  availableColors?: string[];

  // Selection state
  selectedColor?: string;
  selectedSize?: string;
  selectedQuantity?: number;

  updatedAt: number;
}

// ─────────────────────────────────────────────
// In-Memory Store (Redis-ready)
// ─────────────────────────────────────────────

const stateMap = new Map<string, ConversationStateData>();

/** Stale cleanup: 30 dakika hareketsiz → temizle */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of stateMap.entries()) {
    if (now - data.updatedAt > 30 * 60 * 1000) {
      stateMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ─────────────────────────────────────────────
// ConversationStateService
// ─────────────────────────────────────────────

export class ConversationStateService {

  /** Session key oluştur (multi-tenant safe) */
  public static buildKey(storeId: string, channel: string, userId: string): string {
    return `${(storeId || 'default').toLowerCase()}:${(channel || 'instagram').toLowerCase()}:${userId}`;
  }

  /** Mevcut state'i getir (yoksa BROWSING ile başlar) */
  public static getState(key: string): ConversationStateData {
    let data = stateMap.get(key);
    if (!data) {
      const parts = key.split(':');
      data = {
        state: 'BROWSING',
        storeId: parts[0] || 'default',
        channel: parts[1] || 'instagram',
        userId: parts[2] || '',
        updatedAt: Date.now()
      };
      stateMap.set(key, data);
    }
    return data;
  }

  /** Ürün context'ini güncelle (backend'den doğrulanmış veriler) */
  public static setProductContext(key: string, product: {
    shortCode: string;
    productCode: string;
    productName?: string;
    productPrice?: number;
    productStock?: number;
    availableSizes?: string[];
    availableColors?: string[];
  }): void {
    const data = this.getState(key);
    data.shortCode = product.shortCode;
    data.productCode = product.productCode;
    data.productName = product.productName;
    data.productPrice = product.productPrice;
    data.productStock = product.productStock;
    data.availableSizes = product.availableSizes;
    data.availableColors = product.availableColors;
    // Selection'ları sıfırla (yeni ürün seçildi)
    data.selectedSize = undefined;
    data.selectedColor = undefined;
    data.selectedQuantity = undefined;
    data.state = 'SELECTING_PRODUCT';
    data.updatedAt = Date.now();

    console.log(`[ConversationState] conversation=${key} state=SELECTING_PRODUCT productCode=${product.productCode}`);
    stateMap.set(key, data);
  }

  /**
   * State geçişi yap.
   * Geçersiz geçişler loglanır ama bloklanmaz (AI flow'u bozmamak için).
   */
  public static transition(key: string, action: ConvAction, value?: string | number): ConversationStateData {
    const data = this.getState(key);
    const prevState = data.state;

    switch (action) {
      case 'PRODUCT_SELECTED':
        data.state = 'SELECTING_PRODUCT';
        break;

      case 'COLOR_SELECTED':
        if (typeof value === 'string') {
          data.selectedColor = value.toUpperCase();
        }
        // Renk seçildikten sonra beden sorulacak
        data.state = 'SELECTING_SIZE';
        break;

      case 'SIZE_SELECTED':
        if (typeof value === 'string') {
          data.selectedSize = value.toUpperCase();
        }
        data.state = 'SELECTING_QUANTITY';
        break;

      case 'QUANTITY_SELECTED':
        if (typeof value === 'number') {
          data.selectedQuantity = value;
        }
        data.state = 'CART_CONFIRM';
        break;

      case 'CONFIRM_ADD_TO_CART':
        data.state = 'CART_REVIEW';
        break;

      case 'VIEW_CART':
        data.state = 'CART_REVIEW';
        break;

      case 'PROCEED_CHECKOUT':
        data.state = 'CHECKOUT_CONFIRMATION';
        break;

      case 'CHECKOUT_CONFIRM':
        data.state = 'ORDER_CREATED';
        break;

      case 'ORDER_CREATED':
        data.state = 'ORDER_CREATED';
        break;

      case 'ADD_MORE':
        // Sepet korunur, yeni ürün seçimine dön
        data.selectedSize = undefined;
        data.selectedColor = undefined;
        data.selectedQuantity = undefined;
        data.shortCode = undefined;
        data.productCode = undefined;
        data.state = 'BROWSING';
        break;

      case 'CANCEL':
      case 'RESET':
        // Tamamen sıfırla
        data.state = 'BROWSING';
        data.shortCode = undefined;
        data.productCode = undefined;
        data.productName = undefined;
        data.productPrice = undefined;
        data.productStock = undefined;
        data.availableSizes = undefined;
        data.availableColors = undefined;
        data.selectedColor = undefined;
        data.selectedSize = undefined;
        data.selectedQuantity = undefined;
        break;
    }

    data.updatedAt = Date.now();
    stateMap.set(key, data);

    console.log(`[ConversationState] conversation=${key} ${prevState} → ${data.state} (action=${action}${value !== undefined ? ', value=' + value : ''})`);
    return data;
  }

  /** State'i doğrudan güncelle (AI output'u işlerken) */
  public static setState(key: string, state: ConvState): void {
    const data = this.getState(key);
    data.state = state;
    data.updatedAt = Date.now();
    stateMap.set(key, data);
    console.log(`[ConversationState] conversation=${key} state forced to ${state}`);
  }

  /** Tüm state'leri listele (monitoring/test) */
  public static getActiveCount(): number {
    return stateMap.size;
  }

  /** Test için: belirli key'in state'ini sil */
  public static clear(key: string): void {
    stateMap.delete(key);
    const parts = key.split(':');
    const senderId = parts[2] || parts[0];
    if (senderId) {
      for (const k of recentPostbacksMap.keys()) {
        if (k.startsWith(`${senderId}:`)) {
          recentPostbacksMap.delete(k);
        }
      }
    }
  }
}
