import axios, { AxiosInstance } from 'axios';
import { GetStockResponse, Sku } from '../../types/wms';

type ModuleOptions = {
  apiKey: string;
};

export class WmsModuleService {
  private client: AxiosInstance;
  protected options_: ModuleOptions;

  constructor({}, options: ModuleOptions) {
    this.options_ = options || {
      apiKey: process.env.WMS_SERVICE_URL,
    };

    this.client = axios.create({
      baseURL: this.options_.apiKey,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // SKU 정보 조회
  async getSkuById(skuId: string): Promise<Sku> {
    try {
      const skuInfo = await this.client.get<Sku>(
        `/wms/inventory/skus/${skuId}`,
      );

      return skuInfo.data;
    } catch (error) {
      console.error('SKU 정보 조회 중 오류 발생:', error);
      throw new Error('SKU 정보 조회에 실패했습니다.');
    }
  }

  // 재고 조회
  async getCurrentStock(params: { skuId: string }): Promise<GetStockResponse> {
    try {
      const response = await this.client.get<GetStockResponse>(
        '/wms/inventory/stocks',
        {
          params: {
            skuId: params.skuId,
            stockType: 'physical',
          },
        },
      );

      console.log('재고조회:', response);

      return response.data;
    } catch (error) {
      console.error('WMS 재고 조회 중 오류 발생:', error);
      throw new Error('재고 조회에 실패했습니다.');
    }
  }

  async checkAvailableForCart(
    skuId: string,
    requestedQuantity: number,
  ): Promise<boolean> {
    // 1SKU 정보 조회
    const skuInfo = await this.getSkuById(skuId);

    // 재고 관리 대상인지 확인
    if (!skuInfo.inventoryManagement) {
      return true; // 재고 관리 안하는 상품은 수량 제한 없음
    }

    //  무재고 판매 가능 상품인지 확인
    if (skuInfo.alwaysSellableZeroStock) {
      return true; // 직배송/신상품 등 재고와 무관하게 판매 가능
    }

    // 실제 재고 확인
    const stocks = await this.getCurrentStock({ skuId });
    const totalAvailable = stocks.reduce(
      (sum, stock) => sum + stock.availableQuantity,
      0,
    );

    // 재고가 없는 경우
    if (totalAvailable === 0) {
      return skuInfo.preStockSellable; // 선판매 가능 여부에 따라 결정
    }

    // 요청 수량과 재고 수량 비교
    return totalAvailable >= requestedQuantity;
  }
}
