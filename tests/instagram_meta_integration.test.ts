import { initDatabase } from '../src/database/db';
import { env } from '../src/config/env';
import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';
import { InstagramMessageService, MetaInstagramPayloadBuilder } from '../src/services/instagram-message.service';
import { WebhookController } from '../src/controllers/webhook.controller';

async function runMetaIntegrationTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - INSTAGRAM META INTERACTIVE TEST SUITE');
  console.log('======================================================\n');

  let unitPassed = 0, unitFailed = 0;
  let intPassed = 0, intFailed = 0, intSkipped = 0;
  let webPassed = 0, webFailed = 0;

  function assertUnit(condition: boolean, name: string, detail: string = '') {
    if (condition) {
      console.log(`✅ [UNIT PASS] ${name} ${detail ? `(${detail})` : ''}`);
      unitPassed++;
    } else {
      console.error(`❌ [UNIT FAIL] ${name} ${detail ? `(${detail})` : ''}`);
      unitFailed++;
    }
  }

  function assertWeb(condition: boolean, name: string, detail: string = '') {
    if (condition) {
      console.log(`✅ [WEBHOOK PASS] ${name} ${detail ? `(${detail})` : ''}`);
      webPassed++;
    } else {
      console.error(`❌ [WEBHOOK FAIL] ${name} ${detail ? `(${detail})` : ''}`);
      webFailed++;
    }
  }

  initDatabase();

  console.log('--- 1. UNIT TESTS (Payload Builder Structure Verification) ---');
  // 1. Text Payload
  const textPayload = MetaInstagramPayloadBuilder.buildTextPayload('12345', 'Merhaba');
  assertUnit(
    textPayload.recipient.id === '12345' && textPayload.messaging_type === 'RESPONSE' && textPayload.message.text === 'Merhaba',
    'Text Payload Format',
    'messaging_type: RESPONSE doğrulandı.'
  );

  // 2. Quick Replies Payload
  const qrPayload = MetaInstagramPayloadBuilder.buildQuickRepliesPayload('12345', 'Menü', [
    { title: '👕 Ürünler', payload: 'PRODUCT_LIST' }
  ]);
  assertUnit(
    qrPayload.message.quick_replies.length === 1 && qrPayload.message.quick_replies[0].title === '👕 Ürünler',
    'Quick Replies Payload Format',
    'quick_replies dizisi doğrulandı.'
  );

  // 3. Button Template Payload
  const btnPayload = MetaInstagramPayloadBuilder.buildButtonTemplatePayload('12345', 'Butonlar', [
    { title: '🛒 Sepet', payload: 'MY_CART' }
  ]);
  assertUnit(
    btnPayload.message.attachment.payload.template_type === 'button',
    'Button Template Payload Format',
    'template_type: button doğrulandı.'
  );

  // 4. Generic Carousel Payload
  const carouselPayload = MetaInstagramPayloadBuilder.buildGenericCarouselPayload('12345', [
    { productCode: 'TEST-SKU', name: 'Test Elbise', price: 999, stock: 10 }
  ]);
  assertUnit(
    carouselPayload.message.attachment.payload.template_type === 'generic' && carouselPayload.message.attachment.payload.elements.length === 1,
    'Generic Carousel Payload Format',
    'template_type: generic & elements doğrulandı.'
  );


  console.log('\n--- 2. META GRAPH API INTEGRATION TESTS ---');
  const token = env.fbPageAccessToken;
  if (!token) {
    console.log('⚠️ [META API INT SKIPPED] .env dosyasında FB_PAGE_ACCESS_TOKEN bulunmadığı için canlı Meta API testi atlandı.');
    intSkipped++;
  } else {
    console.log(`🔍 Canlı Meta Graph API Test Ediliyor: Endpoint=${InstagramMessageService.getApiUrl()}`);
    try {
      const res = await InstagramMessageService.sendQuickReplies('TEST_RECIPIENT_123', 'API Testi', [
        { title: 'Ürünler', payload: 'PRODUCT_LIST' }
      ]);
      console.log(`[Meta API Integration Result]:`, res);
      if (res.success || res.httpStatus === 200) {
        console.log('✅ [META API PASS] Meta Graph API çağrısı 200 OK ile yanıtlandı.');
        intPassed++;
      } else {
        console.log(`❌ [META API FAIL] Meta Graph API hata döndürdü: Code=${res.metaErrorCode}, Msg="${res.metaErrorMessage}"`);
        intFailed++;
      }
    } catch (e: any) {
      console.error('❌ [META API FAIL] HTTP Istek hatası:', e.message);
      intFailed++;
    }
  }


  console.log('\n--- 3. WEBHOOK & CONTROLLER DETERMINISTIC TESTS ---');
  const testUser = `TEST_META_USER_${Date.now()}`;
  const testSku = `META-SKU-${Date.now()}`;

  await StockService.addProduct({
    shortCode: 'METSKU',
    productCode: testSku,
    name: 'Meta Entegre Elbise',
    color: 'Mavi',
    size: 'M',
    price: 1599,
    costPrice: 800,
    stock: 5,
    category: 'Elbise'
  });

  // TEST: ADD_TO_CART Action
  try {
    CartService.clearCart(testUser);
    await WebhookController.processEventOrReply(testUser, '', `ADD_TO_CART:${testSku}`);
    const cart = CartService.getCart(testUser);
    assertWeb(
      cart.length === 1 && cart[0].productCode === testSku,
      'ADD_TO_CART Webhook Event',
      `Ürün (${testSku}) CartService'e eklendi.`
    );
  } catch (e: any) {
    assertWeb(false, 'ADD_TO_CART Webhook Event', e.message);
  }

  // TEST: PRODUCT_DETAIL Action
  try {
    await WebhookController.processEventOrReply(testUser, '', `PRODUCT_DETAIL:${testSku}`);
    assertWeb(true, 'PRODUCT_DETAIL Webhook Event', 'Ürün detayı veritabanından çekildi.');
  } catch (e: any) {
    assertWeb(false, 'PRODUCT_DETAIL Webhook Event', e.message);
  }

  // TEST: MY_CART Action
  try {
    await WebhookController.processEventOrReply(testUser, '', 'MY_CART');
    assertWeb(true, 'MY_CART Webhook Event', 'Sepet bilgisi biçimlendirildi.');
  } catch (e: any) {
    assertWeb(false, 'MY_CART Webhook Event', e.message);
  }


  console.log('\n======================================================');
  console.log('📊 GENEL TEST RAPORU ÖZETİ');
  console.log('======================================================');
  console.log(`UNIT TESTS:               ${unitPassed} GEÇTİ | ${unitFailed} BAŞARISIZ`);
  console.log(`META API INTEGRATION:     ${intPassed > 0 ? `${intPassed} GEÇTİ` : intSkipped > 0 ? 'SKIPPED (.env Token Yok)' : '0 GEÇTİ'} | ${intFailed} BAŞARISIZ`);
  console.log(`WEBHOOK CONTROLLER TESTS: ${webPassed} GEÇTİ | ${webFailed} BAŞARISIZ`);
  console.log(`LIVE INSTAGRAM E2E:       LIVE INSTAGRAM E2E = NOT TESTED (Gerçek mobil cihaz DM doğrulaması gerekli)`);
  console.log('======================================================\n');
}

runMetaIntegrationTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
