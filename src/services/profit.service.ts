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

export interface NetBusinessProfitSummary extends ProfitSummary {
  grossProfit: number;
  operatingExpenses: number;
  netBusinessProfit: number;
  netBusinessMarginPercent: number;
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
  currentStock: number;
  isLowMargin?: boolean;
}

export interface ProfitChartPoint {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface InventoryProfitPotential {
  totalItemsCount: number;
  totalStockQuantity: number;
  totalInventoryCost: number;
  totalInventoryRetailValue: number;
  potentialGrossProfit: number;
  potentialMarginPercent: number;
}

export class ProfitService {

  /**
   * Tarih aralığına göre Ciro, Ürün Maliyeti (COGS), Brüt Kâr ve Kâr Marjı % hesaplar.
   * İptal veya Reddedilen siparişler (status = 'DEC' / 'CANCELLED') hesaba KATILMAZ.
   */
  public static getProfitSummary(period: string = 'this_month', startDate?: string, endDate?: string): ProfitSummary {
    const dates = this.resolveDateRange(period, startDate, endDate);
    
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
   * Brüt Kâr vs İşletme Giderleri vs Net İşletme Kârı Özeti
   */
  public static getNetBusinessProfitSummary(period: string = 'this_month', startDate?: string, endDate?: string): NetBusinessProfitSummary {
    const baseSummary = this.getProfitSummary(period, startDate, endDate);
    const dates = this.resolveDateRange(period, startDate, endDate);

    // İşletme giderlerini topla
    const expRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM expenses
      WHERE status = 'CONFIRMED'
        AND date >= ? AND date <= ?
    `).get(dates.startIso.substring(0, 10), dates.endIso.substring(0, 10)) as any;

    const operatingExpenses = Number((expRow?.total_expenses || 0).toFixed(2));
    const grossProfit = baseSummary.totalProfit;
    const netBusinessProfit = Number((grossProfit - operatingExpenses).toFixed(2));
    const netBusinessMarginPercent = baseSummary.totalRevenue > 0 
      ? Number(((netBusinessProfit / baseSummary.totalRevenue) * 100).toFixed(1)) 
      : 0;

    return {
      ...baseSummary,
      grossProfit,
      operatingExpenses,
      netBusinessProfit,
      netBusinessMarginPercent
    };
  }

  /**
   * Depodaki Mevcut Stokların Potansiyel Değeri ve Potansiyel Kârı (Unrealized Profit)
   */
  public static getInventoryProfitPotential(): InventoryProfitPotential {
    const row = db.prepare(`
      SELECT 
        COUNT(id) as items_count,
        COALESCE(SUM(stock), 0) as total_stock,
        COALESCE(SUM(stock * cost_price), 0) as total_cost,
        COALESCE(SUM(stock * price), 0) as total_retail_value
      FROM products
      WHERE stock > 0
    `).get() as any;

    const totalInventoryCost = Number((row?.total_cost || 0).toFixed(2));
    const totalInventoryRetailValue = Number((row?.total_retail_value || 0).toFixed(2));
    const potentialGrossProfit = Number((totalInventoryRetailValue - totalInventoryCost).toFixed(2));
    const potentialMarginPercent = totalInventoryRetailValue > 0
      ? Number(((potentialGrossProfit / totalInventoryRetailValue) * 100).toFixed(1))
      : 0;

    return {
      totalItemsCount: row?.items_count || 0,
      totalStockQuantity: row?.total_stock || 0,
      totalInventoryCost,
      totalInventoryRetailValue,
      potentialGrossProfit,
      potentialMarginPercent
    };
  }

  /**
   * Düşük Marjlı Ürünler Uyarısı (Kâr marjı %15'in altında olanlar)
   */
  public static getLowMarginProducts(thresholdPercent: number = 15): ProductProfitability[] {
    const allProducts = this.getProductProfitability('margin', 500);
    return allProducts.filter(p => {
      const margin = p.unitSellingPrice > 0 
        ? ((p.unitSellingPrice - p.unitCostPrice) / p.unitSellingPrice) * 100 
        : 0;
      return margin < thresholdPercent;
    });
  }

  /**
   * Giderlerin Kategoriye Göre Dağılımı
   */
  public static getExpenseCategoryBreakdown(period: string = 'this_month') {
    const dates = this.resolveDateRange(period);
    const rows = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) as total_amount
      FROM expenses
      WHERE status = 'CONFIRMED'
        AND date >= ? AND date <= ?
      GROUP BY category
      ORDER BY total_amount DESC
    `).all(dates.startIso.substring(0, 10), dates.endIso.substring(0, 10)) as any[];

    return rows.map(r => ({
      category: r.category,
      amount: Number((r.total_amount || 0).toFixed(2))
    }));
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
        COALESCE(p.stock, 0) as current_stock,
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
      const unitCost = Number(r.current_cost_price || 0);
      const unitPrice = Number(r.current_price || 0);
      const unitMargin = unitPrice > 0 ? ((unitPrice - unitCost) / unitPrice) * 100 : 0;

      return {
        productCode: r.product_code,
        productName: r.product_name || r.product_code,
        unitCostPrice: unitCost,
        unitSellingPrice: unitPrice,
        currentStock: Number(r.current_stock || 0),
        unitsSold: Number(r.units_sold || 0),
        totalRevenue: rev,
        totalCost: Number((r.total_cost || 0).toFixed(2)),
        totalProfit: prof,
        profitMarginPercent: margin,
        isLowMargin: unitMargin < 15
      };
    });

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
  public static resolveDateRange(period: string, customStart?: string, customEnd?: string) {
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
