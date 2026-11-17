import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CoupangBaseClient } from './coupang-base.client.service';
import { CoupangUpdateStockResponse } from '../../../zods/coupang';

/**
 * 쿠팡 상품/재고 클라이언트
 *
 * 상품 정보 및 재고 관리 도메인 API를 담당합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */
@Injectable()
export class CoupangProductClient extends CoupangBaseClient {
  constructor(http: HttpService) {
    super(http);
  }

  /**
   * 특정 상품 옵션(vendorItemId)의 재고 수량을 변경합니다.
   * @param vendorItemId 옵션 ID
   * @param quantity 변경할 재고 수량
   * @returns API 응답 데이터
   */
  async updateStock(vendorItemId: number, quantity: number): Promise<CoupangUpdateStockResponse> {
    try {
      this.logger.log(`📦 쿠팡 재고 변경 요청: vendorItemId=${vendorItemId}, quantity=${quantity}`);

      const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/quantities/${quantity}`;
      // 이 API는 요청 본문(body)이 필요 없습니다.
      const response = await this.send<CoupangUpdateStockResponse>('PUT', path);

      this.logger.log(`👍 재고 변경 완료: ${vendorItemId} -> ${quantity}개`);
      return response;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 재고 변경 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 재고 변경 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 재고 변경 실패: ${error.message}`);
    }
  }
}
