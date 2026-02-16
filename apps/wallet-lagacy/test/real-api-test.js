const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000';

// 테스트 데이터
const testUserId = `user_${Date.now()}`;
let testProfileId = null;
let testAccountId = null;
let testIntentId = null;

console.log('🚀 BNPL API 실제 테스트 시작');
console.log(`테스트 사용자 ID: ${testUserId}`);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. BNPL 프로필 생성 (multipart)
async function createBnplProfile() {
  console.log('\n📝 1. BNPL 프로필 생성 테스트');

  try {
    const form = new FormData();
    form.append('userId', testUserId);
    form.append('payerName', '김비엔피엘');
    form.append('phone', '01098765432');
    form.append('paymentCompany', '088'); // 신한은행
    form.append('paymentNumber', '110222333444');
    form.append('payerNumber', '950101');
    form.append('name', '나의 BNPL 계좌');

    // 테스트 파일 생성 및 첨부
    const testFileContent = Buffer.from('This is a test BNPL agreement file.');
    form.append('agreementFile', testFileContent, {
      filename: 'bnpl_agreement.pdf',
      contentType: 'application/pdf',
    });

    const response = await fetch(`${BASE_URL}/v2/payments/hms-bnpl/onboard`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 헤더:', Object.fromEntries(response.headers.entries()));
    console.log('응답 본문:', responseText);

    if (response.ok) {
      const data = JSON.parse(responseText);
      testProfileId = data.profileId;
      console.log(`✅ 프로필 생성 성공! profileId: ${testProfileId}`);
    } else {
      console.log('❌ 프로필 생성 실패');
    }
  } catch (error) {
    console.error('❌ 프로필 생성 에러:', error.message);
  }
}

// 2. BNPL 계정 생성
async function createBnplAccount() {
  console.log('\n💳 2. BNPL 계정 생성 테스트');

  try {
    const response = await fetch(`${BASE_URL}/v2/payments/bnpl/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        creditLimit: 500000, // 50만원 한도
      }),
    });

    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);

    if (response.ok) {
      const data = JSON.parse(responseText);
      testAccountId = data.accountId;
      console.log(`✅ 계정 생성 성공! accountId: ${testAccountId}`);
    } else {
      console.log('❌ 계정 생성 실패');
    }
  } catch (error) {
    console.error('❌ 계정 생성 에러:', error.message);
  }
}

// 3. 결제 Intent 생성
async function createPaymentIntent() {
  console.log('\n🎯 3. 결제 Intent 생성 테스트');

  try {
    const response = await fetch(`${BASE_URL}/v2/payments/intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: testUserId,
        amount: 150000, // 15만원
        type: 'BNPL_CAPTURE',
      }),
    });

    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);

    if (response.ok) {
      const data = JSON.parse(responseText);
      testIntentId = data.id;
      console.log(`✅ Intent 생성 성공! intentId: ${testIntentId}`);
    } else {
      console.log('❌ Intent 생성 실패');
    }
  } catch (error) {
    console.error('❌ Intent 생성 에러:', error.message);
  }
}

// 4. BNPL 결제 승인
async function authorizeBnplPayment() {
  console.log('\n🔐 4. BNPL 결제 승인 테스트');

  if (!testIntentId || !testProfileId) {
    console.log(
      '❌ intentId 또는 profileId가 없어서 승인 테스트를 건너뜁니다.',
    );
    return;
  }

  try {
    const response = await fetch(
      `${BASE_URL}/v2/payments/intents/${testIntentId}/authorize`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'HMS_BNPL',
          paymentKey: testProfileId,
        }),
      },
    );

    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);

    if (response.ok) {
      console.log('✅ BNPL 결제 승인 성공!');
    } else {
      console.log('❌ BNPL 결제 승인 실패');
    }
  } catch (error) {
    console.error('❌ BNPL 결제 승인 에러:', error.message);
  }
}

// 5. Intent 조회
async function getPaymentIntent() {
  console.log('\n🔍 5. Intent 조회 테스트');

  if (!testIntentId) {
    console.log('❌ intentId가 없어서 조회 테스트를 건너뜁니다.');
    return;
  }

  try {
    const response = await fetch(
      `${BASE_URL}/v2/payments/intents/${testIntentId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);

    if (response.ok) {
      console.log('✅ Intent 조회 성공!');
    } else {
      console.log('❌ Intent 조회 실패');
    }
  } catch (error) {
    console.error('❌ Intent 조회 에러:', error.message);
  }
}

// 6. 에러 케이스 테스트들
async function testErrorCases() {
  console.log('\n❌ 6. 에러 케이스 테스트들');

  // 존재하지 않는 Intent 조회
  console.log('\n6-1. 존재하지 않는 Intent 조회');
  try {
    const response = await fetch(
      `${BASE_URL}/v2/payments/intents/non_existent_intent`,
      {
        method: 'GET',
      },
    );
    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);
  } catch (error) {
    console.error('에러:', error.message);
  }

  await sleep(1000);

  // 잘못된 데이터로 계정 생성
  console.log('\n6-2. 잘못된 한도로 계정 생성');
  try {
    const response = await fetch(`${BASE_URL}/v2/payments/bnpl/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: `error_user_${Date.now()}`,
        creditLimit: -100, // 음수 한도
      }),
    });
    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);
  } catch (error) {
    console.error('에러:', error.message);
  }

  await sleep(1000);

  // 필수 필드 누락으로 Intent 생성
  console.log('\n6-3. 필수 필드 누락으로 Intent 생성');
  try {
    const response = await fetch(`${BASE_URL}/v2/payments/intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: testUserId,
        type: 'BNPL_CAPTURE',
        // amount 필드 누락
      }),
    });
    const responseText = await response.text();
    console.log(`응답 상태: ${response.status} ${response.statusText}`);
    console.log('응답 본문:', responseText);
  } catch (error) {
    console.error('에러:', error.message);
  }
}

// 메인 실행 함수
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('🎯 BNPL API 실제 테스트 시작');
  console.log(`서버 URL: ${BASE_URL}`);
  console.log(`테스트 시간: ${new Date().toLocaleString()}`);
  console.log('='.repeat(60));

  await createBnplProfile();
  await sleep(2000);

  await createBnplAccount();
  await sleep(2000);

  await createPaymentIntent();
  await sleep(2000);

  await authorizeBnplPayment();
  await sleep(2000);

  await getPaymentIntent();
  await sleep(2000);

  await testErrorCases();

  console.log('\n' + '='.repeat(60));
  console.log('🏁 모든 테스트 완료');
  console.log(`생성된 데이터:`);
  console.log(`- 사용자 ID: ${testUserId}`);
  console.log(`- 프로필 ID: ${testProfileId || 'N/A'}`);
  console.log(`- 계정 ID: ${testAccountId || 'N/A'}`);
  console.log(`- Intent ID: ${testIntentId || 'N/A'}`);
  console.log('='.repeat(60));
}

// 실행
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  runAllTests,
  createBnplProfile,
  createBnplAccount,
  createPaymentIntent,
  authorizeBnplPayment,
  getPaymentIntent,
  testErrorCases,
};
