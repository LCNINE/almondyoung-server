# 타임세일 어드민 스타일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **리뷰어는 Codex 다.** 태스크별 리뷰와 마지막 브랜치 전체 리뷰 모두 `Agent(subagent_type: "codex:codex-rescue")` 로 띄운다. 프롬프트는 "리뷰만, 코드 수정 금지" 로 시작하고 태스크 번호, 이 계획 파일 경로, 인계 문서 경로, 리뷰 대상 파일 목록을 넘긴다. Claude 리뷰어로 대체하지 않는다.

**Goal:** 작업 트리에 있는 타임세일 초안(공유 모델·렌더러·Medusa 설정 API·어드민 작업공간·스토어프론트 연결)의 P0 결함을 고치고, 저장된 옵션이 실제 화면에 반영되게 완성한다.

**Architecture:** 가격 원장은 Medusa price list, 진열·스타일·반복 설정은 `store.metadata.timeSaleSettings` (revision 충돌 검사 + LOCKING). 모델·검증은 `packages/domain-types/time-sale.ts`, 렌더링은 `packages/time-sale-ui/index.tsx` 하나를 어드민 미리보기와 스토어프론트가 함께 쓴다. 가격·설정을 함께 바꾸는 쓰기는 클라이언트 다단계 호출에서 Medusa 워크플로(보상 포함)로 옮긴다.

**Tech Stack:** TypeScript, Medusa v2 (workflows, Modules.PRICING/STORE/LOCKING), Next.js(admin-web, storefront), React Query, sonner, sanitize-html, Jest.

**Spec:**
- `/private/tmp/time-sale-handoff-2026-10-07.md` (인계 문서. P0/P1 번호는 이 문서 기준이다. `/private/tmp` 는 재부팅 시 사라지므로 Task 0 에서 `docs/time-sale-handoff-2026-10-07.md` 로 복사한다)
- `docs/time-sale-reference-investigation-2026-10-07.md`
- `docs/time-sale-reference-evidence/` (원본 PNG·AX·DOM·`admin-design-measurements.json`. 디자인 값은 여기서 읽는다. 감으로 고르지 않는다)

## Global Constraints

- 작업 트리의 초안은 **커밋되지 않은 상태**다. `reset`/`checkout .`/`clean`/`stash` 금지.
- **커밋·푸시는 사용자가 "커밋해" 라고 할 때만.** 아래 각 태스크의 마지막 단계는 커밋이 아니라 체크포인트(변경 파일 목록 보고)다.
- IAP, PV 충전, 외부 결제·청구 내역은 범위 밖. 기존 쇼핑몰 결제는 건드리지 않는다.
- 라이브 DB·운영 Medusa 쓰기 금지. 검증은 로컬(`localhost:8002` 어드민, 로컬 Medusa)에서만.
- 새 의존성 설치 금지. `sanitize-html`, `sonner`, `@tanstack/react-query` 등 이미 있는 것만 쓴다.
- 설명 주석 금지(한국어 번역 주석만 예외). 강조용 겹화살괄호 금지.
- jest 는 항상 `--maxWorkers=4` (또는 `--runInBand`).
- Node 22 로 검증한다(`nvm use 22`). Node 25 + `--ignore-engines` 결과는 최종 근거로 쓰지 않는다.

### 코드 형식 — 한 줄 압축 코드 금지

초안에는 4KB CSS 가 한 줄(`time-sale-workspace.css`)이고, `packages/time-sale-ui/index.tsx` 에 200자 넘는 줄이 38개 있다. 이번 작업에서 다음을 지킨다.

- **줄바꿈을 제대로 한다.** 선언 하나에 한 줄(CSS 는 속성 하나에 한 줄), 함수·JSX 요소·객체 리터럴은 Prettier 가 펼친 모양 그대로 둔다. 여러 문장을 `;` 로 한 줄에 잇지 않는다. 삼항·`&&` 를 겹쳐 한 줄에 몰아넣지 말고 변수나 작은 컴포넌트로 뺀다.
- 인라인 style 객체가 3개 속성을 넘으면 상수나 CSS 클래스로 뺀다.
- **빈 줄로 블록을 나눈다.** `"use client"` 지시문 뒤, import 블록 뒤, 최상위 선언(export·function·const·type·interface·class) 사이에 빈 줄 한 줄. 함수 본문 안에서도 조회 → 검증 → 쓰기 → 반환처럼 단계가 바뀌는 곳에 빈 줄을 둔다.
- 파일을 고친 직후 그 파일에 Prettier 를 돌린다. 설정은 가장 가까운 `.prettierrc` 를 따른다(admin-web 80자, storefront 기본 80자, `packages/`·`apps/medusa` 는 루트 120자).
- **모든 태스크의 체크포인트 전에 아래 형식 게이트를 통과해야 한다.** 리뷰어(Codex)도 이 게이트 결과를 확인한다.

