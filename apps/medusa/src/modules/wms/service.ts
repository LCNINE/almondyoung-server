import { MedusaError } from '@medusajs/framework/utils';
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
      console.log('[WMS] SKU 조회 시작:', skuId);

      const skuInfo = await this.client.get<Sku>(
        `/wms/inventory/skus/${skuId}`,
      );

      console.log('[WMS] SKU 조회 성공:', skuInfo.data);
      return skuInfo.data;
    } catch (error) {
      // axios 에러인 경우
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            error.response.data?.message || `SKU(${skuId})를 찾을 수 없습니다.`,
          );
        }

        // 다른 HTTP 에러
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          error.response?.data?.message ||
            `WMS 오류: ${error.response?.status}`,
        );
      }

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        error?.message || '재고 확인 중 오류가 발생했습니다.',
      );
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
      return response.data;
    } catch (error: any) {
      const message =
        error?.response?.data?.message || '재고 조회에 실패했습니다.';
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message);
    }
  }

  async checkAvailableForCart(
    skuId: string,
    requestedQuantity: number,
  ): Promise<boolean> {
    try {
      console.log('[WMS] 재고 확인 시작:', { skuId, requestedQuantity });

      const skuInfo = await this.getSkuById(skuId);

      if (!skuInfo.inventoryManagement) {
        console.log('[WMS] 재고 관리 대상 아님');
        return true;
      }

      if (skuInfo.alwaysSellableZeroStock) {
        console.log('[WMS] 항상 판매 가능 설정됨');
        return true;
      }

      const stocks = await this.getCurrentStock({ skuId });
      const totalAvailable = stocks.reduce(
        (sum, stock) => sum + stock.availableQuantity,
        0,
      );

      console.log('[WMS] 재고 확인 결과:', {
        totalAvailable,
        requestedQuantity,
        preStockSellable: skuInfo.preStockSellable,
      });

      if (totalAvailable === 0) {
        return skuInfo.preStockSellable;
      }

      return totalAvailable >= requestedQuantity;
    } catch (error) {
      if (error instanceof MedusaError) {
        throw error;
      }
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        error.message || '재고 확인 중 오류가 발생했습니다.',
      );
    }
  }
}
