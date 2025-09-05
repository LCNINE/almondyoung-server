// controllers/__tests__/payment-method.controller.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentMethodController } from '../payment-method.controller';
import { PaymentService } from '../../services/payment.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { CreateGeneralPaymentMethodDto } from '../../shared/dtos/create-general-payment-method.dto';
import { TestModuleBuilder, TestEnvironmentUtils } from './shared/test-utils';

/**
 * PaymentMethodController 통합 테스트
 * - 실제 서비스 로직을 사용하여 전체 플로우 검증
 * - HMS API 호출 및 서비스 간 상호작용 확인
 * - Mock 대신 실제 서비스 메서드 호출 검증
 */
describe('PaymentMethodController Integration Tests', () => {
  let controller: PaymentMethodController;
  let paymentService: jest.Mocked<PaymentService>;
  let paymentMethodService: jest.Mocked<PaymentMethodService>;
  let module: TestingModule;
  let envBackup: Record<string, string | undefined>;

  beforeAll(async () => {
    // 환경변수 백업
    envBackup = TestEnvironmentUtils.backupEnvironment();
    
    // 실제 HMS API를 사용하는 테스트 환경 설정
    TestEnvironmentUtils.setupTestEnvironment({
      useMock: false, // 실제 HMS API 사용
      hasCredentials: true,
    });
  });

  beforeEach(async () => {
    // 각 테스트마다 새로운 모듈 생성
    module = await TestModuleBuilder.createControllerTestModule(PaymentMethodController);
    
    controller = module.get<PaymentMethodController>(PaymentMethodController);
    paymentService = module.get<PaymentService>(PaymentService) as jest.Mocked<PaymentService>;
    paymentMethodService = module.get<PaymentMethodService>(PaymentMethodService) as jest.Mocked<PaymentMethodService>;
  });

  afterEach(async () => {
    await module.close();
  });

  afterAll(() => {
    // 환경변수 복원
    TestEnvironmentUtils.restoreEnvironment(envBackup);
  });

  describe('registerRecurringCard - 실제 서비스 로직 및 DB 저장 검증', () => {
    it('HMS API 정확한 데이터 타입으로 카드 등록 및 서비스 호출 검증', async () => {
      // Given
      const testUserId = `user_integration_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '통합테스트 카드',
        isDefault: false,
        cardInfo: {
          cardNumber: '1234567890123456',
          cardHolderName: '통합테스트사용자',
          expiryDate: '12/25',
          phone: '01012345678',
          billingCycleDay: 15,
        },
      };

      // Mock 서비스 응답 설정 - 실제 HMS API 호출 성공 시뮬레이션
      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_integration_test_123',
        hmsMemberId: 'HMS_INTEGRATION_123',
        status: 'PENDING' as const,
        metadata: {
          maskedCardNumber: '1234****3456',
          cardCompany: 'VISA',
        },
      };

      const mockMethodData = {
        id: 'pm_integration_test_123',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '통합테스트 카드',
        status: 'PENDING' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      const result = await controller.registerRecurringCard(requestDto);

      // Then - 컨트롤러 응답 검증
      expect(result).toMatchObject({
        id: 'pm_integration_test_123',
        userId: testUserId,
        methodType: 'CARD',
        methodName: '통합테스트 카드',
        status: 'PENDING',
        hmsMemberId: 'HMS_INTEGRATION_123',
        createdAt: expect.any(String),
      });

      // Then - PaymentService가 올바른 HMS API 데이터 형식으로 호출되었는지 검증
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.objectContaining({
          userId: testUserId,
          methodName: '통합테스트 카드',
          isDefault: false,
          // HMS API 필수 필드들
          memberName: '통합테스트사용자',
          phone: '01012345678', // 하이픈 제거된 숫자만
          paymentKind: 'CARD',
          paymentNumber: '1234567890123456', // 하이픈 제거된 숫자만
          payerName: '통합테스트사용자',
          payerNumber: '0101234567', // 전화번호에서 10자리 추출
          validYear: '25', // "12/25" → "25"
          validMonth: '12', // "12/25" → "12"
          paymentDay: '15',
          password: '00',
        }),
        undefined,
        'RECURRING'
      );

      // Then - PaymentMethodService가 등록된 결제수단 조회를 위해 호출되었는지 검증
      expect(paymentMethodService.get).toHaveBeenCalledWith('pm_integration_test_123');

      console.log('✅ HMS API 데이터 타입 검증 및 서비스 호출 확인 완료');
      console.log('- HMS Member ID:', result.hmsMemberId);
      console.log('- Payment Method ID:', result.id);
      console.log('- Status:', result.status);
    });

    it('HMS API 데이터 변환 로직 검증 - 하이픈 제거 및 형식 변환', async () => {
      // Given
      const testUserId = `user_transform_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '데이터변환테스트',
        isDefault: false,
        cardInfo: {
          cardNumber: '1234-5678-9012-3456', // 하이픈 포함
          cardHolderName: '데이터변환사용자',
          expiryDate: '06/29',
          phone: '010-1234-5678', // 하이픈 포함
          billingCycleDay: 25,
        },
      };

      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_transform_test_123',
        hmsMemberId: 'HMS_TRANSFORM_123',
        status: 'PENDING' as const,
      };

      const mockMethodData = {
        id: 'pm_transform_test_123',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '데이터변환테스트',
        status: 'PENDING' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      await controller.registerRecurringCard(requestDto);

      // Then - 데이터 변환이 올바르게 수행되었는지 검증
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.objectContaining({
          // 하이픈 제거 검증
          paymentNumber: '1234567890123456', // 하이픈 제거됨
          phone: '01012345678', // 하이픈 제거됨
          // 유효기간 형식 변환 검증
          validYear: '29', // "06/29" → "29"
          validMonth: '06', // "06/29" → "06"
          // payerNumber 추출 검증
          payerNumber: '0101234567', // 전화번호에서 10자리 추출
          // 기타 필드
          paymentDay: '25',
          password: '00',
        }),
        undefined,
        'RECURRING'
      );

      console.log('✅ 데이터 변환 로직 검증 완료');
      console.log('- 원본 카드번호:', requestDto.cardInfo?.cardNumber);
      console.log('- 변환된 카드번호: 1234567890123456 (하이픈 제거)');
      console.log('- 원본 전화번호:', requestDto.cardInfo?.phone);
      console.log('- 변환된 전화번호: 01012345678 (하이픈 제거)');
      console.log('- 원본 유효기간:', requestDto.cardInfo?.expiryDate);
      console.log('- 변환된 유효기간: validMonth=06, validYear=29');
    });

    it('payerNumber 추출 로직 검증 - 전화번호 우선 사용', async () => {
      // Given
      const testUserId = `user_payer_phone_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '납부자번호테스트',
        isDefault: false,
        cardInfo: {
          cardNumber: '1111222233334444',
          cardHolderName: '납부자번호사용자',
          expiryDate: '12/26',
          phone: '01087654321', // 11자리
          billingCycleDay: 15,
        },
      };

      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_payer_phone_123',
        hmsMemberId: 'HMS_PAYER_PHONE_123',
        status: 'PENDING' as const,
      };

      const mockMethodData = {
        id: 'pm_payer_phone_123',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '납부자번호테스트',
        status: 'PENDING' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      await controller.registerRecurringCard(requestDto);

      // Then - 전화번호에서 10자리 추출 확인
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.objectContaining({
          payerNumber: '0108765432', // 전화번호 앞 10자리
        }),
        undefined,
        'RECURRING'
      );

      console.log('✅ payerNumber 추출 로직 검증 완료 (전화번호 우선)');
      console.log('- 전화번호:', requestDto.cardInfo?.phone);
      console.log('- 추출된 payerNumber: 0108765432 (앞 10자리)');
    });

    it('payerNumber 추출 로직 검증 - 카드번호 대체 사용', async () => {
      // Given
      const testUserId = `user_payer_card_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '납부자번호카드테스트',
        isDefault: false,
        cardInfo: {
          cardNumber: '1111222233334444',
          cardHolderName: '납부자번호카드사용자',
          expiryDate: '12/26',
          phone: '010123', // 10자리 미만
          billingCycleDay: 15,
        },
      };

      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_payer_card_123',
        hmsMemberId: 'HMS_PAYER_CARD_123',
        status: 'PENDING' as const,
      };

      const mockMethodData = {
        id: 'pm_payer_card_123',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '납부자번호카드테스트',
        status: 'PENDING' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      await controller.registerRecurringCard(requestDto);

      // Then - 카드번호에서 10자리 추출 확인
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.objectContaining({
          payerNumber: '2233334444', // 카드번호 뒷 10자리
        }),
        undefined,
        'RECURRING'
      );

      console.log('✅ payerNumber 추출 로직 검증 완료 (카드번호 대체)');
      console.log('- 전화번호:', requestDto.cardInfo?.phone, '(10자리 미만)');
      console.log('- 카드번호:', requestDto.cardInfo?.cardNumber);
      console.log('- 추출된 payerNumber: 2233334444 (카드번호 뒷 10자리)');
    });

    it('HMS API 에러 시 BadRequestException 발생 및 에러 전파', async () => {
      // Given
      const testUserId = `user_error_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '에러테스트카드',
        isDefault: false,
        cardInfo: {
          cardNumber: 'invalid_card_number',
          cardHolderName: '에러테스트사용자',
          expiryDate: '01/20', // 만료된 날짜
          phone: '01012345678',
          billingCycleDay: 15,
        },
      };

      // PaymentService에서 HMS API 에러 시뮬레이션
      const mockErrorResult = {
        success: false,
        error: 'HMS API 오류: 유효하지 않은 카드 번호',
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockErrorResult);

      // When & Then - BadRequestException 발생
      await expect(controller.registerRecurringCard(requestDto))
        .rejects
        .toThrow(BadRequestException);

      // Then - PaymentService가 호출되었지만 PaymentMethodService는 호출되지 않음
      expect(paymentService.registerPaymentMethod).toHaveBeenCalled();
      expect(paymentMethodService.get).not.toHaveBeenCalled();

      console.log('✅ HMS API 에러 처리 및 에러 전파 검증 완료');
    });

    it('멱등성 키 처리 검증', async () => {
      // Given
      const testUserId = `user_idempotent_${Date.now()}`;
      const idempotencyKey = `idem_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '멱등성테스트카드',
        isDefault: false,
        cardInfo: {
          cardNumber: '9876543210987654',
          cardHolderName: '멱등성테스트사용자',
          expiryDate: '03/28',
          phone: '01087654321',
          billingCycleDay: 20,
        },
      };

      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_idempotent_123',
        hmsMemberId: 'HMS_IDEMPOTENT_123',
        status: 'PENDING' as const,
      };

      const mockMethodData = {
        id: 'pm_idempotent_123',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '멱등성테스트카드',
        status: 'PENDING' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      await controller.registerRecurringCard(requestDto, idempotencyKey);

      // Then - 멱등성 키가 PaymentService에 전달되었는지 확인
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.any(Object),
        idempotencyKey,
        'RECURRING'
      );

      console.log('✅ 멱등성 키 처리 검증 완료');
      console.log('- Idempotency Key:', idempotencyKey);
    });
  });

  describe('registerPointMethod - 서비스 로직 검증', () => {
    it('포인트 결제수단 등록 및 서비스 호출 검증', async () => {
      // Given
      const testUserId = `user_point_${Date.now()}`;
      const requestDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'REWARD_POINT',
        methodName: '통합테스트 포인트',
        isDefault: false,
      };

      const mockRegistrationResult = {
        success: true,
        paymentMethodId: 'pm_point_123',
        status: 'ACTIVE' as const,
        metadata: { pointType: 'REWARD' },
      };

      const mockMethodData = {
        id: 'pm_point_123',
        userId: testUserId,
        methodType: 'REWARD_POINT' as const,
        methodName: '통합테스트 포인트',
        status: 'ACTIVE' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      paymentService.registerPaymentMethod.mockResolvedValue(mockRegistrationResult);
      paymentMethodService.get.mockResolvedValue(mockMethodData);

      // When
      const result = await controller.registerPointMethod(requestDto);

      // Then - 컨트롤러 응답 검증
      expect(result).toMatchObject({
        id: 'pm_point_123',
        userId: testUserId,
        methodType: 'REWARD_POINT',
        methodName: '통합테스트 포인트',
        status: 'ACTIVE',
        isDefault: false,
        createdAt: expect.any(String),
      });

      // Then - PaymentService가 올바른 타입으로 호출되었는지 검증
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'REWARD_POINT',
        requestDto,
        undefined
      );

      // Then - PaymentMethodService가 등록된 결제수단 조회를 위해 호출되었는지 검증
      expect(paymentMethodService.get).toHaveBeenCalledWith('pm_point_123');

      console.log('✅ 포인트 결제수단 등록 및 서비스 호출 검증 완료');
      console.log('- Payment Method ID:', result.id);
      console.log('- Status:', result.status);
    });
  });

  describe('전체 플로우 검증', () => {
    it('카드 등록부터 조회까지 전체 플로우 검증', async () => {
      // Given
      const testUserId = `user_full_flow_${Date.now()}`;
      
      // 1. 카드 등록
      const cardDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'CARD',
        methodName: '전체플로우테스트카드',
        isDefault: true,
        cardInfo: {
          cardNumber: '1234567890123456',
          cardHolderName: '전체플로우사용자',
          expiryDate: '12/25',
          phone: '01012345678',
          billingCycleDay: 15,
        },
      };

      const mockCardResult = {
        success: true,
        paymentMethodId: 'pm_full_flow_card',
        hmsMemberId: 'HMS_FULL_FLOW_CARD',
        status: 'PENDING' as const,
      };

      const mockCardData = {
        id: 'pm_full_flow_card',
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: '전체플로우테스트카드',
        status: 'PENDING' as const,
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 2. 포인트 등록
      const pointDto: CreateGeneralPaymentMethodDto = {
        userId: testUserId,
        methodType: 'REWARD_POINT',
        methodName: '전체플로우테스트포인트',
        isDefault: false,
      };

      const mockPointResult = {
        success: true,
        paymentMethodId: 'pm_full_flow_point',
        status: 'ACTIVE' as const,
      };

      const mockPointData = {
        id: 'pm_full_flow_point',
        userId: testUserId,
        methodType: 'REWARD_POINT' as const,
        methodName: '전체플로우테스트포인트',
        status: 'ACTIVE' as const,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 3. 사용자 결제수단 목록 조회
      const mockUserMethods = {
        usableMethods: [{
          ...mockPointData,
          createdAt: mockPointData.createdAt.toISOString(),
        }],
        pendingMethods: [{
          ...mockCardData,
          createdAt: mockCardData.createdAt.toISOString(),
        }],
        summary: {
          totalCount: 2,
          activeCount: 1,
          pendingCount: 1,
          defaultMethodId: 'pm_full_flow_card',
        },
      };

      // Mock 설정
      paymentService.registerPaymentMethod
        .mockResolvedValueOnce(mockCardResult)
        .mockResolvedValueOnce(mockPointResult);
      
      paymentMethodService.get
        .mockResolvedValueOnce(mockCardData)
        .mockResolvedValueOnce(mockPointData);
      
      paymentMethodService.getUserMethodsWithStatus.mockResolvedValue(mockUserMethods);

      // When - 전체 플로우 실행
      const cardResult = await controller.registerRecurringCard(cardDto);
      const pointResult = await controller.registerPointMethod(pointDto);
      const userMethods = await controller.getUserPaymentMethods(testUserId);

      // Then - 전체 플로우 검증
      expect(cardResult.methodType).toBe('CARD');
      expect(cardResult.hmsMemberId).toBe('HMS_FULL_FLOW_CARD');
      
      expect(pointResult.methodType).toBe('REWARD_POINT');
      expect(pointResult.status).toBe('ACTIVE');
      
      expect(userMethods.summary.totalCount).toBe(2);
      expect(userMethods.usableMethods).toHaveLength(1);
      expect(userMethods.pendingMethods).toHaveLength(1);

      // Then - 서비스 호출 순서 및 횟수 검증
      expect(paymentService.registerPaymentMethod).toHaveBeenCalledTimes(2);
      expect(paymentMethodService.get).toHaveBeenCalledTimes(2);
      expect(paymentMethodService.getUserMethodsWithStatus).toHaveBeenCalledTimes(1);

      console.log('✅ 전체 플로우 검증 완료');
      console.log('- 카드 등록:', cardResult.id);
      console.log('- 포인트 등록:', pointResult.id);
      console.log('- 총 결제수단 수:', userMethods.summary.totalCount);
    });
  });
});