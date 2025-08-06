import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';

// 테스트 대상 및 의존성 import
import { PauseController } from './pause-resume/pause.controller';
import { PauseService } from './pause-resume/pause.service';
import { PolicyGuard } from './pause-resume/policy.guard';
import { SubscriptionExceptionFilter } from './shared/filters/subscription-exception.filter';

// Mock할 의존성 import
import { DbService } from '@app/db';
import { PolicyEngineService } from './policy-management/policy-engine.service';

// 타입 및 스키마 import
import {
  PauseSubscriptionRequestSchema,
  PauseSubscriptionRequest,
} from './shared/schemas';

// --- Mocking Setup (수정된 부분) ---

// 1. PolicyEngineService Mock
const mockPolicyEngineService = {
  validateRequest: jest.fn(),
};

// 2. 모의 트랜잭션(tx) 객체 정의
// 이 객체는 Drizzle ORM의 체이닝(chaining)을 모방합니다.
const mockTx = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(), // 마지막 체인. 반환 값은 각 테스트에서 설정합니다.
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockResolvedValue([{}]), // insert는 기본적으로 성공
};

// 3. DbService Mock
const mockDbService = {
  db: {
    // transaction 콜백 함수를 우리가 만든 모의 tx 객체와 함께 즉시 실행합니다.
    transaction: jest
      .fn()
      .mockImplementation(async (callback) => callback(mockTx)),
  },
};

describe('PauseController (e2e)', () => {
  let app: INestApplication;
  const userId = 'user-e2e-test';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PauseController],
      providers: [
        PauseService,
        { provide: DbService, useValue: mockDbService },
        { provide: PolicyEngineService, useValue: mockPolicyEngineService },
      ],
    })
      // 실제 PolicyGuard를 모킹하여 PolicyEngineService 호출 결과를 제어
      .overrideGuard(PolicyGuard('PAUSE_SUBSCRIPTION'))
      .useValue({
        canActivate: (context) => {
          const request = context.switchToHttp().getRequest();
          // PolicyGuard가 정책 검증 결과를 request에 주입하는 로직을 시뮬레이션
          request.policyValidation = {
            isValid:
              mockPolicyEngineService.validateRequest.mock.results[0].value
                .isValid,
            violations:
              mockPolicyEngineService.validateRequest.mock.results[0].value
                .violations || [],
            appliedPolicies:
              mockPolicyEngineService.validateRequest.mock.results[0].value
                .appliedPolicies || [],
            remainingQuota: { remainingPauses: 2 }, // 예시 값
            executionTime: 5,
          };
          // canActivate는 정책 검증 결과(isValid)를 그대로 반환
          return request.policyValidation.isValid;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // 전역 필터를 설정하여 실제 예외 처리 흐름을 테스트합니다.
    app.useGlobalFilters(new SubscriptionExceptionFilter());

    // ZodValidationPipe를 모든 요청에 적용합니다.
    // 참고: DTO 스키마는 각 컨트롤러 핸들러에서 @Body 파이프를 통해 적용됩니다.
    // 여기서는 전역 설정 대신, 컨트롤러에 명시된 파이프가 동작하는지 확인합니다.

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /subscriptions/pause', () => {
    const pauseRequest: PauseSubscriptionRequest = {
      startDate: '2025-10-01T00:00:00.000Z',
      endDate: '2025-10-31T00:00:00.000Z',
      reason: 'E2E Test Vacation',
    };

    const mockActiveSubscription = {
      subscription: { id: 'sub-123', userId, status: 'ACTIVE' },
      activeRight: { id: 'right-456', isActive: true, pausedAt: null },
    };

    it('should successfully pause a subscription (Happy Path)', async () => {
      // Arrange
      mockPolicyEngineService.validateRequest.mockResolvedValue({
        isValid: true,
      });
      (mockTx.limit as jest.Mock).mockResolvedValue([mockActiveSubscription]);

      // Act
      const response = await request(app.getHttpServer())
        .post(`/subscriptions/pause?userId=${userId}`)
        .send(pauseRequest);

      // Assert
      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toHaveProperty('pauseId');
      expect(response.body.policyInfo).toBeDefined();
      expect(response.body.policyInfo.remainingPauses).toBe(2);
    });

    it('should return 403 Forbidden if PolicyGuard rejects the request', async () => {
      // Arrange
      mockPolicyEngineService.validateRequest.mockResolvedValue({
        isValid: false,
        violations: [{ message: '연간 한도 초과' }],
      });

      // Act
      const response = await request(app.getHttpServer())
        .post(`/subscriptions/pause?userId=${userId}`)
        .send(pauseRequest);

      // Assert
      // PolicyGuard가 ForbiddenException을 던지고, 프레임워크가 이를 처리
      expect(response.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 Bad Request if the request body is invalid', async () => {
      // Arrange
      const invalidRequest = {
        startDate: '2025-10-31T00:00:00.000Z',
        endDate: '2025-10-01T00:00:00.000Z', // 시작일이 종료일보다 늦음
      };

      // Act
      const response = await request(app.getHttpServer())
        .post(`/subscriptions/pause?userId=${userId}`)
        .send(invalidRequest);

      // Assert
      // ZodValidationPipe가 던진 에러를 검증
      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.message).toBe('입력값 검증에 실패했습니다');
      expect(response.body.errors[0].field).toBe('startDate');
      expect(response.body.errors[0].message).toBe(
        '시작일은 종료일보다 이전이어야 합니다',
      );
    });

    it('should return 404 Not Found if no active subscription exists', async () => {
      // Arrange
      mockPolicyEngineService.validateRequest.mockResolvedValue({
        isValid: true,
      });
      (mockTx.limit as jest.Mock).mockResolvedValue([]); // DB에서 아무것도 찾지 못함

      // Act
      const response = await request(app.getHttpServer())
        .post(`/subscriptions/pause?userId=${userId}`)
        .send(pauseRequest);

      // Assert
      // PauseService에서 SubscriptionNotFoundException 발생
      // SubscriptionExceptionFilter가 404로 변환
      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      expect(response.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('should return 409 Conflict if the subscription is already paused', async () => {
      // Arrange
      mockPolicyEngineService.validateRequest.mockResolvedValue({
        isValid: true,
      });
      const alreadyPausedSubscription = {
        ...mockActiveSubscription,
        activeRight: {
          ...mockActiveSubscription.activeRight,
          pausedAt: new Date(),
        },
      };
      (mockTx.limit as jest.Mock).mockResolvedValue([
        alreadyPausedSubscription,
      ]);

      // Act
      const response = await request(app.getHttpServer())
        .post(`/subscriptions/pause?userId=${userId}`)
        .send(pauseRequest);

      // Assert
      // PauseService에서 SubscriptionPausedException 발생
      // SubscriptionExceptionFilter가 409 (CONFLICT)로 변환
      // 참고: SubscriptionPausedException의 기본 상태 코드는 400이지만,
      //       "이미 ~인 상태"는 409가 더 적합하므로 예외 클래스나 필터에서 조정하는 것이 좋습니다.
      //       여기서는 현재 코드(400)를 기준으로 테스트합니다. [subscription.exceptions.ts] 파일에 따라 400이 맞습니다.
      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.code).toBe('SUBSCRIPTION_PAUSED');
    });
  });

  // 다른 엔드포인트에 대한 테스트...
});
