import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { SQL, sql } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { INVOICE_MAX_ATTEMPTS } from '../billing/invoice-billing.manager';

/**
 * 관리자가 회원을 «사람» 기준으로 보는 축. 레코드 상태(활성·만료…)가 아니라
 * 「누구에게 무슨 조치가 필요한가」로 나눈다.
 *  - arrears   미납 요금이 남은 사람
 *  - past_due  출금이 실패해 재시도를 기다리는 사람
 *  - good      좋은 손님(판정 기준은 GOOD_CUSTOMER_CRITERIA)
 *  - ending    해지 예약 — 이용 종료가 다가오는 사람
 */
export const MEMBER_AXES = ['arrears', 'past_due', 'good', 'ending'] as const;
export type MemberAxis = (typeof MEMBER_AXES)[number];

/**
 * 좋은 손님 판정 기준. 화면이 이 값을 그대로 보여 준다 — 숫자를 바꾸면 화면 문구도 같이 바뀐다.
 *  - 첫 결제가 minTenureDays 이전이고, 결제로 산 이용일(플랜 기간 합)도 minPaidDays 이상
 *  - 최근 failureLookbackMonths 개월 출금 실패 0번
 *  - 미납 기록이 한 번도 없음(갚은 것 포함)
 *  - 지금 이용 중(해지 예약·일시정지 포함)
 * 결제 기록이 하나도 없는 이용자(관리자 지급·이관)는 «아님»이 아니라 «판정 불가»로 따로 센다.
 */
export const GOOD_CUSTOMER_CRITERIA = {
  minTenureDays: 180,
  minPaidDays: 180,
  failureLookbackMonths: 12,
  topShare: 0.1,
} as const;

export interface MembershipInsights {
  asOf: string;
  /** 이번 달(한국 시간) 1일 0시. 「이번 달」 수치의 기준점. */
  monthStart: string;
  arrears: {
    outstandingAmount: number;
    outstandingPeople: number;
    outstandingLines: number;
    /** 가장 오래 남아 있는 미납 줄이 생긴 시각 */
    oldestOutstandingAt: string | null;
    thisMonth: { createdAmount: number; createdLines: number; settledAmount: number; waivedAmount: number };
    /**
     * 지금까지 생긴 미납의 행방. 금액은 현재 금액 기준이라 금액 조정으로 줄인 몫은 어디에도 없다.
     * 받아낸 비율 = settled ÷ (settled + waived + outstanding).
     */
    lifetime: { settledAmount: number; waivedAmount: number; outstandingAmount: number };
    /** 납부 금액이 청구와 맞지 않았던 기록(최근 30일) — 사람이 봐야 하는 건 */
    recentMismatches: number;
  };
  pastDue: {
    people: number;
    /** 다음 실패면 이용이 끝나는 사람 */
    lastChance: number;
    /** 이들의 한 주기 요금 합(플랜가 기준) */
    amountAtRisk: number;
  };
  good: {
    people: number;
    /** 지금 이용 중인 사람(해지 예약·일시정지 포함) */
    activePeople: number;
    /** 이용 중이지만 결제 기록이 없어 판정하지 못한 사람 */
    undeterminedPeople: number;
    /** 좋은 손님이 낸 멤버십 요금 합 / 전체 회원이 낸 멤버십 요금 합(둘 다 환불 제외) */
    paidAmount: number;
    allPaidAmount: number;
    criteria: typeof GOOD_CUSTOMER_CRITERIA;
  };
  ending: {
    people: number;
    /**
     * 7일 안에 이용이 끝나는 사람(끝났는데 아직 만료 처리 전인 사람 포함). 달력 월로 자르면 월말에는
     * 창이 하루이틀뿐이라 날마다 뜻이 흔들린다 — 붙잡을 시간이 있는지가 기준이다.
     */
    endingWithin7Days: number;
  };
}

