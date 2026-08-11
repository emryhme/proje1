"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * SQLite Veritabanı Yöneticisi (app.db)
 */
const dbName = process.env.DB_NAME || 'app.db';
const projectRoot = path_1.default.resolve(__dirname, '../../');
const cwdDir = process.cwd();
const candidatePaths = [
    path_1.default.resolve(projectRoot, dbName),
    path_1.default.resolve(cwdDir, dbName),
    path_1.default.resolve(projectRoot, 'app.db'),
    path_1.default.resolve(cwdDir, 'app.db'),
    path_1.default.resolve(projectRoot, 'barons.db'),
    path_1.default.resolve(cwdDir, 'barons.db')
];
let dbPath = candidatePaths.find(p => fs_1.default.existsSync(p)) || path_1.default.resolve(cwdDir, 'app.db');
console.log(`[Database] 🗄️ SQLite Veritabanı Yolu: ${dbPath}`);
exports.db = new better_sqlite3_1.default(dbPath, { verbose: undefined });
// Performans Ayarları (WAL Mode & Synchronous Normal)
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('synchronous = NORMAL');
/**
 * Otomatik Veri Kurtarma ve Birleştirme (Data Recovery Scan)
 */
function recoverLegacyData() {
    try {
        const backupPaths = [
            path_1.default.resolve(projectRoot, 'barons.db'),
            path_1.default.resolve(cwdDir, 'barons.db')
        ].filter(p => fs_1.default.existsSync(p) && p !== dbPath);
        for (const bPath of backupPaths) {
            console.log(`[Database Recovery] 🛠️ Eski veritabanı tespit edildi: ${bPath}. Veriler aktarılıyor...`);
            const oldDb = new better_sqlite3_1.default(bPath, { readonly: true });
            // 1. Ürünleri Kurtar
            try {
                const oldProducts = oldDb.prepare('SELECT * FROM products').all();
                const insertProd = exports.db.prepare(`
          INSERT OR IGNORE INTO products (short_code, product_code, name, color, size, price, cost_price, stock, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
                exports.db.transaction(() => {
                    oldProducts.forEach(p => {
                        insertProd.run(p.short_code || 'STK', p.product_code, p.name, p.color || '', p.size || 'M', p.price || 299, p.cost_price || 150, p.stock || 0, p.category || '', p.created_at || new Date().toISOString());
                    });
                })();
            }
            catch (e) { }
            // 2. Siparişleri Kurtar
            try {
                const oldOrders = oldDb.prepare('SELECT * FROM orders').all();
                const insertOrd = exports.db.prepare(`
          INSERT OR IGNORE INTO orders (order_id, first_name, last_name, customer_phone, address, product_code, product_name, size, quantity, unit_price, shipping_fee, discount, total_price, unit_cost_price, total_cost, profit, status, sender_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
                exports.db.transaction(() => {
                    oldOrders.forEach(o => {
                        insertOrd.run(o.order_id, o.first_name || '', o.last_name || '', o.customer_phone || '', o.address || '', o.product_code || '', o.product_name || '', o.size || 'M', o.quantity || 1, o.unit_price || 0, o.shipping_fee || 0, o.discount || 0, o.total_price || 0, o.unit_cost_price || 0, o.total_cost || 0, o.profit || 0, o.status || 'OK', o.sender_id || '', o.created_at || new Date().toISOString());
                    });
                })();
            }
            catch (e) { }
            oldDb.close();
            try {
                fs_1.default.renameSync(bPath, `${bPath}.recovered`);
                console.log(`[Database Recovery] ✅ Eski veritabanı başarıyla kurtarıldı ve ${bPath}.recovered olarak yeniden adlandırıldı.`);
            }
            catch (renameErr) {
                console.warn(`[Database Recovery] Yedek dosya yeniden adlandırılamadı:`, renameErr.message);
            }
        }
    }
    catch (err) {
        console.warn('[Database Recovery Warning]:', err.message);
    }
}
/**
 * Tabloları Oluşturur (Migrations)
 */
function initDatabase() {
    // 1. Ürünler Tablosu (products)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT NOT NULL,
      product_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '',
      size TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 299.00,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT DEFAULT '',
      wp_link TEXT DEFAULT '',
      media_link TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // 2. Siparişler Tablosu (orders)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT DEFAULT '',
      customer_phone TEXT NOT NULL,
      address TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT DEFAULT '',
      size TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      shipping_fee REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'BEKLEMEDE',
      sender_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // 3. Kampanyalar Tablosu (campaigns)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      code TEXT DEFAULT '',
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      min_order_amount REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // 4. Sistem Ayarları Tablosu (settings - Kargo Fiyatları vb.)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
    // 5. Müşteri Kişiye Özel İndirim Ödülleri Tablosu (user_rewards)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS user_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      reward_code TEXT NOT NULL,
      discount_percent REAL NOT NULL DEFAULT 20.0,
      min_qualifying_amount REAL NOT NULL DEFAULT 2000.0,
      is_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at TEXT DEFAULT NULL
    );
  `);
    // 6. MUHASEBE TABLOLARI (Accounting Module Tables)
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'
      currency TEXT NOT NULL DEFAULT 'TRY',
      balance REAL NOT NULL DEFAULT 0.00,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounting_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_number TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_type TEXT DEFAULT NULL,
      reference_id TEXT DEFAULT NULL,
      debit_total REAL NOT NULL DEFAULT 0.00,
      credit_total REAL NOT NULL DEFAULT 0.00,
      status TEXT NOT NULL DEFAULT 'POSTED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounting_transaction_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      account_code TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0.00,
      credit REAL NOT NULL DEFAULT 0.00,
      description TEXT DEFAULT '',
      FOREIGN KEY(transaction_id) REFERENCES accounting_transactions(id) ON DELETE CASCADE,
      FOREIGN KEY(account_code) REFERENCES accounting_accounts(code)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_number TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0.00,
      tax_rate REAL NOT NULL DEFAULT 20.0,
      currency TEXT NOT NULL DEFAULT 'TRY',
      payment_method TEXT NOT NULL,
      account_code TEXT NOT NULL,
      supplier_name TEXT DEFAULT '',
      description TEXT NOT NULL,
      invoice_number TEXT DEFAULT '',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      income_number TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0.00,
      currency TEXT NOT NULL DEFAULT 'TRY',
      payment_method TEXT NOT NULL,
      account_code TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL, -- 'SALE' | 'PURCHASE'
      party_name TEXT NOT NULL,
      party_phone TEXT DEFAULT '',
      date TEXT NOT NULL,
      due_date TEXT DEFAULT NULL,
      subtotal REAL NOT NULL DEFAULT 0.00,
      discount REAL NOT NULL DEFAULT 0.00,
      tax_amount REAL NOT NULL DEFAULT 0.00,
      total_amount REAL NOT NULL DEFAULT 0.00,
      paid_amount REAL NOT NULL DEFAULT 0.00,
      currency TEXT NOT NULL DEFAULT 'TRY',
      status TEXT NOT NULL DEFAULT 'ISSUED',
      order_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_code TEXT DEFAULT '',
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0.00,
      tax_rate REAL NOT NULL DEFAULT 20.0,
      tax_amount REAL NOT NULL DEFAULT 0.00,
      total REAL NOT NULL DEFAULT 0.00,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accounting_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL, -- 'INBOUND' | 'OUTBOUND'
      invoice_id INTEGER DEFAULT NULL,
      party_name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'TRY',
      payment_method TEXT NOT NULL,
      account_code TEXT NOT NULL,
      date TEXT NOT NULL,
      reference_no TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS accounting_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // Auto Migrations: Kolonlar eksikse otomatik ekle
    try {
        exports.db.exec(`ALTER TABLE products ADD COLUMN price REAL NOT NULL DEFAULT 299.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN total_price REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN unit_cost_price REAL NOT NULL DEFAULT 0.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN total_cost REAL NOT NULL DEFAULT 0.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN profit REAL NOT NULL DEFAULT 0.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE campaigns ADD COLUMN start_date TEXT DEFAULT NULL;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE campaigns ADD COLUMN end_date TEXT DEFAULT NULL;`);
    }
    catch (e) { }
    // İndeksler (Sorgu Hızlandırma)
    exports.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_short ON products(short_code);
    CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);
    CREATE INDEX IF NOT EXISTS idx_rewards_sender ON user_rewards(sender_id);
    CREATE INDEX IF NOT EXISTS idx_acc_accounts_code ON accounting_accounts(code);
    CREATE INDEX IF NOT EXISTS idx_acc_trx_date ON accounting_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_income_date ON income_entries(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON accounting_payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON accounting_audit_logs(entity_type, entity_id);
  `);
    // Varsayılan Başlangıç Verilerini Yükle
    seedInitialProducts();
    seedInitialSettings();
    seedInitialCampaigns();
    seedInitialAccountingAccounts();
    recoverLegacyData();
}
/**
  * Varsayılan Hesap Planını Yükler (Chart of Accounts)
  */
