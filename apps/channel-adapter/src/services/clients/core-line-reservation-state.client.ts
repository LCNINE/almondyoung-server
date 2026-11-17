import { OutboundTenant } from '@app/tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { SalesChannel } from '@packages/event-contracts/streams';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';

export const CORE_LINE_STATE_BATCH = 200;
export const CORE_LINE_CANDIDATE_PAGE = 500;

export type CoreLineReservationState = SalesOrderLineReservationStatePayload['lines'][number] & {
  salesOrderId: string;
  orderedAt: string;
};

/**
 * core 줄 예약 상태 조회 (#1247 하루 대사). 실패를 삼키지 않는다 —
 * «core 가 모른다»를 «줄이 없다»로 읽으면 멀쩡한 예약을 지운다. 호출부가 «회차 건너뜀»으로 판정한다.
 */
@Injectable()
export class CoreLineReservationStateClient {
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(OutboundTenant) private readonly outboundTenant: Pick<OutboundTenant, 'headers'>,
  ) {
    this.baseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  /** 타임아웃 60초 — 200줄 상태 조회는 주문마다 줄 수량 문을 돌려 수 초~수십 초 걸린다. 끊기면 회차 전체가 건너뛴다. */
  private requestConfig() {
    const internalKey = this.configService.get<string>('CORE_INTERNAL_KEY');
    if (!internalKey) throw new Error('CORE_INTERNAL_KEY 가 설정되지 않아 core 줄 상태를 조회할 수 없다.');
    return { headers: { Authorization: `Bearer ${internalKey}`, ...this.outboundTenant.headers() }, timeout: 60_000 };
  }

  async states(
    channel: SalesChannel,
    channelOrderItemIds: string[],
  ): Promise<{ lines: CoreLineReservationState[]; unknown: string[] }> {
    const lines: CoreLineReservationState[] = [];
    const unknown: string[] = [];
    if (channelOrderItemIds.length === 0) return { lines, unknown };
    const config = this.requestConfig();
    for (let i = 0; i < channelOrderItemIds.length; i += CORE_LINE_STATE_BATCH) {
      const response = await firstValueFrom(
        this.httpService.post<{ lines: CoreLineReservationState[]; unknown: string[] }>(
          `${this.baseUrl}/internal/sales-orders/line-reservation-states`,
          { salesChannel: channel, channelOrderItemIds: channelOrderItemIds.slice(i, i + CORE_LINE_STATE_BATCH) },
          config,
        ),
      );
      if (!Array.isArray(response.data?.lines) || !Array.isArray(response.data?.unknown)) {
        throw new Error('core 줄 상태 응답 형식이 올바르지 않다');
      }
      lines.push(...response.data.lines);
      unknown.push(...response.data.unknown);
    }
    return { lines, unknown };
  }

  /** 주문 시각이 `orderedAtOrAfter` 이후인 줄의 channelOrderItemId 를 모두 모은다(페이지 순회). */
  async candidates(channel: SalesChannel, orderedAtOrAfter: Date): Promise<string[]> {
    const config = this.requestConfig();
    const ids: string[] = [];
    let afterLineId: string | undefined;
    for (;;) {
      const response = await firstValueFrom(
        this.httpService.post<{ channelOrderItemIds: string[]; nextAfterLineId: string | null }>(
          `${this.baseUrl}/internal/sales-orders/line-reservation-candidates`,
          {
            salesChannel: channel,
            orderedAtOrAfter: orderedAtOrAfter.toISOString(),
            ...(afterLineId ? { afterLineId } : {}),
            limit: CORE_LINE_CANDIDATE_PAGE,
          },
          config,
        ),
      );
      if (!Array.isArray(response.data?.channelOrderItemIds)) throw new Error('core 후보 응답 형식이 올바르지 않다');
      ids.push(...response.data.channelOrderItemIds);
      const next = response.data.nextAfterLineId;
      if (!next) return ids;
      afterLineId = next;
    }
  }
}
