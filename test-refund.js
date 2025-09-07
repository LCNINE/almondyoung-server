// test-refund.js
// 멤버십 결제 환불 테스트 스크립트

const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

// 방금 생성된 PaymentEvent ID들 (정기결제 테스트에서 생성됨)
const TEST_PAYMENT_EVENT_IDS = [
  '01K4HM00KHMXX7PC41024CCVF2', // 프리미엄 플랜 (29,900원)
  '01K4HM0187T34DZQ5K3QQSGBTV', // 베이직 플랜 (19,900원)
  '01K4HM02W110G4VA2EF3F2GRJ5', // 베이직 플랜 (19,900원)
];

async function testFullRefund(paymentEventId, expectedAmount) {
  console.log(`🔄 전액 환불 테스트: ${paymentEventId}`);

  try {
    const refundRequest = {
      paymentEventId: paymentEventId,
      reason: '고객 요청 환불',
      metadata: {
        refundType: 'FULL_REFUND',
        requestedBy: 'CUSTOMER',
        requestedAt: new Date().toISOString(),
        originalAmount: expectedAmount,
      },
    };

    console.log('📤 환불 요청 데이터:');
    console.log(JSON.stringify(refundRequest, null, 2));

    const response = await axios.post(
      `${BASE_URL}/payments/refund`,
      refundRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': `refund_${paymentEventId}_${Date.now()}`,
        },
        timeout: 10000,
      },
    );

    console.log('✅ 환불 성공!');
    console.log('📥 응답 데이터:');
    console.log(JSON.stringify(response.data, null, 2));

    // 응답 검증
    const result = response.data;
    if (result.success) {
      console.log('🎉 환불 성공 확인:');
      console.log(`  - Refund Event ID: ${result.refundEventId}`);
      console.log(`  - Original Payment ID: ${result.originalPaymentEventId}`);
      console.log(`  - Refunded Amount: ${result.refundedAmount}원`);
      console.log(`  - Status: ${result.status}`);
      console.log(`  - Processed At: ${result.processedAt}`);

      return {
        success: true,
        refundEventId: result.refundEventId,
        refundedAmount: result.refundedAmount,
        paymentEventId: paymentEventId,
      };
    } else {
      console.error('❌ 환불 실패:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ 환불 테스트 실패:');

    if (error.response) {
      console.error('  - Status:', error.response.status);
      console.error('  - Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('  - Error:', error.message);
    }

    return { success: false, error: error.message };
  }
}

