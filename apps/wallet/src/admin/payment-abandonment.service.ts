import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { WalletSchema } from '../schema';

/**
 * 결제 단계 이탈 — "결제까지 왔는데 어디서 언제 왜 멈췄나".
 *
 * 모수는 기간(KST 달력일) 안에 생성된 `purpose='PURCHASE'` 인텐트다. 정기결제(SUBSCRIPTION)는
 * 고객이 결제하다 이탈한 게 아니라 자동 출금이 실패한 것이라 빼고, 멤버십 축이 따로 답한다.
 *
 * 결말은 셋으로 나눈다 — 성공 / 이탈 / **진행 중**. 진행 중을 이탈로 세면 조회 기간 끝자락의
 * 이탈률이 구조적으로 부풀려진다(인텐트 만료가 24시간이라 아직 결말이 날 시간이 없다).
 * 그래서 이탈률의 분모는 결말이 난 것(성공+이탈)뿐이다.
 */

export interface AbandonmentSummary {
  attemptedCount: number;
  attemptedAmount: number;
  succeededCount: number;
  succeededAmount: number;
  abandonedCount: number;
  abandonedAmount: number;
  openCount: number;
  openAmount: number;
  /** 이탈 / (성공 + 이탈). 결말이 난 게 없으면 null — 0 으로 뭉개지 않는다. */
  abandonRate: number | null;
  /** 이탈률의 분모. 화면이 "N건 중" 으로 같이 보여준다. */
  settledCount: number;
}

export interface AbandonmentStageRow {
  /** 종료 직전 상태. 전이 기록이 없으면 null → 화면은 '미기록'. */
  stage: string | null;
  /** 종료 사유 코드. nullable 이라 '미기록'을 따로 표기한다. */
  reason: string | null;
  count: number;
  amount: number;
}

export interface AbandonmentDurationStat {
  sampleCount: number;
  p50Seconds: number | null;
  p90Seconds: number | null;
}

export interface AbandonmentMethodRow {
  /** 결제수단 미선택(수단을 고르기 전에 이탈)은 'UNSELECTED' 로 따로 센다. */
  methodType: string;
  attemptedCount: number;
  succeededCount: number;
  abandonedCount: number;
  openCount: number;
  abandonedAmount: number;
  abandonRate: number | null;
}

export interface AbandonmentDailyPoint {
  bucket: string;
  attemptedCount: number;
  succeededCount: number;
  abandonedCount: number;
  openCount: number;
  abandonedAmount: number;
}

