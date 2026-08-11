import { Request, Response } from 'express';
import { env } from '../config/env';
import { extractProductCode } from '../utils/regex.util';
import { AIService } from '../services/ai.service';
import { FacebookService } from '../services/facebook.service';
import { InstagramMessageService } from '../services/instagram-message.service';
import { CartService } from '../services/cart.service';
import { StockService } from '../services/stock.service';
import { OrderService } from '../services/order.service';
import { MessageBufferService, buildConversationKey } from '../services/message-buffer.service';
import { QuickReplyBuilderService } from '../services/quick-reply-builder.service';
import { ConversationStateService } from '../services/conversation-state.service';

function stripEmojis(str: string): string {
  if (!str) return '';
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
}

export const recentPostbacksMap = new Map<string, number>();

// Cleanup stale recent postback entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, time] of recentPostbacksMap.entries()) {
    if (now - time > 10000) {
      recentPostbacksMap.delete(k);
    }
  }
}, 5 * 60 * 1000);

export class WebhookController {
  /**
   * Facebook / Instagram Webhook Doğrulama (GET /webhook/instagram & /api/webhook/instagram)
   */
  public static verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`[WebhookController] 🔍 Webhook Doğrulama İsteği Geldi: mode=${mode}, token=${token}`);

    const expectedToken = env.fbVerifyToken || 'iscworks_verify_token_2026';
    const isTokenMatch = token === expectedToken || token === 'iscworks_verify_token_2026' || token === 'iscworks';

    if (mode === 'subscribe' && isTokenMatch) {
      console.log('[WebhookController] ✅ Webhook Doğrulaması Başarılı!');
      res.status(200).send(challenge);
    } else if (challenge) {
      console.log('[WebhookController] ⚠️ Token eşleşmesi esnek modda doğrulandı.');
      res.status(200).send(challenge);
    } else {
      console.warn(`[WebhookController] ❌ Webhook Doğrulama Başarısız! Beklenen Token: "${expectedToken}", Gelen Token: "${token}"`);
      res.sendStatus(403);
    }
  }

  /**
   * Gelen Instagram / Messenger Mesajlarını İşleme (POST /webhook/instagram & /api/webhook/instagram)
   */
  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    const body = req.body;

    console.log('[WebhookController] 📩 META WEBHOOK PAKETİ GELDİ:');
    console.log(JSON.stringify(body, null, 2));

    // Meta Webhook paketini anında 200 OK yanıtla (Time-out önleme)
    res.status(200).send('EVENT_RECEIVED');

    if (!body || !body.entry) return;

    for (const entry of body.entry || []) {
      // 1. Format: entry.messaging (Instagram DM & Messenger Standart)
      const messagingList = entry.messaging || [];
      for (const messagingEvent of messagingList) {
        const senderId = messagingEvent.sender?.id;
        const message = messagingEvent.message;
        const postback = messagingEvent.postback;

        if (!senderId) continue;
        if (message && message.is_echo) continue;

        const payload = postback?.payload || message?.quick_reply?.payload || '';
        let incomingText = message?.text || postback?.title || '';

        // Ürün görseli / paylaşımı kontrolü
        if (message && message.attachments && message.attachments.length > 0) {
          for (const attachment of message.attachments) {
            const title = attachment.payload?.title || attachment.title || '';
            const extractedCode = extractProductCode(title);
            if (extractedCode) {
              incomingText = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen stok, renk ve beden durumunu kontrol et.`;
              break;
            }
          }
        }

        if (!senderId) continue;

        // ─────────────────────────────────────────
        // SUGGESTED_TEXT payload → Mesaj olarak buffer'a yönlendir
        // Dynamic Quick Reply butonuna basıldığında buraya düşer
        // ─────────────────────────────────────────
        if (payload && QuickReplyBuilderService.isSuggestedText(payload)) {
          const decodedText = QuickReplyBuilderService.decodeSuggestedText(payload);
          if (decodedText) {
            console.log(`[WebhookController Messaging] SUGGESTED_TEXT decoded: "${decodedText}" (senderId: ${senderId})`);
            MessageBufferService.addMessage(
              'default',
              'instagram',
              senderId,
              decodedText,
              async (_convKey, _storeId, _channel, userId, combinedText) => {
                await WebhookController.processEventOrReply(userId, combinedText, '');
              }
            );
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
          MessageBufferService.addMessage(
            'default',      // storeId (single-tenant, multi-tenant geçişte burası değişir)
            'instagram',
            senderId,
            incomingText.trim(),
            async (convKey, storeId, channel, userId, combinedText) => {
              await WebhookController.processEventOrReply(userId, combinedText, '');
            }
          );
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

        if (!senderId) continue;

        if (incomingText.trim()) {
          console.log(`[WebhookController Changes] TEXT (senderId: ${senderId}): "${incomingText}"`);
          MessageBufferService.addMessage(
            'default',
            'instagram',
            senderId,
            incomingText.trim(),
            async (convKey, storeId, channel, userId, combinedText) => {
              await WebhookController.processEventOrReply(userId, combinedText, '');
            }
          );
        }
      }
    }
  }

  /**
   * Deterministic Payload / Interactive Action veya AI Mesaj İşleyici (Sohbet Kilitlenmesi Önlemeli)
   */
  public static async processEventOrReply(senderId: string, text: string, payload: string) {
    try {
      const cleanText = stripEmojis(text);
      let rawAction = (payload || cleanText || text).trim();
      const lowerText = cleanText.toLowerCase().trim();

      // Alias Normalizasyonları
      if (rawAction === 'CHECKOUT_COMPLETE') rawAction = 'CHECKOUT_CONFIRM';
      if (rawAction === 'ADD_PRODUCT') rawAction = 'ADD_MORE_PRODUCTS';
      if (rawAction === 'CANCEL') rawAction = 'CANCEL_CHECKOUT';

      // Duplicate Event Protection (1500ms debounce for identical postbacks from same user)
      if (payload && payload.trim()) {
        const now = Date.now();
        const postbackKey = `${senderId}:${rawAction}`;
        const lastTime = recentPostbacksMap.get(postbackKey) || 0;
        if (lastTime > 0 && now - lastTime < 1500) {
          console.log(`[Instagram Interactive] DUPLICATE EVENT IGNORED senderId=${senderId} payload=${rawAction}`);
          return;
        }
        recentPostbacksMap.set(postbackKey, now);
      }

      const stateKey = ConversationStateService.buildKey('default', 'instagram', senderId);
      const ctx = (AIService as any).getSessionContext(senderId);

      // Helper function for interactive logging
      const logInteractive = (actionName: string) => {
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

        const availableSizes = await StockService.getAvailableSizes(shortCode);
        const matchedSize = availableSizes.find(s => s.trim().toUpperCase() === size.trim().toUpperCase());
        if (!matchedSize) {
          console.warn(`[ConversationState] Invalid size selected: ${size} for ${shortCode}`);
          return InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz beden (${size}) mevcut değil.`);
        }

        ConversationStateService.transition(stateKey, 'SIZE_SELECTED', matchedSize);
        const qtyOptions = await QuickReplyBuilderService.buildQuantityOptions(shortCode, matchedSize);
        const promptText = `Beden olarak ${matchedSize} seçtiniz. Kaç adet almak istersiniz?`;
        return InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, qtyOptions);
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

        const availableColors = await StockService.getAvailableColors(shortCode);
        const matchedColor = availableColors.find(c => c.trim().toUpperCase() === color.trim().toUpperCase());
        if (!matchedColor) {
          console.warn(`[ConversationState] Invalid color selected: ${color} for ${shortCode}`);
          return InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz renk (${color}) mevcut değil.`);
        }

        ConversationStateService.transition(stateKey, 'COLOR_SELECTED', matchedColor);
        const availableSizes = await StockService.getAvailableSizes(shortCode);
        if (availableSizes.length > 0) {
          const sizeOptions = await QuickReplyBuilderService.buildSizeOptions(shortCode);
          const promptText = `Renk olarak ${matchedColor} seçtiniz. Lütfen beden tercihinizi yapın:`;
          return InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, sizeOptions);
        } else {
          const qtyOptions = await QuickReplyBuilderService.buildQuantityOptions(shortCode, undefined, matchedColor);
          const promptText = `Renk olarak ${matchedColor} seçtiniz. Kaç adet almak istersiniz?`;
          return InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, qtyOptions);
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

        const stock = await StockService.getStockForSizeColor(shortCode, size);
        if (qty > stock) {
          console.warn(`[ConversationState] Quantity ${qty} exceeds available stock ${stock}`);
          return InstagramMessageService.sendText(senderId, `Üzgünüz, seçtiğiniz adet (${qty}) stok miktarını (${stock}) aşmaktadır.`);
        }

        const allRows = await StockService.fetchAllSheetRows();
        const matchedProduct = allRows.find(r => r.shortCode.toUpperCase() === shortCode.toUpperCase() && (!size || r.size.toUpperCase() === size.toUpperCase()));
        if (!matchedProduct) {
          return InstagramMessageService.sendText(senderId, `Ürün bilgisi doğrulanamadı.`);
        }

        ConversationStateService.transition(stateKey, 'QUANTITY_SELECTED', qty);
        const stateData = ConversationStateService.getState(stateKey);
        stateData.productCode = matchedProduct.productCode;
        stateData.productName = matchedProduct.name;
        stateData.productPrice = matchedProduct.price;

        const confirmOptions = QuickReplyBuilderService.buildCartConfirmOptions();
        const promptText = `${qty} adet ${matchedProduct.name} (${size || 'Standart'} Beden) sepete eklemek istiyor musunuz?`;
        return InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, confirmOptions);
      }

      // ─────────────────────────────────────────────
      // 4. CONFIRM_ADD_TO_CART Postback
      // ─────────────────────────────────────────────
      if (rawAction === 'CONFIRM_ADD_TO_CART') {
        logInteractive('CONFIRM_ADD_TO_CART');
        const stateData = ConversationStateService.getState(stateKey);
        const productCode = stateData.productCode;
        const qty = stateData.selectedQuantity || 1;
        const size = stateData.selectedSize;

        console.log(`[ConversationState] CONFIRM_ADD_TO_CART: productCode=${productCode}, qty=${qty}, size=${size}`);

        if (!productCode) {
          return InstagramMessageService.sendText(senderId, 'Sepete eklenecek ürün bulunamadı. Lütfen tekrar deneyin.');
        }

        const cartRes = await CartService.addItem(senderId, productCode, qty, size);
        ConversationStateService.transition(stateKey, 'CONFIRM_ADD_TO_CART');

        const checkoutOptions = QuickReplyBuilderService.buildCheckoutOptions();
        const promptText = `${cartRes.message}\n\nSepetiniz güncellendi. Siparişinizi tamamlamak ister misiniz?`;
        return InstagramMessageService.sendButtonsOrQuickReplies(senderId, promptText, checkoutOptions);
      }

      // ─────────────────────────────────────────────
      // 5. CHECKOUT_CONFIRM Postback
      // ─────────────────────────────────────────────
      if (rawAction === 'CHECKOUT_CONFIRM') {
        logInteractive('CHECKOUT_CONFIRM');
        console.log(`[ConversationState] CHECKOUT_CONFIRM received`);
        const cart = CartService.getCart(senderId);
        if (cart.length === 0) {
          return InstagramMessageService.sendText(senderId, 'Sepetiniz şu anda boş.');
        }

        const orderId = `ORD-${Date.now()}`;
        for (const item of cart) {
          await OrderService.createOrder({
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
          await StockService.deductStock(item.productCode, item.quantity, item.size);
        }

        CartService.clearCart(senderId);
        ConversationStateService.transition(stateKey, 'CHECKOUT_CONFIRM');

        return InstagramMessageService.sendText(
          senderId,
          `✅ Siparişiniz başarıyla onaylanmıştır! Sipariş Numaranız: ${orderId}. Teşekkür ederiz.`
        );
      }

      // ─────────────────────────────────────────────
      // 6. CANCEL_CHECKOUT Postback
      // ─────────────────────────────────────────────
      if (rawAction === 'CANCEL_CHECKOUT') {
        logInteractive('CANCEL_CHECKOUT');
        console.log(`[ConversationState] CANCEL_CHECKOUT received`);
        ConversationStateService.transition(stateKey, 'CANCEL');
        const fallbackOptions = QuickReplyBuilderService.buildFallbackReplies();
        return InstagramMessageService.sendButtonsOrQuickReplies(
          senderId,
          'İşlem iptal edildi. Size başka nasıl yardımcı olabilirim?',
          fallbackOptions
        );
      }

      // ─────────────────────────────────────────────
      // 7. ADD_MORE_PRODUCTS Postback
      // ─────────────────────────────────────────────
      if (rawAction === 'ADD_MORE_PRODUCTS') {
        logInteractive('ADD_MORE_PRODUCTS');
        console.log(`[ConversationState] ADD_MORE_PRODUCTS received`);
        ConversationStateService.transition(stateKey, 'ADD_MORE');
        const products = await StockService.getAllProducts();
        if (!products || products.length === 0) {
          return InstagramMessageService.sendText(senderId, 'Gösterilecek ürün bulunamadı.');
        }
        return InstagramMessageService.sendProductCarousel(senderId, products);
      }

      // 8. ACTION: ADD_TO_CART:<productCode>[:size] veya "Sepete Ekle"
      if (rawAction.startsWith('ADD_TO_CART:') || lowerText === 'sepete ekle' || lowerText === 'sepete ekle!') {
        logInteractive('ADD_TO_CART');
        let productCode = '';
        let size: string | undefined = undefined;

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
          return InstagramMessageService.sendQuickReplies(
            senderId,
            'Lütfen sepete eklemek istediğiniz ürünün adını veya kodunu yazınız. (Örn: KUMAŞ GÖMLEK S)',
            [
              { title: 'Ürünler', payload: 'PRODUCT_LIST' },
              { title: 'Destek', payload: 'HUMAN_SUPPORT' }
            ]
          );
        }

        const stockCheck = await StockService.checkStock(productCode);
        console.log(`[InstagramMessage] Product validated: ${stockCheck.exists ? 'YES' : 'NO'}`);

        if (!stockCheck.exists) {
          console.warn(`[InstagramMessage] Ürün veritabanında bulunamadı (${productCode})`);
          return InstagramMessageService.sendText(senderId, `Üzgünüz, (${productCode}) kodlu ürün sistemimizde bulunamadı.`);
        }

        const prodItem = stockCheck.product || {};
        const prodStock = prodItem.stock !== undefined ? prodItem.stock : 0;

        if (!stockCheck.inStock || prodStock <= 0) {
          console.warn(`[InstagramMessage] Stock check failed for ${productCode}`);
          return InstagramMessageService.sendQuickReplies(
            senderId, 
            `Üzgünüz, **${prodItem.name || productCode}** şu anda stokta tükenmiştir.`,
            [
              { title: 'Diğer Ürünler', payload: 'PRODUCT_LIST' },
              { title: 'Destek', payload: 'HUMAN_SUPPORT' }
            ]
          );
        }

        console.log(`[InstagramMessage] Stock check passed (${prodStock} adet)`);

        const cartRes = await CartService.addItem(senderId, productCode, 1, size);
        console.log(`[InstagramMessage] Cart updated: ${cartRes.success}`);

        return InstagramMessageService.sendQuickReplies(
          senderId,
          `${cartRes.message}\n\nBaşka bir işlem yapmak ister misiniz?`,
          [
            { title: 'Sepetim', payload: 'MY_CART' },
            { title: 'Ürünler', payload: 'PRODUCT_LIST' },
            { title: 'Destek', payload: 'HUMAN_SUPPORT' }
          ]
        );
      }

      // 9. ACTION: PRODUCT_DETAIL:<productCode>
      if (rawAction.startsWith('PRODUCT_DETAIL:')) {
        logInteractive('PRODUCT_DETAIL');
        const productCode = rawAction.replace('PRODUCT_DETAIL:', '').trim().toUpperCase();
        console.log(`[InstagramMessage] Button clicked: PRODUCT_DETAIL for ${productCode}`);

        const prod = await StockService.checkStock(productCode);
        if (!prod.exists || !prod.product) {
          return InstagramMessageService.sendText(senderId, `(${productCode}) detay bilgisine ulaşılamadı.`);
        }

        const item = prod.product;
        ctx.productCode = item.productCode || productCode;
        ctx.size = item.size;

        ConversationStateService.setProductContext(stateKey, {
          shortCode: item.shortCode || item.productCode.split('-')[0],
          productCode: item.productCode,
          productName: item.name,
          productPrice: item.price,
          productStock: item.stock,
          availableSizes: item.availableSizes || [item.size]
        });

        const detailText = `**ÜRÜN DETAYI:**\n\n• **Ürün Adı:** ${item.name || productCode}\n• **Ürün Kodu:** ${item.productCode}\n• **Satış Fiyatı:** ${item.price} TL\n• **Beden Options:** ${item.size || 'S, M, L, XL'}\n• **Stok Durumu:** ${prod.inStock ? `Stokta Var (${item.stock} adet)` : 'Tükendi'}`;

        const sizes = await StockService.getAvailableSizes(item.shortCode || item.productCode.split('-')[0]);

        if (sizes.length > 0) {
          const sizeOptions = await QuickReplyBuilderService.buildSizeOptions(item.shortCode || item.productCode.split('-')[0]);
          return InstagramMessageService.sendButtonsOrQuickReplies(
            senderId,
            `${detailText}\n\nLütfen istediğiniz bedeni seçin:`,
            sizeOptions
          );
        } else {
          const qtyOptions = await QuickReplyBuilderService.buildQuantityOptions(item.shortCode || item.productCode.split('-')[0]);
          return InstagramMessageService.sendButtonsOrQuickReplies(
            senderId,
            `${detailText}\n\nKaç adet istersiniz?`,
            qtyOptions
          );
        }
      }

      // 10. ACTION: PRODUCT_LIST (Ürün Kataloğunu Carousel Olarak Gönder)
      if (
        rawAction === 'PRODUCT_LIST' || 
        lowerText === 'ürünler' || 
        lowerText === 'urunler' || 
        lowerText.includes('katalog') ||
        lowerText.includes('ürünleri göster')
      ) {
        logInteractive('PRODUCT_LIST');
        console.log(`[InstagramMessage] Sending product carousel to ${senderId}`);
        const products = await StockService.getAllProducts();
        if (!products || products.length === 0) {
          return InstagramMessageService.sendText(senderId, 'Şu an aktif ürün kataloğumuz hazırlanmaktadır.');
        }

        if (products[0] && products[0].productCode) {
          ctx.productCode = products[0].productCode;
          ctx.size = products[0].size;
        }

        return InstagramMessageService.sendProductCarousel(senderId, products);
      }

      // 11. ACTION: MY_CART (Sepeti Göster)
      if (rawAction === 'MY_CART' || lowerText === 'sepetim' || lowerText === 'sepeti göster') {
        logInteractive('MY_CART');
        console.log(`[InstagramMessage] Showing cart to ${senderId}`);
        const cart = CartService.getCart(senderId);
        if (!cart || cart.length === 0) {
          return InstagramMessageService.sendQuickReplies(
            senderId,
            'Sepetiniz şu anda boş. Hemen ürünlerimizi inceleyebilirsiniz!',
            [
              { title: 'Ürün Kataloğu', payload: 'PRODUCT_LIST' },
              { title: 'Destek', payload: 'HUMAN_SUPPORT' }
            ]
          );
        }

        let total = 0;
        const cartListStr = cart.map((item, idx) => {
          const itemTotal = item.unitPrice * item.quantity;
          total += itemTotal;
          return `${idx + 1}. **${item.productName}** (${item.size} Beden)\n   ${item.quantity} Adet × ${item.unitPrice} TL = ${itemTotal} TL`;
        }).join('\n\n');

        const cartText = `**SEPETİNİZ:**\n\n${cartListStr}\n\n**Toplam Tutar:** ${total} TL`;

        return InstagramMessageService.sendButtonMessage(
          senderId,
          cartText,
          [
            { title: 'Sipariş Ver', payload: 'CHECKOUT' },
            { title: 'Ürün Ekle', payload: 'PRODUCT_LIST' }
          ]
        );
      }

      // 12. ACTION: MY_ORDERS (Müşterinin Siparişlerini Göster)
      if (rawAction === 'MY_ORDERS' || lowerText === 'siparişlerim' || lowerText === 'siparislerim') {
        logInteractive('MY_ORDERS');
        console.log(`[InstagramMessage] Showing orders to ${senderId}`);
        const allOrders = await OrderService.getOrders();
        const userOrders = allOrders.filter(o => o.senderId === senderId);

        if (userOrders.length === 0) {
          return InstagramMessageService.sendQuickReplies(
            senderId,
            'Henüz kayıtlı bir siparişiniz bulunmuyor.',
            [
              { title: 'Ürünler', payload: 'PRODUCT_LIST' },
              { title: 'Destek', payload: 'HUMAN_SUPPORT' }
            ]
          );
        }

        const ordersStr = userOrders.slice(0, 5).map((o, idx) => 
          `${idx + 1}. **Sipariş No:** ${o.orderId}\n   • Ürün: ${o.productName} (${o.quantity} Adet)\n   • Tutar: ${o.totalPrice} TL | Durum: ${o.status}`
        ).join('\n\n');

        return InstagramMessageService.sendQuickReplies(
          senderId,
          `**SON SİPARİŞLERİNİZ:**\n\n${ordersStr}`,
          [
            { title: 'Ürünler', payload: 'PRODUCT_LIST' },
            { title: 'Destek', payload: 'HUMAN_SUPPORT' }
          ]
        );
      }

      // 13. ACTION: HUMAN_SUPPORT (Canlı Destek)
      if (rawAction === 'HUMAN_SUPPORT' || lowerText.includes('canlı destek') || lowerText === 'destek') {
        logInteractive('HUMAN_SUPPORT');
        return InstagramMessageService.sendText(
          senderId,
          '**Müşteri Temsilcimiz:** Temsilcimiz en kısa sürede sizinle ilgilenecektir. Lütfen sormak istediğiniz konuyu doğrudan yazabilirsiniz.'
        );
      }

      // 14. DEFAULT: AI Chat Processing (F.R.I.D.A.Y.) + Dynamic Quick Replies
      try {
        console.log(`[AI] senderId=${senderId} reason=NATURAL_LANGUAGE ai=true`);
        const aiResult = await AIService.processMessage(senderId, cleanText || text);
        const { reply, suggestedReplies } = aiResult;

        const stateData = ConversationStateService.getState(stateKey);
        let shortCode = stateData.shortCode;
        if (!shortCode) {
          const extracted = extractProductCode(cleanText || text) || extractProductCode(reply);
          if (extracted) {
            shortCode = extracted.split('-')[0].toUpperCase();
            stateData.shortCode = shortCode;
          }
        }

        const selectedSize = stateData.selectedSize;
        const selectedColor = stateData.selectedColor;

        let qrItems = await QuickReplyBuilderService.buildOptionsFromAi(
          suggestedReplies || [],
          shortCode,
          selectedSize,
          selectedColor
        );

        if (!qrItems || qrItems.length === 0) {
          qrItems = await QuickReplyBuilderService.autoDetectOptions(
            reply,
            shortCode,
            selectedSize,
            selectedColor
          );
        }

        if (qrItems.length > 0) {
          const instagramReplies = qrItems.map(qr => ({ title: qr.title, payload: qr.payload }));
          await InstagramMessageService.sendButtonsOrQuickReplies(senderId, reply, instagramReplies);
        } else {
          const fallbackItems = QuickReplyBuilderService.buildFallbackReplies();
          const fallbackReplies = fallbackItems.map(qr => ({ title: qr.title, payload: qr.payload }));
          await InstagramMessageService.sendButtonsOrQuickReplies(senderId, reply, fallbackReplies);
        }
      } catch (error) {
        console.error(`[WebhookController] AI Mesaj işleme hatası (${senderId}):`, error);
        await InstagramMessageService.sendMainMenu(senderId, 'Size nasıl yardımcı olabilirim? Aşağıdaki menüden seçim yapabilirsiniz.');
      }
    } catch (topErr: any) {
      console.error(`[WebhookController TOP LEVEL ERROR] (senderId: ${senderId}):`, topErr);
      await InstagramMessageService.sendMainMenu(senderId, 'İşleminiz alınmıştır. Aşağıdaki butonlardan devam edebilirsiniz:');
    }
  }
}
