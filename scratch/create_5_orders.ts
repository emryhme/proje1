import { initDatabase, db } from '../src/database/db';
import { OrderService } from '../src/services/order.service';

async function createFiveOrders() {
  initDatabase();

  // Aktif ürünleri çek
  const products = db.prepare('SELECT product_code, name, price, cost_price, size FROM products LIMIT 10').all() as any[];
  console.log(`Veritabanında ${products.length} ürün bulundu.`);

  const sampleCustomers = [
    { name: 'Ahmet Yılmaz', phone: '05321112233', address: 'Kadıköy, İstanbul' },
    { name: 'Ayşe Demir', phone: '05442223344', address: 'Çankaya, Ankara' },
    { name: 'Mehmet Kaya', phone: '05553334455', address: 'Karşıyaka, İzmir' },
    { name: 'Zeynep Çelik', phone: '05334445566', address: 'Nilüfer, Bursa' },
    { name: 'Caner Şahin', phone: '05425556677', address: 'Muratpaşa, Antalya' }
  ];

  const createdOrders = [];

  for (let i = 0; i < 5; i++) {
    const cust = sampleCustomers[i];
    const prod = products[i % products.length] || {
      product_code: 'KGMLW-M',
      name: 'KUMAŞ GÖMLEK',
      price: 299,
      size: 'M'
    };

    const qty = Math.floor(Math.random() * 2) + 1; // 1-2 adet
    const unitPrice = Number(prod.price) || 299;
    const discount = i === 2 ? 50 : 0; // 3. siparişte 50 TL indirim
    const totalPrice = (unitPrice * qty) - discount;

    const orderData = {
      customerName: cust.name,
      customerPhone: cust.phone,
      address: cust.address,
      productCode: prod.product_code,
      productName: prod.name,
      size: prod.size || 'M',
      quantity: qty,
      unitPrice,
      discount,
      totalPrice,
      senderId: `SIMULATOR_USER_${i + 1}`
    };

    const savedOrder = await OrderService.createOrder(orderData);
    
    // 3 siparişi ONAYLI (OK), 2 siparişi BEKLEMEDE yap
    if (i < 3) {
      await OrderService.updateOrderStatus(savedOrder.orderId, 'OK');
    }

    createdOrders.push(savedOrder);
  }

  console.log('\n======================================================');
  console.log('✅ 5 ADET SİPARİŞ BAŞARIYLA OLUŞTURULDU!');
  console.log('======================================================');
  createdOrders.forEach((o, idx) => {
    console.log(`${idx + 1}. [${o.orderId}] ${o.customerName} - ${o.productName} (${o.quantity} Adet) | Toplam: ${o.totalPrice} TL | Durum: ${o.status}`);
  });
}

createFiveOrders().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
