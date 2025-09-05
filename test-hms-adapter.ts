#!/usr/bin/env ts-node

/**
 * HMS Card Payment Adapter 테스트
 *
 * hms-card-payment.adapter.ts에서 발생하는 500 에러를 디버깅하기 위한 테스트 스크립트
 */

import { HmsCardPaymentAdapter } from './apps/wallet/src/adapters/hms-card-payment.adapter';
import { PaymentMethodRegistrationRequest } from './apps/wallet/src/interfaces/payment-gateway.interface';
import * as dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

// 테스트 데이터
const testRegistrationRequest: PaymentMethodRegistrationRequest = {
  userId: 'test-user-001',
  memberName: '테스트사용자',
  phone: '01012345678',
  paymentNumber: '1234567890123456',
  payerName: '테스트사용자',
  payerNumber: '1990010112',
  validYear: '25',
  validMonth: '12',
  billingCycleDay: 1,
};

async function testHmsCardAdapter() {
  console.log('🚀 HMS Card Payment Adapter 테스트 시작...');

  try {
    // HMS Card Payment Adapter 인스턴스 생성
    const adapter = new HmsCardPaymentAdapter();
    console.log('✅ HMS Card Payment Adapter 생성 성공');

    // 회원 등록 테스트
    console.log('\n📝 회원 등록 테스트...');
    console.log(
      '요청 데이터:',
      JSON.stringify(testRegistrationRequest, null, 2),
    );

    const result = await adapter.registerRecurringMember(
      testRegistrationRequest,
    );

    if (result.success) {
      console.log('✅ 회원 등록 성공!');
      console.log('결과:', JSON.stringify(result, null, 2));
    } else {
      console.log('❌ 회원 등록 실패');
      console.log('에러:', result.error);
    }
  } catch (error: any) {
    console.log('❌ 테스트 실행 중 에러 발생:', error.message);
    console.log('상세 에러:', error);

    // HMS API 에러인 경우 더 자세한 정보 출력
    if (error.error) {
      console.log('HMS 에러 메시지:', error.error.message);
      console.log('HMS 개발자 메시지:', error.error.developerMessage);
    }

    if (error.response) {
      console.log('HTTP 응답 상태:', error.response.status);
      console.log('HTTP 응답 데이터:', error.response.data);
    }
  }
}

// 스크립트 실행
if (require.main === module) {
  testHmsCardAdapter().catch(console.error);
}
