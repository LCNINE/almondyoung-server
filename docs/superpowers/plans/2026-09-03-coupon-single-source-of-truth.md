# 쿠폰 보유 상태의 정본을 하나로 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「이 고객이 이 쿠폰을 가지고 있는가」의 정본을 3벌(`coupon_grant` · `promotion_meta.issued_count` · customer↔promotion 링크)에서 **`coupon_grant` 한 벌**로 줄인다.

**Architecture:** 상한 집행을 카운터 UPDATE 에서 「`promotion_meta` 행을 `FOR UPDATE` 로 잠그고 `coupon_grant` 를 세는」 방식으로 바꾼다(원자성의 출처는 원래부터 카운터 값이 아니라 그 행의 배타 락이었다). 「발급된 프로모션 목록」은 링크가 아니라 `coupon_grant.promotion_id` 에서 유도하고, 링크 쓰기를 전부 제거한다. 링크 테이블·컬럼 자체의 삭제는 이 계획 밖이다(expand-contract).

**Tech Stack:** Medusa v2.13.4 (`apps/medusa`), MikroORM 모듈 서비스 + 원시 SQL, Postgres, Jest (`TEST_TYPE` 로 unit/integration 분기)

**Spec:** `docs/superpowers/specs/2026-09-03-coupon-single-source-of-truth-design.md`

## Global Constraints

- **전 구간 additive.** 이 계획에는 `DROP COLUMN`/`DROP TABLE`/`ALTER COLUMN` 이 하나도 없다. `promotion_meta.issued_count` 와 링크 테이블은 **남겨둔 채 읽기·쓰기만 끊는다.** 삭제는 후속 PR (`CLAUDE.md` expand-contract §5).
- **마이그레이션 적용은 자동이다.** `apps/medusa` 는 컨테이너 CMD 가 `medusa db:migrate --execute-safe-links` 를 부른다. drizzle 서비스처럼 사람이 `db:migrate` 를 부르지 않는다.
- **게이트 명령** (`apps/medusa` 는 루트 `npm run type-check` / `npx jest` **밖**이다):
  - 타입: `cd apps/medusa && npx tsc --noEmit`
  - 유닛: `cd apps/medusa && yarn test:unit`
  - 모듈 통합: `scripts/local/run-medusa-integration.sh --modules`
  - HTTP 통합: `scripts/local/run-medusa-integration.sh`
  - **`yarn test:integration:*` 를 직접 부르지 말 것** — `@medusajs/test-utils` 는 `DATABASE_URL` 이 아니라 `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD` 를 읽는다. 래퍼가 파생시켜 넘긴다.
  - **postgres 와 redis 가 둘 다 떠 있어야 한다.** redis 없이는 앱 부팅 단계에서 전 스펙이 죽는다.
- **admin-web 게이트는 따로다:** `cd apps/admin-web && npx tsc --noEmit` (루트 type-check 는 admin-web 을 제외한다).
- **`count(*)` 는 bigint 라 드라이버가 문자열로 돌려준다.** `::int` 캐스트와 `Number()` 를 **둘 다** 건다. `max_claims` 도 DB 에서 문자열로 오는 경우가 있어(`validity.ts:19` 주석) 비교 양쪽을 `Number()` 로 감싼다.
- **MikroORM 은 unit-of-work 다.** `createCouponGrants` 는 INSERT 를 커밋까지 미루므로, 같은 트랜잭션의 원시 SQL 보다 **먼저** 반영되게 하려면 `await this.txEm(sharedContext).flush()` 를 명시적으로 불러야 한다. 목으로는 절대 안 잡힌다.
- **유니크 위반은 트랜잭션을 aborted 로 만든다.** 위반 이후 같은 트랜잭션에서 어떤 문장도 실행할 수 없다. 그래서 중복 판정은 신호로 던져 트랜잭션 밖에서 잡는다(기존 `DuplicateGrantSignal` 패턴 유지).
- **Task 3·4·8 의 모듈 통합 테스트는 Task 2 Step 1 에서 정의한 `issue()` 헬퍼를 재사용한다** — 전부 `service.integration.spec.ts` 의 같은 `describe('PromotionMetaModuleService', ...)` 블록 안이다. 태스크를 순서 밖으로 실행한다면 그 헬퍼를 먼저 넣어야 한다.
- 커밋 메시지는 아래 트레일러로 끝낸다:
  ```
  Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn
  ```

---

## File Structure

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| `apps/medusa/src/modules/promotion-meta/service.ts` | grant 의 쓰기·판정 전부. 상한 집행이 여기로 모인다 | Task 2·4·8 수정 |
| `apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts` | grant 모델 | Task 4 에 `revoked_at` 추가 |
| `apps/medusa/src/modules/promotion-meta/migrations/Migration2026090401*.ts` | `revoked_at` 컬럼 | Task 4 생성 |
| `apps/medusa/src/workflows/coupons/steps/issue-coupon-grants-step.ts` | 발급 루프 + 보상 | Task 2·7 수정 |
| `apps/medusa/src/workflows/coupons/workflows/issue-coupon-grant-workflow.ts` | 발급 워크플로 | Task 7 에서 링크 스텝 제거 |
| `apps/medusa/src/api/store/customers/me/promotions/route.ts` | 마이페이지 쿠폰 목록 | Task 3·5 수정 |
| `apps/medusa/src/api/store/events/[slug]/route.ts` | 이벤트 페이지 쿠폰 | Task 3 수정 |
| `apps/medusa/src/api/admin/promotions/helpers.ts` | 어드민 메타 payload | Task 3 수정 |
| `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` | 어드민 고객별 쿠폰 (GET/POST/DELETE) | Task 2·6·7 수정 |
| `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` | 어드민 쿠폰별 고객 (GET/POST/DELETE) | Task 2·7·8 수정 |
| `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts` | 고객 직접 발급 | Task 7 수정 |
| `apps/medusa/src/scripts/backfill-issued-count.ts` | 옛 카운터 정합화 | Task 8 삭제 |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts` | 어드민 쿠폰 메타 뷰 | Task 3 수정 |

---

## Task 1: 선행 실측 — 링크→grant 이관이 라이브에서 끝났는지 확인

착수 게이트다. **코드 변경 없음.** 결과가 «미완» 이면 이 계획 전체를 멈추고 백필부터 돌린다.

`api/store/customers/me/promotions/route.ts` 는 「아직 grant 없이 링크만 있는 구식 배정」을 명시적으로 다루고 있다. 그런 행이 라이브에 남아 있으면 Task 5·6 이 그 고객들의 쿠폰을 통째로 사라지게 하고, Task 2 가 상한을 과소 집계한다.

**Files:**
- Create: `docs/superpowers/reports/2026-09-03-coupon-link-grant-parity.md`

**Interfaces:**
- Produces: 이 계획의 착수 가부. 「차집합 0」이 아니면 Task 2 이후는 실행 금지.

- [ ] **Step 1: 링크 테이블의 실제 이름을 찾는다**

링크 테이블 이름은 우리 소스에 없다 — `--execute-safe-links` 가 만든다. 라이브 DB 에서 찾는다:

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE '%customer%promotion%';
```

