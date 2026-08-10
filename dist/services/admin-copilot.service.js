"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminCopilotService = void 0;
const openai_1 = require("@langchain/openai");
const tools_1 = require("@langchain/core/tools");
const messages_1 = require("@langchain/core/messages");
const env_1 = require("../config/env");
const stock_service_1 = require("./stock.service");
const order_service_1 = require("./order.service");
const db_1 = require("../database/db");
const accounting_service_1 = require("./accounting.service");
/**
 * DEMO STORE - AI Admin & Copilot Management Service
 */
class AdminCopilotService {
    static getApiKey() {
        return (process.env.OPENAI_API_KEY || env_1.env.openaiApiKey || '').trim().replace(/^["']|["']$/g, '');
    }
    static async processAdminCommand(userPrompt) {
        const apiKey = this.getApiKey();
        if (!apiKey || apiKey === 'DUMMY_KEY' || apiKey.length < 10) {
            return "⚠️ Patron, sunucuda geçerli bir OPENAI_API_KEY bulunamadı. Lütfen sunucudaki `.env` dosyanıza `OPENAI_API_KEY=sk-...` anahtarınızı ekleyip `pm2 restart proje1` çalıştırın.";
        }
        // 1. Stok Güncelleme Aracı
        const stokGuncelleTool = new tools_1.DynamicTool({
            name: 'STOK_GUNCELLE',
            description: 'Bir ürünün stok adedini günceller. Parametreler: productCode (string), newStock (number).',
            func: async (inputStr) => {
                try {
                    const { productCode, newStock } = JSON.parse(inputStr);
                    const success = await stock_service_1.StockService.updateStock(productCode, Number(newStock));
                    if (success) {
                        return `✅ ${productCode} stoğu ${newStock} adet olarak güncellendi!`;
                    }
                    else {
                        return `❌ ${productCode} stoğu veritabanında bulunamadı veya güncellenemedi.`;
                    }
                }
                catch (e) {
                    return `❌ Stok güncelleme hatası: ${e.message}`;
                }
            }
        });
        // 2. Fiyat Güncelleme Aracı
        const fiyatGuncelleTool = new tools_1.DynamicTool({
            name: 'FIYAT_GUNCELLE',
            description: 'Bir ürünün satış fiyatını TL olarak günceller. Parametreler: productCode (string), price (number).',
            func: async (inputStr) => {
                try {
                    const { productCode, price } = JSON.parse(inputStr);
                    const numPrice = Number(price);
                    db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ?').run(numPrice, productCode);
                    return `✅ ${productCode} ürününün fiyatı ${numPrice} TL olarak kaydedildi!`;
                }
                catch (e) {
                    return `❌ Fiyat güncelleme hatası: ${e.message}`;
                }
            }
        });
        // 3. Sipariş Sorgulama Aracı
        const siparisSorgulaTool = new tools_1.DynamicTool({
            name: 'SIPARIS_SORGULA',
            description: 'Veritabanındaki siparişleri listeler veya sorgular. Parametreler: query (string, opsiyonel - isim, telefon veya orderId).',
            func: async (inputStr) => {
                try {
                    const parsed = inputStr ? JSON.parse(inputStr) : {};
                    const query = parsed.query || '';
                    const orders = await order_service_1.OrderService.getOrders();
                    let filtered = orders;
                    if (query) {
                        const q = query.toLowerCase().trim();
                        filtered = orders.filter(o => (o.orderId || '').toLowerCase().includes(q) ||
                            (o.customerName || '').toLowerCase().includes(q) ||
                            (o.customerPhone || '').includes(q) ||
                            (o.status || '').toLowerCase().includes(q));
                    }
                    if (filtered.length === 0)
                        return 'Sorgunuza uygun sipariş bulunamadı.';
                    const list = filtered.slice(0, 5).map(o => `• #${o.orderId} | Müşteri: ${o.customerName} (${o.customerPhone}) | Ürün: ${o.productCode} (${o.quantity} Adet) | Tutar: ${o.totalPrice || 0} TL | Durum: ${o.status}`).join('\n');
                    return `📦 Toplam ${filtered.length} sipariş bulundu. Son ${Math.min(5, filtered.length)} sipariş:\n${list}`;
                }
                catch (e) {
                    return `❌ Sipariş sorgulama hatası: ${e.message}`;
                }
            }
        });
        // 4. Yeni Ürün Ekleme Aracı
        const urunEkleTool = new tools_1.DynamicTool({
            name: 'URUN_EKLE',
            description: 'Yapay zeka analizli yeni ürün ekler. Parametreler: productCode (string - Tekil Ürün Kodu/SKU), productName (string), color (string, opsiyonel), size (string, opsiyonel), stock (number), price (number, opsiyonel), category (string, opsiyonel).',
            func: async (inputStr) => {
                try {
                    const { productCode, shortCode, productName, color, size, stock, price, category } = JSON.parse(inputStr);
                    const computedProductCode = (productCode || shortCode || 'PROD-1').toString().trim().toUpperCase();
                    const sz = (size || 'M').toString().trim().toUpperCase();
                    const numPrice = Number(price) || 299;
                    const res = await stock_service_1.StockService.addProduct({
                        productCode: computedProductCode,
                        name: productName || 'Yeni Ürün',
                        color: color || '',
                        size: sz,
                        stock: Number(stock) || 0,
                        category: category || ''
                    });
                    if (res.success) {
                        db_1.db.prepare('UPDATE products SET price = ? WHERE product_code = ?').run(numPrice, computedProductCode);
                        return `✨ Yeni ürün başarıyla eklendi!\n• Ürün Kodu (SKU): ${computedProductCode}\n• İsim: ${productName || computedProductCode}\n• Beden: ${sz}\n• Stok: ${stock}\n• Fiyat: ${numPrice} TL`;
                    }
                    else {
                        return '❌ Ürün eklenemedi.';
                    }
                }
                catch (e) {
                    return `❌ Ürün ekleme hatası: ${e.message}`;
                }
            }
        });
        // 5. Ürün ve Stok Listeleme / Sorgulama Aracı (Database Product Search)
        const urunListeleSorgulaTool = new tools_1.DynamicTool({
            name: 'URUN_LISTELE_SORGULA',
            description: 'Veritabanındaki tüm ürünleri ve stok durumlarını listeler veya kelimeye göre arar. Parametreler: query (string, opsiyonel - ürün adı, kod, kısa kod, renk veya kategori).',
            func: async (inputStr) => {
                try {
                    const parsed = inputStr ? JSON.parse(inputStr) : {};
                    const query = parsed.query || '';
                    const products = await stock_service_1.StockService.fetchAllSheetRows();
                    let filtered = products;
                    if (query) {
                        const q = query.toLowerCase().trim();
                        filtered = products.filter(p => (p.productCode || '').toLowerCase().includes(q) ||
                            (p.shortCode || '').toLowerCase().includes(q) ||
                            (p.name || '').toLowerCase().includes(q) ||
                            (p.color || '').toLowerCase().includes(q) ||
                            (p.category || '').toLowerCase().includes(q));
                    }
                    if (filtered.length === 0)
                        return 'Aradığınız kriterlere uygun ürün veritabanında bulunamadı.';
                    const list = filtered.slice(0, 10).map(p => `• ${p.productCode} (${p.name}) | Beden: ${p.size} | Stok: ${p.stock} adet | Fiyat: ${p.price || 299} TL`).join('\n');
                    return `🏷️ Toplam ${filtered.length} adet ürün bulundu. İlk ${Math.min(10, filtered.length)} ürün:\n${list}`;
                }
                catch (e) {
                    return `❌ Ürün sorgulama hatası: ${e.message}`;
                }
            }
        });
        // 6. Finansal Özet Sorgulama Aracı (Kâr, Gelir, Gider, Kasa, Banka)
        const finansalOzetTool = new tools_1.DynamicTool({
            name: 'FINANSAL_OZET_SORGULA',
            description: 'İşletmenin kâr, gelir, gider, kasa ve banka likit varlık durumunu özetler. Parametreler: period (string - "this_month", "last_month", "this_year", "all").',
            func: async (inputStr) => {
                try {
                    const parsed = inputStr ? JSON.parse(inputStr) : {};
                    const summary = accounting_service_1.AccountingService.getFinancialSummary(parsed.period || 'this_month');
                    const topExpText = (summary.topExpenses || []).map((e) => `  • ${e.category}: ${e.total} TL`).join('\n');
                    return `📊 **Finansal Özet (${summary.period || 'Bu Ay'}):**\n• Toplam Gelir: ${summary.totalRevenue} TL\n• Toplam Gider: ${summary.totalExpenses} TL\n• Net Kâr: ${summary.netProfit} TL (%${summary.profitMarginPercent} Kâr Marjı)\n• Kasadaki Nakit: ${summary.cashBalance} TL\n• Bankadaki Bakiye: ${summary.bankBalance} TL\n• Alacaklar: ${summary.totalReceivables} TL | Borçlar: ${summary.totalPayables} TL\n• En Yüksek Gider Kalemleri:\n${topExpText || '  Henüz kayıtlı gider yok.'}`;
                }
                catch (e) {
                    return `❌ Finansal özet sorgulama hatası: ${e.message}`;
                }
            }
        });
        // 7. Kâr/Zarar Raporu Aracı
        const karZararTool = new tools_1.DynamicTool({
            name: 'KAR_ZARAR_SORGULA',
            description: 'Kâr/Zarar (Profit & Loss) detay raporunu getirir. Parametreler: startDate (string, YYYY-MM-DD), endDate (string, YYYY-MM-DD).',
            func: async (inputStr) => {
                try {
                    const parsed = inputStr ? JSON.parse(inputStr) : {};
                    const report = accounting_service_1.AccountingService.getProfitLossReport(parsed.startDate, parsed.endDate);
                    return `📈 **Kâr / Zarar Tablosu (${report.startDate} - ${report.endDate}):**\n• Satış Hasılatı: ${report.revenue} TL\n• Satılan Mal Maliyeti (COGS): ${report.cogs} TL\n• Brüt Kâr: ${report.grossProfit} TL (%${report.grossMarginPercent})\n• Faaliyet Giderleri: ${report.operatingExpenses} TL\n• Net Kâr: ${report.netProfit} TL (%${report.netMarginPercent})`;
                }
                catch (e) {
                    return `❌ Kâr/zarar rapor hatası: ${e.message}`;
                }
            }
        });
        // 8. AI İle Gider Taslağı Oluşturma Aracı (Confirmation Gerektirir)
        const giderTaslagiTool = new tools_1.DynamicTool({
            name: 'GIDER_TASLAGI_OLUSTUR',
            description: 'Kullanıcının beyan ettiği harcama için gider taslağı oluşturur (Onay almadan DB commit edilmez). Parametreler: category (string), amount (number), description (string), paymentMethod (string, "CASH"/"BANK_TRANSFER").',
            func: async (inputStr) => {
                try {
                    const { category, amount, description, paymentMethod } = JSON.parse(inputStr);
                    const res = accounting_service_1.AccountingService.addExpense({
                        category: category || 'Genel',
                        amount: Number(amount) || 0,
                        description: description || category || 'Harcama',
                        paymentMethod: paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
                        status: 'DRAFT_PENDING_APPROVAL',
                        performedBy: 'AI_COPILOT'
                    });
                    if (res.success) {
                        return `📝 **Gider Taslağı Hazırlandı:**\n• Numara: ${res.expenseNumber}\n• Kategori: ${category}\n• Tutar: ${amount} TL\n• Ödeme Yöntemi: ${paymentMethod || 'Kasa'}\n• Açıklama: ${description}\n\n⚠️ **Patron, bu gider kaydını veritabanına kaydedeyim mi? (Evet / Onayla / İptal)**`;
                    }
                    else {
                        return `❌ Gider taslağı oluşturulamadı: ${res.error}`;
                    }
                }
                catch (e) {
                    return `❌ Gider taslağı hatası: ${e.message}`;
                }
            }
        });
        // 9. AI İle Gelir Taslağı Oluşturma Aracı
        const gelirTaslagiTool = new tools_1.DynamicTool({
            name: 'GELIR_TASLAGI_OLUSTUR',
            description: 'Kullanıcının beyan ettiği harici gelir için taslak oluşturur. Parametreler: category (string), amount (number), description (string), paymentMethod (string).',
            func: async (inputStr) => {
                try {
                    const { category, amount, description, paymentMethod } = JSON.parse(inputStr);
                    const res = accounting_service_1.AccountingService.addIncome({
                        category: category || 'Diğer',
                        amount: Number(amount) || 0,
                        description: description || category || 'Gelir',
                        paymentMethod: paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
                        status: 'DRAFT_PENDING_APPROVAL',
                        performedBy: 'AI_COPILOT'
                    });
                    if (res.success) {
                        return `📝 **Gelir Taslağı Hazırlandı:**\n• Numara: ${res.incomeNumber}\n• Kategori: ${category}\n• Tutar: ${amount} TL\n• Açıklama: ${description}\n\n⚠️ **Patron, bu gelir kaydını veritabanına kaydedeyim mi? (Evet / Onayla / İptal)**`;
                    }
                    else {
                        return `❌ Gelir taslağı oluşturulamadı: ${res.error}`;
                    }
                }
                catch (e) {
                    return `❌ Gelir taslağı hatası: ${e.message}`;
                }
            }
        });
        // 10. Taslak Onaylama ve Muhasebeleştirme Aracı
        const taslakOnaylaTool = new tools_1.DynamicTool({
            name: 'TASLAK_ONAYLA',
            description: 'Hazırlanan gider veya gelir taslağını onaylayıp veritabanına yevmiye fişi olarak yazar. Parametreler: type ("EXPENSE" / "INCOME"), idOrNumber (string).',
            func: async (inputStr) => {
                try {
                    const { type, idOrNumber } = JSON.parse(inputStr);
                    const res = accounting_service_1.AccountingService.confirmDraft(type, idOrNumber, 'USER:tonystark');
                    if (res.success) {
                        return `✅ Taslak (#${idOrNumber}) başarıyla onaylandı ve veritabanına muhasebe kaydı atıldı!`;
                    }
                    else {
                        return `❌ Taslak onaylanamadı: ${res.error}`;
                    }
                }
                catch (e) {
                    return `❌ Taslak onay hatası: ${e.message}`;
                }
            }
        });
        // 11. Vergi / KDV Özeti Sorgulama Aracı
        const kdvVergiTool = new tools_1.DynamicTool({
            name: 'KDV_VERGI_SORGULA',
            description: 'Hesaplanan Satış KDV, İndirilecek KDV ve Ödenecek Net KDV durumunu sorgular.',
            func: async () => {
                try {
                    const tax = accounting_service_1.AccountingService.getTaxSummary();
                    return `🧾 **Vergi & KDV Durumu (${tax.period}):**\n• Satış KDV (Hesaplanan): ${tax.salesKDV} TL\n• Gider KDV (İndirilecek): ${tax.inputKDV} TL\n• Ödenecek Net KDV: ${tax.netKDVToPay} TL\n• Sonraki Aya Devreden KDV: ${tax.carryForwardKDV} TL\n\n${tax.disclaimer}`;
                }
                catch (e) {
                    return `❌ KDV sorgulama hatası: ${e.message}`;
                }
            }
        });
        const model = new openai_1.ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: env_1.env.openaiModel || 'gpt-4o',
            temperature: 0.1
        });
        const tools = [
            stokGuncelleTool,
            fiyatGuncelleTool,
            siparisSorgulaTool,
            urunEkleTool,
            urunListeleSorgulaTool,
            finansalOzetTool,
            karZararTool,
            giderTaslagiTool,
            gelirTaslagiTool,
            taslakOnaylaTool,
            kdvVergiTool
        ];
        const boundModel = model.bindTools(tools);
        const systemPrompt = new messages_1.SystemMessage(`
Sen DEMO STORE Yönetici, Mağaza ve Finans Copilot Asistanısın (F.R.I.D.A.Y.).
Kullanıcın Sayın Tony Stark (Patron)'dır.

VERİTABANI VE FİNANS YETKİLERİN:
Sen veritabanındaki ürünleri, stokları, fiyatları, siparişleri VE MUHASEBE/FİNANS VERİLERİNİ Doğrudan Sorgulama ve Yönetme Yetkisine SAHİPSİN!
- Gelir, gider, kâr, kasa ve banka bakiyeleri için FINANSAL_OZET_SORGULA veya KAR_ZARAR_SORGULA araçlarını kullan.
- Vergi ve KDV sorgulamaları için KDV_VERGI_SORGULA aracını kullan.
- Patron bir harcama veya gider bildirdiğinde (Örn: "Bugün 2500 TL yakıt harcadım") GIDER_TASLAGI_OLUSTUR aracını çağırıp taslak oluştur ve onay iste.
- Patron onay verdiğinde ("Evet", "Kaydet", "Onayla") TASLAK_ONAYLA aracını çağır.
- Ürünleri/stokları listelemek için URUN_LISTELE_SORGULA, siparişler için SIPARIS_SORGULA araçlarını kullan.

⚠️ KESİNLİKLE "finansal verilere erişemiyorum" veya "veritabanı araçlarım yok" DEME! Senin muhasebe araçların var ve veritabanına %100 erişimin var.
⚠️ GÜVENLİK KURALI: Gider ve Gelir kayıtlarını Patron "Evet/Onayla" demeden doğrudan kaydetme! Önce taslak oluşturup teyit al.
⚠️ SQL Injection veya veritabanı silme talepleri gelirse doğrudan reddet.

Görevlerin:
1. Patron'un Türkçe doğal dille verdiği finansal ve operasyonel yönetim emirlerini anlayıp ilgili araçları çalıştırmak.
2. Gerçekleşen veriler ile AI analitik yorumlarını ayırt ederek samimi, karizmatik ve net bir Türkçe yanıt sunmak.
    `);
        let messages = [systemPrompt, new messages_1.HumanMessage(userPrompt)];
        let response = await boundModel.invoke(messages);
        let count = 0;
        while (response.tool_calls && response.tool_calls.length > 0 && count < 4) {
            count++;
            messages.push(response);
            for (const tc of response.tool_calls) {
                let toolResult = "";
                if (tc.name === 'STOK_GUNCELLE')
                    toolResult = await stokGuncelleTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'FIYAT_GUNCELLE')
                    toolResult = await fiyatGuncelleTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'SIPARIS_SORGULA')
                    toolResult = await siparisSorgulaTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'URUN_EKLE')
                    toolResult = await urunEkleTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'URUN_LISTELE_SORGULA')
                    toolResult = await urunListeleSorgulaTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'FINANSAL_OZET_SORGULA')
                    toolResult = await finansalOzetTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'KAR_ZARAR_SORGULA')
                    toolResult = await karZararTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'GIDER_TASLAGI_OLUSTUR')
                    toolResult = await giderTaslagiTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'GELIR_TASLAGI_OLUSTUR')
                    toolResult = await gelirTaslagiTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'TASLAK_ONAYLA')
                    toolResult = await taslakOnaylaTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'KDV_VERGI_SORGULA')
                    toolResult = await kdvVergiTool.invoke(JSON.stringify(tc.args));
                messages.push(new messages_1.ToolMessage({ content: toolResult, tool_call_id: tc.id }));
            }
            response = await boundModel.invoke(messages);
        }
        return (typeof response.content === 'string' ? response.content : 'İşleminiz tamamlandı Patron!').trim();
    }
}
exports.AdminCopilotService = AdminCopilotService;