async function testPartialRefund(paymentEventId, originalAmount, refundAmount) {
  console.log(`🔄 부분 환불 테스트: ${paymentEventId} (${refundAmount}원)`);

  try {
    const refundRequest = {
      paymentEventId: paymentEventId,
      amount: refundAmount, // 부분 환불 금액
      reason: '부분 환불 - 서비스 일부 취소',
      metadata: {
        refundType: 'PARTIAL_REFUND',
        requestedBy: 'ADMIN',
        requestedAt: new Date().toISOString(),
        originalAmount: originalAmount,
        partialReason: '서비스 일부 이용 후 취소',
      },
    };

    console.log('📤 부분 환불 요청:');
    console.log(JSON.stringify(refundRequest, null, 2));

    const response = await axios.post(
      `${BASE_URL}/payments/refund`,
      refundRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': `partial_refund_${paymentEventId}_${Date.now()}`,
        },
      },
    );

    console.log('✅ 부분 환불 성공!');
    console.log('📥 응답:', JSON.stringify(response.data, null, 2));

    return {
      success: true,
      refundEventId: response.data.refundEventId,
      refundedAmount: response.data.refundedAmount,
      paymentEventId: paymentEventId,
    };
  } catch (error) {
    console.error('❌ 부분 환불 실패:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

async function testInvalidRefund() {
  console.log('🔄 잘못된 환불 요청 테스트 (존재하지 않는 PaymentEvent)');

  try {
    const invalidRequest = {
      paymentEventId: 'invalid-payment-event-id',
      reason: '테스트용 잘못된 요청',
    };

    await axios.post(`${BASE_URL}/payments/refund`, invalidRequest, {
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('❌ 예상과 다름: 잘못된 요청이 성공했습니다');
    return { success: false, error: '잘못된 요청이 성공함' };
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log('✅ 예상대로 400 에러 발생');
      console.log(`  - Error Message: ${error.response.data.message}`);
      return { success: true, expectedError: true };
    } else {
      console.error(
        '❌ 예상과 다른 에러:',
        error.response?.data || error.message,
      );
      return { success: false, error: error.message };
    }
  }
}

async function testDuplicateRefund(paymentEventId) {
  console.log(`🔄 중복 환불 방지 테스트: ${paymentEventId}`);

  const idempotencyKey = `duplicate_test_${Date.now()}`;

  try {
    const refundRequest = {
      paymentEventId: paymentEventId,
      reason: '중복 환불 테스트',
    };

    // 첫 번째 환불 요청
    console.log('📤 첫 번째 환불 요청...');
    const firstResponse = await axios.post(
      `${BASE_URL}/payments/refund`,
      refundRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
      },
    );

    console.log('✅ 첫 번째 환불 성공');

    // 두 번째 환불 요청 (같은 멱등성 키)
    console.log('📤 두 번째 환불 요청 (같은 멱등성 키)...');
    const secondResponse = await axios.post(
      `${BASE_URL}/payments/refund`,
      refundRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
      },
    );

    // 같은 결과 반환 확인
    if (
      firstResponse.data.refundEventId === secondResponse.data.refundEventId &&
      firstResponse.data.refundedAmount === secondResponse.data.refundedAmount
    ) {
      console.log('✅ 멱등성 테스트 성공: 같은 결과 반환');
      return { success: true, idempotencyTest: 'PASSED' };
    } else {
      console.log('❌ 멱등성 테스트 실패: 다른 결과 반환');
      return { success: false, error: '멱등성 실패' };
    }
  } catch (error) {
    console.error(
      '❌ 중복 환불 테스트 실패:',
      error.response?.data || error.message,
    );
    return { success: false, error: error.message };
  }
}

// 종합 환불 테스트 실행
async function runRefundTests() {
  console.log('🚀 멤버십 결제 환불 종합 테스트\n');

  const results = [];

  // 테스트 1: 전액 환불
  console.log('='.repeat(60));
  console.log('📋 테스트 1: 전액 환불');
  console.log('='.repeat(60));

  const fullRefundResult = await testFullRefund(
    TEST_PAYMENT_EVENT_IDS[0],
    29900,
  );
  results.push({ test: '전액 환불', ...fullRefundResult });

  console.log('\n' + '='.repeat(60));
  console.log('📋 테스트 2: 부분 환불');
  console.log('='.repeat(60));

  // 테스트 2: 부분 환불
  const partialRefundResult = await testPartialRefund(
    TEST_PAYMENT_EVENT_IDS[1],
    19900,
    10000, // 10,000원만 환불
  );
  results.push({ test: '부분 환불', ...partialRefundResult });

  console.log('\n' + '='.repeat(60));
  console.log('📋 테스트 3: 잘못된 환불 요청');
  console.log('='.repeat(60));

  // 테스트 3: 잘못된 환불 요청
  const invalidRefundResult = await testInvalidRefund();
  results.push({ test: '잘못된 요청', ...invalidRefundResult });

  console.log('\n' + '='.repeat(60));
  console.log('📋 테스트 4: 중복 환불 방지');
  console.log('='.repeat(60));

  // 테스트 4: 중복 환불 방지
  const duplicateRefundResult = await testDuplicateRefund(
    TEST_PAYMENT_EVENT_IDS[2],
  );
  results.push({ test: '중복 환불 방지', ...duplicateRefundResult });

  // 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📈 환불 테스트 결과 요약');
  console.log('='.repeat(60));

  let successCount = 0;
  results.forEach((result, index) => {
    const status = result.success ? '✅ 성공' : '❌ 실패';
    console.log(`  ${index + 1}. ${result.test}: ${status}`);
    if (result.success) successCount++;

    if (result.refundEventId) {
      console.log(`     - Refund Event ID: ${result.refundEventId}`);
    }
    if (result.refundedAmount) {
      console.log(`     - Refunded Amount: ${result.refundedAmount}원`);
    }
  });

  console.log(`\n📊 전체 결과: ${successCount}/${results.length} 테스트 성공`);

  if (successCount === results.length) {
    console.log('🎉 모든 환불 테스트 성공!');
    console.log('✅ 환불 시스템이 정상적으로 작동합니다.');
  } else {
    console.log('⚠️  일부 환불 테스트 실패');
    console.log('🔧 환불 시스템을 점검해주세요.');
  }

  return {
    results,
    overallSuccess: successCount === results.length,
    successRate: `${successCount}/${results.length}`,
  };
}

// 스크립트 실행
if (require.main === module) {
  runRefundTests()
    .then((summary) => {
      console.log('\n🏁 환불 테스트 완료!');
      process.exit(summary.overallSuccess ? 0 : 1);
    })
    .catch((error) => {
      console.error('💥 환불 테스트 실행 중 오류:', error);
      process.exit(1);
    });
}

module.exports = { testFullRefund, testPartialRefund, runRefundTests };