- [ ] **Step 2: 차집합을 센다**

앞 단계에서 찾은 이름을 `<link_table>` 자리에 넣는다.

```sql
-- (A) 링크에는 있는데 grant 가 없는 (고객, 프로모션) 쌍 — 0 이어야 한다
SELECT count(*) AS link_without_grant
  FROM "<link_table>" l
 WHERE l.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM coupon_grant g
      WHERE g.customer_id = l.customer_id
        AND g.promotion_id = l.promotion_id
        AND g.deleted_at IS NULL
   );

-- (B) 참고용 — 반대 방향(grant 는 있는데 링크가 없는 쌍). 0 이 아니어도 이 계획은 진행 가능하다
--     (오히려 이 계획이 고치려는 「유령」이다). 규모만 기록한다.
SELECT count(*) AS grant_without_link
  FROM (SELECT DISTINCT customer_id, promotion_id FROM coupon_grant WHERE deleted_at IS NULL) g
 WHERE NOT EXISTS (
     SELECT 1 FROM "<link_table>" l
      WHERE l.customer_id = g.customer_id AND l.promotion_id = g.promotion_id AND l.deleted_at IS NULL
   );

-- (C) 현재 카운터와 grant 수의 어긋남 — Task 2 가 무엇을 바꾸는지의 사전 스냅샷
SELECT m.promotion_id, m.max_claims, m.issued_count,
       (SELECT count(*) FROM coupon_grant g
         WHERE g.promotion_id = m.promotion_id AND g.deleted_at IS NULL) AS grant_count
  FROM promotion_meta m
 WHERE m.max_claims IS NOT NULL
   AND m.issued_count <> (SELECT count(*) FROM coupon_grant g
                           WHERE g.promotion_id = m.promotion_id AND g.deleted_at IS NULL);
```

- [ ] **Step 3: 결과를 보고서로 남기고 판정한다**

`docs/superpowers/reports/2026-09-03-coupon-link-grant-parity.md` 에 세 쿼리의 실제 출력과 실행 시각을 적는다. 판정:

- (A) = 0 → **배포 가능**.
- (A) > 0 → **배포 금지**. `medusa exec ./src/scripts/backfill-coupon-grants.ts` 를 먼저 돌리고 (A) 를 다시 0 으로 만든다.

> **이것은 «배포» 게이트지 «코드» 게이트가 아니다** (SDD Ruling 1, 2026-09-03). 브랜치에 코드를 쓰는 것은 라이브에 영향이 없고, (A) > 0 이 나와도 올바른 대응은 재설계가 아니라 기존 백필 실행이라 설계가 바뀌지 않는다. 따라서 Task 2~8 은 이 실측을 기다리지 않고 진행하되, **머지·배포 전에 반드시 사람이 이 태스크를 수행해야 한다.** 라이브 DB 접근에는 `aws login --profile login` 이 선행한다.
- (C) 의 행들은 「Task 3 배포 직후 어드민 발급현황 숫자가 바뀌어 보일 대상」에 그치지 않는다.
  **(C) 는 롤링 배포 중 옛 태스크(카운터)와 새 태스크(`coupon_grant` COUNT)가 상한을
  집행할 때 서로 다른 숫자를 보게 되는 「혼재 버전 상한 창」의 크기 그 자체다** — (C) 가
  0행이 아니면 그만큼의 프로모션이 이미 카운터/실제 grant 수가 어긋나 있다는 뜻이고, 배포
  전 그 어긋남을 없애지 않으면(§ 배포 노트의 정합화 SQL) 그 프로모션들에서 상한이 새는
  창이 열린다. 목록을 보고서에 남겨야 운영자가 놀라지 않고, 배포 노트의 판단에도 쓰인다.

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/reports/2026-09-03-coupon-link-grant-parity.md
git commit -m "docs(coupon): 링크↔grant 정합성 실측 — 정본 축소 착수 게이트

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 2: 상한 집행을 `coupon_grant` COUNT 로 옮긴다

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts:126-155` (mutator 3개 제거 — `setIssuedCount` 는 Task 8 까지 남는다), `:284-334` (`issueGrantWithSlot_`)
- Modify: `apps/medusa/src/workflows/coupons/steps/issue-coupon-grants-step.ts:106` (보상의 `releaseClaimSlot` 루프 제거)
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts:336` (DELETE 의 `releaseClaimSlot` 호출 제거)
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts:357` (DELETE 의 `releaseClaimSlot` 호출 제거)
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`
- Test(픽스처 이관): `apps/medusa/integration-tests/http/coupon-store.spec.ts:127,350`, `coupon-event.spec.ts:182`, `coupon-admin.spec.ts:219` — **네 곳이 `reserveClaimSlot` 을 「소진 상태 만들기」 픽스처로 쓴다.** 메서드를 지우면 함께 깨지므로 같은 커밋에서 옮겨야 한다.

**Interfaces:**
- Produces: `countIssuedGrants(promotionId: string, sharedContext?: Context<EntityManager>): Promise<number>`
- Removes (공개 표면에서 사라짐): `reserveClaimSlot`, `releaseClaimSlot`, `incrementIssuedCount`
- 유지: `setIssuedCount` 는 Task 8 에서 백필 스크립트와 함께 사라진다. 이 태스크에서는 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` 의 `describe('PromotionMetaModuleService', ...)` 안에, 기존 `reserveClaimSlot`/`releaseClaimSlot`/`setIssuedCount` 테스트 **아래**에 추가한다(기존 3개는 Step 3 에서 지운다):

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
```

기대: `service.countIssuedGrants is not a function` 로 새 테스트 7개가 FAIL. 기존 테스트는 PASS.

- [ ] **Step 3: 구현한다**

`service.ts` 의 `reserveClaimSlot`·`releaseClaimSlot`·`incrementIssuedCount` **세 메서드를 통째로 지우고**, 그 자리에 아래 둘을 넣는다:

```ts
  /**
   * 이 프로모션이 지금까지 소진한 슬롯 수.
   *
   * 「슬롯을 점유한다」의 정의는 **`deleted_at IS NULL`** 이다 — 회수된 미사용 장은 soft
   * delete 되어 슬롯을 돌려주고, 사용된 장은 회수돼도 남아 슬롯을 계속 점유한다(이미 소비돼
   * 다시 발급할 수 없다). 옛 `reserveClaimSlot`/`releaseClaimSlot` 짝이 손으로 지키던 규칙을
   * 데이터가 스스로 표현하게 한 것이다.
   *
   * 🔴 `count(*)` 는 bigint 라 드라이버가 **문자열**로 돌려준다. `::int` 와 `Number()` 를 둘 다
   * 건다 — 한쪽이라도 빠지면 비교가 조용히 어긋난다.
   */
  async countIssuedGrants(promotionId: string, sharedContext?: Context<EntityManager>): Promise<number> {
    const rows = await this.txEm(sharedContext).execute(
      `SELECT count(*)::int AS c FROM "coupon_grant"
        WHERE "promotion_id" = ? AND "deleted_at" IS NULL`,
      [promotionId],
    );
    return Number(rows?.[0]?.c ?? 0);
  }

  /**
   * 이 프로모션의 발급을 직렬화한다. **상한을 집행하는 트랜잭션에서만** 부른다.
   *
   * 🔴 이 락이 상한의 원자성을 준다. 옛 `UPDATE ... WHERE issued_count < ?` 도 원자성의
   * 출처는 카운터 «값» 이 아니라 이 행의 배타 락이었다 — Postgres READ COMMITTED 에서
   * 두 번째 UPDATE 는 첫 커밋을 기다렸다가 WHERE 를 재평가한다. 같은 행을 `FOR UPDATE` 로
   * 잠그고 장을 세면 동일한 직렬화를 얻는다.
   */
  private async lockPromotionForIssue(
    promotionId: string,
    sharedContext?: Context<EntityManager>,
  ): Promise<void> {
    await this.txEm(sharedContext).execute(
      `SELECT 1 FROM "promotion_meta" WHERE "promotion_id" = ? FOR UPDATE`,
      [promotionId],
    );
  }
```

