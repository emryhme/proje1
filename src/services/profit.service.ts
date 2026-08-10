import { db } from '../database/db';

export interface ProfitSummary {
  period: string;
  startDate: string;
  endDate: string;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMarginPercent: number;
  totalOrders: number;
  totalUnitsSold: number;
}

export interface ProductProfitability {
  productCode: string;
  productName: string;
  unitCostPrice: number;
  unitSellingPrice: number;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMarginPercent: number;
}

export interface ProfitChartPoint {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
}

export class ProfitService {

  /**
   * Tarih aralığına göre Ciro, Maliyet, Net Kâr ve Kâr Marjı % özetini hesaplar.
   * İptal veya Reddedilen siparişler (status = 'DEC' / 'CANCELLED') hesaba KATILMAZ.
   */
  public static getProfitSummary(period: string = 'this_month', startDate?: string, endDate?: string): ProfitSummary {
    const dates = this.resolveDateRange(period, startDate, endDate);
    
    // SQLite sorgusu: orders tablosundaki gerçekleşmiş siparişleri topla
    const row = db.prepare(`
      SELECT 
        COUNT(id) as order_count,
        COALESCE(SUM(quantity), 0) as units_count,
        COALESCE(SUM(total_price), 0) as revenue,
        COALESCE(SUM(total_cost), 0) as cost,
        COALESCE(SUM(profit), 0) as net_profit
      FROM orders
      WHERE status NOT IN ('DEC', 'CANCELLED', 'REDDEDİLDİ', 'İPTAL')
        AND created_at >= ? AND created_at <= ?
    `).get(dates.startIso, dates.endIso) as any;

    const totalRevenue = Number((row?.revenue || 0).toFixed(2));
    const totalCost = Number((row?.cost || 0).toFixed(2));
    const totalProfit = Number((row?.net_profit || 0).toFixed(2));
    const profitMarginPercent = totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;

    return {
      period,
      startDate: dates.startDateDisplay,
      endDate: dates.endDateDisplay,
      totalRevenue,
      totalCost,
      totalProfit,
      profitMarginPercent,
      totalOrders: row?.order_count || 0,
      totalUnitsSold: row?.units_count || 0
    };
  }

  /**
   * Ürün Bazlı Kârlılık ve Satış Analizi Tablosu
   */
  public static getProductProfitability(sortBy: 'profit' | 'margin' | 'units' | 'revenue' = 'profit', limit: number = 50): ProductProfitability[] {
    const rows = db.prepare(`
      SELECT 
        p.product_code,
        p.name as product_name,
        COALESCE(p.cost_price, 0) as current_cost_price,
        COALESCE(p.price, 0) as current_price,
        COALESCE(SUM(o.quantity), 0) as units_sold,
        COALESCE(SUM(o.total_price), 0) as total_revenue,
        COALESCE(SUM(o.total_cost), 0) as total_cost,
        COALESCE(SUM(o.profit), 0) as total_profit
      FROM products p
      LEFT JOIN orders o ON p.product_code = o.product_code AND o.status NOT IN ('DEC', 'CANCELLED', 'REDDEDİLDİ', 'İPTAL')
      GROUP BY p.product_code
    `).all() as any[];

    const result: ProductProfitability[] = rows.map(r => {
      const rev = Number((r.total_revenue || 0).toFixed(2));
      const prof = Number((r.total_profit || 0).toFixed(2));
      const margin = rev > 0 ? Number(((prof / rev) * 100).toFixed(1)) : 0;

      return {
        productCode: r.product_code,
        productName: r.product_name || r.product_code,
        unitCostPrice: Number(r.current_cost_price || 0),
        unitSellingPrice: Number(r.current_price || 0),
        unitsSold: Number(r.units_sold || 0),
        totalRevenue: rev,
        totalCost: Number((r.total_cost || 0).toFixed(2)),
        totalProfit: prof,
        profitMarginPercent: margin
      };
    });

    // Sıralama Mantığı
    if (sortBy === 'margin') {
      result.sort((a, b) => b.profitMarginPercent - a.profitMarginPercent);
    } else if (sortBy === 'units') {
      result.sort((a, b) => b.unitsSold - a.unitsSold);
    } else if (sortBy === 'revenue') {
      result.sort((a, b) => b.totalRevenue - a.totalRevenue);
    } else {
      result.sort((a, b) => b.totalProfit - a.totalProfit);
    }

    return result.slice(0, limit);
  }

