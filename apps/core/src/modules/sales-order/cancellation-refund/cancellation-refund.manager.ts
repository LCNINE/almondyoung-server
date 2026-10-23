import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CancelSalesOrderWalletRefundDto } from '../dto/cancel-sales-order.dto';
import { StoreCancelOrderDto, StoreRefundStatus } from '../dto/store-order-actions.dto';
import { cancellationCapabilityOf } from '../order-cancellation/channel-cancellation-capability';
import type { CancelLine } from '../order-cancellation/order-cancellation.types';
import { SalesOrdersService } from '../services/sales-orders.service';
import { WalletRefundClient } from '../services/wallet-refund.client';
import { calculatePartialCancellationRefund } from './partial-cancellation-refund-calculator';
import { REFUND_REQUESTED, REFUND_WAIVED, RefundLinkStatus, RefundPolicy } from './cancellation-refund.types';

type SalesOrderRow = typeof wmsTables.salesOrders.$inferSelect;

const REFUND_RELATION = 'cancellation_linked_wallet_refund';

/**
 * 취소의 «환불» 한 곳 (K7 PR4, 스펙 §5.5). Wallet(`WalletRefundClient.refundByIntent`)을 부르는 취소 쪽 파일은 이것 하나다.
 * 커널은 환불 방침을 `effectFor` 로 취소와 같은 트랜잭션에 기록하고, 커밋 뒤 `executeRequested` 로 실행한다.
 * 환불 기록(타임라인)은 `cancellation_linked_wallet_refund` 링크의 append-only 이력이다 — 최신 행이 현재 상태.
 */
@Injectable()
export class CancellationRefundManager {
  private readonly logger = new Logger(CancellationRefundManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly salesOrdersService: SalesOrdersService,
    private readonly walletRefundClient: WalletRefundClient,
  ) {}

