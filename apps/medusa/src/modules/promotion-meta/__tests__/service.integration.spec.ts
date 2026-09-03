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
        await service.consumeGrantIfUnused(g.id, 'cart_1', new Date());
        await service.revokeGrants('promo_used', 'cus_f');
        expect(await service.countIssuedGrants('promo_used')).toEqual(1);
      });

      it('회수된 장은 주문이 취소돼도 되살아나지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_res', max_claims: null });
        await issue('promo_res', 'cus_j', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_res');
        await service.consumeGrantIfUnused(g.id, 'cart_res', new Date());
        await service.revokeGrants('promo_res', 'cus_j');

        expect(await service.restoreGrantsByCart('cart_res', new Date())).toEqual(0);

        const after = await service.listGrantsForCustomer('cus_j');
        const mine = after.find((r) => r.id === g.id);
        expect(mine?.used_at).not.toBeNull();
        expect(mine?.revoked_at).not.toBeNull();
      });

      it('회수되지 않은 장은 주문 취소로 되살아난다 (기존 동작 유지)', async () => {
        await service.upsert({ promotion_id: 'promo_ok', max_claims: null });
        await issue('promo_ok', 'cus_k', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_ok');
        await service.consumeGrantIfUnused(g.id, 'cart_ok', new Date());

        expect(await service.restoreGrantsByCart('cart_ok', new Date())).toEqual(1);

        const after = await service.listGrantsForCustomer('cus_k');
        expect(after.find((r) => r.id === g.id)?.used_at).toBeNull();
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

      it('countIssuedGrantsByPromotion 은 한 번의 조회로 프로모션별 장수를 돌려준다', async () => {
        await service.upsert({ promotion_id: 'promo_b1' });
        await service.upsert({ promotion_id: 'promo_b2' });
        await issue('promo_b1', 'cus_i', 'k1', null);
        await issue('promo_b1', 'cus_i', 'k2', null);
        await issue('promo_b2', 'cus_i', 'k3', null);
        const counts = await service.countIssuedGrantsByPromotion(['promo_b1', 'promo_b2', 'promo_none']);
        expect(counts.get('promo_b1')).toEqual(2);
        expect(counts.get('promo_b2')).toEqual(1);
        // 장이 하나도 없는 프로모션은 «0» 이어야 한다 — 키 없음으로 두면 호출부가 undefined 를 만난다
        expect(counts.get('promo_none')).toEqual(0);
      });

      it('countIssuedGrantsByPromotion 은 sharedContext 를 받으면 그 트랜잭션 «안»을 읽는다', async () => {
        // 형제 `countIssuedGrants` 와 달리 컨텍스트를 거부하던 자리(재리뷰 F10). 집행 트랜잭션
        // 안에서 배치 카운트를 부르는 호출자가 생기면 자기 INSERT 를 못 보고 상한이 한 장씩 새는
        // fail-open 이 된다 — 주석으로만 막던 덫을 없앤다.
        await service.upsert({ promotion_id: 'promo_ctx', max_claims: 5 });
        const em = (service as any).baseRepository_.manager_;
        const tx = em.fork();
        await tx.begin();
        try {
          await tx.execute(
            `INSERT INTO "coupon_grant"
               ("id", "promotion_id", "customer_id", "issue_key", "issued_via", "issued_at", "created_at", "updated_at")
             VALUES ('cg_ctx_1', 'promo_ctx', 'cus_ctx', 'k1', 'admin_manual', now(), now(), now())`,
          );
          const inside = await service.countIssuedGrantsByPromotion(['promo_ctx'], { transactionManager: tx });
          const outside = await service.countIssuedGrantsByPromotion(['promo_ctx']);
          expect(inside.get('promo_ctx')).toBe(1); // 커밋 전 — 트랜잭션 안에서만 보인다
          expect(outside.get('promo_ctx')).toBe(0);
        } finally {
          await tx.rollback();
        }
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
          // 🔴 위 expect 가 throw 해도 발급 promise 는 반드시 여기서 회수한다 — commit 이
          //    락을 풀면 곧 resolve 되는데(reject 는 아니라 unhandled rejection 은 안 나지만),
          //    finally 밖에서 기다리면 이 테스트가 끝난 뒤에야 정착해 다음 테스트로 샌다.
          expect(await issuing!).toEqual('created');
        }
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

      it('consumeGrantIfUnused 는 updated_at 을 갱신한다', async () => {
        await service.upsert({ promotion_id: 'promo_upd', max_claims: null });
        await issue('promo_upd', 'cus_l', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_upd');

        const em = (service as any).baseRepository_.manager_;
        const before = await em.execute(`SELECT "updated_at" FROM "coupon_grant" WHERE "id" = ?`, [g.id]);
        await new Promise((r) => setTimeout(r, 10));
        await service.consumeGrantIfUnused(g.id, 'cart_upd', new Date());
        const after = await em.execute(`SELECT "updated_at" FROM "coupon_grant" WHERE "id" = ?`, [g.id]);

        expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
          new Date(before[0].updated_at).getTime(),
        );
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

        await service.consumeGrantIfUnused(grants[0].id, 'cart_1', usedAt);

        const after = await service.listGrantsForCustomer('cus_use');
        expect(after.filter((g) => g.used_at != null)).toHaveLength(1);
        expect(after.find((g) => g.id === grants[0].id)?.cart_id).toBe('cart_1');
      });

      it('restoreGrantsByCart 는 만료되지 않은 장만 되살린다', async () => {
        const past = new Date('2020-01-01T00:00:00.000Z');
        const future = new Date('2099-01-01T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_restore',
          customer_id: 'cus_restore',
          issued_via: 'admin_manual' as const,
          issued_at: past,
          used_at: past,
          cart_id: 'cart_cancel',
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'alive', expires_at: future },
          { ...base, issue_key: 'dead', expires_at: past },
        ]);

        const restored = await service.restoreGrantsByCart('cart_cancel', new Date());

        expect(restored).toBe(1);
        const rows = await service.listGrantsForCustomer('cus_restore');
        expect(rows.find((g) => g.issue_key === 'alive')?.used_at).toBeNull();
        expect(rows.find((g) => g.issue_key === 'alive')?.cart_id).toBeNull();
        expect(rows.find((g) => g.issue_key === 'dead')?.used_at).not.toBeNull();
      });

      it('restoreGrantsByCart 는 두 번 불려도 결과가 같다', async () => {
        const base = {
          promotion_id: 'promo_restore2',
          customer_id: 'cus_restore2',
          issue_key: 'k',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
          used_at: new Date(),
          cart_id: 'cart_twice',
          expires_at: null,
        };
        await service.createCouponGrants([base]);

        expect(await service.restoreGrantsByCart('cart_twice', new Date())).toBe(1);
        expect(await service.restoreGrantsByCart('cart_twice', new Date())).toBe(0);
      });

      // ── ADR-0034 결정 6: 되돌림 본체는 하나다 ─────────────────────────────────────
      // 훅 보상(이번 실행이 잡은 id) · 취소 구독자(카트로 고른 id) · 스위퍼(조건으로 고른 id) 가
      // 전부 `restoreGrants(ids)` 를 지난다. 정책(만료·회수)은 고르는 쪽의 일이고 여기엔 없다.
      it('restoreGrants 는 id 목록 중 «사용된» 장만 되돌리고 그 수를 돌려준다 — 만료·회수는 보지 않는다', async () => {
        const past = new Date('2020-01-01T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_undo',
          customer_id: 'cus_undo',
          issued_via: 'admin_manual' as const,
          issued_at: past,
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'used', used_at: past, cart_id: 'cart_u' },
          { ...base, issue_key: 'expired_used', used_at: past, cart_id: 'cart_u', expires_at: past },
          { ...base, issue_key: 'unused' },
        ]);
        const rows = await service.listGrantsForCustomer('cus_undo');
        const ids = rows.map((g) => g.id);

        // 보상은 undo 다 — 만료된 장도 잡았던 그대로 놓는다(「사용됨」보다 「만료」가 진실에 가깝다).
        expect(await service.restoreGrants(ids)).toBe(2);

        const after = await service.listGrantsForCustomer('cus_undo');
        expect(after.every((g) => g.used_at == null && g.cart_id == null)).toBe(true);
        expect(await service.restoreGrants(ids)).toBe(0);
        expect(await service.restoreGrants([])).toBe(0);
      });

      it('restoreGrants 는 soft delete 된 장은 건드리지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_undo_del', max_claims: null });
        await issue('promo_undo_del', 'cus_undo_del', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_undo_del');
        await service.revokeGrants('promo_undo_del', 'cus_undo_del'); // 미사용 → soft delete

        expect(await service.restoreGrants([g.id])).toBe(0);
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

      // 옛 구현은 «전량» soft delete 라 쓴 장의 이력이 사라지고, 그 슬롯까지 되돌아갔다
      // (ADR-0034 결정 1). 지금 구현은 쓴 장을 살려 두지만, 그 대신 revoked_at 을 찍어
      // 회수된 사실 자체를 기억한다 — 그래서 그 주문이 나중에 취소돼도 되살아나지 않는다
      // (설계 결정 3, 아래 '회수된 장은 주문이 취소돼도 되살아나지 않는다' 참고).
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
        await service.consumeGrantIfUnused(grants[0].id, 'cart_kept', new Date());

        expect(await service.revokeGrants('promo_rev_used', 'cus_rev_used')).toEqual({
          revoked: 2,
          remaining: 1,
        });

        // 쓴 장은 그대로 살아 있지만(이력 보존), 회수됐으므로 그 주문으로도 되살아나지 않는다.
        const left = await service.listGrantsForCustomer('cus_rev_used');
        expect(left).toHaveLength(1);
        expect(left[0].cart_id).toBe('cart_kept');
        expect(await service.restoreGrantsByCart('cart_kept', new Date())).toBe(0);
      });

      // ── 0단계 (PR #778 리뷰 F3·F12·F5) ──────────────────────────────────────────
      // 회수 본체가 둘(어드민 회수 `revokeGrants_` / 워크플로 보상 `revokeGrantsByIssueKeys`)로
      // 갈려 「쓴 장은 soft delete 하지 않는다」가 한쪽에만 걸려 있었다.
      // 위쪽 describe 의 `issue` 헬퍼는 이 스코프에 없다 — 같은 모양으로 하나 둔다.
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

      it('revokeGrantsByIssueKeys(보상) 는 이미 쓴 장을 soft delete 하지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_comp_used', max_claims: null });
        await issue('promo_comp_used', 'cus_comp', 'k1', null);
        await issue('promo_comp_used', 'cus_comp', 'k2', null);
        const k1 = (await service.listGrantsForCustomer('cus_comp')).find((g) => g.issue_key === 'k1')!;
        expect(await service.consumeGrantIfUnused(k1.id, 'cart_comp', new Date())).toBe(true);

        // 보상은 «이번 실행이 만든 것» 중 아직 안 쓴 장만 치운다 — 쓴 장은 슬롯이 실제로
        // 소비됐고 이력이라, 지우면 countIssuedGrants·restoreGrantsByCart 가 함께 틀린다.
        expect(await service.revokeGrantsByIssueKeys('promo_comp_used', 'cus_comp', ['k1', 'k2'])).toBe(1);

        const left = await service.listGrantsForCustomer('cus_comp');
        expect(left.map((g) => g.issue_key)).toEqual(['k1']);
        expect(left[0].used_at).not.toBeNull();
        // 보상은 어드민 회수가 아니다 — 회수 표지를 찍지 않는다(주문 취소 복원을 막으면 안 된다).
        expect(left[0].revoked_at).toBeNull();
        expect(await service.countIssuedGrants('promo_comp_used')).toBe(1);
      });

      it('재회수는 revoked_at 을 덮어쓰지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_rerev', max_claims: null });
        await issue('promo_rerev', 'cus_rerev', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_rerev');
        await service.consumeGrantIfUnused(g.id, 'cart_rerev', new Date());

        await service.revokeGrants('promo_rerev', 'cus_rerev');
        const first = (await service.listGrantsForCustomer('cus_rerev'))[0].revoked_at;
        expect(first).not.toBeNull();

        await new Promise((r) => setTimeout(r, 20));
        expect(await service.revokeGrants('promo_rerev', 'cus_rerev')).toEqual({ revoked: 0, remaining: 1 });
        const second = (await service.listGrantsForCustomer('cus_rerev'))[0].revoked_at;
        expect(new Date(second as string).getTime()).toBe(new Date(first as string).getTime());
      });

      // `issued_count` 는 이 PR 이 읽기를 COUNT 로 옮겼지만 컬럼은 후속 contract PR 까지 남는다.
      // 그동안 옛 태스크(롤링·롤백)가 이 컬럼으로 상한을 집행하므로, expand 단계 규약대로
      // 쓰기를 **미러**한다 — 안 하면 동결된 카운터가 실제 장수 아래로 내려가 롤백 즉시
      // 상한이 새는 fail-open 이 된다. 의미는 옛 코드와 같다: 상한 있는 프로모션만 센다.
      describe('issued_count 미러 — expand 단계 dual write (롤백 안전망)', () => {
        const issuedCountOf = async (promotionId: string) =>
          Number((await service.getByPromotionId(promotionId))?.issued_count);

        it('상한 있는 프로모션은 발급·중복·소진·force·회수마다 issued_count 가 장수를 따라간다', async () => {
          await service.upsert({ promotion_id: 'promo_mirror', max_claims: 2 });
          expect(await issuedCountOf('promo_mirror')).toBe(0);

          expect(await issue('promo_mirror', 'cus_m', 'k1', 2)).toBe('created');
          expect(await issuedCountOf('promo_mirror')).toBe(1);

          expect(await issue('promo_mirror', 'cus_m', 'k1', 2)).toBe('duplicate');
          expect(await issuedCountOf('promo_mirror')).toBe(1);

          expect(await issue('promo_mirror', 'cus_m', 'k2', 2)).toBe('created');
          expect(await issue('promo_mirror', 'cus_m', 'k3', 2)).toBe('exhausted');
          expect(await issuedCountOf('promo_mirror')).toBe(2);

          // force 는 상한을 넘겨도 센다 — 옛 `incrementIssuedCount` 와 같은 규칙.
          expect(await issue('promo_mirror', 'cus_m', 'k4', 2, false)).toBe('created');
          expect(await issuedCountOf('promo_mirror')).toBe(3);

          expect(await service.revokeGrants('promo_mirror', 'cus_m')).toEqual({ revoked: 3, remaining: 0 });
          expect(await issuedCountOf('promo_mirror')).toBe(0);
        });

        it('상한 없는 프로모션은 issued_count 를 건드리지 않는다 (옛 코드와 같은 의미)', async () => {
          await service.upsert({ promotion_id: 'promo_mirror_free', max_claims: null });
          await issue('promo_mirror_free', 'cus_mf', 'k1', null);
          expect(await issuedCountOf('promo_mirror_free')).toBe(0);
          await service.revokeGrants('promo_mirror_free', 'cus_mf');
          expect(await issuedCountOf('promo_mirror_free')).toBe(0);
        });

        it('보상(revokeGrantsByIssueKeys) 도 실제로 치운 장수만큼만 되돌린다', async () => {
          await service.upsert({ promotion_id: 'promo_mirror_comp', max_claims: 5 });
          await issue('promo_mirror_comp', 'cus_mc', 'k1', 5);
          await issue('promo_mirror_comp', 'cus_mc', 'k2', 5);
          expect(await issuedCountOf('promo_mirror_comp')).toBe(2);
          const k1 = (await service.listGrantsForCustomer('cus_mc')).find((g) => g.issue_key === 'k1')!;
          await service.consumeGrantIfUnused(k1.id, 'cart_mc', new Date());

          await service.revokeGrantsByIssueKeys('promo_mirror_comp', 'cus_mc', ['k1', 'k2']);
          expect(await issuedCountOf('promo_mirror_comp')).toBe(1);
        });
      });

      // ── PR-2 결정 1: 소모는 모듈 안에서 「고르기 + CAS」 한 문장이다 ──────────────────
      // 옛 구조는 훅이 `selectGrantToConsume`(FEFO) 으로 장을 고른 뒤 `consumeGrantIfUnused(id)` 로
      // 찍었다. 두 층이 갈려 있어 같은 고객의 두 카트가 «결정적으로 같은 장»을 고르고, 진 쪽은
      // 다음 장을 시도하지 않았다(재리뷰 F1). 아래 스펙들은 옛 훅의 네 규칙(FEFO·만료 경계·
      // 재호출 멱등성·동시성)이 전부 SQL 한 문장으로 옮겨졌음을 실 DB 로 고정한다.
      describe('consumeOneUsableGrant — 고르기와 CAS 가 한 문장이다 (PR-2 결정 1)', () => {
        const NOW = new Date('2026-09-10T00:00:00.000Z');
        const seed = (
          promotionId: string,
          customerId: string,
          rows: Array<{ key: string; expires_at?: Date | null; issued_at?: Date; used_at?: Date | null; order_id?: string | null }>,
        ) =>
          service.createCouponGrants(
            rows.map((r) => ({
              promotion_id: promotionId,
              customer_id: customerId,
              issue_key: r.key,
              issued_via: 'admin_manual' as const,
              issued_at: r.issued_at ?? new Date('2026-09-01T00:00:00.000Z'),
              expires_at: r.expires_at ?? null,
              used_at: r.used_at ?? null,
              order_id: r.order_id ?? null,
            })),
          );
        const consume = (promotionId: string, customerId: string, orderId: string, now = NOW) =>
          service.consumeOneUsableGrant({ promotion_id: promotionId, customer_id: customerId, order_id: orderId, now });
        const byKey = async (customerId: string) =>
          new Map((await service.listGrantsForCustomer(customerId)).map((g) => [g.issue_key, g]));

        it('FEFO — 만료가 이른 장을 먼저, 무기한은 맨 뒤', async () => {
          await seed('p_fefo', 'c_fefo', [
            { key: 'forever', expires_at: null },
            { key: 'late', expires_at: new Date('2026-12-31T00:00:00.000Z') },
            { key: 'soon', expires_at: new Date('2026-09-20T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_fefo');
          expect(await consume('p_fefo', 'c_fefo', 'o1')).toBe(grants.get('soon')!.id);
          expect(await consume('p_fefo', 'c_fefo', 'o2')).toBe(grants.get('late')!.id);
          expect(await consume('p_fefo', 'c_fefo', 'o3')).toBe(grants.get('forever')!.id);
          expect(await consume('p_fefo', 'c_fefo', 'o4')).toBeNull();
        });

        it('FEFO 동률 — expires_at 이 같으면 issued_at 이 이른 장, 그것도 같으면 id 오름차순', async () => {
          const exp = new Date('2026-09-30T00:00:00.000Z');
          await seed('p_tie', 'c_tie', [
            { key: 'later_issued', expires_at: exp, issued_at: new Date('2026-09-02T00:00:00.000Z') },
            { key: 'earlier_issued', expires_at: exp, issued_at: new Date('2026-09-01T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_tie');
          expect(await consume('p_tie', 'c_tie', 'o1')).toBe(grants.get('earlier_issued')!.id);
          expect(await consume('p_tie', 'c_tie', 'o2')).toBe(grants.get('later_issued')!.id);

          // 대량발급은 배치당 now 하나를 쓰므로 issued_at 동률이 기본 상황이다 — 그때는 id 가 정한다.
          const same = new Date('2026-09-03T00:00:00.000Z');
          await seed('p_tie2', 'c_tie2', [
            { key: 'a', expires_at: exp, issued_at: same },
            { key: 'b', expires_at: exp, issued_at: same },
          ]);
          const ids = [...(await byKey('c_tie2')).values()].map((g) => g.id).sort();
          expect(await consume('p_tie2', 'c_tie2', 'o3')).toBe(ids[0]);
          expect(await consume('p_tie2', 'c_tie2', 'o4')).toBe(ids[1]);
        });

        it('만료 경계는 포함이다 — expires_at == now 는 쓸 수 있고, 지난 장은 고르지 않는다', async () => {
          // `grants.ts::usableGrants` 와 같은 경계(`now > expiresAt` 만 불가). 어긋나면
          // 「카트엔 붙는데 주문에서 소모되지 않는」 창이 생긴다.
          await seed('p_edge', 'c_edge', [
            { key: 'past', expires_at: new Date('2026-09-09T23:59:59.000Z') },
            { key: 'edge', expires_at: NOW },
          ]);
          const grants = await byKey('c_edge');
          expect(await consume('p_edge', 'c_edge', 'o1')).toBe(grants.get('edge')!.id);
          expect(await consume('p_edge', 'c_edge', 'o2')).toBeNull();
        });

        it('같은 order_id 로 두 번 부르면 두 번째는 null — 여분 장이 있어도 (재호출 멱등성)', async () => {
          // 옛 `selectGrantIdsToConsume` 의 「이 주문이 이미 소모한 장이 있으면 건너뛴다」가
          // `NOT EXISTS(order_id)` 로 옮겨졌다. 엔진이 훅을 재호출해도 주문당 쿠폰당 한 장이다.
          await seed('p_idem', 'c_idem', [{ key: 'a' }, { key: 'b' }]);
          expect(await consume('p_idem', 'c_idem', 'o_same')).not.toBeNull();
          expect(await consume('p_idem', 'c_idem', 'o_same')).toBeNull();
          expect(await consume('p_idem', 'c_idem', 'o_other')).not.toBeNull();
        });

        it('발급받지 않은 프로모션·회수된 장·이미 쓴 장은 null', async () => {
          await seed('p_none', 'c_none', [
            { key: 'used', used_at: new Date('2026-09-02T00:00:00.000Z'), order_id: 'o_old' },
            { key: 'rev' },
          ]);
          await service.revokeGrantsByIssueKeys('p_none', 'c_none', ['rev']); // soft delete
          expect(await consume('p_none', 'c_none', 'o1')).toBeNull();
          expect(await consume('p_never', 'c_none', 'o1')).toBeNull();
        });

        it('소모한 장에만 used_at·order_id 가 찍힌다', async () => {
          await seed('p_one', 'c_one', [{ key: 'a' }, { key: 'b' }]);
          const id = await consume('p_one', 'c_one', 'o_one');
          const grants = await service.listGrantsForCustomer('c_one');
          const hit = grants.find((g) => g.id === id)!;
          const miss = grants.find((g) => g.id !== id)!;
          expect(hit.order_id).toBe('o_one');
          expect(hit.used_at).not.toBeNull();
          expect(miss.order_id).toBeNull();
          expect(miss.used_at).toBeNull();
        });

        it('다른 트랜잭션이 잡은 장은 건너뛰고 다음 장을 소모한다 — SKIP LOCKED', async () => {
          // 두 카트 동시 완료의 결정적 재현: FEFO 만 보면 first 다. first 를 밖에서 잠가 두면
          // second 를 잡아야 하고, 락을 기다리지도 않아야 한다(300ms 안에 끝난다).
          await seed('p_lock', 'c_lock', [
            { key: 'first', expires_at: new Date('2026-09-15T00:00:00.000Z') },
            { key: 'second', expires_at: new Date('2026-09-16T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_lock');
          const em = (service as any).baseRepository_.manager_;
          const holder = em.fork();
          await holder.begin();
          try {
            await holder.execute(`SELECT 1 FROM "coupon_grant" WHERE "id" = ? FOR UPDATE`, [grants.get('first')!.id]);
            let done = false;
            const consuming = consume('p_lock', 'c_lock', 'o_race').then((r) => {
              done = true;
              return r;
            });
            await new Promise((r) => setTimeout(r, 300));
            expect(done).toBe(true); // 🔴 false 면 SKIP LOCKED 가 빠져 락을 기다리고 있다
            expect(await consuming).toBe(grants.get('second')!.id);
          } finally {
            await holder.rollback();
          }
          // 락이 풀리면 first 는 여전히 미사용이라 다음 주문이 가져간다.
          expect(await consume('p_lock', 'c_lock', 'o_next')).toBe(grants.get('first')!.id);
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

          expect(await service.consumeGrantIfUnused(grant.id, 'cart_first', new Date())).toBe(true);
          // 두 카트가 동시에 완료되면 두 훅이 «같은» 장을 고른다(선택은 결정적이다).
          // 옛 무조건 UPDATE 는 둘 다 성공해 한 장으로 할인 주문 두 건이 나갔다.
          expect(await service.consumeGrantIfUnused(grant.id, 'cart_second', new Date())).toBe(false);

          const [after] = await service.listGrantsForCustomer('cus_once');
          expect(after.cart_id).toBe('cart_first');
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

          expect(await service.consumeGrantIfUnused(grant.id, 'cart_x', new Date())).toBe(false);
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

          expect(await service.consumeGrantIfUnused(grant.id, 'cart_ts', usedAt)).toBe(true);

          const [after] = await service.listGrantsForCustomer('cus_ts');
          expect(new Date(after.used_at as string | Date).toISOString()).toBe('2026-03-04T05:06:07.000Z');
        });
      });
    });
  },
});
