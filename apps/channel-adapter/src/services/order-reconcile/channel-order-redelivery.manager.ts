import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ORDER_STREAM, OrderCancelledPayload, SalesChannel } from '@packages/event-contracts/streams';
import { channelAdapterSchema } from '../../schema';
import {
  CHANNEL_ORDER_PROVIDER,
  ChannelOrderProvider,
  OrderLifecycleEventItem,
  SyncableChannelOrderProvider,
  isSyncableProvider,
} from '../order-collection/channel-order-provider.interface';
import { OrderPollerOrchestrator, OrderSyncOutcome } from '../order-collection/order-poller.orchestrator';
import { AdapterTx, OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';

export type RedeliveryResult = OrderSyncOutcome | 'enqueued' | 'no_mapping' | 'nothing_to_send';

type CancelItem = Extract<OrderLifecycleEventItem, { eventType: 'OrderCancelled' }>;

/**
 * 대사가 찾은 어긋남을 «다시 배달»한다 (#1016 45번 스펙 §6.2). 기존 `syncOrder` 는 매핑 있는 주문엔 `OrderModified` 만,
 * 취소엔 «처음 본 것만»(`claimFirstSeen`)이라 force 로도 다시 안 낸다 — 그래서 두 경로를 새로 둔다.
 * 매핑·해시는 건드리지 않는다. core 는 생성(채널 키)·취소(새 메시지 id) 모두 멱등이다.
 */
@Injectable()
export class ChannelOrderRedeliveryManager {
  constructor(
    @Inject(CHANNEL_ORDER_PROVIDER) private readonly providers: ChannelOrderProvider[],
    @InjectPublisher(ORDER_STREAM) private readonly ordersPublisher: PublisherFor<typeof ORDER_STREAM>,
    private readonly findings: OrderReconcileFindingRepository,
    private readonly orderPoller: OrderPollerOrchestrator,
    private readonly dbService: DbService<typeof channelAdapterSchema>,
  ) {}

  async redeliver(
    finding: Pick<OrderReconcileFinding, 'id' | 'channel' | 'externalOrderId' | 'kind'>,
  ): Promise<RedeliveryResult> {
    const provider = this.syncableProvider(finding.channel);
    const mappings = await this.findings.mappingsByExternalOrderId(finding.channel, [finding.externalOrderId]);
    const wmsOrderId = mappings.get(finding.externalOrderId);

    if (finding.kind === 'missing_order' && !wmsOrderId) {
      // 어댑터가 못 본 주문 — 폴링과 같은 경로가 매핑·OrderCreated·해시를 만든다.
      const { outcome } = await this.orderPoller.syncOrder(provider.channel, finding.externalOrderId);
      await this.findings.recordAttempt(finding.id, outcome);
      return outcome;
    }
    if (!wmsOrderId) return this.done(finding.id, 'no_mapping');

    const fetched = await provider.fetchOrderForSync(finding.externalOrderId);
    if (!fetched) return this.done(finding.id, 'not_found');
    const cancel = fetched.lifecycle.find((item): item is CancelItem => item.eventType === 'OrderCancelled');

    if (finding.kind === 'cancel_not_applied') {
      if (!cancel) return this.done(finding.id, 'nothing_to_send');
      return this.dbService.run(async (tx) => {
        await this.enqueueCancel(provider.channel, wmsOrderId, cancel, tx);
        await this.findings.recordAttempt(finding.id, 'enqueued', tx);
        return 'enqueued' as const;
      });
    }

    if (fetched.outcome.kind === 'failure') return this.done(finding.id, 'identification_failed');
    // 매핑 없는 경로(`syncOrder`)와 같은 자격 검사다 — 취소 없이 환불·입금 대기가 된 주문을 confirmed SO 로 만들면
    // 환불된 주문이 출고 대상이 된다(리뷰 I-4). 채널 취소가 있으면 SO 를 만들어 바로 취소해야 하므로 보낸다(스펙 §5.3).
    if (fetched.outcome.order.eligibleForOrderCreation === false && !cancel) return this.done(finding.id, 'not_eligible');
    const createPayload = { ...fetched.outcome.order.createPayload, orderId: wmsOrderId };
    return this.dbService.run(async (tx) => {
      await this.ordersPublisher.enqueue(
        {
          eventType: 'OrderCreated',
          aggregateId: wmsOrderId,
          payload: createPayload,
          partitionKey: provider.channel,
          metadata: { partitionKey: provider.channel },
        },
        tx,
      );
      // SO 가 생겨야 취소도 닿는다 — 같은 aggregateId 라 순서가 지켜진다.
      if (cancel) await this.enqueueCancel(provider.channel, wmsOrderId, cancel, tx);
      await this.findings.recordAttempt(finding.id, 'enqueued', tx);
      return 'enqueued' as const;
    });
  }

  private async enqueueCancel(channel: SalesChannel, wmsOrderId: string, item: CancelItem, tx: AdapterTx) {
    const payload: OrderCancelledPayload = {
      orderId: wmsOrderId,
      salesChannel: channel,
      externalOrderId: item.externalOrderId,
      ...item.payload,
    };
    await this.ordersPublisher.enqueue(
      {
        eventType: 'OrderCancelled',
        aggregateId: wmsOrderId,
        payload,
        partitionKey: channel,
        metadata: { partitionKey: channel },
      },
      tx,
    );
  }

  private async done<R extends RedeliveryResult>(findingId: string, result: R): Promise<R> {
    await this.findings.recordAttempt(findingId, result);
    return result;
  }

  private syncableProvider(channel: string): SyncableChannelOrderProvider {
    const provider = this.providers.find((candidate) => candidate.channel === channel);
    if (!provider || !isSyncableProvider(provider)) {
      throw new Error(`No syncable order provider registered for channel: ${channel}`);
    }
    return provider;
  }
}
