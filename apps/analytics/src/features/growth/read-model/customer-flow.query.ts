import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql, type SQL } from 'drizzle-orm';
import { analyticsSchema } from '../../../schema';
import { seoulDayStart } from '../../../shared/date.util';
import { kstWallClock } from '../../../shared/sql-time';
import type { GrowthGranularity } from '../api/growth-query.dto';
import { addDays, bucketLabel, bucketStart, previousRange } from '../domain/period';

/** 자사몰 판매 채널 값 (channel-adapter 가 Medusa 주문에 쓰는 값). */
export const OWN_MALL_CHANNEL = 'medusa';
/** N일 재구매율의 창. 헤드라인은 90일. */
export const REPEAT_WINDOWS = [30, 60, 90] as const;
const COHORT_MONTHS = 12;

export interface BucketCustomers {
  bucket: string;
  buyers: number;
  newBuyers: number;
  returningBuyers: number;
}

export interface PeriodCustomers {
  buyers: number;
  newBuyers: number;
  returningBuyers: number;
  /** 기간 안에서 서로 다른 KST 날짜에 2회 이상 주문한 고객 */
  repeatBuyers: number;
  newBuyerRevenue: number;
  returningBuyerRevenue: number;
}

export interface GrowthAccounting {
  newCustomers: number;
  retained: number;
  resurrected: number;
  churned: number;
  /** (신규 + 복귀) ÷ 이탈. 이탈 0 이면 null — 무한대를 숫자로 꾸미지 않는다. */
  quickRatio: number | null;
}

export interface RepeatCohort {
  cohortMonth: string;
  size: number;
  windows: Array<{ days: number; matured: number; repeaters: number; immature: number }>;
}

export interface RepeatHeadline {
  days: number;
  /** 첫 구매가 [창 끝 − 90일 − 90일, 창 끝 − 90일) 인 고객 = 90일이 다 지난 가장 최근 고객 묶음 */
  current: { firstBuyers: number; repeaters: number; from: string; to: string };
  previous: { firstBuyers: number; repeaters: number; from: string; to: string };
}

export interface CustomerFlowResult {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  granularity: GrowthGranularity;
  series: BucketCustomers[];
  current: PeriodCustomers;
  previous: PeriodCustomers;
  growthAccounting: { current: GrowthAccounting; previous: GrowthAccounting };
  repeatHeadline: RepeatHeadline;
  cohorts: RepeatCohort[];
  timeToSecond: { p25: number | null; p50: number | null; p75: number | null; n: number };
  /** p25~p75 일 구간에 들어 있는 1회 구매 고객 — 재구매 고객의 절반이 이 구간에 두 번째 주문을 했다 */
  repurchaseDue: { customers: number; fromDays: number | null; toDays: number | null };
  coverage: { ownMallOrders: number; memberOrders: number };
}

/** timestamp(무 시간대) 컬럼과 비교할 순간. 저장값이 UTC 벽시계라 ISO 문자열을 그대로 timestamp 로 읽힌다. */
const utcWall = (instant: Date) => sql`${instant.toISOString()}::timestamp`;

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown) => (v == null ? null : num(v));

/**
 * 자사몰 회원 주문을 «전량 취소되지 않은 주문» 단위로 만든 CTE.
 *
 * 취소 판정은 집계(`order-facts.service.ts` 의 `scopeCancelledAmounts`)와 같은 규칙이다 —
 * 라인 정보(`stockRestorationResults`)가 없는 취소는 전량 취소, 라인 정보가 있는데 한 줄도 매칭되지 않으면
 * 전량 취소, 매칭되면 라인별 복원 수량만큼만 취소. 모든 라인이 다 복원된 주문만 «전량 취소»로 빠진다.
 * 부분 취소된 주문은 남은 금액으로 구매에 남는다. 환불은 반영하지 않는다(구매 사실은 그대로다).
 *
 * `day` 는 KST 달력일 — 재구매는 «다른 날의 주문»만 센다(같은 날 장바구니가 나뉜 주문을 재구매로 세지 않는다).
 */