```bash
TS_FILES=$(git ls-files -m -o --exclude-standard \
  | grep -E 'time-sale|membership-filter|membership-price-visibility|\[countryCode\]/layout\.tsx|product-preview-price' \
  | grep -E '\.(ts|tsx|css)$')
npx prettier --check $TS_FILES
awk 'length > 140 { print FILENAME ":" FNR ": " length; bad = 1 } END { exit bad }' $TS_FILES
```

통과 기준: Prettier 경고 0, awk 출력 0줄 + exit 0.

## Review Focus

1. **비회원에게 비공개 세일가가 다른 경로로 새는 것** — `/store/products` 외에 장바구니 line item, 상품상세 SSR HTML, Next 캐시(회원/비회원 공용 태그), 검색 응답. 비회원은 어떤 경로에서도 숫자를 받지 않아야 한다. → Task 4
2. **두 관리자가 같은 상품을 겹치는 기간에 동시에 등록하는 경우** — 클라이언트 검사만 있어서 둘 다 저장된다. 서버가 하나를 409 로 거절해야 한다. → Task 3
3. **일반 price list 는 저장되고 멤버십 쪽이나 설정 저장이 실패하는 경우** — 한쪽 가격만 살아 있으면 안 된다. 전부 원복되거나 전부 draft 로 남아야 한다. → Task 3
4. **서비스 OFF 인데 할인가가 계속 적용되는 경우** — OFF 면 진열과 가격 모두 멈추고, ON 으로 돌리면 OFF 직전에 active 였던 세일만 되살아나야 한다. → Task 5
5. **미리보기 타이머가 줄지 않거나, 더보기 페이지가 100개에서 잘리는 경우** — 운영자가 미리보기로 실화면을 판단할 수 없다. → Task 6, Task 9

---

### Task 0: 인계 문서 보존 + 기존 초안 포맷 정리 (동작 변경 없음)

이후 모든 diff 가 이 파일들 위에서 일어나므로 가장 먼저 한다. 동작은 바꾸지 않는다.

**Files:**
- Create: `docs/time-sale-handoff-2026-10-07.md` (`/private/tmp/time-sale-handoff-2026-10-07.md` 복사)
- Modify (포맷만): `packages/domain-types/time-sale.ts`, `packages/time-sale-ui/index.tsx`, `apps/admin-web/src/features/mall/marketing/time-sale/components/time-sale-workspace.css`, `.../time-sale-workspace.tsx`, `apps/medusa/src/utils/time-sale-settings.ts`, `apps/medusa/src/api/admin/time-sale-settings/route.ts`, `apps/medusa/src/api/store/time-sale/route.ts`, `apps/admin-web/src/lib/services/time-sale.ts`, `web/almondyoung-storefront/src/domains/home/components/sections/time-sale-section/configured.tsx`

- [ ] **Step 1:** 인계 문서를 `docs/` 로 복사한다.
- [ ] **Step 2:** 위 파일에 `npx prettier --write` 를 돌린다.
- [ ] **Step 3:** 형식 게이트를 돌린다. Prettier 가 펼치지 못하는 긴 줄(한 줄 삼항 체인, `;` 로 이은 문장, 긴 인라인 style)은 Global Constraints 규칙대로 손으로 나눈다. 특히 `time-sale-ui/index.tsx` 의 `Products`·`Timer` 인라인 style 은 모듈 상단 상수로 뺀다.
- [ ] **Step 4:** 동작이 바뀌지 않았는지 확인한다.

```bash
yarn --cwd apps/medusa test:unit --watchman=false --runTestsByPath \
  src/utils/__tests__/time-sale-settings.unit.spec.ts \
  src/utils/__tests__/membership-filter.unit.spec.ts \
  src/utils/__tests__/time-sale.unit.spec.ts
npx jest --maxWorkers=4 apps/admin-web/src/features/mall/marketing/time-sale/time-sale-model.spec.ts
```
Expected: 45 + 30 passed (인계 시점 수치와 같음).

- [ ] **Step 5: 체크포인트** — 변경 파일 목록과 형식 게이트 출력을 보고한다.

---

### Task 1: 옵션 모델 ↔ 편집기 ↔ 렌더러 연결 (P0-1, P1-6)

모델·검증에만 있는 키를 실제로 쓰게 만든다. 키를 지우는 방향은 택하지 않는다 — 증거(`carousel-panel-상품 속성*.txt`, `carousel-panel-상품 이미지 레이어*`, `carousel-panel-상품 머리말/꼬리말*`)에 원본 기능으로 있다.

