import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseTransferReader, OutstandingTransfer } from './warehouse-transfer.reader';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 체류 판정. 선적 후 임계일을 넘겼거나 ETA 가 지났는데 아직 미도착인 잔량.
 * 순수 함수로 뽑아 DB 없이 검증한다 — 크론 배선은 별도로 확인한다.
 */
export function findStagnant(
  now: Date,
  outstanding: OutstandingTransfer[],
  thresholdDays: number,
): OutstandingTransfer[] {
  return outstanding.filter((row) => {
    if (!row.shippedAt) return false;
    const overThreshold = now.getTime() - row.shippedAt.getTime() > thresholdDays * DAY_MS;
    const pastEta = row.eta !== null && now.getTime() > row.eta.getTime();
    return overThreshold || pastEta;
  });
}

@Injectable()
export class TransferStagnationMonitor {
  private static readonly THRESHOLD_DAYS = 30;
  private readonly logger = new Logger(TransferStagnationMonitor.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: WarehouseTransferReader,
  ) {}

  @Cron('0 4 * * *')
  async report(): Promise<void> {
    const outstanding = await this.dbService.run((trx) => this.reader.findOutstanding(trx));
    const stagnant = findStagnant(new Date(), outstanding, TransferStagnationMonitor.THRESHOLD_DAYS);
    if (stagnant.length === 0) return;

    this.logger.warn(
      `창고간 이동 체류 ${stagnant.length}건: ` +
        stagnant
          .map((row) => `order=${row.transferOrderId} line=${row.transferOrderLineId} qty=${row.outstandingQty}`)
          .join(', '),
    );
  }
}