`issueGrantWithSlot_` 의 본문에서, `createCouponGrants` **앞**에 락을 넣고, 맨 끝의 슬롯 블록(`if (input.max_claims !== null) { ... }`)을 COUNT 로 바꾼다:

```ts
    // (0) 상한을 집행할 때만 잠근다. 이 락이 아래 COUNT 를 정확하게 만든다.
    const enforcing = input.max_claims !== null && input.enforce_cap;
    if (enforcing) {
      await this.lockPromotionForIssue(input.promotion_id, sharedContext);
    }

    // (1) 장 먼저 — 기존 코드 그대로 (createCouponGrants + flush + isUniqueViolation)

    // (2) 상한. INSERT 뒤에 세므로 방금 넣은 장이 포함된다 — 넘으면 트랜잭션째 되감긴다.
    //     force(`enforce_cap=false`)는 세기만 하고 막지 않으므로 아무것도 하지 않는다
    //     (장 자체가 카운트라 옛 `incrementIssuedCount` 가 필요 없다).
    if (enforcing) {
      const issued = await this.countIssuedGrants(input.promotion_id, sharedContext);
      if (issued > Number(input.max_claims)) throw new ExhaustedSignal();
    }
```

그리고 `reserveClaimSlot`/`releaseClaimSlot`/`incrementIssuedCount` 를 부르던 곳을 지운다:

- `apps/medusa/src/workflows/coupons/steps/issue-coupon-grants-step.ts` — 보상 함수의 `releaseClaimSlot` 루프를 통째로 삭제한다. 장을 되돌리는 `revokeGrantsByIssueKeys` 만 남는다(soft delete 가 곧 슬롯 반환이다).
- `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` 의 DELETE — `revokeGrants` 뒤의 `releaseClaimSlot(...).catch(() => {})` 반복 호출을 삭제한다.
- `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` 의 DELETE — 같은 삭제.

`service.integration.spec.ts` 의 기존 `reserveClaimSlot is atomic...` / `releaseClaimSlot decrements...` 두 테스트를 삭제한다(대상 메서드가 사라졌다). `setIssuedCount reconciles...` 는 남긴다(Task 8 에서 함께 사라진다).

**HTTP 통합 스펙 4곳의 픽스처를 옮긴다.** 네 곳 모두 「소진 상태」를 카운터로 만들고 있었다 — 이제 장으로 만들어야 한다. 각 스펙의 `testSuite` 상단(다른 헬퍼들 옆)에 아래를 넣고, `reserveClaimSlot` 호출을 `fillClaims(id, n)` 으로 바꾼다:

```ts
    /**
     * 발급 상한을 「소진」 상태로 만든다. 옛 픽스처는 `reserveClaimSlot` 으로 카운터만 올렸지만,
     * 이제 상한의 정본은 `coupon_grant` 행이라 실제 장을 심어야 한다 (설계 결정 1).
     * `coupon_grant` 는 customer 테이블에 FK 가 없으므로 채움용 고객 id 는 실재하지 않아도 된다.
     */
    const fillClaims = async (promotionId: string, n: number) => {
      const meta = getContainer().resolve(PROMOTION_META_MODULE) as any;
      for (let i = 0; i < n; i++) {
        await meta.issueGrantWithSlot({
          promotion_id: promotionId,
          customer_id: `filler_${seq}_${i}`,
          issue_key: `${promotionId}:filler:${i}`,
          issued_via: 'admin_manual',
          expires_at: null,
          now: new Date(),
          max_claims: null, // 채우는 단계에서는 상한을 집행하지 않는다
          enforce_cap: false,
        });
      }
    };
```

치환 대상 4곳 (전부 `n = 1`):

| 파일 | 줄 | 옛 호출 |
|---|---|---|
| `integration-tests/http/coupon-store.spec.ts` | 127 | `metaService.reserveClaimSlot(claimId, 1)` |
| `integration-tests/http/coupon-store.spec.ts` | 350 | `meta.reserveClaimSlot(id, 1)` |
| `integration-tests/http/coupon-event.spec.ts` | 182 | `meta.reserveClaimSlot(id, 1)` |
| `integration-tests/http/coupon-admin.spec.ts` | 219 | `metaService.reserveClaimSlot(promoId, 1)` |

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
scripts/local/run-medusa-integration.sh
cd apps/medusa && npx tsc --noEmit
```

기대: 모듈 통합 전부 PASS, 타입 에러 0. HTTP 를 여기서 돌리는 이유는 픽스처 4곳을 함께 옮겼기 때문이다 — 모듈 통합만 보면 그 회귀를 놓친다.

**🔴 HTTP 통합은 아래 3개가 RED 로 남는 것이 정상이다** (SDD Ruling 3, 2026-09-03). 이 태스크는 `issued_count` 의 **쓰기**를 끊고, **읽기**는 Task 3 이 옮긴다 — 그 사이에 표시 경로는 갱신되지 않는 컬럼을 읽는다. 셋은 Task 3 이 옮길 읽기 세 곳과 정확히 1:1 대응한다:

| 스펙 | 테스트 | 막힌 읽기 |
|---|---|---|
| `coupon-store.spec.ts` | `me/promotions excludes a claim-exhausted claimable coupon (P2-8)` | `isClaimExhausted` |
| `coupon-event.spec.ts` | `store: exhausted claimable → blocked/exhausted` | events 라우트 `resolveState` |
| `coupon-admin.spec.ts` | `GET promotion exposes issued_count in metadata (P2-10)` | `toMetadataShape` |

**정확히 이 셋만 실패해야 한다.** 넷째가 빨가면 그것은 회귀다. 각 테스트 위에 이 시퀀싱을 밝히는 주석을 남긴다. Task 3 이 셋을 초록으로 만든다 — 그전까지 이 브랜치를 머지하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts \
        apps/medusa/src/workflows/coupons/steps/issue-coupon-grants-step.ts \
        "apps/medusa/src/api/admin/customers/[id]/promotions/route.ts" \
        "apps/medusa/src/api/admin/promotions/[id]/customers/route.ts" \
        apps/medusa/integration-tests/http/coupon-store.spec.ts \
        apps/medusa/integration-tests/http/coupon-event.spec.ts \
        apps/medusa/integration-tests/http/coupon-admin.spec.ts
git commit -m "refactor(coupon): 상한 집행을 issued_count 에서 coupon_grant COUNT 로 (결정 1)

원자성의 출처는 카운터 값이 아니라 promotion_meta 행의 배타 락이었다.
FOR UPDATE 로 같은 행을 잠그고 장을 세면 동일한 직렬화를 얻는다.
카운터 mutator 3개와 그 짝을 손으로 밟던 호출부가 사라진다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 3: 상한 «읽기» 를 COUNT 로 전환한다

Task 2 로 `issued_count` 는 더 이상 갱신되지 않는다. 아직 그것을 읽는 4곳을 옮기지 않으면 화면이 얼어붙은 숫자를 보여준다.

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (배치 COUNT 추가)
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts:80`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts:110`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:153`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-detail-dialog.tsx:162-163`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/template/marketing-coupons-template.tsx:50`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Consumes: `countIssuedGrants` (Task 2)
- Produces: `countIssuedGrantsByPromotion(promotionIds: string[]): Promise<Map<string, number>>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
```

