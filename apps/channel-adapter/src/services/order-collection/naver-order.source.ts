import { Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { NaverOrderClient } from '../../adapters/naver/clients/naver-order.client';
import {
  ChannelOrderLineSnapshot,
  ChannelOrderSnapshot,
  ChannelPaymentState,
  LifecycleObservation,
  ReplayableChannelOrderSource,
} from './channel-order-source.interface';
import { NaverProductOrderInfo, parseNaverProductOrderInfo } from './naver-order-fields';

/** 최초 수집 바닥값. 과거를 소급하면 이미 수기 처리된 주문이 중복 유입된다. */
const FIRST_RUN_LOOKBACK_MS = 60 * 60 * 1000;
/** 변경 피드가 한 번에 볼 수 있는 창. `lastChangedTo` 생략 시 네이버가 자동 적용하는 값과 같다. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 무한 페이징 방어. 한 창 × 300건이면 6000건으로, 우리 주문량에서 도달할 수 없다. */
const MAX_PAGES = 20;

const ACCEPTED_STATUSES = new Set(['PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED']);
const TERMINAL_STATUSES = new Set(['CANCELED', 'CANCELED_BY_NOPAYMENT', 'RETURNED', 'EXCHANGED']);
/**
 * 취소 요청 중에도 productOrderStatus 는 PAYED 다 — 그대로 두면 출고로 흘러간다.
 * `ADMIN_CANCELING` 은 판매자(관리자)가 취소를 개시한 경로다 (FIX 6) — 고객 신청과 상태 축은
 * 다르지만 결과는 같다: 아직 확정 취소가 아니면서 출고해서는 안 되는 구간.
 */
const CANCEL_IN_FLIGHT_CLAIMS = new Set(['CANCEL_REQUEST', 'CANCELING', 'ADMIN_CANCELING']);

@Injectable()
export class NaverOrderSource implements ReplayableChannelOrderSource {
  readonly channel: SalesChannel = 'naver';
  private readonly logger = new Logger(NaverOrderSource.name);

  constructor(private readonly client: NaverOrderClient) {}

  async fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]> {
    const changedAtByOrderId = await this.collectChangedOrderIds(since);
    const snapshots: ChannelOrderSnapshot[] = [];
    let failedCount = 0;
    for (const [orderId, changedAt] of changedAtByOrderId) {
      try {
        // 🔴 채널이 말한 변경 시각을 그대로 싣는다. `now` 를 쓰면 워터마크가 조회 창을 건너뛰어
        // 그 사이 변경이 영영 조회 범위 밖으로 빠진다 (창 걷기가 무력화된다).
        const snapshot = await this.fetchSnapshot(orderId, changedAt);
        if (snapshot) snapshots.push(snapshot);
      } catch (error) {
        // 실패 단위는 주문 하나다, 사이클 전체가 아니다 (FIX 2). 여기서 throw 하면 오케스트레이터가
        // 사이클 전체를 실패로 기록하고 워터마크를 멈춘다 — 그러면 이 한 주문 뒤에 있는(맵 순서상)
        // 나머지 정상 주문들도 다음 폴링에서 똑같이 막혀, 잘못된 응답 하나가 수집 전체를 영구히
        // 정지시킨다. 개별 주문 실패는 로그로 표면화하고 나머지는 계속 처리한다.
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[naver] 주문 ${orderId} 수집 실패, 건너뛴다: ${message}`);
      }
    }
    if (failedCount > 0) {
      this.logger.error(
        `[naver] 이번 주기 ${changedAtByOrderId.size}건 중 ${failedCount}건 수집 실패 — 개별 사유는 위 로그 참고.`,
      );
    }
    return snapshots;
  }

  /**
   * replay 전용 단건. 워터마크 경로가 아니므로(`replayFailure` 는 `processOrderItem` 을 직접 부른다)
   * 변경 시각을 알 수 없어 현재 시각을 쓴다.
   */
  async fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null> {
    return this.fetchSnapshot(externalOrderId, new Date().toISOString());
  }

  private async fetchSnapshot(externalOrderId: string, sourceUpdatedAt: string): Promise<ChannelOrderSnapshot | null> {
    // 형제 라인을 복원한다. 변경 피드는 바뀐 라인만 주므로 이걸 건너뛰면 라인이 빠진 주문이 생긴다.
    const idsResponse = await this.client.getProductOrderIdsByOrderId(externalOrderId);
    const productOrderIds = idsResponse.data ?? [];
    if (productOrderIds.length === 0) return null;

    const detailsResponse = await this.client.getOrderDetails(productOrderIds);
    const infos = (detailsResponse.data ?? []).map((raw) => parseNaverProductOrderInfo(raw));

    // 문서가 "식별자 단위로 일부만 조회 실패할 수 있다" 고 경고한다. 조용히 빠지면 §6.1 이
    // 막으려던 사고가 그대로 난다. 개수만 비교하면 응답에 요청하지 않은 id 가 섞여 개수가
    // 우연히 맞아떨어지는 경우를 놓친다 — 요청한 id 전체가 실제로 응답에 있는지 신원으로
    // 확인한다 (FIX 5).
    const returnedProductOrderIds = new Set(infos.map((info) => info.productOrderId));
    const hasMissingProductOrderId = productOrderIds.some((id) => !returnedProductOrderIds.has(id));
    if (hasMissingProductOrderId) {
      throw new Error(
        `네이버 상세 조회 누락: 주문 ${externalOrderId} 요청 ${productOrderIds.length}건, 응답 ${infos.length}건`,
      );
    }

    return this.buildSnapshot(externalOrderId, infos, sourceUpdatedAt);
  }

  /**
   * `more` 를 따라 창 전체를 훑고, **주문번호 → 그 주문의 최신 변경 시각**을 모은다.
   * 한 주문의 여러 라인이 바뀌었으면 가장 늦은 시각을 취한다 — 워터마크의 근거다.
   */
  private async collectChangedOrderIds(since: Date | null): Promise<Map<string, string>> {
    const now = new Date();
    const from = since ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
    // 창을 앞으로 점프시키지 않는다 — 그러면 그 사이 주문이 영영 조회 범위 밖으로 빠진다.
    const windowEnd = new Date(Math.min(from.getTime() + MAX_WINDOW_MS, now.getTime()));
    const explicitTo = windowEnd.getTime() < now.getTime() ? windowEnd.toISOString() : undefined;

    const changedAtByOrderId = new Map<string, string>();
    let lastChangedFrom = from.toISOString();
    let moreSequence: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.client.getLastChangedStatuses({
        lastChangedFrom,
        ...(explicitTo ? { lastChangedTo: explicitTo } : {}),
        ...(moreSequence ? { moreSequence } : {}),
      });

      for (const status of response.data?.lastChangeStatuses ?? []) {
        const previous = changedAtByOrderId.get(status.orderId);
        if (!previous || status.lastChangedDate > previous) {
          changedAtByOrderId.set(status.orderId, status.lastChangedDate);
        }
      }

      const more = response.data?.more;
      if (!more) return changedAtByOrderId;
      lastChangedFrom = more.moreFrom;
      moreSequence = more.moreSequence;
    }

    this.logger.warn(`[naver] 변경 피드 페이징이 ${MAX_PAGES}쪽에서 끊겼다 — 다음 주기가 이어받는다.`);
    return changedAtByOrderId;
  }

  private buildSnapshot(
    externalOrderId: string,
    infos: NaverProductOrderInfo[],
    sourceUpdatedAt: string,
  ): ChannelOrderSnapshot {
    const lines = infos.map((info) => this.buildLine(info));
    const cancelled = infos.filter((info) => TERMINAL_STATUSES.has(info.productOrderStatus));
    const live = infos.filter((info) => !TERMINAL_STATUSES.has(info.productOrderStatus));
    const allCancelled = cancelled.length === infos.length;
    this.warnIfShippingAddressesDiffer(externalOrderId, infos);

    return {
      externalOrderId,
      sourceUpdatedAt,
      paymentState: this.resolvePaymentState(infos, allCancelled),
      customerId: null,
      lines,
      amounts: {
        // 취소된 라인은 `lines` 에는 남기지만(변경 해시 보존), Core `items` 계약에는 실리지 않는다
        // — 금액도 그 라인을 뺀 실판매분만 합산한다. 안 그러면 부분취소 주문의 Core 합계가
        // 부풀려진 채로 들어간다 (FIX 3).
        total: live.reduce((sum, info) => sum + info.lineTotal, 0),
        subtotal: live.reduce((sum, info) => sum + info.unitPrice * info.quantity, 0),
        shipping: live.reduce((sum, info) => sum + info.shippingFee, 0),
        discount: 0,
        currency: 'KRW',
      },
      shippingAddress: infos[0].shippingAddress,
      createdAt: infos[0].paymentDate ?? sourceUpdatedAt,
      lifecycle: this.buildLifecycle(infos, cancelled, allCancelled, sourceUpdatedAt),
      raw: { externalOrderId, productOrders: infos },
    };
  }

  /**
   * Core 계약은 주문당 배송지 하나만 나른다 — `infos[0]` 을 대표값으로 쓰는 결정은 유지한다.
   * 네이버는 상품주문(라인) 단위로 배송지를 들고 있어 이론상 라인마다 다를 수 있는데, 그 경우를
   * 조용히 넘기면 나머지 라인의 실제 배송지가 소리 없이 버려진다 — 눈에 띄게 로그만 남긴다
   * (FIX 7).
   */
  private warnIfShippingAddressesDiffer(externalOrderId: string, infos: NaverProductOrderInfo[]): void {
    const first = JSON.stringify(infos[0].shippingAddress);
    const differs = infos.some((info) => JSON.stringify(info.shippingAddress) !== first);
    if (differs) {
      this.logger.warn(
        `[naver] 주문 ${externalOrderId} 의 라인별 배송지가 서로 다르다 — 첫 라인 배송지를 주문 대표값으로 쓴다.`,
      );
    }
  }

  private buildLine(info: NaverProductOrderInfo): ChannelOrderLineSnapshot {
    return {
      channelOrderItemId: info.productOrderId,
      ...(info.channelProductId ? { channelProductId: info.channelProductId } : {}),
      productName: info.productName,
      quantity: info.quantity,
      unitPrice: info.unitPrice,
      ...(TERMINAL_STATUSES.has(info.productOrderStatus) ? { cancelled: true } : {}),
    };
  }

  private resolvePaymentState(infos: NaverProductOrderInfo[], allCancelled: boolean): ChannelPaymentState {
    if (allCancelled) return 'terminal';

    const live = infos.filter((info) => !TERMINAL_STATUSES.has(info.productOrderStatus));
    // 고객이 취소를 원하는 주문을 출고 파이프라인에 태우지 않는다 (Medusa 의 refund-requested 방어와 대칭).
    if (live.some((info) => info.claimStatus && CANCEL_IN_FLIGHT_CLAIMS.has(info.claimStatus))) return 'pending';
    if (live.every((info) => ACCEPTED_STATUSES.has(info.productOrderStatus))) return 'accepted';
    return 'pending';
  }

  /**
   * **전 라인 취소는 full 1건, 일부 취소는 라인마다 partial 1건.**
   * Core 는 `lines` 유무로 전체/부분을 가르고, 부분취소가 누적돼 전량이 돼도 주문을 닫지 않는다.
   */
  private buildLifecycle(
    infos: NaverProductOrderInfo[],
    cancelled: NaverProductOrderInfo[],
    allCancelled: boolean,
    cancelledAt: string,
  ): LifecycleObservation[] {
    if (cancelled.length === 0) return [];

    if (allCancelled) {
      return [
        {
          eventType: 'OrderCancelled',
          eventKey: 'cancelled',
          payload: {
            reason: 'CUSTOMER_REQUEST',
            reasonDetail: '네이버 주문 취소 수집',
            cancelledBy: 'naver',
            cancelledAt,
            refundRequired: false,
          },
          rawEvent: { productOrderIds: cancelled.map((info) => info.productOrderId) },
        },
      ];
    }

    return cancelled.map((info) => ({
      eventType: 'OrderCancelled' as const,
      eventKey: `cancelled:${info.productOrderId}`,
      payload: {
        reason: 'CUSTOMER_REQUEST' as const,
        reasonDetail: '네이버 상품주문 부분 취소 수집',
        cancelledBy: 'naver',
        cancelledAt,
        refundRequired: false,
        cancelledLines: [{ channelOrderItemId: info.productOrderId, quantity: info.quantity }],
      },
      rawEvent: { productOrderId: info.productOrderId },
    }));
  }
}