**Files:**
- Modify: `packages/time-sale-ui/index.tsx`
- Modify: `apps/admin-web/src/features/mall/marketing/time-sale/components/time-sale-workspace.tsx`
- Create: `packages/time-sale-ui/__tests__/sale-renderer.spec.tsx` (jest 가 `packages/` 를 줍는지 Step 2 에서 확인. 안 줍으면 `apps/admin-web/src/features/mall/marketing/time-sale/sale-renderer.spec.tsx` 로 둔다)

**Interfaces:**
- Produces: `productStyle(component: SaleComponent, state: SalePreviewState, soldOut: boolean): SaleCss` — `productCss` 위에 상태별(`scheduledCss`/`endedCss`) 그리고 품절이면 `soldOutCss` 를 덮어쓴 결과. `packages/time-sale-ui/index.tsx` 에서 export.
- Produces: 컴포넌트 루트 style = `{ ...c.css, ...c.stateCss?.[state] }`.
- Produces: `productTexts` 는 `position` 별로 이미지 위/아래에 순서대로 렌더된다. 기존 `options.header`/`options.footer` 는 `productTexts` 가 비어 있을 때만 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

```tsx
it('상태별·품절 상품 CSS 가 순서대로 덮인다', () => {
  const c = createSaleComponent('grid', 'g');
  c.options.productCss = { opacity: 1, color: 'black' };
  c.options.endedCss = { opacity: 0.5 };
  c.options.soldOutCss = { color: 'gray' };
  expect(productStyle(c, 'ended', true)).toEqual({ opacity: 0.5, color: 'gray' });
  expect(productStyle(c, 'active', false)).toEqual({ opacity: 1, color: 'black' });
});
it('stateCss 가 컴포넌트 루트에 적용된다', () => { /* render SaleRenderer previewState="scheduled", 루트 요소 style 에 stateCss.scheduled 값 포함 */ });
it('productTexts 가 있으면 options.header 를 쓰지 않는다', () => { /* header 텍스트 미노출 assert */ });
```

- [ ] **Step 2:** 테스트를 돌려 실패를 확인한다(`productStyle` 미정의).
- [ ] **Step 3:** 렌더러에 위 Interfaces 를 구현하고 `badgeCss`/`overlayCss`/`imageCss`/`headerCss`/`footerCss` 를 해당 요소에 적용한다.
- [ ] **Step 4:** 작업공간의 `optionLabels` 에 9개 키 라벨을 추가하고, 상품 속성 패널에 키마다 기존 `CssEditor` 를 붙인다. 상태별 CSS 는 컴포넌트 패널에 예정/할인/마감 탭 + `CssEditor` 로 붙인다. `productTexts` 는 추가/삭제/위아래 이동 목록(최대 7개, 검증과 같은 값).
- [ ] **Step 5:** 테스트 통과 + `npx tsc --noEmit -p apps/admin-web` 에러 0.
- [ ] **Step 6:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 2: 어드민 설정 API 인증·입력 경계 확인

**Files:**
- Modify: `apps/medusa/src/api/admin/time-sale-settings/route.ts`
- Test: `apps/medusa/integration-tests/http/time-sale-settings.spec.ts` (기존 medusa HTTP 통합 스펙 위치·가드 컨벤션을 따른다)

- [ ] **Step 1: 실패 테스트** — 토큰 없이 `GET`/`POST /admin/time-sale-settings` → 401. 잘못된 revision 으로 `POST` → 409. `imageSize: 0` → 400 + `'환경설정 값이 올바르지 않습니다.'`. 정상 저장 후 `GET` 이 같은 settings 와 새 revision 을 돌려준다.
- [ ] **Step 2:** `scripts/local/run-medusa-integration.sh` 로 돌려 실패/통과를 확인한다(postgres + redis 둘 다 필요).
- [ ] **Step 3:** `/admin/*` 미들웨어(`apps/medusa/src/api/admin/middlewares.ts`)가 이미 인증을 거는지 확인하고, 안 걸리면 같은 파일에 matcher 를 추가한다. body 는 `validateAndTransformBody` 대신 기존 `validateTimeSaleSettings` 를 그대로 쓴다(모델과 검증이 한 곳에 있어야 한다).
- [ ] **Step 4:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 3: 가격 + 설정 쓰기를 서버 워크플로로 (P0-3, P0-4)

지금은 admin-web 이 price list 생성 → 설정 저장 → 활성화를 순서대로 부르고, 실패 시 삭제를 시도한다. 수정 경로에는 복구도 중복 검사도 없다. 이걸 Medusa 워크플로 하나로 옮긴다.

착수 전 `https://docs.medusajs.com/llms.txt` 에서 workflows / compensation / core-flows price list 페이지를 읽는다(CLAUDE.md 규칙).

