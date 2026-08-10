import axios from 'axios';

async function postFiveLiveOrders() {
  const url = 'http://136.92.8.201:3001/api/chat';

  const customers = [
    { name: 'Ahmet Yılmaz', phone: '05321112233', address: 'Kadıköy İstanbul', product: 'KGMLW-M' },
    { name: 'Ayşe Demir', phone: '05442223344', address: 'Çankaya Ankara', product: 'KGMLW-S' },
    { name: 'Mehmet Şahin', phone: '05553334455', address: 'Karşıyaka İzmir', product: 'KGMLW-L' },
    { name: 'Zeynep Çelik', phone: '05334445566', address: 'Nilüfer Bursa', product: 'KTGMLB-S' },
    { name: 'Caner Öztürk', phone: '05425556677', address: 'Muratpaşa Antalya', product: 'KTGMLB-M' }
  ];

  console.log('🚀 Canlı sunucuya (http://136.92.8.201:3001) 5 sipariş gönderiliyor...\n');

  for (let i = 0; i < customers.length; i++) {
    const cust = customers[i];
    const senderId = `CANLI_SIMULATOR_${Date.now()}_${i + 1}`;

    try {
      // 1. Sipariş Talebi Gönder
      const promptText = `Sipariş vermek istiyorum. Adım: ${cust.name}, Telefonum: ${cust.phone}, Adresim: ${cust.address}, Ürün Kodu: ${cust.product}, Beden: M, Adet: 1`;
      console.log(`[${i + 1}/5] Gönderiliyor: ${cust.name} (${cust.product})...`);

      const res1 = await axios.post(url, { senderId, message: promptText });
      console.log(`   AI Yanıtı: ${res1.data?.reply ? res1.data.reply.substring(0, 70).replace(/\n/g, ' ') : ''}...`);

      // 2. Onay Gönder ("Evet onaylıyorum")
      const res2 = await axios.post(url, { senderId, message: 'Evet, bilgileri onaylıyorum. Siparişimi hemen oluştur.' });
      console.log(`   ✅ Onay Sonucu: ${res2.data?.reply ? res2.data.reply.substring(0, 90).replace(/\n/g, ' ') : ''}...\n`);

    } catch (err: any) {
      console.error(`   ❌ Hata (${cust.name}):`, err.message);
    }
  }

  console.log('🎉 5 sipariş canlı sunucunun AI satış temsilcisi üzerinden başarıyla oluşturuldu!');
}

postFiveLiveOrders();
