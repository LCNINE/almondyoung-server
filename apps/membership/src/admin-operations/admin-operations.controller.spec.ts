import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import * as request from 'supertest';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { PolicyManagementService } from '../policy-management/policy-management.service';
import {
  HttpExceptionFilter,
  SubscriptionExceptionFilter,
} from '../shared/filters/subscription-exception.filter';
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  CreatePolicyRequest,
  UpdatePolicyRequest,
} from '../shared/schemas';
import { Server } from 'http';

// Services를 모킹합니다.
const mockAdminOperationsService = {
  createTier: jest.fn(),
  updateTier: jest.fn(),
  createPlan: jest.fn(),
  updatePlan: jest.fn(),
  deactivatePlan: jest.fn(),
};

const mockPolicyManagementService = {
  getAllPolicies: jest.fn(),
  getPolicyById: jest.fn(),
  createPolicy: jest.fn(),
  updatePolicy: jest.fn(),
  deactivatePolicy: jest.fn(),
};

describe('AdminOperationsController (Integration)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminOperationsController],
      providers: [
        {
          provide: AdminOperationsService,
          useValue: mockAdminOperationsService,
        },
        {
          provide: PolicyManagementService,
          useValue: mockPolicyManagementService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(
      new HttpExceptionFilter(),
      new SubscriptionExceptionFilter(),
    );

    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // =================================================================
  // 티어 및 플랜 관리 테스트
  // =================================================================
  describe('Tier & Plan Management', () => {
    describe('POST /admin/tiers', () => {
      const createTierUrl = '/admin/tiers';

      it('성공: 유효한 데이터로 티어 생성 요청 시 201 Created 응답을 반환해야 한다', async () => {
        const validDto: CreateTierRequest = {
          code: 'GOLD_TIER',
          name: '골드 티어',
          priorityLevel: 20,
        };
        const serviceResponse = {
          success: true,
          message: '티어가 성공적으로 생성되었습니다.',
          tierId: 'd6b7b2a6-a6e5-4a16-95f7-3a7b7d6d3e7c',
        };
        mockAdminOperationsService.createTier.mockResolvedValue(
          serviceResponse,
        );

        return request(app.getHttpServer())
          .post(createTierUrl)
          .send(validDto)
          .expect(HttpStatus.CREATED)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(mockAdminOperationsService.createTier).toHaveBeenCalledTimes(
              1,
            );
            expect(mockAdminOperationsService.createTier).toHaveBeenCalledWith(
              validDto,
              expect.any(String),
            );
          });
      });
    });

    describe('PUT /admin/tiers/:tierId', () => {
      const tierId = 'some-valid-uuid';
      const updateTierUrl = `/admin/tiers/${tierId}`;

      it('성공: 유효한 데이터로 티어 수정 요청 시 200 OK 응답을 반환해야 한다', async () => {
        const validDto: UpdateTierRequest = {
          name: '새로운 티어 이름',
          priorityLevel: 55,
        };
        const serviceResponse = {
          success: true,
          message: '티어가 성공적으로 수정되었습니다.',
          tierId,
        };
        mockAdminOperationsService.updateTier.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .put(updateTierUrl)
          .send(validDto)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(mockAdminOperationsService.updateTier).toHaveBeenCalledTimes(
              1,
            );
            expect(mockAdminOperationsService.updateTier).toHaveBeenCalledWith(
              tierId,
              validDto,
              expect.any(String),
            );
          });
      });
    });

    describe('POST /admin/plans', () => {
      const createPlanUrl = '/admin/plans';

      it('성공: 유효한 데이터로 플랜 생성 요청 시 201 Created 응답을 반환해야 한다', async () => {
        const validDto: CreatePlanRequest = {
          currency: 'KRW',
          tierId: 'd6b7b2a6-a6e5-4a16-95f7-3a7b7d6d3e7c',
          price: 15000,
          durationDays: 30,
          trialDays: 10,
        };
        const serviceResponse = {
          success: true,
          message: '플랜이 성공적으로 생성되었습니다.',
          planId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
        };
        mockAdminOperationsService.createPlan.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .post(createPlanUrl)
          .send(validDto)
          .expect(HttpStatus.CREATED)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(mockAdminOperationsService.createPlan).toHaveBeenCalledWith(
              validDto,
              expect.any(String),
            );
          });
      });
    });

    describe('PUT /admin/plans/:planId', () => {
      const planId = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
      const updatePlanUrl = `/admin/plans/${planId}`;

      it('성공: 유효한 데이터로 플랜 수정 요청 시 200 OK 응답을 반환해야 한다', async () => {
        const validDto: UpdatePlanRequest = {
          price: 12000,
          isActive: false,
        };
        const serviceResponse = {
          success: true,
          message: '플랜이 성공적으로 수정되었습니다.',
          planId,
        };
        mockAdminOperationsService.updatePlan.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .put(updatePlanUrl)
          .send(validDto)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(mockAdminOperationsService.updatePlan).toHaveBeenCalledWith(
              planId,
              validDto,
              expect.any(String),
            );
          });
      });
    });

    describe('DELETE /admin/plans/:planId', () => {
      const planId = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
      const deactivatePlanUrl = `/admin/plans/${planId}`;

      it('성공: 유효한 데이터로 플랜 비활성화 요청 시 200 OK 응답을 반환해야 한다', async () => {
        const validDto: DeactivatePlanRequest = {
          reason: '이 플랜은 더 이상 사용되지 않습니다.',
        };
        const serviceResponse = {
          success: true,
          message: '플랜이 성공적으로 비활성화되었습니다.',
          planId,
        };
        mockAdminOperationsService.deactivatePlan.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .delete(deactivatePlanUrl)
          .send(validDto)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(
              mockAdminOperationsService.deactivatePlan,
            ).toHaveBeenCalledWith(planId, validDto, expect.any(String));
          });
      });
    });
  });

  // =================================================================
  // 정책 관리 테스트
  // =================================================================
  describe('Policy Management', () => {
    const policyId = 'policy-uuid-1234';

    describe('GET /admin/policies', () => {
      it('성공: 모든 정책 목록을 반환해야 한다', async () => {
        const mockPolicies = {
          policies: [{ id: policyId, ruleType: 'MAX_PAUSES_PER_YEAR' }],
          total: 1,
          page: 1,
          limit: 20,
        };
        mockPolicyManagementService.getAllPolicies.mockResolvedValue(
          mockPolicies,
        );

        await request(app.getHttpServer())
          .get('/admin/policies')
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(mockPolicies);
            expect(
              mockPolicyManagementService.getAllPolicies,
            ).toHaveBeenCalledWith({});
          });
      });
    });

    describe('GET /admin/policies/:policyId', () => {
      it('성공: 특정 정책 정보를 반환해야 한다', async () => {
        const mockPolicy = { id: policyId, ruleType: 'MAX_PAUSES_PER_YEAR' };
        mockPolicyManagementService.getPolicyById.mockResolvedValue(mockPolicy);

        await request(app.getHttpServer())
          .get(`/admin/policies/${policyId}`)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(mockPolicy);
            expect(
              mockPolicyManagementService.getPolicyById,
            ).toHaveBeenCalledWith(policyId);
          });
      });

      it('실패: 존재하지 않는 policyId의 경우 404 Not Found를 반환해야 한다', async () => {
        mockPolicyManagementService.getPolicyById.mockRejectedValue(
          new NotFoundException(),
        );

        await request(app.getHttpServer())
          .get(`/admin/policies/non-existent-id`)
          .expect(HttpStatus.NOT_FOUND);
      });
    });

    describe('POST /admin/policies', () => {
      it('성공: 유효한 데이터로 정책 생성 시 201 Created를 반환해야 한다', async () => {
        const validDto: CreatePolicyRequest = {
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { limit: 5 },
        };
        const serviceResponse = { id: policyId, ...validDto };
        mockPolicyManagementService.createPolicy.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .post('/admin/policies')
          .send(validDto)
          .expect(HttpStatus.CREATED)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(
              mockPolicyManagementService.createPolicy,
            ).toHaveBeenCalledWith(validDto);
          });
      });

      it('실패: ruleType이 유효하지 않은 경우 400 Bad Request를 반환해야 한다', async () => {
        const invalidDto = {
          ruleType: 'INVALID_RULE_TYPE',
          ruleValue: { limit: 5 },
        };

        await request(app.getHttpServer())
          .post('/admin/policies')
          .send(invalidDto)
          .expect(HttpStatus.BAD_REQUEST)
          .then((response) => {
            expect(response.body.message).toBe('입력값 검증에 실패했습니다');
          });
      });
    });

    describe('PUT /admin/policies/:policyId', () => {
      it('성공: 유효한 데이터로 정책 수정 시 200 OK를 반환해야 한다', async () => {
        const validDto: UpdatePolicyRequest = {
          ruleValue: { limit: 10 },
          isActive: false,
        };
        const serviceResponse = {
          id: policyId,
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ...validDto,
        };
        mockPolicyManagementService.updatePolicy.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .put(`/admin/policies/${policyId}`)
          .send(validDto)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(
              mockPolicyManagementService.updatePolicy,
            ).toHaveBeenCalledWith(policyId, validDto);
          });
      });
    });

    describe('DELETE /admin/policies/:policyId', () => {
      it('성공: 정책 비활성화 요청 시 200 OK와 성공 메시지를 반환해야 한다', async () => {
        const serviceResponse = {
          success: true,
          message: '정책이 성공적으로 비활성화되었습니다.',
        };
        mockPolicyManagementService.deactivatePolicy.mockResolvedValue(
          serviceResponse,
        );

        await request(app.getHttpServer())
          .delete(`/admin/policies/${policyId}`)
          .expect(HttpStatus.OK)
          .then((response) => {
            expect(response.body).toEqual(serviceResponse);
            expect(
              mockPolicyManagementService.deactivatePolicy,
            ).toHaveBeenCalledWith(policyId);
          });
      });

      it('실패: 존재하지 않는 policyId의 경우 404 Not Found를 반환해야 한다', async () => {
        mockPolicyManagementService.deactivatePolicy.mockRejectedValue(
          new NotFoundException(),
        );

        await request(app.getHttpServer())
          .delete(`/admin/policies/non-existent-id`)
          .expect(HttpStatus.NOT_FOUND);
      });
    });
  });
});
