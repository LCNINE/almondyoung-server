import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

/**
 * 검색 키워드 운영 상태. 자동 분류(검색엔진/소싱)는 조회 시점에 계산하고,
 * 여기엔 사람이 지정한 처리 상태·담당·메모만 남는다 — 검색 이벤트가 아니라 운영 데이터라
 * OpenSearch 가 아닌 Postgres 에 둔다.
 */
export const keywordIssueStatusEnum = pgEnum('keyword_issue_status', [
  'new', // 신규 (미처리)
  'dev', // 개발팀 확인 필요 (검색엔진·노출 문제)
  'md', // MD팀 확인 필요 (소싱 부재)
  'in_progress', // 처리 중
  'resolved', // 해소
  'ignored', // 무시 (오타·무관 검색어 등)
]);

export const searchKeywordIssues = pgTable(
  'search_keyword_issues',
  {
    /** 정규화 키워드(trim·공백 정규화·소문자) — search_query_events.keyword_norm 과 같은 규칙 */
    keywordNorm: text('keyword_norm').primaryKey(),
    /** 표시용 원 키워드 (최초 기록 시점의 형태) */
    keyword: text('keyword').notNull(),
    status: keywordIssueStatusEnum('status').notNull().default('new'),
    /** user-service 관리자 계정 id */
    assigneeId: text('assignee_id'),
    /** 표시용 담당자 이름 (지정 시점 스냅샷) */
    assigneeName: text('assignee_name'),
    /** 자유 메모 — 예: "경이로운 = 브랜드명" */
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('search_keyword_issues_status_idx').on(table.status)],
);

export type SearchKeywordIssue = InferSelectModel<typeof searchKeywordIssues>;
export type NewSearchKeywordIssue = InferInsertModel<typeof searchKeywordIssues>;

// DbService 스키마 객체 — enum 은 DrizzleSchema 제약(테이블·릴레이션·뷰)에 안 들어간다.
export const searchDbSchema = { searchKeywordIssues };
export type SearchDbSchema = typeof searchDbSchema;
