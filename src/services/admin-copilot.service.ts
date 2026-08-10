import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { SystemMessage, HumanMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { StockService } from './stock.service';
import { OrderService } from './order.service';
import { db } from '../database/db';
import { AccountingService } from './accounting.service';
import { ProfitService } from './profit.service';

/**
 * DEMO STORE - AI Admin & Copilot Management Service
 */
export class AdminCopilotService {
  private static getApiKey(): string {
    return (process.env.OPENAI_API_KEY || env.openaiApiKey || '').trim().replace(/^["']|["']$/g, '');
  }

  public static async processAdminCommand(userPrompt: string): Promise<string> {
    const apiKey = this.getApiKey();

    if (!apiKey || apiKey === 'DUMMY_KEY' || apiKey.length < 10) {
      return "⚠️ Patron, sunucuda geçerli bir OPENAI_API_KEY bulunamadı. Lütfen sunucudaki `.env` dosyanıza `OPENAI_API_KEY=sk-...` anahtarınızı ekleyip `pm2 restart proje1` çalıştırın.";
    }

    // 1. Stok Güncelleme Aracı
    const stokGuncelleTool = new DynamicTool({
      name: 'STOK_GUNCELLE',
      description: 'Bir ürünün stok adedini günceller. Parametreler: productCode (string), newStock (number).',
      func: async (inputStr: string) => {
        try {
          const { productCode, newStock } = JSON.parse(inputStr);
          const success = await StockService.updateStock(productCode, Number(newStock));
          if (success) {
            return `✅ ${productCode} stoğu ${newStock} adet olarak güncellendi!`;
          } else {
            return `❌ ${productCode} stoğu veritabanında bulunamadı veya güncellenemedi.`;
          }
        } catch (e: any) {
          return `❌ Stok güncelleme hatası: ${e.message}`;
        }
      }
    });

    // 2. Fiyat Güncelleme Aracı
    const fiyatGuncelleTool = new DynamicTool({
      name: 'FIYAT_GUNCELLE',
      description: 'Bir ürünün satış fiyatını TL olarak günceller. Parametreler: productCode (string), price (number).',
      func: async (inputStr: string) => {
        try {
          const { productCode, price } = JSON.parse(inputStr);
          const numPrice = Number(price);
          db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ?').run(numPrice, productCode);
          return `✅ ${productCode} ürününün fiyatı ${numPrice} TL olarak kaydedildi!`;
        } catch (e: any) {
          return `❌ Fiyat güncelleme hatası: ${e.message}`;
        }
      }
    });

    // 3. Sipariş Sorgulama Aracı
    const siparisSorgulaTool = new DynamicTool({
      name: 'SIPARIS_SORGULA',
      description: 'Veritabanındaki siparişleri listeler veya sorgular. Parametreler: query (string, opsiyonel - isim, telefon veya orderId).',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const query = parsed.query || '';
          const orders = await OrderService.getOrders();
          
          let filtered = orders;
          if (query) {
            const q = query.toLowerCase().trim();
            filtered = orders.filter(o => 
              (o.orderId || '').toLowerCase().includes(q) ||
              (o.customerName || '').toLowerCase().includes(q) ||
              (o.customerPhone || '').includes(q) ||
              (o.status || '').toLowerCase().includes(q)
            );
          }

          if (filtered.length === 0) return 'Sorgunuza uygun sipariş bulunamadı.';

          const list = filtered.slice(0, 5).map(o => 
            `• #${o.orderId} | Müşteri: ${o.customerName} (${o.customerPhone}) | Ürün: ${o.productCode} (${o.quantity} Adet) | Tutar: ${o.totalPrice || 0} TL | Durum: ${o.status}`
          ).join('\n');

          return `📦 Toplam ${filtered.length} sipariş bulundu. Son ${Math.min(5, filtered.length)} sipariş:\n${list}`;
        } catch (e: any) {
          return `❌ Sipariş sorgulama hatası: ${e.message}`;
        }
      }
    });

    // 4. Yeni Ürün Ekleme Aracı
    const urunEkleTool = new DynamicTool({
      name: 'URUN_EKLE',
      description: 'Yapay zeka analizli yeni ürün ekler. Parametreler: productCode (string - Tekil Ürün Kodu/SKU), productName (string), color (string, opsiyonel), size (string, opsiyonel), stock (number), price (number, opsiyonel), category (string, opsiyonel).',
      func: async (inputStr: string) => {
        try {
          const { productCode, shortCode, productName, color, size, stock, price, category } = JSON.parse(inputStr);
          const computedProductCode = (productCode || shortCode || 'PROD-1').toString().trim().toUpperCase();
          const sz = (size || 'M').toString().trim().toUpperCase();
          const numPrice = Number(price) || 299;

          const res = await StockService.addProduct({
            productCode: computedProductCode,
            name: productName || 'Yeni Ürün',
            color: color || '',
            size: sz,
            stock: Number(stock) || 0,
            category: category || ''
          });

          if (res.success) {
            db.prepare('UPDATE products SET price = ? WHERE product_code = ?').run(numPrice, computedProductCode);
            return `✨ Yeni ürün başarıyla eklendi!\n• Ürün Kodu (SKU): ${computedProductCode}\n• İsim: ${productName || computedProductCode}\n• Beden: ${sz}\n• Stok: ${stock}\n• Fiyat: ${numPrice} TL`;
          } else {
            return '❌ Ürün eklenemedi.';
          }
        } catch (e: any) {
          return `❌ Ürün ekleme hatası: ${e.message}`;
        }
      }
    });

    // 5. Ürün ve Stok Listeleme / Sorgulama Aracı (Database Product Search)
    const urunListeleSorgulaTool = new DynamicTool({
      name: 'URUN_LISTELE_SORGULA',
      description: 'Veritabanındaki tüm ürünleri ve stok durumlarını listeler veya kelimeye göre arar. Parametreler: query (string, opsiyonel - ürün adı, kod, kısa kod, renk veya kategori).',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const query = parsed.query || '';
          const products = await StockService.fetchAllSheetRows();

          let filtered = products;
          if (query) {
            const q = query.toLowerCase().trim();
            filtered = products.filter(p => 
              (p.productCode || '').toLowerCase().includes(q) ||
              (p.shortCode || '').toLowerCase().includes(q) ||
              (p.name || '').toLowerCase().includes(q) ||
              (p.color || '').toLowerCase().includes(q) ||
              (p.category || '').toLowerCase().includes(q)
            );
          }

          if (filtered.length === 0) return 'Aradığınız kriterlere uygun ürün veritabanında bulunamadı.';

          const list = filtered.slice(0, 10).map(p => 
            `• ${p.productCode} (${p.name}) | Beden: ${p.size} | Stok: ${p.stock} adet | Fiyat: ${p.price || 299} TL`
          ).join('\n');

          return `🏷️ Toplam ${filtered.length} adet ürün bulundu. İlk ${Math.min(10, filtered.length)} ürün:\n${list}`;
        } catch (e: any) {
          return `❌ Ürün sorgulama hatası: ${e.message}`;
        }
      }
    });

    // 6. Finansal Özet Sorgulama Aracı (Kâr, Gelir, Gider, Kasa, Banka)
    const finansalOzetTool = new DynamicTool({
      name: 'FINANSAL_OZET_SORGULA',
      description: 'İşletmenin kâr, gelir, gider, kasa ve banka likit varlık durumunu özetler. Parametreler: period (string - "this_month", "last_month", "this_year", "all").',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const summary = AccountingService.getFinancialSummary(parsed.period || 'this_month');
          const topExpText = (summary.topExpenses || []).map((e: any) => `  • ${e.category}: ${e.total} TL`).join('\n');
          return `📊 **Finansal Özet (${summary.period || 'Bu Ay'}):**\n• Toplam Gelir: ${summary.totalRevenue} TL\n• Toplam Gider: ${summary.totalExpenses} TL\n• Net Kâr: ${summary.netProfit} TL (%${summary.profitMarginPercent} Kâr Marjı)\n• Kasadaki Nakit: ${summary.cashBalance} TL\n• Bankadaki Bakiye: ${summary.bankBalance} TL\n• Alacaklar: ${summary.totalReceivables} TL | Borçlar: ${summary.totalPayables} TL\n• En Yüksek Gider Kalemleri:\n${topExpText || '  Henüz kayıtlı gider yok.'}`;
        } catch (e: any) {
          return `❌ Finansal özet sorgulama hatası: ${e.message}`;
        }
      }
    });

    // 7. Kâr/Zarar Raporu Aracı
    const karZararTool = new DynamicTool({
      name: 'KAR_ZARAR_SORGULA',
      description: 'Kâr/Zarar (Profit & Loss) detay raporunu getirir. Parametreler: startDate (string, YYYY-MM-DD), endDate (string, YYYY-MM-DD).',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const report = AccountingService.getProfitLossReport(parsed.startDate, parsed.endDate);
          return `📈 **Kâr / Zarar Tablosu (${report.startDate} - ${report.endDate}):**\n• Satış Hasılatı: ${report.revenue} TL\n• Satılan Mal Maliyeti (COGS): ${report.cogs} TL\n• Brüt Kâr: ${report.grossProfit} TL (%${report.grossMarginPercent})\n• Faaliyet Giderleri: ${report.operatingExpenses} TL\n• Net Kâr: ${report.netProfit} TL (%${report.netMarginPercent})`;
        } catch (e: any) {
          return `❌ Kâr/zarar rapor hatası: ${e.message}`;
        }
      }
    });

    // 8. AI İle Gider Taslağı Oluşturma Aracı (Confirmation Gerektirir)
    const giderTaslagiTool = new DynamicTool({
      name: 'GIDER_TASLAGI_OLUSTUR',
      description: 'Kullanıcının beyan ettiği harcama için gider taslağı oluşturur (Onay almadan DB commit edilmez). Parametreler: category (string), amount (number), description (string), paymentMethod (string, "CASH"/"BANK_TRANSFER").',
      func: async (inputStr: string) => {
        try {
          const { category, amount, description, paymentMethod } = JSON.parse(inputStr);
          const res = AccountingService.addExpense({
            category: category || 'Genel',
            amount: Number(amount) || 0,
            description: description || category || 'Harcama',
            paymentMethod: paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
            status: 'DRAFT_PENDING_APPROVAL',
            performedBy: 'AI_COPILOT'
          });

          if (res.success) {
            return `📝 **Gider Taslağı Hazırlandı:**\n• Numara: ${res.expenseNumber}\n• Kategori: ${category}\n• Tutar: ${amount} TL\n• Ödeme Yöntemi: ${paymentMethod || 'Kasa'}\n• Açıklama: ${description}\n\n⚠️ **Patron, bu gider kaydını veritabanına kaydedeyim mi? (Evet / Onayla / İptal)**`;
          } else {
            return `❌ Gider taslağı oluşturulamadı: ${res.error}`;
          }
        } catch (e: any) {
          return `❌ Gider taslağı hatası: ${e.message}`;
        }
      }
    });

    // 9. AI İle Gelir Taslağı Oluşturma Aracı
    const gelirTaslagiTool = new DynamicTool({
      name: 'GELIR_TASLAGI_OLUSTUR',
      description: 'Kullanıcının beyan ettiği harici gelir için taslak oluşturur. Parametreler: category (string), amount (number), description (string), paymentMethod (string).',
      func: async (inputStr: string) => {
        try {
          const { category, amount, description, paymentMethod } = JSON.parse(inputStr);
          const res = AccountingService.addIncome({
            category: category || 'Diğer',
            amount: Number(amount) || 0,
            description: description || category || 'Gelir',
            paymentMethod: paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
            status: 'DRAFT_PENDING_APPROVAL',
            performedBy: 'AI_COPILOT'
          });

          if (res.success) {
            return `📝 **Gelir Taslağı Hazırlandı:**\n• Numara: ${res.incomeNumber}\n• Kategori: ${category}\n• Tutar: ${amount} TL\n• Açıklama: ${description}\n\n⚠️ **Patron, bu gelir kaydını veritabanına kaydedeyim mi? (Evet / Onayla / İptal)**`;
          } else {
            return `❌ Gelir taslağı oluşturulamadı: ${res.error}`;
          }
        } catch (e: any) {
          return `❌ Gelir taslağı hatası: ${e.message}`;
        }
      }
    });

    // 10. Taslak Onaylama ve Muhasebeleştirme Aracı
    const taslakOnaylaTool = new DynamicTool({
      name: 'TASLAK_ONAYLA',
      description: 'Hazırlanan gider veya gelir taslağını onaylayıp veritabanına yevmiye fişi olarak yazar. Parametreler: type ("EXPENSE" / "INCOME"), idOrNumber (string).',
      func: async (inputStr: string) => {
        try {
          const { type, idOrNumber } = JSON.parse(inputStr);
          const res = AccountingService.confirmDraft(type, idOrNumber, 'USER:tonystark');
          if (res.success) {
            return `✅ Taslak (#${idOrNumber}) başarıyla onaylandı ve veritabanına muhasebe kaydı atıldı!`;
          } else {
            return `❌ Taslak onaylanamadı: ${res.error}`;
          }
        } catch (e: any) {
          return `❌ Taslak onay hatası: ${e.message}`;
        }
      }
    });

    // 11. Vergi / KDV Özeti Sorgulama Aracı
    const kdvVergiTool = new DynamicTool({
      name: 'KDV_VERGI_SORGULA',
      description: 'Hesaplanan Satış KDV, İndirilecek KDV ve Ödenecek Net KDV durumunu sorgular.',
      func: async () => {
        try {
          const tax = AccountingService.getTaxSummary();
          return `🧾 **Vergi & KDV Durumu (${tax.period}):**\n• Satış KDV (Hesaplanan): ${tax.salesKDV} TL\n• Gider KDV (İndirilecek): ${tax.inputKDV} TL\n• Ödenecek Net KDV: ${tax.netKDVToPay} TL\n• Sonraki Aya Devreden KDV: ${tax.carryForwardKDV} TL\n\n${tax.disclaimer}`;
        } catch (e: any) {
          return `❌ KDV sorgulama hatası: ${e.message}`;
        }
      }
    });

    // 12. Satış, Maliyet ve Kâr Özeti Aracı (Profit Summary)
    const karOzetiTool = new DynamicTool({
      name: 'KAR_OZETI_SORGULA',
      description: 'Dönemsel Ciro, Alış Maliyeti, Net Kâr, Kâr Marjı % ve Satılan Adet istatistiklerini hesaplar. Parametreler: period (string - "today", "this_week", "this_month", "last_month", "this_year", "all").',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const p = ProfitService.getProfitSummary(parsed.period || 'this_month');
          return `📈 **Satış & Kâr Analizi (${p.startDate} - ${p.endDate}):**\n• Toplam Ciro (Hasılat): ${p.totalRevenue} TL\n• Toplam Ürün Maliyeti (COGS): ${p.totalCost} TL\n• Net Brüt Kâr: ${p.totalProfit} TL\n• Kâr Marjı: %${p.profitMarginPercent}\n• Toplam Satış Adedi: ${p.totalUnitsSold} adet (${p.totalOrders} sipariş)`;
        } catch (e: any) {
          return `❌ Kâr özeti alma hatası: ${e.message}`;
        }
      }
    });

    // 13. Ürün Bazlı Kârlılık Sorgulama Aracı (Product Profitability)
    const urunKarlilikTool = new DynamicTool({
      name: 'URUN_KARLILIK_SORGULA',
      description: 'Ürünlerin geliş fiyatı, satış fiyatı, satılan adet, ciro, maliyet ve net kâr tablosunu sorgular. Parametreler: sortBy ("profit", "margin", "units", "revenue").',
      func: async (inputStr: string) => {
        try {
          const parsed = inputStr ? JSON.parse(inputStr) : {};
          const list = ProfitService.getProductProfitability(parsed.sortBy || 'profit', 10);
          if (list.length === 0) return 'Kayıtlı kârlılık verisi bulunamadı.';

          const text = list.map((item, idx) => 
            `${idx + 1}. **${item.productName}** (${item.productCode})\n   • Geliş: ${item.unitCostPrice} TL | Satış: ${item.unitSellingPrice} TL\n   • Satılan: ${item.unitsSold} adet | Ciro: ${item.totalRevenue} TL\n   • Maliyet: ${item.totalCost} TL | Kâr: ${item.totalProfit} TL (%${item.profitMarginPercent} Marj)`
          ).join('\n\n');

          return `🏷️ **Ürün Kârlılık Sıralaması (Top 10):**\n\n${text}`;
        } catch (e: any) {
          return `❌ Ürün kârlılık sorgulama hatası: ${e.message}`;
        }
      }
    });

    // 14. Gelecek Satış Kâr Tahmini Aracı (Profit Forecast)
    const gelecekKarTahminiTool = new DynamicTool({
      name: 'GELECEK_KAR_TAHMINI',
      description: 'Belirtilen üründen N adet satılırsa ne kadar ciro, maliyet ve brüt kâr oluşacağını hesaplar. Parametreler: productCode (string), quantity (number).',
      func: async (inputStr: string) => {
        try {
          const { productCode, quantity } = JSON.parse(inputStr);
          const f = ProfitService.calculateForecastProfit(productCode, Number(quantity) || 1);
          return f.message;
        } catch (e: any) {
          return `❌ Gelecek kâr tahmini hatası: ${e.message}`;
        }
      }
    });

    const model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: env.openaiModel || 'gpt-4o',
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
      kdvVergiTool,
      karOzetiTool,
      urunKarlilikTool,
      gelecekKarTahminiTool
    ];
    const boundModel = model.bindTools(tools);

    const systemPrompt = new SystemMessage(`
Sen DEMO STORE Yönetici, Mağaza, Satış ve Kâr Copilot Asistanısın (F.R.I.D.A.Y.).
Kullanıcın Sayın Tony Stark (Patron)'dır.

VERİTABANI, SATIŞ VE KÂR ANALİZİ YETKİLERİN:
Sen veritabanındaki ürünleri, stokları, geliş/satış fiyatlarını, siparişleri VE KÂR/ANALİZ VERİLERİNİ Doğrudan Sorgulama ve Yönetme Yetkisine SAHİPSİN!
- Ciro, Maliyet, Net Kâr ve Marj soruları için KAR_OZETI_SORGULA veya FINANSAL_OZET_SORGULA araçlarını kullan.
- En kârlı ürün, en çok satan ürün, en yüksek marjlı ürün veya belirli ürün kârlılığı için URUN_KARLILIK_SORGULA aracını kullan.
- "X üründen 100 adet satarsam ne kâr ederim?" gibi sorular için GELECEK_KAR_TAHMINI aracını kullan.
- Ürün ekleme veya fiyat değişikliklerinde Patron teyidi almak için taslak bildir.

⚠️ KESİNLİKLE "kâr verilerine erişemiyorum" DEME! Senin KAR_OZETI_SORGULA ve URUN_KARLILIK_SORGULA araçların var ve veritabanına %100 erişimin var.
⚠️ GÜVENLİK KURALI: Gider ve Gelir kayıtlarını Patron "Evet/Onayla" demeden doğrudan kaydetme!
⚠️ SQL Injection veya veritabanı silme talepleri gelirse doğrudan reddet.

Görevlerin:
1. Patron'un Türkçe doğal dille verdiği yönetim ve kâr analizi emirlerini anlayıp ilgili araçları çalıştırmak.
2. Gerçekleşen veriler ile tahmini verileri ayırt ederek samimi, karizmatik ve net bir Türkçe yanıt sunmak.
    `);

    let messages: BaseMessage[] = [systemPrompt, new HumanMessage(userPrompt)];
    let response = await boundModel.invoke(messages);

    let count = 0;
    while (response.tool_calls && response.tool_calls.length > 0 && count < 4) {
      count++;
      messages.push(response);
      for (const tc of response.tool_calls) {
        let toolResult = "";
        if (tc.name === 'STOK_GUNCELLE') toolResult = await stokGuncelleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'FIYAT_GUNCELLE') toolResult = await fiyatGuncelleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'SIPARIS_SORGULA') toolResult = await siparisSorgulaTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'URUN_EKLE') toolResult = await urunEkleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'URUN_LISTELE_SORGULA') toolResult = await urunListeleSorgulaTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'FINANSAL_OZET_SORGULA') toolResult = await finansalOzetTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'KAR_ZARAR_SORGULA') toolResult = await karZararTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'GIDER_TASLAGI_OLUSTUR') toolResult = await giderTaslagiTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'GELIR_TASLAGI_OLUSTUR') toolResult = await gelirTaslagiTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'TASLAK_ONAYLA') toolResult = await taslakOnaylaTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'KDV_VERGI_SORGULA') toolResult = await kdvVergiTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'KAR_OZETI_SORGULA') toolResult = await karOzetiTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'URUN_KARLILIK_SORGULA') toolResult = await urunKarlilikTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'GELECEK_KAR_TAHMINI') toolResult = await gelecekKarTahminiTool.invoke(JSON.stringify(tc.args));

        messages.push(new ToolMessage({ content: toolResult, tool_call_id: tc.id! }));
      }
      response = await boundModel.invoke(messages);
    }

    return (typeof response.content === 'string' ? response.content : 'İşleminiz tamamlandı Patron!').trim();
  }
}
