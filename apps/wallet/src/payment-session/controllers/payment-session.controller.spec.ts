import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DbService } from '@app/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentSession, PaymentSessionStatus, PlatformType } from '../types';
import { PaymentSessionService } from '../services';

// Mocks
// We define a mock for the Drizzle transaction client. This allows us to control
// the behavior of database operations within a transaction for each test.
const mockTx = {
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

// We define a mock for the main Drizzle database client.
const mockDbClient = {
  query: {
    paymentSessions: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
  // The transaction method is mocked to immediately execute the callback,
  // passing our mocked transaction client 'mockTx'. This simplifies testing
  // methods that use transactions without needing to mock the transaction
  // logic in every single test.
  transaction: jest.fn().mockImplementation(async (callback) => callback(mockTx)),
};

describe('PaymentSessionService', () => {
  let service: PaymentSessionService;
  let dbService: DbService<any>;
  let eventEmitter: EventEmitter2;

  // A consistent mock payment session for use in tests.
  const mockPaymentSession: PaymentSession = {
    id: 'ps_123456789',
    userId: 'user_abc',
    amount: 1500,
    currency: 'KRW',
    status: 'PENDING',
    platform: 'TOSS',
    platformReferenceId: 'toss_ref_xyz',
    metadata: JSON.stringify({ orderId: 'order_987' }),
    expiresAt: new Date(Date.now() + 3600 * 1000), // Expires in 1 hour
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
          // Use the mocked DB client.
          useValue: { db: mockDbClient },
        },
        {
          provide: EventEmitter2,
          // Mock the event emitter.
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentSessionService>(PaymentSessionService);
    dbService = module.get<DbService<any>>(DbService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Reset all mock function states before each test to ensure isolation.
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return a payment session if found', async () => {
      // Arrange: Mock the DB to return our sample session.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession);

      // Act: Call the method.
      const result = await service.findById(mockPaymentSession.id);

      // Assert: Check that the correct session is returned and the DB was called properly.
      expect(result).toEqual(mockPaymentSession);
      expect(mockDbClient.query.paymentSessions.findFirst).toHaveBeenCalled();
    });

    it('should return null if the payment session does not exist', async () => {
      // Arrange: Mock the DB to return null.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(null);

      // Act: Call the method with a non-existent ID.
      const result = await service.findById('non_existent_id');

      // Assert: Check that the result is null.
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const createDto = {
      userId: 'user_abc',
      amount: 1500,
      currency: 'KRW',
      platform: 'TOSS' as PlatformType,
      platformReferenceId: 'toss_ref_xyz',
      metadata: { orderId: 'order_987' },
      expiresInMinutes: 60,
    };

    it('should create and return a new payment session', async () => {
      // Arrange:
      // 0. Mock findByPlatformReference to return null (no duplicate)
      jest.spyOn(service, 'findByPlatformReference').mockResolvedValue(null);
      // 1. First `findFirst` call (duplicate check) should find nothing.
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(null);
      // 2. The `insert` operation should return the new session.
      (mockTx.returning as jest.Mock).mockResolvedValue([mockPaymentSession]);
      // 3. The final `findById` call should return the created session.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession);

      // Act: Call the create method.
      const result = await service.create(createDto);

      // Assert:
      // 1. The result should match the mock session.
      expect(result).toEqual(mockPaymentSession);
      // 2. The transaction should have been used.
      expect(mockDbClient.transaction).toHaveBeenCalled();
      // 3. The insert method within the transaction should have been called with the correct data.
      expect(mockTx.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: createDto.userId,
          platform: createDto.platform,
          platformReferenceId: createDto.platformReferenceId,
        }),
      );
      // 4. A 'created' event should have been emitted.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment-session.created',
        expect.objectContaining({
          paymentSessionId: mockPaymentSession.id,
          userId: createDto.userId,
        }),
      );
    });

    it('should throw BadRequestException if a session with the same platform reference already exists', async () => {
      // Arrange: Mock the duplicate check to find an existing session.
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(mockPaymentSession);

      // Act & Assert: Expect the create call to fail with a BadRequestException.
      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    const sessionId = mockPaymentSession.id;

    it('should update the status and emit an event for a valid transition', async () => {
      // Arrange:
      // 1. The transaction's `findFirst` should return the session in its 'PENDING' state.
      const pendingSession = { ...mockPaymentSession, status: 'PENDING' as PaymentSessionStatus };
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(pendingSession);
      // 2. The final `findById` call should return the updated session.
      const updatedSession = { ...mockPaymentSession, status: 'AUTHORIZED' as PaymentSessionStatus };
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(updatedSession);

      // Act: Update the status to 'AUTHORIZED'.
      const result = await service.updateStatus(sessionId, 'AUTHORIZED');

      // Assert:
      // 1. The result should reflect the new status.
      expect(result.status).toBe('AUTHORIZED');
      // 2. The transaction should have been used.
      expect(mockDbClient.transaction).toHaveBeenCalled();
      // 3. The `update` call within the transaction should have been made.
      expect(mockTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'AUTHORIZED',
          authorizedAt: expect.any(Date),
        }),
      );
      // 4. A 'status-updated' event should have been emitted.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment-session.status-updated',
        expect.objectContaining({
          paymentSessionId: sessionId,
          newStatus: 'AUTHORIZED',
          oldStatus: 'PENDING',
        }),
      );
    });

    it('should throw NotFoundException if the session does not exist', async () => {
      // Arrange: Mock the DB to find no session within the transaction.
      mockTx.query.paymentSessions.findFirst.mockResolvedValue(null);

      // Act & Assert: Expect the call to fail with NotFoundException.
      await expect(service.updateStatus('non_existent_id', 'AUTHORIZED')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for an invalid status transition', async () => {
      // Arrange: Mock the DB to find a session that is already 'CAPTURED'.
      mockTx.query.paymentSessions.findFirst.mockResolvedValue({
        ...mockPaymentSession,
        status: 'CAPTURED',
      });

      // Act & Assert: Attempting to transition from 'CAPTURED' to 'AUTHORIZED' should fail.
      await expect(service.updateStatus(sessionId, 'AUTHORIZED')).rejects.toThrow(BadRequestException);
    });
  });

  describe('canTransitionTo', () => {
    it('should return true for a valid transition on a non-expired session', async () => {
      // Arrange: Session is 'PENDING' and not expired.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue({
        ...mockPaymentSession,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      // Act & Assert:
      const canTransition = await service.canTransitionTo(mockPaymentSession.id, 'AUTHORIZED');
      expect(canTransition).toBe(true);
    });

    it('should return false if the session is expired', async () => {
      // Arrange: Session is expired.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue({
        ...mockPaymentSession,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      // Act & Assert:
      const canTransition = await service.canTransitionTo(mockPaymentSession.id, 'AUTHORIZED');
      expect(canTransition).toBe(false);
    });

    it('should return false for an invalid status transition', async () => {
      // Arrange: Session is 'CAPTURED', transition to 'AUTHORIZED' is invalid.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue({
        ...mockPaymentSession,
        status: 'CAPTURED',
      });

      // Act & Assert:
      const canTransition = await service.canTransitionTo(mockPaymentSession.id, 'AUTHORIZED');
      expect(canTransition).toBe(false);
    });

    it('should return false if the session does not exist', async () => {
      // Arrange: Session is not found.
      mockDbClient.query.paymentSessions.findFirst.mockResolvedValue(null);

      // Act & Assert:
      const canTransition = await service.canTransitionTo('non_existent_id', 'AUTHORIZED');
      expect(canTransition).toBe(false);
    });
  });
});
