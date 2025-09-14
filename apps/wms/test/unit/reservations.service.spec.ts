import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationsService } from '../../src/order/shared/services/reservations.service';
import { AvailabilityService } from '../../src/order/shared/services/availability.service';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let mockDb: any;
  let mockAvailabilityService: any;
  let mockTx: any;

  beforeEach(async () => {
    // Mock 데이터베이스 서비스
    mockDb = {
      db: {
        transaction: jest.fn(),
        query: {
          fulfillmentOrderLines: {
            findFirst: jest.fn(),
          },
          fulfillmentOrders: {
            findFirst: jest.fn(),
          },
          salesOrderLines: {
            findMany: jest.fn(),
          },
          salesVariantPolicies: {
            findFirst: jest.fn(),
          },
          stockSummary: {
            findFirst: jest.fn(),
          },
          stockReservations: {
            findFirst: jest.fn(),
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
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnThis() }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn(),
          }),
        }),
      }),
    };

    // Mock AvailabilityService
    mockAvailabilityService = {
      getAvailableQuantity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        {
          provide: DbService,
          useValue: mockDb,
        },
        {
          provide: AvailabilityService,
          useValue: mockAvailabilityService,
        },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
  });

  describe('reserveWithOptimisticLocking', () => {
    const mockDto = {
      fulfillmentOrderLineId: 'test-fol-id',
      quantity: 10,
    };

    const mockFol = {
      id: 'test-fol-id',
      fulfillmentOrderId: 'test-fo-id',
      skuId: 'test-sku-id',
      quantity: 20,
      reservedQty: 0,
    };

    const mockFo = {
      id: 'test-fo-id',
      warehouseId: 'test-warehouse-id',
      salesOrderId: 'test-so-id',
    };

    const mockStockSummary = {
      id: 'test-summary-id',
      availableQuantity: 15,
      reservedQuantity: 5,
      version: 1,
    };

    beforeEach(() => {
      // 기본 Mock 설정
      mockTx.query.fulfillmentOrderLines.findFirst.mockResolvedValue(mockFol);
      mockTx.query.fulfillmentOrders.findFirst.mockResolvedValue(mockFo);
      mockTx.query.salesOrderLines.findMany.mockResolvedValue([]);
      mockTx.query.stockSummary.findFirst.mockResolvedValue(mockStockSummary);
      mockTx.insert().values.mockResolvedValue(undefined);
      mockTx.update().set().where().returning.mockResolvedValue([mockStockSummary]);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('정상적인 예약 시나리오', async () => {
      const result = await service.reserveWithOptimisticLocking(mockDto);

      expect(result).toEqual({ ok: true, reservedQuantity: 10 });

      // stockSummary 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.stockSummary);

      // 예약 레코드 생성 확인
      expect(mockTx.insert).toHaveBeenCalledWith(wmsTables.stockReservations);

      // FOL 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.fulfillmentOrderLines);
    });

    it('재고 부족 시 에러 발생', async () => {
      // 가용 재고를 요청 수량보다 적게 설정
      mockTx.query.stockSummary.findFirst.mockResolvedValue({
        ...mockStockSummary,
        availableQuantity: 5, // 요청량 10보다 적음
      });

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('낙관적 잠금 충돌 시 재시도 후 성공', async () => {
      let attemptCount = 0;
      mockTx.update().set().where().returning.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          // 첫 번째 시도는 실패 (버전 충돌)
          return Promise.resolve([]);
        } else {
          // 두 번째 시도는 성공
          return Promise.resolve([mockStockSummary]);
        }
      });

      const result = await service.reserveWithOptimisticLocking(mockDto);

      expect(result).toEqual({ ok: true, reservedQuantity: 10 });
      expect(attemptCount).toBe(2); // 재시도가 발생했는지 확인
    });

    it('최대 재시도 횟수 초과 시 ConflictException 발생', async () => {
      // 항상 실패하도록 설정 (버전 충돌)
      mockTx.update().set().where().returning.mockResolvedValue([]);

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        ConflictException
      );
    });

    it('Drop-ship 모드에서 예약 금지', async () => {
      // Drop-ship 정책 설정
      mockTx.query.salesOrderLines.findMany.mockResolvedValue([
        { variantId: 'variant-1' },
      ]);
      mockDb.db.query.salesVariantPolicies.findFirst.mockResolvedValue({
        fulfillmentMode: 'drop_ship',
      });

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        'RESERVATION_NOT_ALLOWED_FOR_DROP_SHIP'
      );
    });

    it('FOL이 존재하지 않을 때 BadRequestException 발생', async () => {
      mockTx.query.fulfillmentOrderLines.findFirst.mockResolvedValue(null);

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('창고 정보가 없을 때 BadRequestException 발생', async () => {
      mockTx.query.fulfillmentOrders.findFirst.mockResolvedValue({
        ...mockFo,
        warehouseId: null,
      });

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('StockSummary가 존재하지 않을 때 BadRequestException 발생', async () => {
      mockTx.query.stockSummary.findFirst.mockResolvedValue(null);

      await expect(service.reserveWithOptimisticLocking(mockDto)).rejects.toThrow(
        'No stock summary found for SKU'
      );
    });
  });

  describe('unreserve', () => {
    const mockDto = {
      fulfillmentOrderLineId: 'test-fol-id',
      quantity: 5,
    };

    const mockFol = {
      id: 'test-fol-id',
      fulfillmentOrderId: 'test-fo-id',
      reservedQty: 10,
    };

    const mockExistingReservation = {
      reservationId: 'test-reservation-id',
      quantity: 10,
    };

    beforeEach(() => {
      mockTx.query.fulfillmentOrderLines.findFirst.mockResolvedValue(mockFol);
      mockTx.query.fulfillmentOrders.findFirst.mockResolvedValue({
        salesOrderId: 'test-so-id',
      });
      mockTx.query.salesOrderLines.findMany.mockResolvedValue([]);
      mockTx.query.stockReservations.findFirst.mockResolvedValue(mockExistingReservation);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('정상적인 예약 해제', async () => {
      const result = await service.unreserve(mockDto);

      expect(result).toEqual({ ok: true });

      // 예약 수량 감소 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.stockReservations);

      // FOL 예약 수량 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.fulfillmentOrderLines);
    });

    it('전체 예약 수량 해제 시 상태를 released로 변경', async () => {
      const dto = {
        fulfillmentOrderLineId: 'test-fol-id',
        quantity: 10, // 전체 예약 수량과 동일
      };

      await service.unreserve(dto);

      // 상태를 released로 변경하는지 확인
      expect(mockTx.update().set).toHaveBeenCalledWith({ status: 'released' });
    });

    it('Drop-ship 모드에서는 no-op으로 처리', async () => {
      mockTx.query.salesOrderLines.findMany.mockResolvedValue([
        { variantId: 'variant-1' },
      ]);
      mockDb.db.query.salesVariantPolicies.findFirst.mockResolvedValue({
        fulfillmentMode: 'drop_ship',
      });

      const result = await service.unreserve(mockDto);

      expect(result).toEqual({ ok: true });
      // Drop-ship에서는 실제 해제 작업이 수행되지 않음
      expect(mockTx.update).not.toHaveBeenCalled();
    });
  });

  describe('transferReservation', () => {
    const mockDto = {
      fromFulfillmentOrderLineId: 'from-fol-id',
      toFulfillmentOrderLineId: 'to-fol-id',
      quantity: 5,
    };

    const mockFromFol = {
      id: 'from-fol-id',
      skuId: 'test-sku-id',
      reservedQty: 10,
    };

    const mockToFol = {
      id: 'to-fol-id',
      skuId: 'test-sku-id',
      reservedQty: 0,
    };

    const mockSourceReservation = {
      reservationId: 'source-reservation-id',
      quantity: 10,
    };

    beforeEach(() => {
      mockTx.query.fulfillmentOrderLines.findFirst
        .mockResolvedValueOnce(mockFromFol)
        .mockResolvedValueOnce(mockToFol);
      mockTx.query.stockReservations.findFirst.mockResolvedValue(mockSourceReservation);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('정상적인 예약 이관', async () => {
      const result = await service.transferReservation(mockDto);

      expect(result).toEqual({ ok: true });

      // 소스 예약 감소 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.stockReservations);

      // 대상 예약 생성 확인
      expect(mockTx.insert).toHaveBeenCalledWith(wmsTables.stockReservations);

      // FOL 업데이트 확인
      expect(mockTx.update).toHaveBeenCalledWith(wmsTables.fulfillmentOrderLines);
    });

    it('SKU 불일치 시 BadRequestException 발생', async () => {
      mockTx.query.fulfillmentOrderLines.findFirst
        .mockResolvedValueOnce(mockFromFol)
        .mockResolvedValueOnce({
          ...mockToFol,
          skuId: 'different-sku-id',
        });

      await expect(service.transferReservation(mockDto)).rejects.toThrow(
        'SKU mismatch'
      );
    });

    it('예약 수량 부족 시 BadRequestException 발생', async () => {
      mockTx.query.stockReservations.findFirst.mockResolvedValue({
        ...mockSourceReservation,
        quantity: 3, // 요청량 5보다 적음
      });

      await expect(service.transferReservation(mockDto)).rejects.toThrow(
        'Insufficient reserved'
      );
    });
  });
});