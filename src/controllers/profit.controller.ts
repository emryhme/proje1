import { Request, Response } from 'express';
import { ProfitService } from '../services/profit.service';

export class ProfitController {

  /**
   * Finansal Satış, Maliyet ve Kâr Özeti
   * GET /api/profit/summary
   */
  public static getSummary = async (req: Request, res: Response) => {
    try {
      const { period, startDate, endDate } = req.query;
      const summary = ProfitService.getProfitSummary(
        String(period || 'this_month'),
        startDate ? String(startDate) : undefined,
        endDate ? String(endDate) : undefined
      );

      res.json({ success: true, summary });
    } catch (e: any) {
      console.error('[ProfitController.getSummary Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Brüt Kâr vs İşletme Giderleri vs Net İşletme Kârı Özeti
   * GET /api/profit/net-summary
   */
  public static getNetSummary = async (req: Request, res: Response) => {
    try {
      const { period, startDate, endDate } = req.query;
      const netSummary = ProfitService.getNetBusinessProfitSummary(
        String(period || 'this_month'),
        startDate ? String(startDate) : undefined,
        endDate ? String(endDate) : undefined
      );

      res.json({ success: true, netSummary });
    } catch (e: any) {
      console.error('[ProfitController.getNetSummary Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Depodaki Mevcut Stokların Potansiyel Kâr Değeri
   * GET /api/profit/inventory-potential
   */
  public static getInventoryPotential = async (req: Request, res: Response) => {
    try {
      const potential = ProfitService.getInventoryProfitPotential();
      res.json({ success: true, potential });
    } catch (e: any) {
      console.error('[ProfitController.getInventoryPotential Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Düşük Marjlı Ürünler Uyarısı (%15 Altı)
   * GET /api/profit/low-margin
   */
  public static getLowMarginProducts = async (req: Request, res: Response) => {
    try {
      const threshold = Number(req.query.threshold) || 15;
      const products = ProfitService.getLowMarginProducts(threshold);
      res.json({ success: true, products, count: products.length });
    } catch (e: any) {
      console.error('[ProfitController.getLowMarginProducts Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Giderlerin Kategoriye Göre Dağılımı
   * GET /api/profit/expense-breakdown
   */
  public static getExpenseBreakdown = async (req: Request, res: Response) => {
    try {
      const period = String(req.query.period || 'this_month');
      const breakdown = ProfitService.getExpenseCategoryBreakdown(period);
      res.json({ success: true, breakdown });
    } catch (e: any) {
      console.error('[ProfitController.getExpenseBreakdown Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Ürün Kârlılık ve Adet Analizi Tablosu
   * GET /api/profit/products
   */
  public static getProducts = async (req: Request, res: Response) => {
    try {
      const sortBy = (req.query.sortBy as any) || 'profit';
      const limit = Number(req.query.limit) || 50;

      const products = ProfitService.getProductProfitability(sortBy, limit);
      res.json({ success: true, products, totalCount: products.length });
    } catch (e: any) {
      console.error('[ProfitController.getProducts Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Satış / Maliyet / Kâr Grafik Verisi
   * GET /api/profit/chart
   */
  public static getChart = async (req: Request, res: Response) => {
    try {
      const period = String(req.query.period || 'this_year');
      const chartData = ProfitService.getProfitChartData(period);
      res.json({ success: true, chartData });
    } catch (e: any) {
      console.error('[ProfitController.getChart Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };

  /**
   * Gelecek Satış Kâr Tahmini (Forecast)
   * GET /api/profit/forecast
   */
  public static getForecast = async (req: Request, res: Response) => {
    try {
      const productCode = String(req.query.productCode || '');
      const quantity = Number(req.query.quantity) || 1;

      if (!productCode) {
        return res.status(400).json({ success: false, error: 'productCode parametresi gereklidir.' });
      }

      const forecast = ProfitService.calculateForecastProfit(productCode, quantity);
      res.json({ success: true, forecast });
    } catch (e: any) {
      console.error('[ProfitController.getForecast Error]:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  };
}
