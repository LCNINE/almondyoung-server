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

      it('consumeGrantIfUnused 는 그 한 장에만 사용 기록을 남긴다', async () => {
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

        await service.consumeGrantIfUnused(grants[0].id, 'order_1', usedAt);

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

        expect(await service.revokeGrants('promo_rev', 'cus_rev')).toEqual({ revoked: 2, remaining: 0 });
        expect(await service.listGrantsForCustomer('cus_rev')).toHaveLength(0);
        expect(await service.revokeGrants('promo_rev', 'cus_rev')).toEqual({ revoked: 0, remaining: 0 });
      });

      // 옛 구현은 «전량» soft delete 라 쓴 장의 이력이 사라지고, 그 슬롯까지 되돌아갔으며,
      // 나중에 주문이 취소돼도 restoreGrantsByOrder 가 아무것도 못 찾았다 (ADR-0034 결정 1).
      it('revokeGrants 는 이미 쓴 장을 남기고 remaining 으로 알린다', async () => {
        const base = {
          promotion_id: 'promo_rev_used',
          customer_id: 'cus_rev_used',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'k1' },
          { ...base, issue_key: 'k2' },
          { ...base, issue_key: 'k3' },
        ]);
        const grants = await service.listGrantsForCustomer('cus_rev_used');
        await service.consumeGrantIfUnused(grants[0].id, 'order_kept', new Date());

        expect(await service.revokeGrants('promo_rev_used', 'cus_rev_used')).toEqual({
          revoked: 2,
          remaining: 1,
        });

        // 쓴 장은 그대로 살아 있고, 그 주문으로 되살릴 수도 있다.
        const left = await service.listGrantsForCustomer('cus_rev_used');
        expect(left).toHaveLength(1);
        expect(left[0].order_id).toBe('order_kept');
        expect(await service.restoreGrantsByOrder('order_kept', new Date())).toBe(1);
      });

      /*───────────────────────────
       * ADR-0034 결정 1 — 슬롯과 장이 한 트랜잭션
       *
       * 이 묶음이 «목으로는 전부 통과하고 실 DB 에서만 갈리는» 성질을 지킨다. 조건부 UPDATE 가
       * 정말 조건부인지, 되감기가 정말 함께 일어나는지는 실 DB 만이 알려준다.
       *──────────────────────────*/
      describe('issueGrantWithSlot', () => {
        const issue = (over: Record<string, unknown> = {}) =>
          service.issueGrantWithSlot({
            promotion_id: 'promo_slot',
            customer_id: 'cus_slot',
            issue_key: 'k1',
            issued_via: 'admin_manual' as const,
            expires_at: null,
            now: new Date(),
            max_claims: 1,
            enforce_cap: true,
            ...over,
          } as Parameters<typeof service.issueGrantWithSlot>[0]);

        const issuedCount = async (pid = 'promo_slot') =>
          Number((await service.getByPromotionId(pid))?.issued_count);

        it('장과 슬롯이 함께 커밋된다', async () => {
          await service.upsert({ promotion_id: 'promo_slot', max_claims: 1 });

          expect(await issue()).toBe('created');
          expect(await issuedCount()).toBe(1);
          expect(await service.listCouponGrants({ promotion_id: 'promo_slot' })).toHaveLength(1);
        });

        it('중복은 슬롯을 소비하지 않는다 — 되감기가 함께 일어난다', async () => {
          await service.upsert({ promotion_id: 'promo_slot', max_claims: 5 });
          expect(await issue({ max_claims: 5 })).toBe('created');

          expect(await issue({ max_claims: 5 })).toBe('duplicate');

          // 옛 구현에서는 호출부가 releaseClaimSlot 을 «손으로» 불러야 했고, 넷 중 한 곳이라도
          // 빠뜨리면 따닥 한 번에 2명분이 소진됐다.
          expect(await issuedCount()).toBe(1);
          expect(await service.listCouponGrants({ promotion_id: 'promo_slot' })).toHaveLength(1);
        });

        it('🔴 이미 받은 사람이 소진된 쿠폰에 재시도하면 exhausted 가 아니라 duplicate 다', async () => {
          await service.upsert({ promotion_id: 'promo_slot', max_claims: 1 });
          expect(await issue()).toBe('created');
          expect(await issuedCount()).toBe(1); // 상한에 닿았다

          // 옛 라우트 3곳은 슬롯을 «먼저» 잡아서 여기서 'exhausted' 로 떨어졌다 — 고객에겐
          // 「발급 수량이 모두 소진되었습니다」, 자동발급 경로에선 실재하지 않는 소진 지표.
          expect(await issue()).toBe('duplicate');
          expect(await issuedCount()).toBe(1);
        });

        it('소진이면 장도 남지 않는다', async () => {
          await service.upsert({ promotion_id: 'promo_slot', max_claims: 1 });
          expect(await issue({ customer_id: 'cus_a' })).toBe('created');

          expect(await issue({ customer_id: 'cus_b' })).toBe('exhausted');

          // 장 INSERT 가 슬롯보다 먼저 일어나므로, 되감기가 없으면 여기 2행이 남는다.
          expect(await service.listCouponGrants({ promotion_id: 'promo_slot' })).toHaveLength(1);
          expect(await issuedCount()).toBe(1);
        });

        it('enforce_cap=false(admin force)는 상한을 넘겨 발급하되 발급 수에는 포함한다', async () => {
          await service.upsert({ promotion_id: 'promo_slot', max_claims: 1 });
          expect(await issue({ customer_id: 'cus_a' })).toBe('created');

          expect(await issue({ customer_id: 'cus_b', enforce_cap: false })).toBe('created');

          expect(await issuedCount()).toBe(2);
          expect(await service.listCouponGrants({ promotion_id: 'promo_slot' })).toHaveLength(2);
        });

        it('max_claims=null 이면 카운터를 건드리지 않는다', async () => {
          await service.upsert({ promotion_id: 'promo_slot' });

          expect(await issue({ max_claims: null })).toBe('created');
          expect(await issuedCount()).toBe(0);
        });
      });

      describe('consumeGrantIfUnused', () => {
        it('두 번째 소모는 false 이고 첫 주문의 기록을 덮어쓰지 않는다', async () => {
          await service.createCouponGrants([
            {
              promotion_id: 'promo_once',
              customer_id: 'cus_once',
              issue_key: 'k1',
              issued_via: 'admin_manual',
              issued_at: new Date(),
            },
          ]);
          const [grant] = await service.listGrantsForCustomer('cus_once');

          expect(await service.consumeGrantIfUnused(grant.id, 'order_first', new Date())).toBe(true);
          // 두 카트가 동시에 완료되면 두 훅이 «같은» 장을 고른다(선택은 결정적이다).
          // 옛 무조건 UPDATE 는 둘 다 성공해 한 장으로 할인 주문 두 건이 나갔다.
          expect(await service.consumeGrantIfUnused(grant.id, 'order_second', new Date())).toBe(false);

          const [after] = await service.listGrantsForCustomer('cus_once');
          expect(after.order_id).toBe('order_first');
        });

        it('회수된 장은 소모되지 않는다', async () => {
          await service.createCouponGrants([
            {
              promotion_id: 'promo_dead',
              customer_id: 'cus_dead',
              issue_key: 'k1',
              issued_via: 'admin_manual',
              issued_at: new Date(),
            },
          ]);
          const [grant] = await service.listGrantsForCustomer('cus_dead');
          await service.revokeGrants('promo_dead', 'cus_dead');

          expect(await service.consumeGrantIfUnused(grant.id, 'order_x', new Date())).toBe(false);
        });

        it('used_at 이 Date 로 되읽힌다 — 바인딩이 문자열로 새지 않는다', async () => {
          await service.createCouponGrants([
            {
              promotion_id: 'promo_ts',
              customer_id: 'cus_ts',
              issue_key: 'k1',
              issued_via: 'admin_manual',
              issued_at: new Date(),
            },
          ]);
          const [grant] = await service.listGrantsForCustomer('cus_ts');
          const usedAt = new Date('2026-03-04T05:06:07.000Z');

          expect(await service.consumeGrantIfUnused(grant.id, 'order_ts', usedAt)).toBe(true);

          const [after] = await service.listGrantsForCustomer('cus_ts');
          expect(new Date(after.used_at as string | Date).toISOString()).toBe('2026-03-04T05:06:07.000Z');
        });
      });
    });
  },
});
