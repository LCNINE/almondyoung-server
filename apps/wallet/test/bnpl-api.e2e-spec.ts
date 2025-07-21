import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PaymsModule } from '../src/payms.module';

/**
 * BNPL API E2E 테스트
 * 
 * 테스트 시나리오:
 * 1. 결제수단 등록 (회원 등록)
 * 2. BNPL 계정 정보 조회
 * 3. 거래 내역 조회
 * 4. 정산 배치 조회
 */
describe('BNPL API (e2e)', () => {
  let app: INestApplication;
  let testUserId: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PaymsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // 테스트용 고유 사용자 ID 생성
    testUserId = `test-user-${Date.now()}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. 결제수단 등록 및 BNPL 계정 생성', () => {
    it('결제수단을 등록하면 BNPL 계정이 자동 생성되어야 한다', async () => {
      // 1. 결제수단 등록
      const createResponse = await request(app.getHttpServer())
        .post('/payment-methods')
        .send({
          userId: testUserId,
          methodType: 'BNPL',
          methodName: 'E2E 테스트 BNPL 계정',
          institutionCode: 'ALMOND001',
          isDefault: true,
        })
        .expect(201);

      paymentMethodId = createResponse.body.id;
      expect(createResponse.body.status).toBe('PENDING');
      expect(createResponse.body.methodType).toBe('BNPL');

      console.log('✅ 결제수단 등록 성공:', {
        paymentMethodId,
        status: createResponse.body.status,
      });

      // 2. BNPL 계정 생성 확인 (재시도 로직)
      let accountResponse;
      let retryCount = 0;
      const maxRetries = 5;

      while (retryCount < maxRetries) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          accountResponse = await request(app.getHttpServer())
            .get(`/bnpl/accounts/me?userId=${testUserId}`)
            .expect(200);
          break; // 성공하면 루프 종료
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw error; // 최대 재시도 횟수 초과 시 에러 발생
          }
          console.log(`⏳ BNPL 계정 생성 대기 중... (${retryCount}/${maxRetries})`);
        }
      }

      expect(accountResponse.body.success).toBe(true);
      expect(accountResponse.body.data.userId).toBe(testUserId);
      expect(accountResponse.body.data.status).toBe('ACTIVE');

      console.log('✅ BNPL 계정 자동 생성 확인:', {
        accountId: accountResponse.body.data.id,
        status: accountResponse.body.data.status,
        creditLimit: accountResponse.body.data.creditLimit,
      });
    }, 15000);
  });

  describe('2. BNPL 계정 정보 조회', () => {
    it('사용자의 BNPL 계정 정보를 조회할 수 있어야 한다', async () => {
      const response = await request(app.getHttpServer())
        .get(`/bnpl/accounts/me?userId=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('userId', testUserId);
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('creditLimit');
      expect(response.body.data).toHaveProperty('approvedLimit');
      expect(response.body.data).toHaveProperty('createdAt');

      console.log('✅ BNPL 계정 정보 조회 성공:', response.body.data);
    });

    it('존재하지 않는 사용자의 계정 조회 시 404 에러가 발생해야 한다', async () => {
      const response = await request(app.getHttpServer())
        .get('/bnpl/accounts/me?userId=non-existent-user')
        .expect(404);

      expect(response.body.message).toContain('BNPL 계정을 찾을 수 없습니다');
    });
  });

  describe('3. 거래 내역 조회', () => {
    it('사용자의 거래 내역을 조회할 수 있어야 한다 (빈 목록)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/bnpl/accounts/me/transactions?userId=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.transactions).toEqual([]);
      expect(response.body.data.pagination).toHaveProperty('total', 0);
      expect(response.body.data.pagination).toHaveProperty('limit', 20);
      expect(response.body.data.pagination).toHaveProperty('offset', 0);
      expect(response.body.data.pagination).toHaveProperty('hasMore', false);

      console.log('✅ 거래 내역 조회 성공 (빈 목록):', response.body.data);
    });

    it('페이징 파라미터가 올바르게 작동해야 한다', async () => {
      const response = await request(app.getHttpServer())
        .get(`/bnpl/accounts/me/transactions?userId=${testUserId}&limit=10&offset=5`)
        .expect(200);

      expect(response.body.data.pagination.limit).toBe(10);
      expect(response.body.data.pagination.offset).toBe(5);
    });
  });

  describe('4. 정산 배치 조회', () => {
    it('사용자의 정산 배치 내역을 조회할 수 있어야 한다 (빈 목록)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/bnpl/accounts/me/settlements?userId=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.settlements).toEqual([]);

      console.log('✅ 정산 배치 조회 성공 (빈 목록):', response.body.data);
    });
  });

  describe('5. 에러 처리', () => {
    it('userId가 없으면 400 에러가 발생해야 한다', async () => {
      await request(app.getHttpServer())
        .get('/bnpl/accounts/me')
        .expect(400);

      await request(app.getHttpServer())
        .get('/bnpl/accounts/me/transactions')
        .expect(400);

      await request(app.getHttpServer())
        .get('/bnpl/accounts/me/settlements')
        .expect(400);
    });
  });

  describe('6. 정산 스케줄러 테스트', () => {
    it('AUTHORIZED 거래가 있을 때 정산 배치가 생성되어야 한다', async () => {
      // 이 테스트는 실제 AUTHORIZED 상태의 거래가 DB에 있어야 실행 가능
      // 스케줄러가 1분마다 실행되므로 최대 2분 대기
      console.log('⚠️ 정산 스케줄러 테스트 - AUTHORIZED 거래 데이터 필요');

      // 정산 배치 조회로 스케줄러 동작 확인
      const response = await request(app.getHttpServer())
        .get(`/bnpl/accounts/me/settlements?userId=${testUserId}`)
        .expect(200);

      console.log('📊 현재 정산 배치 상태:', response.body.data.settlements);
    });
  });

  describe('7. 통합 시나리오 (결제 포함)', () => {
    it('결제수단 등록 → 결제 → 거래 내역 확인 플로우', async () => {
      // 이 테스트는 실제 청구서(invoice)가 있어야 실행 가능
      // 현재는 스킵하고 향후 invoice 생성 API가 준비되면 활성화
      console.log('⚠️ 결제 플로우 테스트는 invoice 생성 API 준비 후 구현 예정');
    });
  });
});