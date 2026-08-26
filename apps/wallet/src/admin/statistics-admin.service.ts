import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { charges, invoices, paymentFeeRates, paymentMethods, PaymentMethodType, refunds, WalletSchema } from '../schema';

export interface FeeRateDto {
  id: string;
  methodType: PaymentMethodType;
  feeRateBp: number;
  effectiveFrom: string;
  memo: string | null;
  createdAt: string;
}

export interface FeeMethodSummary {
  methodType: string;
  capturedAmount: number;
  capturedCount: number;
  refundedAmount: number;
  /** 요율이 설정된 시점의 캡처 금액 — 수수료 추정의 분모 */
  coveredAmount: number;
  /** 요율 미설정 시점의 캡처 금액 — "계산 불가" 몫 */
  uncoveredAmount: number;
  /** coveredAmount 에 요율을 적용한 추정 수수료 */
  estimatedFee: number;
  /** 기간 종료일 기준 적용 요율(표시용). 미설정이면 null. */
  appliedFeeRateBp: number | null;
}

export interface FeeSummaryResponse {
  range: { from: string; to: string };
  methods: FeeMethodSummary[];
  totals: {
    capturedAmount: number;
    refundedAmount: number;
    coveredAmount: number;
    uncoveredAmount: number;
    estimatedFee: number;
  };
}

export interface MembershipRevenuePoint {
  bucket: string;
  amount: number;
  count: number;
}

export interface MembershipRevenueResponse {
  range: { from: string; to: string };
  totalAmount: number;
  invoiceCount: number;
  series: MembershipRevenuePoint[];
}

interface FeeRateLookupRow {
  methodType: string;
  feeRateBp: number;
  effectiveFrom: Date;
}