function seedInitialAccountingAccounts() {
    const countStmt = exports.db.prepare('SELECT COUNT(*) as count FROM accounting_accounts');
    const result = countStmt.get();
    if (result.count === 0) {
        const insertStmt = exports.db.prepare(`
      INSERT OR IGNORE INTO accounting_accounts (code, name, type, currency, balance)
      VALUES (?, ?, ?, ?, ?)
    `);
        const defaultAccounts = [
            { code: '100.01', name: 'Nakit Kasa', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '102.01', name: 'Garanti Bankası', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '102.02', name: 'İş Bankası', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '102.03', name: 'Ziraat Bankası', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '120', name: 'Alıcılar / Müşteri Cari', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '150', name: 'Ticari Mallar Stok Hesabı', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '191', name: 'İndirilecek KDV', type: 'ASSET', currency: 'TRY', balance: 0 },
            { code: '320', name: 'Satıcılar / Tedarikçi Cari', type: 'LIABILITY', currency: 'TRY', balance: 0 },
            { code: '391', name: 'Hesaplanan KDV', type: 'LIABILITY', currency: 'TRY', balance: 0 },
            { code: '500', name: 'Sermaye / Özkaynaklar', type: 'EQUITY', currency: 'TRY', balance: 0 },
            { code: '600', name: 'Satış Gelirleri', type: 'REVENUE', currency: 'TRY', balance: 0 },
            { code: '602', name: 'Diğer Gelirler', type: 'REVENUE', currency: 'TRY', balance: 0 },
            { code: '621', name: 'Satılan Ticari Mallar Maliyeti (STMM)', type: 'EXPENSE', currency: 'TRY', balance: 0 },
            { code: '770', name: 'Genel Yönetim & Faaliyet Giderleri', type: 'EXPENSE', currency: 'TRY', balance: 0 }
        ];
        for (const acc of defaultAccounts) {
            insertStmt.run(acc.code, acc.name, acc.type, acc.currency, acc.balance);
        }
        console.log(`[Database] 💰 ${defaultAccounts.length} varsayılan muhasebe hesabı yüklendi.`);
    }
}
/**
 * Başlangıç Stok Verilerini Ekler
 */
