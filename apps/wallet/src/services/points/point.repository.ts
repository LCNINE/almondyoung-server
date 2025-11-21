// apps/wallet/src/repositories/point.repository.ts
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import * as schema from '../../shared/database/schema'; // 질문에 준 Drizzle 스키마 (point_* 테이블)
import { walletSchema } from '../../shared/database/schema';
import { DbService } from '@app/db';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type PointAction = 'EARN' | 'REDEEM' | 'EARN_CANCEL' | 'REDEEM_CANCEL';

// ✅ WMS 패턴: 트랜잭션 타입 정의
type DbTx = Parameters<
  Parameters<PostgresJsDatabase<typeof walletSchema>['transaction']>[0]
>[0];

export interface AddPointsParams {
  partnerId: string; // UUIDv7 (customerId와 동일)
  amount: number; // +정수
  reason?: string;
  orderId?: string;
  expiresAt?: Date; // 없으면 장기만료(예: 100년)로 서비스 레벨에서 채워도 됨
  withdrawalAvailableAt?: Date; // 없으면 즉시 출금 가능일로 보거나 정책으로 채우기
  memo?: string;
}

export interface RedeemParams {
  partnerId: string; // UUIDv7 (customerId와 동일)
  amount: number; // -로 반영되지만 입력은 양수 (필수)
  reason?: string;
  memo?: string;
}

export interface CancelPointsParams {
  partnerId: string; // UUIDv7 (customerId와 동일)
  eventIdToCancel: number; // 원본 EARN point_events.id
  cancelAmount?: number; // 없으면 잔여 전량 취소
  reason?: string;
  memo?: string;
}

export interface PointHistoryItem {
  id: number;
  partnerId: string;
  eventType: string;
  amount: number;
  balance: number;
  reason: string | null;
  createdAt: Date;
  [key: string]: unknown; // Fix for Drizzle execute generic constraint
}

@Injectable()
export class PointRepository {
  constructor(private readonly db: DbService<typeof walletSchema>) { }

  /**
   * ✅ WMS 패턴: 트랜잭션 헬퍼
   * tx가 있으면 재사용, 없으면 새 트랜잭션 시작
   */
  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  /** 파트너 총 잔액 (모든 포인트 합) */
  async getBalance(partnerId: string): Promise<number> {
    const [{ sum }] = await this.db.db.execute<{ sum: number }>(
      sql`SELECT COALESCE(SUM(${schema.pointEvents.amount}), 0) AS sum
          FROM ${schema.pointEvents}
          WHERE ${schema.pointEvents.partnerId} = ${partnerId}`,
    );
    return Number(sum ?? 0);
  }

  /** 출금 가능 잔액 (출금 가능일 도달/정책 반영은 서비스단에서 파라미터로 제어해도 됨) */
  async getWithdrawable(
    partnerId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const [{ sum }] = await this.db.db.execute<{ sum: number }>(
      sql`SELECT COALESCE(SUM(${schema.pointEvents.amount}), 0) AS sum
          FROM ${schema.pointEvents}
          WHERE ${schema.pointEvents.partnerId} = ${partnerId}
            AND (${schema.pointEvents.withdrawalAvailableAt} IS NULL
                 OR ${schema.pointEvents.withdrawalAvailableAt} <= ${now})`,
    );
    return Number(sum ?? 0);
  }

  /**
   * 포인트 내역 조회 (Running Balance 포함)
   */
  async getHistory(
    partnerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointHistoryItem[]; total: number }> {
    // 1. 전체 카운트
    const [{ count }] = await this.db.db.execute<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM ${schema.pointEvents} WHERE ${schema.pointEvents.partnerId} = ${partnerId}`,
    );

    // 2. 내역 조회 (Window Function으로 잔액 계산)
    const rows = await this.db.db.execute<PointHistoryItem>(
      sql`
        WITH calculated_balance AS (
          SELECT 
            id,
            partner_id as "partnerId",
            event_type as "eventType",
            amount,
            reason,
            created_at as "createdAt",
            SUM(amount) OVER (
              PARTITION BY partner_id 
              ORDER BY created_at ASC, id ASC
            ) as balance
          FROM ${schema.pointEvents}
          WHERE partner_id = ${partnerId}
        )
        SELECT * FROM calculated_balance
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return {
      items: rows,
      total: Number(count),
    };
  }

