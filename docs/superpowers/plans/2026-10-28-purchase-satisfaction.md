# 구매 만족도 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 완료 화면의 별점 카드가 실제로 저장되고, 3점 이하는 사유·메모를 받고, 어드민이 모아 보고 확인 처리한다.

**Architecture:**
storefront → Medusa 새 고객 라우트(주문 주인 확인) → ugc-service 내부 API(저장).
어드민은 ugc-service 어드민 API 를 직접 부른다.

**Tech Stack:** NestJS + Drizzle(ugc-service), Medusa v2 custom route, Next.js(storefront, admin-web), jest / vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-purchase-satisfaction-design.md`

---

## Global Constraints

- 사유 코드와 문구는 스펙 표 그대로, 순서도 그대로다.
  `ADDRESS_INPUT` 배송지 입력이 불편했어요
  `COUPON_DISCOUNT` 쿠폰·할인 적용이 어려웠어요
  `CASH_RECEIPT` 현금영수증 신청이 어려웠어요
  `PAYMENT_METHOD` 결제 수단이 불편했어요
  `PAYMENT_ERROR` 결제 중 오류가 났어요
  `PRODUCT_SEARCH` 원하는 상품을 찾기 어려웠어요
  `OTHER` 기타
- 메모 최대 300자. 별점은 정수 1~5.
- 사유·메모는 3점 이하에서만 받는다. 4점 이상으로 저장하면 비운다.
- 주문 하나에 응답 하나(UNIQUE `order_id`).
- 주문 주인 확인은 Medusa 가 한다. 주문번호·사용자 id 는 클라이언트 값을 쓰지 않는다.
- 고객 문구는 스펙의 문구를 글자 그대로 쓴다.
- 주석: 설명 주석 금지, 주석에 이슈 번호 금지, 특수 인용부호(겹화살괄호, 낫표, 겹낫표) 금지.
- jest 는 항상 `--maxWorkers=2` (최대 4). 전체 스위트는 마지막 태스크에서만.
- 각 태스크 끝에서 이 브랜치(`feat/purchase-satisfaction`)에 커밋하고 push 한다.

## Review Focus

1. 남의 주문 id 로 Medusa 라우트를 부르면 404 여야 한다(저장도 조회도). → Task 3 테스트.
2. 별점을 4점 이상으로 바꾸면 이전에 남긴 사유·메모가 사라져야 한다. → Task 1 테스트.
3. 이미 확인 처리된 응답의 내용이 바뀌면 다시 확인 전이 돼야 한다. 같은 내용 재저장은 확인 상태를 유지한다. → Task 1 테스트.
4. 어드민 기간 필터는 KST 날짜 경계로 자른다(UTC 로 자르면 오전 9시 전 응답이 전날로 간다). → Task 2 테스트.
5. 저장 실패(ugc 장애) 시 고객 카드는 별 선택을 되돌리고 실패 문구를 띄운다. → Task 4 테스트.

---

## 파일 지도

| 영역 | 파일 | 역할 |
|---|---|---|
| ugc | `apps/ugc-service/src/db/schema.ts` | `purchaseSatisfactions` 테이블 |
| ugc | `apps/ugc-service/src/db/<ts>_add-purchase-satisfactions.sql` | 생성된 마이그레이션 |
| ugc | `apps/ugc-service/src/purchase-satisfaction/types.ts` | 사유 코드 상수·타입 |
| ugc | `.../purchase-satisfaction/purchase-satisfaction.manager.ts` | 저장 규칙, 확인 처리 |
| ugc | `.../purchase-satisfaction/purchase-satisfaction.reader.ts` | 단건, 목록, 요약 집계 |
| ugc | `.../purchase-satisfaction/purchase-satisfaction.service.ts` | 흐름만 |
| ugc | `.../purchase-satisfaction/controllers/internal-purchase-satisfaction.controller.ts` | Medusa 전용 |
| ugc | `.../purchase-satisfaction/controllers/admin-purchase-satisfaction.controller.ts` | 어드민 |
| ugc | `.../purchase-satisfaction/dto/*.ts`, `mappers/*.ts`, `purchase-satisfaction.module.ts` | |
| 권한 | `libs/authorization/src/permissions/permission-catalog.ts` | `cs.satisfaction.read` / `.manage` |
| Medusa | `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/route.ts` | GET, PUT |
| Medusa | `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/handlers.ts` | 주인 확인 + ugc 호출 |
| Medusa | `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/validators.ts` | zod |
| Medusa | `apps/medusa/src/api/middlewares.ts` | authenticate + body 검증 |
| storefront | `src/lib/api/medusa/purchase-satisfaction.ts` | 서버 액션 2개 |
| storefront | `src/app/[countryCode]/(checkout)/checkout/success/_components.tsx` | `PurchaseSatisfactionCard` |
| storefront | `.../success/[intentId]/page.tsx` | 카드 연결 |
| admin-web | `src/lib/api/domains/purchase-satisfaction/index.ts` | API 클라이언트 |
| admin-web | `src/lib/services/purchase-satisfaction/{queries,mutations,query-keys,index}.ts` | 훅 |
| admin-web | `src/features/cs/purchase-satisfaction/**` | 목록 화면 |
| admin-web | `src/app/(admin)/cs/purchase-satisfaction/page.tsx`, `menu.ts`, `screen-access.ts` | 라우트 |
| admin-web | `src/features/order/history/components/table/index.tsx` | 주문 상세 패널 섹션 |

---

### Task 1: ugc 저장소와 Medusa 전용 내부 API

**Files:**
- Modify: `apps/ugc-service/src/db/schema.ts`
- Create: 마이그레이션 (`npm run db:generate:ugc-service -- --name add-purchase-satisfactions`)
- Create: `apps/ugc-service/src/purchase-satisfaction/` 아래 `types.ts`, `purchase-satisfaction.manager.ts`, `purchase-satisfaction.reader.ts`(단건만), `purchase-satisfaction.service.ts`, `controllers/internal-purchase-satisfaction.controller.ts`, `dto/upsert-purchase-satisfaction.dto.ts`, `dto/purchase-satisfaction-response.dto.ts`, `mappers/purchase-satisfaction.mapper.ts`, `purchase-satisfaction.module.ts`
- Modify: `apps/ugc-service/src/ugc-service.module.ts` (imports 에 모듈 추가)
- Test: `apps/ugc-service/src/purchase-satisfaction/__tests__/purchase-satisfaction.manager.spec.ts`

**Interfaces:**
- Produces
  - `PURCHASE_SATISFACTION_REASONS` (Global Constraints 순서의 `as const` 배열), `type PurchaseSatisfactionReason`
  - `class UpsertPurchaseSatisfactionDto { userId: string /*uuid*/; orderDisplayId: number /*int ≥1*/; rating: number /*int 1~5*/; reasons?: PurchaseSatisfactionReason[] /*중복 없음*/; memo?: string /*≤300*/ }`
  - `class PurchaseSatisfactionResponseDto { id; orderId; orderDisplayId; userId; rating; reasons: PurchaseSatisfactionReason[]; memo: string | null; checkedAt: string | null; checkedBy: string | null; createdAt: string; updatedAt: string }`
  - `PurchaseSatisfactionManager.upsert(orderId: string, dto: UpsertPurchaseSatisfactionDto, tx?: UgcTx): Promise<PurchaseSatisfactionRow>`
  - `PurchaseSatisfactionReader.findByOrderId(orderId: string, tx?: UgcTx): Promise<PurchaseSatisfactionRow>` (없으면 `NotFoundError`)
  - HTTP (둘 다 `@UgcInternalAuth()`):
    `PUT /purchase-satisfactions/internal/orders/:orderId` body = `UpsertPurchaseSatisfactionDto` → 200 `PurchaseSatisfactionResponseDto`
    `GET /purchase-satisfactions/internal/orders/:orderId` → 200 `PurchaseSatisfactionResponseDto` / 404

**테이블** (스펙 표 그대로, ugc 관례 따름)
- `timestampColumns` 재사용(timezone 없음, ugc 다른 테이블과 같음).
- `checkedAt: timestamp('checked_at')`, `checkedBy: uuid('checked_by')`.
- `rating: smallint('rating').notNull()` + `check('ck_purchase_satisfactions_rating', sql\`${t.rating} BETWEEN 1 AND 5\`)`.
- `reasons: varchar('reasons', { length: 32 }).array().notNull().default(sql\`'{}'::varchar[]\`)`.
- `uniqueIndex('purchase_satisfactions_order_id_unique').on(t.orderId)`, `index('purchase_satisfactions_updated_at').on(t.updatedAt)`, `index('purchase_satisfactions_rating_checked').on(t.rating, t.checkedAt)`.
- `ugcServiceSchema` 객체에 추가.

- [ ] **Step 1: 실패하는 Manager 단위 테스트 작성**

  `purchase-satisfaction.manager.spec.ts` — DB 는 `run(fn) => fn(fakeTx)` 형태의 가짜로, 기존 행 조회와 쓰기 값을 잡아 단언한다(로고 콘테스트 spec 의 `as unknown as DbService<UgcServiceSchema>` 방식).

  - `it('4점 이상이면 사유와 메모를 비워 저장한다')`
    입력 `{ rating: 4 }`, 기존 행 `{ rating: 2, reasons: ['PAYMENT_ERROR'], memo: '오류' }` → 쓰인 값 `reasons: []`, `memo: null`.
  - `it('4점 이상인데 사유나 메모를 보내면 BadRequestError')`
    `{ rating: 5, reasons: ['OTHER'] }`, `{ rating: 4, memo: 'x' }` 둘 다.
  - `it('내용이 바뀌면 확인 상태를 되돌린다')`
    기존 `{ rating: 2, reasons: ['OTHER'], memo: null, checkedAt: <date>, checkedBy: 'admin' }`, 입력 `{ rating: 2, reasons: ['OTHER', 'PAYMENT_ERROR'] }` → `checkedAt: null`, `checkedBy: null`.
  - `it('같은 내용을 다시 저장하면 확인 상태를 유지한다')`
    기존과 같은 rating·reasons(순서 무관)·memo → `checkedAt`·`checkedBy` 를 쓰지 않는다.
  - `it('기존 행이 없으면 새로 만든다')`
    insert 에 `orderId`, `orderDisplayId`, `userId`, `rating` 이 들어간다.

- [ ] **Step 2: 실패 확인**

  Run: `npx jest --maxWorkers=2 apps/ugc-service/src/purchase-satisfaction`
  Expected: FAIL (모듈 없음)

- [ ] **Step 3: 스키마, types, DTO, Manager, Reader, Service, 내부 컨트롤러, 모듈 구현**

  - Manager.upsert: `db.run` 안에서 `select ... where order_id = :orderId for update` → 규칙 적용 → insert 또는 update.
    사유 비교는 정렬한 배열끼리, 메모는 `trim()` 후 빈 문자열이면 null.
  - DTO 검증은 class-validator (`@IsUUID`, `@IsInt @Min(1) @Max(5)`, `@IsIn(PURCHASE_SATISFACTION_REASONS, { each: true }) @ArrayUnique`, `@MaxLength(300)`).
  - Service 는 Manager/Reader 위임만(2~3줄).

- [ ] **Step 4: 마이그레이션 생성과 검토**

  Run: `npm run db:generate:ugc-service -- --name add-purchase-satisfactions`
  Expected: `CREATE TABLE "purchase_satisfactions"` + CHECK + 인덱스 3개만 있는 SQL. 다른 테이블 변경이 섞이면 멈추고 원인부터 본다.

- [ ] **Step 5: 테스트 통과 확인**

  Run: `npx jest --maxWorkers=2 apps/ugc-service/src/purchase-satisfaction`
  Expected: PASS

- [ ] **Step 6: 커밋 + push**

  schema.ts, 마이그레이션 SQL, `drizzle/meta`(또는 `src/db/meta`) 변경, 모듈 파일을 한 커밋에.

---

### Task 2: ugc 어드민 API 와 권한

**Files:**
- Modify: `libs/authorization/src/permissions/permission-catalog.ts`
- Modify: `apps/ugc-service/src/purchase-satisfaction/purchase-satisfaction.reader.ts` (목록·요약)
- Modify: `apps/ugc-service/src/purchase-satisfaction/purchase-satisfaction.manager.ts` (확인 처리)
- Create: `controllers/admin-purchase-satisfaction.controller.ts`, `dto/admin-purchase-satisfaction-query.dto.ts`, `dto/admin-purchase-satisfaction-list-response.dto.ts`, `dto/set-checked.dto.ts`
- Test: `__tests__/purchase-satisfaction.reader.spec.ts` (KST 경계 계산), `purchase-satisfaction.reader.integration.spec.ts` (`describeIfDb`)

**Interfaces:**
- Consumes: Task 1 의 테이블, Manager, Reader, `PurchaseSatisfactionResponseDto`
- Produces
  - 권한:
    `permission('cs.satisfaction.read', '구매 만족도 조회', '결제 완료 화면에서 받은 구매 만족도를 본다', { owners: ['ugc-service'], grant: ADMIN_INTERN })`
    `permission('cs.satisfaction.manage', '구매 만족도 확인', '구매 만족도 응답을 확인 처리한다', { owners: ['ugc-service'], grant: ADMIN, requires: ['cs.satisfaction.read'] })`
  - `AdminPurchaseSatisfactionQueryDto { from?: string /*YYYY-MM-DD KST*/; to?: string; score?: 'all' | 'low' | 'high'; reason?: PurchaseSatisfactionReason; hasMemo?: boolean; unchecked?: boolean; page?: number /*기본 1*/; limit?: number /*기본 20, 최대 100*/ }`
  - `PurchaseSatisfactionSummaryDto { count: number; average: number /*소수 1자리, 응답 0이면 0*/; csatPercent: number /*정수 %*/; uncheckedLow: number; distribution: number[] /*길이 5, [1점,…,5점]*/; reasonCounts: Record<PurchaseSatisfactionReason, number> }`
  - `AdminPurchaseSatisfactionListResponseDto { summary: PurchaseSatisfactionSummaryDto; data: PurchaseSatisfactionResponseDto[]; total: number; page: number; limit: number }`
  - `PurchaseSatisfactionManager.setChecked(id: string, checked: boolean, adminId: string, tx?): Promise<PurchaseSatisfactionRow>`
  - HTTP
    `GET /purchase-satisfactions/admin` `@RequirePermission('cs.satisfaction.read')` → `AdminPurchaseSatisfactionListResponseDto` (정렬 `updated_at desc`)
    `GET /purchase-satisfactions/admin/orders/:orderId` `@RequirePermission('cs.satisfaction.read')` → `PurchaseSatisfactionResponseDto` / 404
    `PATCH /purchase-satisfactions/admin/:id/check` body `{ checked: boolean }` `@RequirePermission('cs.satisfaction.manage')` → `PurchaseSatisfactionResponseDto`

- [ ] **Step 1: 실패하는 테스트 작성**

  - 단위 `toKstRange(from?: string, to?: string): { gte?: Date; lt?: Date }` (reader 안의 export 함수):
    `toKstRange('2026-10-28', '2026-10-28')` → `gte = 2026-10-27T15:00:00Z`, `lt = 2026-10-28T15:00:00Z`.
  - 통합(`describeIfDb`, `--runInBand`): 1·2·3·4·5점 각 1건 + 2점에 사유 `PAYMENT_ERROR` 와 메모 →
    `summary.count = 5`, `average = 3`, `csatPercent = 40`, `distribution = [1,1,1,1,1]`, `reasonCounts.PAYMENT_ERROR = 1`, `uncheckedLow = 3`.
    `score: 'low'` → 3건, `hasMemo: true` → 1건, `reason: 'PAYMENT_ERROR'` → 1건.
    요약은 점수·사유 필터와 무관하게 기간 필터만 받는다.
  - `setChecked(id, true, admin)` → `checkedAt` 존재·`checkedBy = admin`, `false` → 둘 다 null.

- [ ] **Step 2: 실패 확인**

  Run: `npx jest --maxWorkers=2 apps/ugc-service/src/purchase-satisfaction`
  Expected: FAIL

- [ ] **Step 3: 구현**

  집계는 SQL 한 번(`count(*)`, `avg(rating)`, `count(*) filter (where rating >= 4)`, `count(*) filter (where rating <= 3 and checked_at is null)`, `count(*) filter (where rating = n)`), 사유 수는 `unnest(reasons)` group by.
  모델·JS 에서 행을 더하지 않는다.

- [ ] **Step 4: 게이트 포함 통과 확인**

  Run: `npx jest --maxWorkers=2 apps/ugc-service/src/purchase-satisfaction libs/authorization scripts/security`
  Expected: PASS (`route-classification`, `permission-dependencies`, `idor-reviewed` 포함)
  통합은 로컬 DB 가 있으면: `DATABASE_URL=… npx jest --runInBand purchase-satisfaction.reader.integration`

- [ ] **Step 5: 커밋 + push**

---

### Task 3: Medusa 고객 라우트 (주문 주인 확인)

**Files:**
- Create: `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/route.ts`
- Create: `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/handlers.ts`
- Create: `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/validators.ts`
- Modify: `apps/medusa/src/api/middlewares.ts`
- Test: `apps/medusa/src/api/store/orders/[id]/__tests__/purchase-satisfaction.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 내부 HTTP 두 개, env `UGC_SERVICE_URL`, `UGC_INTERNAL_KEY`
- Produces (storefront 가 부른다)
  - `GET /store/orders/:id/purchase-satisfaction` → 200 `{ satisfaction: { rating: number; reasons: string[]; memo: string | null } }` / 404
  - `PUT /store/orders/:id/purchase-satisfaction` body `{ rating, reasons?, memo? }` → 200 같은 모양 / 400 / 404 / 502
  - `StorePurchaseSatisfactionWrite` (zod): `rating` int 1~5, `reasons` 코드 enum 배열(선택), `memo` string ≤300(선택). 그 밖의 키는 거부(strict).

**동작**
- `query.graph({ entity: 'order', fields: ['id','display_id','customer_id','customer.metadata'], filters: { id } })`.
- 주문 없음 / `actor_id` 없음 / `customer_id !== actor_id` / `customer.metadata.almond_user_id` 없음 → 404 `{ type: 'not_found' }`.
- ugc 호출: `Authorization: Bearer ${UGC_INTERNAL_KEY}`, 타임아웃 5초. PUT body 는 `{ userId: almond_user_id, orderDisplayId: display_id, rating, reasons, memo }`.
- ugc 404(GET) → 404. ugc 400 → 400. 그 밖의 실패·타임아웃·env 없음 → 502 `{ type: 'ugc_unavailable' }`.
- middlewares: `{ matcher: '/store/orders/:id/purchase-satisfaction', middlewares: [authenticate('customer', ['session','bearer'])] }` + `{ method: ['PUT'], matcher: 같음, middlewares: [validateAndTransformBody(StorePurchaseSatisfactionWrite)] }`.

- [ ] **Step 1: 실패하는 테스트 작성** (`confirm-purchase.unit.spec.ts` 의 `makeReq`/`makeRes` 방식, `fetch` 는 `jest.spyOn(global, 'fetch')`)

  - `it('남의 주문이면 404 이고 ugc 를 부르지 않는다')` — GET, PUT 둘 다.
  - `it('almond_user_id 가 없는 고객이면 404')`
  - `it('PUT 은 주문에서 꺼낸 userId 와 display_id 를 ugc 에 넘긴다')` — req.body 에 `orderDisplayId: 999`, `userId: 'evil'` 를 섞어도 fetch body 는 주문 값.
  - `it('ugc 가 실패하면 502')`
  - `it('GET 은 ugc 404 를 404 로 돌려준다')`

- [ ] **Step 2: 실패 확인**

  Run: `cd apps/medusa && TEST_TYPE=unit npx jest --maxWorkers=2 purchase-satisfaction`
  Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인**

  Run: 위와 같음 → PASS
  추가로 `cd apps/medusa && npx tsc --noEmit -p .` 에 새 파일 에러 없음.

- [ ] **Step 5: 커밋 + push**

---

### Task 4: storefront 만족도 카드

**Files:**
- Create: `web/almondyoung-storefront/src/lib/api/medusa/purchase-satisfaction.ts`
- Test: `web/almondyoung-storefront/src/lib/api/medusa/purchase-satisfaction.test.ts`
- Create: `web/almondyoung-storefront/src/app/[countryCode]/(checkout)/checkout/success/purchase-satisfaction-card.tsx`
- Test: `.../success/purchase-satisfaction-card.test.tsx`
- Modify: `.../success/_components.tsx` (`ReviewPromptCard` 삭제)
- Modify: `.../success/[intentId]/page.tsx`
- Modify: 번역 파일(`checkout.success.review` 네임스페이스가 있는 messages) — 스펙 문구로 교체

**Interfaces:**
- Consumes: Task 3 의 두 라우트
- Produces
  - `type PurchaseSatisfaction = { rating: number; reasons: string[]; memo: string | null }`
  - `getPurchaseSatisfaction(orderId: string): Promise<PurchaseSatisfaction | null>` (404 → null)
  - `savePurchaseSatisfaction(orderId: string, input: { rating: number; reasons?: string[]; memo?: string }): Promise<PurchaseSatisfaction>` (실패는 throw)
  - `<PurchaseSatisfactionCard orderId={string} initial={PurchaseSatisfaction | null} />`

**동작** (스펙 고객 화면 1~7 그대로, 시안과 같은 문구)
- page.tsx: `order` 가 있을 때만 `getPurchaseSatisfaction(order.id)` 를 같이 불러 카드를 렌더한다. `order` 가 null 이면 카드를 렌더하지 않는다.
- 별 클릭 → `savePurchaseSatisfaction(orderId, { rating })` → 성공 시 `trackEvent('purchase_satisfaction', { rating })`.
- 보내기 → `savePurchaseSatisfaction(orderId, { rating, reasons, memo })` → `trackEvent('purchase_satisfaction_detail', { reasons_count })`.
- `initial` 이 있으면 감사 화면부터.
- 별 렌더는 기존 `@/components/rating` 의 `Rating` 을 쓴다.
- 강조 텍스트에 주황 금지(별 채움만 #FFA500). 보내기 버튼은 짙은 회색 배경.

- [ ] **Step 1: 실패하는 테스트 작성** (vitest, `returns.test.ts` 의 cookie·fetch 모킹 방식)

  - API: `_medusa_jwt` 를 bearer 로 보낸다 / 404 면 `getPurchaseSatisfaction` 이 null / PUT body 에 `rating` 등만 담는다.
  - 카드: 3점 클릭 → 저장 후 `어떤 점이 아쉬웠나요?` 와 칩 7개 / 5점 클릭 → `소중한 의견 감사합니다` / 저장 reject → `저장하지 못했어요. 별을 다시 눌러 주세요` 이고 선택된 별 없음 / 칩·메모 없으면 보내기 disabled / `다음에` 는 save 를 다시 부르지 않고 감사 화면 / `initial` 이 있으면 감사 화면부터.

- [ ] **Step 2: 실패 확인**

  Run: `cd web/almondyoung-storefront && npx vitest run src/lib/api/medusa/purchase-satisfaction.test.ts 'src/app/[countryCode]/(checkout)/checkout/success/purchase-satisfaction-card.test.tsx'`
  Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 + 타입 확인**

  Run: 위 vitest → PASS, `npx tsc --noEmit -p .` 에서 변경 파일 에러 없음.

- [ ] **Step 5: 커밋 + push**

---

### Task 5: 어드민 구매 만족도 목록 페이지

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/purchase-satisfaction.ts`
- Create: `apps/admin-web/src/lib/api/domains/purchase-satisfaction/index.ts`
- Create: `apps/admin-web/src/lib/services/purchase-satisfaction/{query-keys,queries,mutations,index}.ts`
- Create: `apps/admin-web/src/features/cs/purchase-satisfaction/` (template + components)
- Create: `apps/admin-web/src/app/(admin)/cs/purchase-satisfaction/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (CS children 에 `{ id: 'purchase-satisfaction', title: '구매 만족도', path: '/cs/purchase-satisfaction' }`, 리뷰 관리 바로 아래)
- Modify: `apps/admin-web/src/lib/auth/screen-access.ts` (`'/cs/purchase-satisfaction': any('cs.satisfaction.read')`)
- Modify: `apps/admin-web/src/lib/demo/capabilities.ts` (`/cs/reviews` 와 같은 취급이면 같은 목록에)
- Test: `apps/admin-web/src/features/cs/purchase-satisfaction/__tests__/reason-labels.spec.ts`

**Interfaces:**
- Consumes: Task 2 HTTP
- Produces
  - `PURCHASE_SATISFACTION_REASON_LABELS: Record<PurchaseSatisfactionReason, string>` (`features/cs/purchase-satisfaction/reason-labels.ts`, Task 6 도 쓴다)
  - `purchaseSatisfactionApi.list(query)`, `.getByOrder(orderId)` (404 → null), `.setChecked(id, checked)`
  - 훅 `usePurchaseSatisfactions(query)`, `usePurchaseSatisfactionByOrder(orderId, { enabled })`, `useSetPurchaseSatisfactionChecked()` + `.permission = ['cs.satisfaction.manage'] as const`
  - 쿼리 키 `purchaseSatisfactionQueryKeys.all` — 확인 처리 성공 시 이것 전체를 invalidate.

**화면** (시안 어드민 구매 만족도 목록 그대로, 고객 이름 칸과 응답률 KPI 는 없음)
- 기간 버튼 오늘·최근 7일·최근 30일(기본 최근 30일, KST 날짜로 from/to 계산).
- KPI 4장: 응답, 평균 별점, 만족 비율(4~5점 응답의 비율), 확인 안 한 3점 이하(누르면 `score=low&unchecked=true`).
- 별점 분포 막대, 3점 이하 사유 막대(누르면 그 사유 필터, 다시 누르면 해제).
- 필터: 전체 / 3점 이하 / 4점 이상, 메모 있음, 확인 안 한 것만. 기본 필터 3점 이하.
- 표: 응답 시각(`MM-DD HH:mm` KST), 주문번호(`#display_id`), 별점, 사유(라벨, 쉼표), 메모(한 줄 말줄임), 확인(확인 전/확인함, 4점 이상은 -).
- 행 클릭 → 오른쪽 상세: 별점·라벨, 사유 칩, 메모 전문, `<Can run={useSetPurchaseSatisfactionChecked}>` 로 감싼 `확인했어요` / `확인 취소`, `주문내역에서 열기`(`/order/history?keyword=<orderDisplayId>` 처럼 주문내역이 받는 검색 파라미터로. 받는 파라미터는 `features/order/history/utils/build-query.ts` 에서 확인).
- 페이지네이션 20건.

- [ ] **Step 1: 실패하는 테스트 작성**

  `reason-labels.spec.ts`: 키 7개가 Global Constraints 순서·문구와 정확히 같다.

- [ ] **Step 2: 실패 확인**

  Run: `npx jest --maxWorkers=2 --roots ./apps/admin-web -c apps/admin-web/jest.config.* purchase-satisfaction` (리포의 `test:admin-web` 스크립트와 같은 설정으로)
  Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 게이트 포함 통과 확인**

  Run: `npm run test:admin-web -- --maxWorkers=2 purchase-satisfaction screen-access mutation-guard`
  Expected: PASS (`screen-access.gate.spec.ts`, `mutation-guard.gate.spec.ts` 포함)

- [ ] **Step 5: 커밋 + push**

---

### Task 6: 주문내역 상세 패널의 만족도 섹션

**Files:**
- Create: `apps/admin-web/src/features/order/history/components/purchase-satisfaction-section.tsx`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx` (`OrderDetailPanel` 의 상품 `<section>` 과 `<dl>` 사이)
- Test: `apps/admin-web/src/features/order/history/components/__tests__/purchase-satisfaction-section.spec.tsx`

**Interfaces:**
- Consumes: Task 5 의 `usePurchaseSatisfactionByOrder`, `useSetPurchaseSatisfactionChecked`, `PURCHASE_SATISFACTION_REASON_LABELS`
- Produces: `<PurchaseSatisfactionSection medusaOrderId={string} />`

**동작**
- `o.channel === 'medusa'` 일 때만 렌더, id 는 `o.channelOrderId`.
- `cs.satisfaction.read` 가 없으면 렌더하지 않는다(기존 권한 판정 훅 사용).
- 응답 있음: 제목 `구매 만족도` + 확인 배지, 별점·라벨·응답 시각, 사유 칩, 메모, `확인했어요`/`확인 취소`, `만족도 목록에서 보기`(`/cs/purchase-satisfaction`).
- 응답 없음: `아직 응답이 없어요`.

- [ ] **Step 1: 실패하는 테스트 작성**

  응답이 있으면 라벨 `결제 중 오류가 났어요` 와 메모가 보인다 / null 이면 `아직 응답이 없어요` / 권한이 없으면 아무것도 렌더하지 않는다.

- [ ] **Step 2: 실패 확인**

  Run: `npm run test:admin-web -- --maxWorkers=2 purchase-satisfaction-section` → FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 커밋 + push**

---

### Task 7: 전체 검증과 PR

- [ ] **Step 1:** `npm run type-check` → 에러 0
- [ ] **Step 2:** `npx jest --maxWorkers=4` → 실패 0
- [ ] **Step 3:** `npm run test:admin-web -- --maxWorkers=4`, `cd web/almondyoung-storefront && npm test`, `cd apps/medusa && npm run test:unit -- --maxWorkers=4` → 실패 0
- [ ] **Step 4:** 브랜치 전체 Codex 리뷰, 지적 반영
- [ ] **Step 5:** PR 본문 정리(요약, 배포 순서: ugc 마이그 → ugc → MedusaAdmin·Medusa → storefront·admin-web, 테스트 결과)
