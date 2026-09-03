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

      it('setIssuedCount reconciles the counter to the given value and floors negatives', async () => {
        await service.upsert({ promotion_id: 'promo_set', max_claims: 100 });
        await service.setIssuedCount('promo_set', 37);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(37);
        await service.setIssuedCount('promo_set', -5);
        expect(Number((await service.getByPromotionId('promo_set'))?.issued_count)).toEqual(0);
      });

      const issue = (
        promotionId: string,
        customerId: string,
        key: string,
        maxClaims: number | null,
        enforceCap = true,
      ) =>
        service.issueGrantWithSlot({
          promotion_id: promotionId,
          customer_id: customerId,
          issue_key: key,
          issued_via: 'admin_manual',
          expires_at: null,
          now: new Date(),
          max_claims: maxClaims,
          enforce_cap: enforceCap,
        });

      it('상한은 카운터가 아니라 coupon_grant 를 세어 집행된다', async () => {
        await service.upsert({ promotion_id: 'promo_cnt', max_claims: 2 });
        expect(await issue('promo_cnt', 'cus_a', 'k1', 2)).toEqual('created');
        expect(await issue('promo_cnt', 'cus_a', 'k2', 2)).toEqual('created');
        expect(await issue('promo_cnt', 'cus_a', 'k3', 2)).toEqual('exhausted');
        expect(await service.countIssuedGrants('promo_cnt')).toEqual(2);
      });

      it('상한 초과로 되감긴 시도는 장을 남기지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_rb', max_claims: 1 });
        await issue('promo_rb', 'cus_b', 'k1', 1);
        await issue('promo_rb', 'cus_b', 'k2', 1); // exhausted
        const rows = await service.listGrantsForPromotion('promo_rb');
        expect(rows.map((g) => g.issue_key)).toEqual(['k1']);
      });

      it('중복은 상한보다 먼저 판정된다 — 소진된 쿠폰에 재시도해도 duplicate 다', async () => {
        await service.upsert({ promotion_id: 'promo_dup', max_claims: 1 });
        expect(await issue('promo_dup', 'cus_c', 'k1', 1)).toEqual('created');
        expect(await issue('promo_dup', 'cus_c', 'k1', 1)).toEqual('duplicate');
      });

      it('회수된 미사용 장은 슬롯을 돌려준다', async () => {
        await service.upsert({ promotion_id: 'promo_rev', max_claims: 1 });
        await issue('promo_rev', 'cus_d', 'k1', 1);
        expect(await issue('promo_rev', 'cus_e', 'k2', 1)).toEqual('exhausted');
        await service.revokeGrants('promo_rev', 'cus_d');
        expect(await service.countIssuedGrants('promo_rev')).toEqual(0);
        expect(await issue('promo_rev', 'cus_e', 'k3', 1)).toEqual('created');
      });

      it('사용된 장은 회수돼도 슬롯을 계속 점유한다', async () => {
        await service.upsert({ promotion_id: 'promo_used', max_claims: 1 });
        await issue('promo_used', 'cus_f', 'k1', 1);
        const [g] = await service.listGrantsForPromotion('promo_used');
        await service.consumeGrantIfUnused(g.id, 'order_1', new Date());
        await service.revokeGrants('promo_used', 'cus_f');
        expect(await service.countIssuedGrants('promo_used')).toEqual(1);
      });

      it('max_claims 가 null 이면 세지 않고 무제한으로 발급된다', async () => {
        await service.upsert({ promotion_id: 'promo_free' });
        expect(await issue('promo_free', 'cus_g', 'k1', null)).toEqual('created');
        expect(await issue('promo_free', 'cus_g', 'k2', null)).toEqual('created');
        expect(await service.countIssuedGrants('promo_free')).toEqual(2);
      });

      it('enforce_cap=false(admin force) 는 상한을 넘겨 발급하되 세어진다', async () => {
        await service.upsert({ promotion_id: 'promo_force', max_claims: 1 });
        expect(await issue('promo_force', 'cus_h', 'k1', 1)).toEqual('created');
        expect(await issue('promo_force', 'cus_h', 'k2', 1, false)).toEqual('created');
        expect(await service.countIssuedGrants('promo_force')).toEqual(2);
      });

      // 🔴 타이밍 경합(Promise.all 두 호출이 실제로 겹치길 «기다리는» 방식)으로는 이 락을
      // 검증할 수 없었다 — 2-way 11회·20-way 1회 전부 과다발급 0건으로, 이 테스트 하네스의
      // 로컬 Postgres 왕복이 너무 빨라 레이스 윈도우가 안정적으로 재현되지 않는다(자세한
      // 내용은 task-2-report.md 수정 라운드 1). 그래서 경합을 «기다리지» 않고 «만든다»:
      // 한 트랜잭션이 `promotion_meta` 행을 밖에서 잡아 쥔 채 발급을 시도해, 발급이 그 락에
      // «걸려» 대기하는지를 직접 관찰한다 — 결정론적이고 타이밍에 기대지 않는다.
      it('발급은 promotion_meta 행 락으로 직렬화된다 — 락을 빼면 빨개진다', async () => {
        await service.upsert({ promotion_id: 'promo_lockA', max_claims: 1 });
        await service.upsert({ promotion_id: 'promo_lockB', max_claims: 1 });
        const em = (service as any).baseRepository_.manager_;
        const lockSql = `SELECT 1 FROM "promotion_meta" WHERE "promotion_id" = ? FOR UPDATE`;

        // ── 대조군: «다른» 프로모션을 잡아두면 발급은 막히지 않아야 한다.
        //    이게 막히면 커넥션 풀이 직렬화하고 있다는 뜻이고, 아래 본시험은 무의미해진다.
        const other = em.fork();
        await other.begin();
        try {
          await other.execute(lockSql, ['promo_lockB']);
          let controlDone = false;
          const control = issue('promo_lockA', 'cus_ctl', 'kc', 1).then((r) => { controlDone = true; return r; });
          await new Promise((r) => setTimeout(r, 300));
          expect(controlDone).toBe(true); // 🔴 false 면 하네스가 직렬화 중 — 이 테스트는 무효다
          expect(await control).toEqual('created');
        } finally {
          await other.rollback();
        }

        // ── 본시험: «같은» 프로모션을 잡아두면 발급이 락에서 막혀야 한다.
        const holder = em.fork();
        await holder.begin();
        let issued = false;
        let issuing: Promise<string>;
        try {
          await holder.execute(lockSql, ['promo_lockB']);
          issuing = issue('promo_lockB', 'cus_sub', 'ks', 1).then((r) => { issued = true; return r; });
          await new Promise((r) => setTimeout(r, 300));
          // 🔴 lockPromotionForIssue 를 지우면 발급이 promotion_meta 를 아예 안 건드리므로
          //    즉시 끝나 issued === true 가 되고 이 단언이 빨개진다. 이것이 이 테스트의 요점이다.
          expect(issued).toBe(false);
        } finally {
          await holder.commit();
        }
        expect(await issuing!).toEqual('created');
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
