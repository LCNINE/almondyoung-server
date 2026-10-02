import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { SQL, sql } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { kstMonthStart } from './admin-member-insights.reader';
import { TermsRulesReader } from '../terms/terms-rules.reader';
import {
  ArrearsMovement,
  AttemptNoticeRecord,
  ClassifiedCase,
  NoticeState,
  RecoveryCaseRow,
  RecoveryFunnel,
  RecoveryKpis,
  WeeklyPoint,
  classifyCase,
  kstWeekStart,
  summarizeCases,
  weeklyTrend,
} from './billing-recovery.model';

/** 추이 그래프의 주 수 */
const TREND_WEEKS = 12;
/** 보드 칸마다 내려 주는 카드 수 상한. 넘는 몫은 total 로만 알린다 */
const LANE_LIMIT = 40;
/** 퍼널 칸을 눌렀을 때 보여 줄 그 달 건 목록의 상한 */
const COHORT_LIMIT = 500;
/** «최근 해결» 칸이 보는 기간 */
const RESOLVED_WINDOW_DAYS = 30;
/** 이 일수를 넘긴 미납은 «오래된 미납»으로 알린다 */
const OLD_DEBT_DAYS = 30;
/** 한 건의 실패들은 길어야 며칠 사이에 몰린다. 창 경계에서 건이 잘리지 않게 앞쪽을 이만큼 더 읽는다 */
const CASE_SPAN_MARGIN_DAYS = 14;
/** 알림 경보가 보는 기간 */
const ALERT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export interface OutstandingDebtCard {
  userId: string;
  /** 가장 최근 미납 줄의 계약 — 해지 안내가 나갔는지 물을 때 쓴다 */
  contractId: string;
  amount: number;
  lines: number;
  oldestAt: string;
  causes: string[];
  paying: boolean;
  /** 가장 최근 줄의 해지 안내 기록. 그 기능이 생기기 전 해지면 null */
  finalNotice: { state: NoticeState; reason: string | null } | null;
}

export interface ResolvedCard {
  userId: string;
  /** RETRY = 재시도로 걷음, SETTLED = 미납을 고객이 냄, WAIVED = 면제 */
  how: 'RETRY' | 'SETTLED' | 'WAIVED';
  amount: number | null;
  at: string;
  /** 문제가 생긴 시각(첫 실패·미납 발생) — 얼마 만에 풀렸는지 보여 준다 */
  since: string;
}

export interface RecoveryAlert {
  people: number;
  userIds: string[];
}

export interface BillingRecoveryOverview {
  asOf: string;
  period: { month: string; from: string; toExclusive: string };
  /**
   * 미납 정책·고객 알림 시행 시각(미납 판정이 쓰는 기존 회원 적용일과 같은 값). null 이면 경계 없이 전부 시행 후로 본다.
   */
  policy: { effectiveAt: string | null };
  /** 고른 달에 «시작된» 건 중 정책 시행 후 건의 지금 상태 */
  funnel: RecoveryFunnel;
  kpis: RecoveryKpis;
  /** 같은 달에 정책 시행 «전» 시작된 건 — 알림·미납 대상이 아니었으므로 따로 센다. 없으면 null */
  beforePolicy: { funnel: RecoveryFunnel; kpis: RecoveryKpis } | null;
  /** 퍼널의 건 목록(시작 순, 시행 전·후 모두 — era 로 가른다). 상한을 넘으면 truncated */
  cohort: { cases: ClassifiedCase[]; truncated: boolean };
  /** 지금 상태(기간과 무관) */
  now: {
    outstanding: { amount: number; people: number };
    alerts: {
      lastChance: RecoveryAlert;
      noticeSkipped: RecoveryAlert;
      awaitingResult: RecoveryAlert;
      oldDebt: RecoveryAlert;
      paying: RecoveryAlert;
      mismatch: RecoveryAlert;
    };
    lanes: {
      firstFailure: { total: number; cards: ClassifiedCase[] };
      lastChance: { total: number; cards: ClassifiedCase[] };
      outstanding: { total: number; cards: OutstandingDebtCard[] };
      resolved: { total: number; cards: ResolvedCard[] };
    };
    /** 옛 결제 경로(인보이스 이전)로 재시도 중인 계약 — 이 화면의 건 모델에 들어오지 않는다 */
    legacyRetrying: number;
  };
  trend: WeeklyPoint[];
}

