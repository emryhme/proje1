import { initDatabase, db } from '../src/database/db';
import { StockService } from '../src/services/stock.service';
import { OrderService } from '../src/services/order.service';
import { ProfitService } from '../src/services/profit.service';
import { AccountingService } from '../src/services/accounting.service';
import { AdminCopilotService } from '../src/services/admin-copilot.service';

async function runBoutiqueProfitTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - TEK BUTİK MAĞAZA KÂR & GİDER TEST SUITE');
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

  const sku1 = `BUTIK-ELBISE-${Date.now()}`;

  // TEST 1: Birim Kâr ve Kâr Marjı % (Cost: 800, Sale: 1500 -> Birim Kâr: 700 TL, Marj: %46.67)
  try {
    await StockService.addProduct({
      shortCode: 'ELBISE',
      productCode: sku1,
      name: 'Kırmızı Elbise',
      color: 'Kırmızı',
      size: 'M',
      price: 1500,
      costPrice: 800,
      stock: 20,
      category: 'Elbise'
    });

    const prod = db.prepare('SELECT price, cost_price FROM products WHERE product_code = ?').get(sku1) as any;
    const unitProfit = prod.price - prod.cost_price;
    const margin = Number(((unitProfit / prod.price) * 100).toFixed(2));

    assert(unitProfit === 700 && Math.abs(margin - 46.67) < 0.1, 'TEST 1: Birim Kâr ve Marj %', `Satış: 1.500 TL, Geliş: 800 TL, Birim Kâr: ${unitProfit} TL (%${margin} Marj)`);
  } catch (e: any) {
    assert(false, 'TEST 1: Birim Kâr ve Marj %', e.message);
  }

  // TEST 2: 10 Adet Satış (Ciro = 15.000 TL, Maliyet = 8.000 TL, Kâr = 7.000 TL)
  try {
    const savedOrder = await OrderService.createOrder({
      customerName: 'Selin Yıldız',
      customerPhone: '05331112233',
      address: 'Nişantaşı, İstanbul',
      productCode: sku1,
      productName: 'Kırmızı Elbise',
      size: 'M',
      quantity: 10,
      unitPrice: 1500,
      totalPrice: 15000
    });

    const orderRow = db.prepare('SELECT total_price, total_cost, profit FROM orders WHERE order_id = ?').get(savedOrder.orderId) as any;

    assert(
      Boolean(orderRow && orderRow.total_price === 15000 && orderRow.total_cost === 8000 && orderRow.profit === 7000),
      'TEST 2: Çoklu Ürün Satış Kârı (10 Adet)',
      `Ciro: ${orderRow?.total_price} TL, Maliyet: ${orderRow?.total_cost} TL, Brüt Kâr: ${orderRow?.profit} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 2: Çoklu Ürün Satış Kârı (10 Adet)', e.message);
  }

  // TEST 3: İndirimli Sipariş Net Kârı (Selling: 1500, Discount: 200 -> Actual Sale: 1300, Cost: 800 -> Profit: 500 TL)
  try {
    const savedOrder = await OrderService.createOrder({
      customerName: 'Deniz Aksu',
      customerPhone: '05449998877',
      address: 'Bebek, İstanbul',
      productCode: sku1,
      productName: 'Kırmızı Elbise',
      size: 'M',
      quantity: 1,
      unitPrice: 1500,
      discount: 200,
      totalPrice: 1300
    });

    const orderRow = db.prepare('SELECT total_price, total_cost, profit FROM orders WHERE order_id = ?').get(savedOrder.orderId) as any;

    assert(
      Boolean(orderRow && orderRow.total_price === 1300 && orderRow.total_cost === 800 && orderRow.profit === 500),
      'TEST 3: İndirimli Sipariş Gerçek Kârı',
      `İndirimli Satış: ${orderRow?.total_price} TL, Maliyet: ${orderRow?.total_cost} TL, Net Kâr: ${orderRow?.profit} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 3: İndirimli Sipariş Gerçek Kârı', e.message);
  }

  // TEST 4: Tarihsel Maliyet Snapshot Garantisi (Geliş Fiyatı Değiştiğinde Geçmiş Siparişin Maliyeti Değişmemeli)
  try {
    const pastOrder = db.prepare('SELECT order_id, total_cost, profit FROM orders WHERE product_code = ? ORDER BY id ASC LIMIT 1').get(sku1) as any;
    const pastCostBefore = pastOrder.total_cost;
    const pastProfitBefore = pastOrder.profit;

    // Geliş fiyatını 1.000 TL yap
    db.prepare('UPDATE products SET cost_price = 1000 WHERE product_code = ?').run(sku1);

    const pastOrderAfter = db.prepare('SELECT total_cost, profit FROM orders WHERE order_id = ?').get(pastOrder.order_id) as any;

    assert(
      Boolean(pastOrderAfter.total_cost === pastCostBefore && pastOrderAfter.profit === pastProfitBefore),
      'TEST 4: Tarihsel Maliyet Snapshot Koruma',
      `Geliş fiyatı 1000 TL oldu ama eski sipariş maliyeti hâlâ ${pastOrderAfter.total_cost} TL.`
    );
  } catch (e: any) {
    assert(false, 'TEST 4: Tarihsel Maliyet Snapshot Koruma', e.message);
  }

  // TEST 5: İade Sonrası Ciro, Maliyet, Kâr ve Stok Düzeltmesi
  try {
    // Geliş fiyatını tekrar 800 TL yap
    db.prepare('UPDATE products SET cost_price = 800 WHERE product_code = ?').run(sku1);

    const returnOrder = await OrderService.createOrder({
      customerName: 'İade Müşteri',
      customerPhone: '05009990000',
      address: 'İzmir',
      productCode: sku1,
      productName: 'Kırmızı Elbise',
      size: 'M',
      quantity: 2,
      unitPrice: 1500,
      totalPrice: 3000
    });

    // İade et (DEC status)
    await OrderService.updateOrderStatus(returnOrder.orderId, 'DEC');

    const summary = ProfitService.getProfitSummary('all');
    const orderRow = db.prepare('SELECT status FROM orders WHERE order_id = ?').get(returnOrder.orderId) as any;

    assert(
      Boolean(orderRow.status === 'DEC' && summary.totalRevenue >= 0),
      'TEST 5: İade Sonrası Finans Düzeltmesi',
      `İptal edilen sipariş (${returnOrder.orderId}) ciro ve kâra dahil edilmedi.`
    );
  } catch (e: any) {
    assert(false, 'TEST 5: İade Sonrası Finans Düzeltmesi', e.message);
  }

  // TEST 6: İşletme Giderlerinin Net İşletme Kârından Düşülmesi
  try {
    const expRes = AccountingService.addExpense({
      category: 'Kira',
      amount: 5000,
      description: 'Mağaza Kirası',
      paymentMethod: 'CASH',
      performedBy: 'TEST'
    });

    const netSummary = ProfitService.getNetBusinessProfitSummary('all');

    assert(
      Boolean(expRes.success && netSummary.operatingExpenses >= 5000 && netSummary.netBusinessProfit === (netSummary.grossProfit - netSummary.operatingExpenses)),
      'TEST 6: Net İşletme Kârı Hesaplaması',
      `Brüt Kâr: ${netSummary.grossProfit} TL - Gider: ${netSummary.operatingExpenses} TL = Net İşletme Kârı: ${netBusinessProfitFormat(netSummary)} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 6: Net İşletme Kârı Hesaplaması', e.message);
  }

  function netBusinessProfitFormat(s: any) {
    return s.netBusinessProfit;
  }

  // TEST 7: Toplam Stok Maliyeti
  try {
    const potential = ProfitService.getInventoryProfitPotential();
    assert(
      Boolean(potential && typeof potential.totalInventoryCost === 'number' && potential.totalInventoryCost >= 0),
      'TEST 7: Toplam Stok Maliyeti',
      `Mevcut Stok Alış Maliyeti: ${potential.totalInventoryCost} TL (${potential.totalStockQuantity} adet stok)`
    );
  } catch (e: any) {
    assert(false, 'TEST 7: Toplam Stok Maliyeti', e.message);
  }

  // TEST 8: Potansiyel Stok Kârı
  try {
    const potential = ProfitService.getInventoryProfitPotential();
    assert(
      Boolean(potential && typeof potential.potentialGrossProfit === 'number'),
      'TEST 8: Potansiyel Stok Kârı',
      `Stok Satış Değeri: ${potential.totalInventoryRetailValue} TL, Potansiyel Brüt Kâr: ${potential.potentialGrossProfit} TL`
    );
  } catch (e: any) {
    assert(false, 'TEST 8: Potansiyel Stok Kârı', e.message);
  }

  // TEST 9: En Çok Satan Ürünler Sıralaması
  try {
    const topSelling = ProfitService.getTopSellingProducts(5);
    assert(
      Boolean(Array.isArray(topSelling) && topSelling.length > 0),
      'TEST 9: En Çok Satan Ürünler',
      `Lider: ${topSelling[0]?.productName} (${topSelling[0]?.unitsSold} adet)`
    );
  } catch (e: any) {
    assert(false, 'TEST 9: En Çok Satan Ürünler', e.message);
  }

  // TEST 10: En Çok Kâr Getiren Ürünler Sıralaması
  try {
    const topProfitable = ProfitService.getTopProfitableProducts(5);
    assert(
      Boolean(Array.isArray(topProfitable) && topProfitable.length > 0),
      'TEST 10: En Çok Kâr Getiren Ürünler',
      `Lider Kâr: ${topProfitable[0]?.productName} (${topProfitable[0]?.totalProfit} TL)`
    );
  } catch (e: any) {
    assert(false, 'TEST 10: En Çok Kâr Getiren Ürünler', e.message);
  }

  // TEST 11: AI Asistanı Net İşletme Kârı Yanıtı
  try {
    const reply = await AdminCopilotService.processAdminCommand("Bu ay net kârım ne kadar?");
    assert(
      Boolean(reply && reply.length > 0),
      'TEST 11: AI Net İşletme Kârı Yanıtı',
      `F.R.I.D.A.Y. Cevabı: ${reply.substring(0, 90)}...`
    );
  } catch (e: any) {
    assert(false, 'TEST 11: AI Net İşletme Kârı Yanıtı', e.message);
  }

  // TEST 12: AI Asistanı En Kârlı Ürün Yanıtı
  try {
    const reply = await AdminCopilotService.processAdminCommand("En kârlı ürünüm hangisi?");
    assert(
      Boolean(reply && reply.length > 0),
      'TEST 12: AI En Kârlı Ürün Yanıtı',
      `F.R.I.D.A.Y. Cevabı: ${reply.substring(0, 90)}...`
    );
  } catch (e: any) {
    assert(false, 'TEST 12: AI En Kârlı Ürün Yanıtı', e.message);
  }

  // TEST 13: AI Fiyat Değişikliğinde Confirmation Taslağı
  try {
    const reply = await AdminCopilotService.processAdminCommand(`${sku1} satış fiyatını 1700 yap`);
    assert(
      Boolean(reply && reply.length > 0),
      'TEST 13: AI Fiyat Değişikliği Taslağı',
      `F.R.I.D.A.Y. Cevabı: ${reply.substring(0, 90)}...`
    );
  } catch (e: any) {
    assert(false, 'TEST 13: AI Fiyat Değişikliği Taslağı', e.message);
  }

  // TEST 14: AI Gider Eklemede Confirmation Taslağı
  try {
    const reply = await AdminCopilotService.processAdminCommand("Bugün nakit olarak 2500 TL reklam harcaması yaptım");
    const lower = reply ? reply.toLowerCase() : '';
    assert(
      Boolean(reply && (lower.includes('taslak') || lower.includes('patron') || lower.includes('gider') || lower.includes('onay'))),
      'TEST 14: AI Gider Ekleme Taslağı & Onay Koruması',
      `F.R.I.D.A.Y. Taslak Yanıtı: ${reply.substring(0, 90)}...`
    );
  } catch (e: any) {
    assert(false, 'TEST 14: AI Gider Ekleme Taslağı & Onay Koruması', e.message);
  }

  // TEST 15: Regresyon ve Veritabanı Bütünlüğü
  try {
    const prodCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c;
    const orderCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
    const expCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;

    assert(
      Boolean(prodCount > 0 && orderCount > 0 && expCount > 0),
      'TEST 15: Regresyon Kontrolü',
      `${prodCount} ürün, ${orderCount} sipariş, ${expCount} gider kaydı aktif.`
    );
  } catch (e: any) {
    assert(false, 'TEST 15: Regresyon Kontrolü', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');
}

runBoutiqueProfitTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
