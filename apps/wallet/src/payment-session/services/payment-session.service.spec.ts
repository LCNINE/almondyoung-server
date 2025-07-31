import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentSessionService } from './payment-session.service';
import { DbService } from '@app/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentSession, PaymentSessionStatus} from '../types';

// --- Mocks ---

// Drizzle 트랜잭션 클라이언트에 대한 모의 객체입니다.
// 복잡한 Drizzle 스키마의 타입 추론 문제를 해결하기 위해 'any' 타입으로 지정합니다.
// 이는 유닛 테스트에서 안전하고 일반적인 방법입니다.
const mockTx: any = {
  query: {
    paymentSessions: {
      findFirst: jest.fn(),
    },
  },
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn(),
};

// 메인 Drizzle 데이터베이스 클라이언트에 대한 모의 객체입니다.
// 마찬가지로 타입 추론 문제를 피하기 위해 'any' 타입으로 지정합니다.
const mockDbClient: any = {
  query: {
    paymentSessions: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
  // transaction 메소드는 콜백 함수를 즉시 실행하고, 모의 트랜잭션 클라이언트인 'mockTx'를 전달합니다.
  transaction: jest.fn().mockImplementation(async (callback) => callback(mockTx)),
};

describe('PaymentSessionService', () => {
  let service: PaymentSessionService;
  let dbService: DbService<any>;
  let eventEmitter: EventEmitter2;

  // 테스트에서 일관되게 사용할 모의 결제 세션 객체
  const mockPaymentSession: PaymentSession = {
    id: 'ps_123456789',
    userId: 'user_abc',
    amount: 1500,
    currency: 'KRW',
    status: 'PENDING',
    metadata: JSON.stringify({ orderId: 'order_987' }),
    expiresAt: new Date(Date.now() + 3600 * 1000), // 1시간 후 만료
    authorizedAt: null,
    capturedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentSessionService,
        {
          provide: DbService,
          useValue: { db: mockDbClient }, // 타입 문제가 해결된 모의 DB 클라이언트 사용
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentSessionService>(PaymentSessionService);
    dbService = module.get<DbService<any>>(DbService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // 각 테스트가 독립적으로 실행되도록 모든 모의 함수 상태를 초기화
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('결제 세션을 찾았을 경우 해당 세션을 반환해야 합니다', async () => {
      // Arrange
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession);

      // Act
      const result = await service.findById(mockPaymentSession.id);

      // Assert
      expect(result).toEqual(mockPaymentSession);
      expect(mockDbClient.query.paymentSessions.findFirst).toHaveBeenCalled();
    });

    it('결제 세션을 찾지 못했을 경우 null을 반환해야 합니다', async () => {
      // Arrange
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.findById('non_existent_id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const createDto = {
      userId: 'user_abc',
      amount: 1500,
      currency: 'KRW',

      metadata: { orderId: 'order_987' },
      expiresInMinutes: 60,
    };

    it('새로운 결제 세션을 생성하고 반환해야 합니다', async () => {
      // Arrange
      jest.spyOn(service, 'findByPlatformReference').mockResolvedValue(null); // 중복 없음
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(null); // 중복 없음
      (mockTx.returning as jest.Mock).mockResolvedValue([mockPaymentSession]); // 생성 결과
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession); // 최종 조회 결과

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result).toEqual(mockPaymentSession);
      expect(mockDbClient.transaction).toHaveBeenCalled();
      expect(mockTx.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: createDto.userId,
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment-session.created',
        expect.objectContaining({
          paymentSessionId: mockPaymentSession.id,
        }),
      );
    });

    it('동일한 platformReferenceId를 가진 세션이 이미 존재할 경우 BadRequestException을 던져야 합니다', async () => {
      // Arrange
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession);

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    const sessionId = mockPaymentSession.id;

    it('유효한 상태 변경일 경우, 상태를 업데이트하고 이벤트를 발생시켜야 합니다', async () => {
      // Arrange
      const pendingSession = { ...mockPaymentSession, status: 'PENDING' as PaymentSessionStatus };
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(pendingSession); // 트랜잭션 내 조회
      const updatedSession = { ...mockPaymentSession, status: 'AUTHORIZED' as PaymentSessionStatus };
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(updatedSession); // 최종 조회

      // Act
      const result = await service.updateStatus(sessionId, 'AUTHORIZED');

      // Assert
      expect(result.status).toBe('AUTHORIZED');
      expect(mockDbClient.transaction).toHaveBeenCalled();
      expect(mockTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'AUTHORIZED',
          authorizedAt: expect.any(Date),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment-session.status-updated',
        expect.objectContaining({
          paymentSessionId: sessionId,
          newStatus: 'AUTHORIZED',
          oldStatus: 'PENDING',
        }),
      );
    });

    it('세션이 존재하지 않을 경우 NotFoundException을 던져야 합니다', async () => {
      // Arrange
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(service.updateStatus('non_existent_id', 'AUTHORIZED')).rejects.toThrow(NotFoundException);
    });

    it('유효하지 않은 상태 변경일 경우 BadRequestException을 던져야 합니다', async () => {
      // Arrange
      mockTx.query.paymentSessions.findFirst.mockResolvedValue({
        ...mockPaymentSession,
        status: 'CAPTURED', // 이미 CAPTURED 상태
      });

      // Act & Assert
      await expect(service.updateStatus(sessionId, 'AUTHORIZED')).rejects.toThrow(BadRequestException);
    });
  });
});
