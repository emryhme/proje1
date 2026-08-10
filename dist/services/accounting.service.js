"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountingService = void 0;
const db_1 = require("../database/db");
/**
 * Enterprise Double-Entry Accounting & Financial Management Service
 */
class AccountingService {
    /**
     * YYYY-MM-DD formatında bugünün tarihini verir
     */
    static getTodayDateString() {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }
    /**
     * Benzersiz İşlem/Fiş Numarası Üreticisi
     */
    static generateNumber(prefix) {
        const time = Date.now().toString().slice(-6);
        const rand = Math.floor(1000 + Math.random() * 9000);
        return `${prefix}-${time}-${rand}`;
    }
    /**
     * Denetim İzi (Audit Log) Ekler
     */
    static addAuditLog(action, entityType, entityId, performedBy, details) {
        try {
            const stmt = db_1.db.prepare(`
        INSERT INTO accounting_audit_logs (action, entity_type, entity_id, performed_by, details)
        VALUES (?, ?, ?, ?, ?)
      `);
            stmt.run(action, entityType, entityId, performedBy || 'SYSTEM', typeof details === 'object' ? JSON.stringify(details) : String(details));
        }
        catch (e) {
            console.error('[AccountingService AuditLog Error]:', e.message);
        }
    }
    /**
     * Çift Taraflı Yevmiye Fişi (Double-Entry Transaction) Kaydeder.
     * GÜVENLİK İLKESİ: Debit Total == Credit Total Eşitliği ŞARTTIR.
     */
    static postDoubleEntryTransaction(input, performedBy = 'SYSTEM') {
        if (!input.lines || input.lines.length < 2) {
            return { success: false, error: 'Muhasebe kaydı en az 2 hesaptan (çift taraflı) oluşmalıdır.' };
        }
        let debitTotal = 0;
        let creditTotal = 0;
        for (const l of input.lines) {
            debitTotal += Number(l.debit) || 0;
            creditTotal += Number(l.credit) || 0;
        }
        // Eşitlik Toleransı (Kuruş Farki için 0.01 TL)
        if (Math.abs(debitTotal - creditTotal) > 0.01) {
            return {
                success: false,
                error: `Dengesiz yevmiye fişi! Borç Toplamı (${debitTotal.toFixed(2)} TL) ve Alacak Toplamı (${creditTotal.toFixed(2)} TL) eşit olmalıdır.`
            };
        }
        const dateStr = input.date || this.getTodayDateString();
        const trxNumber = this.generateNumber('TRX');
        try {
            const runTransaction = db_1.db.transaction(() => {
                // 1. Ana Fiş Kaydı
                const trxStmt = db_1.db.prepare(`
          INSERT INTO accounting_transactions (transaction_number, date, description, reference_type, reference_id, debit_total, credit_total, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED')
        `);
                const result = trxStmt.run(trxNumber, dateStr, input.description, input.referenceType || 'MANUAL', input.referenceId || null, debitTotal, creditTotal);
                const trxId = result.lastInsertRowid;
                // 2. Fiş Satırları & Hesap Bakiyesi Güncellemeleri
                const lineStmt = db_1.db.prepare(`
          INSERT INTO accounting_transaction_lines (transaction_id, account_code, debit, credit, description)
          VALUES (?, ?, ?, ?, ?)
        `);
                const updateAccountStmt = db_1.db.prepare(`
          UPDATE accounting_accounts
          SET balance = balance + (? - ?)
          WHERE code = ?
        `);
                for (const l of input.lines) {
                    const debit = Number(l.debit) || 0;
                    const credit = Number(l.credit) || 0;
                    lineStmt.run(trxId, l.accountCode, debit, credit, l.description || input.description);
                    // Hesap Bakiyesini Hesapla
                    updateAccountStmt.run(debit, credit, l.accountCode);
                }
            });
            runTransaction();
            this.addAuditLog('POST', 'TRANSACTION', trxNumber, performedBy, { debitTotal, creditTotal, lines: input.lines.length });
            console.log(`[AccountingService] ⚖️ Yevmiye Fişi Post Edildi: ${trxNumber} (Borç/Alacak: ${debitTotal.toFixed(2)} TL)`);
            return { success: true, transactionNumber: trxNumber };
        }
        catch (e) {
            console.error('[AccountingService Transaction Error]:', e.message);
            return { success: false, error: e.message };
        }
    }
    /**
     * Tamamlanan/Onaylanan Siparişlerin Otomatik Muhasebeleştirilmesi (Idempotent)
     */
    static recordOrderFinancials(orderId, performedBy = 'SYSTEM') {
        try {
            // 1. Idempotency Kontrolü: Bu sipariş zaten muhasebeleştirildi mi?
            const existing = db_1.db.prepare(`SELECT id FROM accounting_transactions WHERE reference_type = 'ORDER' AND reference_id = ?`).get(orderId);
            if (existing) {
                return { success: true, message: `Sipariş #${orderId} zaten muhasebeleştirilmiş.` };
            }
            // 2. Sipariş Detaylarını Çek
            const order = db_1.db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId);
            if (!order) {
                return { success: false, message: `Sipariş #${orderId} bulunamadı.` };
            }
            const totalPrice = Number(order.total_price) || (Number(order.unit_price || 0) * Number(order.quantity || 1)) + Number(order.shipping_fee || 0) - Number(order.discount || 0);
            if (totalPrice <= 0) {
                return { success: true, message: `Sipariş tutarı 0 TL olduğu için muhasebe kaydı atlanıldı.` };
            }
            // 3. Ürünün Alış Maliyetini (COGS) Hesapla
            const prod = db_1.db.prepare(`SELECT price, cost_price FROM products WHERE product_code = ?`).get(order.product_code);
            const costPrice = prod && prod.cost_price ? Number(prod.cost_price) : (prod && prod.price ? Number(prod.price) * 0.5 : 0);
            const totalCOGS = costPrice * Number(order.quantity || 1);
            // KDV Ayrıştırması (%20 Dahil)
            const subtotal = Math.round((totalPrice / 1.20) * 100) / 100;
            const taxAmount = Math.round((totalPrice - subtotal) * 100) / 100;
            const lines = [
                { accountCode: '100.01', debit: totalPrice, credit: 0, description: `Sipariş #${orderId} Tahsilat` },
                { accountCode: '600', debit: 0, credit: subtotal, description: `Sipariş #${orderId} Satış Geliri` },
                { accountCode: '391', debit: 0, credit: taxAmount, description: `Sipariş #${orderId} Hesaplanan KDV (%20)` }
            ];
            // Eğer Ürün Alış Maliyeti Varsa STMM Kaydı da At
            if (totalCOGS > 0) {
                lines.push({ accountCode: '621', debit: totalCOGS, credit: 0, description: `Sipariş #${orderId} STMM (Ürün Maliyeti)` });
                lines.push({ accountCode: '150', debit: 0, credit: totalCOGS, description: `Sipariş #${orderId} Stoktan Çıkış` });
            }
            const res = this.postDoubleEntryTransaction({
                description: `Sipariş #${orderId} Otomatik Satış Muhasebe Kaydı`,
                referenceType: 'ORDER',
                referenceId: orderId,
                date: this.getTodayDateString(),
                lines
            }, performedBy);
            return res;
        }
        catch (e) {
            console.error('[AccountingService OrderRecord Error]:', e.message);
            return { success: false, message: e.message };
        }
    }
    /**
     * Gider Ekleme (Expense Creation)
     */
    static addExpense(input) {
        try {
            const expenseNo = this.generateNumber('EXP');
            const amount = Number(input.amount) || 0;
            const taxRate = input.taxRate !== undefined ? Number(input.taxRate) : 20.0;
            const subtotal = Math.round((amount / (1 + taxRate / 100)) * 100) / 100;
            const taxAmount = Math.round((amount - subtotal) * 100) / 100;
            const accCode = input.accountCode || (input.paymentMethod === 'BANK_TRANSFER' ? '102.01' : '100.01');
            const status = input.status || 'CONFIRMED';
            const dateStr = input.date || this.getTodayDateString();
            const stmt = db_1.db.prepare(`
        INSERT INTO expenses (expense_number, category, amount, tax_amount, tax_rate, currency, payment_method, account_code, supplier_name, description, invoice_number, is_recurring, status, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(expenseNo, input.category.trim(), amount, taxAmount, taxRate, input.currency || 'TRY', input.paymentMethod, accCode, input.supplierName || '', input.description.trim(), input.invoiceNumber || '', input.isRecurring ? 1 : 0, status, dateStr);
            if (status === 'CONFIRMED') {
                const lines = [
                    { accountCode: '770', debit: subtotal, credit: 0, description: `${input.category} Gideri (${input.description})` },
                    { accountCode: accCode, debit: 0, credit: amount, description: `${input.category} Gider Ödemesi (${accCode})` }
                ];
                if (taxAmount > 0) {
                    lines.push({ accountCode: '191', debit: taxAmount, credit: 0, description: `${input.category} İndirilecek KDV (%${taxRate})` });
                }
                this.postDoubleEntryTransaction({
                    description: `Gider Kaydı #${expenseNo} - ${input.category}`,
                    referenceType: 'EXPENSE',
                    referenceId: expenseNo,
                    date: dateStr,
                    lines
                }, input.performedBy || 'USER');
            }
            this.addAuditLog('CREATE', 'EXPENSE', expenseNo, input.performedBy || 'USER', { amount, category: input.category, status });
            return { success: true, expenseNumber: expenseNo };
        }
        catch (e) {
            console.error('[AccountingService addExpense Error]:', e.message);
            return { success: false, error: e.message };
        }
    }
    /**
     * Gelir Ekleme (Income Creation)
     */
    static addIncome(input) {
        try {
            const incomeNo = this.generateNumber('INC');
            const amount = Number(input.amount) || 0;
            const taxRate = input.taxRate !== undefined ? Number(input.taxRate) : 20.0;
            const subtotal = Math.round((amount / (1 + taxRate / 100)) * 100) / 100;
            const taxAmount = Math.round((amount - subtotal) * 100) / 100;
            const accCode = input.accountCode || (input.paymentMethod === 'BANK_TRANSFER' ? '102.01' : '100.01');
            const status = input.status || 'CONFIRMED';
            const dateStr = input.date || this.getTodayDateString();
            const stmt = db_1.db.prepare(`
        INSERT INTO income_entries (income_number, category, amount, tax_amount, currency, payment_method, account_code, customer_name, description, status, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(incomeNo, input.category.trim(), amount, taxAmount, input.currency || 'TRY', input.paymentMethod, accCode, input.customerName || '', input.description.trim(), status, dateStr);
            if (status === 'CONFIRMED') {
                const lines = [
                    { accountCode: accCode, debit: amount, credit: 0, description: `${input.category} Gelir Tahsilatı (${accCode})` },
                    { accountCode: '602', debit: 0, credit: subtotal, description: `${input.category} Geliri` }
                ];
                if (taxAmount > 0) {
                    lines.push({ accountCode: '391', debit: 0, credit: taxAmount, description: `${input.category} Hesaplanan KDV (%${taxRate})` });
                }
                this.postDoubleEntryTransaction({
                    description: `Gelir Kaydı #${incomeNo} - ${input.category}`,
                    referenceType: 'INCOME',
                    referenceId: incomeNo,
                    date: dateStr,
                    lines
                }, input.performedBy || 'USER');
            }
            this.addAuditLog('CREATE', 'INCOME', incomeNo, input.performedBy || 'USER', { amount, category: input.category, status });
            return { success: true, incomeNumber: incomeNo };
        }
        catch (e) {
            console.error('[AccountingService addIncome Error]:', e.message);
            return { success: false, error: e.message };
        }
    }
    /**
     * Taslak Gider/Gelir Onaylama (Confirm AI Draft)
     */
    static confirmDraft(type, idOrNumber, performedBy = 'USER') {
        try {
            if (type === 'EXPENSE') {
                const expense = db_1.db.prepare(`SELECT * FROM expenses WHERE id = ? OR expense_number = ?`).get(idOrNumber, idOrNumber);
                if (!expense)
                    return { success: false, error: 'Gider taslağı bulunamadı.' };
                if (expense.status === 'CONFIRMED')
                    return { success: true };
                db_1.db.prepare(`UPDATE expenses SET status = 'CONFIRMED' WHERE id = ?`).run(expense.id);
                const subtotal = Math.round((expense.amount / (1 + (expense.tax_rate || 20) / 100)) * 100) / 100;
                const taxAmount = expense.tax_amount || 0;
                const lines = [
                    { accountCode: '770', debit: subtotal, credit: 0, description: `${expense.category} Gideri` },
                    { accountCode: expense.account_code || '100.01', debit: 0, credit: expense.amount, description: `${expense.category} Ödemesi` }
                ];
                if (taxAmount > 0) {
                    lines.push({ accountCode: '191', debit: taxAmount, credit: 0, description: `${expense.category} KDV` });
                }
                this.postDoubleEntryTransaction({
                    description: `Gider Onayı #${expense.expense_number}`,
                    referenceType: 'EXPENSE',
                    referenceId: expense.expense_number,
                    date: expense.date,
                    lines
                }, performedBy);
                this.addAuditLog('CONFIRM_DRAFT', 'EXPENSE', expense.expense_number, performedBy, { amount: expense.amount });
                return { success: true };
            }
            else {
                const income = db_1.db.prepare(`SELECT * FROM income_entries WHERE id = ? OR income_number = ?`).get(idOrNumber, idOrNumber);
                if (!income)
                    return { success: false, error: 'Gelir taslağı bulunamadı.' };
                if (income.status === 'CONFIRMED')
                    return { success: true };
                db_1.db.prepare(`UPDATE income_entries SET status = 'CONFIRMED' WHERE id = ?`).run(income.id);
                const subtotal = Math.round((income.amount / 1.20) * 100) / 100;
                const taxAmount = income.tax_amount || 0;
                const lines = [
                    { accountCode: income.account_code || '100.01', debit: income.amount, credit: 0, description: `${income.category} Tahsilatı` },
                    { accountCode: '602', debit: 0, credit: subtotal, description: `${income.category} Geliri` }
                ];
                if (taxAmount > 0) {
                    lines.push({ accountCode: '391', debit: 0, credit: taxAmount, description: `${income.category} KDV` });
                }
                this.postDoubleEntryTransaction({
                    description: `Gelir Onayı #${income.income_number}`,
                    referenceType: 'INCOME',
                    referenceId: income.income_number,
                    date: income.date,
                    lines
                }, performedBy);
                this.addAuditLog('CONFIRM_DRAFT', 'INCOME', income.income_number, performedBy, { amount: income.amount });
                return { success: true };
            }
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }
    /**
     * Fatura Oluşturma (Create Invoice)
     */
    static createInvoice(input) {
        if (!input.items || input.items.length === 0) {
            return { success: false, error: 'Fatura en az bir adet kalem içermelidir.' };
        }
        try {
            const invNumber = this.generateNumber(input.type === 'SALE' ? 'INV-S' : 'INV-P');
            const dateStr = input.date || this.getTodayDateString();
            let subtotal = 0;
            let totalTax = 0;
            const processedItems = input.items.map(item => {
                const qty = Number(item.quantity) || 1;
                const price = Number(item.unitPrice) || 0;
                const taxRate = item.taxRate !== undefined ? Number(item.taxRate) : 20.0;
                const lineTotalRaw = qty * price;
                const lineSubtotal = Math.round((lineTotalRaw / (1 + taxRate / 100)) * 100) / 100;
                const lineTax = Math.round((lineTotalRaw - lineSubtotal) * 100) / 100;
                subtotal += lineSubtotal;
                totalTax += lineTax;
                return {
                    productCode: item.productCode || '',
                    description: item.description || '',
                    quantity: qty,
                    unitPrice: price,
                    taxRate,
                    taxAmount: lineTax,
                    total: lineTotalRaw
                };
            });
            const totalAmount = subtotal + totalTax;
            let invoiceId = 0;
            const runInvTransaction = db_1.db.transaction(() => {
                const stmt = db_1.db.prepare(`
          INSERT INTO invoices (invoice_number, type, party_name, party_phone, date, due_date, subtotal, tax_amount, total_amount, paid_amount, currency, status, order_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'ISSUED', ?)
        `);
                const res = stmt.run(invNumber, input.type, input.partyName.trim(), input.partyPhone || '', dateStr, input.dueDate || null, subtotal, totalTax, totalAmount, input.currency || 'TRY', input.orderId || null);
                invoiceId = res.lastInsertRowid;
                const itemStmt = db_1.db.prepare(`
          INSERT INTO invoice_items (invoice_id, product_code, description, quantity, unit_price, tax_rate, tax_amount, total)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
                for (const item of processedItems) {
                    itemStmt.run(invoiceId, item.productCode, item.description, item.quantity, item.unitPrice, item.taxRate, item.taxAmount, item.total);
                }
            });
            runInvTransaction();
            // Muhasebe Kaydı (Double-Entry)
            if (input.type === 'SALE') {
                this.postDoubleEntryTransaction({
                    description: `Satış Faturası #${invNumber} (${input.partyName})`,
                    referenceType: 'INVOICE',
                    referenceId: invNumber,
                    date: dateStr,
                    lines: [
                        { accountCode: '120', debit: totalAmount, credit: 0, description: `Alıcılar - ${input.partyName}` },
                        { accountCode: '600', debit: 0, credit: subtotal, description: 'Satış Geliri' },
                        { accountCode: '391', debit: 0, credit: totalTax, description: 'Hesaplanan KDV' }
                    ]
                }, input.performedBy || 'USER');
            }
            else {
                this.postDoubleEntryTransaction({
                    description: `Alış Faturası #${invNumber} (${input.partyName})`,
                    referenceType: 'INVOICE',
                    referenceId: invNumber,
                    date: dateStr,
                    lines: [
                        { accountCode: '770', debit: subtotal, credit: 0, description: 'Mal/Hizmet Alım Gideri' },
                        { accountCode: '191', debit: totalTax, credit: 0, description: 'İndirilecek KDV' },
                        { accountCode: '320', debit: 0, credit: totalAmount, description: `Satıcılar - ${input.partyName}` }
                    ]
                }, input.performedBy || 'USER');
            }
            this.addAuditLog('CREATE', 'INVOICE', invNumber, input.performedBy || 'USER', { totalAmount, partyName: input.partyName });
            return { success: true, invoiceNumber: invNumber, invoiceId };
        }
        catch (e) {
            console.error('[AccountingService createInvoice Error]:', e.message);
            return { success: false, error: e.message };
        }
    }
    /**
     * Ödeme/Tahsilat Kaydı (Record Payment)
     */
    static recordPayment(input) {
        try {
            const payNumber = this.generateNumber('PAY');
            const amount = Number(input.amount) || 0;
            const accCode = input.accountCode || (input.paymentMethod === 'BANK_TRANSFER' ? '102.01' : '100.01');
            const dateStr = input.date || this.getTodayDateString();
            const stmt = db_1.db.prepare(`
        INSERT INTO accounting_payments (payment_number, type, invoice_id, party_name, amount, currency, payment_method, account_code, date, reference_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(payNumber, input.type, input.invoiceId || null, input.partyName.trim(), amount, input.currency || 'TRY', input.paymentMethod, accCode, dateStr, input.referenceNo || '');
            // Fatura Bakiyesini Güncelle
            if (input.invoiceId) {
                const inv = db_1.db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(input.invoiceId);
                if (inv) {
                    const newPaid = (Number(inv.paid_amount) || 0) + amount;
                    let newStatus = inv.status;
                    if (newPaid >= inv.total_amount) {
                        newStatus = 'PAID';
                    }
                    else if (newPaid > 0) {
                        newStatus = 'PARTIALLY_PAID';
                    }
                    db_1.db.prepare(`UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?`).run(newPaid, newStatus, inv.id);
                }
            }
            // Çift Taraflı Yevmiye Fişi
            if (input.type === 'INBOUND') { // Tahsilat (Müşteriden Gelen Para)
                this.postDoubleEntryTransaction({
                    description: `Tahsilat #${payNumber} (${input.partyName})`,
                    referenceType: 'PAYMENT',
                    referenceId: payNumber,
                    date: dateStr,
                    lines: [
                        { accountCode: accCode, debit: amount, credit: 0, description: `Kasa/Banka Tahsilat (${accCode})` },
                        { accountCode: '120', debit: 0, credit: amount, description: `Alıcılar Cari Alacağı (${input.partyName})` }
                    ]
                }, input.performedBy || 'USER');
            }
            else { // Ödeme (Tedarikçiye Giden Para)
                this.postDoubleEntryTransaction({
                    description: `Tedarikçi Ödemesi #${payNumber} (${input.partyName})`,
                    referenceType: 'PAYMENT',
                    referenceId: payNumber,
                    date: dateStr,
                    lines: [
                        { accountCode: '320', debit: amount, credit: 0, description: `Satıcılar Cari Borcu (${input.partyName})` },
                        { accountCode: accCode, debit: 0, credit: amount, description: `Kasa/Banka Ödemesi (${accCode})` }
                    ]
                }, input.performedBy || 'USER');
            }
            this.addAuditLog('CREATE', 'PAYMENT', payNumber, input.performedBy || 'USER', { amount, partyName: input.partyName });
            return { success: true, paymentNumber: payNumber };
        }
        catch (e) {
            console.error('[AccountingService recordPayment Error]:', e.message);
            return { success: false, error: e.message };
        }
    }
    /**
     * Likit Varlıklar Özeti (Kasa, Bankalar, Toplam Likidite)
     */
    static getCashAndBankSummary() {
        try {
            const accounts = db_1.db.prepare(`SELECT code, name, type, balance, currency FROM accounting_accounts WHERE code LIKE '100%' OR code LIKE '102%' ORDER BY code ASC`).all();
            let cashTotal = 0;
            let bankTotal = 0;
            for (const acc of accounts) {
                const bal = Number(acc.balance) || 0;
                if (acc.code.startsWith('100')) {
                    cashTotal += bal;
                }
                else if (acc.code.startsWith('102')) {
                    bankTotal += bal;
                }
            }
            return {
                cashTotal,
                bankTotal,
                liquidAssetsTotal: cashTotal + bankTotal,
                accounts
            };
        }
        catch (e) {
            return { cashTotal: 0, bankTotal: 0, liquidAssetsTotal: 0, accounts: [] };
        }
    }
    /**
     * Genel Finansal Özet (Token-Optimized Aggregation for AI & Admin Dashboard)
     */
    static getFinancialSummary(period = 'this_month') {
        try {
            const dateFilter = this.getDateFilterClause(period);
            // 1. Toplam Satış Geliri (Revenue)
            const revRow = db_1.db.prepare(`
        SELECT SUM(total_price) as totalRev, COUNT(*) as count 
        FROM orders 
        WHERE status != 'DEC' ${dateFilter.replace('date', 'created_at')}
      `).get();
            const salesRevenue = Number(revRow?.totalRev) || 0;
            // 2. Ek Gelirler
            const incRow = db_1.db.prepare(`
        SELECT SUM(amount) as totalInc 
        FROM income_entries 
        WHERE status = 'CONFIRMED' ${dateFilter}
      `).get();
            const otherIncome = Number(incRow?.totalInc) || 0;
            const totalRevenue = salesRevenue + otherIncome;
            // 3. Toplam Giderler (Expenses)
            const expRow = db_1.db.prepare(`
        SELECT SUM(amount) as totalExp 
        FROM expenses 
        WHERE status = 'CONFIRMED' ${dateFilter}
      `).get();
            const totalExpenses = Number(expRow?.totalExp) || 0;
            // 4. Kategori Bazlı En Yüksek Giderler
            const topExpenses = db_1.db.prepare(`
        SELECT category, SUM(amount) as total 
        FROM expenses 
        WHERE status = 'CONFIRMED' ${dateFilter} 
        GROUP BY category 
        ORDER BY total DESC 
        LIMIT 5
      `).all();
            // 5. Kasa & Banka Likit Durumu
            const liquid = this.getCashAndBankSummary();
            // 6. Alacaklar & Borçlar (Receivables & Payables)
            const recRow = db_1.db.prepare(`SELECT SUM(total_amount - paid_amount) as totalRec FROM invoices WHERE type = 'SALE' AND status != 'PAID' AND status != 'CANCELLED'`).get();
            const payRow = db_1.db.prepare(`SELECT SUM(total_amount - paid_amount) as totalPay FROM invoices WHERE type = 'PURCHASE' AND status != 'PAID' AND status != 'CANCELLED'`).get();
            const totalReceivables = Number(recRow?.totalRec) || 0;
            const totalPayables = Number(payRow?.totalPay) || 0;
            // 7. Net Kâr (Net Profit)
            const netProfit = totalRevenue - totalExpenses;
            return {
                period,
                totalRevenue,
                salesRevenue,
                otherIncome,
                totalExpenses,
                netProfit,
                profitMarginPercent: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0,
                cashBalance: liquid.cashTotal,
                bankBalance: liquid.bankTotal,
                totalLiquidAssets: liquid.liquidAssetsTotal,
                totalReceivables,
                totalPayables,
                topExpenses
            };
        }
        catch (e) {
            console.error('[AccountingService getFinancialSummary Error]:', e.message);
            return { error: e.message };
        }
    }
    /**
     * Kâr / Zarar Tablosu (Profit & Loss Statement)
     */
    static getProfitLossReport(startDate, endDate) {
        try {
            const start = startDate || '2026-01-01';
            const end = endDate || this.getTodayDateString();
            // Satış Hasılatı
            const salesRow = db_1.db.prepare(`SELECT SUM(total_price) as sum FROM orders WHERE status != 'DEC' AND DATE(created_at) >= ? AND DATE(created_at) <= ?`).get(start, end);
            const grossSales = Number(salesRow?.sum) || 0;
            // STMM / Satılan Mal Maliyeti (COGS)
            const cogsRow = db_1.db.prepare(`
        SELECT SUM(o.quantity * COALESCE(p.cost_price, p.price * 0.5)) as totalCost
        FROM orders o
        JOIN products p ON o.product_code = p.product_code
        WHERE o.status != 'DEC' AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?
      `).get(start, end);
            const cogs = Number(cogsRow?.totalCost) || 0;
            const grossProfit = grossSales - cogs;
            // Faaliyet Giderleri
            const expRow = db_1.db.prepare(`SELECT SUM(amount) as sum FROM expenses WHERE status = 'CONFIRMED' AND date >= ? AND date <= ?`).get(start, end);
            const operatingExpenses = Number(expRow?.sum) || 0;
            const netProfit = grossProfit - operatingExpenses;
            return {
                startDate: start,
                endDate: end,
                revenue: grossSales,
                cogs,
                grossProfit,
                operatingExpenses,
                netProfit,
                grossMarginPercent: grossSales > 0 ? Math.round((grossProfit / grossSales) * 1000) / 10 : 0,
                netMarginPercent: grossSales > 0 ? Math.round((netProfit / grossSales) * 1000) / 10 : 0
            };
        }
        catch (e) {
            return { error: e.message };
        }
    }
    /**
     * Basit Bilanço (Balance Sheet)
     */
    static getBalanceSheet() {
        try {
            const liquid = this.getCashAndBankSummary();
            const recRow = db_1.db.prepare(`SELECT SUM(total_amount - paid_amount) as total FROM invoices WHERE type = 'SALE' AND status != 'PAID'`).get();
            const invRow = db_1.db.prepare(`SELECT SUM(stock * COALESCE(cost_price, price * 0.5)) as total FROM products`).get();
            const payRow = db_1.db.prepare(`SELECT SUM(total_amount - paid_amount) as total FROM invoices WHERE type = 'PURCHASE' AND status != 'PAID'`).get();
            const currentAssets = {
                cash: liquid.cashTotal,
                bank: liquid.bankTotal,
                receivables: Number(recRow?.total) || 0,
                inventory: Number(invRow?.total) || 0,
                totalAssets: liquid.liquidAssetsTotal + (Number(recRow?.total) || 0) + (Number(invRow?.total) || 0)
            };
            const liabilities = {
                payables: Number(payRow?.total) || 0,
                totalLiabilities: Number(payRow?.total) || 0
            };
            const equity = {
                retainedEarnings: currentAssets.totalAssets - liabilities.totalLiabilities,
                totalEquity: currentAssets.totalAssets - liabilities.totalLiabilities
            };
            return {
                assets: currentAssets,
                liabilities,
                equity
            };
        }
        catch (e) {
            return { error: e.message };
        }
    }
    /**
     * Vergi / KDV Özeti
     */
    static getTaxSummary() {
        try {
            const dateFilter = this.getDateFilterClause('this_month');
            const salesTaxRow = db_1.db.prepare(`SELECT SUM(total_price - (total_price / 1.20)) as tax FROM orders WHERE status != 'DEC' ${dateFilter.replace('date', 'created_at')}`).get();
            const inputTaxRow = db_1.db.prepare(`SELECT SUM(tax_amount) as tax FROM expenses WHERE status = 'CONFIRMED' ${dateFilter}`).get();
            const salesTax = Math.round((Number(salesTaxRow?.tax) || 0) * 100) / 100;
            const inputTax = Math.round((Number(inputTaxRow?.tax) || 0) * 100) / 100;
            const netKDV = Math.round((salesTax - inputTax) * 100) / 100;
            return {
                period: 'Bu Ay',
                salesKDV: salesTax,
                inputKDV: inputTax,
                netKDVToPay: netKDV > 0 ? netKDV : 0,
                carryForwardKDV: netKDV < 0 ? Math.abs(netKDV) : 0,
                disclaimer: '⚠️ Bu vergi hesaplaması yönetim ve takip amaçlıdır. Resmi vergi beyannamesi yerine geçmez.'
            };
        }
        catch (e) {
            return { error: e.message };
        }
    }
    /**
     * Ürün Bazlı Kârlılık Raporu
     */
    static getProductProfitability() {
        try {
            const rows = db_1.db.prepare(`
        SELECT 
          p.product_code as productCode,
          p.name,
          p.price,
          COALESCE(p.cost_price, p.price * 0.5) as costPrice,
          SUM(o.quantity) as totalSold,
          SUM(o.total_price) as totalRevenue
        FROM products p
        LEFT JOIN orders o ON p.product_code = o.product_code AND o.status != 'DEC'
        GROUP BY p.product_code
        ORDER BY totalRevenue DESC
      `).all();
            return rows.map(r => {
                const rev = Number(r.totalRevenue) || 0;
                const sold = Number(r.totalSold) || 0;
                const totalCost = (Number(r.costPrice) || 0) * sold;
                const netProfit = rev - totalCost;
                return {
                    productCode: r.productCode,
                    name: r.name,
                    unitPrice: Number(r.price) || 0,
                    costPrice: Number(r.costPrice) || 0,
                    totalSold: sold,
                    totalRevenue: rev,
                    totalCost,
                    netProfit,
                    profitMarginPercent: rev > 0 ? Math.round((netProfit / rev) * 1000) / 10 : 0
                };
            });
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Gider Listesini Getirir
     */
    static getExpenses() {
        try {
            return db_1.db.prepare(`SELECT * FROM expenses ORDER BY id DESC LIMIT 100`).all();
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Gelir Listesini Getirir
     */
    static getIncomeEntries() {
        try {
            return db_1.db.prepare(`SELECT * FROM income_entries ORDER BY id DESC LIMIT 100`).all();
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Fatura Listesini Getirir
     */
    static getInvoices() {
        try {
            return db_1.db.prepare(`SELECT * FROM invoices ORDER BY id DESC LIMIT 100`).all();
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Yevmiye Fişleri (Transactions) Listesini Getirir
     */
    static getTransactions() {
        try {
            const trxs = db_1.db.prepare(`SELECT * FROM accounting_transactions ORDER BY id DESC LIMIT 50`).all();
            const lineStmt = db_1.db.prepare(`SELECT * FROM accounting_transaction_lines WHERE transaction_id = ?`);
            return trxs.map(t => ({
                ...t,
                lines: lineStmt.all(t.id)
            }));
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Tarih Filtresi Oluşturucu Helper
     */
    static getDateFilterClause(period) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        if (period === 'this_month') {
            return ` AND DATE(date) >= '${year}-${month}-01' `;
        }
        else if (period === 'last_month') {
            const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lmYear = lastMonthDate.getFullYear();
            const lmMonth = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
            const lmLastDay = new Date(lmYear, lastMonthDate.getMonth() + 1, 0).getDate();
            return ` AND DATE(date) >= '${lmYear}-${lmMonth}-01' AND DATE(date) <= '${lmYear}-${lmMonth}-${lmLastDay}' `;
        }
        else if (period === 'this_year') {
            return ` AND DATE(date) >= '${year}-01-01' `;
        }
        return '';
    }
}
exports.AccountingService = AccountingService;
