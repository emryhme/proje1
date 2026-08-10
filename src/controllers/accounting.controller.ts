import { Request, Response } from 'express';
import { AccountingService } from '../services/accounting.service';

export class AccountingController {
  public static async getSummary(req: Request, res: Response) {
    try {
      const period = (req.query.period as any) || 'this_month';
      const summary = AccountingService.getFinancialSummary(period);
      res.json({ success: true, summary });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getProfitLoss(req: Request, res: Response) {
    try {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const report = AccountingService.getProfitLossReport(startDate, endDate);
      res.json({ success: true, report });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getBalanceSheet(req: Request, res: Response) {
    try {
      const balanceSheet = AccountingService.getBalanceSheet();
      res.json({ success: true, balanceSheet });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getTaxSummary(req: Request, res: Response) {
    try {
      const taxSummary = AccountingService.getTaxSummary();
      res.json({ success: true, taxSummary });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getProductProfitability(req: Request, res: Response) {
    try {
      const products = AccountingService.getProductProfitability();
      res.json({ success: true, products });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getExpenses(req: Request, res: Response) {
    try {
      const expenses = AccountingService.getExpenses();
      res.json({ success: true, expenses });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async createExpense(req: Request, res: Response) {
    try {
      const { category, amount, taxRate, currency, paymentMethod, accountCode, supplierName, description, invoiceNumber, isRecurring, status } = req.body;
      if (!category || !amount || !description) {
        return res.status(400).json({ success: false, error: 'Kategori, tutar ve açıklama zorunludur.' });
      }

      const result = AccountingService.addExpense({
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
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getIncome(req: Request, res: Response) {
    try {
      const income = AccountingService.getIncomeEntries();
      res.json({ success: true, income });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async createIncome(req: Request, res: Response) {
    try {
      const { category, amount, taxRate, currency, paymentMethod, accountCode, customerName, description, status } = req.body;
      if (!category || !amount || !description) {
        return res.status(400).json({ success: false, error: 'Kategori, tutar ve açıklama zorunludur.' });
      }

      const result = AccountingService.addIncome({
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
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async confirmDraft(req: Request, res: Response) {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ success: false, error: 'Taslak türü (EXPENSE/INCOME) ve ID zorunludur.' });
      }

      const result = AccountingService.confirmDraft(type, id, 'USER:tonystark');
      if (result.success) {
        res.json({ success: true, message: 'Taslak başarıyla onaylandı ve muhasebeleştirildi.' });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getInvoices(req: Request, res: Response) {
    try {
      const invoices = AccountingService.getInvoices();
      res.json({ success: true, invoices });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async createInvoice(req: Request, res: Response) {
    try {
      const { type, partyName, partyPhone, dueDate, items } = req.body;
      if (!partyName || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Müşteri/Tedarikçi adı ve fatura kalemleri zorunludur.' });
      }

      const result = AccountingService.createInvoice({
        type: type || 'SALE',
        partyName,
        partyPhone,
        dueDate,
        items,
        performedBy: 'USER:tonystark'
      });

      if (result.success) {
        res.json({ success: true, message: 'Fatura başarıyla kesildi.', invoiceNumber: result.invoiceNumber });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async recordPayment(req: Request, res: Response) {
    try {
      const { type, invoiceId, partyName, amount, paymentMethod, accountCode, referenceNo } = req.body;
      if (!partyName || !amount) {
        return res.status(400).json({ success: false, error: 'Taraf adı ve ödeme tutarı zorunludur.' });
      }

      const result = AccountingService.recordPayment({
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
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  public static async getTransactions(req: Request, res: Response) {
    try {
      const transactions = AccountingService.getTransactions();
      res.json({ success: true, transactions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
}
