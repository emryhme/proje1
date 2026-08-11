"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockService = void 0;
const db_1 = require("../database/db");
const google_sheets_service_1 = require("./google-sheets.service");
/**
 * SQLite (app.db) Destekli Ultra Hızlı Stok Yönetim Servisi
 */
class StockService {
    /**
     * SQLite veritabanındaki tüm ham ürün satırlarını getirir.
     */
    static async fetchAllSheetRows() {
        try {
            const stmt = db_1.db.prepare(`
        SELECT short_code as shortCode, product_code as productCode, name, color, size, price, stock, category
        FROM products
        ORDER BY id ASC
      `);
            return stmt.all();
        }
        catch (e) {
            console.error('[StockService SQLite] ❌ Ürünler okunamadı:', e.message);
            return [];
        }
    }
    /**
     * Tüm benzersiz ürünlerin güncel stok listesini getirir.
     */
    static async getAllProducts() {
        return await this.fetchAllSheetRows();
    }
    /**
     * Ürün Kodu (KGMLW-M), Kısa Kod (KGMLW), Beden veya Ürün İsmine göre akıllı stok sorgulama yapar.
     */
    static async checkStock(queryInput) {
        const rawQuery = queryInput.trim().toUpperCase();
        const rows = await this.fetchAllSheetRows();
        if (rows.length === 0) {
            return { exists: false, inStock: false };
        }
        // 1. Doğrudan ÜRÜN KODU Eşleşmesi (Örn: "KGMLW-M" veya "KGMLW-M var mı?")
        let match = rows.find(r => r.productCode.toUpperCase() === rawQuery || rawQuery.includes(r.productCode.toUpperCase()));
        // 2. Kısa Kod + Beden ayrıştırma (Örn: "KGMLW M" veya "KGMLW L")
        if (!match) {
            match = rows.find(r => {
                const pattern1 = `${r.shortCode}-${r.size}`.toUpperCase();
                const pattern2 = `${r.shortCode} ${r.size}`.toUpperCase();
                return rawQuery.includes(pattern1) || rawQuery.includes(pattern2);
            });
        }
        // 3. Kısa Kod Eşleşmesi (Örn: "KGMLW") -> Mevcut tüm bedenleri ve stok durumunu kontrol et
        if (!match) {
            const shortMatch = rows.find(r => rawQuery.includes(r.shortCode.toUpperCase()));
            if (shortMatch) {
                const shortCode = shortMatch.shortCode.toUpperCase();
                const shortMatches = rows.filter(r => r.shortCode.toUpperCase() === shortCode);
                const hasStock = shortMatches.some(r => r.stock > 0);
                const availableSizes = shortMatches.filter(r => r.stock > 0).map(r => r.size);
                return {
                    exists: true,
                    inStock: hasStock,
                    product: {
                        productCode: shortCode,
                        name: shortMatch.name,
                        availableSizes,
                        stock: hasStock ? 1 : 0
                    }
                };
            }
        }
        // 4. İsim İle Arama (Örn: "KUMAŞ GÖMLEK")
        if (!match) {
            match = rows.find(r => r.name.toUpperCase().includes(rawQuery) || rawQuery.includes(r.name.toUpperCase()));
        }
        if (!match) {
            return { exists: false, inStock: false };
        }
        return {
            exists: true,
            inStock: match.stock > 0,
            product: {
                shortCode: match.shortCode,
                productCode: match.productCode,
                name: match.name,
                color: match.color,
                size: match.size,
                price: match.price,
                stock: match.stock,
                category: match.category
            }
        };
    }
    /**
     * Stok Eksiltme (Sipariş Gerçekleştiğinde: -quantity)
     */
    static async deductStock(productCode, quantity, size) {
        try {
            const targetCode = productCode.trim().toUpperCase();
            const targetSize = size ? size.trim().toUpperCase() : '';
            let stmt;
            let result;
            if (targetCode.includes('-')) {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
                const parts = targetCode.split('-');
                result = stmt.run(quantity, targetCode, parts[0], parts[1] || targetSize);
            }
            else if (targetSize) {
                const fullCode = `${targetCode}-${targetSize}`;
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
                result = stmt.run(quantity, fullCode, targetCode, targetSize);
            }
            else {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?
        `);
                result = stmt.run(quantity, targetCode, targetCode);
            }
            console.log(`[StockService SQLite] 📦 Stok Düşüldü (${targetCode}): -${quantity} (Etkilenen Satır: ${result.changes})`);
            // Google Sheets Senkronizasyonu
            const updatedProd = db_1.db.prepare(`SELECT stock, product_code FROM products WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?`).get(targetCode, targetCode);
            if (updatedProd && updatedProd.stock !== undefined) {
                google_sheets_service_1.GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => { });
            }
            return result.changes > 0;
        }
        catch (e) {
            console.error('[StockService SQLite] ❌ Stok düşülemedi:', e.message);
            return false;
        }
    }
    /**
     * Stok İade Etme / Artırma (Sipariş Reddedildiğinde / İptal Edildiğinde: +quantity)
     */
    static async restoreStock(productCode, quantity, size) {
        try {
            const targetCode = productCode.trim().toUpperCase();
            const targetSize = size ? size.trim().toUpperCase() : '';
            let stmt;
            let result;
            if (targetCode.includes('-')) {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
                const parts = targetCode.split('-');
                result = stmt.run(quantity, targetCode, parts[0], parts[1] || targetSize);
            }
            else if (targetSize) {
                const fullCode = `${targetCode}-${targetSize}`;
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
                result = stmt.run(quantity, fullCode, targetCode, targetSize);
            }
            else {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?
        `);
                result = stmt.run(quantity, targetCode, targetCode);
            }
            console.log(`[StockService SQLite] 🔄 Stok İade Edildi (${targetCode}): +${quantity} (Etkilenen Satır: ${result.changes})`);
            // Google Sheets Senkronizasyonu
            const updatedProd = db_1.db.prepare(`SELECT stock, product_code FROM products WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?`).get(targetCode, targetCode);
            if (updatedProd && updatedProd.stock !== undefined) {
                google_sheets_service_1.GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => { });
            }
            return result.changes > 0;
        }
        catch (e) {
            console.error('[StockService SQLite] ❌ Stok iade edilemedi:', e.message);
            return false;
        }
    }
    /**
     * SQLite Veritabanına Yeni Ürün Ekler veya Günceller
     */
    static async addProduct(data) {
        try {
            const computedCode = data.productCode || data.shortCode || 'SKU-NEW';
            const shortCode = data.shortCode || computedCode.split('-')[0] || computedCode;
            const numPrice = Number(data.price) || 299.0;
            const numCostPrice = Number(data.costPrice) || 0.0;
            const stmt = db_1.db.prepare(`
        INSERT INTO products (short_code, product_code, name, color, size, price, cost_price, stock, category, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(product_code) DO UPDATE SET
          name = excluded.name,
          color = excluded.color,
          size = excluded.size,
          price = excluded.price,
          cost_price = excluded.cost_price,
          stock = excluded.stock,
          category = excluded.category,
          updated_at = CURRENT_TIMESTAMP
      `);
            stmt.run(shortCode, computedCode, data.name, data.color || '', data.size, numPrice, numCostPrice, data.stock, data.category || '');
            console.log(`[StockService SQLite] ✅ Ürün eklendi/güncellendi: ${computedCode}`);
            return { success: true, productCode: computedCode };
        }
        catch (e) {
            console.error('[StockService SQLite] ❌ Ürün eklenemedi:', e.message);
            return { success: false, productCode: data.productCode || data.shortCode || 'PROD-1' };
        }
    }
    /**
     * SQLite Veritabanından Ürün Siler
     */
    static async deleteProduct(productCode) {
        try {
            const stmt = db_1.db.prepare(`DELETE FROM products WHERE product_code = ? OR short_code = ?`);
            const target = productCode.trim().toUpperCase();
            const res = stmt.run(target, target);
            console.log(`[StockService SQLite] 🗑️ Ürün silindi: ${target}`);
            // Google Sheets Senkronizasyonu
            google_sheets_service_1.GoogleSheetsService.deleteProductRow(target).catch(() => { });
            return res.changes > 0;
        }
        catch (e) {
            console.error('[StockService SQLite] ❌ Ürün silinemedi:', e.message);
            return false;
        }
    }
    /**
     * SQLite Veritabanında Ürün Stok Miktarını Günceller
     */
    static async updateStock(productCode, newStock) {
        try {
            const stmt = db_1.db.prepare(`
        UPDATE products
        SET stock = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_code = ? OR short_code = ?
      `);
            const target = productCode.trim().toUpperCase();
            const res = stmt.run(Number(newStock), target, target);
            console.log(`[StockService SQLite] Ürün (${target}) Stoğu Güncellendi: ${newStock}`);
            // Google Sheets Senkronizasyonu
            google_sheets_service_1.GoogleSheetsService.updateProductStock(target, Number(newStock)).catch(() => { });
            return res.changes > 0;
        }
        catch (e) {
            console.error('[StockService SQLite] Stok güncellenemedi:', e.message);
            return false;
        }
    }
    // ─────────────────────────────────────────────
    // Quick Reply Helper Methods (DB-validated)
    // ─────────────────────────────────────────────
    /**
     * Bir short code'a ait stokta mevcut bedenleri DB'den döndürür.
     * Stoku tükenmiş bedenler hariç tutulur.
     */
    static async getAvailableSizes(shortCode) {
        try {
            const target = shortCode.trim().toUpperCase();
            const rows = db_1.db.prepare(`
        SELECT DISTINCT size FROM products
        WHERE UPPER(short_code) = ? AND stock > 0
        ORDER BY
          CASE size
            WHEN 'XS' THEN 1 WHEN 'S' THEN 2 WHEN 'M' THEN 3
            WHEN 'L' THEN 4 WHEN 'XL' THEN 5 WHEN 'XXL' THEN 6
            ELSE 7
          END ASC
      `).all(target);
            const sizes = rows.map(r => r.size).filter(s => s && s.trim().length > 0);
            console.log(`[StockService] getAvailableSizes(${shortCode}): ${sizes.join(',')}`);
            return sizes;
        }
        catch (e) {
            console.error('[StockService] getAvailableSizes error:', e.message);
            return [];
        }
    }
    /**
     * Bir short code'a ait stokta mevcut renkleri DB'den döndürür.
     * Stoku tükenmiş renkler hariç tutulur.
     */
    static async getAvailableColors(shortCode) {
        try {
            const target = shortCode.trim().toUpperCase();
            const rows = db_1.db.prepare(`
        SELECT DISTINCT color FROM products
        WHERE UPPER(short_code) = ? AND stock > 0 AND color IS NOT NULL AND color != ''
        ORDER BY color ASC
      `).all(target);
            const colors = rows.map(r => r.color).filter(c => c && c.trim().length > 0);
            console.log(`[StockService] getAvailableColors(${shortCode}): ${colors.join(',')}`);
            return colors;
        }
        catch (e) {
            console.error('[StockService] getAvailableColors error:', e.message);
            return [];
        }
    }
    /**
     * Belirli bir shortCode + size + color kombinasyonu için stok döndürür.
     * Quick Reply quantity builder için kullanılır.
     */
    static async getStockForSizeColor(shortCode, size, color) {
        try {
            const target = shortCode.trim().toUpperCase();
            const targetSize = size ? size.trim().toUpperCase() : null;
            const targetColor = color ? color.trim().toUpperCase() : null;
            let query;
            let params;
            if (targetSize && targetColor) {
                query = `SELECT SUM(stock) as total FROM products WHERE UPPER(short_code) = ? AND UPPER(size) = ? AND UPPER(color) = ?`;
                params = [target, targetSize, targetColor];
            }
            else if (targetSize) {
                query = `SELECT SUM(stock) as total FROM products WHERE UPPER(short_code) = ? AND UPPER(size) = ?`;
                params = [target, targetSize];
            }
            else if (targetColor) {
                query = `SELECT SUM(stock) as total FROM products WHERE UPPER(short_code) = ? AND UPPER(color) = ?`;
                params = [target, targetColor];
            }
            else {
                query = `SELECT SUM(stock) as total FROM products WHERE UPPER(short_code) = ?`;
                params = [target];
            }
            const row = db_1.db.prepare(query).get(...params);
            const stock = row?.total || 0;
            console.log(`[StockService] getStockForSizeColor(${shortCode},${size},${color}): ${stock}`);
            return stock;
        }
        catch (e) {
            console.error('[StockService] getStockForSizeColor error:', e.message);
            return 0;
        }
    }
}
exports.StockService = StockService;
