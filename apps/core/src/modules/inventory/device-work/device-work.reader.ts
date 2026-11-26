import { Injectable } from '@nestjs/common';
import { asc, isNull } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../schema/inventory.schema';
import { operationVerdicts } from './operation-verdict';
import type { DeviceWorkRowDto } from './dto/device-work.dto';

const t = wmsTables.deviceUnresolvedOperations;

/** 한 번에 보이는 기기 확인할 일 — 이보다 많으면 오래된 것부터 정리한 뒤 다시 본다 */
const LIST_LIMIT = 500;

@Injectable()
export class DeviceWorkReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 아직 정리되지 않은 기기 확인할 일 — 오래된 것부터, 판정을 붙여서 */
  async listOpen(tx?: DbTx): Promise<DeviceWorkRowDto[]> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(t)
        .where(isNull(t.resolvedAt))
        .orderBy(asc(t.recordedAt), asc(t.operationKey))
        .limit(LIST_LIMIT);
      const verdicts = await operationVerdicts(
        trx,
        rows.map((r) => ({
          operationKey: r.operationKey,
          since: r.recordedAt.getTime() <= r.firstReportedAt.getTime() ? r.recordedAt : r.firstReportedAt,
        })),
        new Date(),
      );
      return rows.map((r) => ({
        operationKey: r.operationKey,
        deviceId: r.deviceId,
        deviceKind: r.deviceKind,
        workerName: r.workerName,
        workName: r.workName,
        summary: r.summary,
        path: r.path,
        deviceStatus: r.deviceStatus,
        attempts: r.attempts,
        errorCode: r.errorCode,
        recordedAt: r.recordedAt.toISOString(),
        lastReportedAt: r.lastReportedAt.toISOString(),
        // 판정이 빠지면 아무 정리도 허락하지 않는 쪽으로 둔다
        verdict: verdicts.get(r.operationKey) ?? 'in_progress',
      }));
    }, tx);
  }
}