export interface ArrearsAxisDetail {
  outstandingAmount: number;
  lines: number;
  oldestAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  causes: string[];
  /** 고객이 납부 절차를 시작해 둔 줄이 있다 */
  paymentInProgress: boolean;
  /**
   * 미납 기간 동안 받은 멤버십 할인. 쿠폰·전용상품 이용은 이 서비스에 기록이 없어 들어가지 않는다.
   * 기간을 모르는 줄(인보이스 없이 생긴 줄)은 계산에서 빠지고 unmeasuredLines 로 센다.
   */
  benefit: { discountAmount: number; discountOrders: number; welcomeDeal: boolean; unmeasuredLines: number };
  /** 최근 30일 납부 금액이 청구와 맞지 않은 기록 수 — 사람이 확인해야 한다 */
  recentMismatches: number;
}

export interface PastDueAxisDetail {
  /** 'INVOICE'(자동이체 인보이스) | 'LEGACY'(옛 결제 재시도 큐) */
  source: 'INVOICE' | 'LEGACY';
  failedAttempts: number;
  maxAttempts: number;
  remainingAttempts: number;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  /** 옛 경로만 안다. 인보이스 경로의 다음 시도는 wallet 이 정한다. */
  nextRetryAt: string | null;
  amount: number;
}

export interface GoodAxisDetail {
  paidAmount: number;
  paidCount: number;
  paidDays: number;
  firstPaidAt: string;
  isTopPayer: boolean;
}

export interface EndingAxisDetail {
  endsAt: string | null;
  recurringCancelledAt: string | null;
}

export interface AxisPage<T> {
  rows: Array<{ userId: string; detail: T }>;
  total: number;
}

/** 미납 한 줄에 사람이 손댄 기록 한 건 */
export interface ArrearsAdjustmentItem {
  id: string;
  arrearsId: string;
  action: string;
  amountBefore: number;
  amountAfter: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

/** 미납 한 줄의 기간 동안 받은 혜택. 기간을 모르면 measurable=false(0 으로 적지 않는다). */
export interface ArrearsLineBenefit {
  arrearsId: string;
  measurable: boolean;
  discountAmount: number;
  discountOrders: number;
  welcomeDeal: boolean;
}

/** 미납과 관련된 계약 사건(생김·안 생긴 이유·납부 금액 불일치·선지급 보류) */
export interface ArrearsTimelineEvent {
  id: number;
  contractId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ArrearsDetailExtras {
  adjustments: ArrearsAdjustmentItem[];
  benefits: ArrearsLineBenefit[];
  events: ArrearsTimelineEvent[];
}

/** 회원 상세 미납 탭이 보여 주는 사건 종류 */
export const ARREARS_TIMELINE_EVENT_TYPES = [
  'ARREARS_RECORDED',
  'ARREARS_SKIPPED',
  'ARREARS_SETTLEMENT_MISMATCH',
  'INVOICE_ADVANCE_GRANT_WITHHELD',
] as const;

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const dateStr = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v as string).toISOString().slice(0, 10);
};

/** 한국 시간 기준 이번 달 1일 0시(UTC 순간). 런타임 TZ 와 무관하게 같은 값을 준다. */
export function kstMonthStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600_000);
}

