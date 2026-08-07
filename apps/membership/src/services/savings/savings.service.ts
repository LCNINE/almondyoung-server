import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { SavingsReader } from './savings.reader';
import { BenefitReader } from '../benefit/benefit.reader';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { EntitlementService } from '../entitlement.service';
import { bucketDiscountsByPeriod, deriveBillingPeriods, type BillingPeriod } from './billing-period.util';

export interface SavingsPeriodDto {
  /** 기간 식별자. 조회 파라미터로 그대로 되돌아온다. */
  id: string;
  contractId: string;
  periodNumber: number;
  /** 주기 시작 (ISO) */
  startDate: string;
  /** 주기 종료, 배타적 (ISO) */
  endDate: string;
  isCurrent: boolean;
  totalSavings: number;
  orderCount: number;
}

export interface SavingsOverviewDto {
  userId: string;
  /** 현재 결제 주기. 활성 계약이 없으면 null. */
  currentPeriod: SavingsPeriodDto | null;
  /** 과거 주기 포함 전체 목록 (최신순) */
  periods: SavingsPeriodDto[];
  /** 멤버십 가입 이래 전체 누적 (주기에 속한 할인만 센다) */
  allTime: { totalSavings: number; orderCount: number };
}

export interface SavingsOrderDto {
  orderId: string;
  orderDate: string;
  discountAmount: number;
}

export interface SavingsPeriodDetailDto extends SavingsPeriodDto {
  orders: SavingsOrderDto[];
}

/**
 * 멤버십 절약액 조회 (Business Layer)
 *
 * 기간 단위는 **결제 주기**다. 환불 가능 여부가 결제 주기 기준으로 판정되므로, 화면이 달력 월로
 * 끊으면 고객이 본 금액과 환불 판정 근거가 어긋난다.
 */
@Injectable()
export class SavingsService {
  constructor(
    private readonly savingsReader: SavingsReader,
    private readonly benefitReader: BenefitReader,
    private readonly contractReader: SubscriptionContractReader,
    private readonly entitlementService: EntitlementService,
  ) {}

  /** 주기 목록 + 각 주기 절약액 + 전체 누적 */
  async getOverview(userId: string): Promise<SavingsOverviewDto> {
    const periods = await this.resolvePeriods(userId);

    if (periods.length === 0) {
      return { userId, currentPeriod: null, periods: [], allTime: { totalSavings: 0, orderCount: 0 } };
    }

    // 주기마다 질의하면 계약이 오래된 고객에서 수십 번이 된다. 한 번 읽고 메모리에서 나눈다.
    const earliest = periods.reduce((min, p) => (p.start < min ? p.start : min), periods[0].start);
    const events = await this.benefitReader.findDiscountEventsBetween(userId, earliest);
    const buckets = bucketDiscountsByPeriod(periods, events);

    const dtos = periods.map((period) => this.toPeriodDto(period, buckets.get(period) ?? []));
    // 최신 주기가 위로 — 고객이 먼저 보고 싶은 건 방금 지난 주기다.
    dtos.sort((a, b) => b.startDate.localeCompare(a.startDate));

    return {
      userId,
      currentPeriod: dtos.find((p) => p.isCurrent) ?? null,
      periods: dtos,
      allTime: {
        totalSavings: dtos.reduce((sum, p) => sum + p.totalSavings, 0),
        orderCount: dtos.reduce((sum, p) => sum + p.orderCount, 0),
      },
    };
  }

  /** 한 주기의 절약 내역 — 합계 + 주문별 상세 */
  async getPeriodDetail(userId: string, periodId: string): Promise<SavingsPeriodDetailDto> {
    const periods = await this.resolvePeriods(userId);
    const period = periods.find((p) => this.periodId(p) === periodId);
    if (!period) throw new BadRequestError('해당 결제 주기를 찾을 수 없습니다');

    const orders = await this.benefitReader.findDiscountEventsBetween(userId, period.start, period.end);

    return {
      ...this.toPeriodDto(period, orders),
      orders: orders.map((o) => ({
        orderId: o.orderId,
        orderDate: o.orderDate.toISOString(),
        discountAmount: o.discountAmount,
      })),
    };
  }