**Files:**
- Create: `apps/medusa/src/workflows/time-sale/save-time-sale.ts`
- Create: `apps/medusa/src/api/admin/time-sales/save/route.ts` (`POST`)
- Modify: `apps/medusa/src/utils/time-sale.ts` (중복 검사 쿼리 추가)
- Modify: `apps/admin-web/src/lib/services/time-sale.ts` (`useCreateTimeSale`/`useUpdateTimeSale` 가 새 엔드포인트 한 번만 호출)
- Modify: `apps/admin-web/src/lib/api/domains/medusa/time-sales.ts`
- Test: `apps/medusa/src/utils/__tests__/time-sale-overlap.unit.spec.ts`, 통합 `apps/medusa/integration-tests/http/time-sale-save.spec.ts`

**Interfaces:**
- Produces: `findOverlappingTimeSales(container, input: { productIds: string[]; startsAt: string; endsAt: string; repeatHours: number; repeatUntil: string | null; excludePriceListIds: string[] }): Promise<{ priceListId: string; title: string; productId: string }[]>` in `utils/time-sale.ts`. 반복 세일은 `repeatUntil` 까지(없으면 상대 기간 끝까지) 회차를 펼쳐 비교한다.
- Produces: `POST /admin/time-sales/save` body `{ generalId: string | null; membershipId: string | null; title; period; general: PriceListPayload; membership: PriceListPayload | null; display: SaleDisplay; revision: string }` → `{ generalId, membershipId, revision }`. 중복이면 409 + 겹친 세일 제목과 상품 id.
- Produces: 워크플로 `saveTimeSaleWorkflow`. 단계: (1) LOCKING `time-sale-write` 획득 (2) 중복 검사 (3) price list 생성/수정을 draft 로 — core-flows 의 `createPriceListsWorkflow`/`updatePriceListsWorkflow` 를 쓰고 직접 서비스 호출로 보상을 다시 짜지 않는다 (4) 설정 저장 단계(보상 = 이전 settings·revision 복원) (5) 요청 상태대로 active 전환.
- 그룹 키 `title + startsAt` 이 수정 중 쪼개지는 문제: 저장 후 두 리스트의 `title`·`starts_at` 이 같은지 워크플로 마지막 단계에서 검사하고 다르면 실패시켜 보상을 돌린다.

- [ ] **Step 1: 실패 테스트(유닛)** — `findOverlappingTimeSales` 의 순수 비교 함수를 `overlapsWithRepeats(a, b): boolean` 로 분리해 테스트한다.

```ts
expect(overlapsWithRepeats(
  { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 24, repeatUntil: null },
  { startsAt: '2026-10-09T00:30:00Z', endsAt: '2026-10-09T02:00:00Z', repeatHours: 0, repeatUntil: null },
)).toBe(true);
expect(overlapsWithRepeats(
  { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 24, repeatUntil: '2026-10-08T00:30:00Z' },
  { startsAt: '2026-10-09T00:30:00Z', endsAt: '2026-10-09T02:00:00Z', repeatHours: 0, repeatUntil: null },
)).toBe(false);
expect(overlapsWithRepeats( /* 경계가 맞닿기만 함: a.endsAt === b.startsAt */ )).toBe(false);
```

- [ ] **Step 2: 실패 테스트(통합)** — (a) 같은 상품·겹치는 기간 두 번째 저장 → 409 (b) `Promise.all` 로 동시에 두 번 저장 → 하나만 성공 (c) 설정 단계에서 강제로 실패(잘못된 revision)시키면 price list 가 하나도 남지 않음(신규) / 원래 값으로 돌아감(수정) (d) 수정 시 자기 자신과는 중복으로 보지 않음.
- [ ] **Step 3:** 실패 확인 후 구현한다.
- [ ] **Step 4:** admin-web 훅에서 다단계 호출과 `Promise.allSettled` 롤백을 지우고 새 엔드포인트 한 번 호출로 바꾼다. 409 메시지는 토스트로 그대로 보인다. `useSetTimeSaleStatus` 도 같은 워크플로의 상태 전환 경로(`POST /admin/time-sales/status`, 두 리스트를 한 워크플로에서 전환)로 옮긴다.
- [ ] **Step 5:** 유닛 + 통합 + `time-sale-model.spec.ts` 통과.
- [ ] **Step 6:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 3b: 상품별 기간 모드 (P1-12, 사용자 결정 ③)

하나의 타임세일 안에서 상품마다 다른 시작/종료 시각을 준다. 스토어프론트에는 **세일 하나 = 섹션 하나** 로 나가야 한다. 시간대를 바꾸려고 세일을 새로 만들면 섹션이 계속 늘어나기 때문이다.

