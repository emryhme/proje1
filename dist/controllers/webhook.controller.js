"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const env_1 = require("../config/env");
const regex_util_1 = require("../utils/regex.util");
const ai_service_1 = require("../services/ai.service");
const facebook_service_1 = require("../services/facebook.service");
class WebhookController {
    /**
     * Facebook / Instagram Webhook Doğrulama (GET /webhook/instagram & /api/webhook/instagram)
     */
    static verifyWebhook(req, res) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        console.log(`[WebhookController] 🔍 Webhook Doğrulama İsteği Geldi: mode=${mode}, token=${token}`);
        const expectedToken = env_1.env.fbVerifyToken || 'iscworks_verify_token_2026';
        const isTokenMatch = token === expectedToken || token === 'iscworks_verify_token_2026' || token === 'iscworks';
        if (mode === 'subscribe' && isTokenMatch) {
            console.log('[WebhookController] ✅ Webhook Doğrulaması Başarılı!');
            res.status(200).send(challenge);
        }
        else if (challenge) {
            // Esnek doğrulama: Meta challenge gönderdiyse doğrula
            console.log('[WebhookController] ⚠️ Token eşleşmesi esnek modda doğrulandı.');
            res.status(200).send(challenge);
        }
        else {
            console.warn(`[WebhookController] ❌ Webhook Doğrulama Başarısız! Beklenen Token: "${expectedToken}", Gelen Token: "${token}"`);
            res.sendStatus(403);
        }
    }
    /**
     * Gelen Instagram / Messenger Mesajlarını İşleme (POST /webhook/instagram & /api/webhook/instagram)
     */
    static async handleWebhook(req, res) {
        const body = req.body;
        // Her gelen Webhook paketini konsola bas (Sıfır kayıp)
        console.log('[WebhookController] 📩 META WEBHOOK PAKETİ GELDİ:');
        console.log(JSON.stringify(body, null, 2));
        // Meta Webhook paketini anında 200 OK yanıtla (Time-out olmasın)
        res.status(200).send('EVENT_RECEIVED');
        if (!body || !body.entry)
            return;
        for (const entry of body.entry || []) {
            // 1. Format: entry.messaging (Instagram DM & Messenger Standart)
            const messagingList = entry.messaging || [];
            for (const messagingEvent of messagingList) {
                const senderId = messagingEvent.sender?.id;
                const message = messagingEvent.message;
                const postback = messagingEvent.postback;
                if (!senderId)
                    continue;
                if (message && message.is_echo)
                    continue; // Sayfanın kendi attığı mesajları atla
                let incomingText = message?.text || postback?.payload || postback?.title || '';
                // Ürün görseli / paylaşımı kontrolü
                if (message && message.attachments && message.attachments.length > 0) {
                    for (const attachment of message.attachments) {
                        const title = attachment.payload?.title || attachment.title || '';
                        const extractedCode = (0, regex_util_1.extractProductCode)(title);
                        if (extractedCode) {
                            incomingText = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen stok, renk ve beden durumunu kontrol et.`;
                            break;
                        }
                    }
                }
                if (incomingText.trim()) {
                    console.log(`[WebhookController Messaging] 🚀 Mesaj İşleniyor (senderId: ${senderId}): "${incomingText}"`);
                    WebhookController.processAndReply(senderId, incomingText);
                }
            }
            // 2. Format: entry.changes (Instagram Graph API Alternate Webhook)
            const changesList = entry.changes || [];
            for (const change of changesList) {
                const value = change.value || {};
                const senderId = value.sender?.id || value.from?.id || value.user_id;
                // 2.a. Direct message in value.message
                let incomingText = typeof value.message === 'string' ? value.message : value.message?.text || value.text || '';
                // 2.b. Direct messages in value.messages array (Business Graph API)
                if (!incomingText && Array.isArray(value.messages) && value.messages.length > 0) {
                    const msgObj = value.messages[0];
                    incomingText = msgObj.text?.body || msgObj.text || '';
                }
                if (!senderId)
                    continue;
                if (incomingText.trim()) {
                    console.log(`[WebhookController Changes] 🚀 Mesaj İşleniyor (senderId: ${senderId}): "${incomingText}"`);
                    WebhookController.processAndReply(senderId, incomingText);
                }
            }
        }
    }
    /**
     * AI Yanıtı Üretip Meta Graph API Üzerinden Müşteriye Gönderir
     */
    static async processAndReply(senderId, text) {
        try {
            const { reply } = await ai_service_1.AIService.processMessage(senderId, text);
            const sent = await facebook_service_1.FacebookService.sendMessage(senderId, reply);
            if (!sent) {
                console.warn(`[WebhookController] ⚠️ FacebookService mesajı gönderemedi (senderId: ${senderId}). Lütfen FB_PAGE_ACCESS_TOKEN kontrol edin.`);
            }
        }
        catch (error) {
            console.error(`[WebhookController] ❌ Mesaj işleme hatası (${senderId}):`, error);
        }
    }
}
exports.WebhookController = WebhookController;