  /**
   * 취소와 같은 트랜잭션에 남길 환불 방침 기록. `SalesOrdersService.cancel()` 의 `walletRefund` 로 넘겨,
   * 취소가 커밋되면 방침도 함께 커밋되고 롤백되면 함께 사라지게 한다.
   * 전체 취소의 금액은 적지 않는다 — 실제 환불액은 실행 시점의 주문 총액이 정한다(스펙 §5.5).
   */
  async effectFor(
    policy: RefundPolicy,
    so: SalesOrderRow,
    lines: CancelLine[] | undefined,
    reasonCode: string | undefined,
    tx: DbTx,
  ): Promise<CancelSalesOrderWalletRefundDto> {
    const actor = policy === 'immediate' ? 'customer' : 'admin';
    const externalRef = so.walletIntentId ? `wallet:intent:${so.walletIntentId}` : `wallet:manual:${so.id}`;
    const common = { intentId: so.walletIntentId ?? null, reasonCode: reasonCode ?? null, actor };

    const partialLines = lines && lines.length > 0 ? lines : null;
    if (!partialLines) {
      if (policy === 'immediate') {
        return { externalRef, refundStatus: REFUND_REQUESTED, metadata: common };
      }
      return {
        externalRef,
        refundStatus: 'manual_pending',
        metadata: { awaitingDecision: true, note: '관리자 환불 결정 대기', ...common },
      };
    }

    // 부분취소는 정책상 자동환불 없음 — 방침과 무관하게 manual_pending. refundEstimateAmount 는 비례 배분 추정값이고
    // 실제 환불은 운영자가 검토 후 결정한다.
    const orderLines = await tx
      .select({
        id: wmsTables.salesOrderLines.id,
        quantity: wmsTables.salesOrderLines.quantity,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
      })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, so.id));
    const result = calculatePartialCancellationRefund({
      salesChannel: so.salesChannel,
      walletIntentId: so.walletIntentId,
      totalAmount: so.totalAmount,
      shippingFee: so.shippingFee ?? 0,
      allOrderLines: orderLines,
      cancelledLines: partialLines,
    });
    return {
      externalRef,
      refundStatus: 'manual_pending',
      metadata: {
        cancellationScope: 'partial',
        manualReason: result.manualReason,
        refundEstimateAmount: result.refundEstimateAmount,
        breakdown: result.breakdown,
        cancelledLines: partialLines,
        warnings: result.warnings,
        awaitingDecision: true,
        note: `부분취소 수동 검토 필요: ${result.manualReason}`,
        ...common,
      },
    };
  }

  /**
   * 커밋 뒤 «즉시 환불» 방침을 실행한다. 판매주문이 `cancelled` 이고 최신 환불 링크가 `requested` 일 때만 Wallet 을 부른다.
   * 상자 후 취소가 박스 작업 중이라 «대기»로 끝났으면 아직 `cancelled` 가 아니다 — 물건이 나갈 수 있는데 돈부터 나가지 않게
   * `requested` 로 남겨 목록에서 결정한다. 이미 실행됐거나 방침이 다르면 null.
   */
  async executeRequested(salesOrderId: string): Promise<StoreRefundStatus | null> {
    const so = await this.findSoOrThrow(salesOrderId);
    if (so.status !== 'cancelled') return null;
    const latest = await this.latestLink(so.id);
    const meta = this.metaOf(latest?.metadata);
    if (meta.refundStatus !== REFUND_REQUESTED) return null;

    const orderCancellationId = meta.orderCancellationId;
    if (typeof orderCancellationId !== 'string') {
      // cancel() 이 항상 넣는 값이다 — 없으면 프로그램 결함이고, correlationId 를 지어내면 Wallet 멱등이 깨진다
      throw new Error(`Refund link of SO ${so.id} has no orderCancellationId`);
    }
    return this.requestWalletRefundAfterCancel(
      so,
      { reasonCode: typeof meta.reasonCode === 'string' ? meta.reasonCode : undefined },
      { actor: 'customer', attemptType: 'initial', correlationId: `cancel:${orderCancellationId}:initial` },
    );
  }

  /**
   * 환불 안 함. 환불 결정 대기 건을 «하지 않기로 했다» 로 닫는다(`completedRefundLinkId` 가 닫는 대상).
   * 이미 닫혔으면 쓰지 않고 그대로 돌려준다 — 두 번 눌러도 이력이 늘지 않는다.
   */
  async waive(
    orderId: string,
    dto: { adminNote?: string; refundLinkId?: string },
  ): Promise<{ refundStatus: 'waived' }> {
    const so = await this.findSoOrThrow(orderId);
    const rows = await this.refundLinks(so.id);
    const closedBy = (id: string) =>
      rows.find((r) => {
        const m = this.metaOf(r.metadata);
        return m.refundStatus === REFUND_WAIVED && m.completedRefundLinkId === id;
      });

    if (!dto.refundLinkId && this.metaOf(rows[0]?.metadata).refundStatus === REFUND_WAIVED) {
      return { refundStatus: REFUND_WAIVED };
    }

    const target = dto.refundLinkId
      ? rows.find((r) => r.id === dto.refundLinkId)
      : rows.find((r, i) => {
          const m = this.metaOf(r.metadata);
          const awaiting = m.refundStatus === 'manual_pending' && m.awaitingDecision === true;
          return (awaiting || (i === 0 && m.refundStatus === REFUND_REQUESTED)) && !this.isClosed(rows, r.id);
        });
    if (target && closedBy(target.id)) return { refundStatus: REFUND_WAIVED };

    const targetStatus = this.metaOf(target?.metadata).refundStatus;
    if (!target || (targetStatus !== 'manual_pending' && targetStatus !== REFUND_REQUESTED)) {
      throw new BadRequestException('환불 결정 대기 건이 없습니다.');
    }

    // 던진다 — tx 를 넘기면 기록 실패가 삼켜지지 않는다. «안 하기로 했다» 가 기록 없이 성공으로 보이면 같은 건이 목록에 남는다
    await this.db.run((trx) =>
      this.recordWalletRefundLink(
        so.id,
        {
          refundStatus: REFUND_WAIVED,
          intentId: so.walletIntentId ?? undefined,
          note: `환불 안 함${dto.adminNote ? `: ${dto.adminNote}` : ''}`,
          actor: 'admin',
          extraMetadata: { completedRefundLinkId: target.id },
        },
        trx,
      ),
    );
    return { refundStatus: REFUND_WAIVED };
  }

  /**
   * 운영자 수동 환불 완료 확인.
   *
   * PG/은행 환불을 이미 외부에서 처리한 사실을 운영자가 확인하고 내부 상태를 완료로 기록한다.
   * provider.refund()를 호출하지 않으므로 "자동 환불 완료"와 명확히 구분된다.
   * - succeeded: 이미 완료 → idempotent 반환
   * - manual_pending / failed / 링크 없음: 새 business link로 succeeded(manual) 기록
   * - pending: 비동기 처리 중 — 결제 관리에서 상태 확인 후 처리하도록 안내
   */
  async completeManually(
    orderId: string,
    dto: { adminNote?: string; refundLinkId?: string },
  ): Promise<{ refundStatus: string; completionType: string }> {
    const so = await this.findSoOrThrow(orderId);

    // Resolve target link: if refundLinkId given, target that specific link;
    // otherwise find the most recent manual_pending link (supports partial cancellations).
    const targetRefundLink = await (async () => {
      if (dto.refundLinkId) {
        return this.db.db
          .select({ id: wmsTables.businessLinks.id, metadata: wmsTables.businessLinks.metadata })
          .from(wmsTables.businessLinks)
          .where(
            and(
              eq(wmsTables.businessLinks.id, dto.refundLinkId),
              eq(wmsTables.businessLinks.sourceType, 'sales_order'),
              eq(wmsTables.businessLinks.sourceId, so.id),
              eq(wmsTables.businessLinks.relationName, REFUND_RELATION),
            ),
          )
          .limit(1)
          .then((r) => r[0]);
      }
      // No refundLinkId: find the most recent manual_pending link that hasn't been
      // closed by a subsequent completion record (same exclusion logic as admin-web UI).
      const rows = await this.refundLinks(so.id);
      return (
        rows.find((r) => this.metaOf(r.metadata).refundStatus === 'manual_pending' && !this.isClosed(rows, r.id)) ??
        null
      );
    })();

    const currentStatus = this.metaOf(targetRefundLink?.metadata).refundStatus;

    // Allow fully-cancelled orders OR orders with a manual_pending link (from partial cancellation).
    if (so.status !== 'cancelled' && currentStatus !== 'manual_pending') {
      throw new BadRequestException('취소된 주문 또는 부분취소 환불 대기 건에만 수동 환불 완료 처리를 할 수 있습니다.');
    }

    if (currentStatus === 'succeeded') {
      return { refundStatus: 'succeeded', completionType: 'manual' };
    }

    if (currentStatus === 'pending') {
      throw new BadRequestException(
        '환불이 처리 중입니다. 결제 > 환불 관리에서 상태를 확인한 후 완료 여부를 판단하세요.',
      );
    }

    await this.recordWalletRefundLink(so.id, {
      refundStatus: 'succeeded',
      intentId: so.walletIntentId ?? undefined,
      note: `운영자 수동 환불 완료 확인${dto.adminNote ? `: ${dto.adminNote}` : ''}`,
      actor: 'admin',
      attemptType: 'retry',
      extraMetadata: {
        completionType: 'manual',
        providerRefundExecuted: false,
        completedRefundLinkId: targetRefundLink?.id ?? null,
      },
    });

    return { refundStatus: 'succeeded', completionType: 'manual' };
  }

  /**
   * 취소 주문의 환불 재시도.
   *
   * - succeeded: 이미 완료 → 재시도 없이 succeeded 반환
   * - pending: 처리 중 → 중복 재시도 없이 pending 반환
   * - waived: 환불하지 않기로 한 주문 → 400
   * - manual_pending (walletIntentId/amount 없음): 자동 재시도 불가 → 400
   * - failed / 링크 없음: 새 idempotency key `cancel:{id}:retry:{uuid}`로 Wallet 재호출
   */
  async retry(orderId: string): Promise<{ refundStatus: string }> {
    const so = await this.findSoOrThrow(orderId);
    if (so.status !== 'cancelled') {
      throw new BadRequestException('취소된 주문에만 환불 재시도를 할 수 있습니다.');
    }

    const refundLink = await this.latestLink(so.id);

    // 채널 경로 주문의 환불은 채널이 한다 — 옛 wallet 환불 링크가 없으면 여기서 wallet 을 부를 근거가 없다.
    if (!refundLink && cancellationCapabilityOf(so.salesChannel).cancel === 'command') {
      throw new BadRequestException('채널 주문의 환불은 채널이 처리합니다.');
    }

    const currentStatus = this.metaOf(refundLink?.metadata).refundStatus;

    if (currentStatus === REFUND_WAIVED) {
      throw new BadRequestException('환불하지 않기로 한 주문입니다.');
    }

    if (currentStatus === 'succeeded') {
      return { refundStatus: 'succeeded' };
    }

    if (currentStatus === 'pending') {
      // 비동기 처리 중 — 중복 재시도 없이 그대로 반환
      return { refundStatus: 'pending' };
    }

    // manual_pending이면서 Wallet 호출에 필요한 정보가 없는 경우 → 수동 처리 필요
    if (!so.walletIntentId) {
      throw new BadRequestException(
        'Wallet 결제 정보가 없어 자동 재시도가 불가합니다. 결제 > 환불 관리에서 수동 처리하세요.',
      );
    }
    if (!so.totalAmount || so.totalAmount <= 0) {
      throw new BadRequestException(
        '환불 금액 정보가 없어 자동 재시도가 불가합니다. 결제 > 환불 관리에서 수동 처리하세요.',
      );
    }

    // failed 또는 링크 없음 → 새 per-attempt key로 실제 PG 재호출
    const refundStatus = await this.requestWalletRefundAfterCancel(
      so,
      {},
      {
        attemptType: 'retry',
        actor: 'admin',
      },
    );
    return { refundStatus };
  }

  /**
   * Core 취소 성공 후 Wallet 환불을 요청하고 결과를 business timeline에 기록한다.
   * Wallet 호출 실패/unavailable은 취소 자체를 롤백하지 않는다.
   *
   * correlationId는 per-attempt UUID를 포함하여 생성된다. 과거 실패 응답이
   * Wallet idempotency에 의해 재생되어 복구를 막는 문제를 방지한다.
   * 중복/초과 환불 방어는 Wallet의 refundable amount 검증이 담당한다.
   */
  async requestWalletRefundAfterCancel(
    so: SalesOrderRow,
    dto: StoreCancelOrderDto,
    options?: {
      attemptType?: 'initial' | 'retry';
      actor?: 'customer' | 'admin' | 'system';
      correlationId?: string;
      amountOverride?: number;
      extraMetadata?: Record<string, unknown>;
      tx?: DbTx;
    },
  ): Promise<StoreRefundStatus> {
    const attemptType = options?.attemptType ?? 'initial';
    const actor = options?.actor ?? 'system';

    if (!so.walletIntentId) {
      this.logger.warn(
        `[WalletRefund] No walletIntentId for SO ${so.id} (channelOrderId=${so.channelOrderId}). ` +
          'Refund must be processed manually.',
      );
      await this.recordWalletRefundLink(
        so.id,
        {
          refundStatus: 'manual_pending',
          note: 'walletIntentId가 없어 수동 처리 필요',
          reasonCode: dto.reasonCode,
          attemptType,
          actor,
          extraMetadata: options?.extraMetadata,
        },
        options?.tx,
      );
      return 'manual_pending';
    }

    const correlationId = options?.correlationId ?? `cancel:${so.id}:${attemptType}:${crypto.randomUUID()}`;
    const amount = options?.amountOverride ?? so.totalAmount;

    if (!amount || amount <= 0) {
      this.logger.warn(`[WalletRefund] SO ${so.id} has invalid amount=${amount}. Skipping auto-refund.`);
      await this.recordWalletRefundLink(
        so.id,
        {
          refundStatus: 'manual_pending',
          note: `amount=${amount} 이 유효하지 않아 수동 처리 필요`,
          intentId: so.walletIntentId,
          reasonCode: dto.reasonCode,
          attemptType,
          actor,
          correlationId,
          extraMetadata: options?.extraMetadata,
        },
        options?.tx,
      );
      return 'manual_pending';
    }

    const outcome = await this.walletRefundClient.refundByIntent(so.walletIntentId, amount, {
      kind: 'ITEM_CANCEL',
      reasonCode: dto.reasonCode ?? 'CUSTOMER_CANCEL',
      reasonMessage: dto.reasonDetail,
      correlationId,
    });

    switch (outcome.kind) {
      case 'success': {
        const refundId = outcome.refunds[0]?.refundId;
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'succeeded',
            intentId: so.walletIntentId,
            refundId,
            amount,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'succeeded';
      }
      case 'partial_pending': {
        const refundId = outcome.refunds[0]?.refundId;
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'pending',
            intentId: so.walletIntentId,
            refundId,
            amount,
            note: '무통장 입금 또는 비동기 처리 중 — Wallet에서 확인 필요',
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'pending';
      }
      case 'already_refunded': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'succeeded',
            intentId: so.walletIntentId,
            amount,
            note: `이미 환불 완료 (Wallet: ${outcome.errorCode})`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'succeeded';
      }
      case 'failed': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'failed',
            intentId: so.walletIntentId,
            amount,
            note: `Wallet 환불 실패: ${outcome.errorCode} — ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'failed';
      }
      case 'wallet_unavailable': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'manual_pending',
            intentId: so.walletIntentId,
            amount,
            note: `Wallet 연결 불가: ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'manual_pending';
      }
      case 'in_flight': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'manual_pending',
            intentId: so.walletIntentId,
            amount,
            note: `환불 처리 중(Idempotency in-flight): ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'manual_pending';
      }
      case 'no_intent_id':
      default: {
        return 'manual_pending';
      }
    }
  }

  async recordWalletRefundLink(
    salesOrderId: string,
    info: {
      refundStatus: RefundLinkStatus;
      intentId?: string;
      refundId?: string;
      amount?: number;
      note?: string;
      reasonCode?: string;
      attemptType?: 'initial' | 'retry';
      actor?: 'customer' | 'admin' | 'system';
      correlationId?: string;
      errorCode?: string;
      errorMessage?: string;
      extraMetadata?: Record<string, unknown>;
    },
    tx?: DbTx,
  ): Promise<void> {
    try {
      await this.salesOrdersService.createBusinessLink(
        salesOrderId,
        {
          relationName: REFUND_RELATION,
          target: {
            type: 'wallet_refund',
            externalRef: info.refundId
              ? `wallet:refund:${info.refundId}`
              : info.intentId
                ? `wallet:intent:${info.intentId}`
                : `wallet:manual:${salesOrderId}`,
          },
          metadata: {
            refundStatus: info.refundStatus,
            intentId: info.intentId ?? null,
            refundId: info.refundId ?? null,
            amount: info.amount ?? null,
            reasonCode: info.reasonCode ?? null,
            note: info.note ?? null,
            attemptType: info.attemptType ?? null,
            actor: info.actor ?? null,
            correlationId: info.correlationId ?? null,
            errorCode: info.errorCode ?? null,
            errorMessage: info.errorMessage ?? null,
            ...(info.extraMetadata ?? {}),
          },
        },
        tx,
      );
    } catch (err) {
      // A keyed single-flight must persist its replay result before releasing
      // the advisory lock. The stable Wallet correlation makes a retry safe.
      if (tx) throw err;
      // Legacy/unkeyed callers retain the historical best-effort timeline behavior.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WalletRefund] Failed to record business link for SO ${salesOrderId}: ${message}`);
    }
  }

  private async findSoOrThrow(id: string): Promise<SalesOrderRow> {
    const so = await this.db.db
      .select()
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, id))
      .limit(1)
      .then((r) => r[0]);
    if (!so) throw new NotFoundException('주문을 찾을 수 없습니다.');
    return so;
  }

  private async latestLink(salesOrderId: string) {
    return this.db.db
      .select({ id: wmsTables.businessLinks.id, metadata: wmsTables.businessLinks.metadata })
      .from(wmsTables.businessLinks)
      .where(
        and(
          eq(wmsTables.businessLinks.sourceType, 'sales_order'),
          eq(wmsTables.businessLinks.sourceId, salesOrderId),
          eq(wmsTables.businessLinks.relationName, REFUND_RELATION),
        ),
      )
      .orderBy(desc(wmsTables.businessLinks.createdAt))
      .limit(1)
      .then((r) => r[0]);
  }

  /** 최근 순 환불 링크 전부 — «닫힌 건» 판정이 뒤 행을 봐야 해서 한 번에 읽는다 */
  private async refundLinks(salesOrderId: string) {
    return this.db.db
      .select({ id: wmsTables.businessLinks.id, metadata: wmsTables.businessLinks.metadata })
      .from(wmsTables.businessLinks)
      .where(
        and(
          eq(wmsTables.businessLinks.sourceType, 'sales_order'),
          eq(wmsTables.businessLinks.sourceId, salesOrderId),
          eq(wmsTables.businessLinks.relationName, REFUND_RELATION),
        ),
      )
      .orderBy(desc(wmsTables.businessLinks.createdAt));
  }

  /** 뒤따른 완료(succeeded)·환불 안 함(waived) 기록이 `completedRefundLinkId` 로 이 링크를 가리키면 닫힌 것이다 */
  private isClosed(rows: Array<{ id: string; metadata: unknown }>, linkId: string): boolean {
    return rows.some((r) => {
      const m = this.metaOf(r.metadata);
      return (m.refundStatus === 'succeeded' || m.refundStatus === REFUND_WAIVED) && m.completedRefundLinkId === linkId;
    });
  }

  /** metadata 는 jsonb(unknown)다 — 키별로 좁혀 읽으려고 레코드로 본다. 없으면 빈 객체 */
  private metaOf(metadata: unknown): Record<string, unknown> {
    // jsonb 컬럼은 객체이거나 null 이다. null/비객체는 빈 객체로 본다
    return metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  }
}
