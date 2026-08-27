import { Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { SearchDbSchema, SearchKeywordIssue, searchKeywordIssues } from './db/schema';

export interface KeywordIssueUpsertInput {
  keywordNorm: string;
  /** 표시용 원 키워드 — 행이 없을 때 최초 기록용 */
  keyword: string;
  status?: SearchKeywordIssue['status'];
  /** null 을 넘기면 비운다. undefined 는 미변경. */
  assigneeId?: string | null;
  assigneeName?: string | null;
  memo?: string | null;
}

/** 키워드 운영 상태(담당·메모·처리 상태) — search 논리 DB 의 유일한 테이블. */
@Injectable()
export class KeywordIssueRepository {
  constructor(
    @InjectTypedDb<SearchDbSchema>()
    private readonly dbService: DbService<SearchDbSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async findByNorms(keywordNorms: string[]): Promise<Map<string, SearchKeywordIssue>> {
    if (keywordNorms.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(searchKeywordIssues)
      .where(inArray(searchKeywordIssues.keywordNorm, keywordNorms));
    return new Map(rows.map((row) => [row.keywordNorm, row]));
  }

  async upsert(input: KeywordIssueUpsertInput): Promise<SearchKeywordIssue> {
    const rows = await this.db
      .insert(searchKeywordIssues)
      .values({
        keywordNorm: input.keywordNorm,
        keyword: input.keyword,
        status: input.status ?? 'new',
        assigneeId: input.assigneeId ?? null,
        assigneeName: input.assigneeName ?? null,
        memo: input.memo ?? null,
      })
      .onConflictDoUpdate({
        target: searchKeywordIssues.keywordNorm,
        set: {
          // undefined 필드는 기존 값 유지, null 은 명시적 비우기.
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.assigneeName !== undefined ? { assigneeName: input.assigneeName } : {}),
          ...(input.memo !== undefined ? { memo: input.memo } : {}),
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return rows[0];
  }
}
