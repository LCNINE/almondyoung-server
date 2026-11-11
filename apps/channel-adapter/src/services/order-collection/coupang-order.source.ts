import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { CoupangOrderClient } from '../../adapters/coupang/clients/coupang-order.client.service';
import { CoupangReturnClient } from '../../adapters/coupang/clients/coupang-return.client.service';
import type { GetReturnRequestsParams } from '../../zods/coupang';
import { CoupangLongIdSchema } from '../../zods/coupang/coupang-common.zod';
import {
  ChannelOrderFetchFailure,
  ChannelOrderLineSnapshot,
  ChannelOrderSnapshot,
  ChannelPaymentState,
  LifecycleObservation,
  ReplayableChannelOrderSource,
  WindowedChannelOrderSource,
  WindowedFetchResult,
} from './channel-order-source.interface';
import {
  CoupangCancelReceiptInfo,
  CoupangOrderItemInfo,
  CoupangOrderSheetInfo,
  parseCoupangCancelReceipt,
  parseCoupangOrderSheet,
} from './coupang-order-fields';

/**
 * 이 source 가 부르는 발주서 조회. **응답은 해석 전 원본으로 받는다** — 해석은 `coupang-order-fields.ts` 한 곳이다.
 * 클라이언트의 zod 추론 타입(`CoupangOrderSheet`)은 실제로 검증된 적이 없는 값이라(쿠팡 시각엔 offset 이 없을 수 있다)
 * 여기서 믿지 않는다. `CoupangOrderClient` 가 그대로 이 모양을 만족한다.
 */
export interface CoupangOrderSheetReader {
  getAllOrderSheetsByStatus(createdAtFrom: string, createdAtTo: string, status: string): Promise<readonly unknown[]>;
  getSingleOrderSheetByOrderId(orderId: string): Promise<{ data?: readonly unknown[] | null }>;
}

