import { AIService, CartItem } from './ai.service';
import { StockService } from './stock.service';

export class CartService {
  public static getCart(senderId: string): CartItem[] {
    const ctx = (AIService as any).getSessionContext(senderId);
    return ctx.cart || [];
  }

  public static async addItem(
    senderId: string, 
    productCode: string, 
    quantity: number = 1, 
    size?: string
  ): Promise<{ success: boolean; message: string; cartItem?: CartItem; currentCart?: CartItem[] }> {
    const res = await StockService.checkStock(productCode);
    if (!res.exists || !res.product) {
      return { success: false, message: `❌ (${productCode}) kodlu ürün sistemde bulunamadı.` };
    }

    const prod = res.product;
    const stockQty = prod.stock !== undefined ? prod.stock : 0;

    if (!res.inStock || stockQty < quantity) {
      return { success: false, message: `❌ Üzgünüz, (${prod.name || productCode}) ürününden yeterli stok bulunmuyor. (Mevcut Stok: ${stockQty})` };
    }

    const ctx = (AIService as any).getSessionContext(senderId);
    if (!ctx.cart) ctx.cart = [];

    // Beden Tespiti:
    // 1. Parametre olarak gelen beden
    // 2. Ürünün veritabanındaki gerçek bedeni (prod.size)
    // 3. Fallback: M
    let targetSize = size ? size.toUpperCase().trim() : '';
    if (!targetSize && prod.size) {
      targetSize = prod.size.toUpperCase().trim();
    }
    if (!targetSize) {
      targetSize = 'M';
    }

    const targetCode = prod.productCode || productCode;
    const shortCode = prod.shortCode || targetCode.split('-')[0];

    // Sepette aynı ürün ve aynı beden varsa adeti artır (Çift ürün oluşmasını engelle)
    const existingIndex = ctx.cart.findIndex((i: CartItem) => 
      (i.productCode.toUpperCase() === targetCode.toUpperCase() || i.productCode.toUpperCase() === shortCode.toUpperCase()) && 
      i.size.toUpperCase() === targetSize.toUpperCase()
    );

    if (existingIndex >= 0) {
      ctx.cart[existingIndex].quantity += quantity;
      ctx.cart[existingIndex].productCode = targetCode; // Kod güncelleme/normalize etme
      ctx.cart[existingIndex].size = targetSize;
    } else {
      ctx.cart.push({
        productCode: targetCode,
        productName: prod.name || productCode,
        size: targetSize,
        quantity: quantity,
        unitPrice: prod.price || 299
      });
    }

    return {
      success: true,
      message: `🛒 **${prod.name || productCode}** (${targetSize} Beden, ${quantity} Adet) sepetinize başarıyla eklendi!`,
      cartItem: {
        productCode: targetCode,
        productName: prod.name || productCode,
        size: targetSize,
        quantity: quantity,
        unitPrice: prod.price || 299
      },
      currentCart: ctx.cart
    };
  }

  public static clearCart(senderId: string): void {
    const ctx = (AIService as any).getSessionContext(senderId);
    ctx.cart = [];
  }
}
