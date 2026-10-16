import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import type { ChannelType } from '../../adapters/channel-adapter.factory';
import { SyncStatusService } from '../sync-status.service';
import type { ChannelOrderSource } from '../order-collection/channel-order-source.interface';
import { CoreSalesOrderLookupClient, CoreSalesOrderLookupItem } from '../clients/core-sales-order-lookup.client';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import { isSyncableChannel } from '../order-collection/syncable-channels';
import { RECONCILE_RULES, classifyChannelOrder, coreCanAcceptCancel, isJudgeable } from './channel-order-reconcile.classifier';
import { ChannelOrderRedeliveryManager } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import { RECONCILE_ORDER_SOURCES } from './reconcile-order-sources';

/** 사람의 [다시 배달]을 지금 막아야 하는 이유. 저장된 사유가 아니라 지금 상태로 정한다(리뷰 I-3). */
export type ManualRedeliveryBlock = 'event_failure_open' | 'in_flight' | 'already_in_core' | 'core_status';

export interface ReconcileCycleReport {
  channel: string;
  scanned: number;
  findings: number;
  redelivered: number;
  resolved: number;
  skipped?: 'no_source' | 'core_unavailable';
}

/** 채널 대사 한 주기 (#1016 45번 스펙 §5~§7). 크론과 처음 한 번 훑기가 같이 쓴다. */
@Injectable()
export class ChannelOrderReconcileManager {
  private readonly logger = new Logger(ChannelOrderReconcileManager.name);

  constructor(
    @Inject(RECONCILE_ORDER_SOURCES) private readonly sources: ChannelOrderSource[],
    private readonly findings: OrderReconcileFindingRepository,
    private readonly coreLookup: CoreSalesOrderLookupClient,
    private readonly redelivery: ChannelOrderRedeliveryManager,
    private readonly syncStatus: SyncStatusService,
  ) {}

