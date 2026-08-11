"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramMessageService = exports.MetaInstagramPayloadBuilder = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
/**
 * Meta Instagram API Payload Builder (Internal Model -> Official Meta Payload)
 */
class MetaInstagramPayloadBuilder {
    /**
     * Plain Text Payload Builder
     */
    static buildTextPayload(recipientId, text) {
        return {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: {
                text: text ? text.trim() : ''
            }
        };
    }
    /**
     * Quick Replies Payload Builder
     */
    static buildQuickRepliesPayload(recipientId, text, replies) {
        return {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: {
                text: text ? text.trim() : '',
                quick_replies: replies.slice(0, 13).map(r => ({
                    content_type: 'text',
                    title: r.title,
                    payload: r.payload
                }))
            }
        };
    }
    /**
     * Button Template Payload Builder
     */
    static buildButtonTemplatePayload(recipientId, text, buttons) {
        return {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: {
                attachment: {
                    type: 'template',
                    payload: {
                        template_type: 'button',
                        text: text ? text.trim() : '',
                        buttons: buttons.slice(0, 3).map(b => ({
                            type: 'postback',
                            title: b.title,
                            payload: b.payload
                        }))
                    }
                }
            }
        };
    }
    /**
     * Generic Template / Carousel Payload Builder (Instagram DM Compliant)
     */
    static buildGenericCarouselPayload(recipientId, products) {
        const defaultImg = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500';
        const elements = products.slice(0, 10).map(p => {
            const imgUrl = (p.mediaLink && p.mediaLink.startsWith('http')) ? p.mediaLink : defaultImg;
            const stockStatus = p.stock > 0 ? `Stok: ${p.stock} Adet` : 'Stok Tükendi!';
            return {
                title: (p.name || p.productCode).slice(0, 80),
                image_url: imgUrl,
                subtitle: `Fiyat: ${p.price} TL | ${stockStatus}`.slice(0, 80),
                buttons: [
                    {
                        type: 'postback',
                        title: 'Sepete Ekle',
                        payload: `ADD_TO_CART:${p.productCode}`
                    },
                    {
                        type: 'postback',
                        title: 'Detay',
                        payload: `PRODUCT_DETAIL:${p.productCode}`
                    }
                ]
            };
        });
        return {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: {
                attachment: {
                    type: 'template',
                    payload: {
                        template_type: 'generic',
                        elements: elements
                    }
                }
            }
        };
    }
}
exports.MetaInstagramPayloadBuilder = MetaInstagramPayloadBuilder;
/**
 * Meta Instagram Messaging API Interactive Message Builder & Messenger Service
 */
