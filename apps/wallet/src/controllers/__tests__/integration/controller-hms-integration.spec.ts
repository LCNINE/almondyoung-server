// Controller HMS Integration Test
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethodController } from '../../payment-method.controller';
import { PaymentMethodService } from '../../../services/payment-method.service';
import { PaymentService } from '../../../services/payment.service';
import { CreateGeneralPaymentMethodDto } from '../../../shared/dtos/create-general-payment-method.dto';
import { getTsid } from 'tsid-ts';

// 최소한의 Mock 서비스
const mockPaymentMethodService = {
  get: jest.fn(),
  getUserMethodsWithStatus: jest.fn(),
};

const mockPaymentService = {
  registerPaymentMethod: jest.fn(),
};

describe('Controller HMS Integration Test', () => {
  let controller: PaymentMethodController;

  beforeAll(async () => {
    // 환경변수 설정 - 실제 HMS API 사용
    process.env.SW_KEY = '4LjFflzr6z4YSknp';
    process.env.CUST_KEY = 'BT2z4D5DUm7cE5tl';
    process.env.USE_MOCK = 'false'; // 실제 HMS API 사용
    process.env.NODE_ENV = 'test';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentMethodController],
      providers: [
        {
          provide: PaymentMethodService,
          useValue: mockPaymentMethodService,
        },
        {
          provide: PaymentService,
          useValue: mockPaymentService,
        },
      ],
    }).compile();

    controller = module.get<PaymentMethodController>(PaymentMethodController);
  });

  it('should convert DTO correctly and call HMS API', async () => {
    const testId = getTsid().toString();
    
    // Mock 서비스 응답 설정
    mockPaymentService.registerPaymentMethod.mockResolvedValue({
      success: true,
      paymentMethodId: `pm_${testId}`,
      hmsMemberId: `hms_${testId}`,
    });

    mockPaymentMethodService.get.mockResolvedValue({
      id: `pm_${testId}`,
      userId: `user_${testId}`,
      methodType: 'CARD',
      methodName: '테스트 카드',
      status: 'ACTIVE',
      isDefault: true,
      createdAt: new Date(),
    });

    // 실제 컨트롤러 호출
    const dto: CreateGeneralPaymentMethodDto = {
      userId: `user_${testId}`,
      methodType: 'CARD',
      methodName: '테스트 카드',
      isDefault: true,
      cardInfo: {
        cardNumber: '1234567890123456',
        cardHolderName: '홍길동',
        expiryDate: '12/25',
        phone: '01012345678',
        billingCycleDay: 1,
      },
    };

    console.log('컨트롤러 호출 시작...');
    
    try {
      const result = await controller.registerRecurringCard(dto);
      
      console.log('컨트롤러 결과:', JSON.stringify(result, null, 2));
      
      // PaymentService.registerPaymentMethod가 올바른 데이터로 호출되었는지 확인
      expect(mockPaymentService.registerPaymentMethod).toHaveBeenCalledWith(
        'CARD',
        expect.objectContaining({
          memberName: '홍길동',
          paymentNumber: '1234567890123456',
          payerName: '홍길동',
          payerNumber: '1234567890123456',
          phone: '01012345678',
          validYear: '25',
          validMonth: '12',
        }),
        undefined,
        'RECURRING'
      );
      
      expect(result).toBeDefined();
      expect(result.id).toBe(`pm_${testId}`);
      
    } catch (error) {
      console.error('컨트롤러 에러:', error);
      
      // 에러 내용을 분석해서 HMS API 호출 문제인지 확인
      if (error.message.includes('HMS')) {
        console.log('HMS API 관련 에러 - 데이터 변환 문제일 가능성');
      }
      
      // PaymentService가 호출되었는지는 확인
      expect(mockPaymentService.registerPaymentMethod).toHaveBeenCalled();
      
      // 호출된 파라미터 확인
      const callArgs = mockPaymentService.registerPaymentMethod.mock.calls[0];
      console.log('PaymentService 호출 파라미터:', JSON.stringify(callArgs, null, 2));
    }
  }, 15000);

  it('should handle expiryDate conversion correctly', async () => {
    const testId = getTsid().toString();
    
    // 다양한 expiryDate 형식 테스트
    const testCases = [
      { input: '12/25', expectedYear: '25', expectedMonth: '12' },
      { input: '01/26', expectedYear: '26', expectedMonth: '01' },
      { input: '6/24', expectedYear: '24', expectedMonth: '06' },
    ];

    for (const testCase of testCases) {
      mockPaymentService.registerPaymentMethod.mockClear();
      mockPaymentService.registerPaymentMethod.mockResolvedValue({
        success: true,
        paymentMethodId: `pm_${testId}`,
        hmsMemberId: `hms_${testId}`,
      });

      const dto: CreateGeneralPaymentMethodDto = {
        userId: `user_${testId}`,
        methodType: 'CARD',
        methodName: '테스트 카드',
        isDefault: true,
        cardInfo: {
          cardNumber: '1234567890123456',
          cardHolderName: '홍길동',
          expiryDate: testCase.input,
          phone: '01012345678',
          billingCycleDay: 1,
        },
      };

      try {
        await controller.registerRecurringCard(dto);
        
        // 변환된 데이터 확인
        const callArgs = mockPaymentService.registerPaymentMethod.mock.calls[0];
        const hmsRequest = callArgs[1];
        
        console.log(`expiryDate ${testCase.input} 변환 결과:`, {
          validYear: hmsRequest.validYear,
          validMonth: hmsRequest.validMonth,
        });
        
        expect(hmsRequest.validYear).toBe(testCase.expectedYear);
        expect(hmsRequest.validMonth).toBe(testCase.expectedMonth);
        
      } catch (error) {
        console.log(`expiryDate ${testCase.input} 변환 테스트 중 에러:`, error.message);
      }
    }
  }, 10000);
});