import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import {
  SubscriptionExceptionFilter,
  HttpExceptionFilter,
} from '../shared/filters/subscription-exception.filter';
import {
  CreateSubscriptionRequest,
  UpgradeSubscriptionRequest,
  DowngradeSubscriptionRequest,
  CancelSubscriptionRequest,
} from '../shared/schemas';
import {
  SubscriptionNotFoundException,
  ActiveSubscriptionExistsException,
  InvalidPlanChangeException,
} from '../shared/exceptions/subscription.exceptions';

// SubscriptionService를 모킹(Mocking)합니다.
const mockSubscriptionService = {
  getCurrentSubscription: jest.fn(),
  createSubscription: jest.fn(),
  upgradeSubscription: jest.fn(),
  downgradeSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  getSubscriptionHistory: jest.fn(),
};

describe('SubscriptionController (Integration)', () => {
  let app: INestApplication;
  let httpServer: any;
  const userId = 'a-valid-user-id';
  // ✅ 테스트용으로 사용할 유효한 UUID
  const validPlanId = '123e4567-e89b-12d3-a456-426614174000';
  const newValidPlanId = '987e6543-e21b-12d3-a456-426614174001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        {
          provide: SubscriptionService,
          useValue: mockSubscriptionService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    app.useGlobalFilters(
      new SubscriptionExceptionFilter(),
      new HttpExceptionFilter(),
    );

    await app.init();
    httpServer = app.getHttpServer();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /subscriptions', () => {
    it('성공: 유효한 데이터로 구독 생성 시 201 Created를 반환해야 한다', async () => {
      // Arrange
      const validDto: CreateSubscriptionRequest = {
        planId: validPlanId, // ✅ 유효한 UUID로 수정
      };
      const serviceResponse = {
        subscriptionId: 'new-subscription-id',
        status: 'ACTIVE',
      };
      mockSubscriptionService.createSubscription.mockResolvedValue(
        serviceResponse,
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.CREATED)
        .then((response) => {
          expect(response.body).toEqual(serviceResponse);
          expect(
            mockSubscriptionService.createSubscription,
          ).toHaveBeenCalledWith(userId, validDto.planId);
        });
    });

    it('실패: 이미 활성 구독이 있는 경우 409 Conflict를 반환해야 한다', async () => {
      // Arrange
      const validDto: CreateSubscriptionRequest = {
        planId: validPlanId, // ✅ 유효한 UUID로 수정
      };
      mockSubscriptionService.createSubscription.mockRejectedValue(
        new ActiveSubscriptionExistsException(),
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.CONFLICT)
        .then((response) => {
          expect(response.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
        });
    });

    it('실패: planId가 UUID 형식이 아닌 경우 400 Bad Request를 반환해야 한다', async () => {
      const invalidDto = { planId: 'not-a-uuid' };

      await request(httpServer)
        .post(`/subscriptions?userId=${userId}`)
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /subscriptions/current', () => {
    it('성공: 현재 구독 정보와 200 OK를 반환해야 한다', async () => {
      const serviceResponse = { id: 'current-sub-id', status: 'ACTIVE' };
      mockSubscriptionService.getCurrentSubscription.mockResolvedValue(
        serviceResponse,
      );

      await request(httpServer)
        .get(`/subscriptions/current?userId=${userId}`)
        .expect(HttpStatus.OK);
    });

    it('실패: 구독 정보가 없는 경우 404 Not Found를 반환해야 한다', async () => {
      mockSubscriptionService.getCurrentSubscription.mockRejectedValue(
        new SubscriptionNotFoundException(),
      );

      await request(httpServer)
        .get(`/subscriptions/current?userId=${userId}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /subscriptions/upgrade', () => {
    it('성공: 유효한 데이터로 업그레이드 시 201 Created를 반환해야 한다', async () => {
      // Arrange
      const validDto: UpgradeSubscriptionRequest = {
        newPlanId: newValidPlanId, // ✅ 유효한 UUID로 수정
      };
      const serviceResponse = {
        subscriptionId: 'upgraded-sub-id',
        status: 'ACTIVE',
      };
      mockSubscriptionService.upgradeSubscription.mockResolvedValue(
        serviceResponse,
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions/upgrade?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.CREATED)
        .then((response) => {
          expect(response.body).toEqual(serviceResponse);
          expect(
            mockSubscriptionService.upgradeSubscription,
          ).toHaveBeenCalledWith(userId, validDto.newPlanId);
        });
    });
  });

  // =================================================================
  // 다운그레이드 및 취소 테스트 (새로 추가된 부분)
  // =================================================================
  describe('POST /subscriptions/downgrade', () => {
    it('성공: 유효한 데이터로 다운그레이드 요청 시 200 OK를 반환해야 한다', async () => {
      // Arrange
      const validDto: DowngradeSubscriptionRequest = {
        newPlanId: validPlanId,
      };
      const serviceResponse = {
        message: '다운그레이드 요청이 예약되었습니다.',
        effectiveDate: '2025-09-01T00:00:00.000Z',
      };
      mockSubscriptionService.downgradeSubscription.mockResolvedValue(
        serviceResponse,
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions/downgrade?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(serviceResponse);
          expect(
            mockSubscriptionService.downgradeSubscription,
          ).toHaveBeenCalledWith(userId, validDto.newPlanId);
        });
    });

    it('실패: 다운그레이드가 불가능한 플랜일 경우 400 Bad Request를 반환해야 한다', async () => {
      // Arrange
      const validDto: DowngradeSubscriptionRequest = { newPlanId: validPlanId };
      mockSubscriptionService.downgradeSubscription.mockRejectedValue(
        new InvalidPlanChangeException('현재 플랜보다 높은 등급입니다.'),
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions/downgrade?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.BAD_REQUEST)
        .then((response) => {
          expect(response.body.error.code).toBe('INVALID_PLAN_CHANGE');
        });
    });
  });

  describe('POST /subscriptions/cancel', () => {
    it('성공: 유효한 데이터로 구독 취소 요청 시 200 OK를 반환해야 한다', async () => {
      // Arrange
      const validDto: CancelSubscriptionRequest = {
        reason: '서비스 불만족',
      };
      const serviceResponse = {
        message: '구독이 성공적으로 취소 예약되었습니다.',
        status: 'PENDING_CANCELLATION',
      };
      mockSubscriptionService.cancelSubscription.mockResolvedValue(
        serviceResponse,
      );

      // Act & Assert
      await request(httpServer)
        .post(`/subscriptions/cancel?userId=${userId}`)
        .send(validDto)
        .expect(HttpStatus.OK)
        .then((response) => {
          expect(response.body).toEqual(serviceResponse);
          expect(
            mockSubscriptionService.cancelSubscription,
          ).toHaveBeenCalledWith(userId, validDto.reason);
        });
    });
  });

  describe('GET /subscriptions/history', () => {
    it('성공: 구독 이력과 200 OK를 반환해야 한다', async () => {
      const serviceResponse = [{ id: 'history-sub-1', status: 'EXPIRED' }];
      mockSubscriptionService.getSubscriptionHistory.mockResolvedValue(
        serviceResponse,
      );

      await request(httpServer)
        .get(`/subscriptions/history?userId=${userId}`)
        .expect(HttpStatus.OK);
    });
  });
});
