import { Test, TestingModule } from '@nestjs/testing';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import {
  CreateBnplAccountDto,
  UpdateBnplAccountStatusDto,
} from '../shared/zod';

describe('BnplController', () => {
  let controller: BnplController;
  const mockService: jest.Mocked<BnplService> = {
    createBnplAccount: jest.fn(),
    getBnplAccount: jest.fn(),
    getBnplAccounts: jest.fn(),
    deactivateBnplAccount: jest.fn(),
    getBnplEventHistory: jest.fn(),
    checkBnplHealth: jest.fn(),
    requestWithdrawal: jest.fn(),
    submitAgreement: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BnplController],
      providers: [{ provide: BnplService, useValue: mockService }],
    }).compile();

    controller = module.get(BnplController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('createBnplAccount should call service and return result', async () => {
    const dto: CreateBnplAccountDto = {
      userId: 'u1',
      paymentMethodId: 'pm1',
      creditLimit: 5000,
      approvedLimit: 3000,
      billingCycleDay: 25,
    } as any;
    mockService.createBnplAccount.mockResolvedValue({
      success: true,
      message: 'BNPL 계좌가 성공적으로 등록되었습니다.',
      data: {
        paymentMethod: {
          id: 'pm1',
          userId: 'u1',
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          methodType: 'BNPL',
          methodName: 'BNPL',
          isDefault: true,
          institutionCode: 'ALM',
        },
        bnplAccount: {
          id: 'acc1',
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: 'u1',
          status: 'ACTIVE',
          paymentMethodId: 'pm1',
          creditLimit: 5000,
          approvedLimit: 3000,
          currentBalance: 0,
          billingCycleDay: 25,
          version: 1,
        },
        hmsMember: { member: { memberId: 'm1' } },
      },
    });

    const res = await controller.createBnplAccount(dto);
    expect(mockService.createBnplAccount).toHaveBeenCalledWith(dto);
    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.any(Object),
      }),
    );
  });

  it('deactivateBnplAccount should pass params correctly', async () => {
    const statusDto: UpdateBnplAccountStatusDto = { status: 'INACTIVE' } as any;
    mockService.deactivateBnplAccount.mockResolvedValue({
      success: true,
      message: 'BNPL 계좌가 성공적으로 비활성화되었습니다.',
    });

    const res = await controller.deactivateBnplAccount('acc1', statusDto);
    expect(mockService.deactivateBnplAccount).toHaveBeenCalledWith({
      ...statusDto,
      accountId: 'acc1',
    });
    expect(res).toEqual(expect.objectContaining({ success: true }));
  });

  it('checkBnplHealth should forward call', async () => {
    mockService.checkBnplHealth.mockResolvedValue({
      services: { hms: 'ok', database: 'ok', scheduler: 'ok' },
      timestamp: new Date().toISOString(),
      status: 'ok',
      message: 'BNPL 상태 확인 완료',
      error: undefined,
    });
    const res = await controller.checkBnplHealth();
    expect(mockService.checkBnplHealth).toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ status: 'ok' }));
  });
});
