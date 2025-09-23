const {
  generateUUIDv7,
} = require('./apps/wallet/src/shared/utils/id-generator');

console.log('Testing generateUUIDv7():');
for (let i = 0; i < 5; i++) {
  const uuid = generateUUIDv7();
  console.log(`  ${i + 1}. "${uuid}" (length: ${uuid.length})`);
}

// TSID도 테스트
const { getTsid } = require('tsid-ts');
console.log('\nTesting getTsid():');
for (let i = 0; i < 5; i++) {
  const tsid = getTsid().toString();
  console.log(`  ${i + 1}. "${tsid}" (length: ${tsid.length})`);
}
