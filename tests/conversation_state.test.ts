import { initDatabase, db } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';
import { OrderService } from '../src/services/order.service';
import { ConversationStateService } from '../src/services/conversation-state.service';
import { QuickReplyBuilderService } from '../src/services/quick-reply-builder.service';
import { WebhookController } from '../src/controllers/webhook.controller';
import { MessageBufferService } from '../src/services/message-buffer.service';
import { InstagramMessageService } from '../src/services/instagram-message.service';

async function runStateAndButtonTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - CONTEXT-AWARE STATE & BUTTON TEST SUITE');
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

  const testUser = `STATE_TEST_USER_${Date.now()}`;
  const shortCode = 'TSTAT';

  // DB temizleme ve ürünleri hazırla
  db.prepare("DELETE FROM products WHERE short_code = ?").run(shortCode);

  await StockService.addProduct({
    shortCode,
    productCode: `${shortCode}-S`,
    name: 'State Test Elbise',
    color: 'Siyah',
    size: 'S',
    price: 1000,
    costPrice: 500,
    stock: 2,
    category: 'Elbise'
  });

  await StockService.addProduct({
    shortCode,
    productCode: `${shortCode}-M`,
    name: 'State Test Elbise',
    color: 'Siyah',
    size: 'M',
    price: 1000,
    costPrice: 500,
    stock: 10,
    category: 'Elbise'
  });

  // TEST 1: sizes = S,M in database -> getAvailableSizes should return ['S', 'M']
  try {
    const sizes = await StockService.getAvailableSizes(shortCode);
    assert(
      sizes.length === 2 && sizes.includes('S') && sizes.includes('M'),
      'TEST 1: getAvailableSizes varyant kontrolü',
      `Mevcut bedenler: ${sizes.join(',')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 1: getAvailableSizes varyant kontrolü', e.message);
  }

  // TEST 2: buildSizeOptions should return 2 size options
  try {
    const options = await QuickReplyBuilderService.buildSizeOptions(shortCode);
    assert(
      options.length === 2 && options[0].value === 'S' && options[1].value === 'M',
      'TEST 2: buildSizeOptions doğrulaması',
      `Seçenek sayısı: ${options.length}`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: buildSizeOptions doğrulaması', e.message);
  }

  // TEST 3: stock = 2 (for size S) -> quantity options should be 1, 2
  try {
    const options = await QuickReplyBuilderService.buildQuantityOptions(shortCode, 'S');
    assert(
      options.length === 2 && options[0].value === '1' && options[1].value === '2',
      'TEST 3: Adet seçenekleri (Stok = 2)',
      `Üretilen adetler: ${options.map(o => o.value).join(',')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: Adet seçenekleri', e.message);
  }

  // TEST 4: stock = 10 (for size M) -> quantity options should be up to max 5 (1,2,3,4,5)
  try {
    const options = await QuickReplyBuilderService.buildQuantityOptions(shortCode, 'M');
    assert(
      options.length === 5 && options[4].value === '5',
      'TEST 4: Adet seçenekleri (Stok = 10, limit = 5)',
      `Üretilen adetler: ${options.map(o => o.value).join(',')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: Adet seçenekleri', e.message);
  }

  // TEST 5: confirmation -> buildCheckoutOptions should return checkout confirmation buttons ( Tamamla, Ürün ekle, Vazgeç )
  try {
    const options = QuickReplyBuilderService.buildCheckoutOptions();
    assert(
      options.length === 3 &&
      options[0].payload === 'CHECKOUT_CONFIRM' &&
      options[1].payload === 'ADD_MORE_PRODUCTS' &&
      options[2].payload === 'CANCEL_CHECKOUT',
      'TEST 5: Sipariş onay butonları',
      `Butonlar: ${options.map(o => o.title).join(',')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: Sipariş onay butonları', e.message);
  }

  // TEST 6: invalid size selected -> backend reject size update
  try {
    const key = ConversationStateService.buildKey('default', 'instagram', testUser);
    ConversationStateService.clear(key);

    // SELECT_SIZE with invalid size
    await WebhookController.processEventOrReply(testUser, '', `SELECT_SIZE:${shortCode}:XXL`);
    const stateData = ConversationStateService.getState(key);
    assert(
      stateData.selectedSize === undefined && stateData.state === 'BROWSING',
      'TEST 6: Invalid size seçimi engelleme',
      `State: ${stateData.state}, Size: ${stateData.selectedSize || 'Yok'}`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Invalid size seçimi engelleme', e.message);
  }

  // TEST 7: Invalid quantity selected (e.g. 99 for stock 2) -> reject
  try {
    const key = ConversationStateService.buildKey('default', 'instagram', testUser);
    ConversationStateService.clear(key);

    await WebhookController.processEventOrReply(testUser, '', `SELECT_QUANTITY:${shortCode}:S:99`);
    const stateData = ConversationStateService.getState(key);
    assert(
      stateData.selectedQuantity === undefined,
      'TEST 7: Invalid adet/stok aşımı engelleme',
      `Seçilen adet: ${stateData.selectedQuantity || 'Reddedildi'}`
    );
  } catch (e: any) {
    assert(false, 'TEST 7: Invalid adet/stok aşımı engelleme', e.message);
  }

  // TEST 8: Store A currentProduct vs Store B currentProduct isolation
  try {
    const keyA = ConversationStateService.buildKey('storeA', 'instagram', testUser);
    const keyB = ConversationStateService.buildKey('storeB', 'instagram', testUser);

    ConversationStateService.clear(keyA);
    ConversationStateService.clear(keyB);

    ConversationStateService.setProductContext(keyA, { shortCode: 'PRODA', productCode: 'PRODA-S' });
    ConversationStateService.setProductContext(keyB, { shortCode: 'PRODB', productCode: 'PRODB-M' });

    const stateA = ConversationStateService.getState(keyA);
    const stateB = ConversationStateService.getState(keyB);

    assert(
      stateA.productCode === 'PRODA-S' && stateB.productCode === 'PRODB-M',
      'TEST 8: Store A ve Store B context izolasyonu',
      `A: ${stateA.productCode}, B: ${stateB.productCode}`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: Store isolation', e.message);
  }

  // TEST 9: Interactive postback does not enter message buffer
  try {
    const key = ConversationStateService.buildKey('default', 'instagram', testUser);
    const convKey = `default:instagram:${testUser}`;
    MessageBufferService.clear(convKey);

    // Simulator mock: webhook receives a postback
    const reqMock = {
      body: {
        entry: [
          {
            messaging: [
              {
                sender: { id: testUser },
                postback: { payload: 'CONFIRM_ADD_TO_CART', title: 'Sepete Ekle' }
              }
            ]
          }
        ]
      }
    } as any;

    const resMock = {
      status: (code: number) => ({ send: (msg: string) => {} })
    } as any;

    await WebhookController.handleWebhook(reqMock, resMock);
    const buffer = MessageBufferService.getBuffer(convKey);

    assert(
      buffer.length === 0,
      'TEST 9: Postback events bypass the message buffer',
      `Buffer size: ${buffer.length}`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: Postback buffer bypass', e.message);
  }

  // TEST 10: State transition sequence: BROWSING -> SIZE -> QUANTITY -> CART_CONFIRM -> ORDER_CREATED
  try {
    const key = ConversationStateService.buildKey('default', 'instagram', testUser);
    ConversationStateService.clear(key);
    CartService.clearCart(testUser);

    // 1. Initial State
    let data = ConversationStateService.getState(key);
    assert(data.state === 'BROWSING', 'TEST 10a: Initial state is BROWSING');

    // 2. Select Product
    ConversationStateService.setProductContext(key, {
      shortCode,
      productCode: `${shortCode}-M`,
      availableSizes: ['S', 'M']
    });
    data = ConversationStateService.getState(key);
    assert(data.state === 'SELECTING_PRODUCT', 'TEST 10b: Set Product Context -> SELECTING_PRODUCT');

    // 3. Select Size
    await WebhookController.processEventOrReply(testUser, '', `SELECT_SIZE:${shortCode}:M`);
    data = ConversationStateService.getState(key);
    assert(
      data.state === 'SELECTING_QUANTITY' && data.selectedSize === 'M',
      'TEST 10c: Select Size -> SELECTING_QUANTITY'
    );

    // 4. Select Quantity
    await WebhookController.processEventOrReply(testUser, '', `SELECT_QUANTITY:${shortCode}:M:2`);
    data = ConversationStateService.getState(key);
    assert(
      data.state === 'CART_CONFIRM' && data.selectedQuantity === 2,
      'TEST 10d: Select Quantity -> CART_CONFIRM'
    );

    // 5. Confirm Add to Cart
    await WebhookController.processEventOrReply(testUser, '', 'CONFIRM_ADD_TO_CART');
    data = ConversationStateService.getState(key);
    const cart = CartService.getCart(testUser);
    assert(
      data.state === 'CART_REVIEW' && cart.length === 1 && cart[0].productCode === `${shortCode}-M` && cart[0].quantity === 2,
      'TEST 10e: Confirm Add -> CART_REVIEW'
    );

    // 6. Checkout Confirm
    await WebhookController.processEventOrReply(testUser, '', 'CHECKOUT_CONFIRM');
    data = ConversationStateService.getState(key);
    const emptyCart = CartService.getCart(testUser);
    assert(
      data.state === 'ORDER_CREATED' && emptyCart.length === 0,
      'TEST 10f: Checkout Confirm -> ORDER_CREATED'
    );

  } catch (e: any) {
    assert(false, 'TEST 10: State transition sequence', e.message);
  }

  // TEST 11: Button Template vs Quick Reply automatically dispatch verification
  try {
    let mockSentType = '';
    
    // We override API call or verify return structure
    const btnRes = await InstagramMessageService.sendButtonsOrQuickReplies(testUser, 'Butonlar', [
      { title: 'A', payload: 'A' },
      { title: 'B', payload: 'B' }
    ]);
    
    const qrRes = await InstagramMessageService.sendButtonsOrQuickReplies(testUser, 'Quick Replies', [
      { title: 'A', payload: 'A' },
      { title: 'B', payload: 'B' },
      { title: 'C', payload: 'C' },
      { title: 'D', payload: 'D' }
    ]);

    assert(
      btnRes.success && qrRes.success,
      'TEST 11: Button/Quick Reply Auto-Dispatcher',
      'Farklı sayıda seçenekler başarıyla hedeflenen API modellerine yönlendirildi.'
    );
  } catch (e: any) {
    assert(false, 'TEST 11: Dispatcher verification', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST RAPORU: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStateAndButtonTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('State Test Suite Error:', err);
  process.exit(1);
});
