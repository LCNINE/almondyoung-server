import { MedusaService } from '@medusajs/framework/utils';
import PromotionMeta from './models/promotion-meta';
import PromotionIssueLog from './models/promotion-issue-log';
import CouponEvent from './models/coupon-event';
import CouponEventItem from './models/coupon-event-item';
import CouponGrant from './models/coupon-grant';

// 쿠폰 어휘(`AutoIssueTrigger` · `PromotionMetaData.visibility`)는 이 트리 밖에도 사본이 있다.
// 값을 늘리거나 줄이면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개지며
// 함께 고쳐야 할 곳을 전부 이름으로 지목한다(마이그레이션 CHECK 제약 포함).
// `visibility` 의 타입 정본은 `@packages/domain-types` 에 있으나 **여기서 import 할 수 없다**
// — Medusa 빌드에는 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않는다.
export type AutoIssueTrigger = 'customer_registered' | 'membership_activated';
export type AdminIssueTrigger = 'admin_manual' | 'admin_force' | 'customer_claim';
export type IssueTrigger = AutoIssueTrigger | AdminIssueTrigger;

export type PromotionMetaData = {
  promotion_id: string;
  name?: string | null;
  max_discount_amount?: number | null;
  created_by?: string | null;
  visibility?: 'public' | 'claimable' | 'assigned_only' | null;
  max_claims?: number | null;
  auto_issue_trigger?: AutoIssueTrigger | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  validity_days?: number | null;
};

/** `coupon_grant` 한 행. 숫자·날짜가 DB 에서 문자열로 오는 경우가 있어 union 이다. */
export type CouponGrantRow = {
  id: string;
  promotion_id: string;
  customer_id: string;
  issue_key: string;
  issued_via: IssueTrigger;
  issued_at: Date | string;
  expires_at: Date | string | null;
  used_at: Date | string | null;
  order_id: string | null;
};

