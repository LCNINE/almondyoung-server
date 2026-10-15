import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { failure_actions } from './dead-letter.schema';
import type { FailureAction, FailureActionKind, FailureActionOutcome } from './dead-letter.types';

export interface FailureActionEntry {
  targetKind: FailureActionKind;
  targetId: number;
  action: FailureAction;
  outcome: FailureActionOutcome;
  actor: string | null;
  note: string | null;
}

export type FailureActionRow = typeof failure_actions.$inferSelect;

/** 사람이 한 조치 (스펙 §5.2). 다시 넣기는 성공·실패와 무관하게 남긴다(스펙 §7.7). */
@Injectable()
export class FailureActionLog {
  constructor(private readonly dbService: DbService) {}

  async record(entry: FailureActionEntry): Promise<void> {
    await this.dbService.db.insert(failure_actions).values({ ...entry, note: entry.note?.slice(0, 2000) ?? null });
  }

  async forTargets(targetKind: FailureActionKind, targetIds: number[]): Promise<FailureActionRow[]> {
    if (targetIds.length === 0) return [];
    return this.dbService.db
      .select()
      .from(failure_actions)
      .where(and(eq(failure_actions.targetKind, targetKind), inArray(failure_actions.targetId, targetIds)))
      .orderBy(desc(failure_actions.id));
  }
}