export interface UserRecoveryJourney {
  userId: string;
  cases: ClassifiedCase[];
}

/** 'YYYY-MM' → 한국 시간 그 달 1일 0시 ~ 다음 달 1일 0시 */
export function kstMonthRange(month: string): { from: Date; toExclusive: Date } {
  const [y, m] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1) - 9 * 3600_000),
    toExclusive: new Date(Date.UTC(y, m, 1) - 9 * 3600_000),
  };
}

export function kstMonthOf(at: Date): string {
  return new Date(kstMonthStart(at).getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

const uniq = (ids: string[]) => [...new Set(ids)];
const alert = (ids: string[]): RecoveryAlert => {
  const u = uniq(ids);
  return { people: u.length, userIds: u.slice(0, 200) };
};

/**
 * 출금 실패·미납 처리 현황. 건 하나 = 인보이스 하나의 출금 실패(또는 출금 전 계좌 거절 해지).
 *
 * 사건끼리는 «같은 트랜잭션»으로 잇는다: 실패 기록과 그 회차 알림 기록, 해지 기록과 미납 원장 줄·해지 안내 기록은
 * 각각 한 트랜잭션에서 적히고 created_at 기본값이 트랜잭션 시작 시각(now())이라 값이 정확히 같다.
 * 메타데이터에 서로의 id 를 싣지 않은 옛 기록까지 이을 수 있는 유일한 열쇠다.
 *
 * 부하: membership DB 안의 읽기뿐이고 관리자가 화면을 열 때만 돈다. 사건 표는 event_type 인덱스로 좁힌 뒤
 * 기간으로 자르고, 건마다 붙는 조회는 contract_id 인덱스를 탄다. 다른 서비스를 부르지 않는다.
 */
@Injectable()
export class AdminBillingRecoveryReader {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly termsRulesReader: TermsRulesReader,
  ) {}

  async overview(month: string, now: Date = new Date()): Promise<BillingRecoveryOverview> {
    const { from, toExclusive } = kstMonthRange(month);
    const trendStart = kstWeekStart(new Date(now.getTime() - (TREND_WEEKS - 1) * 7 * DAY_MS));
    const since = new Date(Math.min(from.getTime(), trendStart.getTime()));
    const resolvedSince = new Date(now.getTime() - RESOLVED_WINDOW_DAYS * DAY_MS);
    const alertSince = new Date(now.getTime() - ALERT_WINDOW_DAYS * DAY_MS);

    const [caseRows, arrearsRows, legacyRows, mismatchRows] = await Promise.all([
      this.caseRows(since),
      this.rows(sql`
        SELECT a.user_id, a.contract_id, a.amount, a.status::text AS status, a.cause, a.created_at, a.settled_at,
               (a.pending_intent_id IS NOT NULL) AS paying,
               n.event_type AS notice_event, n.metadata->>'reason' AS notice_reason
        FROM membership_arrears a
        LEFT JOIN LATERAL (
          SELECT x.event_type, x.metadata FROM subscription_contract_events x
          WHERE x.contract_id = a.contract_id
            AND x.event_type IN ('BILLING_NOTICE_QUEUED', 'BILLING_NOTICE_SKIPPED')
            AND x.metadata->>'kind' = 'TERMINATED'
            AND x.created_at = a.created_at
          LIMIT 1
        ) n ON TRUE
        WHERE a.status = 'OUTSTANDING'
           OR a.created_at >= ${since.toISOString()}::timestamptz
           OR a.settled_at >= ${since.toISOString()}::timestamptz
      `),
      this.rows(sql`SELECT COUNT(*) AS n FROM membership_dunning_queue`),
      this.rows(sql`
        SELECT DISTINCT user_id FROM subscription_contract_events
        WHERE event_type = 'ARREARS_SETTLEMENT_MISMATCH' AND created_at >= ${alertSince.toISOString()}::timestamptz
      `),
    ]);

    const policyAt = this.termsRulesReader.existingMembersEffectiveAt();
    const cases = caseRows.map((r) => classifyCase(r, now, policyAt));
    const cohort = cases.filter((c) => {
      const t = Date.parse(c.startedAt);
      return t >= from.getTime() && t < toExclusive.getTime();
    });
    const { funnel, kpis } = summarizeCases(cohort.filter((c) => c.era === 'UNDER_POLICY'));
    const before = cohort.filter((c) => c.era === 'BEFORE_POLICY');

    const retrying = cases
      .filter((c) => c.stage === 'RETRYING')
      .sort(
        (a, b) =>
          a.remainingAttempts - b.remainingAttempts ||
          (a.nextAttempt?.at ?? '').localeCompare(b.nextAttempt?.at ?? '') ||
          a.userId.localeCompare(b.userId),
      );
    const firstFailure = retrying.filter((c) => c.attempts <= 1);
    const lastChance = retrying.filter((c) => c.attempts >= 2);

    const outstandingByUser = new Map<string, OutstandingDebtCard>();
    const resolved: ResolvedCard[] = [];
    const movements: ArrearsMovement[] = [];
    let outstandingAmount = 0;
    for (const r of arrearsRows) {
      const userId = String(r.user_id);
      const amount = num(r.amount);
      const status = String(r.status) as ArrearsMovement['status'];
      const createdAt = iso(r.created_at) as string;
      const settledAt = iso(r.settled_at);
      movements.push({ amount, status, createdAt, settledAt });
      if (status === 'OUTSTANDING') {
        outstandingAmount += amount;
        const notice = r.notice_event
          ? {
              state: (r.notice_event === 'BILLING_NOTICE_QUEUED' ? 'QUEUED' : 'SKIPPED') as NoticeState,
              reason: str(r.notice_reason),
            }
          : null;
        const card = outstandingByUser.get(userId);
        if (!card) {
          outstandingByUser.set(userId, {
            userId,
            contractId: String(r.contract_id),
            amount,
            lines: 1,
            oldestAt: createdAt,
            causes: [String(r.cause)],
            paying: r.paying === true,
            finalNotice: notice,
          });
        } else {
          card.amount += amount;
          card.lines += 1;
          if (createdAt < card.oldestAt) card.oldestAt = createdAt;
          else {
            card.contractId = String(r.contract_id);
            card.finalNotice = notice;
          }
          if (!card.causes.includes(String(r.cause))) card.causes.push(String(r.cause));
          card.paying = card.paying || r.paying === true;
        }
      } else if (settledAt && Date.parse(settledAt) >= resolvedSince.getTime()) {
        resolved.push({
          userId,
          how: status === 'SETTLED' ? 'SETTLED' : 'WAIVED',
          amount,
          at: settledAt,
          since: createdAt,
        });
      }
    }
    for (const c of cases) {
      if (c.stage === 'RECOVERED' && c.recoveredAt && Date.parse(c.recoveredAt) >= resolvedSince.getTime()) {
        resolved.push({
          userId: c.userId,
          how: 'RETRY',
          amount: c.recoveredAmount,
          at: c.recoveredAt,
          since: c.startedAt,
        });
      }
    }
    resolved.sort((a, b) => b.at.localeCompare(a.at));
    const outstanding = [...outstandingByUser.values()].sort(
      (a, b) => a.oldestAt.localeCompare(b.oldestAt) || b.amount - a.amount,
    );

    const oldDebtCutoff = now.getTime() - OLD_DEBT_DAYS * DAY_MS;
    const recentSkips = cases.filter(
      (c) =>
        Date.parse(c.startedAt) >= alertSince.getTime() &&
        (c.attemptNotices.some((n) => n.state === 'SKIPPED') || c.finalNotice?.state === 'SKIPPED'),
    );

    return {
      asOf: now.toISOString(),
      period: { month, from: from.toISOString(), toExclusive: toExclusive.toISOString() },
      policy: { effectiveAt: policyAt ? policyAt.toISOString() : null },
      funnel,
      kpis,
      beforePolicy: before.length > 0 ? summarizeCases(before) : null,
      cohort: { cases: cohort.slice(0, COHORT_LIMIT), truncated: cohort.length > COHORT_LIMIT },
      now: {
        outstanding: { amount: outstandingAmount, people: outstandingByUser.size },
        alerts: {
          lastChance: alert(retrying.filter((c) => c.remainingAttempts === 1).map((c) => c.userId)),
          noticeSkipped: alert(recentSkips.map((c) => c.userId)),
          awaitingResult: alert(cases.filter((c) => c.stage === 'AWAITING_RESULT').map((c) => c.userId)),
          oldDebt: alert(outstanding.filter((d) => Date.parse(d.oldestAt) < oldDebtCutoff).map((d) => d.userId)),
          paying: alert(outstanding.filter((d) => d.paying).map((d) => d.userId)),
          mismatch: alert(mismatchRows.map((r) => String(r.user_id))),
        },
        lanes: {
          firstFailure: { total: firstFailure.length, cards: firstFailure.slice(0, LANE_LIMIT) },
          lastChance: { total: lastChance.length, cards: lastChance.slice(0, LANE_LIMIT) },
          outstanding: { total: outstanding.length, cards: outstanding.slice(0, LANE_LIMIT) },
          resolved: { total: resolved.length, cards: resolved.slice(0, LANE_LIMIT) },
        },
        legacyRetrying: num(legacyRows[0]?.n),
      },
      trend: weeklyTrend(cases, movements, now, TREND_WEEKS),
    };
  }

  /** 한 사람의 건 전부(오래된 것까지) — 카드를 눌렀을 때의 이야기 */
  async journey(userId: string, now: Date = new Date()): Promise<UserRecoveryJourney> {
    const rows = await this.caseRows(new Date(0), userId);
    return {
      userId,
      cases: rows
        .map((r) => classifyCase(r, now, this.termsRulesReader.existingMembersEffectiveAt()))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    };
  }

  private async rows(query: SQL): Promise<Row[]> {
    const result = await this.dbService.db.execute<Row>(query);
    return Array.from(result);
  }

  /** since 이후에 «시작된» 건. userId 를 주면 그 사람 것만. */
  private async caseRows(since: Date, userId?: string): Promise<RecoveryCaseRow[]> {
    const sinceIso = since.toISOString();
    const scanFrom = new Date(Math.max(since.getTime() - CASE_SPAN_MARGIN_DAYS * DAY_MS, 0)).toISOString();
    const byUser = (column: SQL) => (userId ? sql`${column} = ${userId}` : sql`TRUE`);

    const rows = await this.rows(sql`
      WITH fails AS (
        SELECT e.contract_id, e.metadata->>'invoiceId' AS invoice_id,
               MIN(e.user_id) AS user_id,
               MIN(e.created_at) AS started_at,
               MAX(e.created_at) AS last_failed_at,
               MAX((e.metadata->>'attemptNo')::int) AS attempts,
               (array_agg(e.metadata->>'errorCode' ORDER BY e.created_at DESC))[1] AS last_error_code,
               (array_agg(e.metadata->>'nextAttemptAt' ORDER BY e.created_at DESC))[1] AS next_attempt_at,
               jsonb_agg(jsonb_build_object('attemptNo', (e.metadata->>'attemptNo')::int, 'at', e.created_at)
                         ORDER BY e.created_at) AS failures
        FROM subscription_contract_events e
        WHERE e.event_type = 'BILLING_FAILED'
          AND e.metadata ? 'invoiceId'
          AND e.created_at >= ${scanFrom}::timestamptz
          AND ${byUser(sql`e.user_id`)}
        GROUP BY e.contract_id, e.metadata->>'invoiceId'
        HAVING MIN(e.created_at) >= ${sinceIso}::timestamptz
      ),
      withdrawal_cases AS (
        SELECT 'WITHDRAWAL' AS kind, f.contract_id, f.user_id, f.invoice_id, f.started_at, f.last_failed_at,
               f.attempts, f.failures, f.last_error_code, m.error_message AS last_error_message, f.next_attempt_at,
               s.created_at AS recovered_at, s.metadata->>'amount' AS recovered_amount,
               t.created_at AS terminated_at, t.metadata->>'reason' AS terminated_reason
        FROM fails f
        LEFT JOIN LATERAL (
          -- 은행이 준 실패 사유 원문은 같은 트랜잭션의 결제 마커에만 있다
          SELECT b.error_message FROM billing_events b
          WHERE b.contract_id = f.contract_id AND b.event_type = 'CHARGE_FAIL' AND b.created_at = f.last_failed_at
          LIMIT 1
        ) m ON TRUE
        LEFT JOIN LATERAL (
          SELECT x.created_at, x.metadata FROM subscription_contract_events x
          WHERE x.contract_id = f.contract_id AND x.event_type = 'BILLING_SUCCESS'
            AND x.metadata->>'invoiceId' = f.invoice_id
          ORDER BY x.created_at LIMIT 1
        ) s ON TRUE
        LEFT JOIN LATERAL (
          SELECT x.created_at, x.metadata FROM subscription_contract_events x
          WHERE x.contract_id = f.contract_id AND x.event_type = 'TERMINATED' AND x.created_at >= f.started_at
          ORDER BY x.created_at LIMIT 1
        ) t ON TRUE
      ),
      mandate_cases AS (
        SELECT 'MANDATE' AS kind, t.contract_id, t.user_id, NULL::text AS invoice_id, t.created_at AS started_at,
               NULL::timestamptz AS last_failed_at, 0 AS attempts, '[]'::jsonb AS failures,
               NULLIF(split_part(t.metadata->>'reason', ':', 2), '-') AS last_error_code, NULL::text AS last_error_message,
               NULL::text AS next_attempt_at,
               NULL::timestamptz AS recovered_at, NULL::text AS recovered_amount,
               t.created_at AS terminated_at, t.metadata->>'reason' AS terminated_reason
        FROM subscription_contract_events t
        WHERE t.event_type = 'TERMINATED'
          AND t.metadata->>'reason' LIKE 'MANDATE_REJECTED:%'
          AND t.created_at >= ${sinceIso}::timestamptz
          AND ${byUser(sql`t.user_id`)}
          AND NOT EXISTS (SELECT 1 FROM fails f WHERE f.contract_id = t.contract_id AND f.started_at <= t.created_at)
      ),
      cases AS (
        SELECT * FROM withdrawal_cases UNION ALL SELECT * FROM mandate_cases
      )
      SELECT k.*, c.status AS contract_status, p.price AS plan_price,
             a.id AS arrears_id, a.amount AS arrears_amount, a.status::text AS arrears_status,
             (a.pending_intent_id IS NOT NULL) AS arrears_paying, a.created_at AS arrears_created_at,
             a.settled_at AS arrears_settled_at,
             sk.metadata->>'reason' AS arrears_skipped_reason,
             fn.event_type AS final_notice_event, fn.metadata->>'reason' AS final_notice_reason,
             an.notices AS attempt_notices
      FROM cases k
      JOIN subscription_contracts c ON c.id = k.contract_id
      JOIN plan p ON p.id = c.plan_id
      LEFT JOIN LATERAL (
        SELECT * FROM membership_arrears x
        WHERE k.terminated_at IS NOT NULL AND x.contract_id = k.contract_id AND x.created_at = k.terminated_at
        LIMIT 1
      ) a ON TRUE
      LEFT JOIN LATERAL (
        SELECT x.metadata FROM subscription_contract_events x
        WHERE k.terminated_at IS NOT NULL AND x.contract_id = k.contract_id
          AND x.event_type = 'ARREARS_SKIPPED' AND x.created_at = k.terminated_at
        LIMIT 1
      ) sk ON TRUE
      LEFT JOIN LATERAL (
        SELECT x.event_type, x.metadata FROM subscription_contract_events x
        WHERE k.terminated_at IS NOT NULL AND x.contract_id = k.contract_id
          AND x.event_type IN ('BILLING_NOTICE_QUEUED', 'BILLING_NOTICE_SKIPPED')
          AND x.metadata->>'kind' = 'TERMINATED' AND x.created_at = k.terminated_at
        LIMIT 1
      ) fn ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                 'attemptNo', (bf.metadata->>'attemptNo')::int,
                 'state', CASE n.event_type WHEN 'BILLING_NOTICE_QUEUED' THEN 'QUEUED' ELSE 'SKIPPED' END,
                 'reason', n.metadata->>'reason'
               ) ORDER BY bf.created_at) AS notices
        FROM subscription_contract_events bf
        JOIN subscription_contract_events n
          ON n.contract_id = bf.contract_id AND n.created_at = bf.created_at
         AND n.event_type IN ('BILLING_NOTICE_QUEUED', 'BILLING_NOTICE_SKIPPED')
         AND n.metadata->>'kind' = 'ATTEMPT_FAILED'
        WHERE k.invoice_id IS NOT NULL AND bf.contract_id = k.contract_id
          AND bf.event_type = 'BILLING_FAILED' AND bf.metadata->>'invoiceId' = k.invoice_id
      ) an ON TRUE
      ORDER BY k.started_at
    `);

    return rows.map((r) => {
      const notices = Array.isArray(r.attempt_notices) ? (r.attempt_notices as Row[]) : [];
      return {
        kind: r.kind === 'MANDATE' ? 'MANDATE' : 'WITHDRAWAL',
        contractId: String(r.contract_id),
        userId: String(r.user_id),
        invoiceId: str(r.invoice_id),
        startedAt: iso(r.started_at) as string,
        lastFailedAt: iso(r.last_failed_at),
        attempts: num(r.attempts),
        failures: (Array.isArray(r.failures) ? (r.failures as Row[]) : []).map((x) => ({
          attemptNo: num(x.attemptNo),
          at: iso(x.at) as string,
        })),
        lastErrorCode: str(r.last_error_code),
        lastErrorMessage: str(r.last_error_message)?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null,
        nextAttemptAt: str(r.next_attempt_at),
        recoveredAt: iso(r.recovered_at),
        recoveredAmount: r.recovered_amount == null ? null : num(r.recovered_amount),
        terminatedAt: iso(r.terminated_at),
        terminatedReason: str(r.terminated_reason),
        contractStatus: String(r.contract_status),
        planPrice: num(r.plan_price),
        arrears: r.arrears_id
          ? {
              id: String(r.arrears_id),
              amount: num(r.arrears_amount),
              status: String(r.arrears_status) as 'OUTSTANDING' | 'SETTLED' | 'WAIVED',
              paying: r.arrears_paying === true,
              createdAt: iso(r.arrears_created_at) as string,
              settledAt: iso(r.arrears_settled_at),
            }
          : null,
        arrearsSkippedReason: str(r.arrears_skipped_reason),
        attemptNotices: notices.map(
          (n): AttemptNoticeRecord => ({
            attemptNo: num(n.attemptNo),
            state: n.state === 'QUEUED' ? 'QUEUED' : 'SKIPPED',
            reason: str(n.reason),
          }),
        ),
        finalNotice: r.final_notice_event
          ? {
              state: r.final_notice_event === 'BILLING_NOTICE_QUEUED' ? 'QUEUED' : 'SKIPPED',
              reason: str(r.final_notice_reason),
            }
          : null,
      };
    });
  }
}
