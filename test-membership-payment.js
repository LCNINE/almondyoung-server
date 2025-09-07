// test-membership-payment.js
// 멤버십 정기결제 실제 테스트 스크립트

const axios = require('axios');

// 실제 DB에 저장된 테스트 데이터
const TEST_USER_ID = 'hms-test-user-1757221534583';
const TEST_PAYMENT_METHOD_ID = '01K4H91FY4R8PYYXHBDV21DERQ';
const BASE_URL = 'http://localhost:5000'; // Wallet 서버 URL

async function testMembershipPayment() {
  console.log('🧪 멤버십 정기결제 테스트 시작...\n');

  try {
    // 1. 멤버십 결제 요청 데이터
    const membershipPaymentRequest = {
      userId: TEST_USER_ID,
      paymentMethodId: TEST_PAYMENT_METHOD_ID,
      amount: 29900, // 월 멤버십 요금
      currency: 'KRW',
      sessionId: `session_${Date.now()}`,
      metadata: {
        subscriptionType: 'PREMIUM_MONTHLY',
        billingCycle: 'MONTHLY',
        planId: 'premium-monthly-29900',
        startDate: new Date().toISOString(),
        source: 'api',
        userId: TEST_USER_ID, // metadata에 userId 포함
      },
      pricingSnapshot: {
        originalAmount: 39900,
        discountAmount: 10000,
        finalAmount: 29900,
        couponId: 'WELCOME10K',
        discountRate: 25.06,
      },
    };

    console.log('📤 요청 데이터:');
    console.log(JSON.stringify(membershipPaymentRequest, null, 2));
    console.log('\n');

    // 2. 멤버십 결제 API 호출
    console.log('🔄 멤버십 결제 API 호출 중...');
    const response = await axios.post(
      `${BASE_URL}/payments/membership`,
      membershipPaymentRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': `idem_${Date.now()}`, // 멱등성 키
        },
        timeout: 10000,
      },
    );

    console.log('✅ 멤버십 결제 성공!');
    console.log('📥 응답 데이터:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\n');

    // 3. 응답 검증
    const result = response.data;

    if (result.success) {
      console.log('🎉 결제 성공 확인:');
      console.log(`  - Payment Event ID: ${result.paymentEventId}`);
      console.log(`  - Transaction ID: ${result.transactionId}`);
      console.log(`  - Amount: ${result.amount}원`);
      console.log(`  - Status: ${result.status}`);
      console.log(`  - Processed At: ${result.processedAt}`);

      if (result.pgResponse) {
        console.log('  - PG Response:');
        console.log(`    - Gateway: ${result.pgResponse.gateway}`);
        console.log(
          `    - Approval Number: ${result.pgResponse.approvalNumber}`,
        );
      }
    } else {
      console.error('❌ 결제 실패:', result.error);
    }
  } catch (error) {
    console.error('❌ 테스트 실패:');

    if (error.response) {
      console.error('  - Status:', error.response.status);
      console.error('  - Error:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('  - 서버 응답 없음:', error.message);
      console.error('  - 서버가 실행 중인지 확인하세요:', BASE_URL);
    } else {
      console.error('  - 요청 설정 오류:', error.message);
    }
  }
}

// 여러 시나리오 테스트
async function runAllTests() {
  console.log('🚀 멤버십 정기결제 종합 테스트\n');

  // 테스트 1: 기본 멤버십 결제
  await testMembershipPayment();

  console.log('\n' + '='.repeat(50) + '\n');

  // 테스트 2: 다른 금액으로 결제 (베이직 플랜)
  try {
    console.log('🧪 베이직 플랜 결제 테스트...\n');

    const basicPaymentRequest = {
      userId: TEST_USER_ID,
      paymentMethodId: TEST_PAYMENT_METHOD_ID,
      amount: 19900,
      currency: 'KRW',
      sessionId: `session_basic_${Date.now()}`,
      metadata: {
        subscriptionType: 'BASIC_MONTHLY',
        billingCycle: 'MONTHLY',
        planId: 'basic-monthly-19900',
        source: 'api',
      },
      pricingSnapshot: {
        originalAmount: 19900,
        finalAmount: 19900,
      },
    };

    const basicResponse = await axios.post(
      `${BASE_URL}/payments/membership`,
      basicPaymentRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': `idem_basic_${Date.now()}`,
        },
      },
    );

    console.log('✅ 베이직 플랜 결제 성공!');
    console.log('📥 응답:', JSON.stringify(basicResponse.data, null, 2));
  } catch (error) {
    console.error(
      '❌ 베이직 플랜 결제 실패:',
      error.response?.data || error.message,
    );
  }
}

// 스크립트 실행
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log('\n🏁 모든 테스트 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 테스트 실행 중 오류:', error);
      process.exit(1);
    });
}

module.exports = { testMembershipPayment };
