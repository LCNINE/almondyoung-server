import { MedusaService } from '@medusajs/framework/utils';
import PromotionMeta from './models/promotion-meta';
import PromotionIssueLog from './models/promotion-issue-log';

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

class PromotionMetaModuleService extends MedusaService({ PromotionMeta, PromotionIssueLog }) {
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
      const isDuplicate = e?.code === '23505' || e?.message?.includes('unique') || e?.message?.includes('duplicate');
      if (!isDuplicate) throw e;
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
}

export default PromotionMetaModuleService;
