"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CartService = void 0;
const ai_service_1 = require("./ai.service");
const stock_service_1 = require("./stock.service");
class CartService {
    static getCart(senderId) {
        const ctx = ai_service_1.AIService.getSessionContext(senderId);
        return ctx.cart || [];
    }
    static async addItem(senderId, productCode, quantity = 1, size) {
        const res = await stock_service_1.StockService.checkStock(productCode);
        if (!res.exists || !res.product) {
            return { success: false, message: `❌ (${productCode}) kodlu ürün sistemde bulunamadı.` };
        }
        const prod = res.product;
        const stockQty = prod.stock !== undefined ? prod.stock : 0;
        if (!res.inStock || stockQty < quantity) {
            return { success: false, message: `❌ Üzgünüz, (${prod.name || productCode}) ürününden yeterli stok bulunmuyor. (Mevcut Stok: ${stockQty})` };
        }
        const ctx = ai_service_1.AIService.getSessionContext(senderId);
        if (!ctx.cart)
            ctx.cart = [];
        const targetSize = size ? size.toUpperCase().trim() : (prod.size || 'M');
        const existingIndex = ctx.cart.findIndex((i) => i.productCode === prod.productCode && i.size === targetSize);
        if (existingIndex >= 0) {
            ctx.cart[existingIndex].quantity += quantity;
        }
        else {
            ctx.cart.push({
                productCode: prod.productCode || productCode,
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
                productCode: prod.productCode || productCode,
                productName: prod.name || productCode,
                size: targetSize,
                quantity: quantity,
                unitPrice: prod.price || 299
            },
            currentCart: ctx.cart
        };
    }
    static clearCart(senderId) {
        const ctx = ai_service_1.AIService.getSessionContext(senderId);
        ctx.cart = [];
    }
}
exports.CartService = CartService;
