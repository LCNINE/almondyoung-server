# 쿠폰 모듈을 깊게 (PR-2) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠폰 소모의 「고르기+CAS」를 모듈 안 SQL 한 문장으로 옮기고, 발급 워크플로가 배치를 받아 verdict 를 돌려주게 해서, 재리뷰 14건 중 F1·F9·F10·F11·F14(+F6 의 매핑분)를 구조로 없앤다.

**Architecture:** `PromotionMetaModuleService` 에 `consumeOneUsableGrant`(FEFO·만료 경계·재호출 멱등성·`FOR UPDATE SKIP LOCKED` 를 한 UPDATE 로) 를 두고 `orderCreated` 훅은 그것만 부른다. `issueCouponGrantWorkflow` 는 `{requests[]}` → `{results[]: verdict}` 로 바뀌어 라우트 넷이 tri-state 를 재해석하지 않고 `.run()` 을 요청당 1회만 돈다. 라우트 응답 계약·마이그레이션은 바꾸지 않는다(클레임 200 본문만 additive 통일).

**Tech Stack:** Medusa 2.13.4 (모듈 서비스 `MedusaService`, `@InjectTransactionManager`/`@MedusaContext`, workflows-sdk), MikroORM `em.execute` 원시 SQL, Postgres, `@medusajs/test-utils` 모듈/HTTP 통합 러너(postgres+redis 필수).

**Spec:** `docs/superpowers/specs/2026-09-03-coupon-module-depth-design.md` — 결정 1~4 와 「하지 않는 것」이 이 계획의 경계다.

## Global Constraints

- **마이그레이션 0.** `coupon_grant`·`promotion_meta` 스키마를 건드리지 않는다.
- **라우트 응답 계약 불변.** 고객축 `{issued: string[], skipped}` · 쿠폰축 `{issued: {customer_id, granted}[], skipped, force}` · 자동발급 `{issued: {promotion_id, code}[], skipped}` · `skipped.reason` 어휘(`inactive|automatic|not_started|expired|group_mismatch|unsupported_rule|max_claims_exceeded|already_issued|customer_not_found|grant_error|public_promotion`) 그대로. 클레임 200 본문만 `{ success: true, promotion_id, issued: boolean, reason?: 'already_issued' }` 로 통일(additive).
- **소모 훅의 자리(`completeCartWorkflow.hooks.orderCreated`)는 옮기지 않는다** — PR-3.
- **`no-duplicate-validate-hooks.unit.spec.ts` 가드**는 소스를 `/(\w+Workflow)\.hooks\.(\w+)\s*\(/g` 로 스캔한다. 훅 등록 줄 `completeCartWorkflow.hooks.orderCreated(` 를 캐스팅 변수로 바꾸거나 주석에 같은 문자열을 적지 말 것.
- **게이트 명령(워크트리 루트에서, 단순 명령으로 — 세션 격리 검사기가 `cd … && { … }` 복합형을 거부한다):**
  - `npx tsc --noEmit -p apps/medusa/tsconfig.json` → **에러 3 이 기준선**(`src/admin/lib/sdk.ts` 2 · `src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts` 1, 이 브랜치 무관). 🔴 `npm --prefix apps/medusa exec -- tsc --noEmit` 은 **루트 tsconfig 를 집어 0 을 낸다** — 쓰지 말 것(2026-09-03 실측).
  - `npm --prefix apps/medusa run test:unit` → 36 suites / 368 tests 기준선
  - `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta` → 152 tests 기준선
  - `scripts/local/run-medusa-integration.sh --testPathPattern coupon-` → 10 suites / 139 tests 기준선(패턴이 실제로는 전 스펙을 돈다 — 그대로 둔다)
  - 통합 러너는 docker compose 의 postgres(5432)·redis(6379) 가 떠 있어야 한다. `apps/medusa/.env` 는 메인 체크아웃으로 심볼릭 링크돼 있다.
- **커밋 메시지 끝에** `Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn` 트레일러.
- 코드 주석은 주변 밀도를 따른다 — 이 모듈은 「왜」를 길게 적는 관례다. 🔴 표기는 어기면 실사고인 것에만.

---

### Task 1: `consumeOneUsableGrant` — 고르기와 CAS 를 한 문장으로

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`consumeGrantIfUnused` 바로 아래에 추가)
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Consumes: `CouponGrantRow`, `txEm(sharedContext)`, 스펙의 `service.createCouponGrants`/`listGrantsForCustomer`/`revokeGrantsByIssueKeys`
- Produces: `consumeOneUsableGrant(input: { promotion_id: string; customer_id: string; order_id: string; now: Date }, sharedContext?: Context<EntityManager>): Promise<string | null>` — Task 3 의 훅이 부른다

- [ ] **Step 1: 실패하는 스펙 6개를 쓴다**

`service.integration.spec.ts` 의 `describe('coupon_grant', …)` 안, `describe('consumeGrantIfUnused', () => {` **바로 앞**에 삽입한다(0단계가 넣은 `issued_count 미러` describe 의 닫힘 뒤). 이 스코프에는 0단계가 둔 `issue` 헬퍼가 있지만 아래는 만료·발급시각을 직접 심어야 해서 `createCouponGrants` 를 쓴다.

```ts
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

```

- [ ] **Step 2: RED 확인**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 6 failed — 전부 `TypeError: service.consumeOneUsableGrant is not a function`. 다른 이유로 빨간 것이 있으면 스펙을 고친다(0단계에서 `issue is not defined` 로 한 번 헛돌았다 — 스코프 확인).

- [ ] **Step 3: 구현**

`service.ts` 의 `consumeGrantIfUnused` 메서드 **바로 아래**에 추가한다:

```ts
  /**
   * 「이 주문에 쓸 장 한 장」을 **고르고 소모한다 — 한 문장으로.** 소모한 장의 id, 없으면 `null`.
   *
   * 옛 구조는 훅이 `selectGrantToConsume`(FEFO) 으로 장을 고른 뒤 `consumeGrantIfUnused(id)` 로
   * 찍었다. 고르기와 CAS 가 다른 층에 있어, 같은 고객의 두 카트가 동시에 완료되면 둘이
   * «결정적으로 같은 장»을 골라 한쪽만 이기고 진 쪽은 다음 장을 시도하지 않았다 — 한 장으로
   * 할인 주문 두 건(PR #778 재리뷰 F1). 선택을 SQL 로 내리면 그 창 자체가 없다:
   *
   * - **FEFO** 는 `ORDER BY expires_at NULLS LAST, issued_at, id` — `grants.ts` 의 옛 정렬과 같다.
   * - **만료 경계(포함)** 는 `expires_at >= now` — `usableGrants` 와 같은 경계여야 카트 게이트와
   *   어긋나지 않는다.
   * - **재호출 멱등성**은 `NOT EXISTS(같은 order_id)` — 엔진이 이 훅을 두 번 불러도 주문당
   *   쿠폰당 한 장이다.
   * - **동시성**은 `FOR UPDATE SKIP LOCKED` — 다른 트랜잭션이 잡은 장은 건너뛰고 다음 장을 잡는다.
   *   장이 하나뿐이면 늦은 쪽은 `null` 이고, 그게 정답이다.
   *
   * `null` 은 「소모할 장이 없다」다 — 발급 개념이 없는 `public` 쿠폰이 대부분이므로 호출부는
   * 경고하지 않는다. `consumeGrantIfUnused(id)` 는 id 로 찍는 원시 연산으로 남는다(백필·스펙
   * 픽스처). **핫패스(주문 생성 훅)는 이 메서드만 부른다.**
   */
  async consumeOneUsableGrant(
    input: { promotion_id: string; customer_id: string; order_id: string; now: Date },
    sharedContext?: Context<EntityManager>,
  ): Promise<string | null> {
    const rows = await this.txEm(sharedContext).execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?, "updated_at" = now()
        WHERE "id" = (
          SELECT "id" FROM "coupon_grant"
           WHERE "promotion_id" = ? AND "customer_id" = ?
             AND "deleted_at" IS NULL AND "used_at" IS NULL
             AND ("expires_at" IS NULL OR "expires_at" >= ?)
             AND NOT EXISTS (
               SELECT 1 FROM "coupon_grant" o
                WHERE o."promotion_id" = ? AND o."customer_id" = ?
                  AND o."order_id" = ? AND o."deleted_at" IS NULL)
           ORDER BY "expires_at" ASC NULLS LAST, "issued_at" ASC, "id" ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING "id"`,
      [
        input.now,
        input.order_id,
        input.promotion_id,
        input.customer_id,
        input.now,
        input.promotion_id,
        input.customer_id,
        input.order_id,
      ],
    );
    const id = rows?.[0]?.id;
    return id != null ? String(id) : null;
  }