function customerOrdersCte(until: Date): SQL {
  return sql`
    cancel_ev as (
      select e.order_id as ref, e.payload -> 'stockRestorationResults' as rs
      from fact_order_events e
      where e.message_type = 'OrderCancelled'
    ),
    full_cancel_refs as (
      select distinct ref from cancel_ev
      where rs is null or jsonb_typeof(rs) <> 'array' or jsonb_array_length(rs) = 0
    ),
    restored as (
      select c.ref, r ->> 'orderItemId' as item_id, sum(coalesce((r ->> 'restoredQty')::numeric, 0)) as qty
      from cancel_ev c, jsonb_array_elements(case when jsonb_typeof(c.rs) = 'array' then c.rs else '[]'::jsonb end) r
      group by 1, 2
    ),
    lines as (
      select i.order_key, i.order_id, i.order_item_id, i.customer_id, i.quantity, coalesce(i.total_price, 0) as total_price,
        i.occurred_at,
        (select sum(r.qty) from restored r
          where r.ref in (i.order_key, i.order_id) and r.item_id = i.order_item_id) as restored_qty
      from fact_order_items i
      where i.customer_id is not null and i.sales_channel = ${OWN_MALL_CHANNEL} and i.occurred_at < ${utcWall(until)}
    ),
    order_status as (
      select l.order_key,
        min(l.customer_id) as customer_id,
        min(l.occurred_at) as ordered_at,
        sum(case when l.quantity > 0
          then l.total_price * greatest(l.quantity - least(coalesce(l.restored_qty, 0), l.quantity), 0) / l.quantity
          else l.total_price end) as amount,
        bool_or(exists (select 1 from full_cancel_refs f where f.ref in (l.order_key, l.order_id))) as full_flag,
        bool_or(exists (select 1 from restored r where r.ref in (l.order_key, l.order_id))) as has_restoration,
        count(l.restored_qty) as matched_lines,
        bool_and(l.order_item_id is not null and coalesce(l.restored_qty, 0) >= l.quantity) as all_restored
      from lines l
      group by l.order_key
    ),
    orders as (
      select order_key, customer_id, ordered_at, amount,
        (${kstWallClock(sql`ordered_at`)})::date as day
      from order_status
      where not (full_flag or (has_restoration and (matched_lines = 0 or all_restored)))
    ),
    firsts as (
      select customer_id, min(day) as first_day from orders group by 1
    )`;
}