기대: `service.countIssuedGrantsByPromotion is not a function` 로 FAIL.

- [ ] **Step 3: 구현한다**

`service.ts` 에 추가:

```ts
  /**
   * 프로모션별 발급 장수를 한 번에 센다. 목록 화면이 프로모션마다 조회하지 않도록.
   * 장이 없는 프로모션도 **0 으로 채워서** 돌려준다 — 호출부가 `undefined` 를 만나
   * `?? null` 로 접으면 「무제한」과 「0장」이 구분되지 않는다.
   */
  async countIssuedGrantsByPromotion(promotionIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>(promotionIds.map((id) => [id, 0]));
    if (promotionIds.length === 0) return result;
    const em = (this as any).baseRepository_.manager_;
    const rows = await em.execute(
      `SELECT "promotion_id", count(*)::int AS c FROM "coupon_grant"
        WHERE "deleted_at" IS NULL AND "promotion_id" IN (?)
        GROUP BY "promotion_id"`,
      [promotionIds],
    );
    for (const row of rows ?? []) {
      result.set(String(row.promotion_id), Number(row.c));
    }
    return result;
  }
```

호출부 4곳을 옮긴다:

- `api/admin/promotions/helpers.ts` 의 `toMetadataShape(record)` — `record.issued_count` 를 싣던 줄(`:80`)을 호출부가 넘겨준 실측 장수로 바꾼다. `helpers.ts` 는 순수 변환 함수이므로 **인자로 받는다**(모듈 서비스를 여기서 부르지 않는다):

  ```ts
  export function toMetadataShape(record: any, issuedCount?: number): Record<string, unknown> | null {
    // ...
    // 🔴 미전달이면 «싣지 않는다». 0 으로 채우면 표시 목적이 아닌 호출부(claim)까지 거짓
    //    숫자를 실어 나른다. 반대로 목록·상세는 항상 숫자를 받으므로 「0장」과 「미측정」이
    //    구분된다 — admin-web 의 coupon-meta.spec.ts 「0 은 없음이 아니다」가 이에 의존한다.
    if (issuedCount != null) result.issued_count = issuedCount;
  ```

  **호출부는 셋이고, 앞의 둘만 카운트를 넘긴다** (SDD Ruling 2, 2026-09-03):

  | 호출부 | 카운트 전달 |
  |---|---|
  | `api/admin/promotions/route.ts:5` (목록) | ✅ `countIssuedGrantsByPromotion` 결과 |
  | `api/admin/promotions/[id]/route.ts` (`fetchPromotionWithMeta` 경유, 상세) | ✅ `countIssuedGrants` 결과 |
  | `api/store/customers/me/promotions/[id]/claim/route.ts` | ❌ 넘기지 않는다 (표시 목적이 아니다) |
- `api/store/events/[slug]/route.ts:110` — `Number(meta?.issued_count ?? 0) >= max` 를 `counts.get(promotionId) ?? 0 >= max` 로. 라우트 상단에서 이벤트에 담긴 프로모션 id 전부로 `countIssuedGrantsByPromotion` 을 한 번 부른다.
- `api/store/customers/me/promotions/route.ts:153` (`isClaimExhausted`) — 같은 방식. 이 라우트는 Task 5 에서 크게 바뀌므로, 여기서는 `metaById` 옆에 `countById` 를 하나 더 두는 최소 변경만 한다.
- admin-web — `coupon-meta.ts` 의 `issuedCount` 는 서버가 주는 값을 그대로 쓰므로 **코드 변경이 필요 없다**. 대신 잘못된 설명을 고친다:
  - `marketing-coupons-template.tsx:50` 의 주석 「`issued_count` 는 발급 수량 한도(max_claims)가 설정된 경우에만 정확히 집계된다」를 삭제한다 — 더 이상 사실이 아니다.
  - `coupon-detail-dialog.tsx:162-163` 의 단위 `명` 을 `장` 으로 바꾼다. `quantity` 도입 이후 이 숫자는 사람 수가 아니라 장 수다.

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
scripts/local/run-medusa-integration.sh
cd apps/medusa && npx tsc --noEmit
cd apps/admin-web && npx tsc --noEmit
```

기대: 전부 PASS, 타입 에러 0.

**🔴 이 태스크의 진짜 합격 기준은 Task 2 가 RED 로 남긴 3개가 초록이 되는 것이다** (SDD Ruling 3). 셋을 이름으로 확인하고, 각 테스트 위의 「Task 3 까지 RED」 주석도 함께 지운다:

| 스펙 | 테스트 |
|---|---|
| `coupon-store.spec.ts` | `me/promotions excludes a claim-exhausted claimable coupon (P2-8)` |
| `coupon-event.spec.ts` | `store: exhausted claimable → blocked/exhausted` |
| `coupon-admin.spec.ts` | `GET promotion exposes issued_count in metadata (P2-10)` |

이 셋이 초록이 아니면 태스크는 끝난 것이 아니다 — 새 테스트가 통과해도 마찬가지다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src apps/admin-web/src
git commit -m "refactor(coupon): 상한 표시·판정을 grant COUNT 로 (결정 1 읽기 축)

상한 없는 쿠폰의 어드민 발급현황이 언제나 0 이던 결함이 함께 사라진다.
단위도 「명」에서 「장」으로 — quantity 도입 이후 사람 수가 아니다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 4: 회수 마커를 하나로 — `revoked_at`

리뷰 발견 2. 회수가 사용된 장을 남기는데(의도된 것이다), 그 장을 주문 취소가 되살린다.

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts`
- Create: `apps/medusa/src/modules/promotion-meta/migrations/Migration20260904010000.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`revokeGrants`, `restoreGrantsByOrder`, `CouponGrantRow`)
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Consumes: `revokeGrants(promotionId, customerId): Promise<{ revoked: number; remaining: number }>` (시그니처 불변)
- Produces: `CouponGrantRow` 에 `revoked_at: Date | string | null` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
      it('회수된 장은 주문이 취소돼도 되살아나지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_res', max_claims: null });
        await issue('promo_res', 'cus_j', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_res');
        await service.consumeGrantIfUnused(g.id, 'order_res', new Date());
        await service.revokeGrants('promo_res', 'cus_j');

        expect(await service.restoreGrantsByOrder('order_res', new Date())).toEqual(0);

        const after = await service.listGrantsForCustomer('cus_j');
        const mine = after.find((r) => r.id === g.id);
        expect(mine?.used_at).not.toBeNull();
        expect(mine?.revoked_at).not.toBeNull();
      });

      it('회수되지 않은 장은 주문 취소로 되살아난다 (기존 동작 유지)', async () => {
        await service.upsert({ promotion_id: 'promo_ok', max_claims: null });
        await issue('promo_ok', 'cus_k', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_ok');
        await service.consumeGrantIfUnused(g.id, 'order_ok', new Date());

        expect(await service.restoreGrantsByOrder('order_ok', new Date())).toEqual(1);

        const after = await service.listGrantsForCustomer('cus_k');
        expect(after.find((r) => r.id === g.id)?.used_at).toBeNull();
      });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
```

