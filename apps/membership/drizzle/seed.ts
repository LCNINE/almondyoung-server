import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { format, addDays, subDays } from 'date-fns';
import * as schema from '../src/shared/schemas/entities/schema';

// 환경변수에서 DB URL 가져오기
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

/**
 * 정기결제 테스트 시나리오별 사용자 데이터
 */
const TEST_SCENARIOS = [
  {
    name: '오늘 결제 예정 (정상 케이스)',
    userId: 'test-user-001',
    nextBillingDate: format(new Date(), 'yyyy-MM-dd'), // 오늘
    isPastDue: false,
    billingRetryCount: 0,
    paymentProfileId: 'hms-profile-001', // HMS 카드 프로필
  },
  {
    name: '1일 연체 (첫 번째 재시도)',
    userId: 'test-user-002',
    nextBillingDate: format(subDays(new Date(), 1), 'yyyy-MM-dd'), // 어제
    isPastDue: true,
    billingRetryCount: 1,
    paymentProfileId: 'hms-profile-002',
  },
  {
    name: '3일 연체 (마지막 재시도)',
    userId: 'test-user-003',
    nextBillingDate: format(subDays(new Date(), 3), 'yyyy-MM-dd'), // 3일 전
    isPastDue: true,
    billingRetryCount: 2,
    paymentProfileId: 'hms-profile-003',
  },
  {
    name: '정기결제 프로필 없음 (에러 케이스)',
    userId: 'test-user-004',
    nextBillingDate: format(new Date(), 'yyyy-MM-dd'), // 오늘
    isPastDue: false,
    billingRetryCount: 0,
    paymentProfileId: null, // 프로필 없음 -> 에러 발생 예상
  },
];

