"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const ai_service_1 = require("../services/ai.service");
const db_1 = require("../database/db");
const env_1 = require("../config/env");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * iscworks bot - AI-to-AI Otonom Debug & Deney Laboratuvarı
 */
// 1. Müşteri Simülatörü Ajanı (Customer AI)
const customerModel = new openai_1.ChatOpenAI({
    openAIApiKey: env_1.env.openaiApiKey,
    modelName: 'gpt-4o-mini',
    temperature: 0.8
});
// 2. Denetçi ve Hata Tespit Ajanı (Auditor / Debugger AI)
const debuggerModel = new openai_1.ChatOpenAI({
    openAIApiKey: env_1.env.openaiApiKey,
    modelName: 'gpt-4o',
    temperature: 0.2
});
async function runAiToAiDebugSession(scenarioName, numTurns = 4) {
    console.log(`\n====================================================================`);
    console.log(` 🔬 LAB DENEYİ BAŞLATILDI: "${scenarioName}"`);
    console.log(`====================================================================\n`);
    const mockSenderId = `LAB_USER_${Math.floor(Math.random() * 89999 + 10000)}`;
    const conversationHistory = [];
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
            new messages_1.SystemMessage(customerSystemPrompt),
            ...conversationHistory.map(h => h.speaker === 'CUSTOMER_AI'
                ? new messages_1.HumanMessage(h.text)
                : new messages_1.SystemMessage(`Bot Yanıtı: ${h.text}`)),
            new messages_1.HumanMessage(`Bot sana şunu söyledi: "${lastBotReply}". Buna uygun olarak bir sonraki Instagram DM mesajını tek cümle olarak yaz.`)
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
        const botResult = await ai_service_1.AIService.processMessage(mockSenderId, customerText);
        lastBotReply = botResult.reply;
        // Güncel DB Durumu
        const currentOrders = db_1.db.prepare('SELECT * FROM orders WHERE sender_id = ?').all(mockSenderId);
        const currentStocks = db_1.db.prepare('SELECT product_code, short_code, name, size, stock FROM products LIMIT 5').all();
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
        new messages_1.SystemMessage("Sen profesyonel e-ticaret chatbot denetçi ve debug ajansın."),
        new messages_1.HumanMessage(debugPrompt)
    ]);
    const auditReportText = auditRes.content.toString();
    console.log(`\n====================================================================`);
    console.log(` 📋 F.R.I.D.A.Y. DEBUGGER RAPORU (${scenarioName})`);
    console.log(`====================================================================`);
    console.log(auditReportText);
    // Raporu Dosyaya Kaydet
    const reportPath = path_1.default.join(process.cwd(), `debug-report-${Date.now()}.md`);
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
    fs_1.default.writeFileSync(reportPath, reportMarkdown, 'utf-8');
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