/** 취소 접수(출고중지요청·즉시취소) 목록 조회. `CoupangReturnClient` 가 그대로 이 모양을 만족한다. */
export interface CoupangCancelReceiptReader {
  getReturnRequests(params: GetReturnRequestsParams): Promise<{ data?: readonly unknown[] | null; nextToken?: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/**
 * 결제완료·상품준비중·출고중지요청을 훑는 폭. 일 단위 조회의 상한(31일)이다.
 * **결제완료는 시간선이 아니라 대기열이다**(스펙 §4.1) — 우리가 수집 즉시 상품준비중으로 넘기므로 결제완료 목록은
 * «아직 우리 손을 안 탄 주문»이고, 셀메이트가 못 보낸 오래된 주문도 여기 남아 있어 넘겨받기가 이걸로 된다.
 * 🔴 «31일» 이 양 끝 날짜를 포함해 받아들여지는지는 리허설(스펙 §4.8)에서 확인한다 — 거절되면 이 값만 고친다.
 */
const SCAN_LOOKBACK_DAYS = 31;
/** 즉시취소 스캔의 최초 실행 바닥값. 그 뒤로는 워터마크(`since`)부터 묻는다. */
const INSTANT_CANCEL_FIRST_RUN_MS = DAY_MS;
/** 취소 접수 목록 무한 페이징 방어. 50건 × 40쪽 = 2000건으로, 우리 주문량에서 도달할 수 없다. */
const MAX_RECEIPT_PAGES = 40;
const RECEIPTS_PER_PAGE = 50;

/** 우리가 매 주기 통째로 훑는 발주서 상태. 순서가 뜻이 있다 — 뒤 스캔이 같은 상자의 더 늦은 상태다. */
const SCANNED_SHEET_STATUSES: ReadonlyArray<'ACCEPT' | 'INSTRUCT'> = ['ACCEPT', 'INSTRUCT'];
/** 판매자 확인을 기다리는 출고중지요청 — 이것만 `needsApproval`. */
const RELEASE_STOP_AWAITING_APPROVAL = 'RELEASE_STOP_UNCHECKED';

/** 해석에 실패한 원 응답에서 주문번호만이라도 읽는다 — 읽히면 그 주문만 격리하고, 안 읽히면 주기를 멈춘다. */
const OrderIdOnlySchema = z.looseObject({ orderId: CoupangLongIdSchema });

interface ParsedSheet {
  info: CoupangOrderSheetInfo;
  raw: unknown;
}

type ReceiptKind = 'release-stop' | 'instant-cancel';

interface RawReceipt {
  kind: ReceiptKind;
  raw: unknown;
}

interface ParsedReceipt extends RawReceipt {
  info: CoupangCancelReceiptInfo;
}

@Injectable()
export class CoupangOrderSource implements ReplayableChannelOrderSource, WindowedChannelOrderSource {
  readonly channel: SalesChannel = 'coupang';
  private readonly logger = new Logger(CoupangOrderSource.name);

  constructor(
    @Inject(CoupangOrderClient) private readonly orderClient: CoupangOrderSheetReader,
    @Inject(CoupangReturnClient) private readonly returnClient: CoupangCancelReceiptReader,
  ) {}

  async fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]> {
    const { snapshots } = await this.fetchOrdersInWindow(since);
    return snapshots;
  }

  /**
   * 한 주기 = 결제완료 스캔 + 상품준비중 스캔 + 출고중지요청(`RU`) 스캔(셋 다 지금−31일 ~ 지금) + 즉시취소
   * (`cancelType=CANCEL`) 스캔(`since` ~ 지금, 31일 상한).
   *
   * 🔴 **스캔 호출이 하나라도 실패하면 주기 전체를 throw 한다.** 결제완료 스캔만 성공하고 상품준비중 스캔이 실패한
   * 주기를 그대로 내면, 두 상태에 걸친 주문이 상자 하나가 빠진 채로 들어와 줄이 사라진 것처럼 보인다. 오케스트레이터가
   * 주기 실패로 기록하고 워터마크를 멈추며, 다음 주기가 통째로 다시 훑는다.
   *
   * 주문 단위의 실패(해석 불가·단건 조회 실패·같은 옵션 두 줄)는 그 주문만 `fetchFailures` 로 올린다 — 오케스트레이터가
   * 처리 실패 행으로 기록하고 재시도한다(#1016 1번 행).
   */
  async fetchOrdersInWindow(since: Date | null): Promise<WindowedFetchResult> {
    const cycleStartedAt = new Date();
    // 매 주기 통째로 다시 훑으므로 «채널이 말한 변경 시각» 이 따로 없다. 주기 시작 시각이 워터마크 근거이고,
    // 경계 손실이 없다(다음 주기가 같은 범위를 또 본다).
    const changedAt = cycleStartedAt.toISOString();
    const scanFrom = new Date(cycleStartedAt.getTime() - SCAN_LOOKBACK_DAYS * DAY_MS);
    const instantCancelFrom = new Date(
      Math.max(
        (since ?? new Date(cycleStartedAt.getTime() - INSTANT_CANCEL_FIRST_RUN_MS)).getTime(),
        scanFrom.getTime(),
      ),
    );
    const today = toKstDate(cycleStartedAt);

    const rawSheets: unknown[] = [];
    for (const status of SCANNED_SHEET_STATUSES) {
      rawSheets.push(
        ...(await this.orderClient.getAllOrderSheetsByStatus(`${toKstDate(scanFrom)}+09:00`, `${today}+09:00`, status)),
      );
    }
    const rawReleaseStops = await this.collectReceipts({
      status: 'RU',
      cancelType: 'RETURN',
      createdAtFrom: toKstDate(scanFrom),
      createdAtTo: today,
      maxPerPage: RECEIPTS_PER_PAGE,
    });
    const rawInstantCancels = await this.collectReceipts({
      cancelType: 'CANCEL',
      createdAtFrom: toKstDate(instantCancelFrom),
      createdAtTo: today,
      maxPerPage: RECEIPTS_PER_PAGE,
    });

    const fetchFailures: ChannelOrderFetchFailure[] = [];
    const failedOrderIds = new Set<string>();
    const recordFailure = (orderId: string, error: unknown) => {
      if (failedOrderIds.has(orderId)) return;
      const message = error instanceof Error ? error.message : String(error);
      failedOrderIds.add(orderId);
      fetchFailures.push({ externalOrderId: orderId, changedAt, error: message });
      this.logger.error(`[coupang] 주문 ${orderId} 수집 실패 — 처리 실패로 올린다: ${message}`);
    };

    const sheetsByOrder = this.groupSheets(rawSheets, recordFailure);
    const receiptsByOrder = this.groupReceipts(
      [
        ...rawReleaseStops.map((raw): RawReceipt => ({ kind: 'release-stop', raw })),
        ...rawInstantCancels.map((raw): RawReceipt => ({ kind: 'instant-cancel', raw })),
      ],
      recordFailure,
    );

    // 스캔에 없는 주문의 취소 접수 — 상품준비중을 지나 이미 출고 중이거나(출고중지요청), 즉시취소로 결제완료 목록에서
    // 빠졌다. 단건 조회로 채워야 그 주문의 취소 관측이 나간다.
    for (const [orderId, receipts] of receiptsByOrder) {
      if (sheetsByOrder.has(orderId) || failedOrderIds.has(orderId)) continue;
      try {
        const sheets = await this.fetchSheetsByOrderId(orderId);
        if (sheets.length > 0) {
          sheetsByOrder.set(orderId, sheets);
        } else if (receipts.some((receipt) => receipt.kind === 'release-stop')) {
          throw new Error(`쿠팡 발주서 단건 조회가 비었다: 출고중지요청이 있는 주문 ${orderId}`);
        } else {
          // 즉시취소만 있는 주문 — 관측할 발주서가 없다. 매 주기 처리 실패 행을 만들면 격리함이 소음으로 찬다.
          this.logger.warn(`[coupang] 즉시취소된 주문 ${orderId} 의 발주서 단건 조회가 비었다 — 이번 주기는 건너뛴다.`);
        }
      } catch (error) {
        recordFailure(orderId, error);
      }
    }

    const snapshots: ChannelOrderSnapshot[] = [];
    for (const [orderId, sheets] of sheetsByOrder) {
      if (failedOrderIds.has(orderId)) continue;
      try {
        snapshots.push(this.buildSnapshot(orderId, sheets, receiptsByOrder.get(orderId) ?? [], changedAt));
      } catch (error) {
        recordFailure(orderId, error);
      }
    }

    this.logger.log(
      `[coupang] 발주서 ${rawSheets.length}상자·출고중지요청 ${rawReleaseStops.length}건·즉시취소 ${rawInstantCancels.length}건 → 주문 ${snapshots.length}건, 수집 실패 ${fetchFailures.length}건`,
    );
    // 실패가 있으면 창을 다 봤다고 말하지 않는다 — 네이버와 같은 마지막 방어선(항목이 있으면 이 값은 쓰이지 않는다).
    return { snapshots, fetchFailures, completedWindowEnd: fetchFailures.length > 0 ? null : cycleStartedAt };
  }

  /**
   * replay·즉시 끌어오기 전용 단건. 주기 스캔과 같은 스냅샷을 만들되 취소 접수는 싣지 않는다 — replay 는 주문 후보만
   * 다시 처리하고, 출고중지요청은 다음 주기 스캔이 다시 준다. 실패는 그대로 throw 한다.
   */
  async fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null> {
    const sheets = await this.fetchSheetsByOrderId(externalOrderId);
    if (sheets.length === 0) return null;
    return this.buildSnapshot(externalOrderId, sheets, [], new Date().toISOString());
  }

  private async fetchSheetsByOrderId(orderId: string): Promise<ParsedSheet[]> {
    const response = await this.orderClient.getSingleOrderSheetByOrderId(orderId);
    const sheets = dedupeByShipmentBox(
      (response.data ?? []).map((raw) => ({ info: parseCoupangOrderSheet(raw), raw })),
    );
    const foreign = sheets.filter((sheet) => sheet.info.orderId !== orderId);
    if (foreign.length > 0) {
      throw new Error(
        `쿠팡 발주서 단건 조회가 다른 주문을 돌려줬다: 요청 ${orderId}, 응답 ${foreign.map((sheet) => sheet.info.orderId).join(', ')}`,
      );
    }
    return sheets;
  }

  /** `nextToken` 을 따라 끝까지 받는다. 쿠팡은 마지막 쪽에서 빈 문자열을 준다. */
  private async collectReceipts(params: GetReturnRequestsParams): Promise<unknown[]> {
    const receipts: unknown[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_RECEIPT_PAGES; page++) {
      const response = await this.returnClient.getReturnRequests({ ...params, ...(nextToken ? { nextToken } : {}) });
      const data = response.data ?? [];
      if (!isUnknownArray(data)) {
        throw new Error(`쿠팡 취소 접수 목록 응답이 배열이 아니다 (cancelType=${params.cancelType})`);
      }
      receipts.push(...data);
      if (!response.nextToken) return receipts;
      nextToken = response.nextToken;
    }
    // 다 못 본 목록으로 주기를 끝내지 않는다 — 빠진 쪽의 출고중지요청이 그 주기에 사라진다.
    throw new Error(`쿠팡 취소 접수 목록 페이징이 ${MAX_RECEIPT_PAGES}쪽을 넘었다 (cancelType=${params.cancelType})`);
  }

  /**
   * 발주서를 해석해 `orderId` 로 묶는다. 같은 상자가 두 스캔에 다 잡히면(스캔 사이에 결제완료 → 상품준비중) 뒤 스캔의
   * 값 하나만 둔다 — 안 그러면 같은 품목이 두 줄로 보여 그 주문이 «같은 옵션 두 줄» 로 격리된다.
   */
  private groupSheets(
    rawSheets: unknown[],
    recordFailure: (orderId: string, error: unknown) => void,
  ): Map<string, ParsedSheet[]> {
    const byOrder = new Map<string, Map<string, ParsedSheet>>();
    for (const raw of rawSheets) {
      const info = this.parseOrIsolate(raw, parseCoupangOrderSheet, recordFailure);
      if (!info) continue;
      const boxes = byOrder.get(info.orderId) ?? new Map<string, ParsedSheet>();
      boxes.set(info.shipmentBoxId, { info, raw });
      byOrder.set(info.orderId, boxes);
    }
    return new Map([...byOrder].map(([orderId, boxes]) => [orderId, [...boxes.values()]]));
  }

  private groupReceipts(
    rawReceipts: RawReceipt[],
    recordFailure: (orderId: string, error: unknown) => void,
  ): Map<string, ParsedReceipt[]> {
    const byOrder = new Map<string, Map<string, ParsedReceipt>>();
    for (const { kind, raw } of rawReceipts) {
      const info = this.parseOrIsolate(raw, parseCoupangCancelReceipt, recordFailure);
      if (!info) continue;
      const receipts = byOrder.get(info.orderId) ?? new Map<string, ParsedReceipt>();
      // 페이지 경계에서 같은 접수가 두 번 올 수 있다 — 접수번호로 한 번만.
      receipts.set(`${kind}:${info.receiptId}`, { kind, info, raw });
      byOrder.set(info.orderId, receipts);
    }
    return new Map([...byOrder].map(([orderId, receipts]) => [orderId, [...receipts.values()]]));
  }

  /**
   * 해석에 실패하면 주문번호만이라도 읽어 그 주문을 격리한다. 주문번호조차 못 읽으면 어느 주문을 막을지 모르므로
   * 주기를 멈춘다 — 조용히 버리면 그 주문은 아무 흔적 없이 수집에서 빠진다.
   */
  private parseOrIsolate<T>(
    raw: unknown,
    parse: (raw: unknown) => T,
    recordFailure: (orderId: string, error: unknown) => void,
  ): T | null {
    try {
      return parse(raw);
    } catch (error) {
      const orderId = OrderIdOnlySchema.safeParse(raw);
      if (!orderId.success) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`쿠팡 응답을 해석하지 못했고 주문번호도 읽을 수 없다 — 주기를 멈춘다: ${message}`);
      }
      recordFailure(orderId.data.orderId, error);
      return null;
    }
  }

  private buildSnapshot(
    externalOrderId: string,
    sheets: ParsedSheet[],
    receipts: ParsedReceipt[],
    sourceUpdatedAt: string,
  ): ChannelOrderSnapshot {
    const infos = sheets.map((sheet) => sheet.info);
    const items = infos.flatMap((info) => info.items);
    this.assertDistinctVendorItems(externalOrderId, items);
    this.warnIfShippingAddressesDiffer(externalOrderId, infos);

    const allCancelled = items.every(isFullyCancelled);
    const shipping = infos.reduce((sum, info) => sum + info.shippingPrice, 0);
    const liveSubtotal = items.reduce((sum, entry) => sum + liveQuantity(entry) * entry.unitPrice, 0);

    return {
      externalOrderId,
      sourceUpdatedAt,
      paymentState: this.resolvePaymentState(infos, allCancelled),
      customerId: null,
      lines: items.map((entry) => this.buildLine(externalOrderId, entry)),
      amounts: {
        // 계약 총액 — 살아 있는 수량만. 취소분을 넣으면 Core 합계가 부푼다.
        total: liveSubtotal + shipping,
        subtotal: liveSubtotal,
        shipping,
        discount: 0,
        currency: 'KRW',
        // 🔴 해시 전용 총액 — 전 품목 기준이라 취소로 움직이지 않는다(인터페이스 주석).
        allLinesTotal: items.reduce((sum, entry) => sum + entry.orderPrice, 0) + shipping,
      },
      shippingAddress: infos[0].shippingAddress,
      ...(allCancelled ? { orderCancelled: true } : {}),
      createdAt: infos[0].paidAt,
      lifecycle: [
        ...this.buildCancellations(externalOrderId, items, sourceUpdatedAt),
        ...this.buildCancelRequests(externalOrderId, receipts),
      ],
      // 채널 원본 그대로 — 리허설·격리함이 쿠팡의 실제 필드를 확정하는 창이다.
      raw: {
        externalOrderId,
        orderSheets: sheets.map((sheet) => sheet.raw),
        cancelReceipts: receipts.map((receipt) => receipt.raw),
      },
    };
  }

  /**
   * 줄 키가 `${orderId}:${vendorItemId}` 라 같은 옵션이 두 줄이면 키가 겹친다. 문서로 확인하지 못한 모양이라
   * 추측해 합치지 않고 그 주문을 격리한다(스펙 §4.2) — 처리 실패 행으로 격리함에 보인다.
   */
  private assertDistinctVendorItems(externalOrderId: string, items: CoupangOrderItemInfo[]): void {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const entry of items) {
      if (seen.has(entry.vendorItemId)) duplicated.add(entry.vendorItemId);
      seen.add(entry.vendorItemId);
    }
    if (duplicated.size > 0) {
      throw new Error(
        `쿠팡 주문 ${externalOrderId} 에 같은 옵션 두 줄 (vendorItemId ${[...duplicated].join(', ')}) — 줄을 추측하지 않고 격리한다`,
      );
    }
  }

  /** Core 계약은 주문당 배송지 하나 — 첫 상자 배송지를 쓰되, 상자마다 다르면 흔적을 남긴다(네이버와 같다). */
  private warnIfShippingAddressesDiffer(externalOrderId: string, infos: CoupangOrderSheetInfo[]): void {
    const first = JSON.stringify(infos[0].shippingAddress);
    if (infos.some((info) => JSON.stringify(info.shippingAddress) !== first)) {
      this.logger.warn(
        `[coupang] 주문 ${externalOrderId} 의 상자별 배송지가 서로 다르다 — 첫 상자 배송지를 주문 대표값으로 쓴다.`,
      );
    }
  }

  private buildLine(orderId: string, entry: CoupangOrderItemInfo): ChannelOrderLineSnapshot {
    return {
      channelOrderItemId: channelOrderItemIdOf(orderId, entry.vendorItemId),
      channelProductId: entry.vendorItemId,
      productName: entry.productName,
      // 원 수량이다. 일부 취소는 줄 단위 `OrderCancelled` 가 «이 줄의 취소 수량은 이만큼» 으로 알린다.
      quantity: entry.shippingCount,
      unitPrice: entry.unitPrice,
      // 전량 취소된 줄은 빼지 않고 표시만 한다 — 빼면 변경 해시가 흔들린다.
      ...(isFullyCancelled(entry) ? { cancelled: true } : {}),
    };
  }

  /**
   * - 전 품목 전량 취소 → `terminal`. 상자가 결제완료로 남아 있어도 만들 판매주문이 없다(빈 주문을 만들지 않는다).
   * - 상자 하나라도 결제완료 → `accepted`. 결제완료는 «아직 우리 손을 안 탄 주문» 이다.
   * - 그 밖(상품준비중 이후뿐) → `pending`. 우리가 이미 수집한 주문이면 변화만 흐르고(매핑이 있다), 매핑이 없으면
   *   셀메이트 몫이라 만들지 않는다(3번 결정, 오케스트레이터의 `eligibleForOrderCreation` 갈래).
   */
  private resolvePaymentState(infos: CoupangOrderSheetInfo[], allCancelled: boolean): ChannelPaymentState {
    if (allCancelled) return 'terminal';
    if (infos.some((info) => info.status === 'ACCEPT')) return 'accepted';
    return 'pending';
  }

  /**
   * 취소 확정(`cancelCount`)을 관측으로 옮긴다. 전 품목 전량이면 주문 단위 한 건, 아니면 취소가 있는 줄마다 한 건이며
   * 수량은 «N개 더» 가 아니라 그 줄의 누적 취소 수량이다. 키에 수량을 넣어 같은 상태의 재관측은 한 번만 낸다.
   *
   * `holdCountForCancel`(환불 예정)은 관측을 내지 않는다 — 같은 수량이 출고중지요청으로도 오므로 두 번 세게 된다.
   */
  private buildCancellations(
    orderId: string,
    items: CoupangOrderItemInfo[],
    cancelledAt: string,
  ): LifecycleObservation[] {
    const cancelled = items.filter((entry) => entry.cancelCount > 0);
    if (cancelled.length === 0) return [];

    if (items.every(isFullyCancelled)) {
      return [
        {
          eventType: 'OrderCancelled',
          eventKey: 'cancelled',
          payload: {
            reason: 'CUSTOMER_REQUEST',
            reasonDetail: '쿠팡 주문 취소 수집',
            cancelledBy: 'coupang',
            cancelledAt,
            refundRequired: false,
          },
          rawEvent: { orderId, vendorItemIds: items.map((entry) => entry.vendorItemId) },
        },
      ];
    }

    return cancelled.map((entry): LifecycleObservation => {
      const channelOrderItemId = channelOrderItemIdOf(orderId, entry.vendorItemId);
      return {
        eventType: 'OrderCancelled',
        eventKey: `cancelled:${channelOrderItemId}:${entry.cancelCount}`,
        payload: {
          reason: 'CUSTOMER_REQUEST',
          reasonDetail: '쿠팡 주문 일부 취소 수집',
          cancelledBy: 'coupang',
          cancelledAt,
          refundRequired: false,
          cancelledLines: [{ channelOrderItemId, quantity: entry.cancelCount }],
        },
        rawEvent: {
          orderId,
          vendorItemId: entry.vendorItemId,
          shippingCount: entry.shippingCount,
          cancelCount: entry.cancelCount,
        },
      };
    });
  }

  /**
   * 출고중지요청 접수 하나 = `ChannelCancelRequested` 하나(#1283 계약). 승인 API 대상·중복 판정 모두 접수번호다 —
   * 출고중지완료는 접수 단위로만 처리된다(스펙 §2). 철회 뒤 재요청은 쿠팡이 새 접수번호를 주는 것으로 본다.
   * 즉시취소 접수는 승인할 요청이 아니라 관측을 내지 않는다 — 그 취소는 발주서의 `cancelCount` 가 낸다.
   */
  private buildCancelRequests(orderId: string, receipts: ParsedReceipt[]): LifecycleObservation[] {
    return receipts.flatMap((receipt): LifecycleObservation[] => {
      if (receipt.kind !== 'release-stop') return [];
      const { info } = receipt;
      // 계약은 양수 수량만 받는다.
      const items = info.items
        .filter((entry) => entry.cancelCount > 0)
        .map((entry) => ({
          channelOrderItemId: channelOrderItemIdOf(orderId, entry.vendorItemId),
          quantity: entry.cancelCount,
        }));
      if (items.length === 0) {
        this.logger.warn(
          `[coupang] 출고중지요청 ${info.receiptId} 에 양수 수량 품목이 없다 — 취소요청 관측에서 제외한다.`,
        );
        return [];
      }
      const lineSum = items.reduce((sum, entry) => sum + entry.quantity, 0);
      if (lineSum !== info.cancelCountSum) {
        // 승인부는 접수 전체 수량으로 출고중지완료를 부른다. 줄 합이 다르면 리허설에서 볼 수 있게 남긴다.
        this.logger.warn(
          `[coupang] 출고중지요청 ${info.receiptId} 의 품목 합(${lineSum})이 접수 수량(${info.cancelCountSum})과 다르다.`,
        );
      }
      return [
        {
          eventType: 'ChannelCancelRequested',
          eventKey: `cancel-request:${info.receiptId}`,
          payload: {
            channelRequestRef: info.receiptId,
            channelRequestKey: info.receiptId,
            needsApproval: info.receiptStatus === RELEASE_STOP_AWAITING_APPROVAL,
            requestedAt: info.createdAt,
            items,
          },
          rawEvent: {
            receiptId: info.receiptId,
            receiptStatus: info.receiptStatus,
            cancelCountSum: info.cancelCountSum,
          },
        },
      ];
    });
  }
}

/** 응답 봉투가 타입대로 왔는지 런타임에 본다 — 타입은 검증된 적 없는 약속일 뿐이다. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function channelOrderItemIdOf(orderId: string, vendorItemId: string): string {
  return `${orderId}:${vendorItemId}`;
}

function liveQuantity(entry: CoupangOrderItemInfo): number {
  return Math.max(0, entry.shippingCount - entry.cancelCount);
}

function isFullyCancelled(entry: CoupangOrderItemInfo): boolean {
  return entry.cancelCount === entry.shippingCount;
}

/** 같은 상자가 두 번 오면 뒤의 것 하나만. */
function dedupeByShipmentBox(sheets: ParsedSheet[]): ParsedSheet[] {
  return [...new Map(sheets.map((sheet) => [sheet.info.shipmentBoxId, sheet])).values()];
}

/** 그 순간의 KST 날짜(`yyyy-MM-dd`). 쿠팡 일 단위 조회의 날짜는 KST 다. */
function toKstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