/** 한국 날짜로 오늘부터 days 일 뒤의 날짜 문자열. 자격 종료일(date)과 비교한다. */
function kstDatePlus(now: Date, days: number): string {
  return new Date(now.getTime() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 사람 축 조회. 요약 칸의 숫자와 그 칸을 눌렀을 때의 목록 total 은 **같은 CTE** 로 센다 —
 * 따로 정의하면 「칸에는 5명인데 목록엔 4명」이 된다.
 *
 * 부하: 전부 membership DB 안의 집계이고 관리자가 화면을 열 때만 돈다. 쇼핑몰·결제 경로와
 * 자원을 다투지 않는다. 기존 회원 목록(`AdminMembersReader.findAllWithDetails`) 쿼리는 건드리지 않는다.
 */
@Injectable()
export class AdminMemberInsightsReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 오늘(KST)부터 days 일 안에 결제일이 오는 자동갱신 계약 — 정기결제 화면의 「다음 N일 청구 예정」.
   * 금액은 플랜 정가 합계라 추정치다(쿠폰·가격 변경은 반영하지 않는다). 사람 축 요약과 따로 둬
   * 회원 화면의 요약 쿼리에 일을 더하지 않는다.
   */
  async upcomingBilling(
    days: number,
    now: Date = new Date(),
  ): Promise<{ from: string; toExclusive: string; contracts: number; amount: number }> {
    const from = kstDatePlus(now, 0);
    const toExclusive = kstDatePlus(now, days);
    const [row] = await this.rows(sql`
      SELECT COUNT(*) AS contracts, COALESCE(SUM(p.price), 0) AS amount
      FROM subscription_contracts c
      JOIN plan p ON p.id = c.plan_id
      WHERE c.status = 'ACTIVE'
        AND c.auto_renewal = true
        AND c.is_voided = false
        AND c.next_billing_date >= ${from}::date
        AND c.next_billing_date < ${toExclusive}::date
    `);
    return { from, toExclusive, contracts: num(row?.contracts), amount: num(row?.amount) };
  }

  private async rows(query: SQL): Promise<Row[]> {
    const result = await this.dbService.db.execute<Row>(query);
    return Array.from(result);
  }

  // ─── 축 정의(CTE) ──────────────────────────────────────────────────────────

  /** 연체: 이용 중인 계약 중 인보이스 출금 실패 표시가 있거나 옛 재시도 큐에 걸린 계약. 사람당 최신 계약 1개. */
  private pastDueCte(): SQL {
    return sql`
      past_due AS (
        SELECT DISTINCT ON (c.user_id)
          c.user_id, c.id AS contract_id, c.billing_path, p.price,
          q.attempts AS q_attempts, q.max_attempts AS q_max_attempts, q.next_retry_at AS q_next_retry_at,
          q.last_error_code AS q_last_error_code, q.updated_at AS q_updated_at
        FROM subscription_contracts c
        JOIN plan p ON p.id = c.plan_id
        LEFT JOIN membership_dunning_queue q ON q.contract_id = c.id
        WHERE c.status = 'ACTIVE'
          AND ((c.billing_path = 'INVOICE' AND c.is_past_due) OR q.id IS NOT NULL)
        ORDER BY c.user_id, c.created_at DESC
      ),
      last_fail AS (
        SELECT DISTINCT ON (e.contract_id)
          e.contract_id,
          (e.metadata->>'attemptNo')::int AS attempt_no,
          e.metadata->>'errorCode' AS error_code,
          e.created_at
        FROM subscription_contract_events e
        WHERE e.event_type = 'BILLING_FAILED'
          AND e.contract_id IN (SELECT contract_id FROM past_due)
        ORDER BY e.contract_id, e.created_at DESC, e.id DESC
      ),
      past_due_detail AS (
        SELECT
          pd.user_id,
          CASE WHEN pd.q_attempts IS NOT NULL THEN 'LEGACY' ELSE 'INVOICE' END AS source,
          COALESCE(pd.q_attempts, lf.attempt_no, 1) AS failed_attempts,
          COALESCE(pd.q_max_attempts, ${INVOICE_MAX_ATTEMPTS}) AS max_attempts,
          -- 남은 출금 기회. 인보이스는 한도 번째 실패에서 끝나고, 옛 재시도 큐는 attempts 가
          -- 한도에 닿은 뒤 한 번 더 실패해야 끝난다(billing-outcome.handler).
          GREATEST(
            CASE WHEN pd.q_attempts IS NOT NULL
              THEN pd.q_max_attempts - pd.q_attempts + 1
              ELSE ${INVOICE_MAX_ATTEMPTS} - COALESCE(lf.attempt_no, 1)
            END, 0) AS remaining_attempts,
          COALESCE(lf.created_at, pd.q_updated_at) AS last_failed_at,
          COALESCE(pd.q_last_error_code, lf.error_code) AS last_error_code,
          pd.q_next_retry_at AS next_retry_at,
          pd.price AS amount
        FROM past_due pd
        LEFT JOIN last_fail lf ON lf.contract_id = pd.contract_id
      )
    `;
  }

  /**
   * 결제 이력(사람 단위). 결제 성공·실패는 billing_events 가 경로와 무관하게 공통으로 남긴다.
   *
   * 이용 중 여부·환불·결제 통계를 «한 번의 사람 단위 집계»로 끝낸다. 집계 결과에 다른 표를 다시
   * 붙이면, 여러 조건이 걸린 집계의 행 수를 플래너가 한 자릿수로 잘못 추정해 중첩 루프를 고르고
   * 데이터가 많아지면 목록 조회가 수십 초로 늘어난다.
   */
  private paymentCte(): SQL {
    const { failureLookbackMonths, minTenureDays, minPaidDays } = GOOD_CUSTOMER_CRITERIA;
    return sql`
      per_contract AS (
        SELECT
          c.user_id,
          c.status,
          CASE WHEN c.refund_completed THEN COALESCE(c.eligible_refund_amount, 0) ELSE 0 END AS refund,
          COUNT(b.id) FILTER (WHERE b.event_type = 'CHARGE_SUCCESS') AS paid_count,
          MIN(b.created_at) FILTER (WHERE b.event_type = 'CHARGE_SUCCESS') AS first_paid_at,
          COALESCE(SUM(p.duration_days) FILTER (WHERE b.event_type = 'CHARGE_SUCCESS'), 0) AS paid_days,
          COALESCE(SUM(b.amount) FILTER (WHERE b.event_type = 'CHARGE_SUCCESS'), 0) AS gross_paid,
          COUNT(b.id) FILTER (
            WHERE b.event_type = 'CHARGE_FAIL'
              AND b.created_at >= now() - make_interval(months => ${failureLookbackMonths})
          ) AS recent_failures
        FROM subscription_contracts c
        JOIN plan p ON p.id = c.plan_id
        LEFT JOIN billing_events b ON b.contract_id = c.id
        GROUP BY c.id, c.user_id, c.status, c.refund_completed, c.eligible_refund_amount
      ),
      per_user AS (
        SELECT
          user_id,
          bool_or(status = 'ACTIVE') AS is_active,
          SUM(paid_count) AS paid_count,
          MIN(first_paid_at) AS first_paid_at,
          SUM(paid_days) AS paid_days,
          GREATEST(SUM(gross_paid) - SUM(refund), 0) AS net_paid,
          SUM(recent_failures) AS recent_failures
        FROM per_contract
        GROUP BY user_id
      ),
      good AS (
        SELECT
          pu.user_id, pu.net_paid, pu.paid_count, pu.paid_days, pu.first_paid_at,
          percent_rank() OVER (ORDER BY pu.net_paid DESC) AS pay_rank
        FROM per_user pu
        WHERE pu.is_active
          AND pu.paid_count > 0
          AND pu.first_paid_at <= now() - make_interval(days => ${minTenureDays})
          AND pu.paid_days >= ${minPaidDays}
          AND pu.recent_failures = 0
          AND NOT EXISTS (SELECT 1 FROM membership_arrears ea WHERE ea.user_id = pu.user_id)
      )
    `;
  }

  /** 해지 예약: 이용 중이면서 자동결제를 끊은 계약. 사람당 최신 계약 1개 — 회원 목록의 해지 예약 필터와 같은 정의다. */
  private endingCte(): SQL {
    return sql`
      ending AS (
        SELECT DISTINCT ON (c.user_id) c.user_id, c.recurring_cancelled_at, e.ends_at
        FROM subscription_contracts c
        LEFT JOIN subscription_entitlement e ON e.user_id = c.user_id AND e.is_current
        WHERE c.status = 'ACTIVE' AND c.recurring_cancelled_at IS NOT NULL
        ORDER BY c.user_id, c.created_at DESC
      )
    `;
  }

  // ─── 요약 ─────────────────────────────────────────────────────────────────

  async insights(now: Date = new Date()): Promise<MembershipInsights> {
    const monthStart = kstMonthStart(now);
    const monthStartIso = monthStart.toISOString();
    const endingCutoff = kstDatePlus(now, 7);

    const [arrearsRows, mismatchRows, pastDueRows, goodRows, endingRows] = await Promise.all([
      this.rows(sql`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'OUTSTANDING'), 0) AS outstanding_amount,
          COUNT(DISTINCT user_id) FILTER (WHERE status = 'OUTSTANDING') AS outstanding_people,
          COUNT(*) FILTER (WHERE status = 'OUTSTANDING') AS outstanding_lines,
          MIN(created_at) FILTER (WHERE status = 'OUTSTANDING') AS oldest_outstanding_at,
          COALESCE(SUM(amount) FILTER (WHERE created_at >= ${monthStartIso}::timestamptz), 0) AS month_created_amount,
          COUNT(*) FILTER (WHERE created_at >= ${monthStartIso}::timestamptz) AS month_created_lines,
          COALESCE(SUM(amount) FILTER (WHERE status = 'SETTLED' AND settled_at >= ${monthStartIso}::timestamptz), 0) AS month_settled_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'WAIVED' AND settled_at >= ${monthStartIso}::timestamptz), 0) AS month_waived_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'SETTLED'), 0) AS settled_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'WAIVED'), 0) AS waived_amount
        FROM membership_arrears
      `),
      this.rows(sql`
        SELECT COUNT(*) AS n FROM subscription_contract_events
        WHERE event_type = 'ARREARS_SETTLEMENT_MISMATCH' AND created_at >= now() - interval '30 days'
      `),
      this.rows(sql`
        WITH ${this.pastDueCte()}
        SELECT
          COUNT(*) AS people,
          COUNT(*) FILTER (WHERE remaining_attempts <= 1) AS last_chance,
          COALESCE(SUM(amount), 0) AS amount_at_risk
        FROM past_due_detail
      `),
      this.rows(sql`
        WITH ${this.paymentCte()}
        SELECT
          (SELECT COUNT(*) FROM good) AS people,
          (SELECT COUNT(*) FROM per_user WHERE is_active) AS active_people,
          (SELECT COUNT(*) FROM per_user WHERE is_active AND paid_count = 0) AS undetermined_people,
          (SELECT COALESCE(SUM(net_paid), 0) FROM good) AS paid_amount,
          (SELECT COALESCE(SUM(net_paid), 0) FROM per_user) AS all_paid_amount
      `),
      this.rows(sql`
        WITH ${this.endingCte()}
        SELECT
          COUNT(*) AS people,
          COUNT(*) FILTER (WHERE ends_at <= ${endingCutoff}::date) AS ending_within_7_days
        FROM ending
      `),
    ]);

    const a = arrearsRows[0] ?? {};
    const pd = pastDueRows[0] ?? {};
    const g = goodRows[0] ?? {};
    const en = endingRows[0] ?? {};

    return {
      asOf: now.toISOString(),
      monthStart: monthStartIso,
      arrears: {
        outstandingAmount: num(a.outstanding_amount),
        outstandingPeople: num(a.outstanding_people),
        outstandingLines: num(a.outstanding_lines),
        oldestOutstandingAt: iso(a.oldest_outstanding_at),
        thisMonth: {
          createdAmount: num(a.month_created_amount),
          createdLines: num(a.month_created_lines),
          settledAmount: num(a.month_settled_amount),
          waivedAmount: num(a.month_waived_amount),
        },
        lifetime: {
          settledAmount: num(a.settled_amount),
          waivedAmount: num(a.waived_amount),
          outstandingAmount: num(a.outstanding_amount),
        },
        recentMismatches: num(mismatchRows[0]?.n),
      },
      pastDue: {
        people: num(pd.people),
        lastChance: num(pd.last_chance),
        amountAtRisk: num(pd.amount_at_risk),
      },
      good: {
        people: num(g.people),
        activePeople: num(g.active_people),
        undeterminedPeople: num(g.undetermined_people),
        paidAmount: num(g.paid_amount),
        allPaidAmount: num(g.all_paid_amount),
        criteria: GOOD_CUSTOMER_CRITERIA,
      },
      ending: {
        people: num(en.people),
        endingWithin7Days: num(en.ending_within_7_days),
      },
    };
  }

  // ─── 축별 목록 ─────────────────────────────────────────────────────────────

  private userFilter(column: SQL, userIds?: string[]): SQL {
    if (!userIds) return sql`TRUE`;
    if (userIds.length === 0) return sql`FALSE`;
    return sql`${column} IN ${userIds}`;
  }

  async arrearsPage(page: number, limit: number, userIds?: string[]): Promise<AxisPage<ArrearsAxisDetail>> {
    const offset = (page - 1) * limit;
    const people = sql`
      people AS (
        SELECT
          user_id,
          SUM(amount) AS outstanding_amount,
          COUNT(*) AS lines,
          MIN(created_at) AS oldest_at,
          MIN(period_start) AS period_start,
          MAX(period_end) AS period_end,
          array_agg(DISTINCT cause) AS causes,
          bool_or(pending_intent_id IS NOT NULL) AS payment_in_progress,
          COUNT(*) FILTER (WHERE period_start IS NULL OR period_end IS NULL) AS unmeasured_lines
        FROM membership_arrears
        WHERE status = 'OUTSTANDING' AND ${this.userFilter(sql`user_id`, userIds)}
        GROUP BY user_id
      )
    `;
    const [countRows, rows] = await Promise.all([
      this.rows(sql`WITH ${people} SELECT COUNT(*) AS n FROM people`),
      this.rows(sql`
        WITH ${people},
        page AS (
          SELECT * FROM people ORDER BY outstanding_amount DESC, oldest_at ASC, user_id LIMIT ${limit} OFFSET ${offset}
        ),
        discount AS (
          -- 미납 줄의 기간 [period_start, period_end] 안(한국 날짜 기준)에 들어온 할인.
          SELECT a.user_id, COALESCE(SUM(d.discount_amount), 0) AS amount, COUNT(d.order_id) AS orders
          FROM membership_arrears a
          JOIN membership_discount_events d
            ON d.user_id = a.user_id
           AND NOT d.is_cancelled
           AND d.order_date >= (a.period_start::timestamp AT TIME ZONE 'Asia/Seoul')
           AND d.order_date < ((a.period_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
          WHERE a.status = 'OUTSTANDING' AND a.period_start IS NOT NULL AND a.period_end IS NOT NULL
            AND a.user_id IN (SELECT user_id FROM page)
          GROUP BY a.user_id
        ),
        welcome AS (
          SELECT DISTINCT a.user_id
          FROM membership_arrears a
          JOIN welcome_membership_eligibility w
            ON w.user_id::text = a.user_id
           AND w.has_purchased
           AND w.purchased_at >= (a.period_start::timestamp AT TIME ZONE 'Asia/Seoul')
           AND w.purchased_at < ((a.period_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
          WHERE a.status = 'OUTSTANDING' AND a.period_start IS NOT NULL AND a.period_end IS NOT NULL
            AND a.user_id IN (SELECT user_id FROM page)
        ),
        mismatch AS (
          SELECT user_id, COUNT(*) AS n
          FROM subscription_contract_events
          WHERE event_type = 'ARREARS_SETTLEMENT_MISMATCH'
            AND created_at >= now() - interval '30 days'
            AND user_id IN (SELECT user_id FROM page)
          GROUP BY user_id
        )
        SELECT page.*, COALESCE(discount.amount, 0) AS discount_amount, COALESCE(discount.orders, 0) AS discount_orders,
               (welcome.user_id IS NOT NULL) AS welcome_deal, COALESCE(mismatch.n, 0) AS recent_mismatches
        FROM page
        LEFT JOIN discount ON discount.user_id = page.user_id
        LEFT JOIN welcome ON welcome.user_id = page.user_id
        LEFT JOIN mismatch ON mismatch.user_id = page.user_id
        ORDER BY page.outstanding_amount DESC, page.oldest_at ASC, page.user_id
      `),
    ]);

    return {
      total: num(countRows[0]?.n),
      rows: rows.map((r) => ({
        userId: String(r.user_id),
        detail: {
          outstandingAmount: num(r.outstanding_amount),
          lines: num(r.lines),
          oldestAt: iso(r.oldest_at) as string,
          periodStart: dateStr(r.period_start),
          periodEnd: dateStr(r.period_end),
          causes: (r.causes as string[] | null) ?? [],
          paymentInProgress: r.payment_in_progress === true,
          benefit: {
            discountAmount: num(r.discount_amount),
            discountOrders: num(r.discount_orders),
            welcomeDeal: r.welcome_deal === true,
            unmeasuredLines: num(r.unmeasured_lines),
          },
          recentMismatches: num(r.recent_mismatches),
        },
      })),
    };
  }

  async pastDuePage(page: number, limit: number, userIds?: string[]): Promise<AxisPage<PastDueAxisDetail>> {
    const offset = (page - 1) * limit;
    const filter = this.userFilter(sql`user_id`, userIds);
    const [countRows, rows] = await Promise.all([
      this.rows(sql`WITH ${this.pastDueCte()} SELECT COUNT(*) AS n FROM past_due_detail WHERE ${filter}`),
      this.rows(sql`
        WITH ${this.pastDueCte()}
        SELECT * FROM past_due_detail
        WHERE ${filter}
        ORDER BY remaining_attempts ASC, last_failed_at ASC NULLS LAST, user_id
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    return {
      total: num(countRows[0]?.n),
      rows: rows.map((r) => {
        return {
          userId: String(r.user_id),
          detail: {
            source: r.source === 'LEGACY' ? 'LEGACY' : 'INVOICE',
            failedAttempts: num(r.failed_attempts),
            maxAttempts: num(r.max_attempts),
            remainingAttempts: num(r.remaining_attempts),
            lastFailedAt: iso(r.last_failed_at),
            lastErrorCode: (r.last_error_code as string | null) ?? null,
            nextRetryAt: iso(r.next_retry_at),
            amount: num(r.amount),
          },
        };
      }),
    };
  }

  async goodPage(page: number, limit: number, userIds?: string[]): Promise<AxisPage<GoodAxisDetail>> {
    const offset = (page - 1) * limit;
    const filter = this.userFilter(sql`user_id`, userIds);
    const [countRows, rows] = await Promise.all([
      this.rows(sql`WITH ${this.paymentCte()} SELECT COUNT(*) AS n FROM good WHERE ${filter}`),
      this.rows(sql`
        WITH ${this.paymentCte()}
        SELECT * FROM good
        WHERE ${filter}
        ORDER BY net_paid DESC, first_paid_at ASC, user_id
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    return {
      total: num(countRows[0]?.n),
      rows: rows.map((r) => ({
        userId: String(r.user_id),
        detail: {
          paidAmount: num(r.net_paid),
          paidCount: num(r.paid_count),
          paidDays: num(r.paid_days),
          firstPaidAt: iso(r.first_paid_at) as string,
          isTopPayer: num(r.pay_rank) < GOOD_CUSTOMER_CRITERIA.topShare,
        },
      })),
    };
  }

  async endingPage(page: number, limit: number, userIds?: string[]): Promise<AxisPage<EndingAxisDetail>> {
    const offset = (page - 1) * limit;
    const filter = this.userFilter(sql`user_id`, userIds);
    const [countRows, rows] = await Promise.all([
      this.rows(sql`WITH ${this.endingCte()} SELECT COUNT(*) AS n FROM ending WHERE ${filter}`),
      this.rows(sql`
        WITH ${this.endingCte()}
        SELECT * FROM ending
        WHERE ${filter}
        ORDER BY ends_at ASC NULLS LAST, user_id
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    return {
      total: num(countRows[0]?.n),
      rows: rows.map((r) => ({
        userId: String(r.user_id),
        detail: { endsAt: dateStr(r.ends_at), recurringCancelledAt: iso(r.recurring_cancelled_at) },
      })),
    };
  }

  // ─── 회원 한 사람의 미납 상세 ─────────────────────────────────────────────

  /** 미납 탭이 원장 행 옆에 붙여 보여 줄 것들. 원장 행 자체는 ArrearsReader 가 준다. */
  async arrearsDetailExtras(userId: string): Promise<ArrearsDetailExtras> {
    const types = [...ARREARS_TIMELINE_EVENT_TYPES];
    const [adjustmentRows, benefitRows, eventRows] = await Promise.all([
      this.rows(sql`
        SELECT id, arrears_id, action, amount_before, amount_after, reason, admin_id, created_at
        FROM membership_arrears_adjustments
        WHERE user_id = ${userId}
        ORDER BY created_at DESC, id
      `),
      this.rows(sql`
        SELECT
          a.id AS arrears_id,
          (a.period_start IS NOT NULL AND a.period_end IS NOT NULL) AS measurable,
          COALESCE((
            SELECT SUM(d.discount_amount) FROM membership_discount_events d
            WHERE d.user_id = a.user_id AND NOT d.is_cancelled
              AND d.order_date >= (a.period_start::timestamp AT TIME ZONE 'Asia/Seoul')
              AND d.order_date < ((a.period_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
          ), 0) AS discount_amount,
          (
            SELECT COUNT(*) FROM membership_discount_events d
            WHERE d.user_id = a.user_id AND NOT d.is_cancelled
              AND d.order_date >= (a.period_start::timestamp AT TIME ZONE 'Asia/Seoul')
              AND d.order_date < ((a.period_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
          ) AS discount_orders,
          EXISTS (
            SELECT 1 FROM welcome_membership_eligibility w
            WHERE w.user_id::text = a.user_id AND w.has_purchased
              AND w.purchased_at >= (a.period_start::timestamp AT TIME ZONE 'Asia/Seoul')
              AND w.purchased_at < ((a.period_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
          ) AS welcome_deal
        FROM membership_arrears a
        WHERE a.user_id = ${userId}
      `),
      this.rows(sql`
        SELECT id, contract_id, event_type, metadata, created_at
        FROM subscription_contract_events
        WHERE user_id = ${userId} AND event_type IN ${types}
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `),
    ]);

    return {
      adjustments: adjustmentRows.map((r) => ({
        id: String(r.id),
        arrearsId: String(r.arrears_id),
        action: String(r.action),
        amountBefore: num(r.amount_before),
        amountAfter: num(r.amount_after),
        reason: String(r.reason),
        adminId: String(r.admin_id),
        createdAt: iso(r.created_at) as string,
      })),
      benefits: benefitRows.map((r) => {
        const measurable = r.measurable === true;
        return {
          arrearsId: String(r.arrears_id),
          measurable,
          discountAmount: measurable ? num(r.discount_amount) : 0,
          discountOrders: measurable ? num(r.discount_orders) : 0,
          welcomeDeal: measurable && r.welcome_deal === true,
        };
      }),
      events: eventRows.map((r) => ({
        id: num(r.id),
        contractId: String(r.contract_id),
        eventType: String(r.event_type),
        metadata: (r.metadata as Record<string, unknown> | null) ?? {},
        createdAt: iso(r.created_at) as string,
      })),
    };
  }
}