```

- [ ] **Step 4: GREEN 확인**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 158 passed (152 + 6), 0 failed.

- [ ] **Step 5: 타입 게이트**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 에러 3(기준선 파일 둘만).

- [ ] **Step 6: Commit**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "feat(coupon): consumeOneUsableGrant — 고르기+CAS 를 SQL 한 문장으로 (PR-2 결정 1)

FEFO·만료 경계·재호출 멱등성·SKIP LOCKED 가 전부 한 UPDATE 에 들어간다. 옛 훅의
고르기/CAS 분리가 만들던 「같은 장을 골라 진 쪽이 포기」(재리뷰 F1) 창이 구조로 사라진다.
모듈 통합 스펙 6건(FEFO·경계·멱등·null 셋·단일 스탬프·SKIP LOCKED 결정적 재현).

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 2: `countIssuedGrantsByPromotion` 도 트랜잭션 컨텍스트를 받는다 (F10)

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`countIssuedGrantsByPromotion`, 현재 ~148행)
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Produces: `countIssuedGrantsByPromotion(promotionIds: string[], sharedContext?: Context<EntityManager>): Promise<Map<string, number>>`

- [ ] **Step 1: 실패하는 스펙**

`describe('PromotionMetaModuleService', …)` 안, 기존 `it('countIssuedGrantsByPromotion 은 한 번의 조회로 프로모션별 장수를 돌려준다', …)` **바로 뒤**에 추가:

```ts
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
```

- [ ] **Step 2: RED 확인**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 1 failed — `expect(inside.get('promo_ctx')).toBe(1)` 에서 `Received: 0` (두 번째 인자가 무시된다). `tsc` 로는 인자 개수 에러가 나지만 러너는 transpile-only 라 실행된다.

- [ ] **Step 3: 구현**

`countIssuedGrantsByPromotion` 을 다음으로 교체한다(독스트링의 「🔴 트랜잭션 밖 읽기 전용이다」 문단을 지우고 이유를 바꾼다):

```ts
  /**
   * 프로모션별 발급 장수를 한 번에 센다. 목록 화면이 프로모션마다 조회하지 않도록.
   * 장이 없는 프로모션도 **0 으로 채워서** 돌려준다 — 호출부가 `undefined` 를 만나
   * `?? null` 로 접으면 「무제한」과 「0장」이 구분되지 않는다.
   *
   * `sharedContext` 는 형제 `countIssuedGrants` 와 같은 이유로 받는다 — 넘기면 그 트랜잭션
   * 안을 읽고, 안 넘기면 저장소 기본 매니저로 떨어진다. 옛 구현은 이 인자를 거부하고 주석으로
   * 「집행 경로에서 부르지 말 것」만 적어 두었는데, 주석은 덫을 표시할 뿐 막지 못한다.
   */
  async countIssuedGrantsByPromotion(
    promotionIds: string[],
    sharedContext?: Context<EntityManager>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>(promotionIds.map((id) => [id, 0]));
    if (promotionIds.length === 0) return result;
    const rows = await this.txEm(sharedContext).execute(
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

- [ ] **Step 4: GREEN + 타입**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta` → 159 passed.
Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 에러 3(기준선).

- [ ] **Step 5: Commit**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "fix(coupon): countIssuedGrantsByPromotion 이 sharedContext 를 받는다 (재리뷰 F10)

형제 countIssuedGrants 와 같은 계약. 주석으로만 막던 「집행 트랜잭션 안에서 부르면 밖을 읽는다」
덫을 없앤다. 실 DB 스펙: 커밋 전 INSERT 가 컨텍스트 있는 호출에만 보인다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 3: 훅은 `consumeOneUsableGrant` 만 부른다 — 선택 코드 삭제

**Files:**
- Modify: `apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts`
- Delete: `apps/medusa/src/workflows/hooks/cart/coupon-usage.ts`, `apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/grants.ts` (`selectGrantToConsume` 삭제 + 헤더 소비자 목록), `apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts` (`describe('selectGrantToConsume — FEFO')` 블록 + import 삭제)

**Interfaces:**
- Consumes: Task 1 의 `consumeOneUsableGrant`
- Produces: 없음 (훅은 등록부일 뿐). 행동 보증은 Task 1 의 모듈 스펙이 진다 — 이 훅에는 HTTP 커버리지가 0이라(카트를 완료하는 쿠폰 스펙이 없다) 얇게 유지하는 것이 방어선이다.

- [ ] **Step 1: 훅 본문을 교체한다**

`record-coupon-usage.ts` 에서 `import { selectGrantIdsToConsume } from './coupon-usage';` 를 지우고, 핸들러의 `try` 블록 안을 다음으로 교체한다(바깥 `catch` 와 헤더 독스트링의 훅 등록 관련 ⚠️ 문단들은 그대로 둔다):

```ts
    try {
      const query = container.resolve<{
        graph: (args: unknown) => Promise<{ data: OrderWithPromotions[] }>;
      }>(ContainerRegistrationKeys.QUERY);
      const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

      const { data: orders } = await query.graph({
        entity: 'order',
        fields: ['id', 'customer_id', 'promotions.id'],
        filters: { id: order_id },
      });
      const found = orders?.[0];
      // 비회원 주문엔 발급 개념이 없다 — 소모할 장도 없다.
      if (!found?.customer_id) return;

      const now = new Date();
      for (const promo of found.promotions ?? []) {
        // 고르기와 CAS 가 모듈 안 «한 문장»이다 (PR-2 결정 1, `consumeOneUsableGrant` 독스트링).
        // FEFO·만료 경계·재호출 멱등성(같은 order_id)·동시성(SKIP LOCKED)을 전부 그 문장이
        // 맡으므로 여기엔 판정이 없다. `null` 은 「소모할 장이 없다」— 발급 개념이 없는 public
        // 쿠폰이 대부분이라 경고하지 않는다. 옛 「이미 사용됐거나 회수됨」 경고는 고르기/CAS
        // 분리가 만들던 상태였고 이제 생기지 않는다.
        await promotionMetaService.consumeOneUsableGrant({
          promotion_id: promo.id,
          customer_id: found.customer_id,
          order_id,
          now,
        });
      }
    } catch (e) {
```

헤더 독스트링에서 `selectGrantIdsToConsume`·`coupon-usage.ts` 를 언급하는 문장(「C1(2026-08-31 최종 리뷰)이 지키던 불변식…」 주석 블록 포함)을 지우고 한 문장으로 바꾼다: `// 「발급된 적 없는 쌍은 절대 만들지 않는다」(C1) 는 UPDATE 만 하는 구조 자체가 지킨다 — 없는 장을 소모할 수 없다.`

- [ ] **Step 2: 선택 코드를 삭제한다**

```bash
git rm apps/medusa/src/workflows/hooks/cart/coupon-usage.ts apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts
```

`grants.ts`: `selectGrantToConsume` 함수와 그 독스트링(「소모할 장 하나를 고른다 — 만료 임박순(FEFO)…」)을 삭제한다. 헤더 독스트링의 「소비자는 7곳이다(…) · 주문 생성 소모 훅(`coupon-usage.ts`) · …」 목록에서 소모 훅 항목을 빼고 「소비자는 6곳이다(2026-09-03, PR-2 가 소모 훅을 뺐다 — 소모는 `service.ts::consumeOneUsableGrant` 가 SQL 로 한다)」로 고친다. `grantsGovernUsage` 독스트링의 「남은 둘은 **소모 훅**…과 **쿠폰 클레임**…」 문단도 소모 훅 부분을 지운다.

`grants.unit.spec.ts`: import 목록에서 `selectGrantToConsume` 를 빼고 `describe('selectGrantToConsume — FEFO', …)` 블록(현재 58행~ 다음 describe 직전)을 통째로 지운다 — 그 행동은 Task 1 의 모듈 스펙 「FEFO — 만료가 이른 장을 먼저…」가 실 DB 로 잇는다.

- [ ] **Step 3: 게이트**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 에러 3(기준선). 남은 참조가 있으면 여기서 잡힌다(`apps/medusa/src/api/admin/promotions/[id]/customers/route.ts:34` 의 주석 언급은 코드가 아니라 남겨도 된다 — 단 `selectGrantToConsume` 이름을 `consumeOneUsableGrant` 로 고쳐 낡지 않게 한다).
Run: `npm --prefix apps/medusa run test:unit` → 35 suites(1 삭제) / 368 − (coupon-usage 7 + FEFO 블록 개수) tests, 0 failed. `no-duplicate-validate-hooks` 가 `orderCreated` 등록을 여전히 **1개**로 세는지 출력에서 확인.
Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-` → 139 passed (계약 불변).

- [ ] **Step 4: Commit**

```bash
git add -A apps/medusa/src/workflows/hooks/cart apps/medusa/src/modules/promotion-meta/grants.ts apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts 'apps/medusa/src/api/admin/promotions/[id]/customers/route.ts'
git commit -m "refactor(coupon): 소모 훅은 consumeOneUsableGrant 만 부른다 — 선택 코드 삭제

selectGrantToConsume(grants.ts)·coupon-usage.ts·그 유닛 스펙을 지운다. 소비자가 훅 하나였고
모듈의 정책이 밖에 나가 있던 자리다(설계 §2 삭제 시험). 행동은 Task 1 모듈 스펙이 잇는다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 4: 쌍둥이 정리 — `issueGrant`·`markGrantUsedIfUnused` 를 백필 안으로

**Files:**
- Modify: `apps/medusa/src/scripts/backfill-coupon-grants.ts` (~114–146행)
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`issueGrant`, `markGrantUsedIfUnused` 삭제)
- Modify: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (세 스펙 삭제: `issueGrant 는 같은 issue_key 두 번째에 duplicate 를 돌려준다 — 던지지 않는다` / `markGrantUsedIfUnused 는 미사용 grant 만 채우고 재호출에도 값이 그대로다` / `markGrantUsedIfUnused 는 grant 가 없으면 not_found 를 돌려준다`)

**Interfaces:**
- Consumes: `issueGrantWithSlot`, `consumeGrantIfUnused`, 생성 메서드 `listCouponGrants`
- Produces: 공개 표면에서 issue 는 `issueGrantWithSlot` 하나, consume 은 `consumeOneUsableGrant`(핫패스) + `consumeGrantIfUnused`(id 원시) 둘

- [ ] **Step 1: 백필 스크립트를 먼저 바꾼다 (삭제 전에 — 그래야 tsc 가 빨갛지 않다)**

`backfill-coupon-grants.ts` 상단 import 에 `CouponGrantRow` 를 더한다: `import type PromotionMetaModuleService, { CouponGrantRow } from '../modules/promotion-meta/service';` (기존 import 형태에 맞춰 `type` 만 추가).

`promotionMetaService.issueGrant({…})` 호출을 다음으로 교체:

```ts
      const result = await promotionMetaService.issueGrantWithSlot({
        promotion_id: l.promotion_id,
        customer_id: l.customer_id,
        issue_key: issueKey,
        issued_via: issuedVia,
        expires_at: l.expires_at ? new Date(l.expires_at) : null,
        now: l.created_at ? new Date(l.created_at) : new Date(),
        // 백필은 상한을 집행하지 않는다 — 옛 링크는 이미 «발급된 사실»이다. `max_claims: null`
        // 이라 카운터 미러도 건드리지 않는다(정합화는 PR 본문의 SQL 한 방이 한다).
        max_claims: null,
        enforce_cap: false,
      });
      if (result === 'duplicate') {
        // 프리로드 이후에 누가 같은 키로 먼저 넣은 경우. 유니크가 여전히 최종 권위다.
        duplicate++;
      } else {
        created++;
      }
      pairsWithGrant.add(pairKey);
```

`promotionMetaService.markGrantUsedIfUnused(…)` 블록을 다음으로 교체(위 주석 「옛 링크가 이미 사용된 장이었다면…」은 유지):

```ts
    if (l.used_at) {
      // 옛 `markGrantUsedIfUnused` 의 본체를 여기로 — 이 스크립트가 유일한 호출자였다. 키로
      // 찾고 「미사용일 때만」은 `consumeGrantIfUnused` 의 SQL 술어가 지킨다(조회를 믿고 덮어쓰지
      // 않는다). 키가 안 맞는 쌍(개통 후 발급분)은 조용히 지나가고 이미 채워진 값은 건드리지
      // 않으므로 몇 번을 불러도 안전하다.
      const [grant] = (await promotionMetaService.listCouponGrants({
        promotion_id: l.promotion_id,
        customer_id: l.customer_id,
        issue_key: issueKey,
      })) as CouponGrantRow[];
      if (grant && grant.used_at == null) {
        const consumed = await promotionMetaService.consumeGrantIfUnused(
          grant.id,
          l.order_id ?? 'legacy',
          new Date(l.used_at),
        );
        if (consumed) usageSynced++;
      }
    }
```

- [ ] **Step 2: 서비스에서 둘을 지운다**

`service.ts` 에서 `issueGrant` 메서드(독스트링 「한 장을 발급한다. **같은 `issue_key` 의 재도착은 예외가 아니라 `'duplicate'` 다.**…」 포함)와 `markGrantUsedIfUnused` 메서드(독스트링 「백필 전용…」 포함)를 삭제한다. `consumeGrantIfUnused` 독스트링 끝에 한 줄 추가: `* 핫패스는 이 메서드가 아니라 `consumeOneUsableGrant` 다 — 이건 id 를 아는 호출자(백필·스펙)의 원시 연산이다.`

- [ ] **Step 3: 죽은 스펙 셋을 지운다**

`service.integration.spec.ts` 의 `it('issueGrant 는 같은 issue_key 두 번째에 duplicate 를 돌려준다 — 던지지 않는다', …)`, `it('markGrantUsedIfUnused 는 미사용 grant 만 채우고 재호출에도 값이 그대로다', …)`, `it('markGrantUsedIfUnused 는 grant 가 없으면 not_found 를 돌려준다', …)` 블록을 삭제한다. duplicate 판정은 `it('중복은 상한보다 먼저 판정된다 — 소진된 쿠폰에 재시도해도 duplicate 다')` 가, 「미사용일 때만」은 `describe('consumeGrantIfUnused')` 가 이미 지킨다.

- [ ] **Step 4: 게이트**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 에러 3(기준선). 스크립트가 컴파일되는 것이 이 태스크의 시험이다.
Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta` → 156 passed (159 − 3), 0 failed.
Run: `grep -rn "issueGrant(\|markGrantUsedIfUnused" apps/medusa/src` → 0건.

- [ ] **Step 5: Commit**

```bash
git add apps/medusa/src/scripts/backfill-coupon-grants.ts apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "refactor(coupon): issueGrant·markGrantUsedIfUnused 삭제 — 백필이 유일한 호출자였다 (PR-2 결정 2)

issue 는 issueGrantWithSlot 하나, consume 은 consumeOneUsableGrant(핫패스)+consumeGrantIfUnused(id 원시).
쌍둥이에 불변식이 한쪽만 걸리던 표면(설계 §1 시험 2)을 줄인다. 백필 스크립트는 contract PR 이 지운다.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 5: 워크플로는 배치를 받고 verdict 를 돌려준다 — 라우트 넷은 그 소비자

**Files:**
- Create: `apps/medusa/src/workflows/coupons/steps/issue-grant-verdict.ts`
- Create: `apps/medusa/src/workflows/coupons/__tests__/issue-grant-verdict.unit.spec.ts`
- Modify: `apps/medusa/src/workflows/coupons/steps/issue-coupon-grants-step.ts` (전체 교체)
- Modify: `apps/medusa/src/workflows/coupons/workflows/issue-coupon-grant-workflow.ts` (타입 export + 독스트링)
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` (POST 루프), `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` (POST 루프), `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts` (루프), `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts` (`.run()` 호출부만 — 응답 본문은 Task 6)
- Create: `apps/medusa/integration-tests/http/coupon-issue-workflow.spec.ts`

**Interfaces:**
- Consumes: `issueGrantWithSlot`, `revokeGrantsByIssueKeys`
- Produces (라우트·Task 6 이 쓴다):
  ```ts
  export type IssueGrantRequest = {
    promotion_id: string; customer_id: string; issue_keys: string[];
    issued_via: IssueTrigger; expires_at: string | null;
    max_claims: number | null; enforce_cap: boolean;
  };
  export type IssueGrantVerdict = 'issued' | 'partial' | 'already_issued' | 'exhausted' | 'error';
  export type IssueGrantResult = {
    promotion_id: string; customer_id: string; verdict: IssueGrantVerdict;
    created: number; duplicated: number; error?: string;
  };
  export type IssueCouponGrantsStepInput = { requests: IssueGrantRequest[] };
  export type IssueCouponGrantsStepResult = { results: IssueGrantResult[] };   // 입력과 같은 순서·길이
  export function verdictOf(created: number, exhausted: boolean): IssueGrantVerdict;
  ```

- [ ] **Step 1: `verdictOf` 의 실패하는 유닛 스펙**

`apps/medusa/src/workflows/coupons/__tests__/issue-grant-verdict.unit.spec.ts`:

```ts
import { verdictOf } from '../steps/issue-grant-verdict';

// 라우트 넷이 제각각 읽던 tri-state({created, duplicated, exhausted})를 한 곳에서 접는다 (PR-2 결정 3).
describe('verdictOf', () => {
  it('만들었고 상한에 안 닿았으면 issued', () => expect(verdictOf(2, false)).toBe('issued'));
  it('만들다 상한에 닿았으면 partial — 라우트는 issued 와 max_claims_exceeded 둘 다 올린다', () =>
    expect(verdictOf(1, true)).toBe('partial'));
  it('하나도 못 만들고 상한이면 exhausted', () => expect(verdictOf(0, true)).toBe('exhausted'));
  it('하나도 안 만들고 상한도 아니면 전부 duplicate — already_issued', () =>
    expect(verdictOf(0, false)).toBe('already_issued'));
});
```

Run: `npm --prefix apps/medusa run test:unit` → 1 suite failed (`Cannot find module '../steps/issue-grant-verdict'`).

- [ ] **Step 2: `verdictOf` 구현**

`apps/medusa/src/workflows/coupons/steps/issue-grant-verdict.ts`:

```ts
/**
 * 발급 요청 하나의 결과를 닫힌 어휘로 접는다 (PR-2 결정 3).
 *
 * 옛 워크플로는 `{created[], duplicated[], exhausted}` 날것을 돌려줬고, 라우트 넷이 그것을
 * 제각각 읽었다 — 고객축·쿠폰축은 「exhausted 면 max_claims_exceeded, created 있으면 issued,
 * 둘 다 아니면 already_issued」, 자동발급은 「duplicated 먼저」, 클레임은 「exhausted 만 409」.
 * 재해석이 넷이면 갈린다. 여기서 한 번 접고 라우트는 표만 본다.
 *
 * - `issued`         created ≥ 1, 상한 안 닿음
 * - `partial`        created ≥ 1 인데 도중에 상한 — 라우트는 issued **와** max_claims_exceeded 둘 다
 * - `exhausted`      created 0, 상한
 * - `already_issued` created 0, 상한 아님 = 전부 duplicate(같은 submit 의 재시도)
 * - `error` 는 여기서 나오지 않는다 — 스텝이 요청 단위 예외를 잡을 때 직접 붙인다.
 */
export type IssueGrantVerdict = 'issued' | 'partial' | 'already_issued' | 'exhausted' | 'error';

export function verdictOf(created: number, exhausted: boolean): IssueGrantVerdict {
  if (created > 0) return exhausted ? 'partial' : 'issued';
  return exhausted ? 'exhausted' : 'already_issued';
}
```

Run: `npm --prefix apps/medusa run test:unit` → 새 suite 4 passed.

- [ ] **Step 3: 워크플로 통합 스펙(RED)**

`apps/medusa/integration-tests/http/coupon-issue-workflow.spec.ts` — HTTP 러너를 쓰지만 라우트가 아니라 워크플로를 직접 돈다(컨테이너가 필요해서다):

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import type PromotionMetaModuleService from '../../src/modules/promotion-meta/service';
import { issueCouponGrantWorkflow } from '../../src/workflows/coupons/workflows/issue-coupon-grant-workflow';

jest.setTimeout(120 * 1000);

// 워크플로가 배치를 받고 verdict 를 돌려준다 (PR-2 결정 3). 라우트 계약은 다른 스펙이 지키므로
// 여기는 워크플로 «자체»의 계약 둘만 본다 — 요청 단위 격리와 verdict 결정.
medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    const svc = () => getContainer().resolve(PROMOTION_META_MODULE) as PromotionMetaModuleService;
    const run = (requests: Parameters<typeof issueCouponGrantWorkflow>[0] extends never ? never : any[]) =>
      issueCouponGrantWorkflow(getContainer()).run({ input: { requests } });

    describe('issueCouponGrantWorkflow — 배치 입력·verdict 출력', () => {
      it('요청 하나의 예외는 그 요청의 error 로 격리되고 나머지는 발급된다', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_ok', max_claims: 5 });
        // promo_wf_bad 는 promotion_meta 행이 없다 — 상한 집행 요청이 오면 lockPromotionForIssue 가
        // fail-closed 로 던진다(서비스 독스트링). 그 예외가 배치를 죽이면 옛 라우트 셋이 지키던
        // 「한 고객의 장애가 나머지를 막지 않는다」가 깨진다.
        const { result } = await run([
          { promotion_id: 'promo_wf_bad', customer_id: 'cus_wf', issue_keys: ['k1'], issued_via: 'admin_manual', expires_at: null, max_claims: 1, enforce_cap: true },
          { promotion_id: 'promo_wf_ok', customer_id: 'cus_wf', issue_keys: ['k1', 'k2'], issued_via: 'admin_manual', expires_at: null, max_claims: 5, enforce_cap: true },
        ]);
        expect(result.results.map((r: any) => r.verdict)).toEqual(['error', 'issued']);
        expect(result.results[0].error).toMatch(/promotion_meta/);
        expect(result.results[1]).toMatchObject({ created: 2, duplicated: 0 });
        expect(await svc().countIssuedGrants('promo_wf_ok')).toBe(2);
      });

      it('verdict 는 created·duplicated·상한으로 결정된다 — issued → already_issued → partial → exhausted', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_v', max_claims: 3 });
        const base = { promotion_id: 'promo_wf_v', issued_via: 'admin_manual', expires_at: null, max_claims: 3, enforce_cap: true };

        const first = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(first.result.results[0]).toMatchObject({ verdict: 'issued', created: 2, duplicated: 0 });

        const again = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(again.result.results[0]).toMatchObject({ verdict: 'already_issued', created: 0, duplicated: 2 });

        const partial = await run([{ ...base, customer_id: 'c2', issue_keys: ['a', 'b'] }]); // 슬롯 1개 남음
        expect(partial.result.results[0]).toMatchObject({ verdict: 'partial', created: 1 });

        const none = await run([{ ...base, customer_id: 'c3', issue_keys: ['a'] }]);
        expect(none.result.results[0]).toMatchObject({ verdict: 'exhausted', created: 0 });

        expect(await svc().countIssuedGrants('promo_wf_v')).toBe(3);
      });
    });
  },
});
```

Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-issue-workflow`
Expected: 2 failed — 옛 스텝은 `input.issue_keys` 를 순회하므로 `requests` 만 있는 입력에서 `TypeError`(undefined is not iterable) 로 워크플로가 던진다.

- [ ] **Step 4: 스텝을 교체한다**

`issue-coupon-grants-step.ts` 전체를 다음으로 교체:

```ts
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import type { IssueTrigger } from '../../../modules/promotion-meta/service';
import { verdictOf, type IssueGrantVerdict } from './issue-grant-verdict';

export type { IssueGrantVerdict };

/** 발급 요청 하나 — (프로모션, 고객) 쌍에 장 N개. */
export type IssueGrantRequest = {
  promotion_id: string;
  customer_id: string;
  /** 발급할 장들의 멱등 키. 길이가 곧 요청 수량이다. */
  issue_keys: string[];
  issued_via: IssueTrigger;
  /**
   * 이 장의 만료. **ISO 문자열이다** — 워크플로 입력은 엔진을 거치며 직렬화될 수 있어
   * `Date` 를 그대로 실어 보내지 않는다. 스텝 안에서 되살린다.
   */
  expires_at: string | null;
  max_claims: number | null;
  enforce_cap: boolean;
};

export type IssueGrantResult = {
  promotion_id: string;
  customer_id: string;
  verdict: IssueGrantVerdict;
  /** 이번 실행이 «실제로 만든» 장수. */
  created: number;
  /** 같은 키가 이미 있어 건너뛴 장수. 재시도의 정상 결과다. */
  duplicated: number;
  /** `verdict === 'error'` 일 때만. 라우트가 로그에 싣는다. */
  error?: string;
};

export type IssueCouponGrantsStepInput = { requests: IssueGrantRequest[] };
/** 입력과 같은 순서·길이. 라우트는 인덱스로 짝짓지 않고 (promotion_id, customer_id) 로 읽는다. */
export type IssueCouponGrantsStepResult = { results: IssueGrantResult[] };

type CompensationData = { promotion_id: string; customer_id: string; issue_keys: string[] }[] | null;

/**
 * 요청 배치를 발급한다. 슬롯 예약은 모듈의 트랜잭션 안에서 함께 일어난다 (ADR-0034 결정 1).
 *
 * **왜 배치인가 (PR-2 결정 3).** 옛 스텝은 (프로모션, 고객) 쌍 하나를 받았고 라우트가 고객마다·
 * 프로모션마다 `.run()` 을 돌렸다 — 대량발급 500명이면 Redis 워크플로 엔진 왕복 500회다. 문서는
 * 커스텀 플로를 워크플로에 두라 하므로 워크플로를 걷는 것이 아니라 입력을 배치로 만든다.
 *
 * **요청 하나의 예외는 그 요청의 `error` 로 격리한다.** 스텝이 던지면 배치 전체가 실패하고 보상이
 * 이번 실행의 «성공한» 장까지 걷어간다 — 라우트 셋이 지키던 「한 고객의 장애가 나머지를 막지
 * 않는다」가 깨진다. 던진 요청이 이미 만든 장은 그 자리에서 되돌린다(옛 단건 워크플로에서
 * 보상이 하던 일).
 *
 * 보상은 **이번 실행이 만든 장만** 되돌린다. `duplicated` 는 이전 제출이 만든 남의 것이라
 * 건드리면 안 된다. 스텝이 던지지 않으므로 사실상 잠든 안전망이지만, 「이번 실행이 만든 것만
 * 되돌린다」는 그 자체로 지켜야 할 불변식이라 남긴다(정본 1벌화 설계 §3 결정 2).
 */
export const issueCouponGrantsStep = createStep(
  'issue-coupon-grants',
  async (input: IssueCouponGrantsStepInput, { container }) => {
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    const now = new Date();

    const results: IssueGrantResult[] = [];
    const compensation: NonNullable<CompensationData> = [];

    for (const req of input.requests) {
      const expiresAt = req.expires_at ? new Date(req.expires_at) : null;
      const created: string[] = [];
      let duplicated = 0;
      let exhausted = false;

      try {
        for (const issueKey of req.issue_keys) {
          const result = await service.issueGrantWithSlot({
            promotion_id: req.promotion_id,
            customer_id: req.customer_id,
            issue_key: issueKey,
            issued_via: req.issued_via,
            expires_at: expiresAt,
            now,
            max_claims: req.max_claims,
            enforce_cap: req.enforce_cap,
          });
          if (result === 'created') {
            created.push(issueKey);
          } else if (result === 'duplicate') {
            duplicated += 1;
          } else {
            // 상한에 닿았다. 남은 수량은 시도하지 않는다 — 어차피 같은 답이다.
            exhausted = true;
            break;
          }
        }
      } catch (e: any) {
        let error = String(e?.message ?? e);
        if (created.length > 0) {
          // 옛 단건 워크플로에선 보상이 하던 일 — 던진 요청이 이미 만든 장은 되돌린다.
          try {
            await service.revokeGrantsByIssueKeys(req.promotion_id, req.customer_id, created);
          } catch (e2: any) {
            error += ` (되감기 실패: ${String(e2?.message ?? e2)})`;
          }
        }
        results.push({
          promotion_id: req.promotion_id,
          customer_id: req.customer_id,
          verdict: 'error',
          created: 0,
          duplicated,
          error,
        });
        continue;
      }

      if (created.length > 0) {
        compensation.push({ promotion_id: req.promotion_id, customer_id: req.customer_id, issue_keys: created });
      }
      results.push({
        promotion_id: req.promotion_id,
        customer_id: req.customer_id,
        verdict: verdictOf(created.length, exhausted),
        created: created.length,
        duplicated,
      });
    }

    return new StepResponse<IssueCouponGrantsStepResult, CompensationData>(
      { results },
      compensation.length > 0 ? compensation : null,
    );
  },
  async (compensation, { container }) => {
    if (!compensation) return;
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    // soft delete 가 곧 슬롯 반환이다 — `countIssuedGrants` 가 `deleted_at IS NULL` 인 장만 세고,
    // 카운터 미러도 같은 트랜잭션에서 따라간다(0단계). 쓴 장은 건드리지 않는다(revokeGrants_ 본체).
    for (const c of compensation) {
      await service.revokeGrantsByIssueKeys(c.promotion_id, c.customer_id, c.issue_keys);
    }
  },
);
```

`issue-coupon-grant-workflow.ts`: import 와 export 를 맞춘다 —

```ts
import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { issueCouponGrantsStep, type IssueCouponGrantsStepInput } from '../steps/issue-coupon-grants-step';

export type { IssueGrantRequest, IssueGrantResult, IssueGrantVerdict } from '../steps/issue-coupon-grants-step';
export type IssueCouponGrantWorkflowInput = IssueCouponGrantsStepInput;
```

독스트링의 첫 문장을 「쿠폰 한 장(또는 여러 장)을 발급한다.」에서 「발급 요청 배치를 처리한다 — 요청당 verdict 하나 (PR-2 결정 3). `.run()` 은 HTTP 요청당 1회다.」로 바꾸고 나머지(링크 스텝이 없는 이유)는 그대로 둔다. `createWorkflow` 본문은 변화 없음.

- [ ] **Step 5: 워크플로 스펙 GREEN**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-issue-workflow` → 2 passed.
Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 라우트 넷이 옛 입력 모양을 넘기므로 **여기서 빨간 것이 정상** — 다음 스텝에서 잡는다.

- [ ] **Step 6: 고객축 라우트 (`customers/[id]/promotions/route.ts` POST)**

import 에 `type IssueGrantRequest, type IssueGrantResult` 를 워크플로 파일에서 추가한다. `const issued: string[] = []; const skipped: … = [];` 아래에 요청 버퍼를 두고, 루프에서 `.run()` 하던 자리를 「요청 쌓기」로 바꾸고, 루프 뒤에 한 번 돈다:

```ts
  const issued: string[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];
  // 게이트를 넘은 프로모션만 여기 쌓여 워크플로를 **한 번** 지난다 (PR-2 결정 3).
  const requests: IssueGrantRequest[] = [];
  // 키는 이 «제출»과 수량에만 달려 있다 — 프로모션마다 같으므로 한 번만 만든다.
  const issueKeys = Array.from({ length: quantity }, (_, i) => `${submitId}:${i + 1}`);

  for (const promo of promotions as any[]) {
    // … 기존 게이트들(public_promotion / inactive / automatic / not_started / expired / eligibility) 그대로 …

    const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;
    requests.push({
      promotion_id: promo.id,
      customer_id: customerId,
      issue_keys: issueKeys,
      issued_via: issueTrigger,
      expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
      max_claims: maxClaims,
      enforce_cap: !force,
    });
  }

  // 발급은 워크플로다 (ADR-0034 결정 1). 요청 하나의 예외는 그 요청의 `error` 로 격리돼 돌아오므로
  // 여기 try/catch 는 «워크플로 자체»가 죽은 경우만 남는다 — 그땐 500 이 맞다(아무것도 발급 전).
  const results: IssueGrantResult[] =
    requests.length > 0
      ? (await issueCouponGrantWorkflow(req.scope).run({ input: { requests } })).result.results
      : [];

  for (const r of results) {
    switch (r.verdict) {
      case 'issued':
        issued.push(r.promotion_id);
        break;
      case 'partial':
        // 상한에 걸려 «일부만» 발급됐다 — 옛 루프처럼 두 보고를 함께 올린다.
        issued.push(r.promotion_id);
        skipped.push({ promotion_id: r.promotion_id, reason: 'max_claims_exceeded' });
        break;
      case 'exhausted':
        skipped.push({ promotion_id: r.promotion_id, reason: 'max_claims_exceeded' });
        break;
      case 'already_issued':
        // 같은 submit_id 로 이미 전량 발급된 재시도 — 「응답에 없는 항목」이 되지 않게 한다.
        skipped.push({ promotion_id: r.promotion_id, reason: 'already_issued' });
        break;
      case 'error':
        // 🔴 원인을 반드시 남긴다 — 사유만 `grant_error` 로 돌려주면 진단할 근거가 없다.
        logger.error(
          `[coupon] 수동발급 grant_error (promotion_id=${r.promotion_id}, customer_id=${customerId}, ` +
            `submit_id=${submitId}): ${r.error}`,
        );
        skipped.push({ promotion_id: r.promotion_id, reason: 'grant_error' });
        break;
    }
  }
```

옛 루프 안의 `const issueKeys = …` / `let outcome …` / `try { … .run() … } catch` / `if (outcome.exhausted) … else if …` 블록은 전부 지운다. 응답 `return res.status(200).json({ success: true, message: …, customer_id, issued, skipped, force })` 는 그대로.

- [ ] **Step 7: 쿠폰축 라우트 (`promotions/[id]/customers/route.ts` POST)**

같은 모양 — 축만 고객이다. `const issued: { customer_id: string; granted: number }[] = []; const skipped … = [];` 아래:

```ts
  const requests: IssueGrantRequest[] = [];
  const issueKeys = Array.from({ length: qty }, (_, i) => `${submit_id}:${i + 1}`);
  const expiresAt = computeExpiresAt(meta, now)?.toISOString() ?? null;

  for (const customerId of customer_ids) {
    // … customer_not_found / eligibility 게이트 그대로 …
    requests.push({
      promotion_id: promotionId,
      customer_id: customerId,
      issue_keys: issueKeys,
      issued_via: issueTrigger,
      expires_at: expiresAt,
      max_claims: maxClaims,
      enforce_cap: !force,
    });
  }

  const results: IssueGrantResult[] =
    requests.length > 0
      ? (await issueCouponGrantWorkflow(req.scope).run({ input: { requests } })).result.results
      : [];

  for (const r of results) {
    switch (r.verdict) {
      case 'issued':
        issued.push({ customer_id: r.customer_id, granted: r.created });
        break;
      case 'partial':
        issued.push({ customer_id: r.customer_id, granted: r.created });
        skipped.push({ customer_id: r.customer_id, reason: 'max_claims_exceeded' });
        break;
      case 'exhausted':
        skipped.push({ customer_id: r.customer_id, reason: 'max_claims_exceeded' });
        break;
      case 'already_issued':
        skipped.push({ customer_id: r.customer_id, reason: 'already_issued' });
        break;
      case 'error':
        logger.error(
          `[coupon] 대량발급 grant_error (promotion_id=${promotionId}, customer_id=${r.customer_id}, ` +
            `submit_id=${submit_id}): ${r.error}`,
        );
        skipped.push({ customer_id: r.customer_id, reason: 'grant_error' });
        break;
    }
  }
```

`const maxClaims = …` 는 이미 루프 위에 있다. 옛 루프 안의 `.run()`·`outcome` 분기·`issueKeys` 재생성을 지운다. 응답 불변.

- [ ] **Step 8: 자동발급 라우트 (`customers/[id]/issue-coupons/route.ts`)**

`const failed: string[] = [];` 아래 `const requests: IssueGrantRequest[] = [];` 를 두고, 루프에서 게이트를 넘은 프로모션을 쌓는다(`code` 는 결과 매핑에 필요하니 `codeById` 맵을 함께 만든다):

```ts
  const requests: IssueGrantRequest[] = [];
  const codeById = new Map<string, string>();

  for (const promo of promotions as any[]) {
    // … public_promotion / window / eligibility 게이트 그대로 …
    codeById.set(promo.id, promo.code);
    requests.push({
      promotion_id: promo.id,
      customer_id: customerId,
      // 트리거당 한 장. 결정적 키라 channel-adapter 재시도가 멱등하다.
      issue_keys: [`trigger:${trigger}`],
      issued_via: trigger,
      expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
      max_claims: meta.max_claims != null ? Number(meta.max_claims) : null,
      enforce_cap: true,
    });
  }

  const results: IssueGrantResult[] =
    requests.length > 0
      ? (await issueCouponGrantWorkflow(req.scope).run({ input: { requests } })).result.results
      : [];

  for (const r of results) {
    switch (r.verdict) {
      case 'already_issued':
        skipped.push({ promotion_id: r.promotion_id, reason: 'already_issued' });
        break;
      case 'exhausted':
        skipped.push({ promotion_id: r.promotion_id, reason: 'max_claims_exceeded' });
        break;
      case 'issued':
      case 'partial': // 키가 하나라 partial 은 나올 수 없지만, 어휘가 닫혀 있으니 같은 칸에 둔다
        issued.push({ promotion_id: r.promotion_id, code: codeById.get(r.promotion_id) ?? '' });
        break;
      case 'error':
        logger.error(
          `[coupon] 자동발급 실패 (promotion_id=${r.promotion_id}, customer_id=${customerId}, ` +
            `trigger=${trigger}): ${r.error}`,
        );
        failed.push(r.promotion_id);
        break;
    }
  }
```

루프 뒤 `if (failed.length > 0) throw UNEXPECTED_STATE` 와 200 응답은 **그대로**(500 정책은 channel-adapter 계약 — 설계 §4). 옛 루프 안의 「발급과 표시용 링크를 한 워크플로로…」 주석 블록은 낡았으니 지우고, 「실패를 모아서 마지막에 던지는 이유」 문단은 남긴다.

- [ ] **Step 9: 클레임 라우트 호출부 (`claim/route.ts`)**

`.run()` 호출과 그 뒤 분기를 다음으로 바꾼다 — **응답 본문은 이 태스크에서 바꾸지 않는다**(Task 6):

```ts
  const {
    result: { results: [outcome] },
  } = await issueCouponGrantWorkflow(req.scope).run({
    input: {
      requests: [
        {
          promotion_id: promotionId,
          customer_id: customerId,
          issue_keys: ['claim'], // 클레임은 영구 1장 — 따닥 방어가 DB 레벨이다.
          issued_via: 'customer_claim',
          expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
          max_claims: maxClaims,
          enforce_cap: true,
        },
      ],
    },
  });

  if (outcome.verdict === 'error') {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `클레임 발급 실패: ${outcome.error}`);
  }
  if (outcome.verdict === 'exhausted') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
  }

  // `already_issued` 든 `issued` 든 200 이다 — 재클릭은 성공으로 보이는 것이 맞고, 슬롯 증가는
  // 중복일 때 트랜잭션과 함께 되감겼다(따닥 한 번에 2명분이 소진되지 않는다).
  return res.status(200).json({ success: true, promotion_id: promotionId });
```

- [ ] **Step 10: 게이트**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 에러 3(기준선).
Run: `npm --prefix apps/medusa run test:unit` → 0 failed.
Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-` → 11 suites(+워크플로 스펙) / 141 tests(139 + 2), 0 failed. 특히 `coupon-grant.spec.ts` 의 「전량 duplicate 인 재시도는 skipped(already_issued)」 둘과 `coupon-admin.spec.ts` 의 「manual assign is batch-resilient」가 초록이어야 계약 불변이 증명된다.
Run: `grep -rn "issueCouponGrantWorkflow(req.scope).run" apps/medusa/src/api | wc -l` → 4 (라우트당 정확히 한 호출).

- [ ] **Step 11: Commit**

```bash
git add apps/medusa/src/workflows/coupons apps/medusa/src/api/admin/customers apps/medusa/src/api/admin/promotions apps/medusa/src/api/store/customers/me/promotions apps/medusa/integration-tests/http/coupon-issue-workflow.spec.ts
git commit -m "refactor(coupon): 발급 워크플로는 배치를 받고 verdict 를 돌려준다 (PR-2 결정 3)

.run() 이 HTTP 요청당 1회(대량발급 500→1). 요청 단위 예외는 그 요청의 error 로 격리 — 스텝이
던지면 보상이 성공분까지 걷는다. 라우트 넷은 verdictOf 가 접은 어휘의 소비자가 되어 tri-state
재해석(재리뷰 F6 매핑·F14 issueKeys 재생성·F9 왕복)이 사라진다. 응답 계약 불변.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 6: 클레임 200 본문을 한 모양으로 (F11)

**Files:**
- Modify: `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts` (빠른 경로 반환 + 마지막 반환)
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts` (「이미 보유한 고객의 재클레임…」·「이미 쓴 장을 가진 고객의 재클레임…」)

**Interfaces:**
- Produces: 클레임 200 본문 `{ success: true, promotion_id: string, issued: boolean, reason?: 'already_issued' }`

- [ ] **Step 1: 실패하는 단언**

`coupon-grant.spec.ts` 「이미 보유한 고객의 재클레임은 워크플로를 다시 돌리지 않는다」에서 첫 클레임을 변수로 받아 단언을 추가하고, 재클레임 단언을 전체 본문 비교로 바꾼다:

```ts
        const first = await api.post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders);
        // 두 경로(빠른 경로 / 원자 경로)의 200 본문이 한 모양이다 (PR-2 결정 4). 스토어프론트는
        // 본문을 안 읽지만(claimCoupon: Promise<void>), 읽는 소비자가 생겼을 때 `success` 와
        // `reason` 이 경로에 따라 undefined 로 갈리면 성공한 재클릭이 실패로 렌더된다.
        expect(first.data).toEqual({ success: true, promotion_id: promotionId, issued: true });
        const second = await api.post(
          `/store/customers/me/promotions/${promotionId}/claim`,
          {},
          storeHeaders,
        );
        expect(second.status).toEqual(200);
        expect(second.data).toEqual({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
```

「이미 쓴 장을 가진 고객의 재클레임은 쿠폰이 소진돼 있어도 200 이다」의 `expect(second.status).toEqual(200);` 뒤에 추가:

```ts
        // 이 재클릭은 빠른 경로가 아니라 원자 경로의 duplicate 다 — 그래도 본문은 같은 모양이어야 한다.
        expect(second.data).toEqual({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
```

Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-grant`
Expected: 2 failed — 첫 클레임 본문에 `issued` 가 없고, 원자 경로 duplicate 본문에 `issued`·`reason` 이 없다.

- [ ] **Step 2: 라우트 두 반환을 고친다**

빠른 경로:

```ts
  if (hasUsableGrant(myGrants, now)) {
    return res.status(200).json({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
  }
```

마지막 반환(Task 5 Step 9 의 것):

```ts
  // 200 본문은 빠른 경로와 **같은 모양**이다 (PR-2 결정 4). `issued` 가 이번 클릭이 장을 만들었는지,
  // `reason` 은 안 만들었을 때만 붙는다. 재클릭은 성공으로 보이는 것이 맞고, 슬롯 증가는 중복일 때
  // 트랜잭션과 함께 되감겼다(따닥 한 번에 2명분이 소진되지 않는다).
  if (outcome.verdict === 'already_issued') {
    return res.status(200).json({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
  }
  return res.status(200).json({ success: true, promotion_id: promotionId, issued: true });
```

- [ ] **Step 3: GREEN + 전체**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-grant` → 0 failed.
Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-` → 141 passed.
Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 에러 3(기준선).

- [ ] **Step 4: Commit**

```bash
git add 'apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts' apps/medusa/integration-tests/http/coupon-grant.spec.ts
git commit -m "fix(coupon): 클레임 200 본문을 한 모양으로 — {success, promotion_id, issued, reason?} (재리뷰 F11)

빠른 경로 {issued:false, reason} 와 원자 경로 {success, promotion_id} 가 갈려 있었다. 두 소비자
(스토어프론트 claimCoupon 둘)는 본문을 안 읽으므로 additive.

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 7: ADR-0034 보강 + 마무리 검증

**Files:**
- Modify: `docs/adr/0034-coupon-issuance-writes-go-through-workflows.md` (끝에 절 추가)
- Modify: `docs/superpowers/plans/2026-09-03-coupon-single-source-of-truth.md` 「이 계획 밖」의 contract PR 목록 항목 4(백필 스크립트 삭제)에 「Task 4 가 옮긴 `markGrantUsedIfUnused` 본체도 같이 사라진다」 한 줄

- [ ] **Step 1: ADR 보강**

`0034-…md` 끝에 추가:

```markdown
## 2026-09-03 보강 — 결정 1 은 소모 seam 에도, 결정 3 은 verdict 로

PR #778 머지 직전 재리뷰 14건을 세 시험(접기의 2차 미분 / 인터페이스 폭 대 불변식 / 매단 자리의
문서 정당성)으로 판정한 결과는 `docs/superpowers/specs/2026-09-03-coupon-module-depth-design.md` 에
있다. 이 ADR 에 닿는 결론 둘:

- **결정 1 「조건부 쓰기는 술어를 SQL 에 적는다」는 소모의 «선택»에도 적용된다.** `consumeGrantIfUnused(id)`
  는 술어를 SQL 에 두었지만 *어느 id 인지*는 훅이 골랐다 — 고르기와 CAS 가 다른 층에 있어 같은
  고객의 두 카트가 같은 장을 골랐다. `consumeOneUsableGrant` 가 FEFO·만료 경계·재호출 멱등성·
  `FOR UPDATE SKIP LOCKED` 를 한 UPDATE 로 묶는다. 핫패스는 이것만 부른다.
- **결정 3 「라우트에는 정책 게이트·워크플로 호출·응답 모양만」은 워크플로 출력이 날것이면 지켜지지
  않는다.** `{created[], duplicated[], exhausted}` 를 라우트 넷이 제각각 접었다. 워크플로가 요청
  배치를 받아 요청당 `verdict`(`issued|partial|already_issued|exhausted|error`) 를 돌려주고,
  `.run()` 은 HTTP 요청당 1회다. 요청 하나의 예외는 그 요청의 `error` 로 격리한다 — 스텝이 던지면
  보상이 성공분까지 걷는다.

**결정 2 의 매단 자리(`orderCreated`)는 미문서 훅이다** — `completeCartWorkflow` 레퍼런스는 `validate`
하나만 노출한다. 그 이전은 별도 결정(PR-3)이며 이 ADR 의 개정으로 다룬다. 후보와 스파이크 항목은
위 설계 문서 §6.
```

- [ ] **Step 2: 전체 게이트 최종**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json` → 3(기준선, 변경 파일 0).
Run: `npm --prefix apps/medusa run test:unit` → 0 failed.
Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta` → 156 passed.
Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-` → 141 passed.
Run: `cd apps/admin-web && npx tsc --noEmit` 은 **불필요** — admin-web 파일은 이 PR 에서 하나도 바뀌지 않는다(`git diff --stat develop -- apps/admin-web` 이 비어 있는지 확인).

- [ ] **Step 3: Commit + PR**

```bash
git add docs/adr/0034-coupon-issuance-writes-go-through-workflows.md docs/superpowers/plans/2026-09-03-coupon-single-source-of-truth.md
git commit -m "docs(coupon): ADR-0034 보강 — 결정 1 은 소모 seam 에, 결정 3 은 verdict 로 (PR-2)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

PR 본문에 넣을 것: 설계 문서 링크 · 해소한 지적(F1·F9·F10·F11·F14·F6 매핑분) · **마이그 0·응답 계약 불변(클레임 본문 additive)** · 배포 순서 제약 없음 · 남은 것(PR-3 소모 seam / F4·F7 user-service / F8·F13 후속) · 게이트 실측 4줄. 본문 끝에 `https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn`.

---

## Self-review (계획 작성 후 점검)

- **스펙 커버리지.** 결정 1 → Task 1·3. 결정 2 → Task 4(+ 0단계의 revoke 통일, Task 2 의 count). 결정 3 → Task 5. 결정 4 → Task 6. §4 「하지 않는 것」은 어느 태스크도 건드리지 않는다(자동발급 500 정책 유지 — Task 5 Step 8 명시).
- **플레이스홀더.** 「기존 게이트들 그대로」는 라우트의 현재 코드를 가리키며 삭제 대상만 열거했다 — 실행자는 해당 파일을 열고 게이트 블록을 보존한다. 코드 스텝은 전부 코드 블록을 갖는다.
- **타입 일관성.** `IssueGrantRequest`/`IssueGrantResult`/`verdictOf` 이름·시그니처가 Task 5 정의와 라우트 사용에서 같다. `consumeOneUsableGrant` 의 입력 객체 키(`promotion_id, customer_id, order_id, now`)가 Task 1 스펙·구현·Task 3 훅에서 같다. `countIssuedGrantsByPromotion(ids, sharedContext?)` 는 Task 2 만 건드리고 호출자 셋(admin 목록·이벤트·마이페이지)은 인자 하나로 그대로 동작한다.
- **기준선 숫자.** 모듈 152 → +6(T1) +1(T2) −3(T4) = 156. HTTP 139 → +2(T5) = 141. 유닛은 T3 삭제(7 + FEFO 블록)와 T5 추가(4)로 바뀐다 — 정확한 수는 실행 시 기록한다.
