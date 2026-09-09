import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb, TxFor } from '@app/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { reviewRewardRules, type UgcServiceSchema } from '../../db/schema';
import { EvaluableRule } from './reward-rule.evaluator';
import {
  ReviewRewardConditions,
  ReviewRewardLimits,
  ReviewRewardSpec,
  ReviewRewardTrigger,
} from './reward-rule.types';

export type UgcTx = TxFor<UgcServiceSchema>;

export interface ReviewRewardRuleRow {
  id: string;
  name: string;
  description: string | null;
  trigger: ReviewRewardTrigger;
  active: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: ReviewRewardConditions;
  reward: ReviewRewardSpec;
  limits: ReviewRewardLimits;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertRuleInput {
  name: string;
  description: string | null;
  trigger: ReviewRewardTrigger;
  active: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: ReviewRewardConditions;
  reward: ReviewRewardSpec;
  limits: ReviewRewardLimits;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * 보상 규칙의 저장·조회. 규칙이 한 건도 활성이 아니면 아무 보상도 나가지 않는다 —
 * 그것이 이 기능의 기본 상태다.
 */
@Injectable()
export class ReviewRewardRuleService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private readonly columns = {
    id: reviewRewardRules.id,
    name: reviewRewardRules.name,
    description: reviewRewardRules.description,
    trigger: reviewRewardRules.trigger,
    active: reviewRewardRules.active,
    priority: reviewRewardRules.priority,
    stopOnMatch: reviewRewardRules.stopOnMatch,
    conditions: reviewRewardRules.conditions,
    reward: reviewRewardRules.reward,
    limits: reviewRewardRules.limits,
    startsAt: reviewRewardRules.startsAt,
    endsAt: reviewRewardRules.endsAt,
    createdAt: reviewRewardRules.createdAt,
    updatedAt: reviewRewardRules.updatedAt,
  };

  async list(filter?: { trigger?: ReviewRewardTrigger; active?: boolean }, tx?: UgcTx): Promise<ReviewRewardRuleRow[]> {
    return this.db.run(async (trx) => {
      const conditions = [
        filter?.trigger ? eq(reviewRewardRules.trigger, filter.trigger) : undefined,
        filter?.active !== undefined ? eq(reviewRewardRules.active, filter.active) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const query = trx.select(this.columns).from(reviewRewardRules);
      const rows = conditions.length
        ? await query.where(and(...conditions)).orderBy(desc(reviewRewardRules.priority), asc(reviewRewardRules.createdAt))
        : await query.orderBy(desc(reviewRewardRules.priority), asc(reviewRewardRules.createdAt));

      return rows;
    }, tx);
  }

  async getById(id: string, tx?: UgcTx): Promise<ReviewRewardRuleRow> {
    const [row] = await this.db.run(
      (trx) => trx.select(this.columns).from(reviewRewardRules).where(eq(reviewRewardRules.id, id)).limit(1),
      tx,
    );

    if (!row) {
      throw new NotFoundException(`리뷰 보상 규칙을 찾을 수 없습니다: ${id}`);
    }

    return row;
  }

  /** 지금 시각에 후보가 되는 규칙들. 기간 창 판정은 evaluator 가 한다 */
  async getActiveRules(trigger: ReviewRewardTrigger, tx?: UgcTx): Promise<(EvaluableRule & { name: string })[]> {
    const rows = await this.list({ trigger, active: true }, tx);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      priority: row.priority,
      stopOnMatch: row.stopOnMatch,
      conditions: row.conditions,
      reward: row.reward,
      limits: row.limits,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
    }));
  }

  async create(input: UpsertRuleInput, adminUserId: string, tx?: UgcTx): Promise<ReviewRewardRuleRow> {
    const [row] = await this.db.run(
      (trx) =>
        trx
          .insert(reviewRewardRules)
          .values({ ...input, createdBy: adminUserId, updatedBy: adminUserId })
          .returning(this.columns),
      tx,
    );

    return row;
  }

  async update(id: string, input: UpsertRuleInput, adminUserId: string, tx?: UgcTx): Promise<ReviewRewardRuleRow> {
    const [row] = await this.db.run(
      (trx) =>
        trx
          .update(reviewRewardRules)
          .set({ ...input, updatedBy: adminUserId, updatedAt: new Date() })
          .where(eq(reviewRewardRules.id, id))
          .returning(this.columns),
      tx,
    );

    if (!row) {
      throw new NotFoundException(`리뷰 보상 규칙을 찾을 수 없습니다: ${id}`);
    }

    return row;
  }

  async setActive(id: string, active: boolean, adminUserId: string, tx?: UgcTx): Promise<ReviewRewardRuleRow> {
    const [row] = await this.db.run(
      (trx) =>
        trx
          .update(reviewRewardRules)
          .set({ active, updatedBy: adminUserId, updatedAt: new Date() })
          .where(eq(reviewRewardRules.id, id))
          .returning(this.columns),
      tx,
    );

    if (!row) {
      throw new NotFoundException(`리뷰 보상 규칙을 찾을 수 없습니다: ${id}`);
    }

    return row;
  }

  async remove(id: string, tx?: UgcTx): Promise<void> {
    const deleted = await this.db.run(
      (trx) => trx.delete(reviewRewardRules).where(eq(reviewRewardRules.id, id)).returning({ id: reviewRewardRules.id }),
      tx,
    );

    if (deleted.length === 0) {
      throw new NotFoundException(`리뷰 보상 규칙을 찾을 수 없습니다: ${id}`);
    }
  }
}
