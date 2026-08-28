import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { desc, eq } from 'drizzle-orm';
import { analyticsSchema, settingOperatingCosts } from '../../../schema';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface OperatingCostRow {
  id: string;
  monthlyFixedCost: number;
  effectiveFrom: string;
  memo: string | null;
}

/** 한 기간에 귀속된 고정비. 설정이 하나도 없으면 amount 가 null 이다 — 0 으로 뭉개지 않는다. */
export interface OperatingCostForRange {
  /** 기간에 귀속된 고정비 합계(원). 기간 전체가 미설정이면 null. */
  amount: number | null;
  /** 고정비가 설정돼 있지 않아 계산에서 빠진 일수. 0 이면 기간 전체가 설정 구간이다. */
  uncoveredDays: number;
  coveredDays: number;
}

/** 달력일 문자열이 속한 달의 일수. 문자열 산술이라 실행 TZ 와 무관하다. */
export function daysInMonthOf(day: string): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // Date.UTC 의 day=0 은 "그 달의 마지막 날" — 로컬 TZ 를 타지 않는다.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** from~to(포함) 사이의 KST 달력일을 순서대로. UTC 로 순회해 오프셋에 하루가 밀리지 않게 한다. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** 그 날에 적용되는 월 고정비 — effective_from 이 가장 늦으면서 그 날 이하인 설정. 없으면 null. */
export function resolveMonthlyCost(rows: OperatingCostRow[], day: string): number | null {
  let found: OperatingCostRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > day) continue;
    if (!found || row.effectiveFrom > found.effectiveFrom) found = row;
  }
  return found ? found.monthlyFixedCost : null;
}

/**
 * 기간에 귀속되는 고정비를 **일할**로 계산한다.
 * 월 고정비를 그 달의 실제 일수로 나눠 하루치를 만들고 기간의 날짜만큼 더한다 —
 * 28일인 달과 31일인 달의 하루치가 달라야 30일 조회와 한 달 조회가 어긋나지 않는다.
 * 설정 시작일 이전 날짜는 "계산 불가"로 남겨 uncoveredDays 에 센다.
 */
export function prorateOperatingCost(rows: OperatingCostRow[], from: string, to: string): OperatingCostForRange {
  let amount = 0;
  let coveredDays = 0;
  let uncoveredDays = 0;
  for (const day of eachDay(from, to)) {
    const monthly = resolveMonthlyCost(rows, day);
    if (monthly == null) {
      uncoveredDays += 1;
      continue;
    }
    amount += monthly / daysInMonthOf(day);
    coveredDays += 1;
  }
  return { amount: coveredDays === 0 ? null : Math.round(amount), coveredDays, uncoveredDays };
}

@Injectable()
export class OperatingCostService {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly dbService: DbService<typeof analyticsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async list(): Promise<OperatingCostRow[]> {
    const rows = await this.db.select().from(settingOperatingCosts).orderBy(desc(settingOperatingCosts.effectiveFrom));
    return rows.map((row) => ({
      id: row.id,
      monthlyFixedCost: row.monthlyFixedCost,
      effectiveFrom: String(row.effectiveFrom),
      memo: row.memo ?? null,
    }));
  }

  async getForRange(from: string, to: string): Promise<OperatingCostForRange> {
    return prorateOperatingCost(await this.list(), from, to);
  }

  async create(input: { monthlyFixedCost: number; effectiveFrom: string; memo?: string }): Promise<{ id: string }> {
    if (!DATE_ONLY.test(input.effectiveFrom)) {
      throw new BadRequestError('effectiveFrom 은 YYYY-MM-DD 형식이어야 합니다');
    }
    const [existing] = await this.db
      .select({ id: settingOperatingCosts.id })
      .from(settingOperatingCosts)
      .where(eq(settingOperatingCosts.effectiveFrom, input.effectiveFrom))
      .limit(1);
    if (existing) {
      throw new ConflictError(`같은 적용일의 고정비 설정이 이미 있습니다: ${input.effectiveFrom}`);
    }
    const [inserted] = await this.db
      .insert(settingOperatingCosts)
      .values({
        monthlyFixedCost: input.monthlyFixedCost,
        effectiveFrom: input.effectiveFrom,
        memo: input.memo ?? null,
      })
      .returning({ id: settingOperatingCosts.id });
    return { id: inserted.id };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const rows = await this.db
      .delete(settingOperatingCosts)
      .where(eq(settingOperatingCosts.id, id))
      .returning({ id: settingOperatingCosts.id });
    if (rows.length === 0) throw new NotFoundError(`고정비 설정을 찾을 수 없습니다: ${id}`);
    return { deleted: true };
  }
}