  async runCycle(
    channel: SalesChannel,
    options: { updatedAfter: Date; now: Date; observeOnly: boolean },
  ): Promise<ReconcileCycleReport> {
    const report: ReconcileCycleReport = { channel, scanned: 0, findings: 0, redelivered: 0, resolved: 0 };
    const source = this.sources.find((candidate) => candidate.channel === channel);
    if (!source) return { ...report, skipped: 'no_source' };

    const snapshots = await source.fetchOrders(options.updatedAfter);
    report.scanned = snapshots.length;
    const ids = snapshots.map((snapshot) => snapshot.externalOrderId);
    const [mappings, quarantined, existing, closedAt, sync] = await Promise.all([
      this.findings.mappingsByExternalOrderId(channel, ids),
      this.findings.openQuarantineExternalOrderIds(channel, ids),
      this.findings.findOpenByOrders(channel, ids),
      this.findings.latestClosedAt(channel, ids),
      // 폴러의 sync_status 키는 ChannelType 이다. 대사 source 는 medusa 뿐이고 그 값은 두 유니온에 똑같이 있다
      // (`order-poller.orchestrator.ts` 의 `provider.channel as ChannelType` 과 같은 변환).
      this.syncStatus.getSyncStatus(channel as ChannelType, 'orders'),
    ]);
    const outbox = await this.findings.outboxStateByWmsOrderId([...mappings.values()]);

    let core: Map<string, CoreSalesOrderLookupItem>;
    let open: OrderReconcileFinding[];
    try {
      core = await this.coreLookup.lookup(
        channel,
        ids.map((externalOrderId) => ({ externalOrderId, wmsOrderId: mappings.get(externalOrderId) })),
      );
      open = await this.findings.listOpen(channel);
      const openCore = await this.coreLookup.lookup(
        channel,
        open.filter((row) => !core.has(row.externalOrderId)).map((row) => ({ externalOrderId: row.externalOrderId })),
      );
      core = new Map([...core, ...openCore]);
    } catch (error) {
      // «core 가 모른다»를 «SO 없음»으로 읽지 않는다 — 주기를 통째로 건너뛴다.
      this.logger.warn(`[${channel}] core 판매주문 조회 실패로 이번 대사를 건너뛴다: ${errorMessage(error)}`);
      return { ...report, skipped: 'core_unavailable' };
    }

    const watermark = sync?.lastSyncAt ?? null;
    const attempts = new Map(existing.map((row) => [`${row.externalOrderId}:${row.kind}`, row.attemptCount]));
    // 이번 주기에 «지금 상태로 판정했다»고 말할 수 있는 주문과, 그중 여전히 어긋난 (주문, 종류). 해소 확인이 쓴다(리뷰 I-2).
    const judged = new Set<string>();
    const stillMismatched = new Set<string>();
    for (const snapshot of snapshots) {
      const wmsOrderId = mappings.get(snapshot.externalOrderId) ?? null;
      const coreItem = core.get(snapshot.externalOrderId);
      const inFlight = wmsOrderId ? outbox.inFlight.has(wmsOrderId) : false;
      const isQuarantined = quarantined.has(snapshot.externalOrderId);
      // 격리된 주문은 0단계 격리 칸이 센다 — 열린 대사 행은 닫아 이중으로 세지 않는다
      if (isQuarantined || (!inFlight && isJudgeable(snapshot, watermark, options.now))) {
        judged.add(snapshot.externalOrderId);
      }
      const verdict = classifyChannelOrder({
        snapshot,
        wmsOrderId,
        openQuarantine: isQuarantined,
        adapterOutboxFailed: wmsOrderId ? outbox.failed.has(wmsOrderId) : false,
        adapterOutboxInFlight: inFlight,
        core: {
          salesOrderStatus: coreItem?.salesOrder?.status ?? null,
          openEventFailure: coreItem?.openEventFailure ?? false,
        },
        attemptCountFor: (kind) => attempts.get(`${snapshot.externalOrderId}:${kind}`) ?? 0,
        pollWatermark: watermark,
        now: options.now,
      });
      if (!verdict) continue;
      const key = `${snapshot.externalOrderId}:${verdict.kind}`;
      stillMismatched.add(key);
      // 사람이 닫은 뒤 채널이 바뀌지 않았으면 같은 어긋남이다 — 다시 열지 않는다(리뷰 I-1)
      const closed = closedAt.get(key);
      if (closed && new Date(snapshot.sourceUpdatedAt).getTime() <= closed.getTime()) continue;

      const mode = options.observeOnly ? 'observe' : RECONCILE_RULES[verdict.kind].mode;
      const willAct = mode === 'act' && verdict.handling === 'auto';
      const finding = await this.findings.upsertOpen({
        channel,
        externalOrderId: snapshot.externalOrderId,
        displayOrderNo: snapshot.displayOrderNo ?? null,
        kind: verdict.kind,
        handling: verdict.handling,
        humanReason: verdict.humanReason,
        coreStatus: verdict.coreStatus,
        channelCreatedAt: new Date(snapshot.createdAt),
        mode,
        lastResult: verdict.handling === 'human' ? 'skipped' : willAct ? 'pending' : 'would_act',
        seenAt: options.now,
      });
      report.findings += 1;
      if (!willAct) continue;
      try {
        await this.redelivery.redeliver(finding);
        report.redelivered += 1;
      } catch (error) {
        // 적재는 롤백됐다 — 시도로 세어 상한이 무한 재시도를 끊게 한다.
        await this.findings.recordAttempt(finding.id, `error: ${errorMessage(error)}`);
      }
    }

    const resolvedIds = open
      .filter((row) => {
        const status = core.get(row.externalOrderId)?.salesOrder?.status ?? null;
        const fixedInCore = row.kind === 'missing_order' ? status !== null : status === 'cancelled';
        // 지금 상태로 판정했는데 그 종류의 어긋남이 아니다 — pending 이 됐거나 수집 전 취소 등(리뷰 I-2)
        const noLongerMismatched =
          judged.has(row.externalOrderId) && !stillMismatched.has(`${row.externalOrderId}:${row.kind}`);
        return fixedInCore || noLongerMismatched;
      })
      .map((row) => row.id);
    report.resolved = await this.findings.markResolved(resolvedIds, options.now);

    this.logger.log(
      `[${channel}] 채널 대사(#45): 훑음 ${report.scanned} · 불일치 ${report.findings} · 다시 배달 ${report.redelivered} · 해소 ${report.resolved}`,
    );
    return report;
  }

  /**
   * 사람의 [다시 배달] 직전 판정 (리뷰 I-3·I-5). 크론은 3일 창 밖 행을 다시 판정하지 않으므로 저장된 `human_reason` 은 낡을 수 있다.
   * core 조회 실패는 던진다 — «모른다»를 «막을 이유 없음»으로 읽지 않는다.
   */
  async manualRedeliveryBlock(
    finding: Pick<OrderReconcileFinding, 'channel' | 'externalOrderId' | 'kind'>,
  ): Promise<ManualRedeliveryBlock | null> {
    const channel = finding.channel;
    // 대사 행은 대사 가능한 채널에서만 생긴다 — 아니면 저장값이 깨진 것이다
    if (!isSyncableChannel(channel)) throw new Error(`Unsupported reconcile channel: ${channel}`);
    const mappings = await this.findings.mappingsByExternalOrderId(channel, [finding.externalOrderId]);
    const wmsOrderId = mappings.get(finding.externalOrderId);
    if (wmsOrderId) {
      const outbox = await this.findings.outboxStateByWmsOrderId([wmsOrderId]);
      if (outbox.failed.has(wmsOrderId)) return 'event_failure_open';
      if (outbox.inFlight.has(wmsOrderId)) return 'in_flight';
    }
    const core = await this.coreLookup.lookup(channel, [{ externalOrderId: finding.externalOrderId, wmsOrderId }]);
    const item = core.get(finding.externalOrderId);
    if (item?.openEventFailure) return 'event_failure_open';
    const status = item?.salesOrder?.status ?? null;
    if (finding.kind === 'missing_order') return status !== null ? 'already_in_core' : null;
    if (status === 'cancelled') return 'already_in_core';
    return coreCanAcceptCancel(status) ? null : 'core_status';
  }
}