  /** 적립(ADD_POINTS): 헤더 + 디테일 1건(자기참조) 생성 */
  async addPoints(
    p: AddPointsParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; detailId: number }> {
    return await this.inTx(async (trx) => {
      // 1) 이벤트 헤더 생성
      const [ev] = await trx
        .insert(schema.pointEvents)
        .values({
          partnerId: p.partnerId,
          eventType: 'EARN',
          amount: p.amount, // +정수
          expiresAt:
            p.expiresAt ??
            new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // 기본: 10년 후
          withdrawalAvailableAt: p.withdrawalAvailableAt ?? new Date(), // 기본: 즉시
          reason: p.reason ?? null,
          memo: p.memo ?? null,
          orderId: p.orderId ?? null,
          originalEventId: null,
        })
        .returning({ id: schema.pointEvents.id });

      // 2) 헤더의 original_event_id = 본인
      await trx
        .update(schema.pointEvents)
        .set({ originalEventId: ev.id })
        .where(eq(schema.pointEvents.id, ev.id));

      // 3) 디테일 생성 (자기참조 셋업)
      const [detail] = await trx
        .insert(schema.pointEventDetails)
        .values({
          pointEventId: ev.id,
          partnerId: p.partnerId,
          eventType: 'EARN',
          amount: p.amount,
          earnedEventDetailId: null,
          originalEventDetailId: null,
        })
        .returning({ id: schema.pointEventDetails.id });

      // 디테일 자기참조(earned/original) = 본인
      await trx
        .update(schema.pointEventDetails)
        .set({
          earnedEventDetailId: detail.id,
          originalEventDetailId: detail.id,
        })
        .where(eq(schema.pointEventDetails.id, detail.id));

      return { eventId: ev.id, detailId: detail.id };
    }, tx); // ✅ 상위 트랜잭션 전파
  }