Medusa price list 는 기간이 리스트 단위라서 상품 하나에 price list 한 쌍(일반 + 멤버십)을 만든다. 지금은 `utils/time-sale.ts` 가 `title + startsAt` 로 리스트를 묶는데, 상품별 기간에서는 startsAt 이 상품마다 달라 이 키로 묶을 수 없다. 그래서 묶음 정보를 설정에 명시적으로 둔다.

**Files:**
- Modify: `packages/domain-types/time-sale.ts`
- Modify: `apps/medusa/src/utils/time-sale.ts` (`listAllTimeSales`/`listActiveTimeSales` 그룹핑)
- Modify: `apps/medusa/src/workflows/time-sale/save-time-sale.ts`, `apps/medusa/src/utils/time-sale-settings.ts` (`repeatTimeSales`)
- Modify: `apps/medusa/src/api/store/time-sale/route.ts`
- Modify: `.../template/time-sale-form-template.tsx`, `.../components/time-sale-price-editor.tsx`
- Modify: `packages/time-sale-ui/index.tsx`
- Test: `apps/medusa/src/utils/__tests__/time-sale.unit.spec.ts`, 렌더러 스펙, 통합 `time-sale-save.spec.ts`

**Interfaces:**
- `SaleDisplay` 에 추가: `periodMode: 'sale' | 'product'` (기본 `'sale'`), `groups: { generalId: string | null; membershipId: string | null; productId: string | null }[]`. `'sale'` 모드는 그룹 1개, `productId: null`. `'product'` 모드는 상품당 1개.
- `settings.sales` 의 키는 `saleId`(신규 생성 시 `crypto.randomUUID()`)다. 기존 데이터(키 = generalId, `groups` 없음)는 로드할 때 `title + startsAt` 그룹핑 결과로 `groups` 를 채워 읽는다. 저장은 새 형식으로만 한다.
- `listAllTimeSales` / `listActiveTimeSales` 반환에 `saleId` 와 `products: { productId; startsAt; endsAt }[]` 를 추가한다. 세일 단위 `startsAt` = 상품 중 가장 이른 시작, `endsAt` = 가장 늦은 종료. `groups` 에 없는 price list 만 기존 `title + startsAt` 로 묶는다.
- `/store/time-sale` 응답의 각 세일에 `products: { productId; startsAt; endsAt }[]` 를 넣는다(가격 숫자는 여전히 넣지 않는다).
- 검증: `'product'` 모드는 상품 최대 200개. 상품별 `startsAt < endsAt`.
- 반복(SHIFT): 그룹마다 따로 `nextRepeatedPeriod` 를 적용한다. 중복 검사(Task 3)는 그룹별 기간으로 한다.
- 렌더러: 섹션 타이머·진행바는 "지금 진행 중인 상품 중 가장 먼저 끝나는 기간"을 따른다. 진행 중이 없으면 다음에 시작할 상품 기간(예정 상태). 상품 카드는 자기 기간으로 예정/할인/마감 상태를 판정해 Task 1 의 `productStyle` 상태별 CSS 를 받는다. 카드 머리말/꼬리말 변수에 `{{product_starts_at}}`, `{{product_ends_at}}`, `{{product_remaining}}` 를 추가한다.
- 어드민 폼: 기간 구분 토글(세일 단위 / 상품별). 상품별이면 선택 상품 목록 행마다 시작·종료 입력이 생기고, 비어 있으면 세일 기간을 쓴다. 원본 화면은 `docs/time-sale-reference-evidence/` 의 상품별 기간 캡처를 따른다.

- [ ] **Step 1: 실패 테스트(유닛)** — (a) `groups` 가 있는 세일의 서로 다른 startsAt 리스트 4개(상품 2개 × 일반/멤버십)가 세일 하나로 묶인다 (b) `groups` 없는 옛 데이터는 지금처럼 `title + startsAt` 로 묶인다 (c) 상품 A 13:00~14:00, B 15:00~16:00, 현재 13:30 → 섹션 타이머 기준 = A, A 카드 = 할인, B 카드 = 예정 (d) 현재 14:30 → 섹션 = B 예정, A = 마감.
- [ ] **Step 2: 실패 테스트(통합)** — 상품별 모드 저장 → `/store/time-sale` 에 세일 1건 + 상품별 기간. 13:30 기준 `/store/products` 에서 A 만 할인가.
- [ ] **Step 3:** 실패 확인 → 구현 → 통과.
- [ ] **Step 4:** 스토어프론트 홈에 세일 하나가 섹션 하나로만 나오는지 브라우저로 확인한다.
- [ ] **Step 5:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 4: 비회원 가격 비공개 — 경로 전수 (P0-2)

정책 이름을 셋으로 고정하고 화면 문구도 이걸 쓴다: **가격 공개 제한**(이번 범위), **구매 제한**, **상품 노출 제한**(둘 다 기존 기능, 이번에 바꾸지 않음).

