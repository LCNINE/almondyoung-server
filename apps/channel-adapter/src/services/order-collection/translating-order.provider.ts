import type { SalesChannel } from '@packages/event-contracts/streams';
import { ChannelOrderTranslator } from './channel-order.translator';
import {
  ChannelOrderSource,
  ChannelOrderSnapshot,
  ReplayableChannelOrderSource,
  isReplayableSource,
} from './channel-order-source.interface';
import {
  ChannelOrderProvider,
  FetchOrdersResult,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderFetchOutcome,
  OrderLifecycleEventItem,
  ReplayableChannelOrderProvider,
} from './channel-order-provider.interface';

/**
 * source(채널 원어) + translator(Core 계약)를 한 채널분으로 묶는다.
 *
 * `ChannelOrderProvider` 는 이제 **구현이 하나뿐인** 계약이다 — orchestrator 가 보는 표면을
 * 그대로 두어, 워터마크·격리·멱등·outbox 를 검증하는 기존 스펙이 이 리팩터를 통과해 살아남는다.
 * 채널별로 달라지는 것은 source 뿐이다.
 */
export class TranslatingOrderProvider implements ChannelOrderProvider {
  readonly channel: SalesChannel;

  constructor(
    protected readonly source: ChannelOrderSource,
    protected readonly translator: ChannelOrderTranslator,
  ) {
    this.channel = source.channel;
  }

  async fetchOrders(since: Date | null): Promise<FetchOrdersResult> {
    const snapshots = await this.source.fetchOrders(since);

    const orders: OrderFetchItem[] = [];
    const failures: OrderCollectionFailureItem[] = [];
    const lifecycleEvents: OrderLifecycleEventItem[] = [];

    for (const snapshot of snapshots) {
      const { outcome, lifecycle } = await this.translator.translate(this.channel, snapshot);
      lifecycleEvents.push(...lifecycle);
      if (outcome.kind === 'failure') {
        failures.push(outcome.failure);
      } else {
        orders.push(outcome.order);
      }
    }

    return { orders, failures, lifecycleEvents };
  }

  protected async translateOne(snapshot: ChannelOrderSnapshot): Promise<OrderFetchOutcome> {
    const { outcome } = await this.translator.translate(this.channel, snapshot);
    return outcome;
  }
}

/** 격리 재처리를 지원하는 source 를 감싼 판본. */
export class ReplayableTranslatingOrderProvider
  extends TranslatingOrderProvider
  implements ReplayableChannelOrderProvider
{
  constructor(
    private readonly replayableSource: ReplayableChannelOrderSource,
    translator: ChannelOrderTranslator,
  ) {
    super(replayableSource, translator);
  }

  async fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null> {
    const snapshot = await this.replayableSource.fetchOrder(externalOrderId);
    if (!snapshot) {
      return null;
    }
    return this.translateOne(snapshot);
  }
}

export function createOrderProvider(
  source: ChannelOrderSource,
  translator: ChannelOrderTranslator,
): ChannelOrderProvider {
  return isReplayableSource(source)
    ? new ReplayableTranslatingOrderProvider(source, translator)
    : new TranslatingOrderProvider(source, translator);
}
