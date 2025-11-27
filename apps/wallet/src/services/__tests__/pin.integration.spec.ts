// authorization 모듈 모킹 (가장 먼저)
jest.mock(
  '@app/authorization',
  () => ({
    authorizationSchema: {},
  }),
  { virtual: true },
);

import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { getTsid } from 'tsid-ts';

// 테스트 대상 모듈 및 서비스
import { PinService } from '../pin/pin.service';
import { PinReader } from '../pin/pin.reader';
import { PinCreator } from '../pin/pin.creator';
import { PinManager } from '../pin/pin.manager';

import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';

describe('결제 비밀번호(PIN) 통합 테스트 - 전체 플로우', () => {
  let module: TestingModule;
  let dbService: DbService<typeof walletSchema>;

  let pinService: PinService;
  let pinReader: PinReader;
  let pinCreator: PinCreator;
  let pinManager: PinManager;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: walletSchema,
        }),
      ],
      providers: [PinService, PinReader, PinCreator, PinManager],
    }).compile();

    dbService = module.get<DbService<typeof walletSchema>>(DbService);
    pinService = module.get<PinService>(PinService);
    pinReader = module.get<PinReader>(PinReader);
    pinCreator = module.get<PinCreator>(PinCreator);
    pinManager = module.get<PinManager>(PinManager);
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('🎯 PIN 전체 플로우 테스트', () => {
    it('🎯 [성공] PIN 등록 → 상태 조회 → 검증 성공', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const pin = '085279'; // 유효한 PIN (연속/반복 숫자 아님)

      // =======================================================
      // 2. When (행동) - 단계별 플로우 실행
      // =======================================================

      // 🔹 Step 1: PIN 상태 조회 (등록 전)
      const statusBefore = await pinService.getStatus(userId);
      expect(statusBefore.hasPin).toBe(false);
      expect(statusBefore.status).toBe('NONE');
      expect(statusBefore.failureCount).toBe(0);

      // 🔹 Step 2: PIN 등록
      await pinService.register(userId, pin, '127.0.0.1');

      // 🔹 Step 3: PIN 상태 조회 (등록 후)
      const statusAfter = await pinService.getStatus(userId);
      expect(statusAfter.hasPin).toBe(true);
      expect(statusAfter.status).toBe('ACTIVE');
      expect(statusAfter.failureCount).toBe(0);

      // 🔹 Step 4: PIN 검증 (성공)
      const verified = await pinService.verify(userId, pin, '127.0.0.1', 'test-agent');
      expect(verified).toBe(true);

      // 🔹 Step 5: 검증 후 상태 확인 (실패 카운트 초기화)
      const statusAfterVerify = await pinService.getStatus(userId);
      expect(statusAfterVerify.failureCount).toBe(0);

      // =======================================================
      // 3. Then (결과 검증)
      // =======================================================

      // 🔍 History 확인
      const history = await dbService.db
        .select()
        .from(schema.pinHistory)
        .where(eq(schema.pinHistory.userId, userId))
        .orderBy(schema.pinHistory.changedAt);

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].actionType).toBe('REGISTER');

      // 🔍 감사 로그 확인
      const logs = await dbService.db
        .select()
        .from(schema.pinAccessLogs)
        .where(eq(schema.pinAccessLogs.userId, userId))
        .orderBy(schema.pinAccessLogs.attemptAt);

      expect(logs.length).toBeGreaterThan(0);
      const successLog = logs.find((log) => log.isSuccess === true);
      expect(successLog).toBeDefined();
      expect(successLog?.failureCountSnapshot).toBe(0);
    }, 15000);

    it('🎯 [실패] 취약한 PIN 등록 거부 (연속 숫자)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const weakPin = '123456'; // 연속 숫자

      // =======================================================
      // 2. When & Then
      // =======================================================
      await expect(pinService.register(userId, weakPin, '127.0.0.1')).rejects.toThrow('WEAK_PIN');
    }, 15000);

    it('🎯 [실패] 취약한 PIN 등록 거부 (반복 숫자)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const weakPin = '111111'; // 반복 숫자

      // =======================================================
      // 2. When & Then
      // =======================================================
      await expect(pinService.register(userId, weakPin, '127.0.0.1')).rejects.toThrow('WEAK_PIN');
    }, 15000);

    it('🎯 [실패] 중복 PIN 등록 거부', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const pin = '085279'; // 유효한 PIN

      // 첫 번째 등록
      await pinService.register(userId, pin, '127.0.0.1');

      // =======================================================
      // 2. When & Then
      // =======================================================
      // 중복 등록 시도
      await expect(pinService.register(userId, pin, '127.0.0.1')).rejects.toThrow('PIN_ALREADY_EXISTS');
    }, 15000);

    it('🎯 [성공] PIN 검증 실패 → 카운트 증가 → 5회 실패 시 잠금', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const correctPin = '085279';
      const wrongPin = '999999';

      // PIN 등록
      await pinService.register(userId, correctPin, '127.0.0.1');

      // =======================================================
      // 2. When
      // =======================================================

      // 🔹 Step 1-4: 4회 실패 (카운트만 증가)
      for (let i = 1; i <= 4; i++) {
        await expect(pinService.verify(userId, wrongPin, '127.0.0.1', 'test-agent')).rejects.toThrow('PIN_MISMATCH');

        const status = await pinService.getStatus(userId);
        expect(status.failureCount).toBe(i);
        expect(status.status).toBe('ACTIVE'); // 아직 잠금 안 됨
      }

      // 🔹 Step 5: 5회 실패 (잠금 처리)
      await expect(pinService.verify(userId, wrongPin, '127.0.0.1', 'test-agent')).rejects.toThrow('PIN_LOCKED');

      // =======================================================
      // 3. Then
      // =======================================================

      // 🔍 잠금 상태 확인
      const lockedStatus = await pinService.getStatus(userId);
      expect(lockedStatus.status).toBe('LOCKED');
      expect(lockedStatus.failureCount).toBe(5);

      // 🔍 History에 LOCKED_DISPOSAL 기록 확인
      const history = await dbService.db
        .select()
        .from(schema.pinHistory)
        .where(eq(schema.pinHistory.userId, userId))
        .orderBy(schema.pinHistory.changedAt);

      const disposalHistory = history.find((h) => h.actionType === 'LOCKED_DISPOSAL');
      expect(disposalHistory).toBeDefined();

      // 🔍 잠금 후 검증 시도 (차단)
      await expect(pinService.verify(userId, correctPin, '127.0.0.1', 'test-agent')).rejects.toThrow('PIN_LOCKED');

      // 🔍 감사 로그 확인 (모든 시도 기록됨)
      const logs = await dbService.db
        .select()
        .from(schema.pinAccessLogs)
        .where(eq(schema.pinAccessLogs.userId, userId))
        .orderBy(schema.pinAccessLogs.attemptAt);

      expect(logs.length).toBe(6); // 5회 실패 + 1회 잠금 후 시도
      expect(logs.every((log) => log.isSuccess === false)).toBe(true);
    }, 15000);

    it('🎯 [성공] PIN 변경 (현재 PIN 검증 후)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const currentPin = '085279';
      const newPin = '246813'; // 유효한 PIN (연속/반복 숫자 아님)

      // PIN 등록
      await pinService.register(userId, currentPin, '127.0.0.1');

      // =======================================================
      // 2. When
      // =======================================================

      // PIN 변경
      await pinService.change(userId, currentPin, newPin, '127.0.0.1');

      // =======================================================
      // 3. Then
      // =======================================================

      // 🔍 새 PIN으로 검증 성공
      const verified = await pinService.verify(userId, newPin, '127.0.0.1', 'test-agent');
      expect(verified).toBe(true);

      // 🔍 기존 PIN으로 검증 실패
      await expect(pinService.verify(userId, currentPin, '127.0.0.1', 'test-agent')).rejects.toThrow('PIN_MISMATCH');

      // 🔍 History에 CHANGE 기록 확인
      const history = await dbService.db
        .select()
        .from(schema.pinHistory)
        .where(eq(schema.pinHistory.userId, userId))
        .orderBy(schema.pinHistory.changedAt);

      const changeHistory = history.find((h) => h.actionType === 'CHANGE');
      expect(changeHistory).toBeDefined();
      expect(changeHistory?.previousHash).toBeDefined(); // 이전 해시 저장됨
    }, 15000);

    it('🎯 [실패] PIN 변경 시 현재 PIN 불일치', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const currentPin = '085279';
      const wrongPin = '999999';
      const newPin = '246813'; // 유효한 PIN (연속/반복 숫자 아님)

      // PIN 등록
      await pinService.register(userId, currentPin, '127.0.0.1');

      // =======================================================
      // 2. When & Then
      // =======================================================

      // 잘못된 현재 PIN으로 변경 시도
      await expect(pinService.change(userId, wrongPin, newPin, '127.0.0.1')).rejects.toThrow('PIN_MISMATCH');

      // 실패 카운트 증가 확인
      const status = await pinService.getStatus(userId);
      expect(status.failureCount).toBe(1);
    }, 15000);

    it('🎯 [성공] PIN 재설정 (잠금 해제)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const oldPin = '085279';
      const wrongPin = '999999';
      const newPin = '246813'; // 유효한 PIN (연속/반복 숫자 아님)

      // PIN 등록 및 5회 실패로 잠금
      await pinService.register(userId, oldPin, '127.0.0.1');
      for (let i = 0; i < 5; i++) {
        try {
          await pinService.verify(userId, wrongPin, '127.0.0.1', 'test-agent');
        } catch (error) {
          // 마지막은 PIN_LOCKED 에러
        }
      }

      // 잠금 확인
      const lockedStatus = await pinService.getStatus(userId);
      expect(lockedStatus.status).toBe('LOCKED');

      // =======================================================
      // 2. When
      // =======================================================

      // PIN 재설정
      await pinService.reset(userId, newPin, '127.0.0.1');

      // =======================================================
      // 3. Then
      // =======================================================

      // 🔍 재설정 후 상태 확인
      const resetStatus = await pinService.getStatus(userId);
      expect(resetStatus.status).toBe('ACTIVE');
      expect(resetStatus.failureCount).toBe(0);

      // 🔍 새 PIN으로 검증 성공
      const verified = await pinService.verify(userId, newPin, '127.0.0.1', 'test-agent');
      expect(verified).toBe(true);

      // 🔍 History에 RESET 기록 확인
      const history = await dbService.db
        .select()
        .from(schema.pinHistory)
        .where(eq(schema.pinHistory.userId, userId))
        .orderBy(schema.pinHistory.changedAt);

      const resetHistory = history.find((h) => h.actionType === 'RESET');
      expect(resetHistory).toBeDefined();
    }, 15000);

    it('🎯 [성공] PIN 검증 성공 시 실패 카운트 초기화', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const correctPin = '085279';
      const wrongPin = '999999';

      // PIN 등록
      await pinService.register(userId, correctPin, '127.0.0.1');

      // 3회 실패
      for (let i = 0; i < 3; i++) {
        try {
          await pinService.verify(userId, wrongPin, '127.0.0.1', 'test-agent');
        } catch (error) {
          // PIN_MISMATCH 에러
        }
      }

      // 실패 카운트 확인
      const statusBefore = await pinService.getStatus(userId);
      expect(statusBefore.failureCount).toBe(3);

      // =======================================================
      // 2. When
      // =======================================================

      // 올바른 PIN으로 검증 성공
      const verified = await pinService.verify(userId, correctPin, '127.0.0.1', 'test-agent');
      expect(verified).toBe(true);

      // =======================================================
      // 3. Then
      // =======================================================

      // 🔍 실패 카운트 초기화 확인
      const statusAfter = await pinService.getStatus(userId);
      expect(statusAfter.failureCount).toBe(0);
    }, 15000);

    it('🎯 [성공] 감사 로그 기록 확인 (성공/실패 무관)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const correctPin = '085279';
      const wrongPin = '999999';

      // PIN 등록
      await pinService.register(userId, correctPin, '127.0.0.1');

      // =======================================================
      // 2. When
      // =======================================================

      // 성공 시도
      await pinService.verify(userId, correctPin, '127.0.0.1', 'test-agent');

      // 실패 시도
      try {
        await pinService.verify(userId, wrongPin, '127.0.0.1', 'test-agent');
      } catch (error) {
        // PIN_MISMATCH 에러
      }

      // =======================================================
      // 3. Then
      // =======================================================

      // 🔍 감사 로그 확인 (성공/실패 모두 기록됨)
      const logs = await dbService.db
        .select()
        .from(schema.pinAccessLogs)
        .where(eq(schema.pinAccessLogs.userId, userId))
        .orderBy(schema.pinAccessLogs.attemptAt);

      expect(logs.length).toBe(2);
      expect(logs[0].isSuccess).toBe(true);
      expect(logs[1].isSuccess).toBe(false);
      expect(logs[0].ipAddress).toBe('127.0.0.1');
      expect(logs[0].userAgent).toBe('test-agent');
    }, 15000);
  });

  /**
   * DB 청소 헬퍼 함수
   */
  async function cleanupDatabase() {
    try {
      // 외래키 제약 때문에 자식부터 삭제
      // 테이블이 없을 수 있으므로 try-catch로 처리
      try {
        await dbService.db.delete(schema.pinAccessLogs);
      } catch (e) {
        // 테이블이 없으면 무시
      }
      try {
        await dbService.db.delete(schema.pinHistory);
      } catch (e) {
        // 테이블이 없으면 무시
      }
      try {
        await dbService.db.delete(schema.userPaymentPasswords);
      } catch (e) {
        // 테이블이 없으면 무시
      }
    } catch (error) {
      // 최상위 에러도 무시 (테이블이 아직 생성되지 않았을 수 있음)
    }
  }
});
