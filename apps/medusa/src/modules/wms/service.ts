import axios, { AxiosInstance } from 'axios';
import { SkuResponseDto } from '../../types/wms';

export class WmsModuleService {
  private client: AxiosInstance;

  constructor(private readonly baseUrl: string) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // SKU 정보 조회
  async getSkuById(skuId: string): Promise<SkuResponseDto> {
    try {
      const skuInfo = await this.client.get<SkuResponseDto>(
        `/wms/inventory/skus/${skuId}`,
      );

      return skuInfo.data;
    } catch (error) {
      console.error('SKU 정보 조회 중 오류 발생:', error);
      throw new Error('SKU 정보 조회에 실패했습니다.');
    }
  }

  // 재고 조회
  async getCurrentStock(params: {
    skuId: string;
  }): Promise<WMSStockResponse[]> {
    try {
      const response = await this.client.get<WMSStockResponse[]>(
        '/wms/inventory/stocks',
        {
          params: {
            skuId: params.skuId,
            stockType: 'physical',
          },
        },
      );

      return response.data;
    } catch (error) {
      console.error('WMS 재고 조회 중 오류 발생:', error);
      throw new Error('재고 조회에 실패했습니다.');
    }
  }

  // 3. 장바구니 추가 가능 여부 확인 - 새로운 통합 메서드
  async checkAvailableForCart(
    skuId: string,
    requestedQuantity: number,
  ): Promise<CheckAvailableForCartResult> {
    try {
      // 1. SKU 정보 조회
      const skuInfo = await this.getSkuById(skuId);

      // 2. 재고 관리 대상인지 확인
      if (!skuInfo.inventoryManagement) {
        return {
          canAddToCart: true,
          availableQuantity: 999999,
          skuInfo,
        };
      }

      // 3. 무재고 판매 가능 상품인지 확인
      if (skuInfo.alwaysSellableZeroStock) {
        return {
          canAddToCart: true,
          availableQuantity: 0,
          skuInfo,
        };
      }

      // 4. 실제 재고 확인
      const stocks = await this.getCurrentStock({ skuId });
      const totalAvailable = stocks.reduce(
        (sum, stock) => sum + (stock.availableQuantity || 0),
        0,
      );

      // 5. 재고가 없는 경우
      if (totalAvailable === 0) {
        if (skuInfo.preStockSellable) {
          return {
            canAddToCart: true,
            availableQuantity: 0,
            reason: '선판매 가능 상품',
            skuInfo,
          };
        }
        return {
          canAddToCart: false,
          availableQuantity: 0,
          reason: '재고가 없습니다',
          skuInfo,
        };
      }

      // 6. 요청 수량과 재고 수량 비교
      const canAdd = totalAvailable >= requestedQuantity;
      return {
        canAddToCart: canAdd,
        availableQuantity: totalAvailable,
        reason: canAdd
          ? undefined
          : `재고 부족 (가용: ${totalAvailable}, 요청: ${requestedQuantity})`,
        skuInfo,
      };
    } catch (error) {
      console.error('장바구니 추가 가능 여부 확인 중 오류 발생:', error);
      throw new Error('재고 확인에 실패했습니다.');
    }
  }

  // Helper 메서드들
  private calculateTotalQuantity(stocks: WMSStockResponse[]): number {
    return stocks.reduce(
      (sum, stock) => sum + (stock.availableQuantity || 0),
      0,
    );
  }

  private groupStocksBySku(
    stocks: WMSStockResponse[],
  ): Record<string, WMSStockResponse[]> {
    return stocks.reduce(
      (acc, stock) => {
        acc[stock.skuId] = acc[stock.skuId] || [];
        acc[stock.skuId].push(stock);
        return acc;
      },
      {} as Record<string, WMSStockResponse[]>,
    );
  }

  // 기존 메서드들 (하위 호환성을 위해 유지)
  private async getStocks(skuId: string): Promise<WMSStockResponse[]> {
    return this.getCurrentStock({ skuId });
  }

  async checkStockAvailability(
    skuId: string,
    policy: InventoryPolicy,
  ): Promise<ProductStockStatus> {
    const result = await this.checkAvailableForCart(skuId, 1);

    if (!policy.inventoryManagement) {
      return {
        isAvailable: true,
        availableQuantity: 999999,
        status: 'always_available',
        message: '재고 관리 없음',
      };
    }

    if (result.availableQuantity > 0) {
      return {
        isAvailable: true,
        availableQuantity: result.availableQuantity,
        status: 'in_stock',
        message: '재고 있음',
      };
    }

    if (policy.alwaysSellableZeroStock) {
      return {
        isAvailable: true,
        availableQuantity: 0,
        status: 'always_available',
        message: '재고 없음 - 주문 가능',
      };
    }

    if (policy.preStockSellable && result.canAddToCart) {
      return {
        isAvailable: true,
        availableQuantity: 0,
        status: 'backorder',
        message: '입고 예정',
      };
    }

    return {
      isAvailable: false,
      availableQuantity: 0,
      status: 'out_of_stock',
      message: '품절',
    };
  }

  // 여러 상품의 재고 상태 확인
  async checkBulkStockAvailability(
    items: Array<{
      skuId: string;
      policy: InventoryPolicy;
      quantity: number;
    }>,
  ): Promise<Record<string, ProductStockStatus & { canAddToCart: boolean }>> {
    try {
      const skuIds = items.map((item) => item.skuId);
      const response = await this.client.get<WMSStockResponse[]>(
        '/wms/inventory/stocks',
        {
          params: {
            skuIds: skuIds.join(','),
            stockType: 'physical',
          },
        },
      );

      const stocksBySku = this.groupStocksBySku(response.data);
      const result: Record<
        string,
        ProductStockStatus & { canAddToCart: boolean }
      > = {};

      for (const item of items) {
        const stocks = stocksBySku[item.skuId] || [];
        const availableQty = this.calculateTotalQuantity(stocks);

        const status = await this.checkStockAvailability(
          item.skuId,
          item.policy,
        );

        result[item.skuId] = {
          ...status,
          canAddToCart:
            status.isAvailable &&
            (!item.policy.inventoryManagement ||
              availableQty >= item.quantity ||
              item.policy.alwaysSellableZeroStock ||
              (item.policy.preStockSellable && status.status === 'backorder')),
        };
      }

      return result;
    } catch (error) {
      console.error('대량 재고 확인 중 오류 발생:', error);
      throw new Error('대량 재고 확인에 실패했습니다.');
    }
  }

  // 장바구니 추가 가능 여부 확인
  async canAddToCart(
    skuId: string,
    quantity: number,
    policy: InventoryPolicy,
  ): Promise<{
    canAdd: boolean;
    reason?: string;
    availableQuantity: number;
  }> {
    const status = await this.checkStockAvailability(skuId, policy);

    if (!status.isAvailable) {
      return {
        canAdd: false,
        reason: status.message,
        availableQuantity: 0,
      };
    }

    if (!policy.inventoryManagement || policy.alwaysSellableZeroStock) {
      return {
        canAdd: true,
        availableQuantity: status.availableQuantity,
      };
    }

    if (status.availableQuantity < quantity) {
      return {
        canAdd: false,
        reason: `요청 수량(${quantity})이 재고 수량(${status.availableQuantity})을 초과합니다.`,
        availableQuantity: status.availableQuantity,
      };
    }

    return {
      canAdd: true,
      availableQuantity: status.availableQuantity,
    };
  }
}
