import axios, { AxiosInstance } from 'axios';
import { WMSStockResponse } from '../../types/wms.type';

export interface InventoryPolicy {
  inventoryManagement: boolean;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
}

export interface ProductStockStatus {
  isAvailable: boolean;
  availableQuantity: number;
  status: 'in_stock' | 'out_of_stock' | 'backorder' | 'always_available';
  message?: string;
}

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

  // 재고 조회 기본 메서드
  private async getStocks(skuId: string): Promise<WMSStockResponse[]> {
    try {
      const response = await this.client.get<WMSStockResponse[]>(
        '/wms/inventory/stocks',
        {
          params: {
            skuId,
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

  // 상품의 판매 가능 여부 확인
  async checkStockAvailability(
    skuId: string,
    policy: InventoryPolicy,
  ): Promise<ProductStockStatus> {
    if (!policy.inventoryManagement) {
      return {
        isAvailable: true,
        availableQuantity: 999999,
        status: 'always_available',
        message: '재고 관리 없음',
      };
    }

    try {
      const stocks = await this.getStocks(skuId);
      const availableQty = this.calculateTotalQuantity(stocks);

      if (availableQty > 0) {
        return {
          isAvailable: true,
          availableQuantity: availableQty,
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

      if (policy.preStockSellable) {
        // TODO: 입고 예정 수량 확인 로직 추가 필요
        const hasIncomingStock = false; // 임시
        if (hasIncomingStock) {
          return {
            isAvailable: true,
            availableQuantity: 0,
            status: 'backorder',
            message: '입고 예정',
          };
        }
      }

      return {
        isAvailable: false,
        availableQuantity: 0,
        status: 'out_of_stock',
        message: '품절',
      };
    } catch (error) {
      console.error('재고 확인 중 오류 발생:', error);
      throw new Error('재고 확인에 실패했습니다.');
    }
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

  // 창고별 상세 재고 정보 조회
  async getWarehouseStock(
    skuId: string,
    warehouseId: string,
  ): Promise<{
    realQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    stockRows: WMSStockResponse['stockRows'];
  }> {
    const stocks = await this.getStocks(skuId);
    const warehouseStock = stocks.find(
      (stock) => stock.warehouseId === warehouseId,
    );

    if (!warehouseStock) {
      return {
        realQuantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        stockRows: [],
      };
    }

    return {
      realQuantity: warehouseStock.realQuantity,
      reservedQuantity: warehouseStock.reservedQuantity,
      availableQuantity: warehouseStock.availableQuantity,
      stockRows: warehouseStock.stockRows,
    };
  }
}
