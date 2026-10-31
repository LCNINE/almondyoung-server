import { OutboundTenant } from '@app/tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { SalesChannel } from '@packages/event-contracts/streams';

export const CORE_LOOKUP_BATCH = 200;

export interface CoreSalesOrderLookupItem {
  externalOrderId: string;
  salesOrder: { status: string } | null;
  openEventFailure: boolean;
}

/**
 * core 판매주문 묶음 조회 (#1016 45번). 채널 대사가 주기마다 부른다.
 *
 * 실패를 삼키지 않는다 — «core 가 모른다»를 «SO 가 없다»로 읽으면 그 주기의 모든 주문이 `missing_order` 가 된다.
 * 판정은 호출부(대사 매니저)가 «주기 건너뛰기»로 한다.
 */
@Injectable()
export class CoreSalesOrderLookupClient {
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(OutboundTenant) private readonly outboundTenant: Pick<OutboundTenant, 'headers'>,
  ) {
    this.baseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  async lookup(
    channel: SalesChannel,
    orders: { externalOrderId: string; wmsOrderId?: string }[],
  ): Promise<Map<string, CoreSalesOrderLookupItem>> {
    const result = new Map<string, CoreSalesOrderLookupItem>();
    if (orders.length === 0) return result;
    const internalKey = this.configService.get<string>('CORE_INTERNAL_KEY');
    if (!internalKey) {
      throw new Error('CORE_INTERNAL_KEY 가 설정되지 않아 core 판매주문을 조회할 수 없다.');
    }
    for (let i = 0; i < orders.length; i += CORE_LOOKUP_BATCH) {
      const batch = orders.slice(i, i + CORE_LOOKUP_BATCH);
      const response = await firstValueFrom(
        this.httpService.post<{ orders: CoreSalesOrderLookupItem[] }>(
          `${this.baseUrl}/internal/sales-orders/lookup`,
          { salesChannel: channel, orders: batch },
          { headers: { Authorization: `Bearer ${internalKey}`, ...this.outboundTenant.headers() }, timeout: 10_000 },
        ),
      );
      for (const item of response.data?.orders ?? []) result.set(item.externalOrderId, item);
      const missing = batch.find((order) => !result.has(order.externalOrderId));
      if (missing) throw new Error(`core 조회 응답에 ${missing.externalOrderId} 가 없다`);
    }
    return result;
  }
}
