// apps/wallet/src/repositories/point.repository.ts
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import * as schema from '../shared/database/schema'; // 질문에 준 Drizzle 스키마 (point_* 테이블)
import { DbService } from '@app/db';
export type PointAction = 'EARN' | 'REDEEM' | 'EARN_CANCEL' | 'REDEEM_CANCEL';

export interface EarnParams {
  partnerId: number;
  amount: number; // +정수
  reason?: string;
  orderId?: string;
  expiresAt?: Date; // 없으면 장기만료(예: 100년)로 서비스 레벨에서 채워도 됨
  withdrawalAvailableAt?: Date; // 없으면 즉시 출금 가능일로 보거나 정책으로 채우기
  memo?: string;
}

export interface RedeemParams {
  partnerId: number;
  amount: number; // -로 반영되지만 입력은 양수 (필수)
  reason?: string;
  memo?: string;
}

export interface EarnCancelParams {
  partnerId: number;
  eventIdToCancel: number; // 원본 EARN point_events.id
  cancelAmount?: number; // 없으면 잔여 전량 취소
  reason?: string;
  memo?: string;
}

@Injectable()
export class PointRepository {
  constructor(private readonly db: DbService<typeof schema>) {}

  /** 파트너 총 잔액 (모든 포인트 합) */
  async getBalance(partnerId: number): Promise<number> {
    const [{ sum }] = await this.db.db.execute<{ sum: number }>(
      sql`SELECT COALESCE(SUM(${schema.pointEvents.amount}), 0) AS sum
          FROM ${schema.pointEvents}
          WHERE ${schema.pointEvents.partnerId} = ${partnerId}`,
    );
    return Number(sum ?? 0);
  }

  /** 출금 가능 잔액 (출금 가능일 도달/정책 반영은 서비스단에서 파라미터로 제어해도 됨) */
  async getWithdrawable(
    partnerId: number,
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

  /** 적립(EARN): 헤더 + 디테일 1건(자기참조) 생성 */
  async earn(p: EarnParams): Promise<{ eventId: number; detailId: number }> {
    return await this.db.db.transaction(async (tx) => {
      // 1) 이벤트 헤더 생성
      const [ev] = await tx
        .insert(schema.pointEvents)
        .values({
          partnerId: p.partnerId,
          eventType: 'EARN',
          amount: p.amount, // +정수
          expiresAt: p.expiresAt ?? new Date(8640000000000000), // 기본: 아주 먼 미래(자사 정책으로 조정)
          withdrawalAvailableAt: p.withdrawalAvailableAt ?? new Date(), // 기본: 즉시
          reason: p.reason ?? null,
          memo: p.memo ?? null,
          orderId: p.orderId ?? null,
          originalEventId: null,
        })
        .returning({ id: schema.pointEvents.id });

      // 2) 헤더의 original_event_id = 본인
      await tx
        .update(schema.pointEvents)
        .set({ originalEventId: ev.id })
        .where(eq(schema.pointEvents.id, ev.id));

      // 3) 디테일 생성 (자기참조 셋업)
      const [detail] = await tx
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
      await tx
        .update(schema.pointEventDetails)
        .set({
          earnedEventDetailId: detail.id,
          originalEventDetailId: detail.id,
        })
        .where(eq(schema.pointEventDetails.id, detail.id));

      return { eventId: ev.id, detailId: detail.id };
    });
  }

  /**
   * 사용(REDEEM) – FIFO(만료 임박순)로 차감
   * • point_event_details 집계로 ‘잔여 가용치(>0)’ 버킷 정렬 후 순차 차감
   */
  async redeem(p: RedeemParams): Promise<{ eventId: number; used: number }> {
    return await this.db.db.transaction(async (tx) => {
      // 1) REDEEM 헤더 생성 (amount는 총합(-))
      const [ev] = await tx
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

      await tx
        .update(schema.pointEvents)
        .set({ originalEventId: ev.id })
        .where(eq(schema.pointEvents.id, ev.id));

      let remaining = p.amount;
      let used = 0;

      // 2) 버킷 조회(FIFO: 만료 임박 순)
      //   earned_event_detail_id 기준으로 남은 합계 > 0 인 버킷들을 만료일 기준으로 정렬
      const buckets = await tx.execute<{
        earned_event_detail_id: number;
        amount_sum: number;
        expires_at: Date | null;
      }>(sql`
        SELECT
          d.${schema.pointEventDetails.earnedEventDetailId.name} AS earned_event_detail_id,
          SUM(d.${schema.pointEventDetails.amount.name}) AS amount_sum,
          MIN(e.${schema.pointEvents.expiresAt.name}) AS expires_at
        FROM ${schema.pointEventDetails} d
        JOIN ${schema.pointEventDetails} root
          ON d.${schema.pointEventDetails.earnedEventDetailId.name} = root.${schema.pointEventDetails.id.name}
        JOIN ${schema.pointEvents} e
          ON root.${schema.pointEventDetails.pointEventId.name} = e.${schema.pointEvents.id.name}
        WHERE d.${schema.pointEventDetails.partnerId.name} = ${p.partnerId}
        GROUP BY d.${schema.pointEventDetails.earnedEventDetailId.name}
        HAVING SUM(d.${schema.pointEventDetails.amount.name}) > 0
        ORDER BY MIN(e.${schema.pointEvents.expiresAt.name}) ASC NULLS LAST
      `);

      // 3) 차감 루프
      for (const b of buckets) {
        if (remaining <= 0) break;

        const slice = Math.min(b.amount_sum, remaining);

        const [detail] = await tx
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

        await tx
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
    });
  }

  /**
   * 적립 취소(EARN_CANCEL)
   * • 부분/전량 취소 모두 지원: cancelAmount 없으면 “남아있는 잔여 전량”
   */
  async earnCancel(
    p: EarnCancelParams,
  ): Promise<{ eventId: number; cancel: number }> {
    return await this.db.db.transaction(async (tx) => {
      // 1) 원본 EARN의 root detail 찾기
      const [root] = await tx
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
      const [{ sum }] = (await tx.execute<{ sum: number }>(
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
      const [ev] = await tx
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
      await tx.insert(schema.pointEventDetails).values({
        pointEventId: ev.id,
        partnerId: p.partnerId,
        eventType: 'EARN_CANCEL',
        amount: -cancelAmount,
        earnedEventDetailId: root.id,
        originalEventDetailId: root.id,
      });

      return { eventId: ev.id, cancel: cancelAmount };
    });
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