기대: 첫 테스트가 `restoreGrantsByOrder` 가 1 을 돌려줘 FAIL (되살아난다).

- [ ] **Step 3: 구현한다**

모델 `models/coupon-grant.ts` 에 필드 추가:

```ts
      /** 어드민이 이 장을 회수한 시각. 사용된 장은 soft delete 되지 않으므로 이 열이 회수의 유일한 표지다. */
      revoked_at: model.dateTime().nullable(),
```

마이그레이션 `migrations/Migration20260904010000.ts` 생성:

```ts
import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant.revoked_at` — 회수 표지 (설계 결정 3).
 *
 * `deleted_at` 이 「슬롯을 안 점유한다」와 「회수됐다」를 겸하고 있어서, 회수 후에도 남는
 * **사용된** 장을 `restoreGrantsByOrder` 가 되살렸다. 회수 사실을 별도 열로 적는다.
 *
 * `deleted_at` 의 의미와 partial unique 인덱스는 **건드리지 않는다** — 회수 후 재발급이
 * `WHERE deleted_at IS NULL` 조건에 의존한다.
 */
export class Migration20260904010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "revoked_at";`);
  }
}
```

`service.ts` 의 `CouponGrantRow` 에 `revoked_at: Date | string | null;` 추가.

`revokeGrants` — 미사용분 soft delete 는 그대로 두고, **매칭된 전부**에 `revoked_at` 을 찍는다:

```ts
  async revokeGrants(promotionId: string, customerId: string): Promise<{ revoked: number; remaining: number }> {
    const rows = (await (this as any).listCouponGrants({
      promotion_id: promotionId,
      customer_id: customerId,
    })) as CouponGrantRow[];
    if (rows.length === 0) return { revoked: 0, remaining: 0 };
    const now = new Date();
    // 🔴 사용 여부와 무관하게 회수 표지를 찍는다. 사용된 장은 아래 soft delete 대상이 아니라
    //    살아남는데, 그 장을 주문 취소가 되살리는 것을 이 열이 막는다.
    await (this as any).updateCouponGrants(rows.map((g) => ({ id: g.id, revoked_at: now })));
    const unused = rows.filter((g) => g.used_at == null);
    if (unused.length > 0) {
      await (this as any).softDeleteCouponGrants(unused.map((g) => g.id));
    }
    return { revoked: unused.length, remaining: rows.length - unused.length };
  }
```

`restoreGrantsByOrder` 의 필터에 한 줄 추가:

```ts
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      // 🔴 회수된 장은 되살리지 않는다. 어드민이 명시적으로 뺏은 쿠폰이 주문 취소로 돌아오면 안 된다.
      if (g.revoked_at != null) return false;
      if (g.expires_at == null) return true;
      const expiresAt = g.expires_at instanceof Date ? g.expires_at : new Date(g.expires_at);
      return !(now > expiresAt);
    });
```

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
cd apps/medusa && npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta
git commit -m "fix(coupon): 회수한 쿠폰이 주문 취소로 되살아나던 구멍 — revoked_at (결정 3)

deleted_at 이 「슬롯 미점유」와 「회수됨」을 겸해서, 회수 후 살아남는 사용된 장을
restoreGrantsByOrder 가 되돌렸다. 회수 표지를 별도 열로 분리한다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 5: 마이페이지 쿠폰 목록을 grant 에서 유도한다

**Files:**
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:74-80` (링크 조회 제거), `:150-` (assigned 버킷)
- Test: `apps/medusa/integration-tests/http/coupon-store.spec.ts`

**Interfaces:**
- Consumes: `listGrantsForCustomer(customerId): Promise<CouponGrantRow[]>` (기존)
- 링크 의존 제거: `customer.promotions` 를 더 이상 읽지 않는다. `groups.id` 는 그룹 룰 평가에 계속 필요하므로 customer 조회 자체는 **남긴다**.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/integration-tests/http/coupon-store.spec.ts` 에 추가한다. 이 스펙의 기존 헬퍼(`createPromo`, `linkCustomer`, `storeHeaders`, `customerId`, `getContainer`, `seq`)를 그대로 쓴다 — **`linkCustomer` 는 일부러 부르지 않는다.** 그것이 이 테스트의 요점이다:

```ts
    it('링크 없이 grant 만 있는 고객도 마이페이지에서 쿠폰을 본다', async () => {
      const id = await createPromo(`GRANTONLY${seq}`, { visibility: 'assigned_only' });
      // linkCustomer() 를 부르지 않는다 — 장만 있고 링크가 없는 상태를 만든다.
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrantWithSlot({
        promotion_id: id,
        customer_id: customerId,
        issue_key: `${id}:${customerId}:direct:1`,
        issued_via: 'admin_manual',
        expires_at: null,
        now: new Date(),
        max_claims: null,
        enforce_cap: true,
      });

      const res = await api.get('/store/customers/me/promotions', storeHeaders);

      expect(res.status).toEqual(200);
      const assigned = res.data.promotions.filter((p: any) => p.is_assigned);
      expect(assigned.map((p: any) => p.code)).toContain(`GRANTONLY${seq}`);
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
```

기대: `assigned` 가 비어 FAIL — 링크가 없으니 지금 구현은 그 쿠폰을 못 본다.

- [ ] **Step 3: 구현한다**

`route.ts` 의 customer 조회에서 `promotions.*` 필드를 뺀다:

```ts
  // 그룹 룰 평가에 쓰는 groups.id 만 남긴다. 「발급된 쿠폰」은 링크가 아니라 grant 가 정한다
  // (설계 결정 2) — 링크는 (고객, 프로모션)당 1행이라 quantity>1 을 표현하지도 못한다.
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'email', 'groups.id'],
    filters: { id: customerId },
  });
```

grant 조회를 **위로 끌어올려** 프로모션 조회보다 먼저 하고, 발급된 프로모션을 id 로 가져온다:

