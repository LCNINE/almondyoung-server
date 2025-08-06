import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import {
  SubscriptionExceptionFilter,
  HttpExceptionFilter,
} from '../shared/filters/subscription-exception.filter';
import { PlanNotFoundException } from '../shared/exceptions/subscription.exceptions';

// PlanService를 모킹(Mocking)합니다.
const mockPlanService = {
  getAllPlans: jest.fn(),
  getPlanDetails: jest.fn(),
  getAllTiers: jest.fn(),
  getPlansByTier: jest.fn(),
  getTierBenefits: jest.fn(),
};

describe('PlanController (Integration)', () => {
  let app: INestApplication;
  let httpServer: any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PlanController],
      providers: [
        {
          provide: PlanService,
          useValue: mockPlanService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // 컨트롤러에 적용된 ExceptionFilter를 테스트 환경에도 동일하게 적용합니다.
    app.useGlobalFilters(
      new SubscriptionExceptionFilter(),
      new HttpExceptionFilter(),
    );

    await app.init();
    httpServer = app.getHttpServer();
  });

  // 각 테스트가 끝나면 모킹된 함수의 호출 기록을 초기화하여 테스트 간 독립성을 보장합니다.
  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // =================================================================
  // GET /plans
  // =================================================================
  describe('GET /plans', () => {
    it('성공: 모든 플랜 목록과 200 OK 상태코드를 반환해야 한다', async () => {
      // Arrange: 서비스가 반환할 가짜 데이터를 준비합니다.
      const mockResult = [
        { id: 'plan-1', name: '베이직 플랜', price: 10000 },
        { id: 'plan-2', name: '프리미엄 플랜', price: 20000 },
      ];
      mockPlanService.getAllPlans.mockResolvedValue(mockResult);

      // Act & Assert
      await request(httpServer)
        .get('/plans')
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(mockResult);
          expect(mockPlanService.getAllPlans).toHaveBeenCalledTimes(1);
        });
    });
  });

  // =================================================================
  // GET /plans/:planId
  // =================================================================
  describe('GET /plans/:planId', () => {
    const planId = 'test-plan-id';

    it('성공: 유효한 planId로 특정 플랜의 상세 정보와 200 OK를 반환해야 한다', async () => {
      // Arrange
      const mockResult = {
        id: planId,
        name: '상세 플랜',
        price: 15000,
        durationDays: 30,
      };
      mockPlanService.getPlanDetails.mockResolvedValue(mockResult);

      // Act & Assert
      await request(httpServer)
        .get(`/plans/${planId}`)
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(mockResult);
          expect(mockPlanService.getPlanDetails).toHaveBeenCalledWith(planId);
        });
    });

    it('실패: 존재하지 않는 planId의 경우 404 Not Found를 반환해야 한다', async () => {
      // Arrange: 서비스가 PlanNotFoundException을 던지도록 설정합니다.
      const nonExistentId = 'non-existent-id';
      mockPlanService.getPlanDetails.mockRejectedValue(
        new PlanNotFoundException(),
      );

      // Act & Assert
      await request(httpServer)
        .get(`/plans/${nonExistentId}`)
        .expect(HttpStatus.NOT_FOUND)
        .then((response) => {
          // SubscriptionExceptionFilter가 반환하는 에러 형식을 검증합니다.
          expect(response.body.error.code).toBe('PLAN_NOT_FOUND');
          expect(response.body.error.message).toBe('유효하지 않은 플랜입니다');
        });

      expect(mockPlanService.getPlanDetails).toHaveBeenCalledWith(
        nonExistentId,
      );
    });
  });

  // =================================================================
  // GET /tiers
  // =================================================================
  describe('GET /tiers', () => {
    it('성공: 모든 티어 목록과 200 OK 상태코드를 반환해야 한다', async () => {
      // Arrange
      const mockResult = [
        { id: 'tier-1', code: 'FREE' },
        { id: 'tier-2', code: 'PRO' },
      ];
      mockPlanService.getAllTiers.mockResolvedValue(mockResult);

      // Act & Assert
      await request(httpServer)
        .get('/tiers')
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(mockResult);
          expect(mockPlanService.getAllTiers).toHaveBeenCalledTimes(1);
        });
    });
  });

  // =================================================================
  // GET /tiers/:tierId/plans
  // =================================================================
  describe('GET /tiers/:tierId/plans', () => {
    const tierId = 'pro-tier-id';
    it('성공: 특정 티어에 속한 플랜 목록과 200 OK를 반환해야 한다', async () => {
      // Arrange
      const mockResult = [{ id: 'pro-plan-1', name: '프로 플랜' }];
      mockPlanService.getPlansByTier.mockResolvedValue(mockResult);

      // Act & Assert
      await request(httpServer)
        .get(`/tiers/${tierId}/plans`)
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(mockResult);
          expect(mockPlanService.getPlansByTier).toHaveBeenCalledWith(tierId);
        });
    });
  });

  // =================================================================
  // GET /tiers/:tierId/benefits
  // =================================================================
  describe('GET /tiers/:tierId/benefits', () => {
    const tierId = 'pro-tier-id';
    it('성공: 특정 티어의 혜택 정보와 200 OK를 반환해야 한다', async () => {
      // Arrange
      const mockResult = {
        tierCode: 'PRO',
        benefits: ['Benefit A', 'Benefit B'],
      };
      mockPlanService.getTierBenefits.mockResolvedValue(mockResult);

      // Act & Assert
      await request(httpServer)
        .get(`/tiers/${tierId}/benefits`)
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(mockResult);
          expect(mockPlanService.getTierBenefits).toHaveBeenCalledWith(tierId);
        });
    });
  });
});
