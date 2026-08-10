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
