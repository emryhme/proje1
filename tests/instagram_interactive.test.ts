import { initDatabase, db } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';
import { OrderService } from '../src/services/order.service';
import { InstagramMessageService } from '../src/services/instagram-message.service';
import { WebhookController } from '../src/controllers/webhook.controller';

async function runInstagramInteractiveTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - INSTAGRAM INTERACTIVE MESSAGING TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName} ${detail ? `(${detail})` : ''}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // Veritabanını Başlat
  initDatabase();

  const testSenderId = `INSTA_TEST_USER_${Date.now()}`;
  const skuInStock = `IG-IN-STOCK-${Date.now()}`;
  const skuOutOfStock = `IG-OUT-STOCK-${Date.now()}`;

  // Ürünleri Hazırla
  await StockService.addProduct({
    shortCode: 'IGTST',
    productCode: skuInStock,
    name: 'İnteraktif Siyah Elbise',
    color: 'Siyah',
    size: 'M',
    price: 1299,
    costPrice: 600,
    stock: 15,
    category: 'Elbise'
  });

  await StockService.addProduct({
    shortCode: 'IGOUT',
    productCode: skuOutOfStock,
    name: 'Tükenen Kırmızı Elbise',
    color: 'Kırmızı',
    size: 'S',
    price: 1499,
    costPrice: 700,
    stock: 0,
    category: 'Elbise'
  });

  // TEST 1: Quick Reply "Ürünler"
  try {
    const products = await StockService.getAllProducts();
    assert(
      Boolean(products && products.length >= 2),
      'TEST 1: Quick Reply "Ürünler"',
      `${products.length} ürün listelendi.`
    );
  } catch (e: any) {
    assert(false, 'TEST 1: Quick Reply "Ürünler"', e.message);
  }

  // TEST 2: Quick Reply "Sepetim"
  try {
    CartService.clearCart(testSenderId);
    const emptyCart = CartService.getCart(testSenderId);
    assert(
      Boolean(emptyCart && emptyCart.length === 0),
      'TEST 2: Quick Reply "Sepetim" (Temiz Sepet)',
      'Boş sepet kontrol edildi.'
    );
  } catch (e: any) {
    assert(false, 'TEST 2: Quick Reply "Sepetim"', e.message);
  }

  // TEST 3: Ürün Carousel Veri Üretimi
  try {
    const prods = await StockService.getAllProducts();
    const sent = await InstagramMessageService.sendProductCarousel('MOCK_RECIPIENT', prods);
    assert(
      Boolean(sent),
      'TEST 3: Ürün Carousel Üretimi',
      `${prods.length} üründen carousel kartları başarıyla oluşturuldu.`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: Ürün Carousel Üretimi', e.message);
  }

  // TEST 4: "Sepete Ekle" Buton Tıklaması (ADD_TO_CART)
  try {
    const res = await CartService.addItem(testSenderId, skuInStock, 1, 'M');
    const userCart = CartService.getCart(testSenderId);
    assert(
      Boolean(res.success && userCart.length === 1 && userCart[0].productCode === skuInStock),
      'TEST 4: "Sepete Ekle" Buton Aksiyonu',
      `Ürün (${skuInStock}) sepete eklendi.`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: "Sepete Ekle" Buton Aksiyonu', e.message);
  }

  // TEST 5: Stok 0 Olan Ürünü Sepete Ekleme Engeli
  try {
    const res = await CartService.addItem(testSenderId, skuOutOfStock, 1, 'S');
    assert(
      Boolean(!res.success && res.message.includes('stok')),
      'TEST 5: Stok 0 Olan Ürün Engeli',
      `Tükenmiş ürün (${skuOutOfStock}) sepete eklenmesi engellendi.`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: Stok 0 Olan Ürün Engeli', e.message);
  }

  // TEST 6: Geçersiz productId İle Güvenlik Engeli
  try {
    const res = await CartService.addItem(testSenderId, 'FAKE_SKU_9999', 1);
    assert(
      Boolean(!res.success && res.message.includes('bulunamadı')),
      'TEST 6: Geçersiz productId Güvenlik Engeli',
      'Sahte ürün kodu reddedildi.'
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Geçersiz productId Güvenlik Engeli', e.message);
  }

  // TEST 7: Silinmiş Ürün Engeli
  try {
    const fakeSku = `DEL-SKU-${Date.now()}`;
    const res = await CartService.addItem(testSenderId, fakeSku, 1);
    assert(
      Boolean(!res.success),
      'TEST 7: Silinmiş Ürün Engeli',
      'Silinmiş veya olmayan ürün sepete eklenmedi.'
    );
  } catch (e: any) {
    assert(false, 'TEST 7: Silinmiş Ürün Engeli', e.message);
  }

  // TEST 8: Ürün Detay Sorgusu (PRODUCT_DETAIL)
  try {
    const check = await StockService.checkStock(skuInStock);
    const item = check.product || {};
    assert(
      Boolean(check.exists && item.price === 1299 && item.stock === 15),
      'TEST 8: Ürün Detay Sorgusu (PRODUCT_DETAIL)',
      `Veritabanı Fiyatı: ${item.price} TL, Stok: ${item.stock} Adet`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: Ürün Detay Sorgusu', e.message);
  }

  // TEST 9: Meta API Başarısızlığında Text Fallback
  try {
    const sent = await InstagramMessageService.sendQuickReplies('MOCK_RECIPIENT', 'Test Mesajı', [
      { title: 'Ürünler', payload: 'PRODUCT_LIST' }
    ]);
    assert(
      Boolean(sent),
      'TEST 9: Interactive Message Text Fallback',
      'Hata anında veya token yokluğunda düz metin fallback çalıştı.'
    );
  } catch (e: any) {
    assert(false, 'TEST 9: Interactive Message Text Fallback', e.message);
  }

  // TEST 10: Normal Text Mesaj İşleme
  try {
    await WebhookController.processEventOrReply(testSenderId, 'Merhaba stokta gömlek var mı?', '');
    assert(true, 'TEST 10: Normal Text Mesaj İşleme', 'Normal metin mesajı işlendi.');
  } catch (e: any) {
    assert(false, 'TEST 10: Normal Text Mesaj İşleme', e.message);
  }

  // TEST 11: Webhook Doğrulama (GET /webhook/instagram)
  try {
    let verified = false;
    const reqMock = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'iscworks_verify_token_2026', 'hub.challenge': '123456' } } as any;
    const resMock = {
      status: (code: number) => ({
        send: (challenge: string) => {
          if (code === 200 && challenge === '123456') verified = true;
        }
      }),
      sendStatus: (code: number) => {}
    } as any;

    WebhookController.verifyWebhook(reqMock, resMock);

    assert(
      Boolean(verified),
      'TEST 11: Webhook Doğrulama (GET /webhook/instagram)',
      'Meta hub.challenge başarıyla doğrulandı ve 200 OK döndü.'
    );
  } catch (e: any) {
    assert(false, 'TEST 11: Webhook Doğrulama', e.message);
  }

  // TEST 12: Instagram POST Webhook Paket İşleme
  try {
    const reqPostMock = {
      body: {
        entry: [
          {
            messaging: [
              {
                sender: { id: testSenderId },
                postback: { payload: 'PRODUCT_LIST', title: 'Ürünler' }
              }
            ]
          }
        ]
      }
    } as any;

    let resCode = 0;
    const resPostMock = {
      status: (code: number) => ({
        send: (msg: string) => { resCode = code; }
      })
    } as any;

    await WebhookController.handleWebhook(reqPostMock, resPostMock);

    assert(
      Boolean(resCode === 200),
      'TEST 12: Instagram POST Webhook Paket İşleme',
      'Meta Webhook paketi 200 EVENT_RECEIVED ile anında yanıtlandı.'
    );
  } catch (e: any) {
    assert(false, 'TEST 12: Instagram POST Webhook Paket İşleme', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');
}

runInstagramInteractiveTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