function seedInitialProducts() {
    const countStmt = exports.db.prepare('SELECT COUNT(*) as count FROM products');
    const result = countStmt.get();
    if (result.count === 0) {
        console.log('[Database] 🚀 Ürünler tablosu boş, başlangıç stok ve fiyat verileri yükleniyor...');
        const insertStmt = exports.db.prepare(`
      INSERT OR IGNORE INTO products (short_code, product_code, name, color, size, price, stock, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const initialProducts = [
            { shortCode: 'KGMLW', productCode: 'KGMLW-S', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'S', price: 299.00, stock: 99, category: 'GÖMLEK' },
            { shortCode: 'KGMLW', productCode: 'KGMLW-M', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'M', price: 299.00, stock: 5, category: 'GÖMLEK' },
            { shortCode: 'KGMLW', productCode: 'KGMLW-L', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'L', price: 299.00, stock: 100, category: 'GÖMLEK' },
            { shortCode: 'KTGMLB', productCode: 'KTGMLB-S', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'S', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
            { shortCode: 'KTGMLB', productCode: 'KTGMLB-M', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'M', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
            { shortCode: 'KTGMLB', productCode: 'KTGMLB-L', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'L', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
            { shortCode: 'DGMLP', productCode: 'DGMLP-S', name: 'DESENLİ GÖMLEK', color: 'PEMBE', size: 'S', price: 399.00, stock: 100, category: 'DESENLİ GÖMLEK' },
            { shortCode: 'DGMLP', productCode: 'DGMLP-M', name: 'DESENLİ GÖMLEK', color: 'PEMBE', size: 'M', price: 399.00, stock: 100, category: 'DESENLİ GÖMLEK' },
            { shortCode: 'NDL41', productCode: 'NDL41-41', name: 'NIKE DUNK LOW', color: 'BEYAZ/SİYAH', size: '41', price: 1299.00, stock: 50, category: 'AYAKKABI' },
            { shortCode: 'STRC39', productCode: 'STRC39-39', name: 'STAR CROSS', color: 'BEYAZ', size: '39', price: 899.00, stock: 30, category: 'AYAKKABI' },
            { shortCode: 'TSW', productCode: 'TSW-S', name: 'TSW T-SHIRT', color: 'BEYAZ', size: 'S', price: 199.00, stock: 75, category: 'T-SHIRT' }
        ];
        for (const p of initialProducts) {
            insertStmt.run(p.shortCode, p.productCode, p.name, p.color, p.size, p.price, p.stock, p.category);
        }
        console.log(`[Database] ✅ ${initialProducts.length} varsayılan ürün fiyatları ile yüklendi.`);
    }
}
/**
 * Varsayılan Sistem Ayarlarını Yükler (Kargo Ücretleri)
 */
function seedInitialSettings() {
    const setStmt = exports.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    setStmt.run('shipping_fee', '49'); // Standard Kargo 49 TL
    setStmt.run('free_shipping_threshold', '1500'); // 1500 TL Üzeri Ücretsiz Kargo
}
/**
 * Varsayılan Kampanyaları Yükler
 */
function seedInitialCampaigns() {
    const countStmt = exports.db.prepare('SELECT COUNT(*) as count FROM campaigns');
    const result = countStmt.get();
    if (result.count === 0) {
        const insertStmt = exports.db.prepare(`
      INSERT INTO campaigns (title, description, code, discount_percent, discount_amount, min_order_amount, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        insertStmt.run('🚀 1500 TL Üzeri Ücretsiz Kargo!', '1500 TL ve üzeri siparişlerde kargo ücreti ücretsizdir.', 'KARGO_BEDAVA', 0, 49, 1500, 1);
        insertStmt.run('🎉 DEMO10 İndirim Kodu', 'Tüm siparişlerde %10 Hoşgeldin İndirimi.', 'DEMO10', 10, 0, 0, 1);
        console.log('[Database] ✅ Aktif başlangıç kampanyaları yüklendi.');
    }
}
// Veritabanını Otomatik İlklendir
initDatabase();