async function seed() {
  console.log('🌱 정기결제 테스트용 Seed 데이터 생성 시작...');

  try {
    // 1. 기존 테스트 데이터 정리
    console.log('📝 기존 테스트 데이터 정리 중...');
    await cleanupExistingTestData();

    // 2. Tier 생성
    console.log('🏷️  티어 생성 중...');
    const tierId = await createTiers();

    // 3. Plan 생성
    console.log('📋 플랜 생성 중...');
    const planId = await createPlans(tierId);

    // 4. 테스트 사용자들 생성
    console.log('👥 테스트 사용자 생성 중...');
    const userIds = await createTestUsers();

    // 5. 구독 계약 생성
    console.log('📄 구독 계약 생성 중...');
    await createSubscriptionContracts(userIds, planId);

    // 6. 구독 권한 생성
    console.log('🎫 구독 권한 생성 중...');
    await createSubscriptionEntitlements(userIds, tierId);

    // 7. Dunning 큐 설정 (연체 사용자용)
    console.log('⚠️  Dunning 큐 설정 중...');
    await createDunningQueue();

    console.log('✅ Seed 데이터 생성 완료!');
    console.log('\n📊 생성된 테스트 케이스:');
    TEST_SCENARIOS.forEach((scenario, index) => {
      console.log(`${index + 1}. ${scenario.name}`);
      console.log(`   - 사용자 ID: ${scenario.userId}`);
      console.log(`   - 다음 결제일: ${scenario.nextBillingDate}`);
      console.log(`   - 연체 상태: ${scenario.isPastDue ? '연체' : '정상'}`);
      console.log(`   - 재시도 횟수: ${scenario.billingRetryCount}/3`);
      console.log(`   - 결제 프로필: ${scenario.paymentProfileId || '없음'}`);
      console.log('');
    });

    console.log('🚀 정기결제 스케줄러를 실행하여 테스트를 시작하세요!');
    console.log('   - 스케줄러는 매 1분마다 실행됩니다.');
    console.log('   - 로그를 통해 결제 처리 결과를 확인할 수 있습니다.');
  } catch (error) {
    console.error('❌ Seed 데이터 생성 실패:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

async function cleanupExistingTestData() {
  // 테스트 사용자들의 관련 데이터 정리
  const testUserIds = TEST_SCENARIOS.map((s) => s.userId);

  // Dunning 큐 정리
  await db.delete(schema.membershipDunningQueue);

  // 구독 권한 정리
  await db.delete(schema.subscriptionEntitlement);

  // 구독 계약 정리
  await db.delete(schema.subscriptionContracts);

  // 사용자 정리
  await db.delete(schema.users);

  // 플랜 정리
  await db.delete(schema.plan);

  // 티어 정리
  await db.delete(schema.tiers);

  console.log(`   ✓ 기존 테스트 데이터 정리 완료`);
}

async function createTiers(): Promise<string> {
  const [tier] = await db
    .insert(schema.tiers)
    .values({
      code: 'PREMIUM',
      priorityLevel: 2,
    })
    .returning();

  console.log(`   ✓ 티어 생성: ${tier.code} (ID: ${tier.id})`);
  return tier.id;
}

async function createPlans(tierId: string): Promise<string> {
  const [plan] = await db
    .insert(schema.plan)
    .values({
      tierId,
      price: 10000, // 10,000원
      durationDays: 30, // 30일 구독
      currency: 'KRW',
      trialDays: 0,
      isActive: true,
    })
    .returning();

  console.log(`   ✓ 플랜 생성: ${plan.price}원/30일 (ID: ${plan.id})`);
  return plan.id;
}

async function createTestUsers(): Promise<string[]> {
  const userIds: string[] = [];

  for (const scenario of TEST_SCENARIOS) {
    const [user] = await db
      .insert(schema.users)
      .values({
        id: scenario.userId,
      })
      .returning();

    userIds.push(user.id);
    console.log(`   ✓ 사용자 생성: ${scenario.name} (ID: ${user.id})`);
  }

  return userIds;
}

async function createSubscriptionContracts(userIds: string[], planId: string) {
  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const scenario = TEST_SCENARIOS[i];
    const userId = userIds[i];

    await db.insert(schema.subscriptionContracts).values({
      userId,
      planId,
      nextBillingDate: scenario.nextBillingDate,
      leadDays: 0,
      isVoided: false,
      paymentProfileId: scenario.paymentProfileId,
      isPastDue: scenario.isPastDue,
      billingRetryCount: scenario.billingRetryCount,
    });

    console.log(`   ✓ 계약 생성: ${scenario.name} - 결제일: ${scenario.nextBillingDate}`);
  }
}

async function createSubscriptionEntitlements(userIds: string[], tierId: string) {
  const today = new Date();

  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const scenario = TEST_SCENARIOS[i];
    const userId = userIds[i];

    // 권한은 모두 활성 상태로 생성 (만료일은 내일까지)
    await db.insert(schema.subscriptionEntitlement).values({
      userId,
      tierId,
      startsAt: format(subDays(today, 30), 'yyyy-MM-dd'), // 30일 전부터 시작
      endsAt: format(addDays(today, 1), 'yyyy-MM-dd'), // 내일까지 (결제 성공 시 연장됨)
      isCurrent: true,
      pausedAt: null,
    });

    console.log(`   ✓ 권한 생성: ${scenario.name} - 만료일: ${format(addDays(today, 1), 'yyyy-MM-dd')}`);
  }
}

async function createDunningQueue() {
  // 연체 상태인 사용자들에 대해서만 Dunning 큐 생성
  const overdueScenarios = TEST_SCENARIOS.filter((s) => s.isPastDue);

  for (const scenario of overdueScenarios) {
    // 계약 ID 조회
    const [contract] = await db
      .select()
      .from(schema.subscriptionContracts)
      .where(schema.subscriptionContracts.userId === scenario.userId);

    if (contract) {
      const nextRetryAt = addDays(new Date(), 1); // 내일 재시도

      await db.insert(schema.membershipDunningQueue).values({
        contractId: contract.id,
        nextRetryAt,
        attempts: scenario.billingRetryCount,
        maxAttempts: 3,
        lastErrorCode: 'PAYMENT_FAILED',
        lastErrorMessage: '이전 결제 실패 - 재시도 예정',
      });

      console.log(`   ✓ Dunning 큐 생성: ${scenario.name} - 다음 재시도: ${format(nextRetryAt, 'yyyy-MM-dd HH:mm')}`);
    }
  }
}

// Drizzle Kit seed 실행
seed()
  .then(() => {
    console.log('\n🎯 테스트 준비 완료! 정기결제 스케줄러를 시작하세요.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Seed 실행 실패:', error);
    process.exit(1);
  });
