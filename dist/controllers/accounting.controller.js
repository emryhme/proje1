"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountingController = void 0;
const accounting_service_1 = require("../services/accounting.service");
class AccountingController {
    static async getSummary(req, res) {
        try {
            const period = req.query.period || 'this_month';
            const summary = accounting_service_1.AccountingService.getFinancialSummary(period);
            res.json({ success: true, summary });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getProfitLoss(req, res) {
        try {
            const startDate = req.query.startDate;
            const endDate = req.query.endDate;
            const report = accounting_service_1.AccountingService.getProfitLossReport(startDate, endDate);
            res.json({ success: true, report });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getBalanceSheet(req, res) {
        try {
            const balanceSheet = accounting_service_1.AccountingService.getBalanceSheet();
            res.json({ success: true, balanceSheet });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getTaxSummary(req, res) {
        try {
            const taxSummary = accounting_service_1.AccountingService.getTaxSummary();
            res.json({ success: true, taxSummary });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getProductProfitability(req, res) {
        try {
            const products = accounting_service_1.AccountingService.getProductProfitability();
            res.json({ success: true, products });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getExpenses(req, res) {
        try {
            const expenses = accounting_service_1.AccountingService.getExpenses();
            res.json({ success: true, expenses });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async createExpense(req, res) {
        try {
            const { category, amount, taxRate, currency, paymentMethod, accountCode, supplierName, description, invoiceNumber, isRecurring, status } = req.body;
            if (!category || !amount || !description) {
                return res.status(400).json({ success: false, error: 'Kategori, tutar ve açıklama zorunludur.' });
            }
            const result = accounting_service_1.AccountingService.addExpense({
                category,
                amount: Number(amount),
                taxRate: taxRate !== undefined ? Number(taxRate) : 20,
                currency,
                paymentMethod: paymentMethod || 'CASH',
                accountCode,
                supplierName,
                description,
                invoiceNumber,
                isRecurring: Boolean(isRecurring),
                status: status || 'CONFIRMED',
                performedBy: 'USER:tonystark'
            });
            if (result.success) {
                res.json({ success: true, message: 'Gider başarıyla kaydedildi.', expenseNumber: result.expenseNumber });
            }
            else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getIncome(req, res) {
        try {
            const income = accounting_service_1.AccountingService.getIncomeEntries();
            res.json({ success: true, income });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async createIncome(req, res) {
        try {
            const { category, amount, taxRate, currency, paymentMethod, accountCode, customerName, description, status } = req.body;
            if (!category || !amount || !description) {
                return res.status(400).json({ success: false, error: 'Kategori, tutar ve açıklama zorunludur.' });
            }
            const result = accounting_service_1.AccountingService.addIncome({
                category,
                amount: Number(amount),
                taxRate: taxRate !== undefined ? Number(taxRate) : 20,
                currency,
                paymentMethod: paymentMethod || 'CASH',
                accountCode,
                customerName,
                description,
                status: status || 'CONFIRMED',
                performedBy: 'USER:tonystark'
            });
            if (result.success) {
                res.json({ success: true, message: 'Gelir kaydı başarıyla eklendi.', incomeNumber: result.incomeNumber });
            }
            else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async confirmDraft(req, res) {
        try {
            const { type, id } = req.body;
            if (!type || !id) {
                return res.status(400).json({ success: false, error: 'Taslak türü (EXPENSE/INCOME) ve ID zorunludur.' });
            }
            const result = accounting_service_1.AccountingService.confirmDraft(type, id, 'USER:tonystark');
            if (result.success) {
                res.json({ success: true, message: 'Taslak başarıyla onaylandı ve muhasebeleştirildi.' });
            }
            else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getInvoices(req, res) {
        try {
            const invoices = accounting_service_1.AccountingService.getInvoices();
            res.json({ success: true, invoices });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async createInvoice(req, res) {
        try {
            const { type, partyName, partyPhone, dueDate, items } = req.body;
            if (!partyName || !items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: 'Müşteri/Tedarikçi adı ve fatura kalemleri zorunludur.' });
            }
            const result = accounting_service_1.AccountingService.createInvoice({
                type: type || 'SALE',
                partyName,
                partyPhone,
                dueDate,
                items,
                performedBy: 'USER:tonystark'
            });
            if (result.success) {
                res.json({ success: true, message: 'Fatura başarıyla kesildi.', invoiceNumber: result.invoiceNumber });
            }
            else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async recordPayment(req, res) {
        try {
            const { type, invoiceId, partyName, amount, paymentMethod, accountCode, referenceNo } = req.body;
            if (!partyName || !amount) {
                return res.status(400).json({ success: false, error: 'Taraf adı ve ödeme tutarı zorunludur.' });
            }
            const result = accounting_service_1.AccountingService.recordPayment({
                type: type || 'INBOUND',
                invoiceId: invoiceId ? Number(invoiceId) : undefined,
                partyName,
                amount: Number(amount),
                paymentMethod: paymentMethod || 'BANK_TRANSFER',
                accountCode,
                referenceNo,
                performedBy: 'USER:tonystark'
            });
            if (result.success) {
                res.json({ success: true, message: 'Ödeme/Tahsilat başarıyla kaydedildi.', paymentNumber: result.paymentNumber });
            }
            else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
    static async getTransactions(req, res) {
        try {
            const transactions = accounting_service_1.AccountingService.getTransactions();
            res.json({ success: true, transactions });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
}
exports.AccountingController = AccountingController;