  /**
   * 계약별 절약액 합계 — 구독 이력 화면이 "얼마 내고 얼마 아꼈는지"를 한 줄에 보여주는 데 쓴다.
   */
  async getSavingsByContract(userId: string): Promise<Record<string, { totalSavings: number; orderCount: number }>> {
    const periods = await this.resolvePeriods(userId);
    if (periods.length === 0) return {};

    const earliest = periods.reduce((min, p) => (p.start < min ? p.start : min), periods[0].start);
    const events = await this.benefitReader.findDiscountEventsBetween(userId, earliest);
    const buckets = bucketDiscountsByPeriod(periods, events);

    const byContract: Record<string, { totalSavings: number; orderCount: number }> = {};
    for (const period of periods) {
      const bucket = buckets.get(period) ?? [];
      const acc = (byContract[period.contractId] ??= { totalSavings: 0, orderCount: 0 });
      acc.totalSavings += bucket.reduce((sum, e) => sum + e.discountAmount, 0);
      acc.orderCount += bucket.length;
    }

    return byContract;
  }

  /**
   * 달력 월 절약액.
   *
   * @deprecated 고객 화면은 `getOverview` 의 결제 주기를 쓴다. 달력 월은 환불 판정 기간과 경계가
   * 달라 "화면엔 절약했다고 나오는데 환불은 되는" 식의 어긋남을 만든다. 배포 과도기에 옛
   * 스토어프론트가 부르는 경로를 살려두기 위해서만 남긴다.
   */
  async getMonthSavings(userId: string, yearMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new BadRequestError('Invalid yearMonth format. Use YYYY-MM');
    const result = await this.savingsReader.getMonthSavings(userId, yearMonth);
    return { userId, yearMonth, ...result };
  }

  /**
   * 임의 기간 절약액. 관리자 조회·CS 문의 확인용이며, 고객 화면의 기본 단위는 주기다.
   */
  async getRangeSavings(userId: string, startDate: Date, endDate: Date) {
    if (startDate > endDate) throw new BadRequestError('startDate must be before or equal to endDate');
    return this.savingsReader.getRangeSavings(userId, startDate, endDate);
  }

  /**
   * 사용자의 모든 결제 주기.
   *
   * 계약 종료 시각은 활성 계약이면 현재 자격 종료일, 아니면 해지 시각을 쓴다. 둘 다 없으면
   * 첫 결제일 + 플랜 기간으로 본다(결제 기록 없이 만료된 옛 계약).
   */
  private async resolvePeriods(userId: string): Promise<BillingPeriod[]> {
    const [rows, entitlementData] = await Promise.all([
      this.contractReader.findContractsByUserIdWithPlan(userId),
      this.entitlementService.getUserEntitlement(userId).catch(() => null),
    ]);

    const now = new Date();
    const currentEndsAt = entitlementData?.entitlement.endsAt ? new Date(entitlementData.entitlement.endsAt) : null;

    return rows.flatMap(({ contract, plan }) => {
      const start = new Date(contract.billingDate);
      const end =
        contract.status === 'ACTIVE' && currentEndsAt
          ? currentEndsAt
          : (contract.cancelledAt ?? new Date(start.getTime() + plan.durationDays * 86_400_000));

      return deriveBillingPeriods(
        { contractId: contract.id, start, end, durationDays: plan.durationDays },
        now,
      );
    });
  }

  private periodId(period: BillingPeriod): string {
    return `${period.contractId}:${period.periodNumber}`;
  }

  private toPeriodDto(
    period: BillingPeriod,
    events: Array<{ discountAmount: number }>,
  ): SavingsPeriodDto {
    return {
      id: this.periodId(period),
      contractId: period.contractId,
      periodNumber: period.periodNumber,
      startDate: period.start.toISOString(),
      endDate: period.end.toISOString(),
      isCurrent: period.isCurrent,
      totalSavings: events.reduce((sum, e) => sum + e.discountAmount, 0),
      orderCount: events.length,
    };
  }
}