class PromotionMetaModuleService extends MedusaService({
  PromotionMeta,
  PromotionIssueLog,
  CouponEvent,
  CouponEventItem,
  CouponGrant,
}) {
  async upsert(data: PromotionMetaData): Promise<any> {
    if (data.visibility != null && !['public', 'claimable', 'assigned_only'].includes(data.visibility)) {
      throw new Error(`Invalid visibility value: ${data.visibility}`);
    }
    if (data.auto_issue_trigger != null && !['customer_registered', 'membership_activated'].includes(data.auto_issue_trigger)) {
      throw new Error(`Invalid auto_issue_trigger value: ${data.auto_issue_trigger}`);
    }
    if (data.validity_days != null) {
      const n = Number(data.validity_days);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid validity_days value: ${data.validity_days}`);
      }
    }
    const existing = await (this as any).listPromotionMetas({ promotion_id: data.promotion_id });
    if (existing.length > 0) {
      return (this as any).updatePromotionMetas({ id: existing[0].id, ...data });
    }
    return (this as any).createPromotionMetas(data);
  }

  async getByPromotionId(promotionId: string): Promise<any | null> {
    const records = await (this as any).listPromotionMetas({ promotion_id: promotionId });
    return records[0] ?? null;
  }

  async getByPromotionIds(promotionIds: string[]): Promise<any[]> {
    if (!promotionIds.length) return [];
    return (this as any).listPromotionMetas({ promotion_id: { $in: promotionIds } });
  }

  async getByAutoIssueTrigger(trigger: AutoIssueTrigger): Promise<any[]> {
    return (this as any).listPromotionMetas({ auto_issue_trigger: trigger });
  }

  async deleteByPromotionId(promotionId: string): Promise<void> {
    const existing = await (this as any).listPromotionMetas({ promotion_id: promotionId });
    if (existing.length > 0) {
      await (this as any).deletePromotionMetas([existing[0].id]);
    }
  }

  async isAlreadyIssued(customerId: string, promotionId: string): Promise<boolean> {
    const records = await (this as any).listPromotionIssueLogs({ customer_id: customerId, promotion_id: promotionId });
    return records.length > 0;
  }

  async recordIssue(customerId: string, promotionId: string, trigger: IssueTrigger): Promise<void> {
    try {
      await (this as any).createPromotionIssueLogs({ customer_id: customerId, promotion_id: promotionId, trigger });
    } catch (e: any) {
      // MedusaService는 unique 위반을 "... already exists" 메시지로 감싸므로 pg 23505 매칭만으론 부족하다.
      const msg = String(e?.message ?? '').toLowerCase();
      const isDuplicate =
        e?.code === '23505' ||
        msg.includes('unique') ||
        msg.includes('duplicate') ||
        msg.includes('already exists');
      if (!isDuplicate) throw e;
    }
  }

  /**
   * 회수 시 발급 로그를 soft-delete 한다. partial unique index(deleted_at IS NULL)가
   * 재발급을 허용하도록 — 그렇지 않으면 자동발급 dedup(isAlreadyIssued)이 영구 skip 한다.
   */
  async removeIssueLog(customerId: string, promotionId: string): Promise<void> {
    const records = await (this as any).listPromotionIssueLogs({ customer_id: customerId, promotion_id: promotionId });
    if (records.length > 0) {
      await (this as any).deletePromotionIssueLogs(records.map((r: any) => r.id));
    }
  }

  /** 프로모션 삭제 시 발급 로그 전체 정리(고아 로우 방지). */
  async removeAllIssueLogs(promotionId: string): Promise<void> {
    const records = await (this as any).listPromotionIssueLogs({ promotion_id: promotionId });
    if (records.length > 0) {
      await (this as any).deletePromotionIssueLogs(records.map((r: any) => r.id));
    }
  }

  /**
   * Atomically reserve a claim slot. Returns 'ok' if a slot was reserved, 'exhausted' if maxClaims reached.
   * Uses UPDATE ... WHERE issued_count < maxClaims to prevent concurrent overclaims.
   * Note: issued_count starts at 0 post-migration. For promotions created before this migration
   * with existing remote links, run a manual backfill:
   *   UPDATE promotion_meta SET issued_count = <existing_link_count> WHERE promotion_id = '<id>';
   */
  async reserveClaimSlot(promotionId: string, maxClaims: number): Promise<'ok' | 'exhausted'> {
    const em = (this as any).baseRepository_.manager_;
    const result = await em.execute(
      `UPDATE "promotion_meta" SET "issued_count" = "issued_count" + 1
       WHERE "promotion_id" = ? AND "issued_count" < ?
       RETURNING "id"`,
      [promotionId, maxClaims],
    );
    return (result?.length ?? 0) > 0 ? 'ok' : 'exhausted';
  }

  async releaseClaimSlot(promotionId: string): Promise<void> {
    const em = (this as any).baseRepository_.manager_;
    await em.execute(
      `UPDATE "promotion_meta" SET "issued_count" = GREATEST("issued_count" - 1, 0)
       WHERE "promotion_id" = ?`,
      [promotionId],
    );
  }

  async incrementIssuedCount(promotionId: string): Promise<void> {
    const em = (this as any).baseRepository_.manager_;
    await em.execute(
      `UPDATE "promotion_meta" SET "issued_count" = "issued_count" + 1 WHERE "promotion_id" = ?`,
      [promotionId],
    );
  }

  /** issued_count 를 실제 링크 수로 정합화(backfill). 음수는 0으로 보정. */
  async setIssuedCount(promotionId: string, count: number): Promise<void> {
    const safe = Math.max(0, Math.floor(count));
    const em = (this as any).baseRepository_.manager_;
    await em.execute(
      `UPDATE "promotion_meta" SET "issued_count" = ? WHERE "promotion_id" = ?`,
      [safe, promotionId],
    );
  }

  /*───────────────────────────
   * 쿠폰 이벤트 (배너용 쿠폰 묶음)
   *──────────────────────────*/

  async getEventBySlug(slug: string): Promise<any | null> {
    const records = await (this as any).listCouponEvents({ slug });
    return records[0] ?? null;
  }

  /** 이벤트에 담긴 쿠폰(프로모션) 항목을 sort_order 순으로 반환. */
  async listEventItems(eventId: string): Promise<any[]> {
    return (this as any).listCouponEventItems(
      { event_id: eventId },
      { order: { sort_order: 'ASC' } },
    );
  }

  /** 이벤트의 쿠폰 구성을 통째로 교체(기존 항목 제거 후 순서대로 재생성). */
  async setEventItems(eventId: string, promotionIds: string[]): Promise<void> {
    const existing = await (this as any).listCouponEventItems({ event_id: eventId });
    if (existing.length > 0) {
      await (this as any).deleteCouponEventItems(existing.map((r: any) => r.id));
    }
    if (promotionIds.length > 0) {
      await (this as any).createCouponEventItems(
        promotionIds.map((promotion_id, i) => ({ event_id: eventId, promotion_id, sort_order: i })),
      );
    }
  }

  /*───────────────────────────
   * coupon_grant (발급된 «한 장»)
   *──────────────────────────*/

  /**
   * 유니크 위반인가. 🔴 `e.code === '23505'` 만 보면 안 된다 — `MedusaService` 가 위반을
   * "... already exists" 메시지로 감싸 코드를 잃어버리는 경로가 있다(기존 `recordIssue` 가
   * 같은 이유로 이 판정을 갖고 있었다).
   */
  private isUniqueViolation(e: any): boolean {
    const msg = String(e?.message ?? '').toLowerCase();
    return (
      e?.code === '23505' ||
      msg.includes('unique') ||
      msg.includes('duplicate') ||
      msg.includes('already exists')
    );
  }

  /**
   * 한 장을 발급한다. **같은 `issue_key` 의 재도착은 예외가 아니라 `'duplicate'` 다.**
   *
   * 이것이 따닥·재시도 방어의 전부다. 호출부는 `'duplicate'` 를 「이미 처리됨」으로 다루고,
   * 예약해 둔 claim 슬롯이 있으면 반환해야 한다(슬롯을 잡은 쪽이 반환 책임을 진다).
   */
  async issueGrant(input: {
    promotion_id: string;
    customer_id: string;
    issue_key: string;
    issued_via: IssueTrigger;
    expires_at: Date | null;
    now: Date;
  }): Promise<'created' | 'duplicate'> {
    try {
      await (this as any).createCouponGrants([
        {
          promotion_id: input.promotion_id,
          customer_id: input.customer_id,
          issue_key: input.issue_key,
          issued_via: input.issued_via,
          issued_at: input.now,
          expires_at: input.expires_at,
          used_at: null,
          order_id: null,
        },
      ]);
      return 'created';
    } catch (e: any) {
      if (this.isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  }

  /** 이 고객이 가진 모든 장. 호출부가 프로모션마다 조회하지 않도록 한 번에 가져온다. */
  async listGrantsForCustomer(customerId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ customer_id: customerId })) as CouponGrantRow[];
  }

  /** 이 프로모션이 발급된 모든 장. 발급 현황·회수가 쓴다. */
  async listGrantsForPromotion(promotionId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ promotion_id: promotionId })) as CouponGrantRow[];
  }

  /** 고른 한 장을 소모한다. */
  async consumeGrant(grantId: string, orderId: string, usedAt: Date): Promise<void> {
    await (this as any).updateCouponGrants({ id: grantId, used_at: usedAt, order_id: orderId });
  }

  /**
   * 이 주문에 쓰인 장들을 되돌린다 (A2). 되살린 장수를 돌려준다.
   *
   * **이미 만료된 장은 되살리지 않는다** — 되살려도 못 쓰고, 「돌아왔는데 못 쓴다」가 더 나쁘다.
   * 이미 되돌려진 장은 `used_at` 이 null 이라 대상에서 빠지므로 두 번 불려도 안전하다.
   */
  async restoreGrantsByOrder(orderId: string, now: Date): Promise<number> {
    const rows = (await (this as any).listCouponGrants({ order_id: orderId })) as CouponGrantRow[];
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      if (g.expires_at == null) return true;
      const expiresAt = g.expires_at instanceof Date ? g.expires_at : new Date(g.expires_at);
      return !(now > expiresAt);
    });
    if (targets.length === 0) return 0;
    await (this as any).updateCouponGrants(
      targets.map((g) => ({ id: g.id, used_at: null, order_id: null })),
    );
    return targets.length;
  }

  /** 이 고객의 이 쿠폰을 전량 회수한다. 회수한 장수를 돌려준다. */
  async revokeGrants(promotionId: string, customerId: string): Promise<number> {
    const rows = (await (this as any).listCouponGrants({
      promotion_id: promotionId,
      customer_id: customerId,
    })) as CouponGrantRow[];
    if (rows.length === 0) return 0;
    await (this as any).softDeleteCouponGrants(rows.map((g) => g.id));
    return rows.length;
  }
}

export default PromotionMetaModuleService;
