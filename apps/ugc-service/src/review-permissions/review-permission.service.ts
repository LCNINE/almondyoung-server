import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { ReviewEligibilityListQueryDto } from './dto/review-eligibility-query.dto';
import { CreateReviewEligibilityDto } from './dto/create-review-eligibility.dto';
import {
  type OrderEligibilityRow,
  type ReviewEligibilityEntity,
  type ReviewPermissionProvider,
  type RevokedEligibilityRow,
} from './types';
import { PaginatedResponseDto } from '@app/shared/dto';

export interface ConsumablePermission {
  id: string;
  orderLineAmount: number | null;
  /** 어떤 경로로 얻은 권한인지 — 보상 판정이 이걸로 갈린다. */
  provider: ReviewPermissionProvider;
}

/**
 * 리뷰를 쓸 «권한»을 소유한다. `review_eligibilities` 표를 만지는 곳은 이 서비스뿐이고,
 * 리뷰·보상 쪽은 여기에 물어보기만 한다 — 의존은 «리뷰 → 권한» 한 방향이다.
 */
@Injectable()
export class ReviewPermissionService {
  private static readonly ELIGIBILITY_EXPIRATION_DAYS = 15; // 리뷰 자격 만료 기간

  private readonly logger = new Logger(ReviewPermissionService.name);

  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  async create(dto: CreateReviewEligibilityDto, tx?: UgcTx): Promise<ReviewEligibilityEntity[]> {
    return this.db.run(async (trx) => {
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + ReviewPermissionService.ELIGIBILITY_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
      );

      const values = dto.items.map((item) => ({
        userId: dto.userId,
        productId: item.productId,
        orderId: dto.orderId,
        orderLineId: item.orderLineId,
        orderLineAmount: item.orderLineAmount ?? null,
        provider: 'order' as const,
        eligibleAt: now,
        expiresAt,
        sourceSystem: 'almondyoung' as const,
        sourceEventId: `order:${dto.orderId}:${item.orderLineId}`,
      }));

      const created = await trx.insert(reviewEligibilities).values(values).onConflictDoNothing().returning();

      this.logger.log(
        `[create] Created ${created.length} eligibilities for orderId=${dto.orderId}, userId=${dto.userId}`,
      );

      return created;
    }, tx);
  }

  async listByUser(
    userId: string,
    query: ReviewEligibilityListQueryDto,
    tx?: UgcTx,
  ): Promise<PaginatedResponseDto<ReviewEligibilityEntity>> {
    return this.db.run(async (trx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(reviewEligibilities.userId, userId)];

      const status = query.status ?? 'available';
      if (status === 'available') {
        conditions.push(isNull(reviewEligibilities.consumedAt));
        conditions.push(isNull(reviewEligibilities.revokedAt));
        conditions.push(gte(reviewEligibilities.expiresAt, new Date()));
      } else {
        conditions.push(isNotNull(reviewEligibilities.consumedAt));
      }

      if (query.productId) {
        conditions.push(eq(reviewEligibilities.productId, query.productId));
      }

      if (query.orderId) {
        conditions.push(eq(reviewEligibilities.orderId, query.orderId));
      }

      const whereClause = and(...conditions);

      const [{ count: total }] = await trx.select({ count: count() }).from(reviewEligibilities).where(whereClause);

      const data = await trx
        .select()
        .from(reviewEligibilities)
        .where(whereClause)
        .orderBy(desc(reviewEligibilities.eligibleAt))
        .limit(limit)
        .offset(offset);

      return { data, total, page, limit };
    }, tx);
  }

  /**
   * 자격을 «선점»한다 — 쓸 수 있는지 확인하는 일과 소비 표시가 조건부 UPDATE 한 문장이다.
   * 못 쓰면 던진다: 리뷰가 만들어지기 «전»에 막아야 한다.
   *
   * 확인(SELECT)과 소비(UPDATE)를 두 문장으로 갈라 두면 READ COMMITTED 아래에서 겹친 두
   * 요청이 «둘 다» 확인을 통과해 자격 하나로 리뷰가 둘 만들어진다(실 DB 로 재현했다).
   * 한 문장이면 뒤에 온 쪽이 행 잠금을 기다린 뒤 `consumed_at is null` 을 다시 평가해
   * 0행을 받는다 — 그래서 잠금을 따로 잡을 필요가 없다.
   *
   * 주문이 취소·반품되면 자격이 회수되므로 `revoked_at` 도 같이 본다.
   * 리뷰 참조(`consumed_by_review_id`)는 리뷰가 생긴 «뒤»에 `linkConsumedReview` 가 채운다 —
   * 그 컬럼이 `reviews.id` 를 참조하므로 아직 없는 리뷰를 먼저 가리킬 수 없다.
   */
  async consume(
    input: { permissionId: string; userId: string; productId: string },
    tx: UgcTx,
  ): Promise<ConsumablePermission> {
    const now = new Date();
    const [eligibility] = await tx
      .update(reviewEligibilities)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(reviewEligibilities.id, input.permissionId),
          eq(reviewEligibilities.userId, input.userId),
          eq(reviewEligibilities.productId, input.productId),
          isNull(reviewEligibilities.consumedAt),
          isNull(reviewEligibilities.revokedAt),
        ),
      )
      .returning({
        id: reviewEligibilities.id,
        orderLineAmount: reviewEligibilities.orderLineAmount,
        provider: reviewEligibilities.provider,
      });

    if (!eligibility) {
      throw new BadRequestException('리뷰 작성 자격이 없습니다.');
    }

    return eligibility;
  }

  /**
   * 선점한 자격에 «어느 리뷰로 썼는지»를 잇는다. `consume` 과 «같은 트랜잭션»이어야 한다 —
   * 조건이 없는 것은 소비 판정을 이미 `consume` 이 끝냈기 때문이다.
   */
  async linkConsumedReview(permissionId: string, reviewId: string, tx: UgcTx): Promise<void> {
    await tx
      .update(reviewEligibilities)
      .set({ consumedByReviewId: reviewId, updatedAt: new Date() })
      .where(eq(reviewEligibilities.id, permissionId));
  }

  /** 회수 대상 — 주문 전체. 이미 회수된 건은 제외한다(재전달 멱등). */
  async findLiveByOrderId(orderId: string, tx?: UgcTx): Promise<OrderEligibilityRow[]> {
    return this.db.run(
      async (trx) =>
        trx
          .select({
            id: reviewEligibilities.id,
            userId: reviewEligibilities.userId,
            orderLineId: reviewEligibilities.orderLineId,
            consumedByReviewId: reviewEligibilities.consumedByReviewId,
          })
          .from(reviewEligibilities)
          .where(and(eq(reviewEligibilities.orderId, orderId), isNull(reviewEligibilities.revokedAt))),
      tx,
    );
  }

  /** 회수 대상 — 지정한 주문 라인만. 부분 취소·부분 반품이 쓴다. */
  async findLiveByOrderLineIds(
    orderId: string,
    orderLineIds: string[],
    tx?: UgcTx,
  ): Promise<OrderEligibilityRow[]> {
    if (orderLineIds.length === 0) return [];

    return this.db.run(
      async (trx) =>
        trx
          .select({
            id: reviewEligibilities.id,
            userId: reviewEligibilities.userId,
            orderLineId: reviewEligibilities.orderLineId,
            consumedByReviewId: reviewEligibilities.consumedByReviewId,
          })
          .from(reviewEligibilities)
          .where(
            and(
              eq(reviewEligibilities.orderId, orderId),
              inArray(reviewEligibilities.orderLineId, orderLineIds),
              isNull(reviewEligibilities.revokedAt),
            ),
          ),
      tx,
    );
  }

  /**
   * 자격을 회수한다. `revoked_at IS NULL` 조건이 이 경로의 멱등성이다 —
   * 같은 이벤트가 재전달되면 0행을 돌려준다.
   *
   * 소비된 자격도 회수 표시를 남긴다 — 리뷰는 유지하되 「취소·반품된 주문의 자격」임을 남기는 것이
   * 감사 기록이다. 콘텐츠를 내릴지는 관리자가 화면에서 고른다(자동으로 내리지 않는다).
   */
  async revoke(
    permissionIds: string[],
    revokeReason: string,
    tx: UgcTx,
  ): Promise<RevokedEligibilityRow[]> {
    if (permissionIds.length === 0) return [];

    const now = new Date();
    return tx
      .update(reviewEligibilities)
      .set({ revokedAt: now, revokeReason, updatedAt: now })
      .where(and(inArray(reviewEligibilities.id, permissionIds), isNull(reviewEligibilities.revokedAt)))
      .returning({ id: reviewEligibilities.id, consumedByReviewId: reviewEligibilities.consumedByReviewId });
  }

  /**
   * 기간 내 발급·소비 건수. 통계가 자격 표를 직접 읽지 않게 여기서 준다.
   * 호출자가 다른 집계와 `Promise.all` 로 묶으므로 왕복은 늘지 않는다.
   */
  countIssuedInRange(from: Date, toExclusive: Date): Promise<{ eligibleCount: number; consumedCount: number }[]> {
    return this.client
      .select({
        eligibleCount: count(),
        consumedCount: sql<number>`count(*) filter (where ${reviewEligibilities.consumedAt} is not null)::int`,
      })
      .from(reviewEligibilities)
      .where(and(gte(reviewEligibilities.eligibleAt, from), lt(reviewEligibilities.eligibleAt, toExclusive)));
  }
}
