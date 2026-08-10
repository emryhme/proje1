import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { AIService } from '../services/ai.service';
import { db } from '../database/db';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';

/**
 * iscworks bot - AI-to-AI Otonom Debug & Deney Laboratuvarı
 */

// 1. Müşteri Simülatörü Ajanı (Customer AI)
const customerModel = new ChatOpenAI({
  openAIApiKey: env.openaiApiKey,
  modelName: 'gpt-4o-mini',
  temperature: 0.8
});

// 2. Denetçi ve Hata Tespit Ajanı (Auditor / Debugger AI)
const debuggerModel = new ChatOpenAI({
  openAIApiKey: env.openaiApiKey,
  modelName: 'gpt-4o',
  temperature: 0.2
});

interface ConversationTurn {
  speaker: 'CUSTOMER_AI' | 'BOT_AI';
  text: string;
  timestamp: string;
  dbState?: any;
}

async function runAiToAiDebugSession(scenarioName: string, numTurns: number = 4) {
  console.log(`\n====================================================================`);
  console.log(` 🔬 LAB DENEYİ BAŞLATILDI: "${scenarioName}"`);
  console.log(`====================================================================\n`);

  const mockSenderId = `LAB_USER_${Math.floor(Math.random() * 89999 + 10000)}`;
  const conversationHistory: ConversationTurn[] = [];

  // Müşteri Ajanı Başlangıç Prompt'u
  const customerSystemPrompt = `Sen Instagram'da kıyafet/ayakkabı alışverişi yapan gerçek bir Türk müşterisin.
Senin amacın: BARON'S SILLAGE mağazasından ürün sormak, stok sormak, pazarlık yapmak veya sipariş vermek.
Yazım tarzın: Gerçek insanlar gibi yazım hataları yapabilirsin, kısaltma kullanabilirsin (örn: "sa", "fiyat ne", "KGMLW keten gömlek varmı m beden", "adres kadıköy istanbul tel 05329998877").
Senaryo Amacın: ${scenarioName}`;

  let lastBotReply = "Merhaba! BARON'S SILLAGE müşteri temsilcisiyim. Size nasıl yardımcı olabilirim?";
  conversationHistory.push({
    speaker: 'BOT_AI',
    text: lastBotReply,
    timestamp: new Date().toLocaleTimeString()
  });

  for (let turn = 1; turn <= numTurns; turn++) {
    console.log(`\n--- 🔄 TUR ${turn} / ${numTurns} ---`);

    // 1. Müşteri AI Yanıt Üretir
    const customerMessages = [
      new SystemMessage(customerSystemPrompt),
      ...conversationHistory.map(h => 
        h.speaker === 'CUSTOMER_AI' 
          ? new HumanMessage(h.text)
          : new SystemMessage(`Bot Yanıtı: ${h.text}`)
      ),
      new HumanMessage(`Bot sana şunu söyledi: "${lastBotReply}". Buna uygun olarak bir sonraki Instagram DM mesajını tek cümle olarak yaz.`)
    ];

    const customerRes = await customerModel.invoke(customerMessages);
    const customerText = customerRes.content.toString().trim();

    console.log(`👤 MÜŞTERİ AI: "${customerText}"`);
    conversationHistory.push({
      speaker: 'CUSTOMER_AI',
      text: customerText,
      timestamp: new Date().toLocaleTimeString()
    });

    // 2. F.R.I.D.A.Y. Bot AI Yanıt Verir ve İşlem Yapar
    console.log(`🤖 F.R.I.D.A.Y. AI İşliyor...`);
    const botResult = await AIService.processMessage(mockSenderId, customerText);
    lastBotReply = botResult.reply;

    // Güncel DB Durumu
    const currentOrders = db.prepare('SELECT * FROM orders WHERE sender_id = ?').all(mockSenderId);
    const currentStocks = db.prepare('SELECT product_code, short_code, name, size, stock FROM products LIMIT 5').all();

    console.log(`🤖 F.R.I.D.A.Y. AI: "${lastBotReply}"`);
    console.log(`⚡ Kullanılan Token: ${botResult.tokens.totalTokens} ($${botResult.tokens.costUsd.toFixed(5)})`);

    conversationHistory.push({
      speaker: 'BOT_AI',
      text: lastBotReply,
      timestamp: new Date().toLocaleTimeString(),
      dbState: { orders: currentOrders, stocks: currentStocks }
    });
  }

  // 3. Denetçi / Debugger AI Sohbeti ve Veritabanı Değişimini İnceler
  console.log(`\n🔍 AUDITOR / DEBUGGER AI DENETİMİ BAŞLIYOR...`);

  const debugPrompt = `Sen Kıdemli Yazılım Mimarı ve Yapay Zeka Hata Denetçisisin.
Aşağıda iki Yapay Zekanın (Müşteri AI ve E-Ticaret Bot AI) gerçekleştirdiği canlı test sohbeti ve veritabanı durumları bulunmaktadır.

Sohbet Geçmişi:
${JSON.stringify(conversationHistory, null, 2)}

Lütfen şu kriterlere göre detaylı bir DEBUG RAPORU oluştur:
1. 🎯 Müşteri niyeti doğru anlaşıldı mı?
2. 📦 Stok kontrolü ve SQLite kayıtları doğru yapıldı mı?
3. 📝 Müşteri bilgileri (Ad, Tel, Adres, Beden) eksiksiz çıkarıldı mı?
4. ⚠️ Sistemde fark edilen bir mantık hatası veya zafiyet var mı?
5. 💡 Geliştirici için somut kod düzeltme tavsiyeleri.`;

  const auditRes = await debuggerModel.invoke([
    new SystemMessage("Sen profesyonel e-ticaret chatbot denetçi ve debug ajansın."),
    new HumanMessage(debugPrompt)
  ]);

  const auditReportText = auditRes.content.toString();

  console.log(`\n====================================================================`);
  console.log(` 📋 F.R.I.D.A.Y. DEBUGGER RAPORU (${scenarioName})`);
  console.log(`====================================================================`);
  console.log(auditReportText);

  // Raporu Dosyaya Kaydet
  const reportPath = path.join(process.cwd(), `debug-report-${Date.now()}.md`);
  const reportMarkdown = `# 🔬 F.R.I.D.A.Y. AI-to-AI Otonom Debug Raporu
- **Senaryo:** ${scenarioName}
- **Tarih:** ${new Date().toLocaleString()}
- **Test Kullanıcısı:** ${mockSenderId}

## 💬 Sohbet Akışı
${conversationHistory.map(h => `**[${h.timestamp}] ${h.speaker}:** ${h.text}`).join('\n\n')}

---

## 🔬 Debugger AI Analizi
${auditReportText}
`;

  fs.writeFileSync(reportPath, reportMarkdown, 'utf-8');
  console.log(`\n💾 Detaylı Debug Raporu Kaydedildi: ${reportPath}\n`);
}

// Ana Deney Çalıştırıcı
async function startLabExperiments() {
  console.clear();
  console.log(`
====================================================================
 🧪 iscworks bot - Otonom AI-to-AI Debug & Deney Laboratuvarı
====================================================================
  `);

  // 1. Senaryo: Ürün ve Stok Sorgulayan İnatçı Müşteri
  await runAiToAiDebugSession('İnatçı Müşteri Stok ve Beden Sorgulama Testi', 3);

  // 2. Senaryo: Karmaşık Adres ve Yanlış Yazımla Sipariş Veren Müşteri
  await runAiToAiDebugSession('Hatalı Yazımlı ve Karmaşık Adresli Sipariş Simülasyonu', 3);
}

startLabExperiments().catch(console.error);