**Files:**
- Modify: `apps/medusa/src/utils/membership-filter.ts`, `apps/medusa/src/api/store/products/middlewares/membership-price-visibility.ts`
- Create: `docs/time-sale-price-privacy-paths.md` (경로표: 경로 / 가격 필드 / 비회원 처리 / 테스트)
- Test: `apps/medusa/src/utils/__tests__/membership-filter.unit.spec.ts`, 통합 `apps/medusa/integration-tests/http/time-sale-price-privacy.spec.ts`

- [ ] **Step 1:** 숫자 가격이 비회원에게 가는 경로를 전부 찾아 경로표에 적는다. 최소: `/store/products` 목록·상세, `/store/carts/*` line item (`unit_price`, `subtotal`, `compare_at_unit_price`), 스토어프론트 SSR(상품상세·카드·장바구니 컴포넌트가 숫자를 HTML 에 넣는지), Next fetch 캐시 태그가 회원/비회원으로 나뉘는지, `apps/search` 응답에 가격 필드가 있는지.
- [ ] **Step 2:** `hideTimeSalePrices` 가 지우는 키 목록이 Step 1 에서 찾은 필드를 다 덮는지 확인하는 실패 테스트를 추가한다(variant `calculated_price` 안의 중첩 객체, metadata 별칭 포함).
- [ ] **Step 3:** 통합 실패 테스트 — 비회원 / 일반회원 / 멤버십 세 토큰으로 `/store/products?id=<비공개상품>` 응답에 세일가 숫자가 있는지. 비회원·일반회원 = 없음, 멤버십 = 있음.
- [ ] **Step 4:** 구현. 장바구니는 사용자 결정 ①대로 한다. 비회원·일반회원도 담을 수 있고, 담기는 가격은 **세일이 빠진 정상가**다. 비공개 세일(`environment.membershipPriceOnly` 또는 `display.membershipPriceOnly`)은 region 규칙의 일반 price list 를 만들지 않거나 draft 로 두고, 멤버십 customer group price list 만 active 로 둔다(Task 3 워크플로에서 처리). 통합 테스트: 비회원 카트에 담은 비공개 세일 상품의 `unit_price` 가 정상가와 같다.
- [ ] **Step 5:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 5: 서비스 ON/OFF 를 가격까지 연결 (P0-5)

**Files:**
- Modify: `packages/domain-types/time-sale.ts` (`environment.suspendedPriceListIds: string[]` 추가, 기본 `[]`, 검증: 최대 200개 문자열)
- Modify: `apps/medusa/src/workflows/time-sale/save-time-sale.ts` 또는 별도 `toggle-time-sale-service.ts`
- Modify: `apps/medusa/src/utils/time-sale-settings.ts` (`saveTimeSaleSettings` 가 `enabled` 변화를 감지하면 위 워크플로를 탄다)
- Test: 통합 `apps/medusa/integration-tests/http/time-sale-service-toggle.spec.ts`

**Interfaces:**
- ON→OFF: 현재 `status = 'active'` 인 타임세일 price list id 를 `suspendedPriceListIds` 에 적고 전부 draft.
- OFF→ON: `suspendedPriceListIds` 에 있는 것만 active, 목록 비움. **원래 draft 였던 세일은 그대로 draft.**

- [ ] **Step 1: 실패 테스트** — 세일 A(active), B(draft) → OFF → 둘 다 draft, A 의 할인가가 `/store/products` 에서 사라짐 → ON → A 만 active, B 는 draft.
- [ ] **Step 2:** 실패 확인 → 구현 → 통과.
- [ ] **Step 3:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 6: 렌더러 미완 옵션 (P1-7, P1-8)

**Files:**
- Modify: `packages/time-sale-ui/index.tsx`
- Modify: `apps/admin-web/src/features/mall/marketing/time-sale/components/time-sale-workspace.tsx` (미리보기 시각 기준)
- Test: Task 1 의 렌더러 스펙에 추가

**Interfaces:**
- 미리보기는 상태를 바꾸는 순간 `previewAnchor = { startsAt, endsAt }` 를 한 번 계산해 state 로 고정한다. 새로고침 버튼은 anchor 를 다시 계산한다. tick 마다 다시 계산하지 않는다.
- 배지 11종: 디자인 이름과 도형은 `docs/time-sale-reference-evidence/carousel-panel-상품 이미지 엠블럼*.txt` + 같은 이름 PNG 에서 읽어 `BADGE_SHAPES: Record<string, CSSProperties>` 하나로 둔다.
- 플립 타이머: 숫자가 바뀔 때 CSS `@keyframes` 로 위·아래 반쪽을 뒤집는다. `prefers-reduced-motion` 이면 애니메이션 없음.
- `dots`(캐러셀 페이지 점), `duration`(scroll 애니메이션 시간), `environment.imageSize`(이미지 최대 px)를 렌더러가 실제로 쓴다.

