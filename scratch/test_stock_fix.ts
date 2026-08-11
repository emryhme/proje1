import { StockService } from '../src/services/stock.service';
import { CartService } from '../src/services/cart.service';

async function main() {
  console.log('🧪 Testing StockService.checkStock short code match...');

  // Add dummy product for test
  await StockService.addProduct({
    shortCode: 'TESTFIX',
    productCode: 'TESTFIX-M',
    name: 'TEST FIX ELBISE',
    color: 'Siyah',
    size: 'M',
    stock: 25,
    category: 'Elbise'
  });

  const res = await StockService.checkStock('TESTFIX');
  console.log('checkStock result:', res);

  if (!res.exists || !res.product) {
    console.error('❌ FAIL: Product not found!');
    process.exit(1);
  }

  if (res.product.stock !== 25) {
    console.error(`❌ FAIL: Expected real stock 25, got: ${res.product.stock}`);
    process.exit(1);
  }

  if (res.product.price === undefined) {
    console.error('❌ FAIL: Price is missing!');
    process.exit(1);
  }

  console.log('✅ PASS: checkStock returned real stock (25) and price!');

  // Test CartService.addItem with quantity 2
  const cartRes = await CartService.addItem('MOCK_TEST_USER_99', 'TESTFIX', 2, 'M');
  console.log('addItem result:', cartRes);

  if (!cartRes.success || !cartRes.cartItem) {
    console.error(`❌ FAIL: addItem failed: ${cartRes.message}`);
    process.exit(1);
  }

  if (cartRes.cartItem.quantity !== 2) {
    console.error(`❌ FAIL: Expected quantity 2, got ${cartRes.cartItem.quantity}`);
    process.exit(1);
  }

  console.log('🎉 ALL STOCK & CART FIX TESTS PASSED!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
