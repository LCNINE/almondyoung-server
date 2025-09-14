import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrdersService } from '../../src/order/sales-orders/services/sales-orders.service';
import { PoliciesService } from '../../src/order/shared/services/policies.service';
import { ReservationsService } from '../../src/order/shared/services/reservations.service';
import { AuditService } from '../../src/shared/services/audit.service';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let mockDb: any;
  let mockPoliciesService: any;
  let mockReservationsService: any;
  let mockAuditService: any;
  let mockTx: any;

  beforeEach(async () => {
    // Mock 데이터베이스 서비스
    mockDb = {
      db: {
        transaction: jest.fn(),
        query: {
          salesOrders: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
          },
          fulfillmentOrders: {
            findMany: jest.fn(),
          },
          fulfillmentOrderLines: {
            findMany: jest.fn(),
          },
        },
        insert: jest.fn(),
        update: jest.fn(),
      },
    };

    // Mock 트랜잭션
    mockTx = {
      query: mockDb.db.query,
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn(),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
        }),
      }),
    };

    // Mock 서비스들
    mockPoliciesService = {
      getVariantPolicy: jest.fn(),
    };

    mockReservationsService = {
      unreserve: jest.fn(),
    };

    mockAuditService = {
      logResourceChange: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        {
          provide: DbService,
          useValue: mockDb,
        },
        {
          provide: PoliciesService,
          useValue: mockPoliciesService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<SalesOrdersService>(SalesOrdersService);
  });

  describe('create', () => {
    const mockDto = {
      channelOrderId: 'CHANNEL-ORDER-123',
      salesChannel: 'medusa',
      customer: {
        name: '홍길동',
        email: 'hong@example.com',
        phone: '010-1234-5678',
      },
      shippingAddress: '서울시 강남구',
      totalAmount: 50000,
      shippingFee: 3000,
      lines: [
        {
          variantId: 'variant-1',
          quantity: 2,
          unitPrice: 20000,
          totalPrice: 40000,
        },
        {
          variantId: 'variant-2',
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000,
        },
      ],
    };

    const mockCreatedOrder = {
      id: 'test-order-id',
      channelOrderId: 'CHANNEL-ORDER-123',
      salesChannel: 'medusa',
      status: 'pending',
      customerName: '홍길동',
      totalAmount: 50000,
    };

    beforeEach(() => {
      mockTx.insert().values().returning.mockResolvedValue([mockCreatedOrder]);
      mockPoliciesService.getVariantPolicy.mockResolvedValue({
        inventoryManagement: true,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      });
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
      mockAuditService.logResourceChange.mockResolvedValue(undefined);
    });

    it('정상적인 주문 생성', async () => {
      const result = await service.create(mockDto);

      expect(result).toEqual(mockCreatedOrder);

      // 주문 헤더 생성 확인
      expect(mockTx.insert).toHaveBeenCalledWith(wmsTables.salesOrders);

      // 주문 라인 생성 확인
      expect(mockTx.insert).toHaveBeenCalledWith(wmsTables.salesOrderLines);

      // 감사 로그 확인
      expect(mockAuditService.logResourceChange).toHaveBeenCalledWith(
        'ORDER_CREATED',
        'create',
        'order',
        'salesOrder',
        mockCreatedOrder.id,
        expect.stringContaining('Sales Order'),
        null,
        expect.objectContaining({
          channelOrderId: 'CHANNEL-ORDER-123',
          salesChannel: 'medusa',
          customerName: '홍길동',
          totalAmount: 50000,
          lineCount: 2,
        }),
        undefined,
        mockTx
      );
    });

    it('라인이 없는 주문도 생성 가능', async () => {
      const dtoWithoutLines = { ...mockDto, lines: [] };

      const result = await service.create(dtoWithoutLines);

      expect(result).toEqual(mockCreatedOrder);
      expect(mockAuditService.logResourceChange).toHaveBeenCalledWith(
        'ORDER_CREATED',
        'create',
        'order',
        'salesOrder',
        mockCreatedOrder.id,
        expect.stringContaining('Sales Order'),
        null,
        expect.objectContaining({
          lineCount: 0,
        }),
        undefined,
        mockTx
      );
    });

    it('정책에 따른 제안 수량 설정', async () => {
      mockPoliciesService.getVariantPolicy
        .mockResolvedValueOnce({
          inventoryManagement: true,
          preStockSellable: true,
          alwaysSellableZeroStock: false,
        })
        .mockResolvedValueOnce({
          inventoryManagement: false,
          preStockSellable: false,
          alwaysSellableZeroStock: true,
        });

      await service.create(mockDto);

      const insertCall = mockTx.insert().values.mock.calls.find(
        call => call[0] && Array.isArray(call[0]) && call[0][0].suggestedQuantity !== undefined
      );

      expect(insertCall).toBeDefined();
      const lines = insertCall[0];

      // 첫 번째 라인: 정책상 접수 가능 → 제안 수량 = 요청 수량
      expect(lines[0].suggestedQuantity).toBe(2);

      // 두 번째 라인: 정책상 접수 가능 → 제안 수량 = 요청 수량
      expect(lines[1].suggestedQuantity).toBe(1);
    });
  });

  describe('cancel', () => {
    const mockOrderId = 'test-order-id';
    const mockSalesOrder = {
      id: mockOrderId,
      channelOrderId: 'CHANNEL-ORDER-123',
      status: 'pending',
    };

    const mockFulfillmentOrders = [
      {
        id: 'fo-1',
        status: 'ready',
      },
      {
        id: 'fo-2',
        status: 'created',
      },
    ];

    const mockFoLines = [
      {
        id: 'fol-1',
        fulfillmentOrderId: 'fo-1',
        reservedQty: 5,
      },
      {
        id: 'fol-2',
        fulfillmentOrderId: 'fo-1',
        reservedQty: 3,
      },
      {
        id: 'fol-3',
        fulfillmentOrderId: 'fo-2',
        reservedQty: 0,
      },
    ];

    beforeEach(() => {
      mockTx.query.salesOrders.findFirst.mockResolvedValue(mockSalesOrder);
      mockTx.query.fulfillmentOrders.findMany.mockResolvedValue(mockFulfillmentOrders);
      mockTx.query.fulfillmentOrderLines.findMany.mockResolvedValue(mockFoLines);
      mockReservationsService.unreserve.mockResolvedValue({ ok: true });
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
      mockAuditService.logResourceChange.mockResolvedValue(undefined);

      // getOne 메소드 mock
      jest.spyOn(service, 'getOne').mockResolvedValue({
        ...mockSalesOrder,
        status: 'cancelled',
      } as any);
    });

    it('정상적인 주문 취소', async () => {
      const result = await service.cancel(mockOrderId);

      expect(result.status).toBe('cancelled');

      // 예약 해제 호출 확인 (예약 수량이 있는 라인만)
      expect(mockReservationsService.unreserve).toHaveBeenCalledTimes(2);
      expect(mockReservationsService.unreserve).toHaveBeenCalledWith(
        { fulfillmentOrderLineId: 'fol-1', quantity: 5 },
        mockTx
      );
      expect(mockReservationsService.unreserve).toHaveBeenCalledWith(
        { fulfillmentOrderLineId: 'fol-2', quantity: 3 },
        mockTx
      );

      // FO 상태 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.fulfillmentOrders);

      // SO 상태 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.salesOrders);

      // 감사 로그 확인
      expect(mockAuditService.logResourceChange).toHaveBeenCalledWith(
        'ORDER_CANCELLED',
        'cancel',
        'order',
        'salesOrder',
        mockOrderId,
        expect.stringContaining('Sales Order'),
        { status: 'pending' },
        { status: 'cancelled' },
        undefined,
        mockTx
      );
    });

    it('존재하지 않는 주문 취소 시 에러 발생', async () => {
      mockTx.query.salesOrders.findFirst.mockResolvedValue(null);

      await expect(service.cancel(mockOrderId)).rejects.toThrow(
        'Sales order test-order-id not found'
      );
    });

    it('이미 취소된 주문은 그대로 반환', async () => {
      const cancelledOrder = { ...mockSalesOrder, status: 'cancelled' };
      mockTx.query.salesOrders.findFirst.mockResolvedValue(cancelledOrder);

      const result = await service.cancel(mockOrderId);

      expect(result).toEqual(cancelledOrder);

      // 취소 로직이 실행되지 않았는지 확인
      expect(mockTx.query.fulfillmentOrders.findMany).not.toHaveBeenCalled();
      expect(mockReservationsService.unreserve).not.toHaveBeenCalled();
    });

    it('예약 해제 실패 시에도 계속 진행', async () => {
      mockReservationsService.unreserve.mockRejectedValueOnce(
        new Error('Reservation release failed')
      );

      // 에러가 발생해도 전체 프로세스는 완료되어야 함
      const result = await service.cancel(mockOrderId);

      expect(result.status).toBe('cancelled');

      // 첫 번째 예약 해제는 실패하지만 두 번째는 시도됨
      expect(mockReservationsService.unreserve).toHaveBeenCalledTimes(2);

      // SO 상태는 여전히 업데이트됨
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.salesOrders);
    });

    it('이미 취소된 FO는 스킵', async () => {
      const ordersWithCancelledFo = [
        ...mockFulfillmentOrders,
        {
          id: 'fo-3',
          status: 'canceled',
        },
      ];

      mockTx.query.fulfillmentOrders.findMany.mockResolvedValue(ordersWithCancelledFo);

      await service.cancel(mockOrderId);

      // 취소되지 않은 FO만 처리됨 (fo-1, fo-2)
      expect(mockTx.query.fulfillmentOrderLines.findMany).toHaveBeenCalledTimes(2);
      expect(mockTx.query.fulfillmentOrderLines.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
      });
    });
  });

  describe('update', () => {
    const mockOrderId = 'test-order-id';
    const mockUpdateDto = {
      customer: {
        name: '김철수',
        email: 'kim@example.com',
        phone: '010-9876-5432',
      },
      shippingAddress: '부산시 해운대구',
      totalAmount: 60000,
      shippingFee: 5000,
    };

    const mockUpdatedOrder = {
      id: mockOrderId,
      customerName: '김철수',
      customerEmail: 'kim@example.com',
      customerPhone: '010-9876-5432',
      shippingAddress: '부산시 해운대구',
      totalAmount: 60000,
      shippingFee: 5000,
    };

    beforeEach(() => {
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
      jest.spyOn(service, 'getOne').mockResolvedValue(mockUpdatedOrder as any);
    });

    it('정상적인 주문 업데이트', async () => {
      const result = await service.update(mockOrderId, mockUpdateDto);

      expect(result).toEqual(mockUpdatedOrder);

      // 업데이트 쿼리 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.salesOrders);
      expect(mockTx.update().set).toHaveBeenCalledWith({
        customerName: '김철수',
        customerEmail: 'kim@example.com',
        customerPhone: '010-9876-5432',
        shippingAddress: '부산시 해운대구',
        totalAmount: 60000,
        shippingFee: 5000,
        processedAt: null,
      });
    });

    it('processedAt 필드도 업데이트 가능', async () => {
      const processedAt = '2024-01-15T10:30:00Z';
      const dtoWithProcessedAt = { ...mockUpdateDto, processedAt };

      await service.update(mockOrderId, dtoWithProcessedAt);

      expect(mockTx.update().set).toHaveBeenCalledWith(
        expect.objectContaining({
          processedAt: new Date(processedAt),
        })
      );
    });
  });

  describe('confirm', () => {
    const mockOrderId = 'test-order-id';
    const mockConfirmedOrder = {
      id: mockOrderId,
      status: 'confirmed',
      confirmedAt: expect.any(Date),
    };

    beforeEach(() => {
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
      jest.spyOn(service, 'getOne').mockResolvedValue(mockConfirmedOrder as any);
    });

    it('정상적인 주문 확정', async () => {
      const result = await service.confirm(mockOrderId);

      expect(result).toEqual(mockConfirmedOrder);

      // 상태 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.salesOrders);
      expect(mockTx.update().set).toHaveBeenCalledWith({
        status: 'confirmed',
        confirmedAt: expect.any(Date),
      });
    });
  });
});