export interface PaymentAbandonmentResponse {
  range: { from: string; to: string };
  summary: AbandonmentSummary;
  byStage: AbandonmentStageRow[];
  byMethod: AbandonmentMethodRow[];
  daily: AbandonmentDailyPoint[];
  /** 인텐트 생성 → 결말까지 걸린 시간. 성공/이탈 각각. */
  duration: { succeeded: AbandonmentDurationStat; abandoned: AbandonmentDurationStat };
  /**
   * '진행 중'을 상태별로 쪼갠 것. 만료 잡이 회수하는 상태는 CREATED·PROCESSING·
   * REQUIRES_ACTION·AWAITING_DEPOSIT 뿐이라(`jobs/expiration.job.ts:17`), AUTHORIZED 나
   * PENDING_SETTLEMENT 에 오래 남은 건은 저절로 정리되지 않는다 — 운영이 봐야 할 신호다.
   */
  openByStatus: Array<{ status: string; count: number; amount: number }>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 결말 분류. AUTHORIZED 는 승인만 되고 캡처 전이라 성공이 아니라 진행 중이다. */
const OUTCOME_EXPR = sql`CASE
  WHEN i.status IN ('CAPTURED','PARTIALLY_CAPTURED','SUCCEEDED') THEN 'SUCCEEDED'
  WHEN i.status IN ('CANCELED','FAILED') THEN 'ABANDONED'
  ELSE 'OPEN' END`;

const SUCCESS_STATUSES = new Set(['CAPTURED', 'PARTIALLY_CAPTURED', 'SUCCEEDED']);
const ABANDONED_STATUSES = new Set(['CANCELED', 'FAILED']);

/** SQL 의 `OUTCOME_EXPR` 과 같은 규칙. 둘이 어긋나면 요약과 시계열이 달라진다. */
export function classifyOutcome(status: string): 'SUCCEEDED' | 'ABANDONED' | 'OPEN' {
  if (SUCCESS_STATUSES.has(status)) return 'SUCCEEDED';
  if (ABANDONED_STATUSES.has(status)) return 'ABANDONED';
  return 'OPEN';
}

/**
 * KST 달력일 [from, to] 을 시각 구간으로 옮긴 조건. 컬럼을 함수로 감싸면 인덱스를 못 타
 * 전수 스캔이 된다 — 귀속 정의는 그대로 두고 경계만 시각으로 계산한다
 * (`statistics-admin.service.ts` 의 `kstDayRange` 와 같은 규율).
 */
const createdAtWindow = (from: string, to: string) => sql`
  i.created_at >= (${from}::date)::timestamp at time zone 'Asia/Seoul'
  AND i.created_at < (${to}::date + 1)::timestamp at time zone 'Asia/Seoul'`;

interface StatusCountRow {
  bucket: string;
  status: string;
  cnt: number;
  amount: string;
}

interface StageRow {
  outcome: string;
  stage: string | null;
  reason: string | null;
  grp: number;
  cnt: number;
  amount: string;
  durationSamples: number;
  p50: number | null;
  p90: number | null;
}

interface MethodRow {
  methodType: string;
  outcome: string;
  cnt: number;
  amount: string;
}

interface ClassifiedRow {
  bucket: string;
  status: string;
  outcome: 'SUCCEEDED' | 'ABANDONED' | 'OPEN';
  count: number;
  amount: number;
}

/**
 * 진행 중인 시도를 상태별로 모은다. 만료 잡이 손대지 않는 상태(AUTHORIZED 등)에 쌓인 건은
 * 저절로 사라지지 않으므로 화면이 그대로 보여줘야 한다.
 */
export function summarizeOpenByStatus(rows: ClassifiedRow[]): Array<{ status: string; count: number; amount: number }> {
  const byStatus = new Map<string, { status: string; count: number; amount: number }>();
  for (const row of rows) {
    if (row.outcome !== 'OPEN') continue;
    const entry = byStatus.get(row.status) ?? { status: row.status, count: 0, amount: 0 };
    entry.count += row.count;
    entry.amount += row.amount;
    byStatus.set(row.status, entry);
  }
  return [...byStatus.values()].sort((a, b) => b.count - a.count);
}

/** 결제·환불이 없는 날도 0 으로 채워 차트 x축이 실제보다 촘촘해 보이지 않게 한다. */
export function buildAbandonmentSeries(
  rows: Array<{ bucket: string; outcome: string; count: number; amount: number }>,
  from: string,
  to: string,
): AbandonmentDailyPoint[] {
  const byDay = new Map<string, AbandonmentDailyPoint>();
  for (const row of rows) {
    const point = byDay.get(row.bucket) ?? {
      bucket: row.bucket,
      attemptedCount: 0,
      succeededCount: 0,
      abandonedCount: 0,
      openCount: 0,
      abandonedAmount: 0,
    };
    point.attemptedCount += row.count;
    if (row.outcome === 'SUCCEEDED') point.succeededCount += row.count;
    if (row.outcome === 'OPEN') point.openCount += row.count;
    if (row.outcome === 'ABANDONED') {
      point.abandonedCount += row.count;
      point.abandonedAmount += row.amount;
    }
    byDay.set(row.bucket, point);
  }

  // 날짜 순회는 UTC 로 못박는다 — 로컬 TZ 로 순회하면 오프셋에 하루가 밀린다.
  const series: AbandonmentDailyPoint[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const bucket = cursor.toISOString().slice(0, 10);
    series.push(
      byDay.get(bucket) ?? {
        bucket,
        attemptedCount: 0,
        succeededCount: 0,
        abandonedCount: 0,
        openCount: 0,
        abandonedAmount: 0,
      },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

/** 결말이 난 것(성공+이탈)만 분모에 넣는다. 없으면 null — 화면은 '—' 로 쓴다. */
export function abandonRateOf(succeeded: number, abandoned: number): number | null {
  const settled = succeeded + abandoned;
  return settled === 0 ? null : abandoned / settled;
}

@Injectable()
export class PaymentAbandonmentService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async getAbandonment(from: string, to: string): Promise<PaymentAbandonmentResponse> {
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
      throw new BadRequestException('from/to 는 YYYY-MM-DD 형식이어야 합니다');
    }
    if (from > to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
    }

    const [dailyRows, stageRows, methodRows] = await Promise.all([
      this.loadDaily(from, to),
      this.loadStages(from, to),
      this.loadMethods(from, to),
    ]);

    const classified = dailyRows.map((row) => ({
      bucket: row.bucket,
      status: row.status,
      outcome: classifyOutcome(row.status),
      count: Number(row.cnt),
      amount: Number(row.amount),
    }));
    const daily = buildAbandonmentSeries(classified, from, to);

    return {
      range: { from, to },
      summary: this.summarize(classified),
      byStage: stageRows
        .filter((row) => row.grp === 0 && row.outcome === 'ABANDONED')
        .map((row) => ({
          stage: row.stage,
          reason: row.reason,
          count: Number(row.cnt),
          amount: Number(row.amount),
        }))
        .sort((a, b) => b.count - a.count),
      byMethod: this.summarizeMethods(methodRows),
      daily,
      duration: {
        succeeded: this.durationOf(stageRows, 'SUCCEEDED'),
        abandoned: this.durationOf(stageRows, 'ABANDONED'),
      },
      openByStatus: summarizeOpenByStatus(classified),
    };
  }

  /**
   * 일 × 상태. 요약·시계열·진행중 내역이 **모두 이 한 번의 집계**에서 나오므로 세 숫자가
   * 서로 어긋날 수 없다. 결말(성공/이탈/진행중)은 상태에서 도출한다 —
   * 상태까지 들고 있어야 '진행 중'이 무엇 때문에 진행 중인지 말할 수 있다.
   */
  private async loadDaily(from: string, to: string): Promise<StatusCountRow[]> {
    const rows = (await this.db.execute(sql<StatusCountRow>`
      SELECT
        ((i.created_at AT TIME ZONE 'Asia/Seoul')::date)::text AS "bucket",
        i.status::text AS "status",
        count(*)::int AS "cnt",
        COALESCE(sum(i.payable_amount), 0)::bigint AS "amount"
      FROM payment_intents i
      WHERE i.purpose = 'PURCHASE' AND ${createdAtWindow(from, to)}
      GROUP BY 1, 2
    `)) as unknown as StatusCountRow[];
    return rows;
  }

  /**
   * 결말이 난 인텐트의 **종료 전이**(현재 status 로 넘어간 가장 최근 전이)를 붙여
   * 단계·사유별로 센다. LATERAL 이라 인텐트당 전이 인덱스를 한 번만 탄다 —
   * 전이 테이블을 통째로 훑지 않는다.
   *
   * LEFT 인 이유: 전이 기록이 없는 인텐트(감사 로그가 생기기 전의 옛 데이터)를 조용히
   * 떨구면 단계별 합계가 요약의 이탈 건수보다 적어진다. 단계·사유를 null 로 남겨
   * '미기록'으로 드러내는 쪽이 정직하다. 소요 시간 표본은 `count(seconds)` 라
   * 전이가 없는 건을 세지 않는다.
   *
   * GROUPING SETS 로 단계별 집계와 소요 시간 백분위를 **한 번의 스캔**에서 같이 낸다
   * (grp=3 인 행이 결말별 합계 + 백분위).
   */
  private async loadStages(from: string, to: string): Promise<StageRow[]> {
    const rows = (await this.db.execute(sql<StageRow>`
      WITH finished AS (
        SELECT
          ${OUTCOME_EXPR} AS outcome,
          i.payable_amount,
          t.previous_status,
          t.reason_code,
          EXTRACT(EPOCH FROM (t.occurred_at - i.created_at)) AS seconds
        FROM payment_intents i
        LEFT JOIN LATERAL (
          SELECT p.previous_status, p.reason_code, p.occurred_at
          FROM payment_state_transitions p
          WHERE p.entity_type = 'INTENT'
            AND p.entity_id = i.id
            AND p.new_status = i.status::text
          ORDER BY p.occurred_at DESC
          LIMIT 1
        ) t ON true
        WHERE i.purpose = 'PURCHASE'
          AND i.status IN ('CAPTURED','PARTIALLY_CAPTURED','SUCCEEDED','CANCELED','FAILED')
          AND ${createdAtWindow(from, to)}
      )
      SELECT
        outcome AS "outcome",
        previous_status AS "stage",
        reason_code AS "reason",
        GROUPING(previous_status, reason_code) AS "grp",
        count(*)::int AS "cnt",
        COALESCE(sum(payable_amount), 0)::bigint AS "amount",
        count(seconds)::int AS "durationSamples",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::int AS "p50",
        percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds)::int AS "p90"
      FROM finished
      GROUP BY GROUPING SETS ((outcome, previous_status, reason_code), (outcome))
    `)) as unknown as StageRow[];
    return rows;
  }

  /** 결제수단 × 결말. 수단을 고르기 전에 이탈한 몫은 'UNSELECTED' 로 분리한다. */
  private async loadMethods(from: string, to: string): Promise<MethodRow[]> {
    const rows = (await this.db.execute(sql<MethodRow>`
      SELECT
        COALESCE(pm.type::text, 'UNSELECTED') AS "methodType",
        ${OUTCOME_EXPR} AS "outcome",
        count(*)::int AS "cnt",
        COALESCE(sum(i.payable_amount), 0)::bigint AS "amount"
      FROM payment_intents i
      LEFT JOIN payment_methods pm ON pm.id = i.payment_method_id
      WHERE i.purpose = 'PURCHASE' AND ${createdAtWindow(from, to)}
      GROUP BY 1, 2
    `)) as unknown as MethodRow[];
    return rows;
  }

  private summarize(rows: ClassifiedRow[]): AbandonmentSummary {
    const summary: AbandonmentSummary = {
      attemptedCount: 0,
      attemptedAmount: 0,
      succeededCount: 0,
      succeededAmount: 0,
      abandonedCount: 0,
      abandonedAmount: 0,
      openCount: 0,
      openAmount: 0,
      abandonRate: null,
      settledCount: 0,
    };
    for (const row of rows) {
      const { count, amount } = row;
      summary.attemptedCount += count;
      summary.attemptedAmount += amount;
      if (row.outcome === 'SUCCEEDED') {
        summary.succeededCount += count;
        summary.succeededAmount += amount;
      } else if (row.outcome === 'ABANDONED') {
        summary.abandonedCount += count;
        summary.abandonedAmount += amount;
      } else {
        summary.openCount += count;
        summary.openAmount += amount;
      }
    }
    summary.settledCount = summary.succeededCount + summary.abandonedCount;
    summary.abandonRate = abandonRateOf(summary.succeededCount, summary.abandonedCount);
    return summary;
  }

  private summarizeMethods(rows: MethodRow[]): AbandonmentMethodRow[] {
    const byMethod = new Map<string, AbandonmentMethodRow>();
    for (const row of rows) {
      const entry = byMethod.get(row.methodType) ?? {
        methodType: row.methodType,
        attemptedCount: 0,
        succeededCount: 0,
        abandonedCount: 0,
        openCount: 0,
        abandonedAmount: 0,
        abandonRate: null,
      };
      const count = Number(row.cnt);
      entry.attemptedCount += count;
      if (row.outcome === 'SUCCEEDED') entry.succeededCount += count;
      else if (row.outcome === 'ABANDONED') {
        entry.abandonedCount += count;
        entry.abandonedAmount += Number(row.amount);
      } else entry.openCount += count;
      byMethod.set(row.methodType, entry);
    }
    return [...byMethod.values()]
      .map((entry) => ({ ...entry, abandonRate: abandonRateOf(entry.succeededCount, entry.abandonedCount) }))
      .sort((a, b) => b.attemptedCount - a.attemptedCount);
  }

  /** grp=3 인 행이 그 결말의 전체 합계 + 백분위다. */
  private durationOf(rows: StageRow[], outcome: string): AbandonmentDurationStat {
    const total = rows.find((row) => row.grp === 3 && row.outcome === outcome);
    if (!total) return { sampleCount: 0, p50Seconds: null, p90Seconds: null };
    return {
      sampleCount: Number(total.durationSamples),
      p50Seconds: total.p50 == null ? null : Number(total.p50),
      p90Seconds: total.p90 == null ? null : Number(total.p90),
    };
  }
}
