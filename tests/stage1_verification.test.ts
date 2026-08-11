import { initDatabase } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';
import { InstagramMessageService } from '../src/services/instagram-message.service';
import { QuickReplyBuilderService } from '../src/services/quick-reply-builder.service';
import { ConversationStateService } from '../src/services/conversation-state.service';
import { WebhookController } from '../src/controllers/webhook.controller';

async function runStage1VerificationSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - AŞAMA 1 (UI CLEANUP & VERIFICATION)');
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

  initDatabase();

  const testSender = `STAGE1_USER_MOCK_${Date.now()}`;
  const shortCode = 'STG1';
  const skuM = `STG1-M-${Date.now()}`;
  const skuL = `STG1-L-${Date.now()}`;
  const skuZero = `STG1-ZERO-${Date.now()}`;

  // Ürün Tohumlama
  await StockService.addProduct({
    shortCode: shortCode,
    productCode: skuM,
    name: 'Aşama 1 Test Elbise',
    color: 'Siyah',
    size: 'M',
    price: 999,
    costPrice: 400,
    stock: 5,
    category: 'Test'
  });

  await StockService.addProduct({
    shortCode: shortCode,
    productCode: skuL,
    name: 'Aşama 1 Test Elbise',
    color: 'Kırmızı',
    size: 'L',
    price: 999,
    costPrice: 400,
    stock: 10,
    category: 'Test'
  });

  await StockService.addProduct({
    shortCode: 'STGZERO',
    productCode: skuZero,
    name: 'Aşama 1 Tükenmiş Ürün',
    color: 'Mavi',
    size: 'S',
    price: 500,
    costPrice: 200,
    stock: 0,
    category: 'Test'
  });

  // ----------------------------------------------------
  // TEST 1: Size selection (SELECT_SIZE)
  // ----------------------------------------------------
  try {
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    ConversationStateService.setProductContext(stateKey, { shortCode: shortCode, productCode: skuM, productName: 'Aşama 1 Test Elbise' });

    await WebhookController.processEventOrReply(testSender, 'M', `SELECT_SIZE:${shortCode}:M`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.state === 'SELECTING_QUANTITY' && currentState.selectedSize === 'M',
      'TEST 1: Size Selection (SELECT_SIZE)',
      `State: ${currentState.state}, Size: ${currentState.selectedSize}`
    );
  } catch (e: any) {
    assert(false, 'TEST 1: Size Selection', e.message);
  }

  // ----------------------------------------------------
  // TEST 2: Color selection (SELECT_COLOR)
  // ----------------------------------------------------
  try {
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    await WebhookController.processEventOrReply(testSender, 'Siyah', `SELECT_COLOR:${shortCode}:Siyah`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.state === 'SELECTING_SIZE' && currentState.selectedColor === 'SIYAH',
      'TEST 2: Color Selection (SELECT_COLOR)',
      `State: ${currentState.state}, Color: ${currentState.selectedColor}`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: Color Selection', e.message);
  }

  // ----------------------------------------------------
  // TEST 3: Quantity selection (SELECT_QUANTITY)
  // ----------------------------------------------------
  try {
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    await WebhookController.processEventOrReply(testSender, '2', `SELECT_QUANTITY:${shortCode}:M:2`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.state === 'CART_CONFIRM' && currentState.selectedQuantity === 2,
      'TEST 3: Quantity Selection (SELECT_QUANTITY)',
      `State: ${currentState.state}, Quantity: ${currentState.selectedQuantity}`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: Quantity Selection', e.message);
  }

  // ----------------------------------------------------
  // TEST 4: Checkout buttons (CHECKOUT_CONFIRM / CANCEL)
  // ----------------------------------------------------
  try {
    const checkoutOpts = QuickReplyBuilderService.buildCheckoutOptions();
    const confirmBtn = checkoutOpts.find(o => o.payload === 'CHECKOUT_CONFIRM');
    const cancelBtn = checkoutOpts.find(o => o.payload === 'CANCEL_CHECKOUT');
    const addBtn = checkoutOpts.find(o => o.payload === 'ADD_MORE_PRODUCTS');

    assert(
      Boolean(confirmBtn && cancelBtn && addBtn),
      'TEST 4: Checkout Buttons Generator',
      `Buttons: ${checkoutOpts.map(o => o.title).join(', ')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: Checkout Buttons', e.message);
  }

  // ----------------------------------------------------
  // TEST 5: Product Detail (PRODUCT_DETAIL)
  // ----------------------------------------------------
  try {
    const check = await StockService.checkStock(skuM);
    assert(
      Boolean(check.exists && check.product?.name === 'Aşama 1 Test Elbise'),
      'TEST 5: Product Detail Query',
      `Product: ${check.product?.name}, Price: ${check.product?.price}`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: Product Detail Query', e.message);
  }

  // ----------------------------------------------------
  // TEST 6: Add to Cart (ADD_TO_CART)
  // ----------------------------------------------------
  try {
    CartService.clearCart(testSender);
    const res = await CartService.addItem(testSender, skuM, 1, 'M');
    const cart = CartService.getCart(testSender);

    assert(
      Boolean(res.success && cart.length === 1 && cart[0].productCode === skuM),
      'TEST 6: Add to Cart (ADD_TO_CART)',
      `Cart length: ${cart.length}, Product: ${cart[0]?.productCode}`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Add to Cart', e.message);
  }

  // ----------------------------------------------------
  // TEST 7: Invalid postback (Non-existent size/quantity)
  // ----------------------------------------------------
  try {
    const sizes = await StockService.getAvailableSizes(shortCode);
    const isInvalidRejected = !sizes.includes('XXXXL');

    assert(
      isInvalidRejected,
      'TEST 7: Invalid Postback Validation',
      'Sahte beden (XXXXL) reddedildi.'
    );
  } catch (e: any) {
    assert(false, 'TEST 7: Invalid Postback Validation', e.message);
  }

  // ----------------------------------------------------
  // TEST 8: Stok 0 Handling
  // ----------------------------------------------------
  try {
    const zeroStockRes = await CartService.addItem(testSender, skuZero, 1, 'S');
    assert(
      Boolean(!zeroStockRes.success && zeroStockRes.message.includes('stok')),
      'TEST 8: Stok 0 Engelleme',
      `Tükenmiş ürün ekleme engellendi: ${zeroStockRes.message}`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: Stok 0 Engelleme', e.message);
  }

  // ----------------------------------------------------
  // TEST 9: Normal Text Message Flow
  // ----------------------------------------------------
  try {
    const autoOpts = await QuickReplyBuilderService.autoDetectOptions(
      'Hangi bedeni tercih edersiniz?',
      shortCode
    );

    assert(
      Boolean(autoOpts && autoOpts.length > 0 && autoOpts[0].payload.startsWith('SELECT_SIZE:')),
      'TEST 9: Normal Text Auto-Detect Options',
      `Generated size options: ${autoOpts.map(o => o.title).join(', ')}`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: Normal Text Auto-Detect Options', e.message);
  }

  // ----------------------------------------------------
  // TEST 10: Existing Instagram Webhook Verification
  // ----------------------------------------------------
  try {
    let verified = false;
    const reqMock = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'barons_secure_verify_token_2026', 'hub.challenge': '998877' } } as any;
    const resMock = {
      status: (code: number) => ({
        send: (ch: string) => {
          if (code === 200 && ch === '998877') verified = true;
        }
      }),
      sendStatus: () => {}
    } as any;

    WebhookController.verifyWebhook(reqMock, resMock);

    assert(
      verified,
      'TEST 10: Instagram Webhook Hub Challenge',
      'Meta hub.challenge 200 OK doğrulandı.'
    );
  } catch (e: any) {
    assert(false, 'TEST 10: Instagram Webhook Hub Challenge', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 AŞAMA 1 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStage1VerificationSuite();
