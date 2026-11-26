import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../schema/inventory.schema';
import { lockOperationKey } from '../core/services/operation-key-guard';
import { DECIDED_VERDICTS, operationVerdicts, type OperationVerdict } from './operation-verdict';
import type { ReportUnresolvedOperationsDto } from './dto/device-work.dto';

/** 화면을 연 뒤 그 작업의 판정이 바뀌었다(기기가 그사이 다시 보냈거나 다른 관리자가 정리했다). */
export class DeviceWorkVerdictChangedError extends ConflictError {
  constructor() {
    super('그사이 이 작업의 상태가 바뀌었어요. 목록을 다시 확인해 주세요.');
  }
  getErrorCode(): string {
    return 'DEVICE_WORK_VERDICT_CHANGED';
  }
}

const earliest = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

const t = wmsTables.deviceUnresolvedOperations;

@Injectable()
export class DeviceWorkManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * 기기가 지금 남은 결과 모름을 통째로 올린다. 목록에서 빠진 것은 기기가 스스로 정리한 것으로 닫고,
   * 서버에서 결과가 정해진 키를 돌려준다. 같은 보고를 두 번 받거나 옛 보고가 늦게 와도 결과가 같다.
   */
  async report(actorId: string, deviceId: string, dto: ReportUnresolvedOperationsDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      await trx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`device-report:${deviceId}:${actorId}`}, 0))`,
      );
      const marks = wmsTables.deviceReportMarks;
      const [mark] = await trx
        .select({ seq: marks.reportSeq })
        .from(marks)
        .where(and(eq(marks.deviceId, deviceId), eq(marks.actorId, actorId)))
        .limit(1);
      // 늦게 도착한 옛 보고(또는 같은 보고를 다시 받은 것) — 기기가 그 뒤에 보낸 목록이 이미 반영돼 있다
      if (mark && dto.reportSeq <= mark.seq) return { decided: [] };
      const now = new Date();
      await trx
        .insert(marks)
        .values({ deviceId, actorId, reportSeq: dto.reportSeq, reportedAt: now })
        .onConflictDoUpdate({
          target: [marks.deviceId, marks.actorId],
          set: { reportSeq: dto.reportSeq, reportedAt: now },
        });
      const keys = dto.operations.map((o) => o.operationKey);
      if (dto.operations.length)
        await trx
          .insert(t)
          .values(
            dto.operations.map((o) => ({
              operationKey: o.operationKey,
              deviceId,
              deviceKind: dto.deviceKind,
              actorId,
              workerName: dto.workerName ?? null,
              method: o.method,
              path: o.path,
              workName: o.workName,
              summary: o.summary ?? null,
              deviceStatus: o.status,
              attempts: o.attempts,
              errorCode: o.errorCode ?? null,
              recordedAt: new Date(o.recordedAt),
              firstReportedAt: now,
              lastReportedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: t.operationKey,
            set: {
              workerName: sql`excluded.worker_name`,
              deviceKind: sql`excluded.device_kind`,
              summary: sql`excluded.summary`,
              deviceStatus: sql`excluded.device_status`,
              attempts: sql`excluded.attempts`,
              errorCode: sql`excluded.error_code`,
              lastReportedAt: now,
              // 기기가 정리했다고 닫았던 것이 다시 올라오면 아직 남은 것이다. 관리자가 정리한 것은 그대로 둔다
              resolvedAt: sql`CASE WHEN ${t.resolution} = 'device' THEN NULL ELSE ${t.resolvedAt} END`,
              resolvedBy: sql`CASE WHEN ${t.resolution} = 'device' THEN NULL ELSE ${t.resolvedBy} END`,
              resolution: sql`CASE WHEN ${t.resolution} = 'device' THEN NULL ELSE ${t.resolution} END`,
            },
            // 다른 기기·다른 작업자의 기록은 덮지 않는다
            setWhere: and(eq(t.deviceId, sql`excluded.device_id`), eq(t.actorId, sql`excluded.actor_id`)),
          });
      await trx
        .update(t)
        .set({ resolvedAt: now, resolution: 'device', resolvedBy: actorId })
        .where(
          and(
            eq(t.deviceId, deviceId),
            eq(t.actorId, actorId),
            isNull(t.resolvedAt),
            keys.length ? notInArray(t.operationKey, keys) : undefined,
          ),
        );
      const saved = keys.length
        ? await trx
            .select({ key: t.operationKey, recordedAt: t.recordedAt, firstReportedAt: t.firstReportedAt })
            .from(t)
            .where(and(eq(t.deviceId, deviceId), eq(t.actorId, actorId), inArray(t.operationKey, keys)))
        : [];
      const verdicts = await operationVerdicts(
        trx,
        saved.map((row) => ({ operationKey: row.key, since: earliest(row.recordedAt, row.firstReportedAt) })),
        now,
      );
      return { decided: [...verdicts].filter(([, v]) => DECIDED_VERDICTS.has(v)).map(([key]) => key) };
    }, tx);
  }

  /**
   * 관리자 정리. abandon 은 서버에 아무것도 없는 작업만 버리고 그 키를 잠근다 — 키를 쓰는 요청과 같은 잠금으로 줄을 서므로
   * 버리는 사이 기기가 보낸 요청이 먼저 반영됐으면 거절된다. dismiss 는 결과가 정해진 작업을 목록에서만 뺀다.
   * 같은 정리를 다시 보내면 그대로 돌려준다.
   */
  async resolve(actorId: string, operationKey: string, action: 'abandon' | 'dismiss', tx?: DbTx) {
    const resolution = action === 'abandon' ? 'abandoned' : 'dismissed';
    return this.dbService.run(async (trx) => {
      await lockOperationKey(trx, operationKey);
      const [row] = await trx.select().from(t).where(eq(t.operationKey, operationKey)).for('update').limit(1);
      if (!row) throw new NotFoundError('기기 확인할 일을 찾지 못했어요.');
      if (row.resolvedAt) {
        if (row.resolution === resolution) return { operationKey, resolution };
        throw new DeviceWorkVerdictChangedError();
      }
      const now = new Date();
      const verdict: OperationVerdict | undefined = (
        await operationVerdicts(trx, [{ operationKey, since: earliest(row.recordedAt, row.firstReportedAt) }], now)
      ).get(operationKey);
      const allowed: ReadonlySet<OperationVerdict | undefined> =
        action === 'abandon' ? new Set(['not_applied']) : new Set(['applied', 'rejected', 'abandoned', 'expired']);
      if (!allowed.has(verdict)) throw new DeviceWorkVerdictChangedError();
      // 판정할 수 없게 된 작업도 키를 잠가 둔다 — 늦게 온 요청이 반영되지 않게
      if (verdict === 'not_applied' || verdict === 'expired')
        await trx
          .insert(wmsTables.abandonedOperationKeys)
          .values({ operationKey, abandonedBy: actorId })
          .onConflictDoNothing();
      await trx
        .update(t)
        .set({ resolvedAt: now, resolution, resolvedBy: actorId })
        .where(eq(t.operationKey, operationKey));
      return { operationKey, resolution };
    }, tx);
  }
}
