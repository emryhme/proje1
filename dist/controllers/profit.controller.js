"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfitController = void 0;
const profit_service_1 = require("../services/profit.service");
class ProfitController {
    /**
     * Finansal Satış, Maliyet ve Kâr Özeti
     * GET /api/profit/summary
     */
    static getSummary = async (req, res) => {
        try {
            const { period, startDate, endDate } = req.query;
            const summary = profit_service_1.ProfitService.getProfitSummary(String(period || 'this_month'), startDate ? String(startDate) : undefined, endDate ? String(endDate) : undefined);
            res.json({ success: true, summary });
        }
        catch (e) {
            console.error('[ProfitController.getSummary Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Brüt Kâr vs İşletme Giderleri vs Net İşletme Kârı Özeti
     * GET /api/profit/net-summary
     */
    static getNetSummary = async (req, res) => {
        try {
            const { period, startDate, endDate } = req.query;
            const netSummary = profit_service_1.ProfitService.getNetBusinessProfitSummary(String(period || 'this_month'), startDate ? String(startDate) : undefined, endDate ? String(endDate) : undefined);
            res.json({ success: true, netSummary });
        }
        catch (e) {
            console.error('[ProfitController.getNetSummary Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Depodaki Mevcut Stokların Potansiyel Kâr Değeri
     * GET /api/profit/inventory-potential
     */
    static getInventoryPotential = async (req, res) => {
        try {
            const potential = profit_service_1.ProfitService.getInventoryProfitPotential();
            res.json({ success: true, potential });
        }
        catch (e) {
            console.error('[ProfitController.getInventoryPotential Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Düşük Marjlı Ürünler Uyarısı (%15 Altı)
     * GET /api/profit/low-margin
     */
    static getLowMarginProducts = async (req, res) => {
        try {
            const threshold = Number(req.query.threshold) || 15;
            const products = profit_service_1.ProfitService.getLowMarginProducts(threshold);
            res.json({ success: true, products, count: products.length });
        }
        catch (e) {
            console.error('[ProfitController.getLowMarginProducts Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Giderlerin Kategoriye Göre Dağılımı
     * GET /api/profit/expense-breakdown
     */
    static getExpenseBreakdown = async (req, res) => {
        try {
            const period = String(req.query.period || 'this_month');
            const breakdown = profit_service_1.ProfitService.getExpenseCategoryBreakdown(period);
            res.json({ success: true, breakdown });
        }
        catch (e) {
            console.error('[ProfitController.getExpenseBreakdown Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Ürün Kârlılık ve Adet Analizi Tablosu
     * GET /api/profit/products
     */
    static getProducts = async (req, res) => {
        try {
            const sortBy = req.query.sortBy || 'profit';
            const limit = Number(req.query.limit) || 50;
            const products = profit_service_1.ProfitService.getProductProfitability(sortBy, limit);
            res.json({ success: true, products, totalCount: products.length });
        }
        catch (e) {
            console.error('[ProfitController.getProducts Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Satış / Maliyet / Kâr Grafik Verisi
     * GET /api/profit/chart
     */
    static getChart = async (req, res) => {
        try {
            const period = String(req.query.period || 'this_year');
            const chartData = profit_service_1.ProfitService.getProfitChartData(period);
            res.json({ success: true, chartData });
        }
        catch (e) {
            console.error('[ProfitController.getChart Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
    /**
     * Gelecek Satış Kâr Tahmini (Forecast)
     * GET /api/profit/forecast
     */
    static getForecast = async (req, res) => {
        try {
            const productCode = String(req.query.productCode || '');
            const quantity = Number(req.query.quantity) || 1;
            if (!productCode) {
                return res.status(400).json({ success: false, error: 'productCode parametresi gereklidir.' });
            }
            const forecast = profit_service_1.ProfitService.calculateForecastProfit(productCode, quantity);
            res.json({ success: true, forecast });
        }
        catch (e) {
            console.error('[ProfitController.getForecast Error]:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    };
}
exports.ProfitController = ProfitController;
