import { MedusaService } from '@medusajs/framework/utils';
import PromotionMeta from './models/promotion-meta';
import PromotionIssueLog from './models/promotion-issue-log';
import CouponEvent from './models/coupon-event';
import CouponEventItem from './models/coupon-event-item';

export type AutoIssueTrigger = 'customer_registered' | 'membership_activated' | 'birthday';
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
};

class PromotionMetaModuleService extends MedusaService({
  PromotionMeta,
  PromotionIssueLog,
  CouponEvent,
  CouponEventItem,
}) {
  async upsert(data: PromotionMetaData): Promise<any> {
    if (data.visibility != null && !['public', 'claimable', 'assigned_only'].includes(data.visibility)) {
      throw new Error(`Invalid visibility value: ${data.visibility}`);
    }
    if (data.auto_issue_trigger != null && !['customer_registered', 'membership_activated', 'birthday'].includes(data.auto_issue_trigger)) {
      throw new Error(`Invalid auto_issue_trigger value: ${data.auto_issue_trigger}`);
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
}

export default PromotionMetaModuleService;
