"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickReplyBuilderService = void 0;
const stock_service_1 = require("./stock.service");
class QuickReplyBuilderService {
    /**
     * Geriye dönük uyumluluk için eski metot
     */
    static buildReplies(suggestions, currentProductCode) {
        if (!suggestions)
            return [];
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
    static async buildOptionsFromAi(aiReplies, shortCode, selectedSize, selectedColor) {
        if (!aiReplies || aiReplies.length === 0)
            return [];
        const options = [];
        for (const reply of aiReplies.slice(0, 10)) {
            const type = (reply.type || '').toUpperCase();
            const value = reply.value || '';
            const title = reply.title || value || '';
            if (type === 'SIZE') {
                if (!shortCode)
                    continue;
                const availableSizes = await stock_service_1.StockService.getAvailableSizes(shortCode);
                const upperVal = value.toUpperCase();
                if (availableSizes.includes(upperVal)) {
                    options.push({
                        title: title || upperVal,
                        payload: `SELECT_SIZE:${shortCode}:${upperVal}`,
                        type: 'SIZE',
                        value: upperVal
                    });
                }
            }
            else if (type === 'COLOR') {
                if (!shortCode)
                    continue;
                const availableColors = await stock_service_1.StockService.getAvailableColors(shortCode);
                const upperVal = value.toUpperCase();
                if (availableColors.includes(upperVal)) {
                    options.push({
                        title: title || upperVal,
                        payload: `SELECT_COLOR:${shortCode}:${upperVal}`,
                        type: 'COLOR',
                        value: upperVal
                    });
                }
            }
            else if (type === 'QUANTITY') {
                if (!shortCode)
                    continue;
                const qty = parseInt(value, 10);
                if (isNaN(qty) || qty <= 0)
                    continue;
                const stock = await stock_service_1.StockService.getStockForSizeColor(shortCode, selectedSize, selectedColor);
                if (qty <= stock) {
                    options.push({
                        title: title || String(qty),
                        payload: `SELECT_QUANTITY:${shortCode}:${selectedSize || 'NONE'}:${qty}`,
                        type: 'QUANTITY',
                        value: String(qty)
                    });
                }
            }
            else if (type === 'CONFIRM') {
                options.push({
                    title: title || '✅ Tamamla',
                    payload: value === 'CHECKOUT_CONFIRM' ? 'CHECKOUT_CONFIRM' : 'CONFIRM_ADD_TO_CART',
                    type: 'CONFIRM',
                    value
                });
            }
            else if (type === 'CANCEL') {
                options.push({
                    title: title || '❌ Vazgeç',
                    payload: 'CANCEL_CHECKOUT',
                    type: 'CANCEL',
                    value
                });
            }
            else if (type === 'ADD_PRODUCT') {
                options.push({
                    title: title || '➕ Ürün ekle',
                    payload: 'ADD_MORE_PRODUCTS',
                    type: 'ADD_PRODUCT',
                    value
                });
            }
            else if (type === 'VIEW_CART') {
                options.push({
                    title: title || '🛒 Sepetim',
                    payload: 'MY_CART',
                    type: 'VIEW_CART',
                    value
                });
            }
            else if (type === 'VIEW_ORDERS') {
                options.push({
                    title: title || 'Siparişlerim',
                    payload: 'MY_ORDERS',
                    type: 'VIEW_ORDERS',
                    value
                });
            }
            else if (type === 'PRODUCT') {
                options.push({
                    title: title || 'Ürün Detayı',
                    payload: `PRODUCT_DETAIL:${value}`,
                    type: 'PRODUCT',
                    value
                });
            }
            else if (type === 'CUSTOM_TEXT' || !type) {
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
     * AI metnini analiz ederek yalnızca Siparişi Tamamla durumu varsa tek butonu üretir.
     */
    static async autoDetectOptions(replyText, shortCode, selectedSize, selectedColor) {
        const lower = (replyText || '').toLowerCase();
        // Sadece siparişi tamamlama / sepet onayında tek "Siparişi Tamamla" butonu gösterilir
        if (lower.includes('siparişinizi tamamla') ||
            lower.includes('siparişi tamamla') ||
            lower.includes('tamamlamak ister') ||
            lower.includes('sepeti tamamla') ||
            lower.includes('sipariş vermek ister')) {
            return this.buildCheckoutOptions();
        }
        return [];
    }
    /**
     * Beden seçimi butonlarını DB varyantlarına göre oluşturur.
     */
    static async buildSizeOptions(shortCode) {
        return [];
    }
    /**
     * Renk seçimi butonlarını DB varyantlarına göre oluşturur.
     */
    static async buildColorOptions(shortCode) {
        return [];
    }
    /**
     * Adet seçimi butonlarını DB stok durumuna göre oluşturur.
     */
    static async buildQuantityOptions(shortCode, size, color) {
        return [];
    }
    /**
     * Sepet ekleme onayı butonlarını oluşturur (Yalnızca Siparişi Tamamla).
     */
    static buildCartConfirmOptions() {
        return [
            { title: 'Siparişi Tamamla', payload: 'CHECKOUT_CONFIRM', type: 'CONFIRM' }
        ];
    }
    /**
     * Checkout onayı butonlarını oluşturur (Yalnızca Siparişi Tamamla).
     */
    static buildCheckoutOptions() {
        return [
            { title: 'Siparişi Tamamla', payload: 'CHECKOUT_CONFIRM', type: 'CONFIRM' }
        ];
    }
    /**
     * Statik fallback butonları kaldırıldı.
     */
    static buildFallbackReplies() {
        return [];
    }
    /**
     * SUGGESTED_TEXT payload'ını çözümler.
     */
    static decodeSuggestedText(payload) {
        if (!payload.startsWith('SUGGESTED_TEXT:'))
            return null;
        try {
            return Buffer.from(payload.replace('SUGGESTED_TEXT:', ''), 'base64').toString('utf8');
        }
        catch {
            return null;
        }
    }
    /**
     * SUGGESTED_TEXT payload'ı mı kontrol eder.
     */
    static isSuggestedText(payload) {
        return payload.startsWith('SUGGESTED_TEXT:');
    }
}
exports.QuickReplyBuilderService = QuickReplyBuilderService;