```ts
  // 발급된 «장» 들. 이것이 「이 고객이 가진 쿠폰」의 정본이다.
  const grants: CouponGrantRow[] = await promotionMetaService.listGrantsForCustomer(customerId);
  const grantedPromotionIds = [...new Set(grants.map((g) => g.promotion_id))];

  const { data: grantedPromotions } = grantedPromotionIds.length > 0
    ? await query.graph({
        entity: 'promotion',
        fields: promotionFields,
        filters: { id: grantedPromotionIds },
      })
    : { data: [] as any[] };
```

`allPromoIds` 를 `grantedPromotions` 기준으로 바꾸고, 기존 `const grants = ...` 중복 선언을 지운다. 마지막으로 assigned 버킷의 출처를 바꾼다:

```ts
  const assignedPromotions = (grantedPromotions || [])
    .filter((promo: any) => isValidPromotion(promo) && !isUsageExhausted(promo))
    .map((promo: any) => {
      assignedPromotionIds.add(promo.id);
      return format(promo, true);
    });
```

`isValidPromotion` 의 「아직 grant 없이 링크만 있는 구식 배정」을 언급하는 주석은 사실이 아니게 되므로 갱신한다 — 이제 이 목록에 오는 모든 항목은 장을 가지고 있다.

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
cd apps/medusa && npx tsc --noEmit
```

기대: 새 테스트 PASS, `coupon-store.spec.ts` 의 기존 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add "apps/medusa/src/api/store/customers/me/promotions/route.ts" \
        apps/medusa/integration-tests/http/coupon-store.spec.ts
git commit -m "refactor(coupon): 마이페이지 쿠폰 목록을 링크가 아니라 grant 에서 유도 (결정 2)

링크는 (고객, 프로모션)당 1행이라 quantity>1 을 표현하지 못한다.
grant 가 있는데 링크가 없어 안 보이던 「유령」이 구조적으로 사라진다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 6: 어드민 «고객별 쿠폰» 목록을 grant 에서 유도한다

`admin/promotions/[id]/customers` 의 GET 은 **이미 grant 기반**이다(`byCustomer`). 링크를 읽는 어드민 GET 은 이 하나뿐이다.

**Files:**
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts:43-72` (GET)
- Test: `apps/medusa/integration-tests/http/coupon-admin.spec.ts`

