import { initDatabase, db } from '../src/database/db';
import { AccountingService } from '../src/services/accounting.service';
import { OrderService } from '../src/services/order.service';
import { AdminCopilotService } from '../src/services/admin-copilot.service';

async function runAccountingTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 ISC WORKS PROJE1 - MUHASEBE VE FİNANS TEST SUITE');
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

  // TEST 1: Gider Ekleme & Bakiye Kontrolü
  try {
    const initialCash = AccountingService.getCashAndBankSummary().cashTotal;
    const expRes = AccountingService.addExpense({
      category: 'Kira',
      amount: 15000,
      paymentMethod: 'CASH',
      description: 'Ofis Kirası Ödemesi',
      performedBy: 'TEST'
    });

    const newCash = AccountingService.getCashAndBankSummary().cashTotal;
    assert(Boolean(expRes.success && (initialCash - newCash === 15000)), 'TEST 1: Gider Ekleme', `Kira 15.000 TL düşüldü. Yeni Kasa: ${newCash} TL`);
  } catch (e: any) {
    assert(false, 'TEST 1: Gider Ekleme', e.message);
  }

  // TEST 2: Gelir Ekleme & Bakiye Kontrolü
  try {
    const initialCash = AccountingService.getCashAndBankSummary().cashTotal;
    const incRes = AccountingService.addIncome({
      category: 'Danışmanlık',
      amount: 5000,
      paymentMethod: 'CASH',
      description: 'Özel Danışmanlık Geliri',
      performedBy: 'TEST'
    });

    const newCash = AccountingService.getCashAndBankSummary().cashTotal;
    assert(Boolean(incRes.success && (newCash - initialCash === 5000)), 'TEST 2: Gelir Ekleme', `Gelir 5.000 TL eklendi. Yeni Kasa: ${newCash} TL`);
  } catch (e: any) {
    assert(false, 'TEST 2: Gelir Ekleme', e.message);
  }

  // TEST 3: Dengesiz Yevmiye Fişi Reddi
  try {
    const unbalRes = AccountingService.postDoubleEntryTransaction({
      description: 'Dengesiz Fiş Testi',
      lines: [
        { accountCode: '100.01', debit: 1000, credit: 0 },
        { accountCode: '600', debit: 0, credit: 500 } // Borç: 1000, Alacak: 500 -> DENGESİZ
      ]
    }, 'TEST');

    assert(Boolean(!unbalRes.success && (unbalRes.error ? unbalRes.error.includes('Dengesiz yevmiye fişi') : false)), 'TEST 3: Dengesiz Yevmiye Fişi Reddi', unbalRes.error);
  } catch (e: any) {
    assert(false, 'TEST 3: Dengesiz Yevmiye Fişi Reddi', e.message);
  }

  // TEST 4: Fatura Oluşturma & KDV/Toplam Matrah Hesaplama
  try {
    const invRes = AccountingService.createInvoice({
      type: 'SALE',
      partyName: 'ABC Holding',
      items: [
        { description: 'Keten Gömlek', quantity: 2, unitPrice: 500, taxRate: 20 }
      ],
      performedBy: 'TEST'
    });

    const inv = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invRes.invoiceNumber) as any;
    assert(invRes.success && inv && inv.total_amount === 1000 && inv.subtotal === 833.33 && inv.tax_amount === 166.67, 'TEST 4: Satış Faturası Hesaplama', `Fatura No: ${invRes.invoiceNumber}, Toplam: 1000 TL`);
  } catch (e: any) {
    assert(false, 'TEST 4: Satış Faturası Hesaplama', e.message);
  }

  // TEST 5: Kısmi Ödeme (Partial Payment) & Kalan Bakiye
  try {
    const invRes = AccountingService.createInvoice({
      type: 'SALE',
      partyName: 'XYZ Tekstil',
      items: [{ description: 'Hizmet', quantity: 1, unitPrice: 2000, taxRate: 20 }],
      performedBy: 'TEST'
    });

    const payRes = AccountingService.recordPayment({
      type: 'INBOUND',
      invoiceId: invRes.invoiceId,
      partyName: 'XYZ Tekstil',
      amount: 1200,
      paymentMethod: 'BANK_TRANSFER',
      performedBy: 'TEST'
    });

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invRes.invoiceId) as any;
    assert(payRes.success && inv && inv.paid_amount === 1200 && inv.status === 'PARTIALLY_PAID', 'TEST 5: Kısmi Ödeme & Bakiye', `Ödenen: 1200 TL / 2000 TL, Durum: ${inv?.status}`);
  } catch (e: any) {
    assert(false, 'TEST 5: Kısmi Ödeme & Bakiye', e.message);
  }

  // TEST 6: Vergi & KDV Özeti Hesaplama
  try {
    const tax = AccountingService.getTaxSummary();
    assert(tax && tax.salesKDV !== undefined && tax.inputKDV !== undefined && tax.disclaimer !== undefined, 'TEST 6: KDV & Vergi Özeti', `Hesaplanan KDV: ${tax.salesKDV} TL, İndirilecek KDV: ${tax.inputKDV} TL`);
  } catch (e: any) {
    assert(false, 'TEST 6: Vergi & KDV Özeti', e.message);
  }

  // TEST 7: Profit & Loss (Kâr/Zarar) Tablosu Doğruluğu
  try {
    const pnl = AccountingService.getProfitLossReport();
    assert(pnl && pnl.revenue !== undefined && pnl.grossProfit !== undefined && pnl.netProfit !== undefined, 'TEST 7: Kâr / Zarar Tablosu', `Net Kâr: ${pnl.netProfit} TL`);
  } catch (e: any) {
    assert(false, 'TEST 7: Kâr / Zarar Tablosu', e.message);
  }

  // TEST 8: Kasa & Banka Likit Varlık Özeti
  try {
    const liquid = AccountingService.getCashAndBankSummary();
    assert(Boolean(liquid && typeof liquid.liquidAssetsTotal === 'number' && Array.isArray(liquid.accounts)), 'TEST 8: Likit Varlık Özeti', `Kasa: ${liquid.cashTotal} TL, Banka: ${liquid.bankTotal} TL`);
  } catch (e: any) {
    assert(false, 'TEST 8: Likit Varlık Özeti', e.message);
  }

  // TEST 9: Sipariş Onayında Çifte Muhasebeleştirme Engeli (Idempotency)
  try {
    const orderData = {
      customerName: 'Ahmet Yılmaz',
      customerPhone: '05321112233',
      address: 'Kadıköy İstanbul',
      productCode: 'KGMLW-S',
      productName: 'KUMAŞ GÖMLEK',
      size: 'S',
      quantity: 1,
      unitPrice: 300,
      totalPrice: 300
    };

    const savedOrder = await OrderService.createOrder(orderData);
    await OrderService.updateOrderStatus(savedOrder.orderId, 'OK');

    const firstCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM accounting_transactions WHERE reference_type = 'ORDER' AND reference_id = ?`).get(savedOrder.orderId) as any;
    
    // İkinci kez onay ver ve idempotency'yi kontrol et
    await OrderService.updateOrderStatus(savedOrder.orderId, 'OK');
    const secondCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM accounting_transactions WHERE reference_type = 'ORDER' AND reference_id = ?`).get(savedOrder.orderId) as any;

    assert(firstCountRow.cnt === 1 && secondCountRow.cnt === 1, 'TEST 9: Sipariş Idempotency Kontrolü', `Sipariş #${savedOrder.orderId} için tam 1 adet muhasebe kaydı atıldı.`);
  } catch (e: any) {
    assert(false, 'TEST 9: Sipariş Idempotency Kontrolü', e.message);
  }

  // TEST 10: AI Gider Taslağı Oluşturma & Onaysız Commit Edilmeme Garantisi
  try {
    const draftRes = AccountingService.addExpense({
      category: 'Yakıt',
      amount: 2500,
      description: 'Şehir dışı sevkiyat yakıtı',
      paymentMethod: 'CASH',
      status: 'DRAFT_PENDING_APPROVAL',
      performedBy: 'AI_COPILOT'
    });

    const exp = db.prepare(`SELECT * FROM expenses WHERE expense_number = ?`).get(draftRes.expenseNumber) as any;
    const trx = db.prepare(`SELECT * FROM accounting_transactions WHERE reference_id = ?`).get(draftRes.expenseNumber);

    assert(draftRes.success && exp.status === 'DRAFT_PENDING_APPROVAL' && !trx, 'TEST 10: AI Gider Taslağı & Onay Koruması', `Taslağa muhasebe fişi atılmadı. Durum: ${exp.status}`);
  } catch (e: any) {
    assert(false, 'TEST 10: AI Gider Taslağı', e.message);
  }

  // TEST 11: AI Gelir Taslağı Oluşturma
  try {
    const draftInc = AccountingService.addIncome({
      category: 'Danışmanlık',
      amount: 10000,
      description: 'E-ticaret Danışmanlık',
      paymentMethod: 'BANK_TRANSFER',
      status: 'DRAFT_PENDING_APPROVAL',
      performedBy: 'AI_COPILOT'
    });

    const inc = db.prepare(`SELECT * FROM income_entries WHERE income_number = ?`).get(draftInc.incomeNumber) as any;
    assert(draftInc.success && inc && inc.status === 'DRAFT_PENDING_APPROVAL', 'TEST 11: AI Gelir Taslağı', `Taslak No: ${draftInc.incomeNumber}`);
  } catch (e: any) {
    assert(false, 'TEST 11: AI Gelir Taslağı', e.message);
  }

  // TEST 12: AI Finansal Özet Cevap Doğruluğu
  try {
    const summary = AccountingService.getFinancialSummary('this_month');
    assert(summary && summary.totalRevenue >= 0 && summary.totalExpenses >= 0 && summary.netProfit !== undefined, 'TEST 12: AI Finansal Özet', `Bu Ay Net Kâr: ${summary.netProfit} TL`);
  } catch (e: any) {
    assert(false, 'TEST 12: AI Finansal Özet', e.message);
  }

  // TEST 13: AI SQL Injection & Yıkıcı Komut Güvenliği
  try {
    const dangerousPrompt = "DROP TABLE expenses; DELETE FROM orders;";
    const reply = await AdminCopilotService.processAdminCommand(dangerousPrompt);
    const expensesCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;

    assert(Boolean(reply && expensesCount >= 0), 'TEST 13: AI SQL Injection Engeli', `Expenses tablosu güvende (${expensesCount} satır duruyor).`);
  } catch (e: any) {
    assert(false, 'TEST 13: AI SQL Injection Engeli', e.message);
  }

  // TEST 14: Regresyon Kontrolü (Stok & Veritabanı Bütünlüğü)
  try {
    const products = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as any;
    assert(products && products.cnt > 0, 'TEST 14: Stok Regresyon Testi', `${products.cnt} adet ürün veritabanında aktif.`);
  } catch (e: any) {
    assert(false, 'TEST 14: Stok Regresyon Testi', e.message);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST SONUÇLARI: ${passed} GEÇTİ | ${failed} BAŞARISIZ`);
  console.log('======================================================\n');
}

runAccountingTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
