import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductMatchingService } from '../../src/inventory/services/product-matching.service';
import { InventoryService } from '../../src/inventory/services/inventory.service';
import { StockEventService } from '../../src/inventory/services/stock-event.service';
import { DbService } from '@app/db';

describe('ProductMatchingService', () => {
  let service: ProductMatchingService;
  let mockDb: any;
  let mockInventoryService: any;
  let mockStockEventService: any;
  let mockTx: any;

  beforeEach(async () => {
    // Mock 데이터베이스 서비스
    mockDb = {
      db: {
        transaction: jest.fn(),
        query: {
          productMatchings: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
          },
          productVariantSkuLinks: {
            findMany: jest.fn(),
          },
        },
        insert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
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
          where: jest.fn().mockReturnValue({
            returning: jest.fn(),
          }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn(),
      }),
    };

    // Mock 서비스들
    mockInventoryService = {
      getDefaultWarehouseId: jest.fn().mockReturnValue('default-warehouse-id'),
      _createSkuInternal: jest.fn(),
    };

    mockStockEventService = {
      createStockEntry: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductMatchingService,
        {
          provide: DbService,
          useValue: mockDb,
        },
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
        {
          provide: StockEventService,
          useValue: mockStockEventService,
        },
      ],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
  });

  describe('handleManualMatchingRequest', () => {
    const mockPayload = {
      productId: 'product-123',
      name: 'Test Product',
      variants: [
        {
          id: 'variant-1',
          name: 'Red Color',
          inventoryManagement: true,
          components: [{ skuName: 'Red Product Component' }],
        },
        {
          id: 'variant-2',
          name: 'Blue Color',
          inventoryManagement: true,
          components: [{ skuName: 'Blue Product Component' }],
        },
      ],
    };

    const mockNewMatching = {
      id: 'matching-id-1',
      variantId: 'variant-1',
      status: 'pending',
    };

    beforeEach(() => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(null);
      mockTx.insert().values().returning.mockResolvedValue([mockNewMatching]);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('정상적인 수동 매칭 요청 처리', async () => {
      const result = await service.handleManualMatchingRequest(mockPayload);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        variantId: 'variant-1',
        status: 'created',
      });
      expect(result[1]).toEqual({
        variantId: 'variant-2',
        status: 'created',
      });

      // 매칭 엔트리 생성 확인
      expect(mockTx.insert).toHaveBeenCalledTimes(2);
    });

    it('잘못된 페이로드 시 BadRequestException 발생', async () => {
      const invalidPayload = {
        productId: null,
        variants: null,
      };

      await expect(service.handleManualMatchingRequest(invalidPayload as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('variant ID가 없는 경우 에러로 처리', async () => {
      const payloadWithInvalidVariant = {
        ...mockPayload,
        variants: [
          {
            name: 'No ID Variant',
            inventoryManagement: true,
            components: [{ skuName: 'Component' }],
          },
        ],
      };

      const result = await service.handleManualMatchingRequest(payloadWithInvalidVariant);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        variantId: 'unknown',
        status: 'error',
        error: 'Variant ID is required',
      });
    });

    it('이미 존재하는 매칭은 스킵', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValueOnce({
        id: 'existing-matching',
        variantId: 'variant-1',
      });

      const result = await service.handleManualMatchingRequest(mockPayload);

      expect(result[0]).toEqual({
        variantId: 'variant-1',
        status: 'exists',
      });

      // 첫 번째는 스킵되고 두 번째만 생성
      expect(mockTx.insert).toHaveBeenCalledTimes(1);
    });

    it('일부 variant 처리 실패 시에도 계속 진행', async () => {
      mockTx.insert().values().returning
        .mockResolvedValueOnce([mockNewMatching])
        .mockRejectedValueOnce(new Error('Database error'));

      const result = await service.handleManualMatchingRequest(mockPayload);

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('created');
      expect(result[1].status).toBe('error');
      expect(result[1].error).toBe('Database error');
    });
  });

  describe('handleAutomaticMatchingRequest', () => {
    const mockPayload = {
      productId: 'product-123',
      name: 'Test Product',
      variants: [
        {
          id: 'variant-1',
          name: 'Physical Product',
          inventoryManagement: true,
          components: [
            { skuName: 'Component 1' },
            { skuName: 'Component 2' },
          ],
        },
        {
          id: 'variant-2',
          name: 'Digital Product',
          inventoryManagement: false,
          components: [],
        },
      ],
    };

    const mockNewMatching = {
      id: 'matching-id-1',
      variantId: 'variant-1',
      status: 'matched',
    };

    const mockNewStock = {
      skuId: 'new-sku-id',
    };

    beforeEach(() => {
      mockTx.insert().values().returning.mockResolvedValue([mockNewMatching]);
      mockStockEventService.createStockEntry.mockResolvedValue(mockNewStock);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('물리적 상품의 자동 매칭', async () => {
      await service.handleAutomaticMatchingRequest(mockPayload);

      // 물리적 상품은 매칭 생성
      expect(mockTx.insert).toHaveBeenCalledWith(expect.any(Object));

      // SKU 컴포넌트 개수만큼 재고 엔트리 생성
      expect(mockStockEventService.createStockEntry).toHaveBeenCalledTimes(2);

      // 매칭 상태 확인
      expect(mockTx.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'matched',
          strategy: 'variant',
          inventoryManagement: true,
        })
      );
    });

    it('디지털 상품은 무시 처리', async () => {
      const digitalOnlyPayload = {
        ...mockPayload,
        variants: [mockPayload.variants[1]], // 디지털 상품만
      };

      await service.handleAutomaticMatchingRequest(digitalOnlyPayload);

      // 디지털 상품은 ignored 상태로 생성
      expect(mockTx.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ignored',
          strategy: 'void',
          inventoryManagement: false,
          preStockSellable: true,
        })
      );

      // 재고 엔트리는 생성하지 않음
      expect(mockStockEventService.createStockEntry).not.toHaveBeenCalled();
    });
  });

  describe('resolveMatchingPending', () => {
    const mockMatchingId = 'matching-id-123';
    const mockPendingMatching = {
      id: mockMatchingId,
      variantId: 'variant-1',
      isResolved: false,
    };

    const mockResolveDto = {
      skuIds: ['sku-1', 'sku-2'],
      strategy: 'variant',
      stockPolicy: {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      },
      isGift: false,
    };

    beforeEach(() => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(mockPendingMatching);
      mockTx.update().set().where().returning.mockResolvedValue([{
        ...mockPendingMatching,
        status: 'matched',
        isResolved: true,
      }]);
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));

      // Strategy mock 설정
      const mockStrategy = {
        validate: jest.fn().mockResolvedValue(true),
        create: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).strategies.set('variant', mockStrategy);
    });

    it('정상적인 매칭 해결', async () => {
      const result = await service.resolveMatchingPending(mockMatchingId, mockResolveDto);

      expect(result.status).toBe('matched');
      expect(result.isResolved).toBe(true);

      // 매칭 전략 검증 및 생성 확인
      const strategy = (service as any).strategies.get('variant');
      expect(strategy.validate).toHaveBeenCalled();
      expect(strategy.create).toHaveBeenCalled();

      // 매칭 업데이트 확인
      expect(mockTx.update().set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'matched',
          strategy: 'variant',
          isResolved: true,
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,
          isGift: false,
        })
      );
    });

    it('무시 옵션으로 해결', async () => {
      const ignoreDto = {
        ignore: true,
        strategy: 'void',
      };

      const result = await service.resolveMatchingPending(mockMatchingId, ignoreDto);

      expect(mockTx.update().set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ignored',
          strategy: 'void',
          isResolved: true,
          inventoryManagement: false,
          preStockSellable: true,
        })
      );
    });

    it('존재하지 않는 매칭 ID 시 NotFoundException', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveMatchingPending(mockMatchingId, mockResolveDto)
      ).rejects.toThrow(NotFoundException);
    });

    it('이미 해결된 매칭 시 NotFoundException', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue({
        ...mockPendingMatching,
        isResolved: true,
      });

      await expect(
        service.resolveMatchingPending(mockMatchingId, mockResolveDto)
      ).rejects.toThrow(NotFoundException);
    });

    it('잘못된 전략 검증 시 BadRequestException', async () => {
      const mockStrategy = {
        validate: jest.fn().mockResolvedValue(false),
        create: jest.fn(),
      };
      (service as any).strategies.set('variant', mockStrategy);

      await expect(
        service.resolveMatchingPending(mockMatchingId, mockResolveDto)
      ).rejects.toThrow(BadRequestException);
    });

    it('skuMappings로도 해결 가능', async () => {
      const dtoWithMappings = {
        skuMappings: [
          { skuId: 'sku-1', quantity: 1 },
          { skuId: 'sku-2', quantity: 2 },
        ],
        strategy: 'variant',
      };

      await service.resolveMatchingPending(mockMatchingId, dtoWithMappings);

      const strategy = (service as any).strategies.get('variant');
      expect(strategy.validate).toHaveBeenCalledWith(
        expect.any(Object),
        [
          { skuId: 'sku-1', quantity: 1 },
          { skuId: 'sku-2', quantity: 2 },
        ]
      );
    });

    it('SKU 매핑 정보가 없으면 BadRequestException', async () => {
      const emptyDto = {
        strategy: 'variant',
      };

      await expect(
        service.resolveMatchingPending(mockMatchingId, emptyDto)
      ).rejects.toThrow('매칭할 SKU 정보를 제공하거나, 무시 옵션을 선택해야 합니다.');
    });
  });

  describe('handleVariantDeletion', () => {
    const mockVariantId = 'variant-to-delete';
    const mockMatching = {
      id: 'matching-id',
      variantId: mockVariantId,
      status: 'matched',
      strategy: 'variant',
    };

    beforeEach(() => {
      mockDb.db.transaction.mockImplementation((fn) => fn(mockTx));
    });

    it('매칭된 variant 삭제', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(mockMatching);

      // Strategy mock
      const mockStrategy = {
        delete: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).strategies.set('variant', mockStrategy);

      await service.handleVariantDeletion(mockVariantId);

      // 전략의 delete 메소드 호출 확인
      expect(mockStrategy.delete).toHaveBeenCalled();

      // 매칭 삭제 확인
      expect(mockTx.delete).toHaveBeenCalledWith(expect.any(Object));
    });

    it('매칭이 없는 variant 삭제 시 경고만 로그', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(null);

      await service.handleVariantDeletion(mockVariantId);

      // 삭제 작업이 수행되지 않음
      expect(mockTx.delete).not.toHaveBeenCalled();
    });

    it('pending 상태의 매칭은 단순 삭제', async () => {
      const pendingMatching = {
        ...mockMatching,
        status: 'pending',
        strategy: null,
      };
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(pendingMatching);

      await service.handleVariantDeletion(mockVariantId);

      // 전략 delete는 호출되지 않고 매칭만 삭제
      expect(mockTx.delete).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('getSkusForVariant', () => {
    const mockVariantId = 'variant-1';
    const mockMatching = {
      id: 'matching-id',
      variantId: mockVariantId,
      status: 'matched',
      strategy: 'variant',
    };

    beforeEach(() => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(mockMatching);
    });

    it('정상적인 SKU 매핑 조회', async () => {
      const expectedMappings = [
        { skuId: 'sku-1', quantity: 1 },
        { skuId: 'sku-2', quantity: 2 },
      ];

      const mockStrategy = {
        lookup: jest.fn().mockResolvedValue(expectedMappings),
      };
      (service as any).strategies.set('variant', mockStrategy);

      const result = await service.getSkusForVariant(mockVariantId);

      expect(result).toEqual(expectedMappings);
      expect(mockStrategy.lookup).toHaveBeenCalledWith({
        variantId: mockVariantId,
        productMatchingId: mockMatching.id,
        optionData: undefined,
      });
    });

    it('옵션 데이터와 함께 조회', async () => {
      const selectedOptions = [
        { optionName: 'color', optionValue: 'red' },
        { optionName: 'size', optionValue: 'L' },
      ];

      const mockStrategy = {
        lookup: jest.fn().mockResolvedValue([]),
      };
      (service as any).strategies.set('variant', mockStrategy);

      await service.getSkusForVariant(mockVariantId, selectedOptions);

      expect(mockStrategy.lookup).toHaveBeenCalledWith({
        variantId: mockVariantId,
        productMatchingId: mockMatching.id,
        optionData: selectedOptions,
      });
    });

    it('매칭되지 않은 variant 시 NotFoundException', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue(null);

      await expect(service.getSkusForVariant(mockVariantId)).rejects.toThrow(
        NotFoundException
      );
    });

    it('전략이 없는 매칭 시 NotFoundException', async () => {
      mockDb.db.query.productMatchings.findFirst.mockResolvedValue({
        ...mockMatching,
        strategy: null,
      });

      await expect(service.getSkusForVariant(mockVariantId)).rejects.toThrow(
        NotFoundException
      );
    });
  });
});