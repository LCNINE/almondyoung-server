import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { NaverBaseClient } from './naver-base.client';

// TODO: 추후 naver-api.types.ts 파일로 이동할 타입
import {
  ChangeSaleStatusBody,
  UpdateOptionStockBody,
  // 🎯 Zod 스키마들 import
  ChangeSaleStatusBodySchema,
  UpdateOptionStockBodySchema,
} from '../../../zods/naver/naver.product.zod';
import { NaverAuthService } from './naver-auth.client';
import { formatZodIssues } from '../../../shared/utils';

@Injectable()
export class NaverProductClient extends NaverBaseClient {
  constructor(
    protected readonly http: HttpService,
    private readonly authService: NaverAuthService,
  ) {
    // 부모 클래스(NaverBaseClient)의 생성자에 Logger 이름을 전달합니다.
    super(http, NaverProductClient.name);
  }

  // =================================================================
  // == 상품 / 재고 (Product / Stock)
  // =================================================================

  /**
   * (단일 상품용) 판매 상태와 재고를 변경합니다.
   * @param originProductNo 원상품 번호
   * @param body 변경할 상태 및 재고 정보. 재고 업데이트 시 statusType: 'SALE' 필수
   * @returns API 응답 데이터
   */
  async changeSaleStatus(
    originProductNo: number,
    body: ChangeSaleStatusBody,
  ): Promise<any> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // 🎯 Zod 검증 추가
    const parsedBody = ChangeSaleStatusBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 판매 상태 변경 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '판매 상태 변경 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    // TODO: 이 API의 실제 성공 응답 타입을 확인하고 any 대신 구체적인 타입 적용 필요
    const url = `${this.apiBaseUrl}/products/origin-products/${originProductNo}/change-status`;
    const response = await firstValueFrom(
      this.http.put(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * (옵션 상품용) 옵션별 재고, 가격, 할인가를 변경합니다.
   * @param originProductNo 원상품 번호
   * @param body 변경할 옵션 정보
   * @returns API 응답 데이터
   */
  async updateOptionStock(
    originProductNo: number,
    body: UpdateOptionStockBody,
  ): Promise<any> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // 🎯 Zod 검증 추가
    const parsedBody = UpdateOptionStockBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 옵션 재고 업데이트 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '옵션 재고 업데이트 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    // TODO: 이 API의 실제 성공 응답 타입을 확인하고 any 대신 구체적인 타입 적용 필요
    const url = `${this.apiBaseUrl}/products/origin-products/${originProductNo}/option-stock`;
    const response = await firstValueFrom(
      this.http.put(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
}
