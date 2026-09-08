import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, NewSkuDemandProfile } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { assignGrades, computeDemandProfile, DemandPoint } from './demand-profile.calculator';
import { addDays } from './calendar';
import { DemandPattern } from '../policy/classification';

export interface ProfileRefreshResult {
  skus: number;
  byPattern: Record<DemandPattern, number>;
}

const SKU_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 야간 전 SKU 프로필 재계산 (스펙 §4.3). 통계 사실만 저장 — 안전재고 · 재주문점은 B 가 읽는 시점에 계산한다(D5).
 * SKU 500 개씩 시계열을 읽어 메모리를 묶고, 등급은 분류 창 매출 합 한 번으로 전 SKU 에 매긴다.
 */
@Injectable()
export class DemandProfileRefresher {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
  ) {}

  async refreshAll(input: { today: string }, tx?: DbTx): Promise<ProfileRefreshResult> {
    return this.dbService.run(async (trx) => {
      const settings = await this.settingsReader.read(trx);
      const windows = {
        today: input.today,
        classificationWindowDays: settings.classificationWindowDays,
        paramWindowDaysFrequent: settings.paramWindowDaysFrequent,
        paramWindowDaysSparse: settings.paramWindowDaysSparse,
      };
      const thresholds = {
        adiThreshold: settings.adiThreshold,
        cv2Threshold: settings.cv2Threshold,
        minDemandEvents: settings.minDemandEvents,
      };
      const classificationTo = addDays(input.today, -1);
      const classificationFrom = addDays(input.today, -settings.classificationWindowDays);
      const readFrom = addDays(
        input.today,
        -Math.max(settings.classificationWindowDays, settings.paramWindowDaysSparse),
      );

      const skuIds = (
        await trx.select({ id: wmsTables.skus.id }).from(wmsTables.skus).where(eq(wmsTables.skus.isDeleted, false))
      ).map((r) => r.id);

      const firstDates = await this.readFirstDates(trx);
      const amounts = await this.readWindowAmounts(trx, classificationFrom, classificationTo);
      const amountBySku = new Map(skuIds.map((id) => [id, amounts.get(id) ?? 0]));
      const grades = assignGrades(amountBySku, { gradeACut: settings.gradeACut, gradeBCut: settings.gradeBCut });

      const byPattern: Record<DemandPattern, number> = {
        smooth: 0,
        intermittent: 0,
        erratic: 0,
        lumpy: 0,
        insufficient: 0,
        none: 0,
      };
      const computedAt = new Date();

      for (const ids of chunk(skuIds, SKU_CHUNK)) {
        const points = await this.readPoints(trx, ids, readFrom, classificationTo);
        const rows: NewSkuDemandProfile[] = ids.map((skuId) => {
          const stats = computeDemandProfile(
            points.get(skuId) ?? [],
            firstDates.get(skuId) ?? null,
            windows,
            thresholds,
          );
          byPattern[stats.pattern] += 1;
          return {
            skuId,
            pattern: stats.pattern,
            grade: grades.get(skuId) ?? 'C',
            adi: stats.adi,
            cv2: stats.cv2,
            dailyMean: stats.dailyMean,
            dailyStd: stats.dailyStd,
            dailyMean90: stats.dailyMean90,
            sizeMean: stats.sizeMean,
            sizeStd: stats.sizeStd,
            intervalMean: stats.intervalMean,
            historyDays: stats.historyDays,
            demandEvents: stats.demandEvents,
            classificationFrom: stats.classificationFrom,
            classificationTo: stats.classificationTo,
            paramFrom: stats.paramFrom,
            paramTo: stats.paramTo,
            computedAt,
          };
        });
        await this.upsertProfiles(trx, rows, computedAt);
      }

      await trx
        .delete(wmsTables.skuDemandProfiles)
        .where(
          inArray(
            wmsTables.skuDemandProfiles.skuId,
            trx.select({ id: wmsTables.skus.id }).from(wmsTables.skus).where(eq(wmsTables.skus.isDeleted, true)),
          ),
        );

      return { skus: skuIds.length, byPattern };
    }, tx);
  }

  private async readFirstDates(trx: DbTx): Promise<Map<string, string>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, first: sql<string>`MIN(${daily.demandDate})::text` })
      .from(daily)
      .groupBy(daily.skuId);
    return new Map(rows.map((r) => [r.skuId, r.first]));
  }

  private async readWindowAmounts(trx: DbTx, from: string, to: string): Promise<Map<string, number>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, amount: sql<number | string>`COALESCE(SUM(${daily.amount}), 0)::bigint` })
      .from(daily)
      .where(and(gte(daily.demandDate, from), lte(daily.demandDate, to)))
      .groupBy(daily.skuId);
    return new Map(rows.map((r) => [r.skuId, Number(r.amount)]));
  }

  private async readPoints(trx: DbTx, skuIds: string[], from: string, to: string): Promise<Map<string, DemandPoint[]>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, date: daily.demandDate, qty: daily.qty })
      .from(daily)
      .where(and(inArray(daily.skuId, skuIds), gte(daily.demandDate, from), lte(daily.demandDate, to)))
      .orderBy(asc(daily.skuId), asc(daily.demandDate));
    const result = new Map<string, DemandPoint[]>();
    for (const row of rows) {
      const list = result.get(row.skuId) ?? [];
      list.push({ date: row.date, qty: row.qty });
      result.set(row.skuId, list);
    }
    return result;
  }

  private async upsertProfiles(trx: DbTx, rows: NewSkuDemandProfile[], computedAt: Date): Promise<void> {
    if (rows.length === 0) return;
    const p = wmsTables.skuDemandProfiles;
    await trx
      .insert(p)
      .values(rows)
      .onConflictDoUpdate({
        target: p.skuId,
        set: {
          pattern: sql`excluded.pattern`,
          grade: sql`excluded.grade`,
          adi: sql`excluded.adi`,
          cv2: sql`excluded.cv2`,
          dailyMean: sql`excluded.daily_mean`,
          dailyStd: sql`excluded.daily_std`,
          dailyMean90: sql`excluded.daily_mean_90`,
          sizeMean: sql`excluded.size_mean`,
          sizeStd: sql`excluded.size_std`,
          intervalMean: sql`excluded.interval_mean`,
          historyDays: sql`excluded.history_days`,
          demandEvents: sql`excluded.demand_events`,
          classificationFrom: sql`excluded.classification_from`,
          classificationTo: sql`excluded.classification_to`,
          paramFrom: sql`excluded.param_from`,
          paramTo: sql`excluded.param_to`,
          computedAt,
          updatedAt: computedAt,
        },
      });
  }
}