  /**
   * 사용(REDEEM) – FIFO(만료 임박순)로 차감
   * • point_event_details 집계로 '잔여 가용치(>0)' 버킷 정렬 후 순차 차감
   */
  async redeem(
    p: RedeemParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; used: number }> {
    return await this.inTx(async (trx) => {
      // 1) REDEEM 헤더 생성 (amount는 총합(-))
      const [ev] = await trx
        .insert(schema.pointEvents)
        .values({
          partnerId: p.partnerId,
          eventType: 'REDEEM',
          amount: -p.amount,
          reason: p.reason ?? null,
          memo: p.memo ?? null,
          originalEventId: null,
        })
        .returning({ id: schema.pointEvents.id });

      await trx
        .update(schema.pointEvents)
        .set({ originalEventId: ev.id })
        .where(eq(schema.pointEvents.id, ev.id));

      let remaining = p.amount;
      let used = 0;

      // 2) 전체 디테일 조회 (ORM 사용)
      const allDetails = await trx
        .select({
          id: schema.pointEventDetails.id,
          earnedEventDetailId: schema.pointEventDetails.earnedEventDetailId,
          amount: schema.pointEventDetails.amount,
          eventId: schema.pointEventDetails.pointEventId,
        })
        .from(schema.pointEventDetails)
        .where(eq(schema.pointEventDetails.partnerId, p.partnerId));

      // 3) root 이벤트의 만료일 조회
      const rootEventIds = [
        ...new Set(
          allDetails.map((d) => d.earnedEventDetailId).filter(Boolean),
        ),
      ];

      // 빈 배열이면 포인트가 없는 것
      if (rootEventIds.length === 0) {
        throw new Error('포인트가 부족합니다. 부족액: ' + p.amount);
      }

      const rootDetails = await trx
        .select({
          id: schema.pointEventDetails.id,
          eventId: schema.pointEventDetails.pointEventId,
        })
        .from(schema.pointEventDetails)
        .where(
          sql`${schema.pointEventDetails.id} IN (${sql.join(
            rootEventIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      const rootEventMap = new Map(rootDetails.map((r) => [r.id, r.eventId]));

      const eventIdsToFetch = [...rootEventMap.values()];
      if (eventIdsToFetch.length === 0) {
        throw new Error('포인트가 부족합니다. 부족액: ' + p.amount);
      }

      const events = await trx
        .select({
          id: schema.pointEvents.id,
          expiresAt: schema.pointEvents.expiresAt,
        })
        .from(schema.pointEvents)
        .where(
          sql`${schema.pointEvents.id} IN (${sql.join(
            eventIdsToFetch.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      const eventExpiresMap = new Map(events.map((e) => [e.id, e.expiresAt]));

      // 4) JavaScript에서 집계 (버킷별 합계 계산)
      const bucketMap = new Map<
        number,
        { sum: number; expiresAt: Date | null }
      >();

      for (const detail of allDetails) {
        const earnedId = detail.earnedEventDetailId;
        if (!earnedId) continue;

        const bucket = bucketMap.get(earnedId) || {
          sum: 0,
          expiresAt: null,
        };
        bucket.sum += detail.amount;

        if (!bucket.expiresAt) {
          const rootEventId = rootEventMap.get(earnedId);
          if (rootEventId) {
            bucket.expiresAt = eventExpiresMap.get(rootEventId) || null;
          }
        }

        bucketMap.set(earnedId, bucket);
      }

      // 5) 양수 버킷만 필터링하고 만료일 순 정렬 (FIFO)
      const buckets = Array.from(bucketMap.entries())
        .filter(([_, b]) => b.sum > 0)
        .map(([earnedId, b]) => ({
          earned_event_detail_id: earnedId,
          amount_sum: b.sum,
          expires_at: b.expiresAt,
        }))
        .sort((a, b) => {
          if (!a.expires_at && !b.expires_at) return 0;
          if (!a.expires_at) return 1;
          if (!b.expires_at) return -1;
          return a.expires_at.getTime() - b.expires_at.getTime();
        });

      // 6) 차감 루프
      for (const b of buckets) {
        if (remaining <= 0) break;

        const slice = Math.min(b.amount_sum, remaining);

        const [detail] = await trx
          .insert(schema.pointEventDetails)
          .values({
            pointEventId: ev.id,
            partnerId: p.partnerId,
            eventType: 'REDEEM',
            amount: -slice,
            earnedEventDetailId: b.earned_event_detail_id,
            originalEventDetailId: null,
          })
          .returning({ id: schema.pointEventDetails.id });

        await trx
          .update(schema.pointEventDetails)
          .set({ originalEventDetailId: detail.id })
          .where(eq(schema.pointEventDetails.id, detail.id));

        remaining -= slice;
        used += slice;
      }

      if (remaining > 0) {
        // 잔여 차감 실패 → 롤백
        throw new Error(`포인트가 부족합니다. 부족액: ${remaining}`);
      }

      return { eventId: ev.id, used };
    }, tx); // ✅ 상위 트랜잭션 전파
  }

  /**
   * 적립 취소(CANCEL_POINTS)
   * • 부분/전량 취소 모두 지원: cancelAmount 없으면 "남아있는 잔여 전량"
   */
  async cancelPoints(
    p: CancelPointsParams,
    tx?: DbTx,
  ): Promise<{ eventId: number; cancel: number }> {
    return await this.inTx(async (trx) => {
      // 1) 원본 EARN의 root detail 찾기
      const [root] = await trx
        .select({
          id: schema.pointEventDetails.id,
        })
        .from(schema.pointEventDetails)
        .where(
          and(
            eq(schema.pointEventDetails.pointEventId, p.eventIdToCancel),
            eq(schema.pointEventDetails.eventType, 'EARN'),
          ),
        )
        .limit(1);

      if (!root) throw new Error('해당 적립(EARN) 이력을 찾을 수 없습니다.');

      // 2) 잔여 가용치(= 해당 root로 묶인 합계)
      const [{ sum }] = (await trx.execute<{ sum: number }>(
        sql`SELECT COALESCE(SUM(${schema.pointEventDetails.amount}), 0) AS sum
              FROM ${schema.pointEventDetails}
              WHERE ${schema.pointEventDetails.earnedEventDetailId} = ${root.id}`,
      )) ?? [{ sum: 0 }];

      const remaining = Number(sum ?? 0);
      if (remaining <= 0) {
        throw new Error('적립 취소할 포인트가 남아 있지 않습니다.');
      }

      const cancelAmount = p.cancelAmount ?? remaining;
      if (cancelAmount <= 0) {
        throw new Error('취소 금액은 양수여야 합니다.');
      }
      if (cancelAmount > remaining) {
        throw new Error(
          `잔여 ${remaining} > 요청 ${cancelAmount} 이므로 취소 불가`,
        );
      }

      // 3) EARN_CANCEL 헤더
      const [ev] = await trx
        .insert(schema.pointEvents)
        .values({
          partnerId: p.partnerId,
          eventType: 'EARN_CANCEL',
          amount: -cancelAmount,
          reason: p.reason ?? null,
          memo: p.memo ?? null,
          originalEventId: p.eventIdToCancel,
        })
        .returning({ id: schema.pointEvents.id });

      // 4) 디테일 생성
      await trx.insert(schema.pointEventDetails).values({
        pointEventId: ev.id,
        partnerId: p.partnerId,
        eventType: 'EARN_CANCEL',
        amount: -cancelAmount,
        earnedEventDetailId: root.id,
        originalEventDetailId: root.id,
      });

      return { eventId: ev.id, cancel: cancelAmount };
    }, tx); // ✅ 상위 트랜잭션 전파
  }

  /** 파트너 레퍼런스/추천 중복 보상 체크 */
  async existsReferralReward(
    mallId: string,
    memberId: string,
  ): Promise<boolean> {
    const found = await this.db.db
      .select({ mallId: schema.referralRewards.mallId })
      .from(schema.referralRewards)
      .where(
        and(
          eq(schema.referralRewards.mallId, mallId),
          eq(schema.referralRewards.memberId, memberId),
        ),
      )
      .limit(1);

    return found.length > 0;
  }

  /** 추천 보상 기록(중복 방지) */
  async insertReferralReward(params: {
    mallId: string;
    memberId: string;
    requestId: number; // 내부 시퀀스/로그 id
  }): Promise<void> {
    await this.db.db.insert(schema.referralRewards).values({
      mallId: params.mallId,
      memberId: params.memberId,
      requestId: params.requestId,
    });
  }
}