**Interfaces:**
- Consumes: `listGrantsForCustomer` (기존)
- 링크 의존 제거: `customer.promotions` → grant 의 `promotion_id` 로 프로모션 조회

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/integration-tests/http/coupon-admin.spec.ts` 에 추가한다. 이 스펙의 기존 헬퍼(`createPromo`, `adminHeaders`, `customerId`, `getContainer`, `seq`)를 쓴다:

```ts
    it('링크 없이 grant 만 있는 쌍도 어드민 고객 상세에 뜬다', async () => {
      const promoId = await createPromo(`ADMGRANT${seq}`, { visibility: 'assigned_only' });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrantWithSlot({
        promotion_id: promoId,
        customer_id: customerId,
        issue_key: `${promoId}:${customerId}:direct:1`,
        issued_via: 'admin_manual',
        expires_at: null,
        now: new Date(),
        max_claims: null,
        enforce_cap: true,
      });

      const res = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);

      expect(res.status).toEqual(200);
      expect(res.data.promotions.map((p: any) => p.id)).toContain(promoId);
      expect(res.data.count).toEqual(1);
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
```

기대: `promotions` 가 비어 FAIL.

- [ ] **Step 3: 구현한다**

GET 의 `Promise.all` 을 바꾼다 — customer 는 존재 확인(404)용으로만 남기고, 프로모션은 grant 에서 유도한다:

```ts
  const [{ data: customers }, grants] = await Promise.all([
    query.graph({ entity: 'customer', fields: ['id', 'email'], filters: { id: customerId } }),
    promotionMetaService.listGrantsForCustomer(customerId),
  ]);

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  // 「이 고객이 가진 쿠폰」의 정본은 grant 다 (설계 결정 2). 링크는 읽지 않는다.
  const grantedPromotionIds = [...new Set(grants.map((g) => g.promotion_id))];
  const { data: promotions } = grantedPromotionIds.length > 0
    ? await query.graph({
        entity: 'promotion',
        fields: [
          'id',
          'code',
          'type',
          'status',
          'is_automatic',
          'campaign_id',
          'campaign.campaign_identifier',
          'application_method.id',
          'application_method.type',
          'application_method.value',
          'application_method.target_type',
        ],
        filters: { id: grantedPromotionIds },
      })
    : { data: [] as any[] };
```

이후의 `byPromotion` 집계와 페이지네이션은 그대로 둔다. `customer.promotions` 참조를 지운다.

**주의:** 이 목록은 이제 grant 조회 순서를 따르므로 페이지 사이 순서가 불안정할 수 있다. `promotions` 를 `id` 오름차순으로 정렬한 뒤 `slice` 한다 — Task 8 의 발견 6 과 같은 부류다:

```ts
  const sorted = [...promotions].sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const paginatedPromotions = sorted.slice(offset, offset + limit).map((p: any) => { /* 기존 그대로 */ });
```

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
cd apps/medusa && npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add "apps/medusa/src/api/admin/customers/[id]/promotions/route.ts" \
        apps/medusa/integration-tests/http/coupon-admin.spec.ts
git commit -m "refactor(coupon): 어드민 고객별 쿠폰 목록을 grant 에서 유도 (결정 2)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 7: 링크 쓰기를 제거한다

읽는 곳이 없어졌으니 쓰는 곳을 지운다. 이 태스크가 리뷰 발견 1·5·11 을 동시에 없앤다.

**Files:**
- Modify: `apps/medusa/src/workflows/coupons/workflows/issue-coupon-grant-workflow.ts` (`createRemoteLinkStep` 제거)
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts:313-360` (DELETE 의 링크 조회·dismiss 제거)
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts:333-375` (같은 제거)
- Modify: `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts:88-120` (빠른 경로 복원)
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts`

**Interfaces:**
- Consumes: `revokeGrants` (Task 4 갱신본)
- 워크플로는 이제 **단일 스텝**이다. 보상은 남기되, 실패가 부패가 아니라 부분 성공이 되므로 정합성의 유일한 방어선이 아니다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/integration-tests/http/coupon-grant.spec.ts` 에 추가한다. 이 스펙의 기존 헬퍼(`createPromo`, `svc()`, `adminHeaders`, `storeHeaders`, `customerId`, `seq`)를 쓴다:

```ts
    it('회수는 링크와 무관하게 grant 만으로 끝난다', async () => {
      const promotionId = await createPromo(`REVOKE${seq}`, { visibility: 'assigned_only' });
      await api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: [promotionId] },
        adminHeaders,
      );
      const del = await api.delete(
        `/admin/customers/${customerId}/promotions?promotion_ids=${promotionId}`,
        adminHeaders,
      );
      expect(del.status).toEqual(200);
      expect(del.data.removed).toEqual([{ promotion_id: promotionId, grants: 1 }]);

      const after = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);
      expect(after.data.promotions).toEqual([]);
    });

    it('이미 보유한 고객의 재클레임은 워크플로를 다시 돌리지 않는다', async () => {
      const promotionId = await createPromo(`RECLAIM${seq}`, { visibility: 'claimable' });
      await api.post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders);
      const second = await api.post(
        `/store/customers/me/promotions/${promotionId}/claim`,
        {},
        storeHeaders,
      );
      expect(second.status).toEqual(200);
      expect(second.data.reason).toEqual('already_issued');

      expect(await svc().countIssuedGrants(promotionId)).toEqual(1);
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
```

기대: 두 번째 테스트가 `reason` 불일치로 FAIL (지금은 매번 워크플로를 돈다).

- [ ] **Step 3: 구현한다**

`issue-coupon-grant-workflow.ts` — `createRemoteLinkStep` import 와 호출, 그리고 링크 배열을 만드는 `transform`/`when` 블록을 전부 삭제한다. 워크플로는 `issueCouponGrantsStep` 하나와 그 결과 반환만 남는다. 파일 상단 주석은 **왜 링크가 사라졌는지**로 갱신한다(설계 결정 2 참조).

두 DELETE 라우트 — `ContainerRegistrationKeys.LINK` resolve, `query.graph({ fields: ['id','promotions.id'] })` 로 링크 유무를 보던 블록, `link.dismiss([...]).catch(() => {})` 를 전부 삭제한다. 응답의 `removed` 는 `revokeGrants` 결과만으로 채운다:

```ts
    const { revoked } = await promotionMetaService.revokeGrants(promotionId, customerId);
    // 링크가 없으므로 「지웠다고 보고했는데 안 지워졌다」가 성립하지 않는다 (리뷰 발견 5).
    removed.push({ promotion_id: promotionId, grants: revoked });
```

`claim/route.ts` — 「이미 보유」 빠른 경로를 되살린다. 링크 복구가 목적이었던 우회가 필요 없어졌다:

```ts
  // 이미 쓸 수 있는 장이 있으면 워크플로를 돌리지 않는다. 링크 복구 때문에 매 요청 워크플로를
  // 돌리던 우회는 링크가 사라지면서 근거를 잃었다 (설계 결정 2).
  if (hasUsableGrant(grantsFor(grants, promotionId), now)) {
    return res.status(200).json({ issued: false, reason: 'already_issued' });
  }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh
scripts/local/run-medusa-integration.sh --modules
cd apps/medusa && yarn test:unit
cd apps/medusa && npx tsc --noEmit
```

`src/workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 초록인지 반드시 확인한다 — 워크플로를 건드렸다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src apps/medusa/integration-tests
git commit -m "refactor(coupon): customer↔promotion 링크 쓰기 제거 (결정 2 완료)

발급 워크플로의 createRemoteLinkStep 과 두 DELETE 의 link.dismiss 가 사라진다.
루프 중간 실패가 「보이지 않는 유령」이 아니라 부분 성공이 되므로, 보상은
정합성의 유일한 방어선이 아니게 된다. 클레임 재클릭의 빠른 경로도 복원.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## Task 8: 잔여 정리 — 죽은 백필, `updated_at`, 페이지 내부 정렬

**Files:**
- Delete: `apps/medusa/src/scripts/backfill-issued-count.ts`
- Modify: `apps/medusa/package.json` (해당 script 항목이 있으면 제거)
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts:362-385` (`consumeGrantIfUnused`), `setIssuedCount` 삭제
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts:107-130` (페이지 내부 정렬)
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Removes: `setIssuedCount` (마지막 카운터 mutator)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
      it('consumeGrantIfUnused 는 updated_at 을 갱신한다', async () => {
        await service.upsert({ promotion_id: 'promo_upd', max_claims: null });
        await issue('promo_upd', 'cus_l', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_upd');

        const em = (service as any).baseRepository_.manager_;
        const before = await em.execute(`SELECT "updated_at" FROM "coupon_grant" WHERE "id" = ?`, [g.id]);
        await new Promise((r) => setTimeout(r, 10));
        await service.consumeGrantIfUnused(g.id, 'order_upd', new Date());
        const after = await em.execute(`SELECT "updated_at" FROM "coupon_grant" WHERE "id" = ?`, [g.id]);

        expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
          new Date(before[0].updated_at).getTime(),
        );
      });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
```

기대: `updated_at` 이 그대로라 FAIL.

- [ ] **Step 3: 구현한다**

`consumeGrantIfUnused` 의 원시 SQL SET 절에 한 줄 더한다 (리뷰 발견 12):

```ts
      `UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?, "updated_at" = now()
```

`setIssuedCount` 메서드와 `service.integration.spec.ts` 의 `setIssuedCount reconciles...` 테스트를 삭제한다. `apps/medusa/src/scripts/backfill-issued-count.ts` 를 `git rm` 한다 — 링크 «행» 수로 상한을 덮어써서, 이제 돌리면 상한을 깎는 스크립트다.

`admin/promotions/[id]/customers` GET 에서 `query.graph` 결과를 `paginatedIds` 순서로 되돌린다 (리뷰 발견 6):

```ts
    // query.graph 는 IN(...) 의 순서를 보장하지 않는다. 「최초 발급 시각 순」이라는 주장을
    // 지키려면 여기서 되돌려야 한다.
    const byId = new Map(data.map((c: any) => [c.id, c]));
    customers = paginatedIds.map((id) => byId.get(id)).filter(Boolean) as any[];
```

- [ ] **Step 4: 통과를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --modules
scripts/local/run-medusa-integration.sh
cd apps/medusa && yarn test:unit
cd apps/medusa && npx tsc --noEmit
cd apps/admin-web && npx tsc --noEmit
npm run type-check
npx jest --maxWorkers=2
```

마지막 두 줄은 루트 게이트다 — `apps/medusa` 를 제외하지만, `apps/channel-adapter` 의 쿠폰 지표 스펙이 여기 있다.

- [ ] **Step 5: 커밋**

```bash
git add -A apps/medusa apps/admin-web
git commit -m "chore(coupon): 죽은 백필 삭제 + updated_at·페이지 정렬 (리뷰 발견 6·12)

backfill-issued-count 는 링크 행 수로 상한을 덮어써서, 이제 돌리면 상한을 깎는다.
setIssuedCount 와 함께 삭제한다 — 마지막 카운터 mutator 였다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

## 배포 노트

- **마이그레이션 1건** (`Migration20260904010000`, `revoked_at` 추가). additive 이고 Medusa 컨테이너가 부팅 시 스스로 적용한다.
- **`sst deploy` 한 번에 전부 나간다** — 이 저장소의 SST 는 한 스택이라 앱 사이 배포 순서를 지정할 수 없다. admin-web 과 medusa 의 변경이 같이 나가므로 Task 3 의 단위 표기(`명`→`장`) 와 서버의 COUNT 전환이 어긋날 창이 없다.
- **롤링 배포 중 «혼재 버전 상한 창» — 백필을 돌렸다면 반드시 정합화 SQL 을 이어서 돌릴 것.**

  롤링 배포 중에는 옛 태스크가 카운터(`issued_count`)로, 새 태스크가 `coupon_grant` COUNT 로
  같은 프로모션의 상한을 집행하는 순간이 겹친다. 둘 다 같은 `promotion_meta` 행을
  `FOR UPDATE`/`UPDATE` 로 잠그므로 **경합(lost update)은 없다** — 하지만 두 메커니즘이
  **서로 다른 숫자를 본다.** `issued_count` 가 실제 grant 수보다 낮으면, 그 값을 보는 옛
  태스크는 과소 집계해 상한을 넘겨 발급할 수 있다.

  이 어긋남을 만드는 구체적 경로: Task 1 게이트가 실패해(§ Task 1 Step 3, (A) > 0) 백필
  `medusa exec ./src/scripts/backfill-coupon-grants.ts` 를 처방대로 돌리면, 그 스크립트가
  부르는 `issueGrant`(`backfill-coupon-grants.ts:114`)는 **`issued_count` 를 건드리지
  않는다.** 상한 있는 프로모션마다 백필이 카운터를 실제 grant 수 «아래로» 밀어내는 셈이다
  — 이 정합화를 하던 옛 스크립트(`backfill-issued-count.ts`)는 Task 8 이 산술 오류를 이유로
  이미 지웠다(삭제 자체는 정당했다). 그래서 백필 이후 아무 조치가 없으면 그 창이 열린 채
  `sst deploy` 로 들어가고, 배포가 굴러가는 동안 트래픽을 받는 옛 태스크가 과소 집계된
  카운터로 상한을 새게 판정한다.

  **백필을 돌렸다면 `sst deploy` 를 부르기 전에 반드시 아래 한 방을 이어서 돌린다:**

  ```sql
  UPDATE promotion_meta m SET issued_count =
    (SELECT count(*) FROM coupon_grant g
      WHERE g.promotion_id = m.promotion_id AND g.deleted_at IS NULL);
  ```

  이걸 돌리면 두 메커니즘이 같은 숫자를 보게 되어 창이 완전히 닫힌다. **백필을 돌리지
  않았다면(Task 1 게이트가 (A) = 0 으로 이미 통과했다면) 이 SQL 은 불필요하다** — 카운터가
  애초에 grant 수와 어긋나 있지 않다.

  **Task 1 Step 2 의 쿼리 (C) 는 표시용 숫자가 아니라 이 「혼재 버전 상한 창」 자체의
  크기다** — (C) 가 0행이 아니면 그만큼의 프로모션이 이미 카운터/실제 grant 수가 어긋나
  있고, 그 프로모션들이 위 창의 실제 위험군이다(Task 1 Step 3 도 이 설명으로 갱신했다).

  **쿠폰 기능이 아직 라이브 트래픽을 받지 않는다면 이 위험은 0 이다** — 옛 태스크가
  집행하는 실제 발급 요청 자체가 없으므로 어긋난 카운터를 볼 일이 없다. 운영자가 이 조건을
  스스로 판단해 정합화 SQL 실행 여부를 정할 것.

  **동결 자체는 닫았다 (0단계, PR #778 리뷰 F5).** 위 서술은 「이 PR 이 `issued_count` 쓰기를
  끊는다」를 전제로 했는데, 그러면 백필과 무관하게 **배포 뒤 발급된 장수만큼** 카운터가 실제
  아래로 내려가 롤백 즉시 상한이 샌다. 그래서 `PromotionMetaModuleService.mirrorIssuedCount`
  가 장을 만들고 지우는 그 트랜잭션에서 컬럼을 같은 델타로 따라가게 한다(expand 단계 dual
  write, 상한 있는 프로모션만 — 옛 코드와 같은 의미). 남는 어긋남은 위 백필 경로 하나뿐이고,
  그건 여전히 정합화 SQL 이 맞춘다. 미러는 contract PR 이 컬럼과 함께 지운다.

- **배포 직후 확인 2건:**
  1. 상한 있는 쿠폰의 어드민 발급현황이 Task 1 Step 2 (C) 쿼리가 예고한 값으로 바뀌었는가.
  2. 상한 **없는** 쿠폰의 발급현황이 더 이상 0 이 아닌가 (라이브 결함 ① 해소 확인). **목록
     화면이 아니라 상세 다이얼로그에서 확인한다** — `marketing-coupons-template.tsx` 의
     `IssuanceCell` 은 `max == null` 이면 지금도 `—` 를 그린다(그 컴포넌트는 애초에
     상한 있는 쿠폰만 숫자를 보여주도록 설계됐다). 실제 숫자는
     `coupon-detail-dialog.tsx:163` 의 `N장 (무제한)` 에만 나오고, 그마저도 그 Row 자체가
     `visibility === 'claimable'` 일 때만 렌더된다(`:158`) — 상한 없는 **claimable** 쿠폰을
     골라 상세를 열어야 확인된다.
- **롤백:** Task 7 이후로 링크가 갱신되지 않으므로, 이 계획을 되돌리려면 코드 롤백 후 `medusa exec ./src/scripts/backfill-coupon-grants.ts` 의 역방향이 필요하다. **되돌릴 수 있는 마지막 지점은 Task 6 이다** — Task 7 전에 한 번 배포해 실측하는 편이 안전하다.

## 이 계획 밖 (잊지 말 것)

- **후속 PR (contract phase, 배포 한 사이클 뒤) — 아래를 «한 PR 로 묶는다»** (최종 브랜치 리뷰 권고):
  1. 링크 테이블과 `extraColumns` 4개 제거
  2. `promotion_meta.issued_count` 컬럼 제거 (이 계획으로 읽기 소비자 0) — **함께** `PromotionMetaModuleService.mirrorIssuedCount`(0단계 dual write)와 그 스펙(`issued_count 미러` describe)을 지운다. 컬럼만 지우면 미러 UPDATE 가 부팅 직후부터 던진다
  3. `promotion_issue_log` 테이블 제거 (이 계획 이전부터 죽어 있었고 여전히 참조 0)
  4. `scripts/backfill-coupon-grants.ts` 삭제 — **단, Task 1 게이트가 끝난 뒤에.** 이 스크립트가 링크를 읽는 «마지막» 코드이고, 게이트 실패 시의 복구 수단이다
  5. `coupon-validity.spec.ts` 의 T3 블록(링크 upsert·`extraColumns`·dismiss 특성 테스트, 프로덕션 소비자 0)과 남은 `linkCustomer` 잔재 제거
  6. 클레임 라우트의 200 응답 형태 2종 통일 (`{issued,reason}` vs `{success,promotion_id}`) — 오늘 스토어프론트가 본문을 안 읽어 안전하지만 스펙이 `reason` 을 단언한다
- **고아 링크 행** (Task 7 리뷰 ⚠️): 옛 코드가 쓴 링크 행이 라이브에 남아 있고, 이제 **아무도 지우지 않는다**(회수가 `link.dismiss` 를 부르지 않는다). 아무도 «읽지»도 않으므로 무해하지만, 위 후속 PR 이 테이블을 지울 때까지는 남는다. 그 PR 이 이 정리를 포함하므로 별도 작업은 아니고, **테이블 삭제를 미룰 경우에만** 별도 정리가 필요하다.
- **별도 처리:** 리뷰 발견 4 (`coupon-assign-dialog.tsx:80` 조회 `limit`/`total`), 발견 7 (발급 tri-state 를 네 라우트가 제각각 해석), 발견 13 (`classify-lookup-matches.ts:33` 전화번호 오인)
