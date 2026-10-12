import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { CancelRequestInput, ChannelCancelRequestManager, SettlementFailedFact } from './channel-cancel-request.manager';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import type { ChannelSettlementFact } from '../services/channel-refund-status';
import {
  CancelRequestView,
  readCancelRequestMetadata,
  toCancelRequestView,
  toSettlementView,
} from './channel-cancel-request.types';

@Injectable()
export class ChannelCancelRequestService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly manager: ChannelCancelRequestManager,
    private readonly reader: ChannelCancelRequestReader,
  ) {}

  request(input: CancelRequestInput): Promise<CancelRequestView> {
    return this.manager.request(input);
  }

  findBySourceKey(salesOrderId: string, sourceKey: string): Promise<CancelRequestView | null> {
    return this.db.run(async (tx) => {
      const row = await this.reader.findBySourceKey(salesOrderId, sourceKey, tx);
      return row ? toCancelRequestView(row) : null;
    });
  }

  /** 고객 환불 배지용 — 정산 칸이 있는 요청만, 최근 순 */
  settlementFactsFor(salesOrderId: string, now: Date = new Date()): Promise<ChannelSettlementFact[]> {
    return this.db.run(async (tx) => {
      const rows = await this.reader.settlementRowsFor(salesOrderId, tx);
      return rows.flatMap((row): ChannelSettlementFact[] => {
        const settlement = readCancelRequestMetadata(row.metadata).settlement;
        if (!settlement) return [];
        if (row.status === 'settling') {
          const view = toSettlementView(row, now);
          return view ? [{ status: 'settling', mode: view.mode, phase: view.phase }] : [];
        }
        return [{ status: 'applied', mode: settlement.mode }];
      });
    });
  }

  retrySettlement(salesOrderId: string, requestId: string): Promise<CancelRequestView> {
    return this.manager.retrySettlement(salesOrderId, requestId);
  }

  switchToManualRefund(salesOrderId: string, requestId: string): Promise<CancelRequestView> {
    return this.manager.switchToManualRefund(salesOrderId, requestId);
  }

  recordSettlementFailure(fact: SettlementFailedFact): Promise<void> {
    return this.manager.recordSettlementFailure(fact);
  }

  settlementFingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    return this.manager.settlementFingerprint(salesOrderId, tx);
  }

  hasSettlementToReissue(salesOrderId: string, now: Date, tx: DbTx): Promise<boolean> {
    return this.manager.hasSettlementToReissue(salesOrderId, now, tx);
  }

  reissueSettlements(salesOrderId: string, now: Date, tx: DbTx): Promise<number> {
    return this.manager.reissueSettlements(salesOrderId, now, tx);
  }
}