class InstagramMessageService {
    static getApiUrl() {
        const version = env_1.env.fbApiVersion || 'v21.0';
        const token = env_1.env.fbPageAccessToken || '';
        return `https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(token)}`;
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
    static logMetaError(actionName, recipientId, error) {
        if (error?.response) {
            const status = error.response.status;
            const errData = error.response.data?.error || error.response.data || {};
            console.error(`[Meta API ${actionName} HTTP ${status} ERROR] (recipientId: ${recipientId}):`, {
                code: errData.code,
                error_subcode: errData.error_subcode,
                message: errData.message,
                type: errData.type,
                fbtrace_id: errData.fbtrace_id
            });
            return {
                success: false,
                httpStatus: status,
                metaErrorCode: errData.code,
                metaErrorSubcode: errData.error_subcode,
                metaErrorMessage: errData.message,
                fbtraceId: errData.fbtrace_id
            };
        }
        console.error(`[Meta API ${actionName} ERROR] (${recipientId}):`, error.message || error);
        return {
            success: false,
            metaErrorMessage: error.message || 'Bilinmeyen Meta API hatası'
        };
    }
    /**
     * 1. Düz Metin Mesajı Gönderir (Plain Text)
     */
    static async sendText(recipientId, text) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock Text -> ${recipientId}]:\n${text}`);
            return { success: true, isMocked: true, messageId: `mock_text_${Date.now()}` };
        }
        const payload = MetaInstagramPayloadBuilder.buildTextPayload(recipientId, text);
        try {
            console.log(`[InstagramMessage] 📤 Text Gönderiliyor -> ${recipientId}`);
            const res = await axios_1.default.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
            const msgId = res.data?.message_id || res.data?.recipient_id;
            return { success: true, httpStatus: res.status, messageId: msgId };
        }
        catch (error) {
            return this.logMetaError('sendText', recipientId, error);
        }
    }
    /**
     * 2. Quick Replies Etkileşimli Butonlu Mesaj Gönderir
     */
    static async sendQuickReplies(recipientId, text, replies) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock QuickReplies -> ${recipientId}]: ${text}\nReplies:`, replies.map(r => r.title));
            return { success: true, isMocked: true, messageId: `mock_qr_${Date.now()}` };
        }
        const payload = MetaInstagramPayloadBuilder.buildQuickRepliesPayload(recipientId, text, replies);
        try {
            console.log(`[InstagramMessage] 📤 Sending quick replies (${replies.length} adet) -> ${recipientId}`);
            const res = await axios_1.default.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
            const msgId = res.data?.message_id || res.data?.recipient_id;
            console.log(`[InstagramMessage] ✅ QuickReplies başarıyla ulaştırıldı (MsgID: ${msgId})`);
            return { success: true, httpStatus: res.status, messageId: msgId };
        }
        catch (error) {
            const errRes = this.logMetaError('sendQuickReplies', recipientId, error);
            // Fallback: Biçimlendirilmiş Düz Metin
            console.warn(`[InstagramMessage Fallback] ⚠️ QuickReplies başarısız oldu, düz metin fallback'ine geçiliyor...`);
            const fallbackText = `${text}\n\n${replies.map(r => `• ${r.title}`).join('\n')}`;
            await this.sendText(recipientId, fallbackText);
            return errRes;
        }
    }
    static async sendButtonMessage(recipientId, text, buttons) {
        if (this.isMock(recipientId)) {
            console.log(`[InstagramMessage Mock ButtonMessage -> ${recipientId}]: ${text}\nButtons:`, buttons.map(b => b.title));
            return { success: true, isMocked: true, messageId: `mock_btn_${Date.now()}` };
        }
        const payload = MetaInstagramPayloadBuilder.buildButtonTemplatePayload(recipientId, text, buttons);
        try {
            console.log(`[InstagramMessage] 📤 Sending button message (${buttons.length} adet) -> ${recipientId}`);
            const res = await axios_1.default.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
            const msgId = res.data?.message_id || res.data?.recipient_id;
            console.log(`[InstagramMessage] ✅ ButtonMessage başarıyla ulaştırıldı (MsgID: ${msgId})`);
            return { success: true, httpStatus: res.status, messageId: msgId };
        }
        catch (error) {
            const errRes = this.logMetaError('sendButtonMessage', recipientId, error);
            // Fallback: QuickReplies veya Düz Metin
            console.warn(`[InstagramMessage Fallback] ⚠️ ButtonMessage başarısız oldu, QuickReplies/Düz Metin fallback'ine geçiliyor...`);
            const quickReplies = buttons.map(b => ({ title: b.title, payload: b.payload }));
            await this.sendQuickReplies(recipientId, text, quickReplies);
            return errRes;
        }
    }
    /**
     * 3b. Meta Limitlerine Göre Otomatik Buton veya Quick Reply Gönderir
     * Sayı <= 3 ise Button Template, > 3 ise Quick Reply (Maks 13 adet) kullanılır.
     */
    static async sendButtonsOrQuickReplies(recipientId, text, options) {
        if (options.length <= 3 && options.length > 0) {
            return this.sendButtonMessage(recipientId, text, options);
        }
        else {
            const quickReplies = options.map(opt => ({
                title: opt.title,
                payload: opt.payload
            }));
            return this.sendQuickReplies(recipientId, text, quickReplies);
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
            return { success: true, isMocked: true, messageId: `mock_carousel_${Date.now()}` };
        }
        const payload = MetaInstagramPayloadBuilder.buildGenericCarouselPayload(recipientId, products);
        try {
            console.log(`[InstagramMessage] 📤 Sending product carousel (${products.length} ürün) -> ${recipientId}`);
            const res = await axios_1.default.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
            const msgId = res.data?.message_id || res.data?.recipient_id;
            console.log(`[InstagramMessage] ✅ Product Carousel başarıyla ulaştırıldı (MsgID: ${msgId})`);
            return { success: true, httpStatus: res.status, messageId: msgId };
        }
        catch (error) {
            const errRes = this.logMetaError('sendProductCarousel', recipientId, error);
            // Fallback: Biçimlendirilmiş Düz Metin Ürün Kataloğu
            console.warn(`[InstagramMessage Fallback] ⚠️ Carousel başarısız oldu, metin katalog fallback'ine geçiliyor...`);
            const fallbackList = products.map((p, idx) => `${idx + 1}. **${p.name}** (${p.productCode})\n   • Fiyat: ${p.price} TL | Stok: ${p.stock > 0 ? `${p.stock} adet` : 'Tükendi'}`).join('\n\n');
            const fallbackText = `**ÜRÜNLERİMİZ:**\n\n${fallbackList}\n\nBir ürünün adını yazarak veya "Sepete Ekle" diyerek sipariş verebilirsiniz.`;
            await this.sendText(recipientId, fallbackText);
            return errRes;
        }
    }
    /**
     * 6. Standart Ana Menü Quick Replies Gönderir
     */
    static async sendMainMenu(recipientId, customText) {
        const text = customText || 'Müşteri hizmetlerine hoş geldiniz! Size nasıl yardımcı olabilirim?';
        const replies = [
            { title: 'Ürünler', payload: 'PRODUCT_LIST' },
            { title: 'Sepetim', payload: 'MY_CART' },
            { title: 'Siparişlerim', payload: 'MY_ORDERS' },
            { title: 'Destek', payload: 'HUMAN_SUPPORT' }
        ];
        return this.sendQuickReplies(recipientId, text, replies);
    }
}
exports.InstagramMessageService = InstagramMessageService;