- [ ] **Step 1: 실패 테스트** — (a) fake timer 로 2초 진행 시 미리보기 타이머 초가 2 줄어든다 (b) `dots: true` 이면 페이지 수만큼 점 버튼, `false` 면 0개 (c) `imageSize: 300` 이면 img `max-width: 300px` (d) 배지 키 11개 모두 `BADGE_SHAPES` 에 있음.
- [ ] **Step 2:** 실패 확인 → 구현 → 통과.
- [ ] **Step 3:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 7: 어드민 편집기 — 상품별 변수, 스타일 라이브러리, 미저장 보호 (P1-9, P1-10, P1-15)

**Files:**
- Modify: `packages/domain-types/time-sale.ts` — `SaleDisplay.variables: Record<string, string>` 를 `productVariables: Record<string /* productId */, Record<string /* 변수명 */, string>>` 로 바꾼다. 로드 시 옛 `variables` 가 있으면 무시(아직 배포 전이라 마이그레이션 불필요).
- Modify: `packages/time-sale-ui/index.tsx` — 상품별 값 > 변수 `preview` 값 순으로 치환.
- Modify: `.../time-sale-workspace.tsx`, `.../template/marketing-time-sale-template.tsx` (행 말줄임표 버튼 = 상품별 변수 값 편집, 원본과 같음)
- Test: 렌더러 스펙 + `time-sale-model.spec.ts`

**Interfaces:**
- 스타일 라이브러리: `SaleLayout.id` 가 편집 중 레이아웃과 `savedStyles` 항목을 잇는 키다. 새 스타일 저장 시 활성 레이아웃 id = 새 snapshot id. 저장할 때마다 같은 id 의 snapshot 을 갱신. 삭제는 활성 레이아웃이 기본 스타일이 아닐 때만 가능하고 확인창(원본 문구, 증거에서)을 띄운다. 초기화는 `초기화` 입력 확인창.
- 미저장 보호: `dirty` 상태에서 (a) 섹션 탭·플랫폼 전환 (b) Next 내부 라우트 이동 (c) `beforeunload` 모두 확인창. 확인창은 기존 admin-web 다이얼로그 컴포넌트를 써서 focus trap·Escape·포커스 복귀를 얻는다. dirty 일 때 settings refetch 결과가 편집본을 덮지 않는다.
- 미리보기 안의 `<a>` 클릭은 `preventDefault` (어드민에서 쇼핑몰로 이탈 방지).

- [ ] **Step 1: 실패 테스트** — (a) 상품 A 에 `user_x = '회원 혜택'`, B 는 값 없음 → A 카드에 '회원 혜택', B 카드에 변수 preview 값 (b) 새 스타일 저장 → 활성 layout.id === savedStyles 마지막 id (c) dirty 상태에서 refetch → 편집본 유지.
- [ ] **Step 2:** 실패 확인 → 구현 → 통과.
- [ ] **Step 3:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 8: 타임세일 목록·폼 컬럼 (P1-11)

**Files:**
- Modify: `.../template/marketing-time-sale-template.tsx`, `.../template/time-sale-form-template.tsx`

- [ ] **Step 1:** 원본 목록 컬럼(조사 문서 "확인한 기능" 표: 진열순위, 상태, 파티션ID, 명칭, 번호, 웹로그ID, 기간구분, 기간, SHIFT 반복, 전시모드, 품절표시, 예정, 마감)과 현재 표를 대조해 빠진 것을 추가한다. 선택 체크박스 + 일괄 활성/중지/삭제(삭제·중지는 확인창).
- [ ] **Step 2:** 상태 문자열은 원본 표기(대기중(예정)/실행중(할인)/중지중/중지(마감))를 쓰고, 토스트 문구는 조사 문서 "실제 생성·저장 검증 기록" 에 수집된 문장을 그대로 쓴다.
- [ ] **Step 3:** `time-sale-model.spec.ts` 에 상태 판정 테스트를 추가(active+시작 전 = 대기중, active+기간 중 = 실행중, draft = 중지).
- [ ] **Step 4:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 9: 스토어프론트 — 더보기 전체 목록, 상품상세 상품 (P1-13, P1-14)

먼저 `web/almondyoung-storefront/CLAUDE.md`, `DESIGN.md` 를 읽는다. 원본 디자인 복제 지시가 DESIGN.md 와 부딪히는 곳은 원본을 따르고 PR 설명에 적는다.

