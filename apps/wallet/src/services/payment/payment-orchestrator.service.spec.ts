import { Test, TestingModule } from '@nestjs/testing';
import { PaymentOrchestratorService } from './payment-orchestrator.service.interface';

import { PointService } from '../points/point.service';
import { DbService } from '@app/db';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import {
  PaymentResult,
  ProviderType,
  PaymentType,
} from '../../providers/payment-provider.interface';
import type {
  PaymentIntent,
  PaymentAttempt,
} from '../../shared/database/types';

describe('PaymentOrchestratorService - Concurrent Payment Prevention', () => {
  let service: PaymentOrchestratorService;
  let mockDb: any;
  let mockPaymentExecutor: any;
  let mockPointService: any;
  let mockTx: any;

  beforeEach(async () => {
    // Mock transaction object
    mockTx = {
      query: {
        paymentAttempts: {
          findMany: jest.fn(),
        },
      },
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };

    // Mock database service
    mockDb = {
      db: {
        query: {
          paymentIntents: {
            findFirst: jest.fn(),
          },
        },
        transaction: jest
          .fn()
          .mockImplementation((callback) => callback(mockTx)),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      },
    };

    // Mock payment executor service
    mockPaymentExecutor = {
      authorize: jest.fn(),
      inquire: jest.fn(),
      capture: jest.fn(),
    };

    // Mock point service
    mockPointService = {
      getBalance: jest.fn(),
      redeem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        {
          provide: DbService,
          useValue: mockDb,
        },
        {
          provide: PaymentExecutorService,
          useValue: mockPaymentExecutor,
        },
        {
          provide: PointService,
          useValue: mockPointService,
        },
      ],
    }).compile();

    service = module.get<PaymentOrchestratorService>(
      PaymentOrchestratorService,
    );
  });

  describe('cancelActiveAttempt', () => {
    it('should cancel active attempts for given intent', async () => {
      const intentId = generateUUIDv7();
      const activeAttempts: Partial<PaymentAttempt>[] = [
        { id: generateUUIDv7(), status: 'AUTHORIZED', intentId },
        { id: generateUUIDv7(), status: 'AUTHORIZED', intentId },
      ];

      mockTx.query.paymentAttempts.findMany.mockResolvedValue(activeAttempts);

      // Access private method for testing
      const cancelActiveAttempt = (service as any).cancelActiveAttempt.bind(
        service,
      );
      const result = await cancelActiveAttempt(intentId, mockTx);

      expect(mockTx.query.paymentAttempts.findMany).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no active attempts found', async () => {
      const intentId = generateUUIDv7();
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);

      const cancelActiveAttempt = (service as any).cancelActiveAttempt.bind(
        service,
      );
      const result = await cancelActiveAttempt(intentId, mockTx);

      expect(result).toEqual([]);
      expect(mockTx.update).not.toHaveBeenCalled();
    });
  });

  describe('authorizePayment - Concurrent Prevention', () => {
    it('should cancel previous active attempts before creating new one', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const activeAttempts: Partial<PaymentAttempt>[] = [
        { id: generateUUIDv7(), status: 'AUTHORIZED', intentId },
      ];

      const mockPaymentResult: PaymentResult = {
        success: true,
        transactionId: 'tx_123',
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue(activeAttempts);
      mockPaymentExecutor.authorize.mockResolvedValue(mockPaymentResult);
      mockPointService.getBalance.mockResolvedValue(0);

      await service.authorizePayment(intentId, ProviderType.TOSS, {});

      expect(mockTx.query.paymentAttempts.findMany).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalled();
      expect(mockPaymentExecutor.authorize).toHaveBeenCalled();
    });

    it('should handle UNKNOWN status recovery', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'UNKNOWN' as any,
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockInquiryResult: PaymentResult = {
        success: true,
        status: 'AUTHORIZED',
        transactionId: 'tx_recovered',
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockPaymentExecutor.inquire.mockResolvedValue(mockInquiryResult);

      const result = await service.authorizePayment(
        intentId,
        ProviderType.TOSS,
        {},
      );

      expect(mockPaymentExecutor.inquire).toHaveBeenCalledWith(
        intentId,
        ProviderType.TOSS,
      );
      expect(mockDb.db.update).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toBe('이전 결제 상태를 복구했습니다.');
    });

    it('should continue with new payment if UNKNOWN recovery fails', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'UNKNOWN' as any,
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPaymentResult: PaymentResult = {
        success: true,
        transactionId: 'tx_new',
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockPaymentExecutor.inquire.mockRejectedValue(
        new Error('Inquiry failed'),
      );
      mockPaymentExecutor.authorize.mockResolvedValue(mockPaymentResult);
      mockPointService.getBalance.mockResolvedValue(0);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);

      const result = await service.authorizePayment(
        intentId,
        ProviderType.TOSS,
        {},
      );

      expect(mockPaymentExecutor.inquire).toHaveBeenCalled();
      expect(mockPaymentExecutor.authorize).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should set UNKNOWN status when external payment succeeds but internal processing fails', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);
      mockPointService.getBalance.mockResolvedValue(0);

      // Mock authorize to succeed
      mockPaymentExecutor.authorize.mockResolvedValue({
        success: true,
        transactionId: 'tx_123',
      });

      // Mock insert to throw error with pgApproved flag
      const errorWithPgApproved = new Error('Internal processing failed');
      (errorWithPgApproved as any).pgApproved = true;
      mockTx.insert.mockReturnValue({
        values: jest.fn().mockRejectedValue(errorWithPgApproved),
      });

      try {
        await service.authorizePayment(intentId, ProviderType.TOSS, {});
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Internal processing failed');
      }

      expect(mockDb.db.update).toHaveBeenCalled();
    });

    it('should handle point-only payment', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(5000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);
      mockPointService.getBalance.mockResolvedValue(10000);
      mockPointService.redeem.mockResolvedValue({
        eventId: 1,
        used: 5000,
      });

      const result = await service.authorizePayment(intentId, null, {
        usePoints: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('포인트 전액 결제 완료');
      expect(result.attemptId).toBeNull();
      expect(result.pointEventId).toBe(1);
      expect(mockPaymentExecutor.authorize).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent requests with database constraint', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);
      mockPointService.getBalance.mockResolvedValue(0);

      // Simulate database constraint violation
      const constraintError: any = new Error(
        'duplicate key value violates unique constraint',
      );
      constraintError.code = '23505';
      mockPaymentExecutor.authorize.mockRejectedValue(constraintError);

      try {
        await service.authorizePayment(intentId, ProviderType.TOSS, {});
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).toBe('23505');
      }
    });

    it('should handle multiple concurrent cancellations', async () => {
      const intentId = generateUUIDv7();
      const activeAttempts: Partial<PaymentAttempt>[] = Array.from(
        { length: 5 },
        () => ({
          id: generateUUIDv7(),
          status: 'AUTHORIZED',
          intentId,
        }),
      );

      mockTx.query.paymentAttempts.findMany.mockResolvedValue(activeAttempts);

      const cancelActiveAttempt = (service as any).cancelActiveAttempt.bind(
        service,
      );
      const result = await cancelActiveAttempt(intentId, mockTx);

      expect(result).toHaveLength(5);
      expect(mockTx.update).toHaveBeenCalledTimes(1);
    });

    it('should throw error when provider is missing for non-point payment', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);
      mockPointService.getBalance.mockResolvedValue(0);

      try {
        await service.authorizePayment(intentId, null, {});
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Provider는 필수입니다');
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full flow: cancel previous + create new + handle success', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const previousAttempt: Partial<PaymentAttempt> = {
        id: generateUUIDv7(),
        status: 'AUTHORIZED',
        intentId,
      };

      const mockPaymentResult: PaymentResult = {
        success: true,
        transactionId: 'tx_new',
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([
        previousAttempt,
      ]);
      mockPaymentExecutor.authorize.mockResolvedValue(mockPaymentResult);
      mockPointService.getBalance.mockResolvedValue(0);

      const result = await service.authorizePayment(
        intentId,
        ProviderType.TOSS,
        {},
      );

      // Verify previous attempt was canceled
      expect(mockTx.query.paymentAttempts.findMany).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalled();

      // Verify new payment was processed
      expect(mockPaymentExecutor.authorize).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle mixed payment with points and external provider', async () => {
      const intentId = generateUUIDv7();
      const mockIntent: Partial<PaymentIntent> = {
        id: intentId,
        customerId: '123',
        amount: BigInt(10000),
        status: 'PENDING',
        type: PaymentType.ORDER,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPaymentResult: PaymentResult = {
        success: true,
        transactionId: 'tx_mixed',
      };

      mockDb.db.query.paymentIntents.findFirst.mockResolvedValue(mockIntent);
      mockTx.query.paymentAttempts.findMany.mockResolvedValue([]);
      mockPointService.getBalance.mockResolvedValue(5000);
      mockPointService.redeem.mockResolvedValue({
        eventId: 1,
        used: 3000,
      });
      mockPaymentExecutor.authorize.mockResolvedValue(mockPaymentResult);

      const result = await service.authorizePayment(
        intentId,
        ProviderType.TOSS,
        {
          usePoints: 3000,
        },
      );

      expect(mockPointService.redeem).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3000,
        }),
        mockTx,
      );
      expect(mockPaymentExecutor.authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 7000, // 10000 - 3000
        }),
        ProviderType.TOSS,
        mockIntent,
        { tx: mockTx },
      );
      expect(result.success).toBe(true);
      expect(result.breakdown).toEqual({
        totalAmount: 10000,
        pointsUsed: 3000,
        finalAmount: 7000,
      });
    });
  });
});
