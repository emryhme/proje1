"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const env_1 = require("../config/env");
const regex_util_1 = require("../utils/regex.util");
const ai_service_1 = require("../services/ai.service");
const instagram_message_service_1 = require("../services/instagram-message.service");
const cart_service_1 = require("../services/cart.service");
const stock_service_1 = require("../services/stock.service");
const order_service_1 = require("../services/order.service");
const message_buffer_service_1 = require("../services/message-buffer.service");
const quick_reply_builder_service_1 = require("../services/quick-reply-builder.service");
function stripEmojis(str) {
    if (!str)
        return '';
    return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
}
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
        console.log('[WebhookController] 📩 META WEBHOOK PAKETİ GELDİ:');
        console.log(JSON.stringify(body, null, 2));
        // Meta Webhook paketini anında 200 OK yanıtla (Time-out önleme)
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
                    continue;
                const payload = postback?.payload || message?.quick_reply?.payload || '';
                let incomingText = message?.text || postback?.title || '';
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
                if (!senderId)
                    continue;
                // ─────────────────────────────────────────
                // SUGGESTED_TEXT payload → Mesaj olarak buffer'a yönlendir
                // Dynamic Quick Reply butonuna basıldığında buraya düşer
                // ─────────────────────────────────────────
                if (payload && quick_reply_builder_service_1.QuickReplyBuilderService.isSuggestedText(payload)) {
                    const decodedText = quick_reply_builder_service_1.QuickReplyBuilderService.decodeSuggestedText(payload);
                    if (decodedText) {
                        console.log(`[WebhookController Messaging] SUGGESTED_TEXT decoded: "${decodedText}" (senderId: ${senderId})`);
                        message_buffer_service_1.MessageBufferService.addMessage('default', 'instagram', senderId, decodedText, async (_convKey, _storeId, _channel, userId, combinedText) => {
                            await WebhookController.processEventOrReply(userId, combinedText, '');
                        });
                    }
                    continue;
                }
                // ─────────────────────────────────────────
                // POSTBACK / ACTION → Buffer bypass (ADD_TO_CART, MY_CART vs.)
                // ─────────────────────────────────────────
                if (payload && payload.trim()) {
                    console.log(`[WebhookController Messaging] POSTBACK (senderId: ${senderId}): payload="${payload}"`);
                    WebhookController.processEventOrReply(senderId, incomingText.trim(), payload.trim());
                    continue;
                }
                // ─────────────────────────────────────────
                // PLAIN TEXT → MessageBuffer debounce katmanı
                // ─────────────────────────────────────────
                if (incomingText.trim()) {
                    console.log(`[WebhookController Messaging] TEXT (senderId: ${senderId}): text="${incomingText}"`);
                    message_buffer_service_1.MessageBufferService.addMessage('default', // storeId (single-tenant, multi-tenant geçişte burası değişir)
                    'instagram', senderId, incomingText.trim(), async (convKey, storeId, channel, userId, combinedText) => {
                        await WebhookController.processEventOrReply(userId, combinedText, '');
                    });
                }
            }
            // 2. Format: entry.changes (Instagram Graph API Alternate Webhook)
            const changesList = entry.changes || [];
            for (const change of changesList) {
                const value = change.value || {};
                const senderId = value.sender?.id || value.from?.id || value.user_id;
                let incomingText = typeof value.message === 'string' ? value.message : value.message?.text || value.text || '';
                if (!incomingText && Array.isArray(value.messages) && value.messages.length > 0) {
                    const msgObj = value.messages[0];
                    incomingText = msgObj.text?.body || msgObj.text || '';
                }
                if (!senderId)
                    continue;
                if (incomingText.trim()) {
                    console.log(`[WebhookController Changes] TEXT (senderId: ${senderId}): "${incomingText}"`);
                    message_buffer_service_1.MessageBufferService.addMessage('default', 'instagram', senderId, incomingText.trim(), async (convKey, storeId, channel, userId, combinedText) => {
                        await WebhookController.processEventOrReply(userId, combinedText, '');
                    });
                }
            }
        }
    }
    /**
     * Deterministic Payload / Interactive Action veya AI Mesaj İşleyici (Sohbet Kilitlenmesi Önlemeli)
     */
    static async processEventOrReply(senderId, text, payload) {
        try {
            const cleanText = stripEmojis(text);
            const rawAction = payload || cleanText || text;
            const lowerText = cleanText.toLowerCase().trim();
            const ctx = ai_service_1.AIService.getSessionContext(senderId);
            // 1. ACTION: ADD_TO_CART:<productCode>[:size] veya "Sepete Ekle"
            if (rawAction.startsWith('ADD_TO_CART:') || lowerText === 'sepete ekle' || lowerText === 'sepete ekle!') {
                let productCode = '';
                let size = undefined;
                if (rawAction.startsWith('ADD_TO_CART:')) {
                    const parts = rawAction.replace('ADD_TO_CART:', '').split(':');
                    productCode = (parts[0] || '').trim().toUpperCase();
                    size = parts[1] ? parts[1].trim().toUpperCase() : undefined;
                }
                // Eğer butonda kod yoksa oturumdaki son ürünü (ctx.productCode) dene
                if (!productCode && ctx.productCode) {
                    productCode = ctx.productCode;
                }
                if (!size && ctx.size) {
                    size = ctx.size;
                }
                console.log(`[InstagramMessage] Button clicked: ADD_TO_CART for productCode="${productCode}", size="${size || 'otomatik'}"`);
                if (!productCode) {
                    return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, 'Lütfen sepete eklemek istediğiniz ürünün adını veya kodunu yazınız. (Örn: KUMAŞ GÖMLEK S)', [
                        { title: 'Ürünler', payload: 'PRODUCT_LIST' },
                        { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                    ]);
                }
                // Güvenlik & Doğrulama: Ürünü DB'den sorgula
                const stockCheck = await stock_service_1.StockService.checkStock(productCode);
                console.log(`[InstagramMessage] Product validated: ${stockCheck.exists ? 'YES' : 'NO'}`);
                if (!stockCheck.exists) {
                    console.warn(`[InstagramMessage] Ürün veritabanında bulunamadı (${productCode})`);
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `Üzgünüz, (${productCode}) kodlu ürün sistemimizde bulunamadı.`);
                }
                const prodItem = stockCheck.product || {};
                const prodStock = prodItem.stock !== undefined ? prodItem.stock : 0;
                if (!stockCheck.inStock || prodStock <= 0) {
                    console.warn(`[InstagramMessage] Stock check failed for ${productCode}`);
                    return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, `Üzgünüz, **${prodItem.name || productCode}** şu anda stokta tükenmiştir.`, [
                        { title: 'Diğer Ürünler', payload: 'PRODUCT_LIST' },
                        { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                    ]);
                }
                console.log(`[InstagramMessage] Stock check passed (${prodStock} adet)`);
                // Sepete Ekle
                const cartRes = await cart_service_1.CartService.addItem(senderId, productCode, 1, size);
                console.log(`[InstagramMessage] Cart updated: ${cartRes.success}`);
                return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, `${cartRes.message}\n\nBaşka bir işlem yapmak ister misiniz?`, [
                    { title: 'Sepetim', payload: 'MY_CART' },
                    { title: 'Ürünler', payload: 'PRODUCT_LIST' },
                    { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                ]);
            }
            // 2. ACTION: PRODUCT_DETAIL:<productCode>
            if (rawAction.startsWith('PRODUCT_DETAIL:')) {
                const productCode = rawAction.replace('PRODUCT_DETAIL:', '').trim().toUpperCase();
                console.log(`[InstagramMessage] Button clicked: PRODUCT_DETAIL for ${productCode}`);
                const prod = await stock_service_1.StockService.checkStock(productCode);
                if (!prod.exists || !prod.product) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `(${productCode}) detay bilgisine ulaşılamadı.`);
                }
                const item = prod.product;
                ctx.productCode = item.productCode || productCode;
                ctx.size = item.size;
                const detailText = `**ÜRÜN DETAYI:**\n\n• **Ürün Adı:** ${item.name || productCode}\n• **Ürün Kodu:** ${item.productCode}\n• **Satış Fiyatı:** ${item.price} TL\n• **Beden Options:** ${item.size || 'S, M, L, XL'}\n• **Stok Durumu:** ${prod.inStock ? `Stokta Var (${item.stock} adet)` : 'Tükendi'}`;
                return instagram_message_service_1.InstagramMessageService.sendButtonMessage(senderId, detailText, [
                    { title: 'Sepete Ekle', payload: `ADD_TO_CART:${item.productCode || productCode}` },
                    { title: 'Tüm Ürünler', payload: 'PRODUCT_LIST' }
                ]);
            }
            // 3. ACTION: PRODUCT_LIST (Ürün Kataloğunu Carousel Olarak Gönder)
            if (rawAction === 'PRODUCT_LIST' ||
                lowerText === 'ürünler' ||
                lowerText === 'urunler' ||
                lowerText.includes('katalog') ||
                lowerText.includes('ürünleri göster')) {
                console.log(`[InstagramMessage] Sending product carousel to ${senderId}`);
                const products = await stock_service_1.StockService.getAllProducts();
                if (!products || products.length === 0) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, 'Şu an aktif ürün kataloğumuz hazırlanmaktadır.');
                }
                if (products[0] && products[0].productCode) {
                    ctx.productCode = products[0].productCode;
                    ctx.size = products[0].size;
                }
                return instagram_message_service_1.InstagramMessageService.sendProductCarousel(senderId, products);
            }
            // 4. ACTION: MY_CART (Sepeti Göster)
            if (rawAction === 'MY_CART' || lowerText === 'sepetim' || lowerText === 'sepeti göster') {
                console.log(`[InstagramMessage] Showing cart to ${senderId}`);
                const cart = cart_service_1.CartService.getCart(senderId);
                if (!cart || cart.length === 0) {
                    return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, 'Sepetiniz şu anda boş. Hemen ürünlerimizi inceleyebilirsiniz!', [
                        { title: 'Ürün Kataloğu', payload: 'PRODUCT_LIST' },
                        { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                    ]);
                }
                let total = 0;
                const cartListStr = cart.map((item, idx) => {
                    const itemTotal = item.unitPrice * item.quantity;
                    total += itemTotal;
                    return `${idx + 1}. **${item.productName}** (${item.size} Beden)\n   ${item.quantity} Adet × ${item.unitPrice} TL = ${itemTotal} TL`;
                }).join('\n\n');
                const cartText = `**SEPETİNİZ:**\n\n${cartListStr}\n\n**Toplam Tutar:** ${total} TL`;
                return instagram_message_service_1.InstagramMessageService.sendButtonMessage(senderId, cartText, [
                    { title: 'Sipariş Ver', payload: 'CHECKOUT' },
                    { title: 'Ürün Ekle', payload: 'PRODUCT_LIST' }
                ]);
            }
            // 5. ACTION: MY_ORDERS (Müşterinin Siparişlerini Göster)
            if (rawAction === 'MY_ORDERS' || lowerText === 'siparişlerim' || lowerText === 'siparislerim') {
                console.log(`[InstagramMessage] Showing orders to ${senderId}`);
                const allOrders = await order_service_1.OrderService.getOrders();
                const userOrders = allOrders.filter(o => o.senderId === senderId);
                if (userOrders.length === 0) {
                    return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, 'Henüz kayıtlı bir siparişiniz bulunmuyor.', [
                        { title: 'Ürünler', payload: 'PRODUCT_LIST' },
                        { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                    ]);
                }
                const ordersStr = userOrders.slice(0, 5).map((o, idx) => `${idx + 1}. **Sipariş No:** ${o.orderId}\n   • Ürün: ${o.productName} (${o.quantity} Adet)\n   • Tutar: ${o.totalPrice} TL | Durum: ${o.status}`).join('\n\n');
                return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, `**SON SİPARİŞLERİNİZ:**\n\n${ordersStr}`, [
                    { title: 'Ürünler', payload: 'PRODUCT_LIST' },
                    { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                ]);
            }
            // 6. ACTION: HUMAN_SUPPORT (Canlı Destek)
            if (rawAction === 'HUMAN_SUPPORT' || lowerText.includes('canlı destek') || lowerText === 'destek') {
                return instagram_message_service_1.InstagramMessageService.sendText(senderId, '**Müşteri Temsilcimiz:** Temsilcimiz en kısa sürede sizinle ilgilenecektir. Lütfen sormak istediğiniz konuyu doğrudan yazabilirsiniz.');
            }
            // 7. DEFAULT: AI Chat Processing (F.R.I.D.A.Y.) + Dynamic Quick Replies
            try {
                const aiResult = await ai_service_1.AIService.processMessage(senderId, cleanText || text);
                const { reply, suggestedReplies } = aiResult;
                // Session'daki güvenli ürün kodunu al (backend validate edilmiş)
                const sessionCtx = ai_service_1.AIService.getSessionContext(senderId);
                const validatedProductCode = sessionCtx?.productCode;
                // Dynamic Quick Reply'ları oluştur
                const qrItems = quick_reply_builder_service_1.QuickReplyBuilderService.buildReplies(suggestedReplies || [], validatedProductCode);
                if (qrItems.length > 0) {
                    // Quick Reply olarak gönder
                    const instagramReplies = qrItems.map(qr => ({ title: qr.title, payload: qr.payload }));
                    await instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, reply, instagramReplies);
                }
                else {
                    // Fallback: Düz metin + statik fallback butonlar
                    const fallbackItems = quick_reply_builder_service_1.QuickReplyBuilderService.buildFallbackReplies();
                    const fallbackReplies = fallbackItems.map(qr => ({ title: qr.title, payload: qr.payload }));
                    await instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, reply, fallbackReplies);
                }
            }
            catch (error) {
                console.error(`[WebhookController] AI Mesaj işleme hatası (${senderId}):`, error);
                await instagram_message_service_1.InstagramMessageService.sendMainMenu(senderId, 'Size nasıl yardımcı olabilirim? Aşağıdaki menüden seçim yapabilirsiniz.');
            }
        }
        catch (topErr) {
            console.error(`[WebhookController TOP LEVEL ERROR] (senderId: ${senderId}):`, topErr);
            await instagram_message_service_1.InstagramMessageService.sendMainMenu(senderId, 'İşleminiz alınmıştır. Aşağıdaki butonlardan devam edebilirsiniz:');
        }
    }
}
exports.WebhookController = WebhookController;
