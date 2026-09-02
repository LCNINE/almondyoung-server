import { moduleIntegrationTestRunner } from '@medusajs/test-utils';
import { PROMOTION_META_MODULE } from '..';
import PromotionMeta from '../models/promotion-meta';
import PromotionIssueLog from '../models/promotion-issue-log';
import CouponGrant from '../models/coupon-grant';
import type PromotionMetaModuleService from '../service';

jest.setTimeout(120 * 1000);

moduleIntegrationTestRunner<PromotionMetaModuleService>({
  moduleName: PROMOTION_META_MODULE,
  resolve: './src/modules/promotion-meta',
  moduleModels: [PromotionMeta, PromotionIssueLog, CouponGrant],
  testSuite: ({ service }) => {
    describe('PromotionMetaModuleService', () => {
      it('upsert defaults visibility to public', async () => {
        await service.upsert({ promotion_id: 'promo_pub' });
        const rec = await service.getByPromotionId('promo_pub');
        expect(rec?.visibility).toEqual('public');
      });

      it('reserveClaimSlot is atomic and returns exhausted at the cap', async () => {
        await service.upsert({ promotion_id: 'promo_cap', max_claims: 2 });
        expect(await service.reserveClaimSlot('promo_cap', 2)).toEqual('ok');
        expect(await service.reserveClaimSlot('promo_cap', 2)).toEqual('ok');
        // 3rd reservation must be refused
        expect(await service.reserveClaimSlot('promo_cap', 2)).toEqual('exhausted');
        const rec = await service.getByPromotionId('promo_cap');
        expect(Number(rec?.issued_count)).toEqual(2);
      });

      it('releaseClaimSlot decrements and floors at 0', async () => {
        await service.upsert({ promotion_id: 'promo_rel', max_claims: 5 });
        await service.reserveClaimSlot('promo_rel', 5); // issued_count = 1
        await service.releaseClaimSlot('promo_rel'); // -> 0
        await service.releaseClaimSlot('promo_rel'); // must not go negative
        const rec = await service.getByPromotionId('promo_rel');
        expect(Number(rec?.issued_count)).toEqual(0);
      });

      it('recordIssue is idempotent (duplicate swallowed)', async () => {
        await service.recordIssue('cust_1', 'promo_log', 'admin_manual');
        // second call with same (customer, promotion) must not throw
        await expect(
          service.recordIssue('cust_1', 'promo_log', 'membership_activated'),
        ).resolves.toBeUndefined();
        expect(await service.isAlreadyIssued('cust_1', 'promo_log')).toBe(true);
      });

      it('removeIssueLog clears the dedup row so auto-issue can re-issue after revoke (P2-2)', async () => {
        await service.recordIssue('cust_2', 'promo_revoke', 'customer_registered');
        expect(await service.isAlreadyIssued('cust_2', 'promo_revoke')).toBe(true);

        // revoke path
        await service.removeIssueLog('cust_2', 'promo_revoke');
        expect(await service.isAlreadyIssued('cust_2', 'promo_revoke')).toBe(false);

        // re-issue after revoke must succeed (partial-unique index frees the slot)
        await expect(
          service.recordIssue('cust_2', 'promo_revoke', 'customer_registered'),
        ).resolves.toBeUndefined();
        expect(await service.isAlreadyIssued('cust_2', 'promo_revoke')).toBe(true);
      });

      it('removeIssueLog only clears the targeted (customer, promotion) pair', async () => {
        await service.recordIssue('cust_a', 'promo_multi', 'admin_manual');
        await service.recordIssue('cust_b', 'promo_multi', 'admin_manual');
        await service.removeIssueLog('cust_a', 'promo_multi');
        expect(await service.isAlreadyIssued('cust_a', 'promo_multi')).toBe(false);
        expect(await service.isAlreadyIssued('cust_b', 'promo_multi')).toBe(true);
      });

      it('setIssuedCount reconciles the counter to the given value and floors negatives', async () => {
        await service.upsert({ promotion_id: 'promo_set', max_claims: 100 });
        await service.setIssuedCount('promo_set', 37);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(37);
        await service.setIssuedCount('promo_set', -5);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(0);
      });

      it('removeAllIssueLogs purges every log for the promotion (promotion delete)', async () => {
        await service.recordIssue('cust_x', 'promo_del', 'admin_manual');
        await service.recordIssue('cust_y', 'promo_del', 'customer_claim');
        await service.removeAllIssueLogs('promo_del');
        expect(await service.isAlreadyIssued('cust_x', 'promo_del')).toBe(false);
        expect(await service.isAlreadyIssued('cust_y', 'promo_del')).toBe(false);
      });

      it('유효기간 3열을 저장하고 되읽는다', async () => {
        await service.upsert({
          promotion_id: 'promo_validity',
          starts_at: new Date('2026-09-01T00:00:00.000Z'),
          ends_at: new Date('2026-09-30T00:00:00.000Z'),
          validity_days: 14,
        });
        const rec = await service.getByPromotionId('promo_validity');
        expect(new Date(rec.starts_at).toISOString()).toEqual('2026-09-01T00:00:00.000Z');
        expect(new Date(rec.ends_at).toISOString()).toEqual('2026-09-30T00:00:00.000Z');
        expect(Number(rec.validity_days)).toEqual(14);
      });

      it('유효기간 3열은 선택이다 — 안 주면 null 로 남는다', async () => {
        await service.upsert({ promotion_id: 'promo_no_validity' });
        const rec = await service.getByPromotionId('promo_no_validity');
        expect(rec.starts_at).toBeNull();
        expect(rec.ends_at).toBeNull();
        expect(rec.validity_days).toBeNull();
      });

      it('validity_days 는 양의 정수만 받는다', async () => {
        await expect(
          service.upsert({ promotion_id: 'promo_bad_days', validity_days: 0 }),
        ).rejects.toThrow(/validity_days/);
        await expect(
          service.upsert({ promotion_id: 'promo_bad_days2', validity_days: 1.5 }),
        ).rejects.toThrow(/validity_days/);
      });
    });

    describe('coupon_grant', () => {
      it('같은 (쿠폰, 고객) 에 issue_key 가 다르면 여러 장이 생긴다', async () => {
        const base = {
          promotion_id: 'promo_multi',
          customer_id: 'cus_multi',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'sub-1:1' },
          { ...base, issue_key: 'sub-1:2' },
        ]);

        const rows = await service.listCouponGrants({ promotion_id: 'promo_multi' });
        expect(rows).toHaveLength(2);
      });

      it('같은 issue_key 는 두 번째가 유니크 위반이다', async () => {
        const row = {
          promotion_id: 'promo_dup',
          customer_id: 'cus_dup',
          issue_key: 'claim',
          issued_via: 'customer_claim' as const,
          issued_at: new Date(),
        };
        await service.createCouponGrants([row]);

        let caught: any = null;
        try {
          await service.createCouponGrants([row]);
        } catch (e) {
          caught = e;
        }

        expect(caught).not.toBeNull();
        expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate|already exists/);
        expect(await service.listCouponGrants({ promotion_id: 'promo_dup' })).toHaveLength(1);
      });

      it('회수(soft delete) 후 같은 issue_key 로 재발급된다 — 파셜 유니크', async () => {
        const row = {
          promotion_id: 'promo_revoke',
          customer_id: 'cus_revoke',
          issue_key: 'claim',
          issued_via: 'customer_claim' as const,
          issued_at: new Date(),
        };
        const [created] = await service.createCouponGrants([row]);
        await service.softDeleteCouponGrants([created.id]);

        await service.createCouponGrants([row]);

        const alive = await service.listCouponGrants({ promotion_id: 'promo_revoke' });
        expect(alive).toHaveLength(1);
        expect(alive[0].id).not.toBe(created.id);
      });
    });
  },
});
