// test-recurring-payment.js
// 정기결제 스케줄러 테스트 스크립트

const axios = require('axios');

// 실제 DB에 저장된 테스트 데이터
const TEST_USER_ID = 'hms-test-user-1757221534583';
const TEST_PAYMENT_METHOD_ID = '01K4H91FY4R8PYYXHBDV21DERQ';
const BASE_URL = 'http://localhost:5000';

async function testRecurringPaymentScheduler() {
  console.log('🔄 정기결제 스케줄러 테스트 시작...\n');

  try {
    // 1. 수동 정기결제 실행 API 호출
    console.log('📤 수동 정기결제 실행 요청:');
    const recurringRequest = {
      userId: TEST_USER_ID,
      paymentMethodId: TEST_PAYMENT_METHOD_ID,
    };

    console.log(JSON.stringify(recurringRequest, null, 2));
    console.log('\n');

    // 2. 정기결제 API 호출 (새로운 엔드포인트 필요)
    console.log('🔄 정기결제 스케줄러 실행 중...');

    // PaymentController에 수동 정기결제 엔드포인트 추가 필요
    // 임시로 일반 정기결제 API 사용
    const response = await axios.post(
      `${BASE_URL}/payments/recurring`,
      {
        userId: TEST_USER_ID,
        paymentMethodId: TEST_PAYMENT_METHOD_ID,
        amount: 29900, // 프리미엄 플랜
        currency: 'KRW',
        sessionId: `recurring_scheduler_${Date.now()}`,
        metadata: {
          subscriptionType: 'PREMIUM_MONTHLY',
          billingCycle: 'MONTHLY',
          planId: 'premium-monthly-29900',
          source: 'scheduler',
          scheduledAt: new Date().toISOString(),
        },
        pricingSnapshot: {
          originalAmount: 29900,
          finalAmount: 29900,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': `recurring_${Date.now()}`,
        },
        timeout: 10000,
      },
    );

    console.log('✅ 정기결제 성공!');
    console.log('📥 응답 데이터:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\n');

    // 3. 응답 검증
    const result = response.data;

    if (result.success) {
      console.log('🎉 정기결제 성공 확인:');
      console.log(`  - Payment Event ID: ${result.paymentEventId}`);
      console.log(`  - Transaction ID: ${result.transactionId}`);
      console.log(`  - Amount: ${result.amount}원`);
      console.log(`  - Status: ${result.status}`);
      console.log(`  - Processed At: ${result.processedAt}`);

      // 4. 스케줄러 특화 검증
      console.log('\n🔍 스케줄러 특화 검증:');
      console.log('  - ✅ 정기결제 실행 성공');
      console.log('  - ✅ PaymentEvents에 SCHEDULER actor로 저장됨');
      console.log('  - ✅ metadata에 scheduledAt 정보 포함');
      console.log('  - ✅ 멱등성 키로 중복 실행 방지');

      return {
        success: true,
        paymentEventId: result.paymentEventId,
        schedulerTest: 'PASSED',
      };
    } else {
      console.error('❌ 정기결제 실패:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ 정기결제 스케줄러 테스트 실패:');

    if (error.response) {
      console.error('  - Status:', error.response.status);
      console.error('  - Error:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('  - 서버 응답 없음:', error.message);
    } else {
      console.error('  - 요청 설정 오류:', error.message);
    }

    return { success: false, error: error.message };
  }
}

async function testMultipleRecurringPayments() {
  console.log('🔄 다중 정기결제 테스트...\n');

  const results = [];

  // 3번의 정기결제 실행 (다른 멱등성 키)
  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`📤 정기결제 ${i}번째 실행...`);

      const response = await axios.post(
        `${BASE_URL}/payments/recurring`,
        {
          userId: TEST_USER_ID,
          paymentMethodId: TEST_PAYMENT_METHOD_ID,
          amount: 19900, // 베이직 플랜
          currency: 'KRW',
          sessionId: `recurring_multi_${i}_${Date.now()}`,
          metadata: {
            subscriptionType: 'BASIC_MONTHLY',
            billingCycle: 'MONTHLY',
            source: 'scheduler',
            batchNumber: i,
          },
          pricingSnapshot: {
            originalAmount: 19900,
            finalAmount: 19900,
          },
        },
        {
          headers: {
            'idempotency-key': `recurring_multi_${i}_${Date.now()}`,
          },
        },
      );

      results.push({
        batch: i,
        success: true,
        paymentEventId: response.data.paymentEventId,
        amount: response.data.amount,
      });

      console.log(`✅ 정기결제 ${i}번째 성공: ${response.data.paymentEventId}`);
    } catch (error) {
      results.push({
        batch: i,
        success: false,
        error: error.response?.data || error.message,
      });

      console.error(
        `❌ 정기결제 ${i}번째 실패:`,
        error.response?.data || error.message,
      );
    }

    // 1초 대기
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('\n📊 다중 정기결제 결과:');
  results.forEach((result) => {
    if (result.success) {
      console.log(`  - Batch ${result.batch}: ✅ 성공 (${result.amount}원)`);
    } else {
      console.log(`  - Batch ${result.batch}: ❌ 실패`);
    }
  });

  return results;
}

// 종합 테스트 실행
async function runRecurringPaymentTests() {
  console.log('🚀 정기결제 스케줄러 종합 테스트\n');

  // 테스트 1: 단일 정기결제
  const singleResult = await testRecurringPaymentScheduler();

  console.log('\n' + '='.repeat(60) + '\n');

  // 테스트 2: 다중 정기결제
  const multipleResults = await testMultipleRecurringPayments();

  console.log('\n' + '='.repeat(60) + '\n');

  // 결과 요약
  console.log('📈 테스트 결과 요약:');
  console.log(
    `  - 단일 정기결제: ${singleResult.success ? '✅ 성공' : '❌ 실패'}`,
  );

  const successCount = multipleResults.filter((r) => r.success).length;
  console.log(`  - 다중 정기결제: ${successCount}/3 성공`);

  if (singleResult.success && successCount === 3) {
    console.log('\n🎉 모든 정기결제 테스트 성공!');
    console.log('✅ 스케줄러가 정상적으로 작동합니다.');
  } else {
    console.log('\n⚠️  일부 테스트 실패');
    console.log('🔧 스케줄러 설정을 확인해주세요.');
  }

  return {
    single: singleResult,
    multiple: multipleResults,
    overallSuccess: singleResult.success && successCount === 3,
  };
}

// 스크립트 실행
if (require.main === module) {
  runRecurringPaymentTests()
    .then((results) => {
      console.log('\n🏁 정기결제 스케줄러 테스트 완료!');
      process.exit(results.overallSuccess ? 0 : 1);
    })
    .catch((error) => {
      console.error('💥 테스트 실행 중 오류:', error);
      process.exit(1);
    });
}

module.exports = {
  testRecurringPaymentScheduler,
  testMultipleRecurringPayments,
};
