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
   * AI veya State Machine'den gelen UI isteklerini Meta-compliant buton ve quick reply listelerine dönüştürür.
   *
   * @param recipientId Alıcı ID'si
   * @param aiReplies AI'dan dönen quick reply listesi (isteğe bağlı)
   * @param shortCode Ürün kısa kodu
   * @param selectedSize Seçilen beden
   * @param selectedColor Seçilen renk
   */
  public static async buildOptionsFromAi(
    aiReplies: Array<{ title?: string; type?: string; value?: string }>,
    shortCode?: string,
    selectedSize?: string,
    selectedColor?: string
  ): Promise<InteractiveOption[]> {
    if (!aiReplies || aiReplies.length === 0) return [];

    const options: InteractiveOption[] = [];

    for (const reply of aiReplies.slice(0, 10)) {
      const type = (reply.type || '').toUpperCase();
      const value = reply.value || '';
      const title = reply.title || value || '';

      if (type === 'SIZE') {
        if (!shortCode) continue;
        const availableSizes = await StockService.getAvailableSizes(shortCode);
        const upperVal = value.toUpperCase();
        if (availableSizes.includes(upperVal)) {
          options.push({
            title: title || upperVal,
            payload: `SELECT_SIZE:${shortCode}:${upperVal}`,
            type: 'SIZE',
            value: upperVal
          });
        }
      } else if (type === 'COLOR') {
        if (!shortCode) continue;
        const availableColors = await StockService.getAvailableColors(shortCode);
        const upperVal = value.toUpperCase();
        if (availableColors.includes(upperVal)) {
          options.push({
            title: title || upperVal,
            payload: `SELECT_COLOR:${shortCode}:${upperVal}`,
            type: 'COLOR',
            value: upperVal
          });
        }
      } else if (type === 'QUANTITY') {
        if (!shortCode) continue;
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty <= 0) continue;
        const stock = await StockService.getStockForSizeColor(shortCode, selectedSize, selectedColor);
        if (qty <= stock) {
          options.push({
            title: title || String(qty),
            payload: `SELECT_QUANTITY:${shortCode}:${selectedSize || 'NONE'}:${qty}`,
            type: 'QUANTITY',
            value: String(qty)
          });
        }
      } else if (type === 'CONFIRM') {
        options.push({
          title: title || '✅ Tamamla',
          payload: value === 'CHECKOUT_CONFIRM' ? 'CHECKOUT_CONFIRM' : 'CONFIRM_ADD_TO_CART',
          type: 'CONFIRM',
          value
        });
      } else if (type === 'CANCEL') {
        options.push({
          title: title || '❌ Vazgeç',
          payload: 'CANCEL_CHECKOUT',
          type: 'CANCEL',
          value
        });
      } else if (type === 'ADD_PRODUCT') {
        options.push({
          title: title || '➕ Ürün ekle',
          payload: 'ADD_MORE_PRODUCTS',
          type: 'ADD_PRODUCT',
          value
        });
      } else if (type === 'VIEW_CART') {
        options.push({
          title: title || '🛒 Sepetim',
          payload: 'MY_CART',
          type: 'VIEW_CART',
          value
        });
      } else if (type === 'VIEW_ORDERS') {
        options.push({
          title: title || 'Siparişlerim',
          payload: 'MY_ORDERS',
          type: 'VIEW_ORDERS',
          value
        });
      } else if (type === 'PRODUCT') {
        options.push({
          title: title || 'Ürün Detayı',
          payload: `PRODUCT_DETAIL:${value}`,
          type: 'PRODUCT',
          value
        });
      } else if (type === 'CUSTOM_TEXT' || !type) {
        options.push({
          title: title.length > 20 ? title.slice(0, 19) + '…' : title,
          payload: `SUGGESTED_TEXT:${Buffer.from(title, 'utf8').toString('base64')}`,
          type: 'CUSTOM_TEXT',
          value: title
        });
      }
    }

    return options;
  }

  /**
   * AI metnini analiz ederek beden, adet veya sepet tamamlama sorusu varsa otomatik DB butonlarını üretir.
   */
  public static async autoDetectOptions(
    replyText: string,
    shortCode?: string,
    selectedSize?: string,
    selectedColor?: string
  ): Promise<InteractiveOption[]> {
    const lower = (replyText || '').toLowerCase();

    // 1. Beden sorma tespiti ("hangi beden", "bedeninizi", "beden seçin")
    if (lower.includes('beden') || lower.includes('size')) {
      if (shortCode) {
        const sizeOpts = await this.buildSizeOptions(shortCode);
        if (sizeOpts.length > 0) return sizeOpts;
      }
    }

    // 2. Adet sorma tespiti ("kaç adet", "kaç tane", "adet belirt", "kaç adet istersiniz")
    if (lower.includes('kaç adet') || lower.includes('kaç tane') || lower.includes('adet belirt') || lower.includes('kaç adet istersiniz')) {
      if (shortCode) {
        const qtyOpts = await this.buildQuantityOptions(shortCode, selectedSize, selectedColor);
        if (qtyOpts.length > 0) return qtyOpts;
      }
    }

    // 3. Sepet / Sipariş Tamamlama veya Başka ürün ekleme sorma tespiti
    if (
      lower.includes('siparişinizi tamamla') ||
      lower.includes('sepete eklemek') ||
      lower.includes('başka bir şey eklemek') ||
      lower.includes('ürün eklemek') ||
      lower.includes('tamamlamak ister') ||
      lower.includes('sepeti tamamla')
    ) {
      return this.buildCheckoutOptions();
    }

    return [];
  }

  /**
   * Beden seçimi butonlarını (veya QR) DB varyantlarına göre oluşturur.
   */
  public static async buildSizeOptions(shortCode: string): Promise<InteractiveOption[]> {
    const sizes = await StockService.getAvailableSizes(shortCode);
    return sizes.map(size => ({
      title: size,
      payload: `SELECT_SIZE:${shortCode}:${size}`,
      type: 'SIZE',
      value: size
    }));
  }

  /**
   * Renk seçimi butonlarını (veya QR) DB varyantlarına göre oluşturur.
   */
  public static async buildColorOptions(shortCode: string): Promise<InteractiveOption[]> {
    const colors = await StockService.getAvailableColors(shortCode);
    return colors.map(color => ({
      title: color,
      payload: `SELECT_COLOR:${shortCode}:${color}`,
      type: 'COLOR',
      value: color
    }));
  }

  /**
   * Adet seçimi butonlarını DB stok durumuna göre oluşturur.
   */
  public static async buildQuantityOptions(shortCode: string, size?: string, color?: string): Promise<InteractiveOption[]> {
    const stock = await StockService.getStockForSizeColor(shortCode, size, color);
    const maxQty = Math.min(stock, 5); // Max 5 adet seçeneği sunulur
    const options: InteractiveOption[] = [];
    for (let i = 1; i <= maxQty; i++) {
      options.push({
        title: String(i),
        payload: `SELECT_QUANTITY:${shortCode}:${size || 'NONE'}:${i}`,
        type: 'QUANTITY',
        value: String(i)
      });
    }
    return options;
  }

  /**
   * Sepet ekleme onayı butonlarını oluşturur.
   */
  public static buildCartConfirmOptions(): InteractiveOption[] {
    return [
      { title: '🛒 Sepete Ekle', payload: 'CONFIRM_ADD_TO_CART', type: 'CONFIRM' },
      { title: '❌ Vazgeç', payload: 'CANCEL_CHECKOUT', type: 'CANCEL' }
    ];
  }

  /**
   * Checkout onayı butonlarını oluşturur.
   */
  public static buildCheckoutOptions(): InteractiveOption[] {
    return [
      { title: '✅ Tamamla', payload: 'CHECKOUT_CONFIRM', type: 'CONFIRM' },
      { title: '➕ Ürün ekle', payload: 'ADD_MORE_PRODUCTS', type: 'ADD_PRODUCT' },
      { title: '❌ Vazgeç', payload: 'CANCEL_CHECKOUT', type: 'CANCEL' }
    ];
  }

  /**
   * Statik fallback butonları oluşturur.
   */
  public static buildFallbackReplies(): InteractiveOption[] {
    return [
      { title: 'Ürün Kataloğu', payload: 'PRODUCT_LIST', type: 'PRODUCT_LIST' },
      { title: 'Sepetim', payload: 'MY_CART', type: 'VIEW_CART' },
      { title: 'Destek', payload: 'HUMAN_SUPPORT', type: 'HUMAN_SUPPORT' }
    ];
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