  /**
   * En Kârlı Ürünler (Top Profitable)
   */
  public static getTopProfitableProducts(limit: number = 5): ProductProfitability[] {
    return this.getProductProfitability('profit', limit);
  }

  /**
   * En Çok Satan Ürünler (Top Selling)
   */
  public static getTopSellingProducts(limit: number = 5): ProductProfitability[] {
    return this.getProductProfitability('units', limit);
  }

  /**
   * Zaman Serisi Grafik Verisi (Aylık/Günlük Ciro vs Maliyet vs Kâr)
   */
  public static getProfitChartData(period: string = 'this_year'): ProfitChartPoint[] {
    const dates = this.resolveDateRange(period);

    const rows = db.prepare(`
      SELECT 
        SUBSTR(created_at, 1, 10) as date_label,
        COALESCE(SUM(total_price), 0) as revenue,
        COALESCE(SUM(total_cost), 0) as cost,
        COALESCE(SUM(profit), 0) as profit
      FROM orders
      WHERE status NOT IN ('DEC', 'CANCELLED', 'REDDEDİLDİ', 'İPTAL')
        AND created_at >= ? AND created_at <= ?
      GROUP BY SUBSTR(created_at, 1, 10)
      ORDER BY date_label ASC
    `).all(dates.startIso, dates.endIso) as any[];

    if (rows.length === 0) {
      return [{ label: dates.startDateDisplay, revenue: 0, cost: 0, profit: 0 }];
    }

    return rows.map(r => ({
      label: r.date_label,
      revenue: Number((r.revenue || 0).toFixed(2)),
      cost: Number((r.cost || 0).toFixed(2)),
      profit: Number((r.profit || 0).toFixed(2))
    }));
  }

  /**
   * Gelecek Satış Kâr Tahmini (Forecast)
   */
  public static calculateForecastProfit(productCode: string, quantity: number) {
    const prod = db.prepare('SELECT product_code, name, price, cost_price FROM products WHERE product_code = ?').get(productCode) as any;
    if (!prod) {
      throw new Error(`Ürün (${productCode}) bulunamadı.`);
    }

    const sellingPrice = Number(prod.price || 0);
    const costPrice = Number(prod.cost_price || 0);
    const unitProfit = sellingPrice - costPrice;
    const forecastRevenue = sellingPrice * quantity;
    const forecastCost = costPrice * quantity;
    const forecastProfit = unitProfit * quantity;
    const margin = forecastRevenue > 0 ? Number(((forecastProfit / forecastRevenue) * 100).toFixed(1)) : 0;

    return {
      productCode: prod.product_code,
      productName: prod.name || prod.product_code,
      quantity,
      unitSellingPrice: sellingPrice,
      unitCostPrice: costPrice,
      unitProfit,
      forecastRevenue,
      forecastCost,
      forecastProfit,
      marginPercent: margin,
      message: `📦 ${quantity} adet ${prod.name || prod.product_code} satılması durumunda tahmini Ciro: ${forecastRevenue} TL, Maliyet: ${forecastCost} TL, Brüt Kâr: ${forecastProfit} TL (%${margin} marj) oluşacaktır.`
    };
  }

  /**
   * Tarih Aralığı Yardımcısı (Period Resolver)
   */
  private static resolveDateRange(period: string, customStart?: string, customEnd?: string) {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'this_week') {
      const day = now.getDay() || 7;
      start.setDate(now.getDate() - day + 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (period === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'all') {
      start = new Date(2020, 0, 1);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'custom' && customStart && customEnd) {
      start = new Date(customStart);
      end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
    } else {
      // Default: this_month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setHours(23, 59, 59, 999);
    }

    const startIso = start.toISOString().replace('T', ' ').substring(0, 19);
    const endIso = end.toISOString().replace('T', ' ').substring(0, 19);

    return {
      startIso,
      endIso,
      startDateDisplay: start.toLocaleDateString('tr-TR'),
      endDateDisplay: end.toLocaleDateString('tr-TR')
    };
  }
}
