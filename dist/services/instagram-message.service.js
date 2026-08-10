"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramMessageService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
/**
 * Meta Instagram Messaging API Interactive Message Builder & Messenger Service
 */
class InstagramMessageService {
    static getApiUrl() {
        const token = env_1.env.fbPageAccessToken || '';
        return `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`;
    }
    static getHeaders() {
        return {
            Authorization: `Bearer ${env_1.env.fbPageAccessToken || ''}`,
            'Content-Type': 'application/json'
        };
    }
    static isMock(recipientId) {
        return !env_1.env.fbPageAccessToken || recipientId.includes('MOCK') || recipientId.includes('TEST');
    }
    /**
     * 1. Düz Metin Mesajı Gönderir (Plain Text)
     */
    static async sendText(recipientId, text) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock Text -> ${recipientId}]:\n${text}`);
            return true;
        }
        try {
            console.log(`[InstagramMessage] 📤 Text Gönderiliyor -> ${recipientId}`);
            await axios_1.default.post(this.getApiUrl(), {
                recipient: { id: recipientId },
                message: { text: text ? text.trim() : '' }
            }, { headers: this.getHeaders() });
            return true;
        }
        catch (error) {
            console.error(`[InstagramMessage Text Error] (${recipientId}):`, error?.response?.data || error.message);
            return false;
        }
    }
    /**
     * 2. Quick Replies Etkileşimli Butonlu Mesaj Gönderir
     */
    static async sendQuickReplies(recipientId, text, replies) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock QuickReplies -> ${recipientId}]: ${text}\nReplies:`, replies.map(r => r.title));
            return true;
        }
        try {
            console.log(`[InstagramMessage] 📤 Sending quick replies -> ${recipientId}`);
            const quickRepliesPayload = replies.slice(0, 13).map(r => ({
                content_type: 'text',
                title: r.title,
                payload: r.payload
            }));
            await axios_1.default.post(this.getApiUrl(), {
                recipient: { id: recipientId },
                message: {
                    text: text,
                    quick_replies: quickRepliesPayload
                }
            }, { headers: this.getHeaders() });
            return true;
        }
        catch (error) {
            console.error(`[InstagramMessage QuickReplies Error] (${recipientId}):`, error?.response?.data || error.message);
            // Fallback: Düz Metin
            const fallbackText = `${text}\n\n${replies.map(r => `• ${r.title}`).join('\n')}`;
            return this.sendText(recipientId, fallbackText);
        }
    }
    /**
     * 3. Buton Mesajı Gönderir (Button Template)
     */
    static async sendButtonMessage(recipientId, text, buttons) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock ButtonMessage -> ${recipientId}]: ${text}\nButtons:`, buttons.map(b => b.title));
            return true;
        }
        try {
            console.log(`[InstagramMessage] 📤 Sending button message -> ${recipientId}`);
            const buttonsPayload = buttons.slice(0, 3).map(b => ({
                type: 'postback',
                title: b.title,
                payload: b.payload
            }));
            await axios_1.default.post(this.getApiUrl(), {
                recipient: { id: recipientId },
                message: {
                    attachment: {
                        type: 'template',
                        payload: {
                            template_type: 'button',
                            text: text,
                            buttons: buttonsPayload
                        }
                    }
                }
            }, { headers: this.getHeaders() });
            return true;
        }
        catch (error) {
            console.error(`[InstagramMessage ButtonMessage Error] (${recipientId}):`, error?.response?.data || error.message);
            // Fallback: Düz Metin
            const fallbackText = `${text}\n\n${buttons.map(b => `[${b.title}]`).join(' ')}`;
            return this.sendText(recipientId, fallbackText);
        }
    }
    /**
     * 4. Tekli Ürün Kartı Gönderir (Product Card)
     */
    static async sendProductCard(recipientId, product) {
        return this.sendProductCarousel(recipientId, [product]);
    }
    /**
     * 5. Ürün Carousel Gönderir (Product Carousel Template)
     */
    static async sendProductCarousel(recipientId, products) {
        if (!products || products.length === 0) {
            return this.sendText(recipientId, 'Üzgünüz, gösterilecek ürün bulunamadı.');
        }
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock Carousel -> ${recipientId}]: ${products.length} ürün carousel simüle edildi.`);
            return true;
        }
        try {
            console.log(`[InstagramMessage] 📤 Sending product carousel (${products.length} ürün) -> ${recipientId}`);
            const elements = products.slice(0, 10).map(p => {
                const defaultImg = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500';
                const imgUrl = (p.mediaLink && p.mediaLink.startsWith('http')) ? p.mediaLink : defaultImg;
                const stockStatus = p.stock > 0 ? `Stok: ${p.stock} Adet` : 'Stok Tükendi!';
                return {
                    title: p.name || p.productCode,
                    image_url: imgUrl,
                    subtitle: `💰 ${p.price} TL | ${stockStatus}`,
                    buttons: [
                        {
                            type: 'postback',
                            title: '🛒 Sepete Ekle',
                            payload: `ADD_TO_CART:${p.productCode}`
                        },
                        {
                            type: 'postback',
                            title: '🔎 Detay',
                            payload: `PRODUCT_DETAIL:${p.productCode}`
                        }
                    ]
                };
            });
            await axios_1.default.post(this.getApiUrl(), {
                recipient: { id: recipientId },
                message: {
                    attachment: {
                        type: 'template',
                        payload: {
                            template_type: 'generic',
                            elements: elements
                        }
                    }
                }
            }, { headers: this.getHeaders() });
            return true;
        }
        catch (error) {
            console.error(`[InstagramMessage Carousel Error] (${recipientId}):`, error?.response?.data || error.message);
            // Fallback: Düz Metin Ürün Listesi
            const fallbackList = products.map((p, idx) => `${idx + 1}. **${p.name}** (${p.productCode})\n   • Fiyat: ${p.price} TL | Stok: ${p.stock > 0 ? `${p.stock} adet` : 'Tükendi'}`).join('\n\n');
            const fallbackText = `🛍️ **ÜRÜNLERİMİZ:**\n\n${fallbackList}\n\nBir ürünün adını yazarak veya "Sepete Ekle" diyerek sipariş verebilirsiniz.`;
            return this.sendText(recipientId, fallbackText);
        }
    }
    /**
     * 6. Standart Ana Menü Quick Replies Gönderir
     */
    static async sendMainMenu(recipientId, customText) {
        const text = customText || 'Müşteri hizmetlerine hoş geldiniz! Size nasıl yardımcı olabilirim?';
        const replies = [
            { title: '👕 Ürünler', payload: 'PRODUCT_LIST' },
            { title: '🛒 Sepetim', payload: 'MY_CART' },
            { title: '📦 Siparişlerim', payload: 'MY_ORDERS' },
            { title: '👤 Destek', payload: 'HUMAN_SUPPORT' }
        ];
        return this.sendQuickReplies(recipientId, text, replies);
    }
}
exports.InstagramMessageService = InstagramMessageService;
