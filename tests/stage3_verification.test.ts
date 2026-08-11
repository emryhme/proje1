import { initDatabase } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { AIService } from '../src/services/ai.service';
import { MessageBufferService, buildConversationKey } from '../src/services/message-buffer.service';
import { WebhookController } from '../src/controllers/webhook.controller';

async function runStage3VerificationSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - AŞAMA 3 (MESSAGE BUFFER & AI DEBOUNCE)');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;
  let aiCallCounter = 0;
  let lastAiPrompt = '';

  const originalProcessMessage = AIService.processMessage;
  AIService.processMessage = async (senderId: string, text: string) => {
    aiCallCounter++;
    lastAiPrompt = text;
    console.log(`[AI MOCK COUNTER] AIService.processMessage called! Total calls: ${aiCallCounter}, Text: "${text.replace(/\n/g, ' \\n ')}"`);
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

  const resetAiCounter = () => {
    aiCallCounter = 0;
    lastAiPrompt = '';
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // ----------------------------------------------------
  // TEST 1: Tek Mesaj ("Merhaba" -> 1 buffer, 1 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u1 = `S3_U1_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u1);
    MessageBufferService.clear(key);

    MessageBufferService.addMessage('default', 'instagram', u1, 'Merhaba', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 1 && lastAiPrompt === 'Merhaba',
      'TEST 1: Tek Mesaj (1500ms Debounce)',
      `AI Calls=${aiCallCounter}, Prompt="${lastAiPrompt}"`
    );
  } catch (e: any) {
    assert(false, 'TEST 1: Tek Mesaj', e.message);
  }

  // ----------------------------------------------------
  // TEST 2: İki Hızlı Mesaj (within 1500ms -> 2 buffered, 1 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u2 = `S3_U2_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u2);
    MessageBufferService.clear(key);

    MessageBufferService.addMessage('default', 'instagram', u2, 'Merhaba', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(400);

    MessageBufferService.addMessage('default', 'instagram', u2, 'Ürün bakıyorum', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 1 && lastAiPrompt === 'Merhaba\nÜrün bakıyorum',
      'TEST 2: İki Hızlı Mesaj (1500ms Debounce)',
      `AI Calls=${aiCallCounter}, Prompt="${lastAiPrompt.replace(/\n/g, ' \\n ')}"`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: İki Hızlı Mesaj', e.message);
  }

  // ----------------------------------------------------
  // TEST 3: Üç Hızlı Mesaj ("Merhaba", "Elbise istiyorum", "M beden var mı?" -> 1 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u3 = `S3_U3_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u3);
    MessageBufferService.clear(key);

    MessageBufferService.addMessage('default', 'instagram', u3, 'Merhaba', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });
    MessageBufferService.addMessage('default', 'instagram', u3, 'Elbise istiyorum', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });
    MessageBufferService.addMessage('default', 'instagram', u3, 'M beden var mı?', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 1 && lastAiPrompt === 'Merhaba\nElbise istiyorum\nM beden var mı?',
      'TEST 3: Üç Hızlı Mesaj Birleştirme (3 message -> 1 AI call)',
      `AI Calls=${aiCallCounter}, Combined="${lastAiPrompt.replace(/\n/g, ' \\n ')}"`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: Üç Hızlı Mesaj', e.message);
  }

  // ----------------------------------------------------
  // TEST 4: Timer Reset (t=0 A, t=800 B, t=1600 C -> flush at t=3100)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u4 = `S3_U4_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u4);
    MessageBufferService.clear(key);

    MessageBufferService.addMessage('default', 'instagram', u4, 'Mesaj A', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(800);
    assert(aiCallCounter === 0, 'TEST 4a: t=800ms Henüz flush olmadı');

    MessageBufferService.addMessage('default', 'instagram', u4, 'Mesaj B', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(800);
    assert(aiCallCounter === 0, 'TEST 4b: t=1600ms Timer resetlendi, henüz flush olmadı');

    MessageBufferService.addMessage('default', 'instagram', u4, 'Mesaj C', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 1 && lastAiPrompt === 'Mesaj A\nMesaj B\nMesaj C',
      'TEST 4: Timer Reset & Flush (1 AI Call)',
      `AI Calls=${aiCallCounter}, Prompt="${lastAiPrompt.replace(/\n/g, ' \\n ')}"`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: Timer Reset', e.message);
  }

  // ----------------------------------------------------
  // TEST 5: İki Farklı Sender (sender_A, sender_B -> 2 separate buffers, 2 AI calls)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const userA = `S3_USER_A_MOCK_${Date.now()}`;
    const userB = `S3_USER_B_MOCK_${Date.now()}`;

    MessageBufferService.addMessage('default', 'instagram', userA, 'User A Mesajı', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });
    MessageBufferService.addMessage('default', 'instagram', userB, 'User B Mesajı', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 2,
      'TEST 5: İki Farklı Sender İzolasyonu',
      `2 ayrı sender için AI Calls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: İki Farklı Sender', e.message);
  }

  // ----------------------------------------------------
  // TEST 6: Postback Bypass (SELECT_SIZE:M -> 0 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u6 = `S3_U6_MOCK_${Date.now()}`;
    await WebhookController.processEventOrReply(u6, 'M', 'SELECT_SIZE:STG1:M');

    assert(
      aiCallCounter === 0,
      'TEST 6: Postback Bypass (SELECT_SIZE)',
      `Postback anında işlendi, AI Calls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Postback Bypass', e.message);
  }

  // ----------------------------------------------------
  // TEST 7: Quick Reply Bypass (PRODUCT_LIST -> 0 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u7 = `S3_U7_MOCK_${Date.now()}`;
    await WebhookController.processEventOrReply(u7, 'Ürünler', 'PRODUCT_LIST');

    assert(
      aiCallCounter === 0,
      'TEST 7: Quick Reply Bypass (PRODUCT_LIST)',
      `Katalog anında işlendi, AI Calls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 7: Quick Reply Bypass', e.message);
  }

  // ----------------------------------------------------
  // TEST 8: Duplicate Message Retry (Identical text within 500ms ignored)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u8 = `S3_U8_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u8);
    MessageBufferService.clear(key);

    MessageBufferService.addMessage('default', 'instagram', u8, 'Aynı Mesaj', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });
    // Duplicate retry 10ms later
    MessageBufferService.addMessage('default', 'instagram', u8, 'Aynı Mesaj', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    const buffer = MessageBufferService.getBuffer(key);

    assert(
      buffer.length === 1,
      'TEST 8: Duplicate Message Retry Filtering',
      `Duplicate yoksayıldı, Buffer Size=${buffer.length}`
    );

    await sleep(2000);
  } catch (e: any) {
    assert(false, 'TEST 8: Duplicate Message Retry', e.message);
  }

  // ----------------------------------------------------
  // TEST 9: Empty Text ("   " -> 0 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u9 = `S3_U9_MOCK_${Date.now()}`;
    MessageBufferService.addMessage('default', 'instagram', u9, '   ', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    assert(
      aiCallCounter === 0,
      'TEST 9: Empty Text Filtering',
      `Boş metin yoksayıldı, AI Calls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: Empty Text Filtering', e.message);
  }

  // ----------------------------------------------------
  // TEST 10: Concurrent Messages (Simultaneous text events -> 1 AI call)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u10 = `S3_U10_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u10);
    MessageBufferService.clear(key);

    // Concurrent call simulations
    Promise.all([
      MessageBufferService.addMessage('default', 'instagram', u10, 'Mesaj 1', async (_k, _s, _c, uid, combined) => {
        await WebhookController.processEventOrReply(uid, combined, '');
      }),
      MessageBufferService.addMessage('default', 'instagram', u10, 'Mesaj 2', async (_k, _s, _c, uid, combined) => {
        await WebhookController.processEventOrReply(uid, combined, '');
      })
    ]);

    await sleep(2000);

    assert(
      aiCallCounter === 1,
      'TEST 10: Concurrent Messages Handling',
      `Simultane mesajlar tek buffer'da toplandı, AI Calls=${aiCallCounter}`
    );
  } catch (e: any) {
    assert(false, 'TEST 10: Concurrent Messages', e.message);
  }

  // ----------------------------------------------------
  // TEST 11: Buffer Cleanup After Flush
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u11 = `S3_U11_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u11);

    MessageBufferService.addMessage('default', 'instagram', u11, 'Temizlik Testi', async (_k, _s, _c, uid, combined) => {
      await WebhookController.processEventOrReply(uid, combined, '');
    });

    await sleep(2000);

    const activeKeys = MessageBufferService.getActiveKeys();
    assert(
      !activeKeys.includes(key),
      'TEST 11: Buffer Memory Cleanup',
      `Flush sonrası key silindi: ${!activeKeys.includes(key)}`
    );
  } catch (e: any) {
    assert(false, 'TEST 11: Buffer Memory Cleanup', e.message);
  }

  // ----------------------------------------------------
  // TEST 12: AI Error Handling (Exception thrown -> safety unlock & clean)
  // ----------------------------------------------------
  try {
    resetAiCounter();
    const u12 = `S3_U12_MOCK_${Date.now()}`;
    const key = buildConversationKey('default', 'instagram', u12);

    MessageBufferService.addMessage('default', 'instagram', u12, 'Hata Testi', async () => {
      throw new Error('Simüle edilen AI Zaman Aşımı');
    });

    await sleep(2000);

    const isProcessing = MessageBufferService.isProcessing(key);
    assert(
      !isProcessing,
      'TEST 12: AI Error Safety Unlock',
      `Hata sonrası kilit açıldı, isProcessing=${isProcessing}`
    );
  } catch (e: any) {
    assert(false, 'TEST 12: AI Error Handling', e.message);
  }

  // ----------------------------------------------------
  // PERFORMANCE BENCHMARK TESTS
  // ----------------------------------------------------
  console.log('\n------------------------------------------------------');
  console.log('📈 PERFORMANCE BENCHMARK TESTLERİ:');
  console.log('------------------------------------------------------');

  const benchmarkCases = [1, 3, 5, 10];
  for (const count of benchmarkCases) {
    resetAiCounter();
    const bUser = `BENCH_U_${count}_MOCK_${Date.now()}`;
    for (let i = 1; i <= count; i++) {
      MessageBufferService.addMessage('default', 'instagram', bUser, `Bench mesajı ${i}`, async (_k, _s, _c, uid, combined) => {
        await WebhookController.processEventOrReply(uid, combined, '');
      });
    }
    await sleep(2000);
    assert(
      aiCallCounter === 1,
      `BENCHMARK: ${count} hızlı mesaj`,
      `Gönderilen: ${count} mesaj $\\rightarrow$ AI Calls: ${aiCallCounter}`
    );
  }

  // Restore AIService.processMessage
  AIService.processMessage = originalProcessMessage;

  console.log('\n======================================================');
  console.log(`📊 AŞAMA 3 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStage3VerificationSuite();
