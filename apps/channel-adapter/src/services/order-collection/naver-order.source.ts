import { Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { NaverOrderClient } from '../../adapters/naver/clients/naver-order.client';
import {
  ChannelOrderLineSnapshot,
  ChannelOrderSnapshot,
  ChannelPaymentState,
  LifecycleObservation,
  ReplayableChannelOrderSource,
  WindowedChannelOrderSource,
  WindowedFetchResult,
} from './channel-order-source.interface';
import { NaverProductOrderInfo, parseNaverProductOrderInfo } from './naver-order-fields';

/** 최초 수집 바닥값. 과거를 소급하면 이미 수기 처리된 주문이 중복 유입된다. */
const FIRST_RUN_LOOKBACK_MS = 60 * 60 * 1000;
/** 변경 피드가 한 번에 볼 수 있는 창. `lastChangedTo` 생략 시 네이버가 자동 적용하는 값과 같다. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 무한 페이징 방어. 한 창 × 300건이면 6000건으로, 우리 주문량에서 도달할 수 없다. */
const MAX_PAGES = 20;
/** 상세 조회 불일치 메시지에 나열할 id 개수 상한. 병적인 응답이 메시지를 무한정 늘리지 못하게 막는다. */
const MAX_LISTED_MISMATCHED_IDS = 20;

const ACCEPTED_STATUSES = new Set(['PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED']);
/**
 * **계약에서 빠지는 라인** — 이 상태의 라인은 판매주문 `items` 에 싣지 않고, 실판매 금액에서도
 * 빼며, 전 라인이 이 상태면 주문 전체가 `terminal` 이다.
 *
 * `RETURNED`/`EXCHANGED` 가 여기 있고 아래 취소 관측 집합에는 **없다**는 것이 요점이다.
 */
const OUT_OF_CONTRACT_STATUSES = new Set(['CANCELED', 'CANCELED_BY_NOPAYMENT', 'RETURNED', 'EXCHANGED']);
/**
 * **취소 관측을 내는 라인**. 반품/교환은 여기 들어가지 않는다.
 *
 * 🔴 왜 나눴나: 반품/교환은 이미 **출고가 끝난 뒤**의 생애주기다. 그것을 `OrderCancelled` 로
 * 내보내면 Core 의 출고 증거 가드(`sales-orders.service.ts` 의 shipped/completed FO 검사)가
 * `BadRequestException` 을 던지고, 그것은 non-retryable 이라 DLQ 로 직행한다 — 신호는 사라지고
 * 운영자가 볼 행도 남지 않는다. 반품/교환 생애주기는 이 브랜치가 의도적으로 모델링하지 않는다
 * (설계 §9 판정 4: "취소 포함, 환불 제외" — 클레임 19종 해석은 별건).
 */
const CANCELLATION_OBSERVED_STATUSES = new Set(['CANCELED', 'CANCELED_BY_NOPAYMENT']);
/**
 * 취소 요청 중에도 productOrderStatus 는 PAYED 다 — 그대로 두면 출고로 흘러간다.
 * `ADMIN_CANCELING` 은 판매자(관리자)가 취소를 개시한 경로다 (FIX 6) — 고객 신청과 상태 축은
 * 다르지만 결과는 같다: 아직 확정 취소가 아니면서 출고해서는 안 되는 구간.
 */
const CANCEL_IN_FLIGHT_CLAIMS = new Set(['CANCEL_REQUEST', 'CANCELING', 'ADMIN_CANCELING']);

@Injectable()
export class NaverOrderSource implements ReplayableChannelOrderSource, WindowedChannelOrderSource {
  readonly channel: SalesChannel = 'naver';
  private readonly logger = new Logger(NaverOrderSource.name);

  constructor(private readonly client: NaverOrderClient) {}

  async fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]> {
    const { snapshots } = await this.fetchOrdersInWindow(since);
    return snapshots;
  }

  /**
   * `fetchOrders` 와 같은 일을 하되 **끝까지 훑은 닫힌 창의 끝**을 함께 돌려준다.
   *
   * 🔴 이게 없으면 조용한 24시간이 수집을 영구히 정지시킨다: 닫힌 창 `[since, since+24h]` 에
   * 변경이 하나도 없으면 항목이 0건 → 오케스트레이터 워터마크 `null` → `recordSyncComplete` 가
   * `lastSyncAt` 을 건드리지 않음 → 다음 주기가 **같은 닫힌 창**을 다시 묻는다. 영원히.
   *
   * 반환값은 상태로 들고 있지 않고 그 자리에서 함께 넘긴다 — 겹쳐 도는 두 폴이 인스턴스
   * 필드를 서로 덮어쓰는 경합을 만들지 않기 위함이다.
   */
  async fetchOrdersInWindow(since: Date | null): Promise<WindowedFetchResult> {
    const { changedAtByOrderId, completedWindowEnd } = await this.collectChangedOrderIds(since);
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
    // 🔴 실패한 주문이 하나라도 있으면 창을 다 봤다고 말하지 않는다. 그 창의 주문이 **전부**
    // 실패했다면 스냅샷이 0건이라 오케스트레이터가 "변경 없음" 갈래로 들어가는데, 거기서
    // 창의 끝까지 워터마크를 밀면 실패한 주문들이 조회 범위 밖으로 빠져 영영 사라진다 —
    // FIX G 가 없애려던 손실 모드가 다른 문으로 되돌아온다.
    return { snapshots, completedWindowEnd: failedCount > 0 ? null : completedWindowEnd };
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
    if (productOrderIds.length === 0) {
      // 🔴 조용히 `null` 을 내면 그 주문은 **영영 사라진다**: 같은 폴의 다른 항목들이 워터마크를
      // 이 주문 너머로 밀어버리므로 다음 주기의 조회 창에 다시 들어오지 못한다. 변경 피드가
      // 준 주문번호에 상품주문이 하나도 없다는 것은 정상 응답이 아니므로 시끄럽게 실패시킨다 —
      // `fetchOrders` 의 주문 단위 try/catch 가 다른 주문처럼 잡아 건너뛰고, 워터마크는
      // 그 주문 시각 아래에 머문 채 다음 주기가 다시 시도한다(무손실).
      this.logger.warn(`[naver] 주문 ${externalOrderId} 의 상품주문 id 목록이 비어 있다 — 수집을 실패로 처리한다.`);
      throw new Error(`네이버 상품주문 id 목록이 비었다: 주문 ${externalOrderId}`);
    }

    const detailsResponse = await this.client.getOrderDetails(productOrderIds);
    // 🔴 채널 원본을 그대로 들고 간다. 격리 행의 `raw_order` 는 shadow 점검에서 **네이버의 실제
    // 필드명을 확정하는 유일한 창**이라(설계 §7), 여기에 파싱 결과를 넣으면 우리가 이미 안다고
    // 가정한 이름만 되비치고 확정이 불가능해진다.
    const rawProductOrders = detailsResponse.data ?? [];
    const infos = rawProductOrders.map((raw) => parseNaverProductOrderInfo(raw));

    // 문서가 "식별자 단위로 일부만 조회 실패할 수 있다" 고 경고한다. 조용히 빠지면 §6.1 이
    // 막으려던 사고가 그대로 난다. 신원(집합 포함) 검사만으로는 한쪽만 막는다 — 응답이
    // 요청보다 많아서(요청 전부 + 엉뚱한 id 하나 더) 상위집합이 되는 경우는 "요청 id 가
    // 다 있다" 는 조건을 그대로 통과해 엉뚱한 라인이 주문에 섞여 들어간다. 그래서 개수
    // 일치까지 **같이** 요구한다 — 응답은 요청 집합과 정확히 같아야 한다 (FIX 5 재보강).
    const requestedProductOrderIds = new Set(productOrderIds);
    const returnedProductOrderIds = new Set(infos.map((info) => info.productOrderId));
    const missingProductOrderIds = productOrderIds.filter((id) => !returnedProductOrderIds.has(id));
    const unexpectedProductOrderIds = infos
      .map((info) => info.productOrderId)
      .filter((id) => !requestedProductOrderIds.has(id));
    const hasCountMismatch = infos.length !== productOrderIds.length;

    if (missingProductOrderIds.length > 0 || unexpectedProductOrderIds.length > 0 || hasCountMismatch) {
      const missingPart =
        missingProductOrderIds.length > 0 ? `, 누락 [${this.formatIdSample(missingProductOrderIds)}]` : '';
      const unexpectedPart =
        unexpectedProductOrderIds.length > 0 ? `, 예상외 [${this.formatIdSample(unexpectedProductOrderIds)}]` : '';
      throw new Error(
        `네이버 상세 조회 누락: 주문 ${externalOrderId} 요청 ${productOrderIds.length}건, 응답 ${infos.length}건${missingPart}${unexpectedPart}`,
      );
    }

    return this.buildSnapshot(externalOrderId, infos, rawProductOrders, sourceUpdatedAt);
  }

  /** 불일치 메시지에 나열할 id 목록을 상한으로 자른다 — 병적인 응답이 메시지를 무한정 늘리지 못하게. */
  private formatIdSample(ids: string[]): string {
    if (ids.length <= MAX_LISTED_MISMATCHED_IDS) return ids.join(', ');
    const shown = ids.slice(0, MAX_LISTED_MISMATCHED_IDS).join(', ');
    return `${shown} 외 ${ids.length - MAX_LISTED_MISMATCHED_IDS}건`;
  }

  /**
   * `more` 를 따라 창 전체를 훑고, **주문번호 → 그 주문의 최신 변경 시각**을 모은다.
   * 한 주문의 여러 라인이 바뀌었으면 가장 늦은 시각을 취한다 — 워터마크의 근거다.
   *
   * 창을 **끝까지** 훑었고 그 창이 닫혀 있었으면(`lastChangedTo` 를 명시했으면) 창의 끝을 함께
   * 돌려준다. 항목이 0건일 때 워터마크를 여기까지 밀어야 조용한 24시간에 갇히지 않는다.
   * 창이 `now` 에서 끝났다면(열린 창) `null` — 그 창은 시간과 함께 자라므로 영구 정지가 아니고,
   * 성급히 밀면 경계 근처 변경을 잃는다. 페이징이 `MAX_PAGES` 에서 잘렸을 때도 `null` 이다:
   * 창을 끝까지 못 봤으므로 다 봤다고 말할 수 없다.
   */
  private async collectChangedOrderIds(
    since: Date | null,
  ): Promise<{ changedAtByOrderId: Map<string, string>; completedWindowEnd: Date | null }> {
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
      if (!more) {
        return { changedAtByOrderId, completedWindowEnd: explicitTo ? windowEnd : null };
      }
      lastChangedFrom = more.moreFrom;
      moreSequence = more.moreSequence;
    }

    this.logger.warn(`[naver] 변경 피드 페이징이 ${MAX_PAGES}쪽에서 끊겼다 — 다음 주기가 이어받는다.`);
    return { changedAtByOrderId, completedWindowEnd: null };
  }

  private buildSnapshot(
    externalOrderId: string,
    infos: NaverProductOrderInfo[],
    rawProductOrders: unknown[],
    sourceUpdatedAt: string,
  ): ChannelOrderSnapshot {
    const lines = infos.map((info) => this.buildLine(info));
    const live = infos.filter((info) => !OUT_OF_CONTRACT_STATUSES.has(info.productOrderStatus));
    const allOutOfContract = live.length === 0;
    this.warnIfShippingAddressesDiffer(externalOrderId, infos);

    return {
      externalOrderId,
      sourceUpdatedAt,
      paymentState: this.resolvePaymentState(live, allOutOfContract),
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
        // 🔴 해시 전용 총액 — **전 라인** 기준이라 취소로 움직이지 않는다. `total` 을 해시에
        // 쓰면 라인 하나 취소가 곧 "수집 후 변경" 으로 읽혀 replay 가 거부하는 격리가 쌓인다.
        allLinesTotal: infos.reduce((sum, info) => sum + info.lineTotal, 0),
      },
      shippingAddress: infos[0].shippingAddress,
      createdAt: infos[0].paymentDate ?? sourceUpdatedAt,
      lifecycle: this.buildLifecycle(infos, sourceUpdatedAt),
      // 채널 원본 그대로. 파싱 결과를 넣으면 shadow 점검이 필드명을 확정할 수 없다 (설계 §7).
      raw: { externalOrderId, productOrders: rawProductOrders },
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
      // 반품/교환도 "계약에서 빠진 라인" 이라는 점은 취소와 같다 — 표시는 같은 플래그로 한다.
      // 다른 것은 **취소 관측을 내느냐**이고, 그 갈래는 `buildLifecycle` 이 가른다.
      ...(OUT_OF_CONTRACT_STATUSES.has(info.productOrderStatus) ? { cancelled: true } : {}),
    };
  }

  /** `live` 는 계약에 남은 라인만. 전 라인이 빠졌으면 `terminal`. */
  private resolvePaymentState(live: NaverProductOrderInfo[], allOutOfContract: boolean): ChannelPaymentState {
    if (allOutOfContract) return 'terminal';

    // 고객이 취소를 원하는 주문을 출고 파이프라인에 태우지 않는다 (Medusa 의 refund-requested 방어와 대칭).
    if (live.some((info) => info.claimStatus && CANCEL_IN_FLIGHT_CLAIMS.has(info.claimStatus))) return 'pending';
    if (live.every((info) => ACCEPTED_STATUSES.has(info.productOrderStatus))) return 'accepted';
    return 'pending';
  }

  /**
   * **전 라인 취소는 full 1건, 일부 취소는 라인마다 partial 1건.**
   * Core 는 `lines` 유무로 전체/부분을 가르고, 부분취소가 누적돼 전량이 돼도 주문을 닫지 않는다.
   *
   * 반품/교환(`RETURNED`/`EXCHANGED`)은 여기서 **관측을 내지 않는다** — 출고 후 생애주기라
   * `OrderCancelled` 로 보내면 Core 의 출고 증거 가드에 막혀 DLQ 로 사라진다.
   */
  private buildLifecycle(infos: NaverProductOrderInfo[], cancelledAt: string): LifecycleObservation[] {
    const cancelled = infos.filter((info) => CANCELLATION_OBSERVED_STATUSES.has(info.productOrderStatus));
    if (cancelled.length === 0) return [];

    const allCancelled = cancelled.length === infos.length;
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

    // 계약(`OrderCancelledSchema.cancelledLines[].quantity`)이 **양수**를 요구한다. 파서는
    // 0 도 통과시키므로(수량 0 라인이 실재한다는 보고는 없지만 스키마상 가능) 여기서 거른다 —
    // 안 거르면 zod 검증에서 터져 그 관측이 통째로 사라진다.
    const emittable = cancelled.filter((info) => info.quantity > 0);
    const skipped = cancelled.length - emittable.length;
    if (skipped > 0) {
      this.logger.warn(`[naver] 수량이 양수가 아닌 취소 라인 ${skipped}건은 취소 관측에서 제외한다 (계약 위반 방지).`);
    }

    return emittable.map((info) => ({
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
