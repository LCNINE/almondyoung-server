#!/usr/bin/env tsx

/**
 * 쿠팡 발주서 단건 조회 테스트 스크립트
 *
 * 사용법:
 * ```bash
 * # 특정 shipmentBoxId로 테스트
 * npx tsx test-coupang-single.ts 642538971006401429
 *
 * # 환경변수 설정 후 테스트
 * COUPANG_VENDOR_ID=A00000001 \
 * COUPANG_ACCESS_KEY=your_access_key \
 * COUPANG_SECRET_KEY=your_secret_key \
 * npx tsx test-coupang-single.ts 642538971006401429
 * ```
 */

import { HttpService } from '@nestjs/axios';
import { CoupangStrategy } from './src/services/strategies/coupang.strategy';

async function testCoupangSingleOrderSheet() {
  // 환경변수 확인
  const requiredEnvs = [
    'COUPANG_VENDOR_ID',
    'COUPANG_ACCESS_KEY',
    'COUPANG_SECRET_KEY',
  ];
  const missingEnvs = requiredEnvs.filter((env) => !process.env[env]);

  if (missingEnvs.length > 0) {
    console.error('❌ 필수 환경변수가 설정되지 않았습니다:', missingEnvs);
    console.log('\n📋 환경변수 설정 예시:');
    console.log('export COUPANG_VENDOR_ID=A00000001');
    console.log('export COUPANG_ACCESS_KEY=your_access_key');
    console.log('export COUPANG_SECRET_KEY=your_secret_key');
    process.exit(1);
  }

  // 명령행 인수에서 shipmentBoxId 가져오기
  const shipmentBoxId = process.argv[2];
  if (!shipmentBoxId) {
    console.error('❌ shipmentBoxId를 제공해주세요.');
    console.log('사용법: npx tsx test-coupang-single.ts <shipmentBoxId>');
    console.log('예시: npx tsx test-coupang-single.ts 642538971006401429');
    process.exit(1);
  }

  console.log('🚀 쿠팡 발주서 단건 조회 테스트 시작');
  console.log(`📋 설정 정보:`);
  console.log(`  - Vendor ID: ${process.env.COUPANG_VENDOR_ID}`);
  console.log(
    `  - Access Key: ${process.env.COUPANG_ACCESS_KEY?.slice(0, 8)}...`,
  );
  console.log(`  - ShipmentBox ID: ${shipmentBoxId}`);
  console.log('');

  try {
    // HttpService와 CoupangStrategy 인스턴스 생성
    const httpService = new HttpService();
    const coupangStrategy = new CoupangStrategy(httpService);

    // 단건 조회 실행
    console.log('🔍 쿠팡 발주서 단건 조회 실행 중...');
    const orderEvent = await coupangStrategy.getSingleOrderSheet(shipmentBoxId);

    console.log('\n✅ 쿠팡 발주서 단건 조회 성공!');
    console.log('📊 조회 결과:');
    console.log(JSON.stringify(orderEvent, null, 2));

    // 중요 정보 요약
    console.log('\n📋 주요 정보 요약:');
    console.log(`  🏷️  주문번호: ${orderEvent.externalOrderId}`);
    console.log(`  📦 상품주문번호: ${orderEvent.externalProductOrderId}`);
    console.log(`  📊 주문상태: ${orderEvent.status}`);
    console.log(
      `  👤 수취인: ${orderEvent.buyer?.name} (${orderEvent.buyer?.contact})`,
    );
    console.log(
      `  🏠 배송지: ${orderEvent.buyer?.address?.roadAddress} ${orderEvent.buyer?.address?.detailAddress}`,
    );
    console.log(`  📮 우편번호: ${orderEvent.buyer?.address?.postalCode}`);

    if (orderEvent.dispatch?.trackingNumber) {
      console.log(
        `  🚚 운송장: ${orderEvent.dispatch.deliveryCompanyCode} - ${orderEvent.dispatch.trackingNumber}`,
      );
      console.log(`  📅 발송일: ${orderEvent.dispatch.dispatchedAt}`);
    } else {
      console.log(`  🚚 운송장: 아직 발송되지 않음`);
    }

    console.log(`  💰 주문금액: ${orderEvent.priceAmount.toLocaleString()}원`);
    if (orderEvent.discountAmount && orderEvent.discountAmount > 0) {
      console.log(
        `  💸 할인금액: ${orderEvent.discountAmount.toLocaleString()}원`,
      );
    }
    console.log(`  🔢 주문수량: ${orderEvent.quantity}개`);

    console.log('\n🎉 테스트 완료!');
  } catch (error) {
    console.error('\n❌ 쿠팡 발주서 단건 조회 실패:');
    console.error(`  오류 메시지: ${error.message}`);

    if (error.response?.data) {
      console.error(
        `  API 응답:`,
        JSON.stringify(error.response.data, null, 2),
      );
    }

    if (error.message.includes('인증')) {
      console.log('\n💡 문제 해결 방법:');
      console.log('  1. 쿠팡 파트너스 센터에서 API 키 확인');
      console.log('  2. 환경변수 설정 재확인');
      console.log('  3. API 키 권한 확인 (발주서 조회 권한)');
    }

    if (
      error.message.includes('not found') ||
      error.message.includes('찾을 수 없')
    ) {
      console.log('\n💡 문제 해결 방법:');
      console.log(
        '  1. shipmentBoxId 확인 (Wing 또는 발주서 목록 API에서 조회 가능)',
      );
      console.log('  2. 해당 업체의 발주서인지 확인');
      console.log('  3. 발주서 상태 확인 (취소된 주문일 수 있음)');
    }

    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  testCoupangSingleOrderSheet().catch(console.error);
}
