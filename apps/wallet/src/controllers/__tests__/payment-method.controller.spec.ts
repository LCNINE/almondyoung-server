// controllers/__tests__/payment-method.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { PaymentMethodController } from '../payment-method.controller';
import { PaymentService } from '../../services/payment.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { TestModuleBuilder, MockingUtils } from './shared/test-utils';
import { MockDataGenerator } from './shared/mock-data-generator';
import { TestResponseBuilder } from './shared/response-builders';
import { TestFixtures } from './shared/test-fixtures';
import { CreateGeneralPaymentMethodDto } from '../../shared/dtos/create-general-payment-method.dto';
import { 
  PaymentMethodResponseDto, 
  UserPaymentMethodsResponseDto,
  SetDefaultPaymentMethodDto 
} from '../../shared/dtos/payment-methods/payment-method-response.dto';

describe('PaymentMethodController', () => {
  let controller: PaymentMethodController;
  let paymentService: jest.Mocked<PaymentService>;
  let paymentMethodService: jest.Mocked<PaymentMethodService>;
  let module: TestingModule;

  beforeEach(async () => {
    // 테스트 환경 설정
    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK = 'true';

    // 테스트 모듈 생성
    module = await TestModuleBuilder.createControllerTestModule(PaymentMethodController);
    
    controller = module.get<PaymentMethodController>(PaymentMethodController);
    paymentService = module.get<PaymentService>(PaymentService) as jest.Mocked<PaymentService>;
    paymentMethodService = module.get<PaymentMethodService>(PaymentMethodService) as jest.Mocked<PaymentMethodService>;
  });

  afterEach(async () => {
    await module.close();
  });

  describe('registerPointMethod', () => {
    describe('성공 시나리오', () => {
      it('포인트 결제수단 등록 성공', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT', {
          methodType: 'REWARD_POINT',
          methodName: '리워드 포인트',
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_point_123',
          status: 'ACTIVE' as const,
          metadata: { pointType: 'REWARD' },
        };

        const methodData = {
          id: 'pm_point_123',
          userId: requestDto.userId,
          methodType: 'REWARD_POINT' as const,
          methodName: '리워드 포인트',
          status: 'ACTIVE' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerPointMethod(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'REWARD_POINT',
          requestDto,
          undefined,
        );

        expect(paymentMethodService.get).toHaveBeenCalledWith('pm_point_123');

        expect(result).toEqual({
          id: 'pm_point_123',
          userId: requestDto.userId,
          methodType: 'REWARD_POINT',
          methodName: '리워드 포인트',
          status: 'ACTIVE',
          isDefault: false,
          hmsMemberId: undefined,
          createdAt: methodData.createdAt.toISOString(),
        });
      });

      it('멱등성 키와 함께 포인트 등록', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        const idempotencyKey = 'idem_point_123';
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_point_456',
          status: 'ACTIVE' as const,
        };

        const methodData = {
          id: 'pm_point_456',
          userId: requestDto.userId,
          methodType: 'REWARD_POINT' as const,
          methodName: requestDto.methodName,
          status: 'ACTIVE' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerPointMethod(requestDto, idempotencyKey);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'REWARD_POINT',
          requestDto,
          idempotencyKey,
        );

        expect(result.id).toBe('pm_point_456');
      });
    });

    describe('에러 처리', () => {
      it('PaymentService 등록 실패 시 BadRequestException 발생', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const failedResult = {
          success: false,
          error: '포인트 등록에 실패했습니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        await expect(controller.registerPointMethod(requestDto))
          .rejects
          .toThrow(BadRequestException);

        try {
          await controller.registerPointMethod(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('포인트 등록에 실패했습니다');
        }
      });

      it('사용자 포인트 잔액 부족 시 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const failedResult = {
          success: false,
          error: '포인트 잔액이 부족합니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.registerPointMethod(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('포인트 잔액이 부족합니다');
        }
      });

      it('중복 포인트 등록 시 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const failedResult = {
          success: false,
          error: '이미 등록된 포인트 결제수단입니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.registerPointMethod(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('이미 등록된 포인트 결제수단입니다');
        }
      });

      it('PaymentMethodService 조회 실패 시 에러 전파', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_point_789',
          status: 'ACTIVE' as const,
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockRejectedValue(new Error('결제수단을 찾을 수 없습니다'));

        // When & Then
        await expect(controller.registerPointMethod(requestDto))
          .rejects
          .toThrow('결제수단을 찾을 수 없습니다');
      });

      it('PaymentService 예외 발생 시 에러 전파', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        paymentService.registerPaymentMethod.mockRejectedValue(
          new Error('내부 서버 오류')
        );

        // When & Then
        await expect(controller.registerPointMethod(requestDto))
          .rejects
          .toThrow('내부 서버 오류');
      });
    });

    describe('유효성 검증', () => {
      it('올바른 methodType으로 PaymentService 호출', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_point_validation',
          status: 'ACTIVE' as const,
        };

        const methodData = {
          id: 'pm_point_validation',
          userId: requestDto.userId,
          methodType: 'REWARD_POINT' as const,
          methodName: requestDto.methodName,
          status: 'ACTIVE' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerPointMethod(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'REWARD_POINT', // 정확한 methodType 확인
          requestDto,
          undefined,
        );
      });

      it('응답 데이터 구조 검증', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT');
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_point_structure',
          status: 'ACTIVE' as const,
          metadata: { pointType: 'REWARD', balance: 100000 },
        };

        const methodData = {
          id: 'pm_point_structure',
          userId: requestDto.userId,
          methodType: 'REWARD_POINT' as const,
          methodName: requestDto.methodName,
          status: 'ACTIVE' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerPointMethod(requestDto);

        // Then
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('userId');
        expect(result).toHaveProperty('methodType');
        expect(result).toHaveProperty('methodName');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('isDefault');
        expect(result).toHaveProperty('createdAt');
        expect(result.methodType).toBe('REWARD_POINT');
        expect(result.status).toBe('ACTIVE');
      });
    });
  });

  describe('registerRecurringCard', () => {
    describe('성공 시나리오', () => {
      it('정기결제용 카드 등록 성공', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          methodType: 'CARD',
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '1234567890123456',
            cardHolderName: '홍길동',
            expiryDate: '12/25',
            phone: '01012345678',
            billingCycleDay: 15,
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_123',
          hmsMemberId: 'HMS_CARD_123',
          status: 'PENDING' as const,
          metadata: { 
            maskedCardNumber: '1234-****-****-3456',
            cardCompany: 'VISA',
          },
        };

        const methodData = {
          id: 'pm_card_123',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerRecurringCard(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            userId: requestDto.userId,
            methodName: requestDto.methodName,
            isDefault: requestDto.isDefault,
            memberName: '홍길동',
            phone: '01012345678',
            paymentKind: 'CARD',
            paymentNumber: '1234567890123456',
            payerName: '홍길동',
            payerNumber: expect.stringMatching(/^\d{10}$/), // 10자리 숫자
            validYear: '25',
            validMonth: '12',
            paymentDay: '15',
            password: '00',
          }),
          undefined,
          'RECURRING',
        );

        expect(result).toEqual({
          id: 'pm_card_123',
          userId: requestDto.userId,
          methodType: 'CARD',
          methodName: requestDto.methodName,
          status: 'PENDING',
          hmsMemberId: 'HMS_CARD_123',
          createdAt: methodData.createdAt.toISOString(),
        });
      });

      it('멱등성 키와 함께 카드 등록', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD');
        const idempotencyKey = 'idem_card_123';
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_456',
          hmsMemberId: 'HMS_CARD_456',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_456',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerRecurringCard(requestDto, idempotencyKey);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.any(Object),
          idempotencyKey,
          'RECURRING',
        );

        expect(result.id).toBe('pm_card_456');
      });
    });

    describe('에러 처리', () => {
      it('카드 정보 누락 시 BadRequestException 발생', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          methodType: 'CARD',
          cardInfo: undefined, // 카드 정보 누락
        });

        // When & Then
        await expect(controller.registerRecurringCard(requestDto))
          .rejects
          .toThrow(BadRequestException);

        try {
          await controller.registerRecurringCard(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('HMS CMS 등록은 카드 정보가 필요합니다');
        }
      });

      it('잘못된 methodType 시 BadRequestException 발생', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('REWARD_POINT', {
          methodType: 'REWARD_POINT', // CARD가 아님
        });

        // When & Then
        await expect(controller.registerRecurringCard(requestDto))
          .rejects
          .toThrow(BadRequestException);
      });

      it('HMS CMS 등록 실패 시 BadRequestException 발생', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD');
        
        const failedResult = {
          success: false,
          error: 'HMS CMS 등록에 실패했습니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        await expect(controller.registerRecurringCard(requestDto))
          .rejects
          .toThrow(BadRequestException);
      });

      it('유효하지 않은 카드 번호 시 HMS API 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: 'invalid_card_number',
          }),
        });
        
        const failedResult = {
          success: false,
          error: '유효하지 않은 카드 번호입니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.registerRecurringCard(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('유효하지 않은 카드 번호입니다');
        }
      });

      it('만료된 카드 시 HMS API 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            expiryDate: '01/20', // 만료된 카드
          }),
        });
        
        const failedResult = {
          success: false,
          error: '만료된 카드입니다',
        };

        paymentService.registerPaymentMethod.mockResolvedValue(failedResult);

        // When & Then
        try {
          await controller.registerRecurringCard(requestDto);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('만료된 카드입니다');
        }
      });

      it('HMS API 연결 실패 시 에러 처리', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD');
        
        paymentService.registerPaymentMethod.mockRejectedValue(
          new Error('HMS API 서버에 연결할 수 없습니다')
        );

        // When & Then
        await expect(controller.registerRecurringCard(requestDto))
          .rejects
          .toThrow('HMS API 서버에 연결할 수 없습니다');
      });

      it('PaymentMethodService 조회 실패 시 에러 전파', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD');
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_error',
          hmsMemberId: 'HMS_CARD_ERROR',
          status: 'PENDING' as const,
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockRejectedValue(new Error('결제수단 조회 실패'));

        // When & Then
        await expect(controller.registerRecurringCard(requestDto))
          .rejects
          .toThrow('결제수단 조회 실패');
      });
    });

    describe('카드 정보 검증', () => {
      it('카드 번호 마스킹 처리 확인', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '1234567890123456',
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_mask',
          hmsMemberId: 'HMS_CARD_MASK',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_mask',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            paymentKind: 'CARD',
            paymentNumber: '1234567890123456',
            password: '00',
          }),
          undefined,
          'RECURRING',
        );
      });

      it('유효기간 형식 변환 확인', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            expiryDate: '03/28',
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_expiry',
          hmsMemberId: 'HMS_CARD_EXPIRY',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_expiry',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            validYear: '28',
            validMonth: '03',
          }),
          undefined,
          'RECURRING',
        );
      });

      it('HMS 요청 데이터 구조 검증', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '9876543210987654',
            cardHolderName: '김테스트',
            phone: '01087654321',
            billingCycleDay: 25,
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_structure',
          hmsMemberId: 'HMS_CARD_STRUCTURE',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_structure',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            memberName: '김테스트',
            phone: '01087654321',
            paymentKind: 'CARD',
            paymentNumber: '9876543210987654',
            payerName: '김테스트',
            payerNumber: expect.stringMatching(/^\d{10}$/), // 10자리 숫자
            paymentDay: '25',
            password: '00',
          }),
          undefined,
          'RECURRING',
        );
      });

      it('응답 데이터 구조 검증', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD');
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_response',
          hmsMemberId: 'HMS_CARD_RESPONSE',
          status: 'PENDING' as const,
          metadata: {
            maskedCardNumber: '1234-****-****-5678',
            cardCompany: 'VISA',
          },
        };

        const methodData = {
          id: 'pm_card_response',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        const result = await controller.registerRecurringCard(requestDto);

        // Then
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('userId');
        expect(result).toHaveProperty('methodType');
        expect(result).toHaveProperty('methodName');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('hmsMemberId');
        expect(result).toHaveProperty('createdAt');
        expect(result.methodType).toBe('CARD');
        expect(result.status).toBe('PENDING');
        expect(result.hmsMemberId).toBe('HMS_CARD_RESPONSE');
      });

      it('HMS API 정확한 데이터 타입으로 요청 전송', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '1234-5678-9012-3456', // 하이픈 포함
            cardHolderName: '테스트사용자',
            expiryDate: '06/29',
            phone: '010-1234-5678', // 하이픈 포함
            billingCycleDay: 10,
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_hms_type',
          hmsMemberId: 'HMS_CARD_TYPE',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_hms_type',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then - HMS API CreatePaymentProfileDto 타입에 정확히 맞는 데이터 확인
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            // HMS API 필수 필드들
            memberName: '테스트사용자',
            phone: '01012345678', // 하이픈 제거된 숫자만
            paymentKind: 'CARD',
            paymentNumber: '1234567890123456', // 하이픈 제거된 숫자만
            payerName: '테스트사용자',
            payerNumber: '0101234567', // 전화번호에서 10자리 추출
            validYear: '29',
            validMonth: '06',
            // HMS API 선택 필드들
            paymentDay: '10',
            password: '00',
          }),
          undefined,
          'RECURRING',
        );
      });

      it('payerNumber 추출 로직 검증 - 전화번호 우선', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '1111222233334444',
            phone: '01087654321', // 11자리
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_payer_phone',
          hmsMemberId: 'HMS_CARD_PAYER_PHONE',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_payer_phone',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then - 전화번호에서 10자리 추출 확인
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            payerNumber: '0108765432', // 전화번호 앞 10자리
          }),
          undefined,
          'RECURRING',
        );
      });

      it('payerNumber 추출 로직 검증 - 카드번호 대체', async () => {
        // Given
        const requestDto = MockDataGenerator.generateCreateGeneralPaymentMethodDto('CARD', {
          cardInfo: MockDataGenerator.generateCardInfo({
            cardNumber: '1111222233334444',
            phone: '010123', // 10자리 미만
          }),
        });
        
        const registrationResult = {
          success: true,
          paymentMethodId: 'pm_card_payer_card',
          hmsMemberId: 'HMS_CARD_PAYER_CARD',
          status: 'PENDING' as const,
        };

        const methodData = {
          id: 'pm_card_payer_card',
          userId: requestDto.userId,
          methodType: 'CARD' as const,
          methodName: requestDto.methodName,
          status: 'PENDING' as const,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        paymentService.registerPaymentMethod.mockResolvedValue(registrationResult);
        paymentMethodService.get.mockResolvedValue(methodData);

        // When
        await controller.registerRecurringCard(requestDto);

        // Then - 카드번호 뒷 10자리 사용 확인
        expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
          'CARD',
          expect.objectContaining({
            payerNumber: '2233334444', // 카드번호 뒷 10자리
          }),
          undefined,
          'RECURRING',
        );
      });
    });
  });

  describe('getUserPaymentMethods', () => {
    describe('성공 시나리오', () => {
      it('사용자 결제수단 목록 조회 성공', async () => {
        // Given
        const userId = 'user_123';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'CARD',
              status: 'ACTIVE',
              isDefault: true,
            }),
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'REWARD_POINT',
              status: 'ACTIVE',
              isDefault: false,
            }),
          ],
          pendingMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'BNPL',
              status: 'PENDING',
              isDefault: false,
            }),
          ],
          summary: {
            totalCount: 3,
            activeCount: 2,
            pendingCount: 1,
            defaultMethodId: 'pm_card_default',
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(paymentMethodService.getUserMethodsWithStatus).toHaveBeenCalledWith(userId);
        expect(result).toEqual(expectedResponse);
        expect(result.usableMethods).toHaveLength(2);
        expect(result.pendingMethods).toHaveLength(1);
        expect(result.summary.totalCount).toBe(3);
      });

      it('빈 결제수단 목록 조회', async () => {
        // Given
        const userId = 'user_empty';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [],
          pendingMethods: [],
          summary: {
            totalCount: 0,
            activeCount: 0,
            pendingCount: 0,
            defaultMethodId: undefined,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.usableMethods).toHaveLength(0);
        expect(result.pendingMethods).toHaveLength(0);
        expect(result.summary.totalCount).toBe(0);
      });

      it('ACTIVE 상태만 있는 경우', async () => {
        // Given
        const userId = 'user_active_only';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'CARD',
              status: 'ACTIVE',
              isDefault: true,
            }),
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'REWARD_POINT',
              status: 'ACTIVE',
              isDefault: false,
            }),
          ],
          pendingMethods: [],
          summary: {
            totalCount: 2,
            activeCount: 2,
            pendingCount: 0,
            defaultMethodId: 'pm_card_active',
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.usableMethods).toHaveLength(2);
        expect(result.pendingMethods).toHaveLength(0);
        expect(result.summary.activeCount).toBe(2);
        expect(result.summary.pendingCount).toBe(0);
      });

      it('PENDING 상태만 있는 경우', async () => {
        // Given
        const userId = 'user_pending_only';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [],
          pendingMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'BNPL',
              status: 'PENDING',
              isDefault: false,
              bnplDetails: {
                approvalStatus: 'REGISTERED',
                estimatedApprovalDate: '2024-01-18',
                remainingDays: 2,
                nextSteps: ['HMS 심사 진행 중'],
              },
            }),
          ],
          summary: {
            totalCount: 1,
            activeCount: 0,
            pendingCount: 1,
            defaultMethodId: undefined,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.usableMethods).toHaveLength(0);
        expect(result.pendingMethods).toHaveLength(1);
        expect(result.summary.activeCount).toBe(0);
        expect(result.summary.pendingCount).toBe(1);
        expect(result.pendingMethods[0].bnplDetails).toBeDefined();
      });

      it('다양한 결제수단 타입 조회', async () => {
        // Given
        const userId = 'user_various_types';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'CARD',
              status: 'ACTIVE',
              isDefault: true,
              hmsMemberId: 'HMS_CARD_123',
              maskedInfo: '1234-****-****-5678',
            }),
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'REWARD_POINT',
              status: 'ACTIVE',
              isDefault: false,
            }),
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'BNPL',
              status: 'ACTIVE',
              isDefault: false,
              hmsMemberId: 'HMS_BNPL_456',
            }),
          ],
          pendingMethods: [],
          summary: {
            totalCount: 3,
            activeCount: 3,
            pendingCount: 0,
            defaultMethodId: 'pm_card_default',
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.usableMethods).toHaveLength(3);
        expect(result.usableMethods.find(m => m.methodType === 'CARD')).toBeDefined();
        expect(result.usableMethods.find(m => m.methodType === 'REWARD_POINT')).toBeDefined();
        expect(result.usableMethods.find(m => m.methodType === 'BNPL')).toBeDefined();
        expect(result.usableMethods.find(m => m.isDefault)).toBeDefined();
      });

      it('기본 결제수단이 설정된 경우', async () => {
        // Given
        const userId = 'user_with_default';
        const defaultMethodId = 'pm_default_card';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              id: defaultMethodId,
              methodType: 'CARD',
              status: 'ACTIVE',
              isDefault: true,
            }),
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'REWARD_POINT',
              status: 'ACTIVE',
              isDefault: false,
            }),
          ],
          pendingMethods: [],
          summary: {
            totalCount: 2,
            activeCount: 2,
            pendingCount: 0,
            defaultMethodId,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.summary.defaultMethodId).toBe(defaultMethodId);
        expect(result.usableMethods.find(m => m.id === defaultMethodId)?.isDefault).toBe(true);
      });
    });

    describe('에러 처리', () => {
      it('PaymentMethodService 에러 시 에러 전파', async () => {
        // Given
        const userId = 'user_error';
        paymentMethodService.getUserMethodsWithStatus.mockRejectedValue(
          new Error('데이터베이스 연결 오류')
        );

        // When & Then
        await expect(controller.getUserPaymentMethods(userId))
          .rejects
          .toThrow('데이터베이스 연결 오류');
      });

      it('존재하지 않는 사용자 ID 처리', async () => {
        // Given
        const userId = 'non_existent_user';
        paymentMethodService.getUserMethodsWithStatus.mockRejectedValue(
          new Error('사용자를 찾을 수 없습니다')
        );

        // When & Then
        await expect(controller.getUserPaymentMethods(userId))
          .rejects
          .toThrow('사용자를 찾을 수 없습니다');
      });

      it('BNPL 상태 조회 실패 시 기본값 반환', async () => {
        // Given
        const userId = 'user_bnpl_error';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [],
          pendingMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'BNPL',
              status: 'PENDING',
              isDefault: false,
              // bnplDetails가 없는 경우 (조회 실패)
            }),
          ],
          summary: {
            totalCount: 1,
            activeCount: 0,
            pendingCount: 1,
            defaultMethodId: undefined,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result.pendingMethods[0].bnplDetails).toBeUndefined();
      });

      it('서비스 타임아웃 에러 처리', async () => {
        // Given
        const userId = 'user_timeout';
        paymentMethodService.getUserMethodsWithStatus.mockRejectedValue(
          new Error('요청 시간이 초과되었습니다')
        );

        // When & Then
        await expect(controller.getUserPaymentMethods(userId))
          .rejects
          .toThrow('요청 시간이 초과되었습니다');
      });
    });

    describe('응답 데이터 검증', () => {
      it('응답 구조 검증', async () => {
        // Given
        const userId = 'user_structure_test';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'CARD',
              status: 'ACTIVE',
            }),
          ],
          pendingMethods: [],
          summary: {
            totalCount: 1,
            activeCount: 1,
            pendingCount: 0,
            defaultMethodId: undefined,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        expect(result).toHaveProperty('usableMethods');
        expect(result).toHaveProperty('pendingMethods');
        expect(result).toHaveProperty('summary');
        expect(result.summary).toHaveProperty('totalCount');
        expect(result.summary).toHaveProperty('activeCount');
        expect(result.summary).toHaveProperty('pendingCount');
        expect(result.summary).toHaveProperty('defaultMethodId');
      });

      it('결제수단 개별 데이터 구조 검증', async () => {
        // Given
        const userId = 'user_method_structure';
        const expectedResponse: UserPaymentMethodsResponseDto = {
          usableMethods: [
            MockDataGenerator.generatePaymentMethodResponseDto({
              methodType: 'CARD',
              status: 'ACTIVE',
              hmsMemberId: 'HMS_123',
              maskedInfo: '1234-****-****-5678',
            }),
          ],
          pendingMethods: [],
          summary: {
            totalCount: 1,
            activeCount: 1,
            pendingCount: 0,
            defaultMethodId: undefined,
          },
        };

        paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.getUserPaymentMethods(userId);

        // Then
        const method = result.usableMethods[0];
        expect(method).toHaveProperty('id');
        expect(method).toHaveProperty('userId');
        expect(method).toHaveProperty('methodType');
        expect(method).toHaveProperty('methodName');
        expect(method).toHaveProperty('status');
        expect(method).toHaveProperty('isDefault');
        expect(method).toHaveProperty('createdAt');
        expect(method.hmsMemberId).toBe('HMS_123');
        expect(method.maskedInfo).toBe('1234-****-****-5678');
      });
    });
  });

  describe('setDefaultPaymentMethod', () => {
    describe('성공 시나리오', () => {
      it('기본 결제수단 설정 성공', async () => {
        // Given
        const methodId = 'pm_card_123';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'user_123',
        };
        
        const expectedResponse: PaymentMethodResponseDto = {
          id: methodId,
          userId: 'user_123',
          methodType: 'CARD',
          methodName: '테스트 카드',
          status: 'ACTIVE',
          isDefault: true, // 기본 결제수단으로 설정됨
          createdAt: new Date().toISOString(),
          hmsMemberId: 'HMS_CARD_123',
        };

        paymentMethodService.setAsDefault.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.setDefaultPaymentMethod(methodId, setDefaultDto);

        // Then
        expect(paymentMethodService.setAsDefault).toHaveBeenCalledWith(methodId, setDefaultDto.userId);
        expect(result).toEqual(expectedResponse);
        expect(result.isDefault).toBe(true);
      });

      it('다른 결제수단을 기본으로 변경', async () => {
        // Given
        const methodId = 'pm_point_456';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'user_456',
        };
        
        const expectedResponse: PaymentMethodResponseDto = {
          id: methodId,
          userId: 'user_456',
          methodType: 'REWARD_POINT',
          methodName: '리워드 포인트',
          status: 'ACTIVE',
          isDefault: true,
          createdAt: new Date().toISOString(),
        };

        paymentMethodService.setAsDefault.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.setDefaultPaymentMethod(methodId, setDefaultDto);

        // Then
        expect(result.methodType).toBe('REWARD_POINT');
        expect(result.isDefault).toBe(true);
      });
    });

    describe('에러 처리', () => {
      it('존재하지 않는 결제수단 ID 시 에러 전파', async () => {
        // Given
        const methodId = 'non_existent_method';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'user_123',
        };

        paymentMethodService.setAsDefault.mockRejectedValue(
          new Error('결제수단을 찾을 수 없습니다')
        );

        // When & Then
        await expect(controller.setDefaultPaymentMethod(methodId, setDefaultDto))
          .rejects
          .toThrow('결제수단을 찾을 수 없습니다');
      });

      it('권한이 없는 사용자 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_card_123';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'unauthorized_user',
        };

        paymentMethodService.setAsDefault.mockRejectedValue(
          new Error('권한이 없습니다')
        );

        // When & Then
        await expect(controller.setDefaultPaymentMethod(methodId, setDefaultDto))
          .rejects
          .toThrow('권한이 없습니다');
      });

      it('PENDING 상태 결제수단 기본 설정 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_bnpl_pending';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'user_123',
        };

        paymentMethodService.setAsDefault.mockRejectedValue(
          new Error('사용 가능한 결제수단만 기본으로 설정할 수 있습니다')
        );

        // When & Then
        await expect(controller.setDefaultPaymentMethod(methodId, setDefaultDto))
          .rejects
          .toThrow('사용 가능한 결제수단만 기본으로 설정할 수 있습니다');
      });

      it('INACTIVE 상태 결제수단 기본 설정 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_card_inactive';
        const setDefaultDto: SetDefaultPaymentMethodDto = {
          userId: 'user_123',
        };

        paymentMethodService.setAsDefault.mockRejectedValue(
          new Error('현재 상태: INACTIVE')
        );

        // When & Then
        await expect(controller.setDefaultPaymentMethod(methodId, setDefaultDto))
          .rejects
          .toThrow('현재 상태: INACTIVE');
      });
    });
  });

  describe('deletePaymentMethod', () => {
    describe('성공 시나리오', () => {
      it('결제수단 삭제 성공', async () => {
        // Given
        const methodId = 'pm_card_delete';
        const expectedResponse = {
          success: true,
          message: '결제수단이 삭제되었습니다',
        };

        paymentMethodService.delete.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.deletePaymentMethod(methodId);

        // Then
        expect(paymentMethodService.delete).toHaveBeenCalledWith(methodId);
        expect(result).toEqual(expectedResponse);
        expect(result.success).toBe(true);
      });

      it('카드 결제수단 삭제', async () => {
        // Given
        const methodId = 'pm_card_to_delete';
        const expectedResponse = {
          success: true,
          message: '결제수단이 삭제되었습니다',
        };

        paymentMethodService.delete.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.deletePaymentMethod(methodId);

        // Then
        expect(result.success).toBe(true);
        expect(result.message).toBe('결제수단이 삭제되었습니다');
      });

      it('포인트 결제수단 삭제', async () => {
        // Given
        const methodId = 'pm_point_to_delete';
        const expectedResponse = {
          success: true,
          message: '결제수단이 삭제되었습니다',
        };

        paymentMethodService.delete.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.deletePaymentMethod(methodId);

        // Then
        expect(result.success).toBe(true);
      });
    });

    describe('에러 처리', () => {
      it('존재하지 않는 결제수단 ID 시 에러 전파', async () => {
        // Given
        const methodId = 'non_existent_method';

        paymentMethodService.delete.mockRejectedValue(
          new Error('결제수단을 찾을 수 없습니다')
        );

        // When & Then
        await expect(controller.deletePaymentMethod(methodId))
          .rejects
          .toThrow('결제수단을 찾을 수 없습니다');
      });

      it('BNPL 결제수단 삭제 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_bnpl_delete';

        paymentMethodService.delete.mockRejectedValue(
          new Error('BNPL 해지는 고객센터로 문의해주세요')
        );

        // When & Then
        await expect(controller.deletePaymentMethod(methodId))
          .rejects
          .toThrow('BNPL 해지는 고객센터로 문의해주세요');
      });

      it('기본 결제수단 삭제 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_default_method';

        paymentMethodService.delete.mockRejectedValue(
          new Error('기본 결제수단은 삭제할 수 없습니다')
        );

        // When & Then
        await expect(controller.deletePaymentMethod(methodId))
          .rejects
          .toThrow('기본 결제수단은 삭제할 수 없습니다');
      });

      it('외부 시스템 연동 실패 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_external_error';

        paymentMethodService.delete.mockRejectedValue(
          new Error('외부 시스템 연동 중 오류가 발생했습니다')
        );

        // When & Then
        await expect(controller.deletePaymentMethod(methodId))
          .rejects
          .toThrow('외부 시스템 연동 중 오류가 발생했습니다');
      });

      it('데이터베이스 오류 시 에러 전파', async () => {
        // Given
        const methodId = 'pm_db_error';

        paymentMethodService.delete.mockRejectedValue(
          new Error('데이터베이스 오류')
        );

        // When & Then
        await expect(controller.deletePaymentMethod(methodId))
          .rejects
          .toThrow('데이터베이스 오류');
      });
    });

    describe('응답 검증', () => {
      it('삭제 응답 구조 검증', async () => {
        // Given
        const methodId = 'pm_response_test';
        const expectedResponse = {
          success: true,
          message: '결제수단이 삭제되었습니다',
        };

        paymentMethodService.delete.mockResolvedValue(expectedResponse);

        // When
        const result = await controller.deletePaymentMethod(methodId);

        // Then
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('message');
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.message).toBe('string');
      });
    });
  });
});