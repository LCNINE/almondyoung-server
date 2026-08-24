import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, countDistinct, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { analyticsSchema, aggMembershipDaily, dimCustomerMembership } from '../../../schema';
import { DbTx } from '../../../db.types';
import { SEOUL_TZ, seoulDayStart, toSeoulDateOnly } from '../../../shared/date.util';

/**
 * `agg_membership_daily` 일별 스냅샷 (periodic snapshot fact).
 *
 * 이벤트 증분으로는 만들 수 없다 — 아무 일도 없던 날에도 행이 필요하다. 대신
 * `dim_customer_membership` 의 열린 구간을 그날 KST 00:00 기준으로 세어 기록한다.
 * 구간이 SCD 이력이므로 **과거 어느 날짜든 같은 정의로 재계산**할 수 있고(백필·재실행에
 * 자연 멱등), 이벤트 유실이 있어도 dim 이 복구되면 스냅샷도 따라온다.
 *
 * 지금 기록하는 status 는 `ACTIVE` 뿐이다 — dim 은 자격 보유 구간만 추적하고
 * (PAUSED/CANCELLED/EXPIRED 는 구간을 닫는다), "회원 수 추이" 요구사항이 원하는 것도
 * 자격 보유 회원 수다. 상태별 분포가 필요해지면 `fact_membership_events` 의 최신 상태
 * 재생으로 확장한다.
 */
@Injectable()
export class MembershipDailySnapshotService {
  private readonly logger = new Logger(MembershipDailySnapshotService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  /**
   * 매일 KST 00:05 — 오늘 날짜의 스냅샷을 기록한다.
   * 00:00 정각을 피하는 것은 자정 경계에서 도착 중인 이벤트와의 경합을 줄이기 위해서다.
   */
  @Cron('5 0 * * *', { timeZone: SEOUL_TZ })
  async snapshotToday(): Promise<void> {
    const aggDate = toSeoulDateOnly(new Date());
    try {
      await this.snapshotFor(aggDate);
    } catch (error) {
      // 크론 경로 — throw 하면 조용히 죽는다. 다음 날 실행이 복구하지 못하는 건 그날 하루의
      // 빈 행뿐이고, 그마저 snapshotFor(date) 수동 호출로 재계산 가능하다.
      this.logger.error(`agg_membership_daily 스냅샷 실패: ${aggDate}`, error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * 주어진 KST 날짜의 스냅샷을 (재)기록한다. 같은 날짜에 다시 호출하면 지우고 다시 쓴다 —
   * 부분 실패나 dim 소급 정정 후 재실행이 안전하다.
   */
  async snapshotFor(aggDate: string, tx?: DbTx): Promise<void> {
    const asOf = seoulDayStart(aggDate);

    await this.dbService.run(async (executor) => {
      const rows = await executor
        .select({
          tierId: dimCustomerMembership.tierId,
          membersCount: countDistinct(dimCustomerMembership.userId),
        })
        .from(dimCustomerMembership)
        .where(
          and(
            lte(dimCustomerMembership.validFrom, asOf),
            or(isNull(dimCustomerMembership.validTo), gt(dimCustomerMembership.validTo, asOf)),
          ),
        )
        .groupBy(dimCustomerMembership.tierId);

      // 스냅샷은 증분이 아니라 대입이다 — 지난 실행의 행을 남겨두면 사라진 tier 가 유령으로 남는다.
      await executor
        .delete(aggMembershipDaily)
        .where(and(eq(aggMembershipDaily.aggDate, aggDate), eq(aggMembershipDaily.status, 'ACTIVE')));

      if (rows.length > 0) {
        const now = new Date();
        await executor.insert(aggMembershipDaily).values(
          rows.map((row) => ({
            aggDate,
            status: 'ACTIVE',
            tierId: row.tierId,
            membersCount: row.membersCount,
            updatedAt: now,
          })),
        );
      }

      this.logger.log(`agg_membership_daily 스냅샷 기록: ${aggDate}, tier ${rows.length}종`);
    }, tx);
  }
}
