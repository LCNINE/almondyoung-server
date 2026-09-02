import { moduleIntegrationTestRunner } from '@medusajs/test-utils';
import { PROMOTION_META_MODULE } from '..';
import PromotionMeta from '../models/promotion-meta';
import CouponGrant from '../models/coupon-grant';
import type PromotionMetaModuleService from '../service';

jest.setTimeout(120 * 1000);

moduleIntegrationTestRunner<PromotionMetaModuleService>({
  moduleName: PROMOTION_META_MODULE,
  resolve: './src/modules/promotion-meta',
  moduleModels: [PromotionMeta, CouponGrant],
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

      it('setIssuedCount reconciles the counter to the given value and floors negatives', async () => {
        await service.upsert({ promotion_id: 'promo_set', max_claims: 100 });
        await service.setIssuedCount('promo_set', 37);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(37);
        await service.setIssuedCount('promo_set', -5);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(0);
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

      it('issueGrant 는 같은 issue_key 두 번째에 duplicate 를 돌려준다 — 던지지 않는다', async () => {
        const input = {
          promotion_id: 'promo_idem',
          customer_id: 'cus_idem',
          issue_key: 'sub-9:1',
          issued_via: 'admin_manual' as const,
          expires_at: null,
          now: new Date(),
        };

        expect(await service.issueGrant(input)).toBe('created');
        expect(await service.issueGrant(input)).toBe('duplicate');
        expect(await service.listCouponGrants({ promotion_id: 'promo_idem' })).toHaveLength(1);
      });

      it('consumeGrant 는 그 한 장에만 사용 기록을 남긴다', async () => {
        const base = {
          promotion_id: 'promo_use',
          customer_id: 'cus_use',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'k1' },
          { ...base, issue_key: 'k2' },
        ]);
        const grants = await service.listGrantsForCustomer('cus_use');
        const usedAt = new Date();

        await service.consumeGrant(grants[0].id, 'order_1', usedAt);

        const after = await service.listGrantsForCustomer('cus_use');
        expect(after.filter((g) => g.used_at != null)).toHaveLength(1);
        expect(after.find((g) => g.id === grants[0].id)?.order_id).toBe('order_1');
      });

      // 백필 스크립트의 «중단→재실행» 시나리오를 지킨다: grant 생성은 됐지만 사용 상태 이관
      // 전에 죽었다가 재실행되는 경우를 흉내낸다. issueGrant 가 재실행에서 'duplicate' 를
      // 돌려줘도 이 메서드는 여전히 불려야 하고(스크립트가 그렇게 부른다), 이미 채워진 값은
      // 덮어쓰지 않아야 한다(#488 Task 10 리뷰 Important #1).
      it('markGrantUsedIfUnused 는 미사용 grant 만 채우고 재호출에도 값이 그대로다', async () => {
        await service.createCouponGrants([
          {
            promotion_id: 'promo_backfill',
            customer_id: 'cus_backfill',
            issue_key: 'legacy',
            issued_via: 'admin_manual',
            issued_at: new Date(),
          },
        ]);

        const usedAt = new Date('2026-01-01T00:00:00.000Z');
        const first = await service.markGrantUsedIfUnused(
          'promo_backfill',
          'cus_backfill',
          'legacy',
          'order_legacy',
          usedAt,
        );
        expect(first).toBe('consumed');

        const afterFirst = await service.listGrantsForCustomer('cus_backfill');
        expect(afterFirst[0].used_at).not.toBeNull();
        expect(afterFirst[0].order_id).toBe('order_legacy');

        // 재실행(같은 usedAt 이거나 달라도) — 이미 채워진 값을 덮어쓰지 않는다.
        const second = await service.markGrantUsedIfUnused(
          'promo_backfill',
          'cus_backfill',
          'legacy',
          'order_other',
          new Date('2099-01-01T00:00:00.000Z'),
        );
        expect(second).toBe('already_used');

        const afterSecond = await service.listGrantsForCustomer('cus_backfill');
        expect(new Date(afterSecond[0].used_at as string).toISOString()).toBe(usedAt.toISOString());
        expect(afterSecond[0].order_id).toBe('order_legacy');
      });

      it('markGrantUsedIfUnused 는 grant 가 없으면 not_found 를 돌려준다', async () => {
        const outcome = await service.markGrantUsedIfUnused(
          'promo_missing',
          'cus_missing',
          'legacy',
          'order_x',
          new Date(),
        );
        expect(outcome).toBe('not_found');
      });

      it('restoreGrantsByOrder 는 만료되지 않은 장만 되살린다', async () => {
        const past = new Date('2020-01-01T00:00:00.000Z');
        const future = new Date('2099-01-01T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_restore',
          customer_id: 'cus_restore',
          issued_via: 'admin_manual' as const,
          issued_at: past,
          used_at: past,
          order_id: 'order_cancel',
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'alive', expires_at: future },
          { ...base, issue_key: 'dead', expires_at: past },
        ]);

        const restored = await service.restoreGrantsByOrder('order_cancel', new Date());

        expect(restored).toBe(1);
        const rows = await service.listGrantsForCustomer('cus_restore');
        expect(rows.find((g) => g.issue_key === 'alive')?.used_at).toBeNull();
        expect(rows.find((g) => g.issue_key === 'dead')?.used_at).not.toBeNull();
      });

      it('restoreGrantsByOrder 는 두 번 불려도 결과가 같다', async () => {
        const base = {
          promotion_id: 'promo_restore2',
          customer_id: 'cus_restore2',
          issue_key: 'k',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
          used_at: new Date(),
          order_id: 'order_twice',
          expires_at: null,
        };
        await service.createCouponGrants([base]);

        expect(await service.restoreGrantsByOrder('order_twice', new Date())).toBe(1);
        expect(await service.restoreGrantsByOrder('order_twice', new Date())).toBe(0);
      });

      it('revokeGrants 는 회수한 장수를 돌려준다', async () => {
        const base = {
          promotion_id: 'promo_rev',
          customer_id: 'cus_rev',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'k1' },
          { ...base, issue_key: 'k2' },
        ]);

        expect(await service.revokeGrants('promo_rev', 'cus_rev')).toBe(2);
        expect(await service.listGrantsForCustomer('cus_rev')).toHaveLength(0);
        expect(await service.revokeGrants('promo_rev', 'cus_rev')).toBe(0);
      });
    });
  },
});
