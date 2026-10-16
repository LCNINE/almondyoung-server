import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import type { ChannelType } from '../../adapters/channel-adapter.factory';
import { SyncStatusService } from '../sync-status.service';
import type { ChannelOrderSource } from '../order-collection/channel-order-source.interface';
import { CoreSalesOrderLookupClient, CoreSalesOrderLookupItem } from '../clients/core-sales-order-lookup.client';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import { RECONCILE_RULES, classifyChannelOrder } from './channel-order-reconcile.classifier';
import { ChannelOrderRedeliveryManager } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import { RECONCILE_ORDER_SOURCES } from './reconcile-order-sources';

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
    const [mappings, quarantined, existing, sync] = await Promise.all([
      this.findings.mappingsByExternalOrderId(channel, ids),
      this.findings.openQuarantineExternalOrderIds(channel, ids),
      this.findings.findOpenByOrders(channel, ids),
      // 폴러의 sync_status 키는 ChannelType 이다. 대사 source 는 medusa 뿐이고 그 값은 두 유니온에 똑같이 있다
      // (`order-poller.orchestrator.ts` 의 `provider.channel as ChannelType` 과 같은 변환).
      this.syncStatus.getSyncStatus(channel as ChannelType, 'orders'),
    ]);
    const outboxFailed = await this.findings.wmsOrderIdsWithFailedOutbox([...mappings.values()]);

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
    for (const snapshot of snapshots) {
      const wmsOrderId = mappings.get(snapshot.externalOrderId) ?? null;
      const coreItem = core.get(snapshot.externalOrderId);
      const verdict = classifyChannelOrder({
        snapshot,
        wmsOrderId,
        openQuarantine: quarantined.has(snapshot.externalOrderId),
        adapterOutboxFailed: wmsOrderId ? outboxFailed.has(wmsOrderId) : false,
        core: {
          salesOrderStatus: coreItem?.salesOrder?.status ?? null,
          openEventFailure: coreItem?.openEventFailure ?? false,
        },
        attemptCountFor: (kind) => attempts.get(`${snapshot.externalOrderId}:${kind}`) ?? 0,
        pollWatermark: watermark,
        now: options.now,
      });
      if (!verdict) continue;

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
        return row.kind === 'missing_order' ? status !== null : status === 'cancelled';
      })
      .map((row) => row.id);
    report.resolved = await this.findings.markResolved(resolvedIds, options.now);

    this.logger.log(
      `[${channel}] 채널 대사(#45): 훑음 ${report.scanned} · 불일치 ${report.findings} · 다시 배달 ${report.redelivered} · 해소 ${report.resolved}`,
    );
    return report;
  }
}
