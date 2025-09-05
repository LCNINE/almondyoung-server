// controllers/__tests__/payment.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentController } from '../payment.controller';
import { PaymentService } from '../../services/payment.service';
import { TestModuleBuilder, MockingUtils, TestExecutionUtils } from './shared/test-utils';
import { MockDataGenerator } from './shared/mock-data-generator';
import { TestResponseBuilder } from './shared/response-builders';
import { TestFixtures } from './shared/test-fixtures';
import { TestApiClientFactory } from './shared/test-api-client-factory';
import {
  ProcessPaymentDto,
  ProcessPaymentResponseDto,
} from '../../shared/dtos/payments/process-payment.dto';

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: jest.Mocked<PaymentService>;
  let module: TestingModule;

  beforeEach(async () => {
    // 테스트 환경 설정
    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK = 'true';

    // 테스트 모듈 생성
    module = await TestModuleBuilder.createControllerTestModule(PaymentController);

    controller = module.get<PaymentController>(PaymentController);
    paymentService = module.get<PaymentService>(PaymentService) as jest.Mocked<PaymentService>;
  });

  afterEach(async () => {
    await module.close();
  });

  describe('processPayment', () => {
    describe('성공 시나리오', () => {
      it('카드 결제 처리 성공', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'CARD',
              amount: 100000,
            }),
          ],
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_card_123',
          paymentEventId: 'pay_event_123',
          captureId: 'cap_card_123',
          amount: 100000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
          metadata: { gateway: 'hms_card' },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          'CARD',
          100000,
          'KRW',
          {
            userId: requestDto.userId,
            sessionId: requestDto.sessionId,
            paymentMethodId: requestDto.paymentMethods[0].paymentMethodId,
            orderName: requestDto.metadata?.orderName,
          },
          requestDto.idemKey,
        );

        expect(result).toEqual({
          success: true,
          paymentId: expectedServiceResult.paymentEventId,
          sessionId: requestDto.sessionId,
          totalAmount: 100000,
          results: [
            {
              methodType: 'CARD',
              amount: 100000,
              status: 'CAPTURED',
              authorizationIds: [],
              captureIds: ['cap_card_123'],
              transactionId: 'txn_card_123',
            },
          ],
        });
      });

      it('BNPL 결제 처리 성공 (승인만)', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'BNPL',
              amount: 200000,
            }),
          ],
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_bnpl_123',
          authorizationId: 'auth_bnpl_123',
          amount: 200000,
          currency: 'KRW',
          status: 'AUTHORIZED' as const,
          metadata: { gateway: 'hms_bnpl' },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then
        expect(result.results[0]).toEqual({
          methodType: 'BNPL',
          amount: 200000,
          status: 'AUTHORIZED',
          authorizationIds: ['auth_bnpl_123'],
          captureIds: [],
          transactionId: 'txn_bnpl_123',
        });
      });

      it('HMS API 정확한 데이터 타입으로 카드 결제 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'CARD',
              amount: 150000,
              paymentMethodId: 'pm_card_hms_test',
            }),
          ],
          metadata: {
            orderName: 'HMS API 테스트 주문',
          },
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_hms_card_123',
          paymentEventId: 'pay_hms_event_123',
          captureId: 'cap_hms_card_123',
          amount: 150000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
          metadata: { 
            gateway: 'hms_card',
            hmsMemberId: 'HMS_MEMBER_123',
            approvalNumber: 'HMS_APPROVAL_123',
          },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then - HMS API PaymentTransactionRequest 타입에 맞는 데이터 전달 확인
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          'CARD',
          150000,
          'KRW',
          expect.objectContaining({
            userId: requestDto.userId,
            sessionId: requestDto.sessionId,
            paymentMethodId: 'pm_card_hms_test',
            orderName: 'HMS API 테스트 주문',
          }),
          requestDto.idemKey,
        );

        expect(result).toEqual({
          success: true,
          paymentId: 'pay_hms_event_123',
          sessionId: requestDto.sessionId,
          totalAmount: 150000,
          results: [
            {
              methodType: 'CARD',
              amount: 150000,
              status: 'CAPTURED',
              authorizationIds: [],
              captureIds: ['cap_hms_card_123'],
              transactionId: 'txn_hms_card_123',
            },
          ],
        });
      });

      it('포인트 결제 처리 성공', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'REWARD_POINT',
              amount: 50000,
            }),
          ],
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_point_123',
          amount: 50000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
          metadata: { gateway: 'internal_point' },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then
        expect(result.results[0]).toEqual({
          methodType: 'REWARD_POINT',
          amount: 50000,
          status: 'CAPTURED',
          authorizationIds: [],
          captureIds: [],
          transactionId: 'txn_point_123',
        });
      });
    });

    describe('멱등성 키 처리', () => {
      it('헤더의 Idempotency-Key 우선 사용', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          idemKey: 'body_key_123',
        });
        const headerKey = 'header_key_456';

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_123',
          amount: 100000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        await controller.processPayment(requestDto, headerKey);

        // Then
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Object),
          headerKey, // 헤더 키가 우선
        );
      });

      it('헤더가 없으면 body의 idemKey 사용', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          idemKey: 'body_key_123',
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_123',
          amount: 100000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        await controller.processPayment(requestDto);

        // Then
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Object),
          'body_key_123',
        );
      });

      it('멱등성 키가 없어도 정상 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        delete requestDto.idemKey;

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_123',
          amount: 100000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        await controller.processPayment(requestDto);

        // Then
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Object),
          undefined,
        );
      });
    });

    describe('에러 처리', () => {
      it('not found 에러 시 404 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('payment session not found')
        );

        // When & Then
        await expect(controller.processPayment(requestDto))
          .rejects
          .toThrow(HttpException);

        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect(error.message).toContain('not found');
        }
      });

      it('결제수단 not found 에러 시 404 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('payment method not found')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect(error.message).toContain('not found');
        }
      });

      it('validation 에러 시 400 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('amount is invalid')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('invalid');
        }
      });

      it('필수 필드 누락 시 400 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('sessionId is required')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('required');
        }
      });

      it('지원하지 않는 결제수단 시 400 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('unsupported payment method')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('unsupported');
        }
      });

      it('결제 실패 시 400 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('payment failed')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('failed');
        }
      });

      it('이미 처리된 요청 시 400 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('already processed')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        }
      });

      it('알 수 없는 에러 시 500 반환', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto();
        paymentService.processPayment.mockRejectedValue(
          new Error('Unknown database error')
        );

        // When & Then
        try {
          await controller.processPayment(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect(error.message).toBe('결제 처리 중 알 수 없는 오류가 발생했습니다');
        }
      });
    });

    describe('다양한 결제수단 조합', () => {
      it('혼합 결제 (카드 + 포인트) 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'CARD',
              amount: 80000,
            }),
          ],
          usePoints: 20000,
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_mixed_123',
          paymentEventId: 'pay_event_mixed_123',
          captureId: 'cap_mixed_123',
          amount: 80000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
          metadata: { gateway: 'hms_card' },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then
        expect(result.totalAmount).toBe(80000); // Only paymentMethods amounts are summed
        expect(result.results[0].amount).toBe(80000);
      });

      it('빈 결제수단 배열 시 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [],
        });

        // When & Then
        // 컨트롤러는 첫 번째 결제수단을 사용하므로 undefined 접근 시 에러 발생
        await expect(controller.processPayment(requestDto))
          .rejects
          .toThrow();
      });

      it('여러 결제수단 중 첫 번째만 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateProcessPaymentDto({
          paymentMethods: [
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'CARD',
              amount: 50000,
            }),
            MockDataGenerator.generatePaymentMethodRequestDto({
              type: 'BNPL',
              amount: 30000,
            }),
          ],
        });

        const expectedServiceResult = {
          success: true,
          transactionId: 'txn_first_123',
          paymentEventId: 'pay_event_first_123',
          captureId: 'cap_first_123',
          amount: 50000,
          currency: 'KRW',
          status: 'CAPTURED' as const,
          metadata: { gateway: 'hms_card' },
        };

        paymentService.processPayment.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.processPayment(requestDto);

        // Then
        expect(paymentService.processPayment).toHaveBeenCalledWith(
          'CARD', // 첫 번째 결제수단 타입
          50000,  // 첫 번째 결제수단 금액
          'KRW',
          expect.any(Object),
          expect.any(String),
        );
        expect(result.totalAmount).toBe(80000); // 모든 결제수단 금액 합계
      });
    });
  });

  describe('captureDeferred', () => {
    describe('성공 시나리오', () => {
      it('BNPL 출금 실행 성공', async () => {
        // Given
        const authorizationId = 'auth_bnpl_123';
        const expectedServiceResult = {
          success: true,
          paymentEventId: 'pay_event_123',
          sessionId: 'session_123',
          amount: 200000,
          captureIds: ['cap_bnpl_123'],
        };

        paymentService.batchCapture.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.captureDeferred(authorizationId);

        // Then
        expect(paymentService.batchCapture).toHaveBeenCalledWith(
          'BNPL',
          [authorizationId]
        );

        expect(result).toEqual({
          success: true,
          paymentId: 'pay_event_123',
          sessionId: 'session_123',
          totalAmount: 200000,
          results: [
            {
              methodType: 'BNPL',
              amount: 200000,
              status: 'CAPTURED',
              authorizationIds: [authorizationId],
              captureIds: ['cap_bnpl_123'],
            },
          ],
        });
      });

      it('여러 승인 ID 배치 출금 성공', async () => {
        // Given
        const authorizationId = 'auth_bnpl_456';
        const expectedServiceResult = {
          success: true,
          paymentEventId: 'pay_event_456',
          sessionId: 'session_456',
          amount: 150000,
          captureIds: ['cap_bnpl_456', 'cap_bnpl_457'],
        };

        paymentService.batchCapture.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.captureDeferred(authorizationId);

        // Then
        expect(result.results[0].captureIds).toEqual(['cap_bnpl_456', 'cap_bnpl_457']);
        expect(result.totalAmount).toBe(150000);
      });

      it('금액이 없는 경우 0으로 처리', async () => {
        // Given
        const authorizationId = 'auth_bnpl_789';
        const expectedServiceResult = {
          success: true,
          paymentEventId: 'pay_event_789',
          sessionId: 'session_789',
          captureIds: ['cap_bnpl_789'],
          // amount가 없는 경우
        };

        paymentService.batchCapture.mockResolvedValue(expectedServiceResult);

        // When
        const result = await controller.captureDeferred(authorizationId);

        // Then
        expect(result.totalAmount).toBe(0);
        expect(result.results[0].amount).toBe(0);
      });
    });

    describe('에러 처리', () => {
      it('승인 ID를 찾을 수 없을 때 404 반환', async () => {
        // Given
        const authorizationId = 'non_existent_auth';
        paymentService.batchCapture.mockRejectedValue(
          new Error('authorization not found')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
        }
      });

      it('승인건 not found 에러 시 404 반환', async () => {
        // Given
        const authorizationId = 'invalid_auth_id';
        paymentService.batchCapture.mockRejectedValue(
          new Error('authorization record not found')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect(error.message).toContain('not found');
        }
      });

      it('이미 처리된 승인 시 400 반환', async () => {
        // Given
        const authorizationId = 'auth_already_captured';
        paymentService.batchCapture.mockRejectedValue(
          new Error('already processed')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        }
      });

      it('유효하지 않은 승인 ID 시 400 반환', async () => {
        // Given
        const authorizationId = 'invalid_format_auth';
        paymentService.batchCapture.mockRejectedValue(
          new Error('invalid authorization ID format')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('invalid');
        }
      });

      it('출금 처리 실패 시 400 반환', async () => {
        // Given
        const authorizationId = 'auth_processing_failed';
        paymentService.batchCapture.mockRejectedValue(
          new Error('capture processing failed')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect(error.message).toContain('failed');
        }
      });

      it('출금 실패 시 내부 에러 처리', async () => {
        // Given
        const authorizationId = 'auth_failed';
        const failedResult = {
          success: false,
          error: 'BNPL 출금 실패',
        };

        paymentService.batchCapture.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });

      it('captureIds가 없는 실패 응답 처리', async () => {
        // Given
        const authorizationId = 'auth_no_capture_ids';
        const failedResult = {
          success: true,
          paymentEventId: 'pay_event_failed',
          sessionId: 'session_failed',
          amount: 100000,
          captureIds: [], // 빈 배열
        };

        paymentService.batchCapture.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });

      it('알 수 없는 에러 시 500 반환', async () => {
        // Given
        const authorizationId = 'auth_unknown_error';
        paymentService.batchCapture.mockRejectedValue(
          new Error('Database connection error')
        );

        // When & Then
        try {
          await controller.captureDeferred(authorizationId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect(error.message).toBe('BNPL 출금 처리 중 알 수 없는 오류가 발생했습니다');
        }
      });
    });
  });
});