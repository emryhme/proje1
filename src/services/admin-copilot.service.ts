import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { SystemMessage, HumanMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { StockService } from './stock.service';
import { OrderService } from './order.service';
import { db } from '../database/db';

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

    const model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: env.openaiModel || 'gpt-4o',
      temperature: 0.1
    });

    const tools = [stokGuncelleTool, fiyatGuncelleTool, siparisSorgulaTool, urunEkleTool, urunListeleSorgulaTool];
    const boundModel = model.bindTools(tools);

    const systemPrompt = new SystemMessage(`
Sen DEMO STORE Yönetici ve Mağaza Copilot Asistanısın (F.R.I.D.A.Y.).
Kullanıcın Sayın Tony Stark (Patron)'dır.

VERİTABANI VE ARAÇ YETKİLERİN:
Sen veritabanındaki ürünleri, stokları, fiyatları ve siparişleri Doğrudan Sorgulama ve Değiştirme Yetkisine SAHİPSİN!
- Ürünleri ve stok durumunu aramak/görüntülemek için URUN_LISTELE_SORGULA aracını kullan.
- Stok değiştirmek için STOK_GUNCELLE aracını kullan.
- Fiyat değiştirmek için FIYAT_GUNCELLE aracını kullan.
- Sipariş sorgulamak için SIPARIS_SORGULA aracını kullan.
- Yeni ürün eklemek için URUN_EKLE aracını kullan.

⚠️ KESİNLİKLE "ürün listenizi görüntülemek için bir araç kullanamıyorum" DEME! Senin URUN_LISTELE_SORGULA aracın var ve veritabanına %100 erişimin var.
⚠️ KURAL: Yeni ürün ekleme veya bilgi isteme işlemlerinde KESİNLİKLE "kısa kod" isteme! Ürünlerimiz sadece tekil "Ürün Kodu (SKU)" ile tanımlanmaktadır.

Görevlerin:
1. Patron'un Türkçe doğal dille verdiği yönetim emirlerini anlayıp araçları çalıştırarak işlemi gerçekleştirmek.
2. İşlem tamamlandığında Patron'a saygılı, samimi, karizmatik ve net bir Türkçe yanıt sunmak.
    `);

    let messages: BaseMessage[] = [systemPrompt, new HumanMessage(userPrompt)];
    let response = await boundModel.invoke(messages);

    let count = 0;
    while (response.tool_calls && response.tool_calls.length > 0 && count < 3) {
      count++;
      messages.push(response);
      for (const tc of response.tool_calls) {
        let toolResult = "";
        if (tc.name === 'STOK_GUNCELLE') toolResult = await stokGuncelleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'FIYAT_GUNCELLE') toolResult = await fiyatGuncelleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'SIPARIS_SORGULA') toolResult = await siparisSorgulaTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'URUN_EKLE') toolResult = await urunEkleTool.invoke(JSON.stringify(tc.args));
        else if (tc.name === 'URUN_LISTELE_SORGULA') toolResult = await urunListeleSorgulaTool.invoke(JSON.stringify(tc.args));

        messages.push(new ToolMessage({ content: toolResult, tool_call_id: tc.id! }));
      }
      response = await boundModel.invoke(messages);
    }

    return (typeof response.content === 'string' ? response.content : 'İşleminiz tamamlandı Patron!').trim();
  }
}
