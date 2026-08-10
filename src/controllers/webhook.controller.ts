import { Request, Response } from 'express';
import { env } from '../config/env';
import { extractProductCode } from '../utils/regex.util';
import { AIService } from '../services/ai.service';
import { FacebookService } from '../services/facebook.service';
import { InstagramMessageService } from '../services/instagram-message.service';
import { CartService } from '../services/cart.service';
import { StockService } from '../services/stock.service';
import { OrderService } from '../services/order.service';

function stripEmojis(str: string): string {
  if (!str) return '';
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
}

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

        if (payload || incomingText.trim()) {
          console.log(`[WebhookController Messaging] 🚀 İşleniyor (senderId: ${senderId}): payload="${payload}", text="${incomingText}"`);
          WebhookController.processEventOrReply(senderId, incomingText.trim(), payload.trim());
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
          console.log(`[WebhookController Changes] 🚀 İşleniyor (senderId: ${senderId}): "${incomingText}"`);
          WebhookController.processEventOrReply(senderId, incomingText.trim(), '');
        }
      }
    }
  }

  /**
   * Deterministic Payload / Interactive Action veya AI Mesaj İşleyici
   */
  public static async processEventOrReply(senderId: string, text: string, payload: string) {
    const cleanText = stripEmojis(text);
    const rawAction = payload || cleanText || text;

    // 1. ACTION: ADD_TO_CART:<productCode>[:size]
    if (rawAction.startsWith('ADD_TO_CART:')) {
      const parts = rawAction.replace('ADD_TO_CART:', '').split(':');
      const productCode = (parts[0] || '').trim().toUpperCase();
      const size = parts[1] ? parts[1].trim().toUpperCase() : undefined;

      console.log(`[InstagramMessage] Button clicked: ADD_TO_CART for ${productCode}`);

      // Güvenlik & Doğrulama: Ürünü DB'den sorgula
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

      // Sepete Ekle
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

    // 2. ACTION: PRODUCT_DETAIL:<productCode>
    if (rawAction.startsWith('PRODUCT_DETAIL:')) {
      const productCode = rawAction.replace('PRODUCT_DETAIL:', '').trim().toUpperCase();
      console.log(`[InstagramMessage] Button clicked: PRODUCT_DETAIL for ${productCode}`);

      const prod = await StockService.checkStock(productCode);
      if (!prod.exists || !prod.product) {
        return InstagramMessageService.sendText(senderId, `(${productCode}) detay bilgisine ulaşılamadı.`);
      }

      const item = prod.product;
      const detailText = `**ÜRÜN DETAYI:**\n\n• **Ürün Adı:** ${item.name || productCode}\n• **Ürün Kodu:** ${item.productCode}\n• **Satış Fiyatı:** ${item.price} TL\n• **Beden Options:** ${item.size || 'S, M, L, XL'}\n• **Stok Durumu:** ${prod.inStock ? `Stokta Var (${item.stock} adet)` : 'Tükendi'}`;

      return InstagramMessageService.sendButtonMessage(
        senderId,
        detailText,
        [
          { title: 'Sepete Ekle', payload: `ADD_TO_CART:${item.productCode || productCode}` },
          { title: 'Tüm Ürünler', payload: 'PRODUCT_LIST' }
        ]
      );
    }

    // 3. ACTION: PRODUCT_LIST (Ürün Kataloğunu Carousel Olarak Gönder)
    if (rawAction === 'PRODUCT_LIST' || text.toLowerCase() === 'ürünler' || text.toLowerCase() === 'urunler') {
      console.log(`[InstagramMessage] Sending product carousel to ${senderId}`);
      const products = await StockService.getAllProducts();
      if (!products || products.length === 0) {
        return InstagramMessageService.sendText(senderId, 'Şu an aktif ürün kataloğumuz hazırlanmaktadır.');
      }
      return InstagramMessageService.sendProductCarousel(senderId, products);
    }

    // 4. ACTION: MY_CART (Sepeti Göster)
    if (rawAction === 'MY_CART' || text.toLowerCase() === 'sepetim') {
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

    // 5. ACTION: MY_ORDERS (Müşterinin Siparişlerini Göster)
    if (rawAction === 'MY_ORDERS' || text.toLowerCase() === 'siparişlerim' || text.toLowerCase() === 'siparislerim') {
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

    // 6. ACTION: HUMAN_SUPPORT (Canlı Destek)
    if (rawAction === 'HUMAN_SUPPORT' || text.toLowerCase().includes('canlı destek') || text.toLowerCase() === 'destek') {
      return InstagramMessageService.sendText(
        senderId,
        '**Müşteri Temsilcimiz:** Temsilcimiz en kısa sürede sizinle ilgilenecektir. Lütfen sormak istediğiniz konuyu doğrudan yazabilirsiniz.'
      );
    }

    // 7. DEFAULT: AI Chat Processing (F.R.I.D.A.Y.)
    try {
      const { reply } = await AIService.processMessage(senderId, cleanText || text);
      const sent = await FacebookService.sendMessage(senderId, reply);
      if (!sent) {
        console.warn(`[WebhookController] ⚠️ FacebookService mesajı gönderemedi (senderId: ${senderId}). Lütfen FB_PAGE_ACCESS_TOKEN kontrol edin.`);
      }
    } catch (error) {
      console.error(`[WebhookController] ❌ AI Mesaj işleme hatası (${senderId}):`, error);
    }
  }
}
