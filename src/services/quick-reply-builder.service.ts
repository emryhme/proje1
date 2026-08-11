import { StockService } from './stock.service';
import { ConversationStateService } from './conversation-state.service';

export interface InteractiveOption {
  title: string;
  payload: string;
  type: string;
  value?: string;
}

export class QuickReplyBuilderService {
  /**
   * Geriye dönük uyumluluk için eski metot
   */
  public static buildReplies(suggestions: string[], currentProductCode?: string): any[] {
    if (!suggestions) return [];
    return suggestions.slice(0, 4).map(s => {
      const clean = s.trim();
      const lower = clean.toLowerCase();
      const title = clean.length > 20 ? clean.slice(0, 19) + '…' : clean;
      
      if (lower.includes('sepet') && currentProductCode) {
        return { title, payload: `ADD_TO_CART:${currentProductCode}`, type: 'ACTION' };
      }
      if (lower.includes('sepetim')) {
        return { title, payload: 'MY_CART', type: 'ACTION' };
      }
      if (lower.includes('siparişlerim') || lower.includes('siparişim nerede')) {
        return { title, payload: 'MY_ORDERS', type: 'ACTION' };
      }
      if (lower.includes('ürün') || lower.includes('katalog')) {
        return { title, payload: 'PRODUCT_LIST', type: 'ACTION' };
      }
      if (lower.includes('destek')) {
        return { title, payload: 'HUMAN_SUPPORT', type: 'ACTION' };
      }
      return {
        title,
        payload: `SUGGESTED_TEXT:${Buffer.from(clean, 'utf8').toString('base64')}`,
        type: 'TEXT'
      };
    });
  }
  /**
   * AI veya State Machine'den gelen UI isteklerini filtrelere göre işler.
   * YALNIZCA Siparişi Tamamla (CHECKOUT_CONFIRM) butonuna izin verilir.
   */
  public static async buildOptionsFromAi(
    aiReplies: Array<{ title?: string; type?: string; value?: string }>,
    shortCode?: string,
    selectedSize?: string,
    selectedColor?: string
  ): Promise<InteractiveOption[]> {
    if (!aiReplies || aiReplies.length === 0) return [];

    for (const reply of aiReplies) {
      const type = (reply.type || '').toUpperCase();
      const value = reply.value || '';
      const title = reply.title || '';

      if (
        type === 'CONFIRM' || 
        value === 'CHECKOUT_CONFIRM' || 
        title.includes('Tamamla') || 
        title.includes('Onayla')
      ) {
        return this.buildCheckoutOptions();
      }
    }

    return [];
  }

  /**
   * AI metnini analiz ederek yalnızca Siparişi Tamamla durumu varsa tek butonu üretir.
   */
  public static async autoDetectOptions(
    replyText: string,
    shortCode?: string,
    selectedSize?: string,
    selectedColor?: string
  ): Promise<InteractiveOption[]> {
    const lower = (replyText || '').toLowerCase();

    // Sipariş tamamlama / sepet özeti / onay mesajlarında tek "Siparişi Tamamla" butonu gösterilir
    if (
      lower.includes('siparişinizi tamamla') ||
      lower.includes('siparişi tamamla') ||
      lower.includes('tamamlamak ister') ||
      lower.includes('sepeti tamamla') ||
      lower.includes('sipariş vermek ister') ||
      lower.includes('tamamlamak için') ||
      lower.includes('lütfen onaylayın') ||
      lower.includes('sepet özeti')
    ) {
      return this.buildCheckoutOptions();
    }

    return [];
  }

  /**
   * Beden seçimi butonlarını DB varyantlarına göre oluşturur.
   */
  public static async buildSizeOptions(shortCode: string): Promise<InteractiveOption[]> {
    return [];
  }

  /**
   * Renk seçimi butonlarını DB varyantlarına göre oluşturur.
   */
  public static async buildColorOptions(shortCode: string): Promise<InteractiveOption[]> {
    return [];
  }

  /**
   * Adet seçimi butonlarını DB stok durumuna göre oluşturur.
   */
  public static async buildQuantityOptions(shortCode: string, size?: string, color?: string): Promise<InteractiveOption[]> {
    return [];
  }

  /**
   * Sepet ekleme onayı butonlarını oluşturur (Yalnızca Siparişi Tamamla).
   */
  public static buildCartConfirmOptions(): InteractiveOption[] {
    return [
      { title: 'Siparişi Tamamla', payload: 'CHECKOUT_CONFIRM', type: 'CONFIRM' }
    ];
  }

  /**
   * Checkout onayı butonlarını oluşturur (Yalnızca Siparişi Tamamla).
   */
  public static buildCheckoutOptions(): InteractiveOption[] {
    return [
      { title: 'Siparişi Tamamla', payload: 'CHECKOUT_CONFIRM', type: 'CONFIRM' }
    ];
  }

  /**
   * Statik fallback butonları kaldırıldı.
   */
  public static buildFallbackReplies(): InteractiveOption[] {
    return [];
  }

  /**
   * SUGGESTED_TEXT payload'ını çözümler.
   */
  public static decodeSuggestedText(payload: string): string | null {
    if (!payload.startsWith('SUGGESTED_TEXT:')) return null;
    try {
      return Buffer.from(payload.replace('SUGGESTED_TEXT:', ''), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * SUGGESTED_TEXT payload'ı mı kontrol eder.
   */
  public static isSuggestedText(payload: string): boolean {
    return payload.startsWith('SUGGESTED_TEXT:');
  }
}
