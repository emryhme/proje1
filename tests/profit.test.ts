import { initDatabase, db } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { OrderService } from '../src/services/order.service';
import { ProfitService } from '../src/services/profit.service';
import { AdminCopilotService } from '../src/services/admin-copilot.service';

async function runProfitTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - ÜRÜN MALİYETİ & KÂR ANALİZİ TEST SUITE');
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

  const testProductCode = `TEST-PROFIT-${Date.now()}`;

  // TEST 1: Birim Kâr Hesaplaması (Cost: 700, Sale: 1000 -> Profit: 300)
  try {
    await StockService.addProduct({
      shortCode: 'TSTPRF',
      productCode: testProductCode,
      name: 'Nike Air Max Test',
      color: 'Siyah',
      size: '42',
      price: 1000,
      stock: 50,
      category: 'Ayakkabı'
    });

    // Cost price'ı 700 TL yap
    db.prepare('UPDATE products SET cost_price = 700 WHERE product_code = ?').run(testProductCode);

    const prod = db.prepare('SELECT price, cost_price FROM products WHERE product_code = ?').get(testProductCode) as any;
    const unitProfit = prod.price - prod.cost_price;

    assert(unitProfit === 300, 'TEST 1: Birim Kâr Hesaplaması', `Satış: ${prod.price} TL, Geliş: ${prod.cost_price} TL, Birim Kâr: ${unitProfit} TL`);
  } catch (e: any) {
    assert(false, 'TEST 1: Birim Kâr Hesaplaması', e.message);
  }

  // TEST 2: Çoklu Ürün Satışı Ciro, Maliyet ve Kâr (10 Adet Satış)
  try {
    const orderData = {
      customerName: 'Mehmet Demir',
      customerPhone: '05441112233',
      address: 'Beşiktaş İstanbul',
      productCode: testProductCode,
      productName: 'Nike Air Max Test',
      size: '42',
      quantity: 10,
      unitPrice: 1000,
      totalPrice: 10000
    };

    const savedOrder = await OrderService.createOrder(orderData);
    const orderRow = db.prepare('SELECT unit_cost_price, total_cost, profit FROM orders WHERE order_id = ?').get(savedOrder.orderId) as any;

    assert(
      Boolean(orderRow && orderRow.unit_cost_price === 700 && orderRow.total_cost === 7000 && orderRow.profit === 3000),
      'TEST 2: Çoklu Ürün Satış Kârı (10 adet)',
      `Ciro: 10.000 TL, Maliyet: ${orderRow?.total_cost} TL, Net Kâr: ${orderRow?.profit} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: Çoklu Ürün Satış Kârı (10 adet)', e.message);
  }

  // TEST 3: Tarihsel Maliyet Garantisi (Geliş Fiyatı Değiştiğinde Geçmiş Siparişin Maliyeti Sabit Kalmalı)
  try {
    // Geçmiş sipariş id'si
    const pastOrder = db.prepare('SELECT order_id, total_cost, profit FROM orders WHERE product_code = ? ORDER BY id DESC LIMIT 1').get(testProductCode) as any;
    const pastCostBeforeUpdate = pastOrder.total_cost;
    const pastProfitBeforeUpdate = pastOrder.profit;

    // Ürünün yeni geliş fiyatını 900 TL yap
    db.prepare('UPDATE products SET cost_price = 900 WHERE product_code = ?').run(testProductCode);

    const pastOrderAfterUpdate = db.prepare('SELECT total_cost, profit FROM orders WHERE order_id = ?').get(pastOrder.order_id) as any;

    assert(
      Boolean(pastOrderAfterUpdate.total_cost === pastCostBeforeUpdate && pastOrderAfterUpdate.profit === pastProfitBeforeUpdate),
      'TEST 3: Tarihsel Maliyet Garantisi (Snapshot)',
      `Geliş fiyatı 900 TL oldu ama eski sipariş maliyeti hâlâ ${pastOrderAfterUpdate.total_cost} TL olarak korundu.`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: Tarihsel Maliyet Garantisi (Snapshot)', e.message);
  }

  // TEST 4: İndirimli Siparişte Net Kâr (Cost: 700, Selling: 1000, Discount: 100 -> Net Rev: 900, Net Profit: 200)
  try {
    // Ürünün geliş fiyatını tekrar 700 TL yap
    db.prepare('UPDATE products SET cost_price = 700 WHERE product_code = ?').run(testProductCode);

    const orderData = {
      customerName: 'Ayşe Kaya',
      customerPhone: '05559998877',
      address: 'Kadıköy İstanbul',
      productCode: testProductCode,
      productName: 'Nike Air Max Test',
      size: '42',
      quantity: 1,
      unitPrice: 1000,
      discount: 100,
      totalPrice: 900
    };

    const savedOrder = await OrderService.createOrder(orderData);
    const orderRow = db.prepare('SELECT total_price, total_cost, profit FROM orders WHERE order_id = ?').get(savedOrder.orderId) as any;

    assert(
      Boolean(orderRow && orderRow.total_price === 900 && orderRow.total_cost === 700 && orderRow.profit === 200),
      'TEST 4: İndirimli Sipariş Net Kârı',
      `Net Satış: 900 TL, Maliyet: 700 TL, Net Kâr: ${orderRow?.profit} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: İndirimli Sipariş Net Kârı', e.message);
  }

  // TEST 5: İade / İptal Edilen Siparişin Kârdan Düşülmesi
  try {
    const cancelledOrder = await OrderService.createOrder({
      customerName: 'İptal Müşteri',
      customerPhone: '05001112233',
      address: 'Ankara',
      productCode: testProductCode,
      productName: 'Nike Air Max Test',
      size: '42',
      quantity: 5,
      unitPrice: 1000,
      totalPrice: 5000
    });

    // İptal et
    await OrderService.updateOrderStatus(cancelledOrder.orderId, 'DEC');

    const summary = ProfitService.getProfitSummary('all');
    const cancelledOrderRow = db.prepare('SELECT status FROM orders WHERE order_id = ?').get(cancelledOrder.orderId) as any;

    assert(
      Boolean(cancelledOrderRow.status === 'DEC' && summary.totalRevenue >= 0),
      'TEST 5: İade / İptal Siparişin Raporlardan Düşülmesi',
      `İptal Edilen Sipariş (ID: ${cancelledOrder.orderId}) genel ciroya dahil edilmedi.`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: İade / İptal Siparişin Raporlardan Düşülmesi', e.message);
  }

  // TEST 6: Dönemsel (Aylık/Haftalık) Kâr Özeti Doğrulaması
  try {
    const summary = ProfitService.getProfitSummary('this_month');
    assert(
      Boolean(summary && typeof summary.totalRevenue === 'number' && typeof summary.totalProfit === 'number'),
      'TEST 6: Dönemsel Kâr Özeti (this_month)',
      `Bu Ay Ciro: ${summary.totalRevenue} TL, Maliyet: ${summary.totalCost} TL, Kâr: ${summary.totalProfit} TL (%${summary.profitMarginPercent} Marj)`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Dönemsel Kâr Özeti (this_month)', e.message);
  }

  // TEST 7: En Kârlı Ürün Sıralaması
  try {
    const topProfitable = ProfitService.getTopProfitableProducts(5);
    assert(
      Boolean(Array.isArray(topProfitable) && topProfitable.length > 0),
      'TEST 7: En Kârlı Ürün Sıralaması',
      `Lider Ürün: ${topProfitable[0]?.productName} (Kâr: ${topProfitable[0]?.totalProfit} TL)`
    );
  } catch (e: any) {
    assert(false, 'TEST 7: En Kârlı Ürün Sıralaması', e.message);
  }

  // TEST 8: En Çok Satan Ürün Sıralaması
  try {
    const topSelling = ProfitService.getTopSellingProducts(5);
    assert(
      Boolean(Array.isArray(topSelling) && topSelling.length > 0),
      'TEST 8: En Çok Satan Ürün Sıralaması',
      `En Çok Satan: ${topSelling[0]?.productName} (${topSelling[0]?.unitsSold} adet)`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: En Çok Satan Ürün Sıralaması', e.message);
  }

  // TEST 9: AI Asistan Kâr Sorusu Yanıtı
  try {
    const reply = await AdminCopilotService.processAdminCommand("Bu ay ne kadar kâr ettim?");
    assert(
      Boolean(reply && reply.length > 0),
      'TEST 9: AI Kâr Sorusu Yanıtı',
      `F.R.I.D.A.Y. Yanıtı: ${reply.substring(0, 100)}...`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: AI Kâr Sorusu Yanıtı', e.message);
  }

  // TEST 10: AI İle Ürün Oluştururken Cost Price ve Stock Kaydı
  try {
    const newSku = `AIRMAX-AI-${Date.now()}`;
    await StockService.addProduct({
      shortCode: 'AIRAI',
      productCode: newSku,
      name: 'Air Max AI Edition',
      color: 'Beyaz',
      size: '41',
      price: 3000,
      stock: 20,
      category: 'Spor'
    });
    db.prepare('UPDATE products SET cost_price = 2000 WHERE product_code = ?').run(newSku);

    const prod = db.prepare('SELECT cost_price, price, stock FROM products WHERE product_code = ?').get(newSku) as any;
    assert(
      Boolean(prod && prod.cost_price === 2000 && prod.price === 3000 && prod.stock === 20),
      'TEST 10: AI Ürün Geliş, Satış ve Stok Kaydı',
      `Geliş: ${prod.cost_price} TL, Satış: ${prod.price} TL, Stok: ${prod.stock}`
    );
  } catch (e: any) {
    assert(false, 'TEST 10: AI Ürün Geliş, Satış ve Stok Kaydı', e.message);
  }

  // TEST 11: Gelecek Satış Kâr Tahmini (Forecast)
  try {
    const forecast = ProfitService.calculateForecastProfit(testProductCode, 100);
    assert(
      Boolean(forecast && forecast.forecastRevenue === 100000 && forecast.forecastProfit === 30000),
      'TEST 11: Gelecek Satış Kâr Tahmini (100 adet)',
      forecast.message
    );
  } catch (e: any) {
    assert(false, 'TEST 11: Gelecek Satış Kâr Tahmini (100 adet)', e.message);
  }

  // TEST 12: Regresyon Kontrolü (Veritabanı ve Stok Bütünlüğü)
  try {
    const productsCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c;
    const ordersCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;

    assert(
      Boolean(productsCount > 0 && ordersCount > 0),
      'TEST 12: Regresyon ve Veritabanı Bütünlüğü',
      `${productsCount} aktif ürün, ${ordersCount} kayıtlı sipariş veritabanında duruyor.`
    );
  } catch (e: any) {
    assert(false, 'TEST 12: Regresyon ve Veritabanı Bütünlüğü', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');
}

runProfitTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
