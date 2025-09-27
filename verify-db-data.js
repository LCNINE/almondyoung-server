// verify-db-data.js
// DB에 저장된 멤버십 결제 데이터 확인 스크립트

const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const { eq, desc } = require('drizzle-orm');

// 스키마 정의 (간단 버전)
const paymentEvents = {
  id: 'id',
  paymentSessionId: 'payment_session_id',
  paymentMethodId: 'payment_method_id',
  amount: 'amount',
  status: 'status',
  pgTransactionId: 'pg_transaction_id',
  pgResponse: 'pg_response',
  actor: 'actor',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  errorMessage: 'error_message',
  metadata: 'metadata',
  pricingSnapshot: 'pricing_snapshot',
};

// 테스트에서 생성된 Payment Event ID들
const TEST_PAYMENT_EVENT_IDS = [
  '01K4HKCFNXCQGN3889GR13PBQW', // 프리미엄 플랜 (29,900원)
  '01K4HKCG9WERBP7HGV1FWGPC7A', // 베이직 플랜 (19,900원)
];

async function verifyDatabaseData() {
  console.log('🔍 DB 저장 데이터 검증 시작...\n');

  // DB 연결 설정 (환경에 맞게 수정 필요)
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://user:password@localhost:5432/wallet_db';

  try {
    const sql = postgres(connectionString);
    const db = drizzle(sql);

    console.log('✅ DB 연결 성공\n');

    // 1. 최근 생성된 PaymentEvents 조회
    console.log('📊 최근 생성된 PaymentEvents (최신 5개):');
    console.log('='.repeat(80));

    const recentEvents = await sql`
      SELECT * FROM payment_events 
      ORDER BY created_at DESC 
      LIMIT 5
    `;

    recentEvents.forEach((event, index) => {
      console.log(`\n[${index + 1}] Payment Event:`);
      console.log(`  - ID: ${event.id}`);
      console.log(`  - Payment Method ID: ${event.payment_method_id}`);
      console.log(`  - Amount: ${event.amount}원`);
      console.log(`  - Status: ${event.status}`);
      console.log(`  - Actor: ${event.actor}`);
      console.log(`  - PG Transaction ID: ${event.pg_transaction_id}`);
      console.log(`  - Created At: ${event.created_at}`);

      // metadata 파싱 및 출력
      if (event.metadata) {
        try {
          const metadata = JSON.parse(event.metadata);
          console.log(`  - Metadata:`);
          console.log(`    - Payment Purpose: ${metadata.paymentPurpose}`);
          console.log(
            `    - Is Subscription: ${metadata.isSubscriptionPayment}`,
          );
          console.log(`    - Source: ${metadata.source}`);
          if (metadata.subscriptionType) {
            console.log(
              `    - Subscription Type: ${metadata.subscriptionType}`,
            );
          }
          if (metadata.billingCycle) {
            console.log(`    - Billing Cycle: ${metadata.billingCycle}`);
          }
          if (metadata.planId) {
            console.log(`    - Plan ID: ${metadata.planId}`);
          }
        } catch (e) {
          console.log(`  - Metadata: ${event.metadata}`);
        }
      }

      // pricingSnapshot 파싱 및 출력
      if (event.pricing_snapshot) {
        try {
          const pricing = JSON.parse(event.pricing_snapshot);
          console.log(`  - Pricing Snapshot:`);
          console.log(`    - Original Amount: ${pricing.originalAmount}원`);
          console.log(`    - Final Amount: ${pricing.finalAmount}원`);
          if (pricing.discountAmount) {
            console.log(`    - Discount Amount: ${pricing.discountAmount}원`);
          }
          if (pricing.couponId) {
            console.log(`    - Coupon ID: ${pricing.couponId}`);
          }
          if (pricing.discountRate) {
            console.log(`    - Discount Rate: ${pricing.discountRate}%`);
          }
        } catch (e) {
          console.log(`  - Pricing Snapshot: ${event.pricing_snapshot}`);
        }
      }

      // pgResponse 파싱 및 출력
      if (event.pg_response) {
        try {
          const pgResponse = JSON.parse(event.pg_response);
          console.log(`  - PG Response:`);
          console.log(`    - Gateway: ${pgResponse.gateway}`);
          if (pgResponse.approvalNumber) {
            console.log(`    - Approval Number: ${pgResponse.approvalNumber}`);
          }
          if (pgResponse.paymentDate) {
            console.log(`    - Payment Date: ${pgResponse.paymentDate}`);
          }
        } catch (e) {
          console.log(`  - PG Response: ${event.pg_response}`);
        }
      }
    });

    // 2. 특정 Payment Event ID들 상세 조회
    console.log('\n\n🎯 테스트에서 생성된 특정 PaymentEvents 상세 조회:');
    console.log('='.repeat(80));

    for (const eventId of TEST_PAYMENT_EVENT_IDS) {
      const specificEvents = await sql`
        SELECT * FROM payment_events 
        WHERE id = ${eventId}
      `;

      if (specificEvents.length > 0) {
        const event = specificEvents[0];
        console.log(`\n✅ Payment Event ID: ${eventId}`);
        console.log(`   - Amount: ${event.amount}원`);
        console.log(`   - Status: ${event.status}`);
        console.log(`   - Created: ${event.created_at}`);

        // 가이드 문서 준수 확인
        const metadata = JSON.parse(event.metadata);
        const pricingSnapshot = JSON.parse(event.pricing_snapshot);

        console.log(
          `   - ✅ metadata.paymentPurpose: ${metadata.paymentPurpose}`,
        );
        console.log(
          `   - ✅ metadata.isSubscriptionPayment: ${metadata.isSubscriptionPayment}`,
        );
        console.log(
          `   - ✅ pricingSnapshot.finalAmount: ${pricingSnapshot.finalAmount}`,
        );
        console.log(`   - ✅ actor: ${event.actor}`);
      } else {
        console.log(`\n❌ Payment Event ID: ${eventId} - 데이터 없음`);
      }
    }

    // 3. 통계 정보
    console.log('\n\n📈 PaymentEvents 통계:');
    console.log('='.repeat(50));

    const stats = await sql`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM payment_events 
      WHERE created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY status
      ORDER BY count DESC
    `;

    stats.forEach((stat) => {
      console.log(
        `  - ${stat.status}: ${stat.count}건, 총 ${stat.total_amount}원`,
      );
    });

    // 4. 결제수단별 통계
    const methodStats = await sql`
      SELECT 
        pm.method_type,
        COUNT(pe.*) as payment_count,
        SUM(pe.amount) as total_amount
      FROM payment_events pe
      JOIN payment_method pm ON pe.payment_method_id = pm.id
      WHERE pe.created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY pm.method_type
    `;

    console.log('\n📊 결제수단별 통계 (최근 1시간):');
    methodStats.forEach((stat) => {
      console.log(
        `  - ${stat.method_type}: ${stat.payment_count}건, 총 ${stat.total_amount}원`,
      );
    });

    await sql.end();
    console.log('\n✅ DB 검증 완료!');
  } catch (error) {
    console.error('❌ DB 검증 실패:', error.message);

    if (error.message.includes('connect')) {
      console.error('\n💡 해결 방법:');
      console.error('  1. PostgreSQL이 실행 중인지 확인');
      console.error('  2. 연결 문자열이 올바른지 확인');
      console.error('  3. 환경변수 DATABASE_URL 설정 확인');
    }
  }
}

// 스크립트 실행
if (require.main === module) {
  verifyDatabaseData()
    .then(() => {
      console.log('\n🏁 DB 검증 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 DB 검증 중 오류:', error);
      process.exit(1);
    });
}

module.exports = { verifyDatabaseData };
