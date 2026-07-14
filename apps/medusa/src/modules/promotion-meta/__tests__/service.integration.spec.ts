import { moduleIntegrationTestRunner } from '@medusajs/test-utils';
import { PROMOTION_META_MODULE } from '..';
import PromotionMeta from '../models/promotion-meta';
import PromotionIssueLog from '../models/promotion-issue-log';
import type PromotionMetaModuleService from '../service';

jest.setTimeout(120 * 1000);

moduleIntegrationTestRunner<PromotionMetaModuleService>({
  moduleName: PROMOTION_META_MODULE,
  resolve: './src/modules/promotion-meta',
  moduleModels: [PromotionMeta, PromotionIssueLog],
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
    });
  },
});