@Injectable()
export class CustomerFlowQuery {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly dbService: DbService<typeof analyticsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async rows(query: SQL): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.execute(query);
    return [...result] as Array<Record<string, unknown>>;
  }

  /** 일별 구매자 수(서로 다른 회원). 빈 날은 0. 관리자 메인의 «하루 평균 구매자»와 그 비교 기준이 쓴다. */
  async getDailyBuyers(from: string, to: string): Promise<Array<{ date: string; buyers: number }>> {
    const until = seoulDayStart(addDays(to, 1));
    const rows = await this.rows(sql`
      with ${customerOrdersCte(until)}
      select to_char(o.day, 'YYYY-MM-DD') as date, count(distinct o.customer_id) as buyers
      from orders o where o.day between ${from}::date and ${to}::date
      group by 1`);
    const byDate = new Map(rows.map((r) => [String(r.date), num(r.buyers)]));
    const out: Array<{ date: string; buyers: number }> = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, buyers: byDate.get(d) ?? 0 });
    return out;
  }

  async getFlow(from: string, to: string, granularity: GrowthGranularity, today: string): Promise<CustomerFlowResult> {
    const prev = previousRange(from, to);
    const prevPrev = previousRange(prev.from, prev.to);
    const until = seoulDayStart(addDays(to, 1));
    const cte = customerOrdersCte(until);
    const start = bucketStart(sql`o.day`, granularity);

    const periodSql = (p: { from: string; to: string }) => sql`
      with ${cte},
      active as (
        select o.customer_id, count(distinct o.day) as days, sum(o.amount) as amount
        from orders o where o.day between ${p.from}::date and ${p.to}::date group by 1
      )
      select
        count(*) as buyers,
        count(*) filter (where f.first_day >= ${p.from}::date) as new_buyers,
        count(*) filter (where f.first_day < ${p.from}::date) as returning_buyers,
        count(*) filter (where a.days >= 2) as repeat_buyers,
        coalesce(sum(a.amount) filter (where f.first_day >= ${p.from}::date), 0) as new_revenue,
        coalesce(sum(a.amount) filter (where f.first_day < ${p.from}::date), 0) as returning_revenue
      from active a join firsts f using (customer_id)`;

    // 성장 회계: 이번 기간 활성(A), 직전 기간 활성(B). 신규 = A 중 첫구매가 이번 기간, 유지 = A∩B,
    // 복귀 = A 중 B 에 없고 첫구매가 이번 기간 이전, 이탈 = B 중 A 에 없음.
    const accountingSql = (cur: { from: string; to: string }, before: { from: string; to: string }) => sql`
      with ${cte},
      a as (select distinct customer_id from orders where day between ${cur.from}::date and ${cur.to}::date),
      b as (select distinct customer_id from orders where day between ${before.from}::date and ${before.to}::date)
      select
        (select count(*) from a join firsts f using (customer_id) where f.first_day >= ${cur.from}::date) as new_customers,
        (select count(*) from a join b using (customer_id)) as retained,
        (select count(*) from a join firsts f using (customer_id)
          where f.first_day < ${cur.from}::date and not exists (select 1 from b where b.customer_id = a.customer_id)) as resurrected,
        (select count(*) from b where not exists (select 1 from a where a.customer_id = b.customer_id)) as churned`;

    const endMonthStart = `${to.slice(0, 7)}-01`;
    const cohortStart = addMonthsDate(endMonthStart, -(COHORT_MONTHS - 1));
    const headlineDays = 90;
    const headCurTo = addDays(today, -headlineDays - 1);
    const headCurFrom = addDays(headCurTo, -(headlineDays - 1));
    const headPrevTo = addDays(headCurFrom, -1);
    const headPrevFrom = addDays(headPrevTo, -(headlineDays - 1));

    const [seriesRows, curRows, prevRows, accCur, accPrev, cohortRows, headRows, gapRows, dueRows, coverageRows] =
      await Promise.all([
        this.rows(sql`
          with ${cte}
          select ${bucketLabel(start, granularity)} as bucket,
            count(distinct o.customer_id) as buyers,
            count(distinct o.customer_id) filter (where f.first_day >= ${start}) as new_buyers,
            count(distinct o.customer_id) filter (where f.first_day < ${start}) as returning_buyers
          from orders o join firsts f using (customer_id)
          where o.day between ${from}::date and ${to}::date
          group by 1 order by 1`),
        this.rows(periodSql({ from, to })),
        this.rows(periodSql(prev)),
        this.rows(accountingSql({ from, to }, prev)),
        this.rows(accountingSql(prev, prevPrev)),
        this.rows(sql`
          with ${cte},
          cohort as (
            select f.customer_id, f.first_day, to_char(f.first_day, 'YYYY-MM') as cohort_month,
              (select min(o.day) from orders o where o.customer_id = f.customer_id and o.day > f.first_day) as second_day
            from firsts f where f.first_day >= ${cohortStart}::date and f.first_day <= ${to}::date
          )
          select cohort_month, count(*) as size,
            ${sql.join(
              REPEAT_WINDOWS.map(
                (d) => sql`
              count(*) filter (where first_day + ${d}::int <= ${today}::date) as matured_${sql.raw(String(d))},
              count(*) filter (where first_day + ${d}::int <= ${today}::date and second_day <= first_day + ${d}::int) as repeaters_${sql.raw(String(d))}`,
              ),
              sql`,`,
            )}
          from cohort group by 1 order by 1`),
        this.rows(sql`
          with ${cte},
          cohort as (
            select f.first_day,
              exists (select 1 from orders o where o.customer_id = f.customer_id
                        and o.day > f.first_day and o.day <= f.first_day + ${headlineDays}::int) as repeated
            from firsts f where f.first_day between ${headPrevFrom}::date and ${headCurTo}::date
          )
          select
            count(*) filter (where first_day >= ${headCurFrom}::date) as cur_n,
            count(*) filter (where first_day >= ${headCurFrom}::date and repeated) as cur_r,
            count(*) filter (where first_day < ${headCurFrom}::date) as prev_n,
            count(*) filter (where first_day < ${headCurFrom}::date and repeated) as prev_r
          from cohort`),
        this.rows(sql`
          with ${cte},
          gaps as (
            select (select min(o.day) from orders o where o.customer_id = f.customer_id and o.day > f.first_day) - f.first_day as gap
            from firsts f where f.first_day > ${today}::date - 365
          )
          select percentile_cont(array[0.25, 0.5, 0.75]) within group (order by gap) as p, count(gap) as n
          from gaps where gap is not null`),
        this.rows(sql`
          with ${cte},
          gaps as (
            select (select min(o.day) from orders o where o.customer_id = f.customer_id and o.day > f.first_day) - f.first_day as gap
            from firsts f where f.first_day > ${today}::date - 365
          ),
          q as (select percentile_cont(0.25) within group (order by gap) as lo,
                       percentile_cont(0.75) within group (order by gap) as hi from gaps where gap is not null),
          singles as (
            select f.customer_id, ${today}::date - f.first_day as age from firsts f
            where not exists (select 1 from orders o where o.customer_id = f.customer_id and o.day > f.first_day)
          )
          select (select lo from q) as lo, (select hi from q) as hi,
            (select count(*) from singles, q where singles.age between floor(q.lo) and ceil(q.hi)) as due`),
        this.rows(sql`
          select
            (select coalesce(sum(orders_count), 0) from agg_channel_daily
              where sales_channel = ${OWN_MALL_CHANNEL} and agg_date between ${from}::date and ${to}::date) as own_mall_orders,
            (select count(distinct order_key) from fact_order_items
              where sales_channel = ${OWN_MALL_CHANNEL} and customer_id is not null
                and occurred_at >= ${utcWall(seoulDayStart(from))} and occurred_at < ${utcWall(until)}) as member_orders`),
      ]);

    const period = (r: Record<string, unknown> | undefined): PeriodCustomers => ({
      buyers: num(r?.buyers),
      newBuyers: num(r?.new_buyers),
      returningBuyers: num(r?.returning_buyers),
      repeatBuyers: num(r?.repeat_buyers),
      newBuyerRevenue: Math.round(num(r?.new_revenue)),
      returningBuyerRevenue: Math.round(num(r?.returning_revenue)),
    });
    const accounting = (r: Record<string, unknown> | undefined): GrowthAccounting => {
      const churned = num(r?.churned);
      const newCustomers = num(r?.new_customers);
      const resurrected = num(r?.resurrected);
      return {
        newCustomers,
        retained: num(r?.retained),
        resurrected,
        churned,
        quickRatio: churned > 0 ? (newCustomers + resurrected) / churned : null,
      };
    };
    const head = headRows[0] ?? {};
    const gaps = (gapRows[0]?.p as number[] | null) ?? null;
    const due = dueRows[0] ?? {};

    return {
      range: { from, to },
      previousRange: prev,
      granularity,
      series: seriesRows.map((r) => ({
        bucket: String(r.bucket),
        buyers: num(r.buyers),
        newBuyers: num(r.new_buyers),
        returningBuyers: num(r.returning_buyers),
      })),
      current: period(curRows[0]),
      previous: period(prevRows[0]),
      growthAccounting: { current: accounting(accCur[0]), previous: accounting(accPrev[0]) },
      repeatHeadline: {
        days: headlineDays,
        current: { firstBuyers: num(head.cur_n), repeaters: num(head.cur_r), from: headCurFrom, to: headCurTo },
        previous: { firstBuyers: num(head.prev_n), repeaters: num(head.prev_r), from: headPrevFrom, to: headPrevTo },
      },
      cohorts: cohortRows.map((r) => {
        const size = num(r.size);
        return {
          cohortMonth: String(r.cohort_month),
          size,
          windows: REPEAT_WINDOWS.map((d) => {
            const matured = num(r[`matured_${d}`]);
            return { days: d, matured, repeaters: num(r[`repeaters_${d}`]), immature: size - matured };
          }),
        };
      }),
      timeToSecond: {
        p25: gaps ? numOrNull(gaps[0]) : null,
        p50: gaps ? numOrNull(gaps[1]) : null,
        p75: gaps ? numOrNull(gaps[2]) : null,
        n: num(gapRows[0]?.n),
      },
      repurchaseDue: {
        customers: num(due.due),
        fromDays: due.lo == null ? null : Math.floor(num(due.lo)),
        toDays: due.hi == null ? null : Math.ceil(num(due.hi)),
      },
      coverage: { ownMallOrders: num(coverageRows[0]?.own_mall_orders), memberOrders: num(coverageRows[0]?.member_orders) },
    };
  }
}

function addMonthsDate(monthStart: string, months: number): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
