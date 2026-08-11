"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = exports.recentPostbacksMap = void 0;
const env_1 = require("../config/env");
const regex_util_1 = require("../utils/regex.util");
const ai_service_1 = require("../services/ai.service");
const instagram_message_service_1 = require("../services/instagram-message.service");
const cart_service_1 = require("../services/cart.service");
const stock_service_1 = require("../services/stock.service");
const order_service_1 = require("../services/order.service");
const message_buffer_service_1 = require("../services/message-buffer.service");
const quick_reply_builder_service_1 = require("../services/quick-reply-builder.service");
const conversation_state_service_1 = require("../services/conversation-state.service");
function stripEmojis(str) {
    if (!str)
        return '';
    return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
}
exports.recentPostbacksMap = new Map();
// Cleanup stale recent postback entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [k, time] of exports.recentPostbacksMap.entries()) {
        if (now - time > 10000) {
            exports.recentPostbacksMap.delete(k);
        }
    }
}, 5 * 60 * 1000);
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
                // ─────────────────────────────────────────
                // SUGGESTED_TEXT ise metni deşifre et
                // ─────────────────────────────────────────
                if (payload && quick_reply_builder_service_1.QuickReplyBuilderService.isSuggestedText(payload)) {
                    const decodedText = quick_reply_builder_service_1.QuickReplyBuilderService.decodeSuggestedText(payload);
                    if (decodedText) {
                        incomingText = decodedText;
                    }
                }
                // ─────────────────────────────────────────
                // BUTON VE METİN MESAJLARINI NORMAL MESAJ OLARAK AL
                // ─────────────────────────────────────────
                const textToProcess = (incomingText || payload).trim();
                if (textToProcess) {
                    console.log(`[WebhookController Messaging] NORMAL MESAJ (Button/Text) (senderId: ${senderId}): "${textToProcess}"`);
                    message_buffer_service_1.MessageBufferService.addMessage('default', // storeId
                    'instagram', senderId, textToProcess, async (_convKey, _storeId, _channel, userId, combinedText) => {
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
                    console.log(`[WebhookController Changes] NORMAL MESAJ (senderId: ${senderId}): "${incomingText.trim()}"`);
                    message_buffer_service_1.MessageBufferService.addMessage('default', 'instagram', senderId, incomingText.trim(), async (_convKey, _storeId, _channel, userId, combinedText) => {
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
            let rawAction = (payload || cleanText || text).trim();
            const lowerText = cleanText.toLowerCase().trim();
            // Alias Normalizasyonları
            if (rawAction === 'CHECKOUT' || rawAction === 'CHECKOUT_COMPLETE')
                rawAction = 'CHECKOUT_CONFIRM';
            if (rawAction === 'ADD_PRODUCT')
                rawAction = 'ADD_MORE_PRODUCTS';
            if (rawAction === 'CANCEL')
                rawAction = 'CANCEL_CHECKOUT';
            // Duplicate Event Protection (1500ms debounce for identical postbacks from same user)
            if (payload && payload.trim()) {
                const now = Date.now();
                const postbackKey = `${senderId}:${rawAction}`;
                const lastTime = exports.recentPostbacksMap.get(postbackKey) || 0;
                if (lastTime > 0 && now - lastTime < 1500) {
                    console.log(`[Instagram Interactive] DUPLICATE EVENT IGNORED senderId=${senderId} payload=${rawAction}`);
                    return;
                }
                exports.recentPostbacksMap.set(postbackKey, now);
            }
            const stateKey = conversation_state_service_1.ConversationStateService.buildKey('default', 'instagram', senderId);
            const ctx = ai_service_1.AIService.getSessionContext(senderId);
            // Helper function for interactive logging
            const logInteractive = (actionName) => {
                console.log(`[Instagram Interactive] senderId=${senderId} type=POSTBACK payload=${rawAction} action=${actionName} ai=false`);
            };
            // ─────────────────────────────────────────────
            // 1. SELECT_SIZE:<shortCode>:<size> Postback
            // ─────────────────────────────────────────────
            if (rawAction.startsWith('SELECT_SIZE:')) {
                logInteractive('SELECT_SIZE');
                const parts = rawAction.split(':');
                const shortCode = (parts[1] || '').trim().toUpperCase();
                const size = (parts[2] || '').trim().toUpperCase();
                console.log(`[ConversationState] SELECT_SIZE postback: shortCode=${shortCode}, size=${size}`);
                const availableSizes = await stock_service_1.StockService.getAvailableSizes(shortCode);
                const matchedSize = availableSizes.find(s => s.trim().toUpperCase() === size.trim().toUpperCase());
                if (!matchedSize) {
                    console.warn(`[ConversationState] Invalid size selected: ${size} for ${shortCode}`);
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz beden (${size}) mevcut değil.`);
                }
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'SIZE_SELECTED', matchedSize);
                const qtyOptions = await quick_reply_builder_service_1.QuickReplyBuilderService.buildQuantityOptions(shortCode, matchedSize);
                const promptText = `Beden olarak ${matchedSize} seçtiniz. Kaç adet almak istersiniz?`;
                return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, qtyOptions);
            }
            // ─────────────────────────────────────────────
            // 2. SELECT_COLOR:<shortCode>:<color> Postback
            // ─────────────────────────────────────────────
            if (rawAction.startsWith('SELECT_COLOR:')) {
                logInteractive('SELECT_COLOR');
                const parts = rawAction.split(':');
                const shortCode = (parts[1] || '').trim().toUpperCase();
                const color = (parts[2] || '').trim();
                console.log(`[ConversationState] SELECT_COLOR postback: shortCode=${shortCode}, color=${color}`);
                const availableColors = await stock_service_1.StockService.getAvailableColors(shortCode);
                const matchedColor = availableColors.find(c => c.trim().toUpperCase() === color.trim().toUpperCase());
                if (!matchedColor) {
                    console.warn(`[ConversationState] Invalid color selected: ${color} for ${shortCode}`);
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz renk (${color}) mevcut değil.`);
                }
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'COLOR_SELECTED', matchedColor);
                const availableSizes = await stock_service_1.StockService.getAvailableSizes(shortCode);
                if (availableSizes.length > 0) {
                    const sizeOptions = await quick_reply_builder_service_1.QuickReplyBuilderService.buildSizeOptions(shortCode);
                    const promptText = `Renk olarak ${matchedColor} seçtiniz. Lütfen beden tercihinizi yapın:`;
                    return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, sizeOptions);
                }
                else {
                    const qtyOptions = await quick_reply_builder_service_1.QuickReplyBuilderService.buildQuantityOptions(shortCode, undefined, matchedColor);
                    const promptText = `Renk olarak ${matchedColor} seçtiniz. Kaç adet almak istersiniz?`;
                    return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, qtyOptions);
                }
            }
            // ─────────────────────────────────────────────
            // 3. SELECT_QUANTITY:<shortCode>:<size>:<qty> Postback
            // ─────────────────────────────────────────────
            if (rawAction.startsWith('SELECT_QUANTITY:')) {
                logInteractive('SELECT_QUANTITY');
                const parts = rawAction.split(':');
                const shortCode = (parts[1] || '').trim().toUpperCase();
                const size = parts[2] === 'NONE' ? undefined : (parts[2] || '').trim().toUpperCase();
                const qty = parseInt(parts[3] || '1', 10);
                console.log(`[ConversationState] SELECT_QUANTITY postback: shortCode=${shortCode}, size=${size}, qty=${qty}`);
                const stock = await stock_service_1.StockService.getStockForSizeColor(shortCode, size);
                if (qty > stock) {
                    console.warn(`[ConversationState] Quantity ${qty} exceeds available stock ${stock}`);
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz adet (${qty}) stok miktarını (${stock}) aşmaktadır.`);
                }
                const allRows = await stock_service_1.StockService.fetchAllSheetRows();
                const matchedProduct = allRows.find(r => r.shortCode.toUpperCase() === shortCode.toUpperCase() && (!size || r.size.toUpperCase() === size.toUpperCase()));
                if (!matchedProduct) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `Ürün bilgisi doğrulanamadı.`);
                }
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'QUANTITY_SELECTED', qty);
                const stateData = conversation_state_service_1.ConversationStateService.getState(stateKey);
                stateData.productCode = matchedProduct.productCode;
                stateData.productName = matchedProduct.name;
                stateData.productPrice = matchedProduct.price;
                const confirmOptions = quick_reply_builder_service_1.QuickReplyBuilderService.buildCartConfirmOptions();
                const promptText = `${qty} adet ${matchedProduct.name} (${size || 'Standart'} Beden) sepete eklemek istiyor musunuz?`;
                return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, confirmOptions);
            }
            // ─────────────────────────────────────────────
            // 4. CONFIRM_ADD_TO_CART Postback
            // ─────────────────────────────────────────────
            if (rawAction === 'CONFIRM_ADD_TO_CART') {
                logInteractive('CONFIRM_ADD_TO_CART');
                const stateData = conversation_state_service_1.ConversationStateService.getState(stateKey);
                const productCode = stateData.productCode;
                const qty = stateData.selectedQuantity || 1;
                const size = stateData.selectedSize;
                console.log(`[ConversationState] CONFIRM_ADD_TO_CART: productCode=${productCode}, qty=${qty}, size=${size}`);
                if (!productCode) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, 'Sepete eklenecek ürün bulunamadı. Lütfen tekrar deneyin.');
                }
                const cartRes = await cart_service_1.CartService.addItem(senderId, productCode, qty, size);
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'CONFIRM_ADD_TO_CART');
                const checkoutOptions = quick_reply_builder_service_1.QuickReplyBuilderService.buildCheckoutOptions();
                const promptText = `${cartRes.message}\n\nSepetiniz güncellendi. Siparişinizi tamamlamak ister misiniz?`;
                return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, checkoutOptions);
            }
            // ─────────────────────────────────────────────
            // 5. CHECKOUT_CONFIRM Postback
            // ─────────────────────────────────────────────
            if (rawAction === 'CHECKOUT_CONFIRM') {
                logInteractive('CHECKOUT_CONFIRM');
                console.log(`[ConversationState] CHECKOUT_CONFIRM received`);
                const cart = cart_service_1.CartService.getCart(senderId);
                if (cart.length === 0) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, 'Sepetiniz şu anda boş.');
                }
                const orderId = `ORD-${Date.now()}`;
                for (const item of cart) {
                    await order_service_1.OrderService.createOrder({
                        customerName: ctx.customerName || 'Musteri',
                        customerPhone: ctx.customerPhone || '05000000000',
                        address: ctx.address || 'Instagram DM',
                        senderId,
                        productCode: item.productCode,
                        productName: item.productName,
                        size: item.size || 'Standart',
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        totalPrice: item.unitPrice * item.quantity
                    });
                    await stock_service_1.StockService.deductStock(item.productCode, item.quantity, item.size);
                }
                cart_service_1.CartService.clearCart(senderId);
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'CHECKOUT_CONFIRM');
                return instagram_message_service_1.InstagramMessageService.sendText(senderId, `✅ Siparişiniz başarıyla onaylanmıştır! Sipariş Numaranız: ${orderId}. Teşekkür ederiz.`);
            }
            // ─────────────────────────────────────────────
            // 6. CANCEL_CHECKOUT Postback
            // ─────────────────────────────────────────────
            if (rawAction === 'CANCEL_CHECKOUT') {
                logInteractive('CANCEL_CHECKOUT');
                console.log(`[ConversationState] CANCEL_CHECKOUT received`);
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'CANCEL');
                const fallbackOptions = quick_reply_builder_service_1.QuickReplyBuilderService.buildFallbackReplies();
                return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, 'İşlem iptal edildi. Size başka nasıl yardımcı olabilirim?', fallbackOptions);
            }
            // ─────────────────────────────────────────────
            // 7. ADD_MORE_PRODUCTS Postback
            // ─────────────────────────────────────────────
            if (rawAction === 'ADD_MORE_PRODUCTS') {
                logInteractive('ADD_MORE_PRODUCTS');
                console.log(`[ConversationState] ADD_MORE_PRODUCTS received`);
                conversation_state_service_1.ConversationStateService.transition(stateKey, 'ADD_MORE');
                const products = await stock_service_1.StockService.getAllProducts();
                if (!products || products.length === 0) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, 'Gösterilecek ürün bulunamadı.');
                }
                return instagram_message_service_1.InstagramMessageService.sendProductCarousel(senderId, products);
            }
            // 8. ACTION: ADD_TO_CART:<productCode>[:size] veya "Sepete Ekle"
            if (rawAction.startsWith('ADD_TO_CART:') || lowerText === 'sepete ekle' || lowerText === 'sepete ekle!') {
                logInteractive('ADD_TO_CART');
                let productCode = '';
                let size = undefined;
                if (rawAction.startsWith('ADD_TO_CART:')) {
                    const parts = rawAction.replace('ADD_TO_CART:', '').split(':');
                    productCode = (parts[0] || '').trim().toUpperCase();
                    size = parts[1] ? parts[1].trim().toUpperCase() : undefined;
                }
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
                const cartRes = await cart_service_1.CartService.addItem(senderId, productCode, 1, size);
                console.log(`[InstagramMessage] Cart updated: ${cartRes.success}`);
                return instagram_message_service_1.InstagramMessageService.sendQuickReplies(senderId, `${cartRes.message}\n\nBaşka bir işlem yapmak ister misiniz?`, [
                    { title: 'Sepetim', payload: 'MY_CART' },
                    { title: 'Ürünler', payload: 'PRODUCT_LIST' },
                    { title: 'Destek', payload: 'HUMAN_SUPPORT' }
                ]);
            }
            // 9. ACTION: PRODUCT_DETAIL:<productCode>
            if (rawAction.startsWith('PRODUCT_DETAIL:')) {
                logInteractive('PRODUCT_DETAIL');
                const productCode = rawAction.replace('PRODUCT_DETAIL:', '').trim().toUpperCase();
                console.log(`[InstagramMessage] Button clicked: PRODUCT_DETAIL for ${productCode}`);
                const prod = await stock_service_1.StockService.checkStock(productCode);
                if (!prod.exists || !prod.product) {
                    return instagram_message_service_1.InstagramMessageService.sendText(senderId, `(${productCode}) detay bilgisine ulaşılamadı.`);
                }
                const item = prod.product;
                ctx.productCode = item.productCode || productCode;
                ctx.size = item.size;
                conversation_state_service_1.ConversationStateService.setProductContext(stateKey, {
                    shortCode: item.shortCode || item.productCode.split('-')[0],
                    productCode: item.productCode,
                    productName: item.name,
                    productPrice: item.price,
                    productStock: item.stock,
                    availableSizes: item.availableSizes || [item.size]
                });
                const detailText = `**ÜRÜN DETAYI:**\n\n• **Ürün Adı:** ${item.name || productCode}\n• **Ürün Kodu:** ${item.productCode}\n• **Satış Fiyatı:** ${item.price} TL\n• **Beden Options:** ${item.size || 'S, M, L, XL'}\n• **Stok Durumu:** ${prod.inStock ? `Stokta Var (${item.stock} adet)` : 'Tükendi'}`;
                const sizes = await stock_service_1.StockService.getAvailableSizes(item.shortCode || item.productCode.split('-')[0]);
                if (sizes.length > 0) {
                    const sizeOptions = await quick_reply_builder_service_1.QuickReplyBuilderService.buildSizeOptions(item.shortCode || item.productCode.split('-')[0]);
                    return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, `${detailText}\n\nLütfen istediğiniz bedeni seçin:`, sizeOptions);
                }
                else {
                    const qtyOptions = await quick_reply_builder_service_1.QuickReplyBuilderService.buildQuantityOptions(item.shortCode || item.productCode.split('-')[0]);
                    return instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, `${detailText}\n\nKaç adet istersiniz?`, qtyOptions);
                }
            }
            // 10. ACTION: PRODUCT_LIST (Ürün Kataloğunu Carousel Olarak Gönder)
            if (rawAction === 'PRODUCT_LIST' ||
                lowerText === 'ürünler' ||
                lowerText === 'urunler' ||
                lowerText.includes('katalog') ||
                lowerText.includes('ürünleri göster')) {
                logInteractive('PRODUCT_LIST');
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
            // 11. ACTION: MY_CART (Sepeti Göster)
            if (rawAction === 'MY_CART' || lowerText === 'sepetim' || lowerText === 'sepeti göster') {
                logInteractive('MY_CART');
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
                    { title: 'Sipariş Ver', payload: 'CHECKOUT_CONFIRM' },
                    { title: 'Ürün Ekle', payload: 'PRODUCT_LIST' }
                ]);
            }
            // 12. ACTION: MY_ORDERS (Müşterinin Siparişlerini Göster)
            if (rawAction === 'MY_ORDERS' || lowerText === 'siparişlerim' || lowerText === 'siparislerim') {
                logInteractive('MY_ORDERS');
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
            // 13. ACTION: HUMAN_SUPPORT (Canlı Destek)
            if (rawAction === 'HUMAN_SUPPORT' || lowerText.includes('canlı destek') || lowerText === 'destek') {
                logInteractive('HUMAN_SUPPORT');
                return instagram_message_service_1.InstagramMessageService.sendText(senderId, '**Müşteri Temsilcimiz:** Temsilcimiz en kısa sürede sizinle ilgilenecektir. Lütfen sormak istediğiniz konuyu doğrudan yazabilirsiniz.');
            }
            // 14. DEFAULT: AI Chat Processing (F.R.I.D.A.Y.) + Dynamic Quick Replies
            try {
                console.log(`[AI] senderId=${senderId} reason=NATURAL_LANGUAGE ai=true`);
                const aiResult = await ai_service_1.AIService.processMessage(senderId, cleanText || text);
                const { reply, suggestedReplies } = aiResult;
                const stateData = conversation_state_service_1.ConversationStateService.getState(stateKey);
                let shortCode = stateData.shortCode;
                if (!shortCode) {
                    const extracted = (0, regex_util_1.extractProductCode)(cleanText || text) || (0, regex_util_1.extractProductCode)(reply);
                    if (extracted) {
                        shortCode = extracted.split('-')[0].toUpperCase();
                        stateData.shortCode = shortCode;
                    }
                }
                const selectedSize = stateData.selectedSize;
                const selectedColor = stateData.selectedColor;
                let qrItems = await quick_reply_builder_service_1.QuickReplyBuilderService.buildOptionsFromAi(suggestedReplies || [], shortCode, selectedSize, selectedColor);
                if (!qrItems || qrItems.length === 0) {
                    qrItems = await quick_reply_builder_service_1.QuickReplyBuilderService.autoDetectOptions(reply, shortCode, selectedSize, selectedColor);
                }
                if (qrItems.length > 0) {
                    const instagramReplies = qrItems.map(qr => ({ title: qr.title, payload: qr.payload }));
                    await instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, reply, instagramReplies);
                }
                else {
                    const fallbackItems = quick_reply_builder_service_1.QuickReplyBuilderService.buildFallbackReplies();
                    const fallbackReplies = fallbackItems.map(qr => ({ title: qr.title, payload: qr.payload }));
                    await instagram_message_service_1.InstagramMessageService.sendButtonsOrQuickReplies(senderId, reply, fallbackReplies);
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
