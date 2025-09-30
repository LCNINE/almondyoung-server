#!/usr/bin/env node

const API_BASE_URL = 'http://localhost:3000';

// 간단한 미용샵 제품들 (복잡한 구조 제거)
const simpleBeautyProducts = [
  {
    name: 'Kerastase Shampoo',
    description: 'Professional hair shampoo',
    brand: 'Kerastase',
    basePrice: 45000,
    pricingStrategy: 'option_based',
    tags: ['shampoo', 'hair'],
    images: ['https://via.placeholder.com/400x400?text=Shampoo'],
  },
  {
    name: 'Loreal Treatment',
    description: 'Hair color treatment',
    brand: 'Loreal',
    basePrice: 38000,
    pricingStrategy: 'option_based',
    tags: ['treatment', 'hair'],
    images: ['https://via.placeholder.com/400x400?text=Treatment'],
  },
  {
    name: 'Wella Fusion Shampoo',
    description: 'Nutrition shampoo',
    brand: 'Wella',
    basePrice: 42000,
    pricingStrategy: 'option_based',
    tags: ['shampoo', 'nutrition'],
    images: ['https://via.placeholder.com/400x400?text=Wella'],
  },
  {
    name: 'Hair Oil Ultimate',
    description: 'Argan oil hair essence',
    brand: 'Schwarzkopf',
    basePrice: 35000,
    pricingStrategy: 'option_based',
    tags: ['oil', 'essence'],
    images: ['https://via.placeholder.com/400x400?text=Oil'],
  },
  {
    name: 'Moroccan Oil Treatment',
    description: 'Argan oil hair treatment',
    brand: 'Moroccanoil',
    basePrice: 48000,
    pricingStrategy: 'option_based',
    tags: ['oil', 'premium'],
    images: ['https://via.placeholder.com/400x400?text=Moroccan'],
  },
];

async function createProduct(productData) {
  try {
    const response = await fetch(`${API_BASE_URL}/masters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log(`✅ 상품 생성 성공: ${productData.name} (ID: ${result.id})`);
    return result;
  } catch (error) {
    console.error(`❌ 상품 생성 실패: ${productData.name}`, error.message);
    return null;
  }
}

async function createAllProducts() {
  console.log('🚀 간단한 미용샵 상품 5개 생성 시작...\n');

  const results = [];

  for (let i = 0; i < simpleBeautyProducts.length; i++) {
    const product = simpleBeautyProducts[i];
    console.log(`[${i + 1}/5] ${product.name} 생성 중...`);

    const result = await createProduct(product);
    results.push(result);

    // API 부하 방지를 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const successCount = results.filter((r) => r !== null).length;
  console.log(`\n🎉 완료! 총 ${successCount}개 상품이 생성되었습니다.`);

  if (successCount < 5) {
    console.log(`⚠️  ${5 - successCount}개 상품 생성에 실패했습니다.`);
  }
}

// 스크립트 실행
if (require.main === module) {
  createAllProducts().catch(console.error);
}

module.exports = { createAllProducts, simpleBeautyProducts };
