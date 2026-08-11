import { initDatabase } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';
import { OrderService } from '../src/services/order.service';
import { AIService } from '../src/services/ai.service';
import { ConversationStateService } from '../src/services/conversation-state.service';
import { WebhookController } from '../src/controllers/webhook.controller';

async function runStage2VerificationSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - AŞAMA 2 (DETERMINISTIC POSTBACK HANDLING)');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;
  let aiCallCounter = 0;

  // Intercept AIService.processMessage to count AI calls accurately
  const originalProcessMessage = AIService.processMessage;
  AIService.processMessage = async (senderId: string, text: string) => {
    aiCallCounter++;
    console.log(`[AI MOCK COUNTER] AIService.processMessage called! Total calls: ${aiCallCounter}`);
    return {
      reply: 'AI yanıtı simüle edildi.',
      tokens: { promptTokens: 10, completionTokens: 10, totalTokens: 20, costUsd: 0.001 },
      suggestedReplies: []
    };
  };

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

  const testSender = `STAGE2_USER_MOCK_${Date.now()}`;
  const shortCode = 'STG2';
  const validSku = `STG2-M-${Date.now()}`;
  const fakeSku = `FAKE_PRODUCT_${Date.now()}`;

  // Ürün Tohumlama
  await StockService.addProduct({
    shortCode: shortCode,
    productCode: validSku,
    name: 'Aşama 2 Test Elbise',
    color: 'Siyah',
    size: 'M',
    price: 1299,
    costPrice: 500,
    stock: 10,
    category: 'Test'
  });

  const resetAiCounter = () => { aiCallCounter = 0; };

  // ----------------------------------------------------
  // TEST 1: SELECT_SIZE:M (selectedSize=M, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    ConversationStateService.setProductContext(stateKey, { shortCode: shortCode, productCode: validSku, productName: 'Aşama 2 Test Elbise' });

    await WebhookController.processEventOrReply(testSender, 'M', `SELECT_SIZE:${shortCode}:M`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.selectedSize === 'M' && aiCallCounter === 0,
      'TEST 1: SELECT_SIZE:M',
      `selectedSize=${currentState.selectedSize}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 1: SELECT_SIZE:M', e.message);
  }

  // ----------------------------------------------------
  // TEST 2: SELECT_SIZE:INVALID (Reddedilir, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'XXXXL', `SELECT_SIZE:${shortCode}:XXXXL`);
    
    assert(
      aiCallCounter === 0,
      'TEST 2: SELECT_SIZE:INVALID',
      `Reddedildi, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: SELECT_SIZE:INVALID', e.message);
  }

  // ----------------------------------------------------
  // TEST 3: SELECT_COLOR:Siyah (State güncellenir, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    await WebhookController.processEventOrReply(testSender, 'Siyah', `SELECT_COLOR:${shortCode}:Siyah`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.selectedColor === 'SIYAH' && aiCallCounter === 0,
      'TEST 3: SELECT_COLOR:Siyah',
      `selectedColor=${currentState.selectedColor}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: SELECT_COLOR:Siyah', e.message);
  }

  // ----------------------------------------------------
  // TEST 4: SELECT_QUANTITY:2 (quantity=2, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    await WebhookController.processEventOrReply(testSender, '2', `SELECT_QUANTITY:${shortCode}:M:2`);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.selectedQuantity === 2 && aiCallCounter === 0,
      'TEST 4: SELECT_QUANTITY:2',
      `selectedQuantity=${currentState.selectedQuantity}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: SELECT_QUANTITY:2', e.message);
  }

  // ----------------------------------------------------
  // TEST 5: SELECT_QUANTITY:999 (Stok yetersiz, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, '999', `SELECT_QUANTITY:${shortCode}:M:999`);

    assert(
      aiCallCounter === 0,
      'TEST 5: SELECT_QUANTITY:999 (Stok Yetersiz)',
      `Stok aşımı reddedildi, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: SELECT_QUANTITY:999', e.message);
  }

  // ----------------------------------------------------
  // TEST 6: ADD_TO_CART:valid_product (Sepete eklenir, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    CartService.clearCart(testSender);
    await WebhookController.processEventOrReply(testSender, 'Sepete Ekle', `ADD_TO_CART:${validSku}`);
    const cart = CartService.getCart(testSender);

    assert(
      cart.length === 1 && cart[0].productCode === validSku && aiCallCounter === 0,
      'TEST 6: ADD_TO_CART:valid_product',
      `Cart items: ${cart.length}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: ADD_TO_CART:valid_product', e.message);
  }

  // ----------------------------------------------------
  // TEST 7: ADD_TO_CART:fake_product (Reddedilir, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Sepete Ekle', `ADD_TO_CART:${fakeSku}`);

    assert(
      aiCallCounter === 0,
      'TEST 7: ADD_TO_CART:fake_product',
      `Sahte ürün reddedildi, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 7: ADD_TO_CART:fake_product', e.message);
  }

  // ----------------------------------------------------
  // TEST 8: PRODUCT_DETAIL:valid_product (Ürün detayları döner, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Detay', `PRODUCT_DETAIL:${validSku}`);

    assert(
      aiCallCounter === 0,
      'TEST 8: PRODUCT_DETAIL:valid_product',
      `Ürün detay döner, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: PRODUCT_DETAIL:valid_product', e.message);
  }

  // ----------------------------------------------------
  // TEST 9: PRODUCT_LIST (Ürün listesi döner, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Ürünler', 'PRODUCT_LIST');

    assert(
      aiCallCounter === 0,
      'TEST 9: PRODUCT_LIST',
      `Katalog döner, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: PRODUCT_LIST', e.message);
  }

  // ----------------------------------------------------
  // TEST 10: MY_CART (Sepet döner, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Sepetim', 'MY_CART');

    assert(
      aiCallCounter === 0,
      'TEST 10: MY_CART',
      `Sepet döner, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 10: MY_CART', e.message);
  }

  // ----------------------------------------------------
  // TEST 11: CHECKOUT_COMPLETE (Sipariş akışı çalışır, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    CartService.clearCart(testSender);
    await CartService.addItem(testSender, validSku, 1, 'M');

    // Populate test customer info for validation
    const ctx = (AIService as any).getSessionContext(testSender);
    ctx.customerName = 'Ahmet Yilmaz';
    ctx.customerPhone = '05321112233';
    ctx.address = 'Kadikoy Istanbul';

    // CHECKOUT_COMPLETE (Alias for CHECKOUT_CONFIRM)
    await WebhookController.processEventOrReply(testSender, 'Tamamla', 'CHECKOUT_COMPLETE');
    const cartAfter = CartService.getCart(testSender);

    assert(
      cartAfter.length === 0 && aiCallCounter === 0,
      'TEST 11: CHECKOUT_COMPLETE (Alias check & Sipariş akışı)',
      `Cart cleared after checkout, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 11: CHECKOUT_COMPLETE', e.message);
  }

  // ----------------------------------------------------
  // TEST 12: CANCEL_CHECKOUT (State resetlenir, aiCalls=0)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Vazgeç', 'CANCEL_CHECKOUT');
    const stateKey = ConversationStateService.buildKey('default', 'instagram', testSender);
    const currentState = ConversationStateService.getState(stateKey);

    assert(
      currentState.state === 'BROWSING' && aiCallCounter === 0,
      'TEST 12: CANCEL_CHECKOUT',
      `State reset: ${currentState.state}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 12: CANCEL_CHECKOUT', e.message);
  }

  // ----------------------------------------------------
  // TEST 13: Normal text ("Merhaba kırmızı elbise arıyorum") -> aiCalls=1
  // ----------------------------------------------------
  try {
    resetAiCounter();
    await WebhookController.processEventOrReply(testSender, 'Merhaba kırmızı elbise arıyorum', '');

    assert(
      aiCallCounter === 1,
      'TEST 13: Normal Text Processing',
      `Doğal dil mesajı AI'a ulaştı. aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 13: Normal Text Processing', e.message);
  }

  // ----------------------------------------------------
  // TEST 14: Duplicate interactive event protection
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const dupUser = `DUP_USER_MOCK_${Date.now()}`;
    await CartService.addItem(dupUser, validSku, 1, 'M');

    // Populate test customer info for validation
    const dupCtx = (AIService as any).getSessionContext(dupUser);
    dupCtx.customerName = 'Mehmet Demir';
    dupCtx.customerPhone = '05332223344';
    dupCtx.address = 'Besiktas Istanbul';

    // First click
    await WebhookController.processEventOrReply(dupUser, 'Tamamla', 'CHECKOUT_CONFIRM');
    const orderCount1 = (await OrderService.getOrders()).filter(o => o.senderId === dupUser).length;

    // Immediate second click (duplicate within 1500ms)
    await WebhookController.processEventOrReply(dupUser, 'Tamamla', 'CHECKOUT_CONFIRM');
    const orderCount2 = (await OrderService.getOrders()).filter(o => o.senderId === dupUser).length;

    assert(
      orderCount1 === 1 && orderCount2 === 1 && aiCallCounter === 0,
      'TEST 14: Duplicate Interactive Event Protection',
      `Önceki sipariş sayısı: ${orderCount1}, Duplicate sonrası: ${orderCount2}, aiCalls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 14: Duplicate Interactive Event Protection', e.message);
  }

  // AIService'i orijinal haline geri yükle
  AIService.processMessage = originalProcessMessage;

  console.log('\n======================================================');
  console.log(`📊 AŞAMA 2 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStage2VerificationSuite();