**Files:**
- Modify: `web/almondyoung-storefront/src/domains/home/template/time-sale/index.tsx` (`MAX_PRODUCTS` 제거, `surface === 'more'` 이면 페이지 단위 조회)
- Modify: `web/almondyoung-storefront/src/domains/products/product-details/components/product-preview-price/index.tsx`
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(main)/time-sale/page.tsx`

**Interfaces:**
- 더보기: `?page=N` 서버 파라미터로 `columns * rows` 개씩 `/store/products?id=...` 를 조회한다(id 목록은 `/store/time-sale` 의 `productIds`). 렌더러 그리드의 페이지 버튼은 링크(`?page=N`)로 바뀐다. 페이지 윈도우 기본 5.
- 상품상세: `products` = 같은 세일의 다른 상품을 `display.order` 무관하게 최대 `columns * rows * 3` 개, 현재 상품 제외.
- 홈의 기존 고정 카테고리 탭 UI 는 지운 상태를 유지한다(사용자 결정 ②). 탭에서만 쓰던 컴포넌트·번역 키가 남았으면 같이 지운다.

- [ ] **Step 1:** 상품 120개짜리 세일을 로컬에 만들고 `/time-sale?page=20` (2×3) 에 상품 115~120 이 보이는지 확인할 수 있게 스크립트/시드를 준비한다(로컬 DB 만).
- [ ] **Step 2:** 구현 후 브라우저로 확인(ego-browser). 스크린샷을 `docs/time-sale-reference-evidence/ours/` 에 저장.
- [ ] **Step 3:** 스토어프론트 변경 파일만 `npx tsc --noEmit -p web/almondyoung-storefront` 결과에서 골라 에러 0 (기반 오류는 `git stash` 없이 develop 워크트리에서 따로 떠서 대조).
- [ ] **Step 4:** 형식 게이트 → **체크포인트** → Codex 리뷰.

---

### Task 10: 디자인 대조 + 최종 검증 + Codex 브랜치 리뷰 (P1-16)

- [ ] **Step 1:** 로컬 어드민에서 메인/더보기/상품상세 × 모바일/PC × 예정/할인/마감 18장 + 품절 ON 6장을 찍어 `docs/time-sale-reference-evidence/ours/` 에 두고, 원본 캡처와 나란히 비교한 표를 `docs/time-sale-verification-2026-10-07.md` 에 적는다(패널 폭·타이포·색은 `admin-design-measurements.json` 값과 대조). 다른 점은 "다름" 으로 적는다. 픽셀 동일이라고 쓰지 않는다.
- [ ] **Step 2:** 인계 문서에 적힌 "padding 16px 저장 중…" 테스트 값이 로컬 settings 에 남아 있는지 확인하고 원복한다.
- [ ] **Step 3:** 저장 → 새로고침 → 복원, 활성/중지/반복 회차 전환을 브라우저로 확인한다.
- [ ] **Step 4:** 전체 게이트.

```bash
npm run type-check
npx jest --maxWorkers=4
yarn --cwd apps/medusa test:unit --watchman=false
scripts/local/run-medusa-integration.sh
npx tsc --noEmit -p apps/admin-web
```
Expected: 전부 0 실패. 기반에서 이미 빨간 것은 develop 대조 결과를 함께 적는다.

- [ ] **Step 5:** 형식 게이트 마지막 실행.
- [ ] **Step 6:** `Agent(subagent_type: "codex:codex-rescue")` 로 브랜치 전체 리뷰. 넘길 것: 이 계획, 인계 문서, `git diff develop` + untracked 목록, Review Focus 5개. 중요 결함은 고치고 해당 태스크 테스트를 다시 돌린다.
- [ ] **Step 7:** 검증표의 완료/미완료를 그대로 사용자에게 보고한다. 커밋·푸시·배포는 사용자 지시 전에는 하지 않는다.

---

## 사용자 결정

1. **(결정됨)** 비공개 세일가 상품도 비회원이 장바구니에 담을 수 있고, 담기는 가격은 정상가다. 즉 비공개 세일은 비회원에게 가격만 숨기는 게 아니라 할인 자체가 적용되지 않는다. (Task 3, Task 4)
2. **(결정됨)** 홈 타임세일의 기존 카테고리 탭은 지운다. (Task 9)
3. **(결정됨)** 상품별 기간을 구현한다. 세일 하나 안에서 상품마다 시간이 다르고, 스토어프론트에는 섹션 하나로 나간다. (Task 3b)

<details><summary>결정 전 원문</summary>

**상품별 기간(원본 No.2 `[검증] 상품별 기간`) 을 구현하나?** Medusa price list 는 기간이 리스트 단위라 상품마다 price list 쌍이 하나씩 생긴다. 구현하면 Task 3 워크플로에 "상품별 기간 모드" 가 붙는 별도 태스크가 된다. 하지 않으면 폼에 미지원으로 표시한다(P1-12, 조용히 빼지 않는다).

</details>
