import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { analyticsSchema, settingRevenueGoalMonths, settingRevenueGoals } from '../../../schema';

export const GOAL_SCOPES = ['own_mall', 'all_channels'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];

export interface PlanAssumptions {
  dailySessions: number;
  orderConversionRate: number;
  averageOrderValue: number;
  externalDailyRevenue: number;
}

export interface RevenueGoal {
  id: string;
  year: number;
  scope: GoalScope;
  annualTarget: number;
  /** 1~12월 순서. 합 = annualTarget. */
  monthlyTargets: number[];
  preCoverageActual: number | null;
  planAssumptions: PlanAssumptions | null;
  memo: string | null;
  createdAt: string;
}

export interface CreateRevenueGoalInput {
  year: number;
  scope?: GoalScope;
  annualTarget: number;
  monthlyTargets?: number[];
  preCoverageActual?: number | null;
  planAssumptions?: PlanAssumptions | null;
  memo?: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 연간 목표를 월별 일수에 비례해 나눈다. 원 단위 반올림 오차는 12월에 몰아 합이 정확히 목표와 같게 한다 —
 * 합이 1원이라도 어긋나면 «계획 누적»과 «연간 목표»가 다른 숫자를 말하게 된다.
 */
export function allocateByDays(year: number, annualTarget: number): number[] {
  const days = Array.from({ length: 12 }, (_, i) => daysInMonth(year, i + 1));
  const total = days.reduce((a, b) => a + b, 0);
  const months = days.map((d) => Math.floor((annualTarget * d) / total));
  months[11] += annualTarget - months.reduce((a, b) => a + b, 0);
  return months;
}

@Injectable()
export class RevenueGoalService {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly dbService: DbService<typeof analyticsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  /** 그 해의 목표 이력(최신 먼저). 첫 행이 현재 목표다. */
  async listForYear(year: number): Promise<RevenueGoal[]> {
    const goals = await this.db
      .select()
      .from(settingRevenueGoals)
      .where(eq(settingRevenueGoals.year, year))
      .orderBy(desc(settingRevenueGoals.createdAt), desc(settingRevenueGoals.id));
    if (goals.length === 0) return [];
    const months = await this.db
      .select()
      .from(settingRevenueGoalMonths)
      .where(inArray(settingRevenueGoalMonths.goalId, goals.map((g) => g.id)))
      .orderBy(asc(settingRevenueGoalMonths.month));
    return goals.map((goal) => {
      const monthlyTargets = Array.from({ length: 12 }, () => 0);
      for (const row of months) {
        if (row.goalId === goal.id) monthlyTargets[row.month - 1] = row.target;
      }
      return {
        id: goal.id,
        year: goal.year,
        scope: goal.scope === 'all_channels' ? 'all_channels' : 'own_mall',
        annualTarget: goal.annualTarget,
        monthlyTargets,
        preCoverageActual: goal.preCoverageActual ?? null,
        planAssumptions: (goal.planAssumptions as PlanAssumptions | null) ?? null,
        memo: goal.memo ?? null,
        createdAt: goal.createdAt.toISOString(),
      };
    });
  }

  async getCurrent(year: number): Promise<RevenueGoal | null> {
    const [current] = await this.listForYear(year);
    return current ?? null;
  }

  async create(input: CreateRevenueGoalInput): Promise<{ id: string }> {
    const monthlyTargets = input.monthlyTargets ?? allocateByDays(input.year, input.annualTarget);
    if (monthlyTargets.length !== 12) {
      throw new BadRequestError('월별 목표는 12개여야 합니다');
    }
    const sum = monthlyTargets.reduce((a, b) => a + b, 0);
    if (sum !== input.annualTarget) {
      throw new BadRequestError(`월별 목표의 합(${sum})이 연간 목표(${input.annualTarget})와 다릅니다`);
    }
    return this.dbService.run(async (trx) => {
      const [goal] = await trx
        .insert(settingRevenueGoals)
        .values({
          year: input.year,
          scope: input.scope ?? 'own_mall',
          annualTarget: input.annualTarget,
          preCoverageActual: input.preCoverageActual ?? null,
          planAssumptions: input.planAssumptions ?? null,
          memo: input.memo ?? null,
        })
        .returning({ id: settingRevenueGoals.id });
      await trx
        .insert(settingRevenueGoalMonths)
        .values(monthlyTargets.map((target, i) => ({ goalId: goal.id, month: i + 1, target })));
      return { id: goal.id };
    });
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const rows = await this.db
      .delete(settingRevenueGoals)
      .where(eq(settingRevenueGoals.id, id))
      .returning({ id: settingRevenueGoals.id });
    if (rows.length === 0) throw new NotFoundError(`매출 목표를 찾을 수 없습니다: ${id}`);
    return { deleted: true };
  }
}