/** KST 달력 날짜 문자열(YYYY-MM-DD)의 자정 시각 */
export function kstDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+09:00`);
}

/** 해당 시각에 적용되는 요율(effective_from 이 가장 늦으면서 at 이하) — 없으면 null */
export function resolveFeeRateBp(rates: FeeRateLookupRow[], methodType: string, at: Date): number | null {
  let found: FeeRateLookupRow | null = null;
  for (const rate of rates) {
    if (rate.methodType !== methodType) continue;
    if (rate.effectiveFrom.getTime() > at.getTime()) continue;
    if (!found || rate.effectiveFrom.getTime() > found.effectiveFrom.getTime()) {
      found = rate;
    }
  }
  return found ? found.feeRateBp : null;
}

export interface DailyCapturedRow {
  methodType: string;
  day: string;
  amount: number;
  count: number;
}

/** 일×결제수단 캡처 금액에 그 날 적용 요율을 곱해 결제수단별로 합산한다. */
export function summarizeFees(
  daily: DailyCapturedRow[],
  refundedByMethod: Map<string, number>,
  rates: FeeRateLookupRow[],
  rangeTo: string,
): FeeMethodSummary[] {
  const byMethod = new Map<string, FeeMethodSummary>();
  const methodTypes = new Set<string>([...daily.map((row) => row.methodType), ...refundedByMethod.keys()]);
  for (const methodType of methodTypes) {
    byMethod.set(methodType, {
      methodType,
      capturedAmount: 0,
      capturedCount: 0,
      refundedAmount: refundedByMethod.get(methodType) ?? 0,
      coveredAmount: 0,
      uncoveredAmount: 0,
      estimatedFee: 0,
      appliedFeeRateBp: resolveFeeRateBp(rates, methodType, kstDayStart(rangeTo)),
    });
  }
  for (const row of daily) {
    const summary = byMethod.get(row.methodType);
    if (!summary) continue;
    summary.capturedAmount += row.amount;
    summary.capturedCount += row.count;
    const rateBp = resolveFeeRateBp(rates, row.methodType, kstDayStart(row.day));
    if (rateBp == null) {
      summary.uncoveredAmount += row.amount;
    } else {
      summary.coveredAmount += row.amount;
      summary.estimatedFee += Math.round((row.amount * rateBp) / 10_000);
    }
  }
  return [...byMethod.values()].sort((a, b) => b.capturedAmount - a.capturedAmount);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function assertRange(from: string, to: string): void {
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
    throw new BadRequestException('from/to 는 YYYY-MM-DD 형식이어야 합니다');
  }
  if (from > to) {
    throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
  }
}

@Injectable()
export class StatisticsAdminService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async listFeeRates(): Promise<{ items: FeeRateDto[] }> {
    const rows = await this.db
      .select()
      .from(paymentFeeRates)
      .orderBy(asc(paymentFeeRates.methodType), desc(paymentFeeRates.effectiveFrom));
    return {
      items: rows.map((row) => ({
        id: row.id,
        methodType: row.methodType,
        feeRateBp: row.feeRateBp,
        effectiveFrom: row.effectiveFrom.toISOString(),
        memo: row.memo ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async createFeeRate(input: {
    methodType: PaymentMethodType;
    feeRateBp: number;
    effectiveFrom: string;
    memo?: string;
  }): Promise<{ id: string }> {
    if (!DATE_ONLY.test(input.effectiveFrom)) {
      throw new BadRequestException('effectiveFrom 은 YYYY-MM-DD 형식이어야 합니다');
    }
    const effectiveFrom = kstDayStart(input.effectiveFrom);
    const [existing] = await this.db
      .select({ id: paymentFeeRates.id })
      .from(paymentFeeRates)
      .where(and(eq(paymentFeeRates.methodType, input.methodType), eq(paymentFeeRates.effectiveFrom, effectiveFrom)))
      .limit(1);
    if (existing) {
      throw new ConflictException(`같은 결제수단·적용일의 요율이 이미 있습니다: ${input.methodType} ${input.effectiveFrom}`);
    }
    const [inserted] = await this.db
      .insert(paymentFeeRates)
      .values({
        methodType: input.methodType,
        feeRateBp: input.feeRateBp,
        effectiveFrom,
        memo: input.memo ?? null,
      })
      .returning({ id: paymentFeeRates.id });
    return { id: inserted.id };
  }

  async deleteFeeRate(id: string): Promise<{ deleted: true }> {
    const rows = await this.db.delete(paymentFeeRates).where(eq(paymentFeeRates.id, id)).returning({ id: paymentFeeRates.id });
    if (rows.length === 0) {
      throw new NotFoundException(`요율을 찾을 수 없습니다: ${id}`);
    }
    return { deleted: true };
  }

  /**
   * 기간(KST 달력일) 내 결제수단별 캡처 금액 × 시점 요율 = 추정 수수료.
   * 실 수수료 원천이 없으므로 어디까지나 근사치다 — 요율 미설정 구간은 "계산 불가"로 분리한다.
   */
  async getFeeSummary(from: string, to: string): Promise<FeeSummaryResponse> {
    assertRange(from, to);

    const chargeDay = sql<string>`((${charges.createdAt} AT TIME ZONE 'Asia/Seoul')::date)::text`;
    const [capturedRows, refunded, rateRows] = await Promise.all([
      this.db
        .select({
          methodType: paymentMethods.type,
          day: chargeDay,
          amount: sql<string>`SUM(${charges.amount})`,
          count: sql<string>`COUNT(*)`,
        })
        .from(charges)
        .innerJoin(paymentMethods, eq(paymentMethods.id, charges.paymentMethodId))
        .where(
          and(
            eq(charges.operation, 'CAPTURE'),
            eq(charges.status, 'SUCCEEDED'),
            sql`(${charges.createdAt} AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date`,
          ),
        )
        .groupBy(paymentMethods.type, sql`(${charges.createdAt} AT TIME ZONE 'Asia/Seoul')::date`),
      this.refundedByMethod(from, to),
      this.db
        .select({
          methodType: paymentFeeRates.methodType,
          feeRateBp: paymentFeeRates.feeRateBp,
          effectiveFrom: paymentFeeRates.effectiveFrom,
        })
        .from(paymentFeeRates),
    ]);

    const daily: DailyCapturedRow[] = capturedRows.map((row) => ({
      methodType: row.methodType,
      day: row.day,
      amount: Number(row.amount),
      count: Number(row.count),
    }));

    const methods = summarizeFees(daily, refunded, rateRows, to);
    const totals = methods.reduce(
      (acc, method) => ({
        capturedAmount: acc.capturedAmount + method.capturedAmount,
        refundedAmount: acc.refundedAmount + method.refundedAmount,
        coveredAmount: acc.coveredAmount + method.coveredAmount,
        uncoveredAmount: acc.uncoveredAmount + method.uncoveredAmount,
        estimatedFee: acc.estimatedFee + method.estimatedFee,
      }),
      { capturedAmount: 0, refundedAmount: 0, coveredAmount: 0, uncoveredAmount: 0, estimatedFee: 0 },
    );

    return { range: { from, to }, methods, totals };
  }

  private async refundedByMethod(from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        methodType: paymentMethods.type,
        amount: sql<string>`SUM(${refunds.amount})`,
      })
      .from(refunds)
      .innerJoin(charges, eq(charges.id, refunds.chargeId))
      .innerJoin(paymentMethods, eq(paymentMethods.id, charges.paymentMethodId))
      .where(
        and(
          eq(refunds.status, 'SUCCEEDED'),
          sql`(${refunds.createdAt} AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date`,
        ),
      )
      .groupBy(paymentMethods.type);
    return new Map(rows.map((row) => [row.methodType, Number(row.amount)]));
  }

  /** 멤버십 구독료 수입 — PAID 인보이스의 amount_due 를 finalized_at(KST 달력일) 기준으로 귀속 */
  async getMembershipRevenue(from: string, to: string): Promise<MembershipRevenueResponse> {
    assertRange(from, to);

    const bucket = sql<string>`((${invoices.finalizedAt} AT TIME ZONE 'Asia/Seoul')::date)::text`;
    const rows = await this.db
      .select({
        bucket,
        amount: sql<string>`SUM(${invoices.amountDue})`,
        count: sql<string>`COUNT(*)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriberType, 'MEMBERSHIP'),
          eq(invoices.status, 'PAID'),
          sql`(${invoices.finalizedAt} AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date`,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const series = rows.map((row) => ({
      bucket: row.bucket,
      amount: Number(row.amount),
      count: Number(row.count),
    }));

    return {
      range: { from, to },
      totalAmount: series.reduce((sum, point) => sum + point.amount, 0),
      invoiceCount: series.reduce((sum, point) => sum + point.count, 0),
      series,
    };
  }
}
