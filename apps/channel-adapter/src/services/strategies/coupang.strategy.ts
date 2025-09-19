import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChannelStrategy } from './channel-strategy.interface';
import { DataType, SyncResult } from '../../types';
import { InternalOrderEvent } from '../../types';
import { ChannelCommand } from '../../types';
import { firstValueFrom } from 'rxjs';
import {
  CoupangOrderSheetListResponseSchema,
  CoupangOrderSheetRequestSchema,
  mapCoupangStatusToInternal,
  validateDateRange,
  type CoupangOrderSheetListResponse,
  type CoupangOrderSheet,
} from '../../zods/coupang-ordersheet.zod';

@Injectable()
export class CoupangStrategy implements ChannelStrategy {
  constructor(private readonly http: HttpService) {}

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 쿠팡 웹훅이 있는 경우 payload -> InternalOrderEvent로 변환
    return this.transformToInternal(event, 'orders');
  }

  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      console.log(`Skipping unsupported dataType: ${dataType}`);
      return [];
    }

    try {
      // 1. 환경변수에서 쿠팡 설정 가져오기
      const vendorId = process.env.COUPANG_VENDOR_ID;
      const accessKey = process.env.COUPANG_ACCESS_KEY;
      const secretKey = process.env.COUPANG_SECRET_KEY;
      const apiEndpoint =
        process.env.COUPANG_API_ENDPOINT || 'https://api-gateway.coupang.com';

      if (!vendorId || !accessKey || !secretKey) {
        throw new Error(
          '쿠팡 API 인증 정보가 설정되지 않았습니다 (COUPANG_VENDOR_ID, COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY)',
        );
      }

      // 2. 조회 기간 설정 (현재는 24시간 전으로 설정)
      // TODO: 실제 구현에서는 Redis나 DB에서 마지막 동기화 시각을 관리해야 함
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const createdAtFrom = `${yesterday.toISOString().split('T')[0]}+09:00`;
      const createdAtTo = `${now.toISOString().split('T')[0]}+09:00`;

      console.log(
        `📡 쿠팡 발주서 목록 조회 시작 (${createdAtFrom} ~ ${createdAtTo})`,
      );

      // 3. 날짜 범위 검증
      if (!validateDateRange(createdAtFrom, createdAtTo)) {
        throw new Error('조회 기간이 31일을 초과할 수 없습니다');
      }

      // 4. 모든 상태의 발주서를 조회 (상태별로 분리 조회)
      const statuses = [
        'ACCEPT',
        'INSTRUCT',
        'DEPARTURE',
        'DELIVERING',
        'FINAL_DELIVERY',
      ] as const;
      const allOrderSheets: CoupangOrderSheet[] = [];

      for (const status of statuses) {
        console.log(`📋 ${status} 상태 발주서 조회 중...`);

        const orderSheets = await this.fetchOrderSheetsByStatus(
          vendorId,
          accessKey,
          secretKey,
          apiEndpoint,
          createdAtFrom,
          createdAtTo,
          status,
        );

        allOrderSheets.push(...orderSheets);
        console.log(`✅ ${status} 상태: ${orderSheets.length}건 조회됨`);
      }

      console.log(`📊 총 ${allOrderSheets.length}건의 발주서 조회 완료`);

      if (allOrderSheets.length === 0) {
        return [];
      }

      // 5. 쿠팡 발주서를 InternalOrderEvent로 변환
      const events = this.transformCoupangOrderSheetsToInternal(
        allOrderSheets,
        dataType,
      );

      // 6. 디버깅을 위한 첫 번째 발주서 출력
      if (allOrderSheets.length > 0) {
        console.log('🔍 첫 번째 발주서 원본 데이터:');
        console.log(JSON.stringify(allOrderSheets[0], null, 2));
      }

      // 7. TODO: Redis 중복검사 추가 예정
      // 8. TODO: Kafka/이벤트브로커 발행 추가 예정

      return events;
    } catch (error) {
      console.error('❌ 쿠팡 발주서 동기화 실패:', error);
      throw new Error(`쿠팡 발주서 동기화 실패: ${error.message}`);
    }
  }

  async syncToChannel(data: any, dataType: DataType): Promise<SyncResult> {
    // 예: 송장번호/발송정보를 쿠팡에 업데이트
    return { success: true };
  }

  async executeCommand(command: ChannelCommand): Promise<SyncResult> {
    const accessKey = process.env.COUPANG_ACCESS_KEY;
    const secretKey = process.env.COUPANG_SECRET_KEY;
    const api = process.env.COUPANG_API_ENDPOINT;

    switch (command.type) {
      case 'cancel.approve':
        // 쿠팡 취소 승인 API 호출
        return { success: true };
      case 'dispatch.confirm':
        // 쿠팡 발송 처리 API 호출
        return { success: true };
      // …기타 명령
      default:
        throw new Error(
          `Unsupported command type for Coupang: ${command.type}`,
        );
    }
  }

  async transformToInternal(
    externalData: any,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    // TODO: 외부 응답 → InternalOrderEvent[] 매핑
    return [];
  }

  async transformToExternal(
    internalData: any,
    dataType: DataType,
  ): Promise<any> {
    return {};
  }

  /**
   * 특정 상태의 발주서 목록을 조회하는 헬퍼 메서드
   */
  private async fetchOrderSheetsByStatus(
    vendorId: string,
    accessKey: string,
    secretKey: string,
    apiEndpoint: string,
    createdAtFrom: string,
    createdAtTo: string,
    status: string,
  ): Promise<CoupangOrderSheet[]> {
    const allOrderSheets: CoupangOrderSheet[] = [];
    let nextToken: string | undefined;

    do {
      try {
        // API 호출 파라미터 구성
        const params = new URLSearchParams({
          createdAtFrom: createdAtFrom,
          createdAtTo: createdAtTo,
          status,
          maxPerPage: '50',
        });

        if (nextToken) {
          params.append('nextToken', nextToken);
        }

        const path = `/v2/providers/openapi/apis/api/v5/vendors/${vendorId}/ordersheets`;
        const queryString = params.toString();

        // 쿠팡 API 인증 헤더 생성 (쿼리 파라미터 포함)
        const authorization = this.generateCoupangAuthHeader(
          accessKey,
          secretKey,
          'GET',
          path,
          queryString,
        );

        const url = `${apiEndpoint}${path}?${queryString}`;

        console.log(`📡 쿠팡 API 호출: ${url}`);

        const response = await firstValueFrom(
          this.http.get<CoupangOrderSheetListResponse>(url, {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          }),
        );

        // 응답 데이터 검증
        const validatedResponse = CoupangOrderSheetListResponseSchema.parse(
          response.data,
        );

        if (validatedResponse.code !== 200) {
          throw new Error(
            `쿠팡 API 오류: ${validatedResponse.code} - ${validatedResponse.message}`,
          );
        }

        allOrderSheets.push(...validatedResponse.data);
        nextToken = validatedResponse.nextToken;

        console.log(
          `📄 페이지 조회 완료: ${validatedResponse.data.length}건, nextToken: ${nextToken || 'none'}`,
        );
      } catch (error) {
        console.error(
          `❌ 쿠팡 API 호출 실패 (status: ${status}):`,
          error.response?.data || error.message,
        );
        throw error;
      }
    } while (nextToken);

    return allOrderSheets;
  }

  /**
   * 쿠팡 API 인증 헤더 생성 (정확한 HMAC-SHA256 서명)
   *
   * 쿠팡 API 서명 규칙:
   * 1. signedDate + HTTP_METHOD + PATH + QUERY_STRING
   * 2. 위 문자열을 secret-key로 HMAC-SHA256 해싱
   * 3. 결과를 hex로 인코딩
   *
   * @param accessKey 쿠팡 Access Key
   * @param secretKey 쿠팡 Secret Key
   * @param method HTTP 메서드 (GET, POST 등)
   * @param path API 경로 (/v2/providers/openapi/apis/...)
   * @param query Query String (? 없이 파라미터만)
   */
  private generateCoupangAuthHeader(
    accessKey: string,
    secretKey: string,
    method: string,
    path: string,
    query?: string,
  ): string {
    const crypto = require('crypto');

    // 1. signed-date 생성 (GMT+0, yyMMddTHHmmssZ 형식)
    const now = new Date();
    const signedDate =
      now
        .toISOString()
        .slice(2, 19) // yy-MM-ddTHH:mm:ss
        .replace(/[-:]/g, '') // yyMMddTHHmmss
        .replace('T', 'T') + 'Z'; // yyMMddTHHmmssZ

    // 2. 서명 문자열 구성: signedDate + method + path + query
    const queryString = query || '';
    const message = signedDate + method + path + queryString;

    console.log('🔐 쿠팡 API 서명 생성 (정확한 방식):');
    console.log(`  - Signed Date: ${signedDate}`);
    console.log(`  - Method: ${method}`);
    console.log(`  - Path: ${path}`);
    console.log(`  - Query: ${queryString}`);
    console.log(`  - Message: "${message}"`);

    // 3. HMAC-SHA256 서명 생성
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(message, 'utf8')
      .digest('hex');

    console.log(`  - Signature: ${signature}`);

    // 4. Authorization 헤더 생성
    const authHeader = `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
    console.log(`  - Authorization: ${authHeader}`);

    return authHeader;
  }

  /**
   * 쿠팡 발주서를 InternalOrderEvent로 변환
   */
  private transformCoupangOrderSheetsToInternal(
    orderSheets: CoupangOrderSheet[],
    dataType: DataType,
  ): InternalOrderEvent[] {
    const events: InternalOrderEvent[] = [];

    for (const orderSheet of orderSheets) {
      // 각 주문 상품에 대해 개별 이벤트 생성
      for (const orderItem of orderSheet.orderItems) {
        const internalEvent: InternalOrderEvent = {
          channelType: 'coupang',
          externalOrderId: orderSheet.orderId.toString(),
          externalProductOrderId: orderItem.vendorItemId.toString(),
          status: mapCoupangStatusToInternal(orderSheet.status),
          lastChangedType: 'ORDER_STATUS_CHANGED',
          lastChangedAt: orderSheet.orderedAt,
          paymentDate: orderSheet.paidAt,
          quantity: orderItem.shippingCount,
          priceAmount: orderItem.salesPrice.units,
          createdAt: orderSheet.orderedAt,
          updatedAt: orderSheet.paidAt,

          // 할인 정보
          discountAmount: orderItem.discountPrice.units,

          // 구매자/수취인 정보
          buyer: {
            name: orderSheet.receiver.name,
            contact: orderSheet.receiver.safeNumber,
            address: {
              postalCode: orderSheet.receiver.postCode,
              roadAddress: orderSheet.receiver.addr1,
              detailAddress: orderSheet.receiver.addr2,
            },
          },

          // 배송 정보
          dispatch: orderSheet.invoiceNumber
            ? {
                deliveryMethod: 'DELIVERY',
                deliveryCompanyCode:
                  orderSheet.deliveryCompanyName || 'UNKNOWN',
                trackingNumber: orderSheet.invoiceNumber,
                dispatchedAt: orderSheet.inTrasitDateTime,
              }
            : undefined,
        };

        events.push(internalEvent);
      }
    }

    return events;
  }
}
