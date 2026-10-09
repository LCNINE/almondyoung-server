# 타임세일 Medusa 모듈 이전 + 10-09 사고 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타임세일 저장을 Medusa 서버의 워크플로 하나로 옮기고(`time_sale` 모듈 + price list 링크), 스토어프론트를 합본 한 섹션 + 전체 보기로 바꾸고, 10-09 에 삭제된 6개 세일을 비공개로 복구한다.

**Architecture:** Medusa 커스텀 모듈 `timeSale` 이 세일 행(이름·기간·상태)의 정본이고, `defineLink` 로 price list 1~2개(일반용·멤버십용)와 묶인다. 생성·수정·삭제는 core-flows 의 price list 워크플로를 조합한 커스텀 워크플로 3개가 하며 실패 시 보상으로 되감긴다. 어드민은 새 라우트를 한 번 부르고, 스토어프론트는 `/store/time-sale` 의 세일 목록 + 정렬된 상품 목록으로 합본을 그린다.

**Tech Stack:** Medusa v2.13.4 (core-flows, workflows-sdk, DML 모델, module links), Next.js 15 (admin-web, storefront), zod, jest(@swc/jest, Medusa), vitest(storefront), jest(admin-web, 루트).

**Spec:** `docs/superpowers/specs/2026-10-09-time-sale-module-design.md`

## Global Constraints

- core-flows 버전: `@medusajs/core-flows` **2.13.4** (`apps/medusa/node_modules/@medusajs/core-flows/package.json`).
- 모듈명 `timeSale`, 테이블 `time_sale`, id prefix `tsale`, 상태 어휘 `'draft' | 'active'`.
- 멤버십 리스트 판별 = `price_list_rule.attribute = 'customer.groups.id'` 존재. 별도 컬럼 없음.
- 멤버십 그룹 id 는 Medusa env `MEDUSA_MEMBERSHIP_GROUP_ID` (라이브 `cusgroup_01KFZ12A1M344F6HKGDV35J28A`, `deployments/lcnine/services/infra/services.ts:702`).
- 통화 `krw` 고정.
- 고객 응답(`/store/*`)에 세일 `title` 을 싣지 않는다.
- 제목으로 짝을 맞추는 코드(`saleKey`, `saleTitle`, `MEMBERSHIP_LIST_TITLE_SUFFIX` 의존)를 남기지 않는다.
- 스토어프론트 사용자 노출 문자열은 `next-intl` 키로만(ko/en/ja 세 파일 동시 수정). 내부 링크는 `LocalizedClientLink`.
- Medusa 통합 스펙은 `scripts/local/run-medusa-integration.sh` 로 돌린다(`npm run test:integration:*` 직접 호출 금지 — `DB_*` 파생이 래퍼에 있다). postgres·redis 둘 다 필요.
- 검증 게이트: 루트 `npm run type-check` 0, 루트 `npx jest` 0, `apps/medusa` 유닛, storefront `npm test`, admin-web `npm run test:admin-web`.
- 커밋은 태스크마다. 브랜치는 `fix/time-sale-module` (develop 에서 분기). 스키마(모델·마이그레이션)는 한 커밋에.

## Review Focus

1. **같은 variant 가 일반·멤버십 가격에 각각 한 번씩 있는 정상 입력**과 **한 리스트 안에 같은 variant 가 두 번 들어온 비정상 입력**을 구분해야 한다 — 후자는 400, 전자는 통과. (Task 2 테스트 `rejects duplicate variant within one audience`)
2. **draft 세일끼리 같은 variant 를 공유**해도 저장돼야 한다(복구 세일 6개 중 겹침이 생길 수 있다). 겹침 차단은 active 끼리만, draft → active 전환 시에 검사. (Task 2 `ignores draft sales`, Task 3 `publishing a draft re-checks conflicts`)
3. **수정에서 멤버십 가격을 전부 지우면** 멤버십 리스트가 삭제·링크 해제되고, 다시 넣으면 새 리스트가 생겨야 한다. 옛 리스트가 남으면 구독자만 옛 가격에 산다. (Task 3 `removes and recreates membership list`)
4. **741품목 수정 후 리스트당 살아있는 가격 행 수 = 품목 수** — 오늘 사고의 직접 회귀 테스트. (Task 3 `replaces prices without accumulating`)
5. **옛 Medusa 응답(`products` 없음)을 받은 새 스토어프론트**가 예외 없이 섹션을 그린다. (Task 6 `falls back when products is missing`)

---

## File Structure

**Medusa (`apps/medusa`)**
- Create `src/modules/time-sale/index.ts` — 모듈 등록, `TIME_SALE_MODULE`.
- Create `src/modules/time-sale/models/time-sale.ts` — DML 모델.
- Create `src/modules/time-sale/service.ts` — `MedusaService({ TimeSale })`.
- Create `src/modules/time-sale/migrations/Migration20261009120000.ts` — `db:generate` 산출물.
- Create `src/links/time-sale-price-list.ts` — 링크.
- Modify `medusa-config.js` — 모듈 등록.
- Create `src/workflows/time-sale/rules.ts` — 순수 함수(검증·겹침·페이로드·수정 계획). 워크플로/라우트/스크립트가 공유.
- Create `src/workflows/time-sale/steps.ts` — 커스텀 스텝(세일 행 CRUD + 보상, 컨텍스트 로드, 검증).
- Create `src/workflows/time-sale/workflows.ts` — create/update/delete 워크플로.
- Create `src/workflows/time-sale/__tests__/rules.unit.spec.ts`.
- Modify `src/utils/time-sale.ts` — 읽기 경로를 `time_sale` 기준으로 재작성(제목 짝 맞추기 삭제).
- Create `src/utils/storefront-revalidate.ts` — 경계 크론에서 무효화 호출을 빼낸 것.
- Modify `src/jobs/time-sale-cache-boundary.ts` — 위 유틸 사용.
- Modify `src/utils/__tests__/time-sale.unit.spec.ts` — 새 읽기 경로에 맞춤.
- Create `src/api/admin/time-sales/validators.ts`, `src/api/admin/time-sales/middlewares.ts`.
- Modify `src/api/admin/time-sales/route.ts` (GET 목록, POST 생성).
- Create `src/api/admin/time-sales/[id]/route.ts` (GET, POST, DELETE).
- Modify `src/api/admin/middlewares.ts` — 타임세일 미들웨어 합치기.
- Modify `src/api/store/time-sale/route.ts` — 응답 형태.
- Create `integration-tests/http/time-sale.spec.ts`.

**admin-web (`apps/admin-web`)**
- Modify `src/lib/api/domains/medusa/time-sales.ts` — 새 라우트 클라이언트.
- Modify `src/lib/api/domains/medusa/price-lists.ts` — 타임세일 전용 함수 제거.
- Modify `src/lib/services/time-sale.ts` — 훅 재작성.
- Modify `src/features/mall/marketing/time-sale/time-sale-model.ts` (+ `.spec.ts`) — 페이로드 빌더를 새 입력형으로, 상태 판정에 draft.
- Modify `src/features/mall/marketing/time-sale/template/marketing-time-sale-template.tsx` — 비공개 배지·전환 버튼·id key.
- Modify `src/features/mall/marketing/time-sale/template/time-sale-form-template.tsx` — 새 훅 시그니처.
- Modify `src/app/(admin)/mall/marketing/time-sale/[id]/edit/page.tsx` — prop 이름 `timeSaleId`.

**storefront (`web/almondyoung-storefront`)**
- Modify `src/lib/api/medusa/time-sale.ts` — 새 응답 타입, 폴백.
- Create `src/lib/utils/time-sale-merge.ts` (+ `.test.ts`) — 합본 파생 순수 함수.
- Modify `src/domains/home/template/time-sale/index.tsx` — 섹션 하나.
- Modify `src/domains/home/components/sections/time-sale-section/index.tsx` — 카드별 종료 시각.
- Create `src/domains/time-sale/templates/time-sale-all-template.tsx` — 전체 보기(탭 + 페이지).
- Modify `src/app/[countryCode]/(main)/time-sale/page.tsx` — 새 템플릿, `searchParams`.
- Modify `src/i18n/messages/{ko,en,ja}/home.json` — 페이지 문구.

**복구 (`scripts/ops/time-sale-recovery-2026-10-09/`)**
- Create `reconstruct.ts` (+ `reconstruct.spec.ts`) — 백업 → 복구 입력 순수 함수.
- Create `run.ts` — CLI(`--dry-run` 기본, `--apply`), Medusa admin API 호출.
- Create `README.md` — 실행 절차.

---

### Task 1: `timeSale` 모듈 · 링크 · 마이그레이션

**Files:**
- Create: `apps/medusa/src/modules/time-sale/index.ts`, `models/time-sale.ts`, `service.ts`, `migrations/Migration20261009120000.ts`
- Create: `apps/medusa/src/links/time-sale-price-list.ts`
- Modify: `apps/medusa/medusa-config.js` (모듈 배열, `./src/modules/promotion-meta` 다음)
- Test: `apps/medusa/integration-tests/http/time-sale.spec.ts` (이 태스크에선 모듈·링크 스모크 한 케이스만)

**Interfaces:**
- Produces: `TIME_SALE_MODULE = 'timeSale'`; `TimeSaleModuleService` 의 생성 메서드 `createTimeSales`, `updateTimeSales`, `softDeleteTimeSales`, `restoreTimeSales`, `deleteTimeSales`, `retrieveTimeSale`, `listTimeSales`; `TimeSaleRecord = { id: string; title: string; starts_at: Date; ends_at: Date; status: 'draft' | 'active' }`. 링크 필드: `time_sale.price_lists`, 링크 키 `{ [TIME_SALE_MODULE]: { time_sale_id }, [Modules.PRICING]: { price_list_id } }`.

- [ ] **Step 1: 브랜치**

```bash
git switch develop && git pull --ff-only && git switch -c fix/time-sale-module
```

- [ ] **Step 2: 모델·서비스·모듈 작성**

`apps/medusa/src/modules/time-sale/models/time-sale.ts`:
```ts
import { model } from '@medusajs/framework/utils';

/**
 * 타임세일 한 건. 기간·상태의 정본이고, 가격은 링크된 price list(일반용 1 + 멤버십용 0~1)에 있다.
 *
 * price list 에는 metadata 가 없어 짝을 묶을 자리가 없었다 — 그래서 한때 «제목 + 시작 시각» 으로
 * 짝을 맞췄고, 수정이 중간에 멈추자 세일이 둘로 갈렸다(2026-10-09 사고). 짝은 이 행과의 링크다.
 *
 * `title` 은 어드민 전용이다. 고객 응답에 싣지 않는다.
 */
const TimeSale = model.define(
  { name: 'TimeSale', tableName: 'time_sale' },
  {
    id: model.id({ prefix: 'tsale' }).primaryKey(),
    title: model.text(),
    starts_at: model.dateTime(),
    ends_at: model.dateTime(),
    // draft 는 연결된 price list 도 draft 라 가격 계산에서 빠진다 — 고객에게 안 보인다.
    status: model.enum(['draft', 'active']).default('draft'),
  },
);

export default TimeSale;
```

`apps/medusa/src/modules/time-sale/service.ts`:
```ts
import { MedusaService } from '@medusajs/framework/utils';
import TimeSale from './models/time-sale';

export type TimeSaleStatus = 'draft' | 'active';

export type TimeSaleRecord = {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  status: TimeSaleStatus;
};

class TimeSaleModuleService extends MedusaService({ TimeSale }) {}

export default TimeSaleModuleService;
```

`apps/medusa/src/modules/time-sale/index.ts`:
```ts
import { Module } from '@medusajs/framework/utils';
import TimeSaleModuleService from './service';

export const TIME_SALE_MODULE = 'timeSale';

export default Module(TIME_SALE_MODULE, {
  service: TimeSaleModuleService,
});
```

`apps/medusa/src/links/time-sale-price-list.ts`:
```ts
import { defineLink } from '@medusajs/framework/utils';
import PricingModule from '@medusajs/medusa/pricing';
import TimeSaleModule from '../modules/time-sale';

// 세일 하나 ↔ price list 1~2개(일반용·멤버십용). 일반/멤버십 구분은 리스트의 customer.groups.id 규칙으로 한다
// — 같은 사실을 링크 컬럼에 또 적으면 둘이 갈릴 수 있다.
export default defineLink(TimeSaleModule.linkable.timeSale, {
  linkable: PricingModule.linkable.priceList,
  isList: true,
});
```

`apps/medusa/medusa-config.js` — `{ resolve: './src/modules/promotion-meta' },` 바로 다음 줄에:
```js
    {
      resolve: './src/modules/time-sale',
    },
```

- [ ] **Step 3: 마이그레이션 생성**

로컬 postgres 가 떠 있어야 한다(`npm run bootstrap:e2e:local` 이 띄운다).
```bash
cd apps/medusa && npx medusa db:generate timeSale
ls src/modules/time-sale/migrations/
```
Expected: `Migration2026...ts` 하나. 파일명을 `Migration20261009120000.ts` 로, 클래스명을 `Migration20261009120000` 으로 바꾼다. 내용에 `create table if not exists "time_sale"` 와 `status` 체크 제약(`check ("status" in ('draft', 'active'))`)이 있는지 본다. 없으면 모델을 고치고 재생성.

- [ ] **Step 4: 로컬 적용 확인**

```bash
cd apps/medusa && npx medusa db:migrate --execute-safe-links
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -c '\dt time_sale*'
```
Expected: `time_sale` 과 링크 테이블(`..._time_sale_..._price_list` 꼴) 두 개.

- [ ] **Step 5: 스모크 통합 스펙 작성**

`apps/medusa/integration-tests/http/time-sale.spec.ts` (이후 태스크가 같은 파일에 케이스를 더한다):
```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { TIME_SALE_MODULE } from '../../src/modules/time-sale';
import type TimeSaleModuleService from '../../src/modules/time-sale/service';

jest.setTimeout(180 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    describe('time_sale 모듈·링크', () => {
      it('세일 행을 만들고 price list 와 링크한다', async () => {
        const container = getContainer();
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        const pricing = container.resolve(Modules.PRICING);
        const link = container.resolve(ContainerRegistrationKeys.LINK);
        const query = container.resolve(ContainerRegistrationKeys.QUERY);

        const sale = await timeSales.createTimeSales({
          title: '스모크',
          starts_at: new Date('2030-01-01T00:00:00Z'),
          ends_at: new Date('2030-01-02T00:00:00Z'),
        });
        const [list] = await pricing.createPriceLists([
          { title: '스모크', description: '타임세일 (전체)', type: 'sale', status: 'draft' },
        ]);
        await link.create({
          [TIME_SALE_MODULE]: { time_sale_id: sale.id },
          [Modules.PRICING]: { price_list_id: list.id },
        });

        const { data } = await query.graph({
          entity: 'time_sale',
          fields: ['id', 'status', 'price_lists.id'],
          filters: { id: sale.id },
        });
        expect(data[0].status).toBe('draft');
        expect(data[0].price_lists.map((p: { id: string }) => p.id)).toEqual([list.id]);
      });
    });
  },
});
```

- [ ] **Step 6: 실행**

```bash
scripts/local/run-medusa-integration.sh -- integration-tests/http/time-sale.spec.ts
```
Expected: PASS 1. (래퍼가 인자를 jest 로 넘기지 않으면 `docs/local-dev.md §6` 의 형식대로 파일 필터를 준다.) 링크 필드 이름이 `price_lists` 가 아니면 실패 메시지의 필드명으로 이후 태스크 전부를 맞춘다.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/time-sale apps/medusa/src/links/time-sale-price-list.ts apps/medusa/medusa-config.js apps/medusa/integration-tests/http/time-sale.spec.ts
git commit -m "feat(medusa): 타임세일 모듈과 price list 링크를 추가한다"
```

---

### Task 2: 순수 규칙 — 검증 · 겹침 · 페이로드 · 수정 계획

**Files:**
- Create: `apps/medusa/src/workflows/time-sale/rules.ts`
- Test: `apps/medusa/src/workflows/time-sale/__tests__/rules.unit.spec.ts`

**Interfaces:**
- Produces (모두 `rules.ts` export):
  - `type TimeSalePriceInput = { variant_id: string; amount: number }`
  - `type TimeSaleWriteInput = { title: string; starts_at: string; ends_at: string; status: 'draft' | 'active'; general_prices: TimeSalePriceInput[]; membership_prices: TimeSalePriceInput[] }`
  - `validateTimeSaleInput(input: TimeSaleWriteInput): string[]` — 사람이 읽는 오류 문장들, 비면 통과
  - `type SaleFootprint = { id: string; title: string; starts_at: string; ends_at: string; status: 'draft' | 'active'; variantIds: string[] }`
  - `findConflictingSales(candidate: Omit<SaleFootprint, 'id' | 'title'> & { id?: string }, others: SaleFootprint[]): Array<{ id: string; title: string; variantIds: string[] }>`
  - `type PriceListCreateData` (core-flows `createPriceListsWorkflow` 의 `price_lists_data` 원소와 같은 모양)
  - `buildPriceListData(params: { title: string; starts_at: string; ends_at: string; status: 'draft' | 'active'; audience: 'general' | 'membership'; prices: TimeSalePriceInput[]; regionIds: string[]; membershipGroupId: string }): PriceListCreateData`
  - `type LinkedList = { id: string; isMembership: boolean; priceIds: string[] }`
  - `type TimeSaleUpdatePlan = { listUpdates: Array<{ id: string; title: string; starts_at: string; ends_at: string; status: 'draft' | 'active' }>; listsToCreate: PriceListCreateData[]; listIdsToDelete: string[]; pricesToCreate: Array<{ id: string; prices: Array<TimeSalePriceInput & { currency_code: 'krw' }> }>; priceIdsToDelete: string[] }`
  - `planTimeSaleUpdate(params: { input: TimeSaleWriteInput; lists: LinkedList[]; regionIds: string[]; membershipGroupId: string }): TimeSaleUpdatePlan`
  - `MEMBERSHIP_LIST_DESCRIPTION = '타임세일 (멤버십 구독자)'`, `GENERAL_LIST_DESCRIPTION = '타임세일 (전체)'`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/medusa/src/workflows/time-sale/__tests__/rules.unit.spec.ts`:
```ts
import {
  buildPriceListData,
  findConflictingSales,
  planTimeSaleUpdate,
  validateTimeSaleInput,
  type TimeSaleWriteInput,
} from '../rules';

const base: TimeSaleWriteInput = {
  title: '가을 세일',
  starts_at: '2030-01-01T00:00:00.000Z',
  ends_at: '2030-01-08T00:00:00.000Z',
  status: 'active',
  general_prices: [
    { variant_id: 'v1', amount: 900 },
    { variant_id: 'v2', amount: 800 },
  ],
  membership_prices: [{ variant_id: 'v1', amount: 700 }],
};

describe('validateTimeSaleInput', () => {
  it('passes a well-formed input', () => {
    expect(validateTimeSaleInput(base)).toEqual([]);
  });

  it('rejects empty title, inverted period and empty general prices', () => {
    const errors = validateTimeSaleInput({
      ...base,
      title: '  ',
      ends_at: base.starts_at,
      general_prices: [],
      membership_prices: [],
    });
    expect(errors).toHaveLength(3);
  });

  it('rejects non-positive and non-finite amounts', () => {
    const errors = validateTimeSaleInput({
      ...base,
      general_prices: [
        { variant_id: 'v1', amount: 0 },
        { variant_id: 'v2', amount: Number.NaN },
      ],
      membership_prices: [],
    });
    expect(errors).toHaveLength(2);
  });

  it('rejects duplicate variant within one audience', () => {
    const errors = validateTimeSaleInput({
      ...base,
      general_prices: [...base.general_prices, { variant_id: 'v1', amount: 850 }],
    });
    expect(errors.some((e) => e.includes('v1'))).toBe(true);
  });

  it('allows the same variant once in general and once in membership', () => {
    expect(validateTimeSaleInput(base)).toEqual([]);
  });

  it('rejects membership variant missing from general prices', () => {
    const errors = validateTimeSaleInput({
      ...base,
      membership_prices: [{ variant_id: 'v9', amount: 100 }],
    });
    expect(errors.some((e) => e.includes('v9'))).toBe(true);
  });
});

describe('findConflictingSales', () => {
  const other = {
    id: 'tsale_b',
    title: 'B',
    starts_at: '2030-01-05T00:00:00.000Z',
    ends_at: '2030-01-10T00:00:00.000Z',
    status: 'active' as const,
    variantIds: ['v2', 'v3'],
  };
  const candidate = {
    starts_at: base.starts_at,
    ends_at: base.ends_at,
    status: 'active' as const,
    variantIds: ['v1', 'v2'],
  };

  it('reports overlapping active sales sharing a variant', () => {
    expect(findConflictingSales(candidate, [other])).toEqual([
      { id: 'tsale_b', title: 'B', variantIds: ['v2'] },
    ]);
  });

  it('ignores sales whose period does not overlap', () => {
    expect(
      findConflictingSales(candidate, [{ ...other, starts_at: base.ends_at, ends_at: '2030-02-01T00:00:00.000Z' }]),
    ).toEqual([]);
  });

  it('ignores draft sales on either side', () => {
    expect(findConflictingSales(candidate, [{ ...other, status: 'draft' }])).toEqual([]);
    expect(findConflictingSales({ ...candidate, status: 'draft' }, [other])).toEqual([]);
  });

  it('ignores itself', () => {
    expect(findConflictingSales({ ...candidate, id: 'tsale_b' }, [other])).toEqual([]);
  });
});

describe('buildPriceListData', () => {
  it('builds a general list with a region rule', () => {
    const data = buildPriceListData({
      title: '가을 세일',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      status: 'draft',
      audience: 'general',
      prices: base.general_prices,
      regionIds: ['reg_1'],
      membershipGroupId: 'cusgroup_1',
    });
    expect(data).toEqual({
      title: '가을 세일',
      description: '타임세일 (전체)',
      type: 'sale',
      status: 'draft',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      rules: { region_id: ['reg_1'] },
      prices: [
        { variant_id: 'v1', amount: 900, currency_code: 'krw' },
        { variant_id: 'v2', amount: 800, currency_code: 'krw' },
      ],
    });
  });

  it('builds a membership list with a customer group rule', () => {
    const data = buildPriceListData({
      title: '가을 세일',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      status: 'active',
      audience: 'membership',
      prices: base.membership_prices,
      regionIds: ['reg_1'],
      membershipGroupId: 'cusgroup_1',
    });
    expect(data.rules).toEqual({ 'customer.groups.id': ['cusgroup_1'] });
    expect(data.description).toBe('타임세일 (멤버십 구독자)');
  });
});

describe('planTimeSaleUpdate', () => {
  const lists = [
    { id: 'plist_g', isMembership: false, priceIds: ['p1', 'p2'] },
    { id: 'plist_m', isMembership: true, priceIds: ['p3'] },
  ];
  const ctx = { regionIds: ['reg_1'], membershipGroupId: 'cusgroup_1' };

  it('replaces every existing price and updates both lists', () => {
    const plan = planTimeSaleUpdate({ input: base, lists, ...ctx });
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(plan.pricesToCreate).toEqual([
      {
        id: 'plist_g',
        prices: [
          { variant_id: 'v1', amount: 900, currency_code: 'krw' },
          { variant_id: 'v2', amount: 800, currency_code: 'krw' },
        ],
      },
      { id: 'plist_m', prices: [{ variant_id: 'v1', amount: 700, currency_code: 'krw' }] },
    ]);
    expect(plan.listUpdates.map((u) => u.id).sort()).toEqual(['plist_g', 'plist_m']);
    expect(plan.listsToCreate).toEqual([]);
    expect(plan.listIdsToDelete).toEqual([]);
  });

  it('deletes the membership list when membership prices become empty', () => {
    const plan = planTimeSaleUpdate({ input: { ...base, membership_prices: [] }, lists, ...ctx });
    expect(plan.listIdsToDelete).toEqual(['plist_m']);
    expect(plan.pricesToCreate.map((p) => p.id)).toEqual(['plist_g']);
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
    expect(plan.listUpdates.map((u) => u.id)).toEqual(['plist_g']);
  });

  it('creates a membership list when one did not exist', () => {
    const plan = planTimeSaleUpdate({ input: base, lists: [lists[0]], ...ctx });
    expect(plan.listsToCreate).toHaveLength(1);
    expect(plan.listsToCreate[0].rules).toEqual({ 'customer.groups.id': ['cusgroup_1'] });
    expect(plan.pricesToCreate.map((p) => p.id)).toEqual(['plist_g']);
  });

  it('throws when the general list is missing (broken invariant)', () => {
    expect(() => planTimeSaleUpdate({ input: base, lists: [lists[1]], ...ctx })).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/workflows/time-sale/__tests__/rules.unit.spec.ts`
Expected: FAIL — `Cannot find module '../rules'`.

- [ ] **Step 3: 구현**

`apps/medusa/src/workflows/time-sale/rules.ts`:
```ts
/**
 * 타임세일 저장의 판정 규칙. 워크플로·라우트·복구 스크립트가 같은 규칙을 쓰도록 순수 함수로 둔다.
 *
 * 세일 하나 = `time_sale` 행 + price list 두 개까지.
 *   - 일반용   : rules = { region_id: [...] }            → 전원
 *   - 멤버십용 : rules = { 'customer.groups.id': [...] } → 멤버십 구독자
 * 둘 다 룰이 1 개인 이유: Medusa 는 `rules_count 내림 → amount 오름` 으로 가격을 고른다. 상시 운영되는
 * `Membership Prices` 가 룰 1 개라, 세일 리스트가 룰 0 개면 아무리 싸도 진다.
 */

export type TimeSaleStatus = 'draft' | 'active';
export type TimeSalePriceInput = { variant_id: string; amount: number };

export type TimeSaleWriteInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  general_prices: TimeSalePriceInput[];
  membership_prices: TimeSalePriceInput[];
};

export const GENERAL_LIST_DESCRIPTION = '타임세일 (전체)';
export const MEMBERSHIP_LIST_DESCRIPTION = '타임세일 (멤버십 구독자)';
const CURRENCY = 'krw' as const;

const duplicates = (prices: TimeSalePriceInput[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { variant_id } of prices) {
    if (seen.has(variant_id)) dup.add(variant_id);
    seen.add(variant_id);
  }
  return [...dup];
};

export function validateTimeSaleInput(input: TimeSaleWriteInput): string[] {
  const errors: string[] = [];

  if (!input.title.trim()) errors.push('세일 이름이 비어 있습니다.');
  if (!(Date.parse(input.ends_at) > Date.parse(input.starts_at))) {
    errors.push('종료 시각은 시작 시각보다 뒤여야 합니다.');
  }
  if (input.general_prices.length === 0) errors.push('세일가를 넣은 품목이 하나도 없습니다.');

  for (const [label, prices] of [
    ['일반', input.general_prices],
    ['멤버십', input.membership_prices],
  ] as const) {
    for (const price of prices) {
      // NaN·Infinity 는 비교가 전부 false 라 걸러내지 않으면 `amount: null` 로 직렬화돼 Medusa 까지 간다.
      if (!Number.isFinite(price.amount) || price.amount <= 0) {
        errors.push(`${label} 세일가는 0보다 큰 숫자여야 합니다 (${price.variant_id}).`);
      }
    }
    const dup = duplicates(prices);
    if (dup.length > 0) errors.push(`${label} 세일가에 같은 품목이 두 번 있습니다: ${dup.join(', ')}`);
  }

  // 멤버십 세일가만 있고 일반 세일가가 없는 품목은 «구독자만 싸게 사는» 상태라 막는다.
  const general = new Set(input.general_prices.map((p) => p.variant_id));
  const orphan = input.membership_prices.filter((p) => !general.has(p.variant_id)).map((p) => p.variant_id);
  if (orphan.length > 0) errors.push(`일반 세일가 없이 멤버십 세일가만 있는 품목: ${orphan.join(', ')}`);

  return errors;
}

export type SaleFootprint = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  variantIds: string[];
};

/**
 * 기간이 겹치고 같은 품목을 쓰는 active 세일. 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽 가격만
 * 적용해, 손님은 A 세일 목록에서 B 의 가격과 A 의 카운트다운을 보게 된다.
 *
 * draft 는 가격 계산에서 빠지므로 어느 쪽이든 draft 면 겹침이 아니다 — 대신 공개(draft → active)할 때
 * 이 검사를 다시 탄다.
 */
export function findConflictingSales(
  candidate: Omit<SaleFootprint, 'id' | 'title'> & { id?: string },
  others: SaleFootprint[],
): Array<{ id: string; title: string; variantIds: string[] }> {
  if (candidate.status !== 'active') return [];
  const start = Date.parse(candidate.starts_at);
  const end = Date.parse(candidate.ends_at);
  const mine = new Set(candidate.variantIds);

  return others
    .filter((other) => other.id !== candidate.id && other.status === 'active')
    .filter((other) => start < Date.parse(other.ends_at) && end > Date.parse(other.starts_at))
    .map((other) => ({
      id: other.id,
      title: other.title,
      variantIds: other.variantIds.filter((id) => mine.has(id)),
    }))
    .filter((conflict) => conflict.variantIds.length > 0);
}

export type PriceListCreateData = {
  title: string;
  description: string;
  type: 'sale';
  status: TimeSaleStatus;
  starts_at: string;
  ends_at: string;
  rules: Record<string, string[]>;
  prices: Array<TimeSalePriceInput & { currency_code: typeof CURRENCY }>;
};

const withCurrency = (prices: TimeSalePriceInput[]) =>
  prices.map((p) => ({ variant_id: p.variant_id, amount: p.amount, currency_code: CURRENCY }));

export function buildPriceListData(params: {
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  audience: 'general' | 'membership';
  prices: TimeSalePriceInput[];
  regionIds: string[];
  membershipGroupId: string;
}): PriceListCreateData {
  const membership = params.audience === 'membership';
  return {
    title: params.title,
    description: membership ? MEMBERSHIP_LIST_DESCRIPTION : GENERAL_LIST_DESCRIPTION,
    type: 'sale',
    status: params.status,
    starts_at: params.starts_at,
    ends_at: params.ends_at,
    rules: membership ? { 'customer.groups.id': [params.membershipGroupId] } : { region_id: params.regionIds },
    prices: withCurrency(params.prices),
  };
}

export type LinkedList = { id: string; isMembership: boolean; priceIds: string[] };

export type TimeSaleUpdatePlan = {
  listUpdates: Array<{ id: string; title: string; starts_at: string; ends_at: string; status: TimeSaleStatus }>;
  listsToCreate: PriceListCreateData[];
  listIdsToDelete: string[];
  pricesToCreate: Array<{ id: string; prices: Array<TimeSalePriceInput & { currency_code: typeof CURRENCY }> }>;
  priceIdsToDelete: string[];
};

/**
 * 수정 한 번이 바꿀 것을 미리 계산한다. 가격은 **전부 지우고 새로 넣는다** — 개별 diff 는 빠진 상품의
 * 행을 놓쳐, 세일에서 뺐다고 생각한 상품이 계속 세일가로 팔린다.
 *
 * 지울 가격 id 는 서버가 DB 에서 직접 얻은 것이어야 한다(호출자가 `getExistingPriceListsPriceIdsStep` 로
 * 채운다). 2026-10-09 사고는 이 목록을 브라우저가 Admin API 응답에서 얻다가 빈 채로 받아, 지우지 못하고
 * 덧붙인 것이다.
 */
export function planTimeSaleUpdate(params: {
  input: TimeSaleWriteInput;
  lists: LinkedList[];
  regionIds: string[];
  membershipGroupId: string;
}): TimeSaleUpdatePlan {
  const { input, lists, regionIds, membershipGroupId } = params;
  const general = lists.find((list) => !list.isMembership);
  if (!general) throw new Error('일반용 price list 가 연결되지 않은 타임세일입니다.');
  const membership = lists.find((list) => list.isMembership) ?? null;
  const wantsMembership = input.membership_prices.length > 0;

  const meta = { title: input.title, starts_at: input.starts_at, ends_at: input.ends_at, status: input.status };
  const plan: TimeSaleUpdatePlan = {
    listUpdates: [{ id: general.id, ...meta }],
    listsToCreate: [],
    listIdsToDelete: [],
    pricesToCreate: [{ id: general.id, prices: withCurrency(input.general_prices) }],
    priceIdsToDelete: [...general.priceIds],
  };

  if (membership && wantsMembership) {
    plan.listUpdates.push({ id: membership.id, ...meta });
    plan.pricesToCreate.push({ id: membership.id, prices: withCurrency(input.membership_prices) });
    plan.priceIdsToDelete.push(...membership.priceIds);
  } else if (membership && !wantsMembership) {
    // 리스트를 지우면 가격도 함께 사라진다. 옛 리스트가 남으면 구독자만 옛 가격에 산다.
    plan.listIdsToDelete.push(membership.id);
  } else if (!membership && wantsMembership) {
    plan.listsToCreate.push(
      buildPriceListData({ ...meta, audience: 'membership', prices: input.membership_prices, regionIds, membershipGroupId }),
    );
  }

  return plan;
}
```

- [ ] **Step 4: 통과 확인**

Run: 위 Step 2 명령. Expected: PASS (17 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/workflows/time-sale/rules.ts apps/medusa/src/workflows/time-sale/__tests__/rules.unit.spec.ts
git commit -m "feat(medusa): 타임세일 저장 규칙(검증·겹침·수정 계획)을 순수 함수로 둔다"
```

---

### Task 3: 워크플로 3개 (생성 · 수정 · 삭제)

**Files:**
- Create: `apps/medusa/src/workflows/time-sale/steps.ts`
- Create: `apps/medusa/src/workflows/time-sale/workflows.ts`
- Test: `apps/medusa/integration-tests/http/time-sale.spec.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 1 의 `TIME_SALE_MODULE`, `TimeSaleModuleService`; Task 2 의 `TimeSaleWriteInput`, `validateTimeSaleInput`, `findConflictingSales`, `buildPriceListData`, `planTimeSaleUpdate`, `LinkedList`, `SaleFootprint`.
- Produces:
  - `createTimeSaleWorkflow` — input `TimeSaleWriteInput`, result `{ id: string }`
  - `updateTimeSaleWorkflow` — input `TimeSaleWriteInput & { id: string }`, result `{ id: string }`
  - `deleteTimeSaleWorkflow` — input `{ id: string }`, result `{ id: string }`
  - `loadTimeSaleFootprints(container, excludeId?: string): Promise<SaleFootprint[]>` (steps.ts export, Task 4 도 쓴다)
  - `loadLinkedLists(container, timeSaleId: string): Promise<LinkedList[]>` (steps.ts export)
  - 오류: 검증 실패는 `MedusaError(INVALID_DATA, message)` → HTTP 400. 겹침은 메시지에 세일 이름과 품목 수.

core-flows 의 각 스텝은 보상이 있다(실측: `create-price-lists`→`deletePriceLists`, `update-price-lists`→이전값 복원, `delete-price-lists`→`restorePriceLists`, `create-price-list-prices`→`removePrices`, `remove-price-list-prices`→`restorePrices`). 우리 스텝도 각각 보상을 단다.

- [ ] **Step 1: 실패하는 통합 테스트 추가**

`integration-tests/http/time-sale.spec.ts` 의 `testSuite` 안, 기존 `describe` 뒤에 추가. 상단 import 에 다음을 더한다:
```ts
import { createProductsWorkflow, createRegionsWorkflow } from '@medusajs/medusa/core-flows';
import {
  createTimeSaleWorkflow,
  deleteTimeSaleWorkflow,
  updateTimeSaleWorkflow,
} from '../../src/workflows/time-sale/workflows';
```
`medusaIntegrationTestRunner` 옵션에 `env: { MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_test' }` 를 더한다(검증 스텝이 읽는다. 링크 규칙 값일 뿐 실재 그룹일 필요는 없다).

```ts
    describe('타임세일 워크플로', () => {
      let variantIds: string[] = [];

      // 러너가 테스트마다 DB 를 비운다 — 매번 리전·상품을 만든다.
      beforeEach(async () => {
        const container = getContainer();
        await createRegionsWorkflow(container).run({
          input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
        });
        const { result } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: '세일 상품',
                status: 'published',
                options: [{ title: '색', values: Array.from({ length: 741 }, (_, i) => `c${i}`) }],
                variants: Array.from({ length: 741 }, (_, i) => ({
                  title: `c${i}`,
                  options: { 색: `c${i}` },
                  prices: [{ amount: 1000, currency_code: 'krw' }],
                })),
              },
            ],
          },
        });
        variantIds = result[0].variants.map((v: { id: string }) => v.id);
      });

      const input = (overrides: Record<string, unknown> = {}) => ({
        title: '가을 세일',
        starts_at: '2030-01-01T00:00:00.000Z',
        ends_at: '2030-01-08T00:00:00.000Z',
        status: 'active' as const,
        general_prices: variantIds.map((id) => ({ variant_id: id, amount: 900 })),
        membership_prices: variantIds.slice(0, 10).map((id) => ({ variant_id: id, amount: 800 })),
        ...overrides,
      });

      const livePriceCount = async (priceListId: string) => {
        const pricing = getContainer().resolve(Modules.PRICING);
        const prices = await pricing.listPrices({ price_list_id: [priceListId] });
        return prices.length;
      };

      const linkedLists = async (id: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
        const { data } = await query.graph({
          entity: 'time_sale',
          fields: ['id', 'status', 'title', 'price_lists.id', 'price_lists.status', 'price_lists.title'],
          filters: { id },
        });
        return data[0];
      };

      it('creates a sale with general and membership lists', async () => {
        const { result } = await createTimeSaleWorkflow(getContainer()).run({ input: input() });
        const sale = await linkedLists(result.id);
        expect(sale.price_lists).toHaveLength(2);
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('replaces prices without accumulating', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        for (let i = 0; i < 3; i++) {
          await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ title: `수정 ${i}` }) } });
        }
        const sale = await linkedLists(result.id);
        expect(sale.title).toBe('수정 2');
        for (const list of sale.price_lists) expect(list.title).toBe('수정 2');
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('removes and recreates membership list', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ membership_prices: [] }) } });
        expect((await linkedLists(result.id)).price_lists).toHaveLength(1);
        await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input() } });
        expect((await linkedLists(result.id)).price_lists).toHaveLength(2);
      });

      it('rejects a second active sale sharing a variant in an overlapping period', async () => {
        const container = getContainer();
        await createTimeSaleWorkflow(container).run({ input: input() });
        await expect(
          createTimeSaleWorkflow(container).run({ input: input({ title: '겹침', membership_prices: [] }) }),
        ).rejects.toThrow(/가을 세일/);
      });

      it('publishing a draft re-checks conflicts', async () => {
        const container = getContainer();
        await createTimeSaleWorkflow(container).run({ input: input() });
        const { result } = await createTimeSaleWorkflow(container).run({
          input: input({ title: '복구', status: 'draft', membership_prices: [] }),
        });
        await expect(
          updateTimeSaleWorkflow(container).run({
            input: { id: result.id, ...input({ title: '복구', status: 'active', membership_prices: [] }) },
          }),
        ).rejects.toThrow(/가을 세일/);
      });

      it('draft sale mirrors draft status onto its price lists', async () => {
        const { result } = await createTimeSaleWorkflow(getContainer()).run({ input: input({ status: 'draft' }) });
        const sale = await linkedLists(result.id);
        expect(sale.price_lists.map((p: { status: string }) => p.status)).toEqual(['draft', 'draft']);
      });

      it('rolls back the sale row and lists when a later step fails', async () => {
        const container = getContainer();
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        const before = await timeSales.listTimeSales({});
        // 존재하지 않는 variant 는 core-flows 의 validateVariantPriceLinksStep 에서 던진다 — 세일 행 생성 «뒤».
        await expect(
          createTimeSaleWorkflow(container).run({
            input: input({ general_prices: [{ variant_id: 'variant_missing', amount: 900 }], membership_prices: [] }),
          }),
        ).rejects.toThrow();
        expect(await timeSales.listTimeSales({})).toHaveLength(before.length);
      });

      it('deletes lists, links and the sale row', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        const listIds = (await linkedLists(result.id)).price_lists.map((p: { id: string }) => p.id);
        await deleteTimeSaleWorkflow(container).run({ input: { id: result.id } });
        const pricing = container.resolve(Modules.PRICING);
        expect(await pricing.listPriceLists({ id: listIds })).toHaveLength(0);
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        expect(await timeSales.listTimeSales({ id: result.id })).toHaveLength(0);
      });
    });
```

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/time-sale.spec.ts`
Expected: FAIL — `Cannot find module '../../src/workflows/time-sale/workflows'`.

- [ ] **Step 3: 스텝 구현**

`apps/medusa/src/workflows/time-sale/steps.ts`:
```ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { TIME_SALE_MODULE } from '../../modules/time-sale';
import type TimeSaleModuleService from '../../modules/time-sale/service';
import type { TimeSaleRecord } from '../../modules/time-sale/service';
import {
  findConflictingSales,
  validateTimeSaleInput,
  type LinkedList,
  type SaleFootprint,
  type TimeSaleWriteInput,
} from './rules';

const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * 세일별 price list 와 그 리스트들에 걸린 variant. 겹침 검사의 재료다.
 *
 * price → variant 는 `product_variant_price_set` 링크 테이블로만 갈 수 있다 — pricing 모듈은 product 를
 * 모르고, Admin API 의 `*prices.price_set.variant` 확장은 그대로 터진다.
 */
export async function loadTimeSaleFootprints(container: MedusaContainer, excludeId?: string): Promise<SaleFootprint[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: sales } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'title', 'starts_at', 'ends_at', 'status', 'price_lists.id'],
  });
  const candidates = (sales as Array<TimeSaleRecord & { price_lists: Array<{ id: string }> }>).filter(
    (sale) => sale.id !== excludeId,
  );
  const listIds = candidates.flatMap((sale) => sale.price_lists.map((p) => p.id));
  if (listIds.length === 0) return candidates.map((sale) => ({ ...toFootprint(sale), variantIds: [] }));

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const { rows } = await knex.raw(
    `select distinct pr.price_list_id, pvps.variant_id
       from price pr
       join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id and pvps.deleted_at is null
      where pr.price_list_id in (${placeholders}) and pr.deleted_at is null`,
    listIds,
  );
  const variantsByList = new Map<string, string[]>();
  for (const row of rows as Array<{ price_list_id: string; variant_id: string }>) {
    const bucket = variantsByList.get(row.price_list_id) ?? [];
    bucket.push(row.variant_id);
    variantsByList.set(row.price_list_id, bucket);
  }

  return candidates.map((sale) => ({
    ...toFootprint(sale),
    variantIds: [...new Set(sale.price_lists.flatMap((p) => variantsByList.get(p.id) ?? []))],
  }));
}

const toFootprint = (sale: TimeSaleRecord): Omit<SaleFootprint, 'variantIds'> => ({
  id: sale.id,
  title: sale.title,
  starts_at: toIso(sale.starts_at),
  ends_at: toIso(sale.ends_at),
  status: sale.status,
});

/** 세일에 연결된 price list 와 각 리스트의 살아있는 가격 id. 멤버십 여부는 리스트 규칙으로 판정한다. */
export async function loadLinkedLists(container: MedusaContainer, timeSaleId: string): Promise<LinkedList[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'price_lists.id'],
    filters: { id: timeSaleId },
  });
  if (!data.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, `타임세일 ${timeSaleId} 이 없습니다.`);
  const listIds = (data[0].price_lists as Array<{ id: string }>).map((p) => p.id);
  if (listIds.length === 0) return [];

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const [{ rows: ruleRows }, { rows: priceRows }] = await Promise.all([
    knex.raw(
      `select distinct price_list_id from price_list_rule
        where price_list_id in (${placeholders}) and deleted_at is null and attribute = 'customer.groups.id'`,
      listIds,
    ),
    knex.raw(
      `select id, price_list_id from price where price_list_id in (${placeholders}) and deleted_at is null`,
      listIds,
    ),
  ]);
  const membership = new Set((ruleRows as Array<{ price_list_id: string }>).map((r) => r.price_list_id));
  return listIds.map((id) => ({
    id,
    isMembership: membership.has(id),
    priceIds: (priceRows as Array<{ id: string; price_list_id: string }>)
      .filter((p) => p.price_list_id === id)
      .map((p) => p.id),
  }));
}

export type TimeSaleContext = {
  regionIds: string[];
  membershipGroupId: string;
  lists: LinkedList[];
};

/**
 * 입력 검증 + 겹침 검사 + 수정에 필요한 현재 상태 로드. 쓰기 전에 한 번에 판정해, 막힐 저장이 반쯤
 * 실행되지 않게 한다.
 */
export const prepareTimeSaleStep = createStep(
  'prepare-time-sale',
  async (data: { input: TimeSaleWriteInput; id?: string }, { container }) => {
    const errors = validateTimeSaleInput(data.input);
    if (errors.length > 0) throw new MedusaError(MedusaError.Types.INVALID_DATA, errors.join(' '));

    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim() ?? '';
    if (data.input.membership_prices.length > 0 && !membershipGroupId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        '멤버십 고객그룹 id(MEDUSA_MEMBERSHIP_GROUP_ID)가 없어 멤버십 세일가를 저장할 수 없습니다.',
      );
    }

    const others = await loadTimeSaleFootprints(container, data.id);
    const conflicts = findConflictingSales(
      {
        id: data.id,
        starts_at: data.input.starts_at,
        ends_at: data.input.ends_at,
        status: data.input.status,
        variantIds: data.input.general_prices.map((p) => p.variant_id),
      },
      others,
    );
    if (conflicts.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `같은 품목이 기간이 겹치는 다른 세일에 있습니다: ${conflicts
          .map((c) => `${c.title} (${c.variantIds.length}개 품목)`)
          .join(', ')}`,
      );
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: regions } = await query.graph({ entity: 'region', fields: ['id'] });
    const regionIds = (regions as Array<{ id: string }>).map((r) => r.id);
    if (regionIds.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, '리전이 없어 세일 가격 규칙을 만들 수 없습니다.');
    }

    const lists = data.id ? await loadLinkedLists(container, data.id) : [];
    return new StepResponse<TimeSaleContext>({ regionIds, membershipGroupId, lists });
  },
);

export const createTimeSaleRowStep = createStep(
  'create-time-sale-row',
  async (input: TimeSaleWriteInput, { container }) => {
    const service = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
    const row = await service.createTimeSales({
      title: input.title,
      starts_at: new Date(input.starts_at),
      ends_at: new Date(input.ends_at),
      status: input.status,
    });
    return new StepResponse({ id: row.id as string }, row.id as string);
  },
  async (id, { container }) => {
    if (!id) return;
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).deleteTimeSales(id);
  },
);

export const updateTimeSaleRowStep = createStep(
  'update-time-sale-row',
  async (data: { id: string; input: TimeSaleWriteInput }, { container }) => {
    const service = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
    const before = (await service.retrieveTimeSale(data.id)) as TimeSaleRecord;
    await service.updateTimeSales({
      id: data.id,
      title: data.input.title,
      starts_at: new Date(data.input.starts_at),
      ends_at: new Date(data.input.ends_at),
      status: data.input.status,
    });
    return new StepResponse({ id: data.id }, before);
  },
  async (before, { container }) => {
    if (!before) return;
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).updateTimeSales({
      id: before.id,
      title: before.title,
      starts_at: before.starts_at,
      ends_at: before.ends_at,
      status: before.status,
    });
  },
);

export const softDeleteTimeSaleRowStep = createStep(
  'soft-delete-time-sale-row',
  async (id: string, { container }) => {
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).softDeleteTimeSales(id);
    return new StepResponse({ id }, id);
  },
  async (id, { container }) => {
    if (!id) return;
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).restoreTimeSales(id);
  },
);
```

- [ ] **Step 4: 워크플로 구현**

`apps/medusa/src/workflows/time-sale/workflows.ts`:
```ts
import { Modules } from '@medusajs/framework/utils';
import { createWorkflow, transform, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  createPriceListPricesWorkflow,
  createPriceListsWorkflow,
  createRemoteLinkStep,
  deletePriceListsWorkflow,
  dismissRemoteLinkStep,
  removePriceListPricesWorkflow,
  updatePriceListsWorkflow,
} from '@medusajs/medusa/core-flows';
import { TIME_SALE_MODULE } from '../../modules/time-sale';
import { buildPriceListData, planTimeSaleUpdate, type TimeSaleWriteInput } from './rules';
import {
  createTimeSaleRowStep,
  loadLinkedListsStep,
  prepareTimeSaleStep,
  softDeleteTimeSaleRowStep,
  updateTimeSaleRowStep,
} from './steps';

const linkOf = (timeSaleId: string, priceListId: string) => ({
  [TIME_SALE_MODULE]: { time_sale_id: timeSaleId },
  [Modules.PRICING]: { price_list_id: priceListId },
});

/**
 * 세일 생성 = 세일 행 + price list 1~2개 + 링크. 한 워크플로라 어느 스텝이 실패해도 앞 스텝이 보상으로
 * 되감긴다 — 예전엔 브라우저가 리스트를 하나씩 만들어, 중간 실패가 절름발이 세일을 남겼다.
 */
export const createTimeSaleWorkflow = createWorkflow('create-time-sale', (input: TimeSaleWriteInput) => {
  const context = prepareTimeSaleStep({ input });
  const row = createTimeSaleRowStep(input);

  const priceListsData = transform({ input, context }, ({ input, context }) => {
    const shared = {
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      status: input.status,
      regionIds: context.regionIds,
      membershipGroupId: context.membershipGroupId,
    };
    const lists = [buildPriceListData({ ...shared, audience: 'general', prices: input.general_prices })];
    if (input.membership_prices.length > 0) {
      lists.push(buildPriceListData({ ...shared, audience: 'membership', prices: input.membership_prices }));
    }
    return lists;
  });

  const created = createPriceListsWorkflow.runAsStep({ input: { price_lists_data: priceListsData } });

  const links = transform({ row, created }, ({ row, created }) =>
    created.map((list: { id: string }) => linkOf(row.id, list.id)),
  );
  createRemoteLinkStep(links);

  return new WorkflowResponse(row);
});

/**
 * 세일 수정. 지울 가격 id 는 `prepareTimeSaleStep` 이 DB 에서 직접 읽는다(브라우저 응답을 믿지 않는다).
 * 가격은 «새로 만들기 + 옛 것 지우기» 를 한 워크플로에서 하고, 실패하면 둘 다 되감긴다.
 */
export const updateTimeSaleWorkflow = createWorkflow(
  'update-time-sale',
  (input: TimeSaleWriteInput & { id: string }) => {
    const writeInput = transform({ input }, ({ input }) => {
      const { id: _id, ...rest } = input;
      return rest as TimeSaleWriteInput;
    });
    const context = prepareTimeSaleStep({ input: writeInput, id: input.id });
    const plan = transform({ writeInput, context }, ({ writeInput, context }) =>
      planTimeSaleUpdate({
        input: writeInput,
        lists: context.lists,
        regionIds: context.regionIds,
        membershipGroupId: context.membershipGroupId,
      }),
    );

    updateTimeSaleRowStep({ id: input.id, input: writeInput });
    updatePriceListsWorkflow.runAsStep({
      input: { price_lists_data: transform({ plan }, ({ plan }) => plan.listUpdates) },
    });
    removePriceListPricesWorkflow.runAsStep({
      input: { ids: transform({ plan }, ({ plan }) => plan.priceIdsToDelete) },
    });
    createPriceListPricesWorkflow.runAsStep({
      input: { data: transform({ plan }, ({ plan }) => plan.pricesToCreate) },
    });

    const created = createPriceListsWorkflow.runAsStep({
      input: { price_lists_data: transform({ plan }, ({ plan }) => plan.listsToCreate) },
    });
    createRemoteLinkStep(
      transform({ input, created }, ({ input, created }) =>
        created.map((list: { id: string }) => linkOf(input.id, list.id)),
      ),
    );

    dismissRemoteLinkStep(
      transform({ input, plan }, ({ input, plan }) => plan.listIdsToDelete.map((listId) => linkOf(input.id, listId))),
    );
    deletePriceListsWorkflow.runAsStep({
      input: { ids: transform({ plan }, ({ plan }) => plan.listIdsToDelete) },
    });

    return new WorkflowResponse(transform({ input }, ({ input }) => ({ id: input.id })));
  },
);

export const deleteTimeSaleWorkflow = createWorkflow('delete-time-sale', (input: { id: string }) => {
  // 삭제는 검증 없이 연결된 리스트만 읽는다.
  const context = loadLinkedListsStep(input);
  dismissRemoteLinkStep(
    transform({ input, context }, ({ input, context }) => context.map((list) => linkOf(input.id, list.id))),
  );
  deletePriceListsWorkflow.runAsStep({
    input: { ids: transform({ context }, ({ context }) => context.map((list) => list.id)) },
  });
  softDeleteTimeSaleRowStep(input.id);
  return new WorkflowResponse(transform({ input }, ({ input }) => ({ id: input.id })));
});
```

`workflows.ts` 의 `./steps` import 목록에 `loadLinkedListsStep` 을 포함한다:
```ts
import {
  createTimeSaleRowStep,
  loadLinkedListsStep,
  prepareTimeSaleStep,
  softDeleteTimeSaleRowStep,
  updateTimeSaleRowStep,
} from './steps';
```
`steps.ts` 끝에 추가:
```ts
export const loadLinkedListsStep = createStep(
  'load-time-sale-linked-lists',
  async (data: { id: string }, { container }) => new StepResponse(await loadLinkedLists(container, data.id)),
);
```

- [ ] **Step 5: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/time-sale.spec.ts`
Expected: PASS (스모크 1 + 워크플로 8).
실패 시 확인 순서:
- `runAsStep` 이 같은 부모 워크플로에서 «빈 배열» 입력에 던지면, 해당 호출을 `when(plan, (p) => p.listsToCreate.length > 0).then(() => …)` 로 감싼다(`@medusajs/framework/workflows-sdk` 의 `when`). 빈 배열이 무해한지 먼저 테스트 결과로 판단한다.
- `createRemoteLinkStep([])` 이 던지면 같은 방식으로 감싼다.
- `rolls back …` 이 실패하면(세일 행이 남으면) `createTimeSaleRowStep` 의 보상이 불렸는지 로그로 본다 — `prepareTimeSaleStep` 에 validate 가 앞서 있으므로 이 케이스는 variant 링크 검증 실패로 터져야 한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/workflows/time-sale apps/medusa/integration-tests/http/time-sale.spec.ts
git commit -m "feat(medusa): 타임세일 생성·수정·삭제를 보상이 있는 워크플로 하나로 처리한다"
```

---

### Task 4: 읽기 경로 · 라우트 · 캐시 무효화

**Files:**
- Modify: `apps/medusa/src/utils/time-sale.ts` (전면 재작성)
- Create: `apps/medusa/src/utils/storefront-revalidate.ts`
- Modify: `apps/medusa/src/jobs/time-sale-cache-boundary.ts`
- Modify: `apps/medusa/src/utils/__tests__/time-sale.unit.spec.ts`
- Create: `apps/medusa/src/api/admin/time-sales/validators.ts`, `apps/medusa/src/api/admin/time-sales/middlewares.ts`
- Modify: `apps/medusa/src/api/admin/time-sales/route.ts`
- Create: `apps/medusa/src/api/admin/time-sales/[id]/route.ts`
- Modify: `apps/medusa/src/api/admin/middlewares.ts`
- Modify: `apps/medusa/src/api/store/time-sale/route.ts`
- Test: `apps/medusa/integration-tests/http/time-sale.spec.ts` (HTTP 케이스 추가)

**Interfaces:**
- Consumes: Task 3 의 워크플로 3개, `loadLinkedLists`.
- Produces:
  - `GET /admin/time-sales` → `{ timeSales: AdminTimeSaleDto[] }`
  - `GET /admin/time-sales/:id` → `{ timeSale: AdminTimeSaleDto }`
  - `POST /admin/time-sales` (body `TimeSaleWriteInput`) → `{ timeSale: AdminTimeSaleDto }` 201
  - `POST /admin/time-sales/:id` (body `TimeSaleWriteInput`) → `{ timeSale: AdminTimeSaleDto }`
  - `DELETE /admin/time-sales/:id` → `{ id, object: 'time_sale', deleted: true }`
  - `AdminTimeSaleDto = { id: string; title: string; status: 'draft' | 'active'; startsAt: string; endsAt: string; productIds: string[]; generalPrices: Record<string, number>; membershipPrices: Record<string, number> }`
  - `GET /store/time-sale` → `{ timeSales: StoreTimeSaleDto[]; products: Array<{ id: string; categoryIds: string[] }> }`, `StoreTimeSaleDto = { id: string; startsAt: string; endsAt: string; priceListIds: string[]; productIds: string[] }`
  - `revalidateStorefront(container, { productHandles: string[]; logLabel: string }): Promise<void>` (`utils/storefront-revalidate.ts`)
  - `listProductsInPriceLists(container, priceListIds)` — 기존 시그니처 유지(경계 크론이 쓴다).

- [ ] **Step 1: 실패하는 HTTP 테스트 추가**

`integration-tests/http/time-sale.spec.ts` 에 import 추가 `import jwt from 'jsonwebtoken';` 와 `testSuite` 인자에 `api` 를 더한다(`({ api, getContainer })`). 다음 `describe` 추가 (워크플로 describe 의 `beforeEach`·`input` 을 재사용하도록 같은 `describe` 블록 안 마지막에 넣는다):
```ts
      describe('HTTP', () => {
        let adminHeaders: { headers: Record<string, string> };

        beforeEach(async () => {
          const container = getContainer();
          const [user] = await container.resolve(Modules.USER).createUsers([{ email: `ts${Date.now()}@test.dev` }]);
          const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
            projectConfig: { http: { jwtSecret: string } };
          };
          const token = jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin', app_metadata: { user_id: user.id } },
            config.projectConfig.http.jwtSecret,
          );
          adminHeaders = { headers: { authorization: `Bearer ${token}` } };
        });

        it('creates, lists, publishes and deletes through the admin routes', async () => {
          const created = await api.post('/admin/time-sales', input({ status: 'draft' }), adminHeaders);
          expect(created.status).toBe(201);
          const id = created.data.timeSale.id;
          expect(Object.keys(created.data.timeSale.generalPrices)).toHaveLength(741);
          expect(Object.keys(created.data.timeSale.membershipPrices)).toHaveLength(10);

          const listed = await api.get('/admin/time-sales', adminHeaders);
          expect(listed.data.timeSales.map((s: { id: string }) => s.id)).toContain(id);

          const published = await api.post(`/admin/time-sales/${id}`, input({ status: 'active' }), adminHeaders);
          expect(published.data.timeSale.status).toBe('active');

          const deleted = await api.delete(`/admin/time-sales/${id}`, adminHeaders);
          expect(deleted.data).toEqual({ id, object: 'time_sale', deleted: true });
        });

        it('returns 400 for an invalid body', async () => {
          await expect(
            api.post('/admin/time-sales', { ...input(), general_prices: [] }, adminHeaders),
          ).rejects.toMatchObject({ response: { status: 400 } });
        });

        it('store route lists only active, in-window sales without titles', async () => {
          const now = Date.now();
          const window = {
            starts_at: new Date(now - 60_000).toISOString(),
            ends_at: new Date(now + 3_600_000).toISOString(),
          };
          await api.post('/admin/time-sales', input({ ...window, status: 'active' }), adminHeaders);
          await api.post(
            '/admin/time-sales',
            input({ ...window, title: '비공개', status: 'draft', membership_prices: [] }),
            adminHeaders,
          );

          const res = await api.get('/store/time-sale', {
            headers: { 'x-publishable-api-key': await publishableKey(getContainer()) },
          });
          expect(res.data.timeSales).toHaveLength(1);
          expect(res.data.timeSales[0]).not.toHaveProperty('title');
          expect(res.data.timeSales[0].priceListIds).toHaveLength(2);
          expect(res.data.products).toHaveLength(1);
          expect(res.data.products[0]).toHaveProperty('categoryIds');
        });
      });
```
파일 맨 아래(러너 바깥)에 헬퍼:
```ts
async function publishableKey(container: any): Promise<string> {
  const apiKeyModule = container.resolve(Modules.API_KEY);
  const [key] = await apiKeyModule.createApiKeys([{ title: 'store', type: 'publishable', created_by: 'test' }]);
  return key.token;
}
```
(`/store/*` 가 publishable key 를 요구하지 않는 설정이면 헤더를 빼도 된다 — 첫 실행 결과로 판단.)

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/time-sale.spec.ts`
Expected: FAIL — `POST /admin/time-sales` 404.

- [ ] **Step 3: 무효화 유틸 분리**

`apps/medusa/src/utils/storefront-revalidate.ts`:
```ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

/**
 * 스토어프론트의 `time-sale` 태그와 상품 캐시를 비운다. 실패해도 던지지 않는다 — 캐시는 `revalidate`
 * 안전망(목록 60초·상품 1시간)이 있고, 무효화 실패가 세일 저장을 되감을 이유는 없다.
 *
 * 라우트는 `handle` 이 실렸을 때만 전역 목록 태그와 카테고리 경로를 비운다. 그건 한 번이면 족하므로
 * 첫 상품만 handle 로 싣고 나머지는 태그로 정확히 지운다 (channel-adapter 의 배치 무효화와 같은 형태).
 */
export async function revalidateStorefront(
  container: MedusaContainer,
  params: { productHandles: string[]; logLabel: string },
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!url || !secret) {
    logger.warn(`[time-sale] STOREFRONT_REVALIDATE_URL/SECRET 미설정 — 캐시를 비우지 못했다 (${params.logLabel})`);
    return;
  }

  const handles = [...new Set(params.productHandles.filter(Boolean))];
  const [first, ...rest] = handles;
  const body = {
    ...(first ? { handle: first } : {}),
    tags: ['time-sale', ...rest.map((handle) => `product-${handle}`)],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.error(`[time-sale] 캐시 무효화 실패 status=${response.status} (${params.logLabel})`);
      return;
    }
    logger.info(`[time-sale] 상품 ${handles.length}개 캐시 무효화 (${params.logLabel})`);
  } catch (error) {
    logger.error(`[time-sale] 캐시 무효화 호출 실패: ${(error as Error).message} (${params.logLabel})`);
  }
}
```

`apps/medusa/src/jobs/time-sale-cache-boundary.ts` 의 `const url = …` 부터 `catch` 블록 끝까지를 다음으로 바꾼다(`START_PREWARM_SECONDS`·`BOUNDARY_WINDOW_SECONDS`·주석·`config` 는 그대로):
```ts
  const products = await listProductsInPriceLists(
    container,
    crossed.map((list) => list.id)
  );

  // 시작 시각이 아직 미래면 예열이다 — 종료 무효화와 구분돼야 "종료됐는데 세일가가 남았다" 를 볼 때
  // 어느 쪽이 안 돌았는지 로그로 가른다.
  const now = Date.now();
  const label = (list: { title: string; startsAt: string | null }) =>
    list.startsAt && Date.parse(list.startsAt) > now ? `${list.title}(시작예열)` : `${list.title}(종료)`;

  await revalidateStorefront(container, {
    productHandles: products.map((product) => product.handle),
    logLabel: `경계 ${crossed.length}건: ${crossed.map(label).join(', ')}`,
  });
}
```
import 에 `import { revalidateStorefront } from '../utils/storefront-revalidate';` 추가, 쓰지 않게 된 `ContainerRegistrationKeys`·`logger` 는 지운다.

- [ ] **Step 4: 읽기 경로 재작성**

`apps/medusa/src/utils/time-sale.ts` 를 다음으로 교체한다. `listTimeSalesCrossingBoundary`·`listProductsInPriceLists`·`TimeSaleList` 는 경계 크론이 쓰므로 유지(가격 엔진이 읽는 price list 기준이 맞다), 제목 짝 맞추기(`saleTitle`, `saleKey`, `MEMBERSHIP_LIST_TITLE_SUFFIX`, `listAllTimeSales`, `ACTIVE_SQL`, `ALL_SQL`, `ActiveTimeSale`, `TimeSaleDetail`)는 삭제한다.
```ts
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';
import type { TimeSaleRecord } from '../modules/time-sale/service';

// ── 경계 크론용 (price list 기준) ──────────────────────────────────────────────
// 가격 엔진은 price list 의 starts_at/ends_at/status 를 읽는다. 워크플로가 time_sale 값을 리스트에 맞춰
// 두므로, «언제 화면이 바뀌어야 하나» 는 리스트로 보는 게 정확하다.

export type TimeSaleList = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  isMembershipOnly: boolean;
};

/* 여기에 기존 파일의 TIME_SALE_LIST_COLUMNS, TIME_SALE_BASE_WHERE, CROSSED_BOUNDARY_SQL, ListRow, ProductRow,
   toIso, toLists, listProductsInPriceLists, listTimeSalesCrossingBoundary 를 «글자 그대로» 옮긴다
   (기존 파일 18~150행·마지막 함수). 주석 포함. */

// ── 세일 단위 (time_sale 기준) ─────────────────────────────────────────────────

export type AdminTimeSaleDto = {
  id: string;
  title: string;
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
};

type SaleWithLists = TimeSaleRecord & { price_lists: Array<{ id: string }> };

async function loadSales(container: MedusaContainer, filters: Record<string, unknown> = {}): Promise<SaleWithLists[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'title', 'status', 'starts_at', 'ends_at', 'price_lists.id'],
    filters,
  });
  return data as SaleWithLists[];
}

type PriceRow = { price_list_id: string; amount: string | number; variant_id: string; product_id: string };

async function loadPriceRows(container: MedusaContainer, listIds: string[]) {
  if (listIds.length === 0) return { prices: [] as PriceRow[], membershipListIds: new Set<string>() };
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const [{ rows: prices }, { rows: rules }] = await Promise.all([
    knex.raw(
      `select pr.price_list_id, pr.amount, pvps.variant_id, pv.product_id
         from price pr
         join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
         join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
        where pr.price_list_id in (${placeholders}) and pr.deleted_at is null`,
      listIds,
    ),
    knex.raw(
      `select distinct price_list_id from price_list_rule
        where price_list_id in (${placeholders}) and deleted_at is null and attribute = 'customer.groups.id'`,
      listIds,
    ),
  ]);
  return {
    prices: prices as PriceRow[],
    membershipListIds: new Set((rules as Array<{ price_list_id: string }>).map((r) => r.price_list_id)),
  };
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * 어드민이 보는 타임세일 — 예약·진행·종료·비공개를 가리지 않는다. 가격을 **variant id 로** 돌려준다:
 * Admin API 로는 price 에서 variant 로 갈 수 없다(그 사이는 `product_variant_price_set` 링크 테이블뿐).
 */
export async function listAdminTimeSales(
  container: MedusaContainer,
  filters: Record<string, unknown> = {},
): Promise<AdminTimeSaleDto[]> {
  const sales = await loadSales(container, filters);
  const { prices, membershipListIds } = await loadPriceRows(
    container,
    sales.flatMap((sale) => sale.price_lists.map((p) => p.id)),
  );

  return sales
    .map((sale) => {
      const listIds = new Set(sale.price_lists.map((p) => p.id));
      const generalPrices: Record<string, number> = {};
      const membershipPrices: Record<string, number> = {};
      const productIds = new Set<string>();
      for (const row of prices) {
        if (!listIds.has(row.price_list_id)) continue;
        const target = membershipListIds.has(row.price_list_id) ? membershipPrices : generalPrices;
        target[row.variant_id] = Number(row.amount);
        productIds.add(row.product_id);
      }
      return {
        id: sale.id,
        title: sale.title,
        status: sale.status,
        startsAt: iso(sale.starts_at),
        endsAt: iso(sale.ends_at),
        productIds: [...productIds],
        generalPrices,
        membershipPrices,
      };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export type StoreTimeSaleDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  priceListIds: string[];
  productIds: string[];
};

export type StoreTimeSaleResponse = {
  timeSales: StoreTimeSaleDto[];
  products: Array<{ id: string; categoryIds: string[] }>;
};

/**
 * 지금 진행 중인 타임세일(active + 기간 안). 종료 빠른 순. **세일 이름은 싣지 않는다** — 운영자가 지은
 * 이름은 내부용이다(2026-10-09 노출 사고).
 *
 * `products` 는 모든 진행 중 세일 상품을 중복 없이, 판매순 → 리뷰순 → 최신순으로 준다. 카테고리 id 를
 * 같이 주는 이유: `/time-sale` 이 상품 수백 개를 다 받지 않고도 카테고리 탭을 만들 수 있게.
 */
export async function listActiveStoreTimeSales(container: MedusaContainer): Promise<StoreTimeSaleResponse> {
  const now = new Date();
  const sales = (await loadSales(container, { status: 'active' }))
    .filter((sale) => new Date(sale.starts_at) <= now && new Date(sale.ends_at) >= now)
    .sort((a, b) => iso(a.ends_at).localeCompare(iso(b.ends_at)));
  if (sales.length === 0) return { timeSales: [], products: [] };

  const listIds = sales.flatMap((sale) => sale.price_lists.map((p) => p.id));
  const rows = await listProductsInPriceLists(container, listIds);

  const productsByList = new Map<string, string[]>();
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const bucket = productsByList.get(row.price_list_id) ?? [];
    bucket.push(row.id);
    productsByList.set(row.price_list_id, bucket);
    if (!seen.has(row.id)) {
      seen.add(row.id);
      ordered.push(row.id);
    }
  }

  const categoryIds = await loadCategoryIds(container, ordered);

  return {
    timeSales: sales.map((sale) => ({
      id: sale.id,
      startsAt: iso(sale.starts_at),
      endsAt: iso(sale.ends_at),
      priceListIds: sale.price_lists.map((p) => p.id),
      productIds: [...new Set(sale.price_lists.flatMap((p) => productsByList.get(p.id) ?? []))],
    })),
    products: ordered.map((id) => ({ id, categoryIds: categoryIds.get(id) ?? [] })),
  };
}

async function loadCategoryIds(container: MedusaContainer, productIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds.length === 0) return map;
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = productIds.map(() => '?').join(',');
  const { rows } = await knex.raw(
    `select product_id, product_category_id from product_category_product where product_id in (${placeholders})`,
    productIds,
  );
  for (const row of rows as Array<{ product_id: string; product_category_id: string }>) {
    const bucket = map.get(row.product_id) ?? [];
    bucket.push(row.product_category_id);
    map.set(row.product_id, bucket);
  }
  return map;
}

/** 세일에 걸린 상품 handle — 쓰기 뒤 캐시 무효화용. */
export async function listTimeSaleProductHandles(container: MedusaContainer, priceListIds: string[]): Promise<string[]> {
  return (await listProductsInPriceLists(container, priceListIds)).map((row) => row.handle);
}
```
`listProductsInPriceLists` 의 `ProductRow` 에 `price_list_id` 가 이미 있는지 확인한다(기존 코드에 있다).

- [ ] **Step 5: 검증기·미들웨어·라우트**

`apps/medusa/src/api/admin/time-sales/validators.ts`:
```ts
import { z } from 'zod';

const price = z.object({ variant_id: z.string().min(1), amount: z.number().positive().finite() });

export const AdminTimeSaleWrite = z.object({
  title: z.string().trim().min(1),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['draft', 'active']),
  general_prices: z.array(price).min(1),
  membership_prices: z.array(price),
});

export type AdminTimeSaleWriteType = z.infer<typeof AdminTimeSaleWrite>;
```

`apps/medusa/src/api/admin/time-sales/middlewares.ts`:
```ts
import { validateAndTransformBody } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminTimeSaleWrite } from './validators';

export const adminTimeSaleRoutesMiddlewares: MiddlewareRoute[] = [
  { method: ['POST'], matcher: '/admin/time-sales', middlewares: [validateAndTransformBody(AdminTimeSaleWrite)] },
  { method: ['POST'], matcher: '/admin/time-sales/:id', middlewares: [validateAndTransformBody(AdminTimeSaleWrite)] },
];
```

`apps/medusa/src/api/admin/middlewares.ts` — import 추가 후 배열 끝에 펼친다:
```ts
import { adminTimeSaleRoutesMiddlewares } from './time-sales/middlewares';
// ...
  ...adminPaymentRoutesMiddlewares,
  ...adminTimeSaleRoutesMiddlewares,
```

`apps/medusa/src/api/admin/time-sales/route.ts`:
```ts
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listAdminTimeSales, listTimeSaleProductHandles } from '../../../utils/time-sale';
import { revalidateStorefront } from '../../../utils/storefront-revalidate';
import { createTimeSaleWorkflow } from '../../../workflows/time-sale/workflows';
import { loadLinkedLists } from '../../../workflows/time-sale/steps';
import type { AdminTimeSaleWriteType } from './validators';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json({ timeSales: await listAdminTimeSales(req.scope) });
}

export async function POST(req: MedusaRequest<AdminTimeSaleWriteType>, res: MedusaResponse) {
  const { result } = await createTimeSaleWorkflow(req.scope).run({ input: req.validatedBody });
  const [timeSale] = await listAdminTimeSales(req.scope, { id: result.id });
  if (timeSale.status === 'active') {
    const lists = await loadLinkedLists(req.scope, result.id);
    await revalidateStorefront(req.scope, {
      productHandles: await listTimeSaleProductHandles(req.scope, lists.map((l) => l.id)),
      logLabel: `생성 ${result.id}`,
    });
  }
  return res.status(201).json({ timeSale });
}
```

`apps/medusa/src/api/admin/time-sales/[id]/route.ts`:
```ts
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { listAdminTimeSales, listTimeSaleProductHandles } from '../../../../utils/time-sale';
import { revalidateStorefront } from '../../../../utils/storefront-revalidate';
import { deleteTimeSaleWorkflow, updateTimeSaleWorkflow } from '../../../../workflows/time-sale/workflows';
import { loadLinkedLists } from '../../../../workflows/time-sale/steps';
import type { AdminTimeSaleWriteType } from '../validators';

async function retrieve(req: MedusaRequest, id: string) {
  const [timeSale] = await listAdminTimeSales(req.scope, { id });
  if (!timeSale) throw new MedusaError(MedusaError.Types.NOT_FOUND, `타임세일 ${id} 이 없습니다.`);
  return timeSale;
}

/** 쓰기 전후 양쪽 상품을 비운다 — 수정으로 세일에서 빠진 상품도 세일가 캐시가 남지 않게. */
async function handlesOf(req: MedusaRequest, id: string) {
  const lists = await loadLinkedLists(req.scope, id);
  return listTimeSaleProductHandles(req.scope, lists.map((l) => l.id));
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json({ timeSale: await retrieve(req, req.params.id) });
}

export async function POST(req: MedusaRequest<AdminTimeSaleWriteType>, res: MedusaResponse) {
  const id = req.params.id;
  const before = await handlesOf(req, id);
  await updateTimeSaleWorkflow(req.scope).run({ input: { id, ...req.validatedBody } });
  const after = await handlesOf(req, id);
  await revalidateStorefront(req.scope, { productHandles: [...before, ...after], logLabel: `수정 ${id}` });
  return res.json({ timeSale: await retrieve(req, id) });
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const id = req.params.id;
  const before = await handlesOf(req, id);
  await deleteTimeSaleWorkflow(req.scope).run({ input: { id } });
  await revalidateStorefront(req.scope, { productHandles: before, logLabel: `삭제 ${id}` });
  return res.json({ id, object: 'time_sale', deleted: true });
}
```

`apps/medusa/src/api/store/time-sale/route.ts`:
```ts
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listActiveStoreTimeSales } from '../../../utils/time-sale';

/**
 * 진행 중인 타임세일 전부. 없으면 `{ timeSales: [], products: [] }`.
 *
 * 상품은 id 만 돌려주고 실제 조회는 스토어프론트가 `/store/products` 로 한다 — 그래야 멤버십 은닉
 * 미들웨어·가격 계산·리뷰 매핑이 다른 목록과 똑같이 걸린다.
 *
 * 세일 이름은 싣지 않는다(운영자 내부용). `timeSales` 는 예전 응답과 같은 모양에서 title 만 빠졌으므로
 * 배포가 섞여도 옛 스토어프론트는 기본 문구로 그린다.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(await listActiveStoreTimeSales(req.scope));
}
```

- [ ] **Step 6: 유닛 스펙 정리**

`apps/medusa/src/utils/__tests__/time-sale.unit.spec.ts`: `describe('listActiveTimeSales', …)` 블록(43~179행)을 지운다 — 그 동작은 제목 짝 맞추기였고 이제 HTTP 통합 스펙이 지킨다. `listProductsInPriceLists`·경계 크론 `describe` 는 남기되, 크론 테스트가 `fetch` 본문·로그 문구를 단언하면 `revalidateStorefront` 의 형식(`tags: ['time-sale', ...]`, `handle` 첫 상품)에 맞춰 고친다. import 에서 `listActiveTimeSales` 를 뺀다.

Run: `cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/utils/__tests__/time-sale.unit.spec.ts`
Expected: PASS.

- [ ] **Step 7: 통합 통과 확인**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/time-sale.spec.ts`
Expected: PASS (스모크 1 + 워크플로 8 + HTTP 3).

- [ ] **Step 8: 남은 참조 확인**

```bash
grep -rn "listAllTimeSales\|listActiveTimeSales\|saleKey\|MEMBERSHIP_LIST_TITLE_SUFFIX" apps/medusa/src
```
Expected: 출력 없음.

- [ ] **Step 9: 커밋**

```bash
git add apps/medusa
git commit -m "feat(medusa): 타임세일 어드민·스토어 라우트를 time_sale 기준으로 바꾸고 세일 이름을 고객 응답에서 뺀다"
```

---

### Task 5: 어드민 — 새 라우트 사용 · 비공개/공개

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/medusa/time-sales.ts`
- Modify: `apps/admin-web/src/lib/api/domains/medusa/price-lists.ts`
- Modify: `apps/admin-web/src/lib/services/time-sale.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/time-sale/time-sale-model.ts`, `time-sale-model.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/time-sale/template/marketing-time-sale-template.tsx`
- Modify: `apps/admin-web/src/features/mall/marketing/time-sale/template/time-sale-form-template.tsx`
- Modify: `apps/admin-web/src/app/(admin)/mall/marketing/time-sale/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: Task 4 의 admin 라우트·`AdminTimeSaleDto`.
- Produces (admin-web 내부):
  - `medusaTimeSalesApi.list(): Promise<AdminTimeSale[]>`, `.get(id)`, `.create(body: TimeSaleWriteBody)`, `.update(id, body)`, `.remove(id)`
  - `type TimeSaleWriteBody = { title: string; starts_at: string; ends_at: string; status: 'draft' | 'active'; general_prices: Array<{ variant_id: string; amount: number }>; membership_prices: Array<{ variant_id: string; amount: number }> }`
  - `buildTimeSaleWriteBody(params: { title: string; period: TimeSalePeriod; status: 'draft' | 'active'; rows: TimeSaleRow[] }): TimeSaleWriteBody` (time-sale-model.ts, `buildPriceListPayloads` 대체)
  - `resolveTimeSaleStatus(period, now, status?: 'draft' | 'active'): 'draft' | 'scheduled' | 'active' | 'ended'`
  - 훅: `useTimeSaleList()`, `useTimeSaleVariantMap()`, `useTimeSaleDetail(id | null)`, `useCreateTimeSale()`, `useUpdateTimeSale()`, `useDeleteTimeSale()`, `useSetTimeSaleStatus()`

- [ ] **Step 1: 실패하는 모델 테스트로 교체**

`time-sale-model.spec.ts` 에서 `describe('buildPriceListPayloads', …)` 블록을 지우고 다음을 넣는다. `resolveTimeSaleStatus` describe 에 draft 케이스를 더한다. 상단 import 에서 `buildPriceListPayloads` 를 `buildTimeSaleWriteBody` 로 바꾼다.
```ts
describe('buildTimeSaleWriteBody', () => {
  const period = { startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-01-08T00:00:00.000Z' };
  const row = (overrides: Partial<TimeSaleRow>): TimeSaleRow => ({
    variantId: 'v1',
    productId: 'p1',
    productTitle: '상품',
    variantTitle: '옵션',
    basePrice: 1000,
    membershipBasePrice: 900,
    generalSalePrice: 800,
    membershipSalePrice: 700,
    ...overrides,
  });

  it('skips rows without a general sale price and keeps membership only where both exist', () => {
    const body = buildTimeSaleWriteBody({
      title: ' 가을 세일 ',
      period,
      status: 'draft',
      rows: [
        row({}),
        row({ variantId: 'v2', generalSalePrice: null, membershipSalePrice: null }),
        row({ variantId: 'v3', membershipBasePrice: null, membershipSalePrice: null }),
      ],
    });
    expect(body).toEqual({
      title: '가을 세일',
      starts_at: period.startsAt,
      ends_at: period.endsAt,
      status: 'draft',
      general_prices: [
        { variant_id: 'v1', amount: 800 },
        { variant_id: 'v3', amount: 800 },
      ],
      membership_prices: [{ variant_id: 'v1', amount: 700 }],
    });
  });
});
```
`resolveTimeSaleStatus` describe 안에 추가:
```ts
  it('reports draft regardless of period', () => {
    expect(resolveTimeSaleStatus({ startsAt: '2000-01-01T00:00:00Z', endsAt: '2100-01-01T00:00:00Z' }, new Date(), 'draft')).toBe('draft');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- time-sale-model`
Expected: FAIL — `buildTimeSaleWriteBody is not a function`.

- [ ] **Step 3: 모델 구현**

`time-sale-model.ts`:
- `TimeSaleStatus` 를 `'draft' | 'scheduled' | 'active' | 'ended'` 로, `TIME_SALE_STATUS_LABEL` 에 `draft: '비공개'` 추가.
- `resolveTimeSaleStatus` 시그니처를 `(period: TimeSalePeriod, now: Date, status: 'draft' | 'active' = 'active')` 로 바꾸고 첫 줄에 `if (status === 'draft') return 'draft';`.
- `PriceListPricePayload`, `PriceListPayload`, `MEMBERSHIP_LIST_TITLE_SUFFIX`, `buildPriceListPayloads`, `findOverlapping`, `findVariantConflicts` 를 지운다(겹침 차단은 서버, 짝 맞추기는 링크). 스펙의 해당 describe 도 지운다.
- 파일 머리 주석의 «타임세일 하나는 Medusa price list 두 개로 저장된다» 문단을 «세일 저장은 Medusa `POST /admin/time-sales` 한 번이다. 리스트 분할·겹침 차단·가격 교체는 서버 워크플로가 한다» 로 바꾼다.
- 추가:
```ts
export type TimeSaleWriteBody = {
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active';
  general_prices: Array<{ variant_id: string; amount: number }>;
  membership_prices: Array<{ variant_id: string; amount: number }>;
};

/**
 * 편집 행 → 저장 요청 본문. 일반 세일가를 비운 품목은 세일에서 빠지고, 멤버십가가 없는 상품은 멤버십
 * 세일가도 만들지 않는다 (`validateRows` 와 같은 기준).
 */
export function buildTimeSaleWriteBody(params: {
  title: string;
  period: TimeSalePeriod;
  status: 'draft' | 'active';
  rows: TimeSaleRow[];
}): TimeSaleWriteBody {
  return {
    title: params.title.trim(),
    starts_at: params.period.startsAt,
    ends_at: params.period.endsAt,
    status: params.status,
    general_prices: params.rows
      .filter((row) => row.generalSalePrice !== null)
      .map((row) => ({ variant_id: row.variantId, amount: row.generalSalePrice as number })),
    membership_prices: params.rows
      .filter((row) => row.membershipBasePrice !== null && row.membershipSalePrice !== null)
      .map((row) => ({ variant_id: row.variantId, amount: row.membershipSalePrice as number })),
  };
}
```

Run: `npm run test:admin-web -- time-sale-model` → PASS.

- [ ] **Step 4: API 클라이언트**

`apps/admin-web/src/lib/api/domains/medusa/time-sales.ts` 전체 교체:
```ts
'use client';

import { MEDUSA_BASE_URL } from '@/const';
import type { TimeSaleWriteBody } from '@/features/mall/marketing/time-sale/time-sale-model';
import { client } from '../../client';

/**
 * 어드민이 보는 타임세일. Medusa `time_sale` 모듈이 세일 단위이고, 저장은 라우트 한 번이 서버 워크플로로
 * 끝낸다 — 브라우저가 price list API 를 여러 번 부르다 중간에 멈추면 세일이 반쯤 바뀐 채 남았다(10-09).
 */
export interface AdminTimeSale {
  id: string;
  title: string;
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
}

const BASE = `${MEDUSA_BASE_URL}/admin/time-sales`;

export const medusaTimeSalesApi = {
  list: async () => (await client.get<{ timeSales: AdminTimeSale[] }>(BASE)).data.timeSales,
  get: async (id: string) => (await client.get<{ timeSale: AdminTimeSale }>(`${BASE}/${id}`)).data.timeSale,
  create: async (body: TimeSaleWriteBody) =>
    (await client.post<{ timeSale: AdminTimeSale }>(BASE, body)).data.timeSale,
  update: async (id: string, body: TimeSaleWriteBody) =>
    (await client.post<{ timeSale: AdminTimeSale }>(`${BASE}/${id}`, body)).data.timeSale,
  remove: async (id: string) => {
    await client.delete(`${BASE}/${id}`);
  },
};
```

`price-lists.ts`: `medusaPriceListsApi` 의 `get`·`create`·`update`·`remove`·`batchPrices` 와 그 타입(`CreatePriceListPayload`, `BatchPricesPayload`)을 지운다. 지우기 전에 다른 사용처가 없는지 확인:
```bash
grep -rn "medusaPriceListsApi\|CreatePriceListPayload\|BatchPricesPayload" apps/admin-web/src | grep -v "price-lists.ts"
```
`lib/services/time-sale.ts` 외의 사용처가 있으면 그 함수는 남긴다. `medusaProductPricingApi` 는 남긴다(상품 행 로드에 쓴다).

- [ ] **Step 5: 훅 재작성**

`apps/admin-web/src/lib/services/time-sale.ts` 전체 교체:
```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medusaProductPricingApi } from '@/lib/api/domains/medusa/price-lists';
import { medusaTimeSalesApi } from '@/lib/api/domains/medusa/time-sales';
import { medusaCatalogApi } from '@/lib/api/domains/medusa/catalog';
import {
  buildTimeSaleWriteBody,
  resolveTimeSaleStatus,
  toTimeSaleRows,
  validateRows,
  type TimeSalePeriod,
  type TimeSaleRow,
} from '@/features/mall/marketing/time-sale/time-sale-model';

const timeSaleKeys = {
  all: ['time-sales'] as const,
  lists: () => [...timeSaleKeys.all, 'list'] as const,
  products: (ids: string[]) => [...timeSaleKeys.all, 'products', ids] as const,
  search: (params: unknown) => [...timeSaleKeys.all, 'search', params] as const,
};

function useAllTimeSales() {
  return useQuery({ queryKey: timeSaleKeys.lists(), queryFn: () => medusaTimeSalesApi.list(), staleTime: 30_000 });
}

export function useTimeSaleList() {
  const query = useAllTimeSales();
  return {
    ...query,
    data: query.data?.map((sale) => ({
      ...sale,
      period: { startsAt: sale.startsAt, endsAt: sale.endsAt },
      variantCount: Object.keys(sale.generalPrices).length,
      hasMembership: Object.keys(sale.membershipPrices).length > 0,
    })),
  };
}

/**
 * 아직 끝나지 않은 세일에 걸린 품목 → 그 세일 이름. 상품 선택 화면이 «이미 세일 중» 을 미리 보여주는
 * 편의 표시다 — 최종 차단은 서버가 한다.
 */
export function useTimeSaleVariantMap(excludeId?: string) {
  const { data } = useAllTimeSales();
  const map = new Map<string, string>();
  const now = new Date();
  for (const sale of data ?? []) {
    if (sale.id === excludeId) continue;
    if (resolveTimeSaleStatus({ startsAt: sale.startsAt, endsAt: sale.endsAt }, now, sale.status) === 'ended') continue;
    for (const variantId of Object.keys(sale.generalPrices)) map.set(variantId, sale.title);
  }
  return { data: map };
}

export function useMedusaProductSearch(params: { keyword: string; page: number; pageSize: number; categoryId?: string }) {
  return useQuery({
    queryKey: timeSaleKeys.search(params),
    queryFn: () =>
      medusaCatalogApi.searchProducts(params.keyword || undefined, {
        limit: params.pageSize,
        offset: (params.page - 1) * params.pageSize,
        categoryId: params.categoryId,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useTimeSaleProductRows(productIds: string[]) {
  return useQuery({
    queryKey: timeSaleKeys.products(productIds),
    queryFn: async (): Promise<TimeSaleRow[]> => toTimeSaleRows(await medusaProductPricingApi.getProducts(productIds)),
    enabled: productIds.length > 0,
  });
}

export function useTimeSaleDetail(id: string | null) {
  const { data, isLoading } = useAllTimeSales();
  const sale = id ? data?.find((item) => item.id === id) : undefined;
  return {
    isLoading: Boolean(id) && isLoading,
    data: sale && {
      id: sale.id,
      title: sale.title,
      status: sale.status,
      period: { startsAt: sale.startsAt, endsAt: sale.endsAt },
      productIds: sale.productIds,
      savedPrices: {
        general: new Map(Object.entries(sale.generalPrices)),
        membership: new Map(Object.entries(sale.membershipPrices)),
      },
    },
  };
}

export class TimeSaleValidationError extends Error {}

type SaveInput = { title: string; period: TimeSalePeriod; status: 'draft' | 'active'; rows: TimeSaleRow[] };

const toBody = (input: SaveInput) => {
  const errors = validateRows(input.rows);
  if (errors.length > 0) throw new TimeSaleValidationError(`${errors.length}개 품목의 세일가를 고쳐야 합니다.`);
  return buildTimeSaleWriteBody(input);
};

/** 서버가 400 으로 돌려준 사유(겹침·검증)를 그대로 보여준다 — 「실패했습니다」 만으론 운영자가 고칠 수 없다. */
const serverMessage = (error: unknown): string | null => {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof message === 'string' && message ? message : null;
};

const rethrowReadable = (error: unknown): never => {
  const message = serverMessage(error);
  throw message ? new TimeSaleValidationError(message) : error;
};

export function useCreateTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) => medusaTimeSalesApi.create(toBody(input)).catch(rethrowReadable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

export function useUpdateTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput & { id: string }) =>
      medusaTimeSalesApi.update(input.id, toBody(input)).catch(rethrowReadable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/**
 * 공개/비공개 전환. 가격·이름·기간은 그대로 두고 상태만 바꾼다 — 서버 상세를 읽어 같은 본문으로 다시
 * 저장한다(쓰기 경로를 하나로 유지하려고 전용 라우트를 두지 않는다).
 */
export function useSetTimeSaleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: 'draft' | 'active' }) => {
      const sale = await medusaTimeSalesApi.get(input.id);
      return medusaTimeSalesApi
        .update(input.id, {
          title: sale.title,
          starts_at: sale.startsAt,
          ends_at: sale.endsAt,
          status: input.status,
          general_prices: Object.entries(sale.generalPrices).map(([variant_id, amount]) => ({ variant_id, amount })),
          membership_prices: Object.entries(sale.membershipPrices).map(([variant_id, amount]) => ({ variant_id, amount })),
        })
        .catch(rethrowReadable);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/** 세일 삭제 = 서버가 리스트·링크·세일 행을 한 번에 지운다. 가격은 즉시 원래대로 돌아간다. */
export function useDeleteTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaTimeSalesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}
```
`useMedusaProductSearch` 는 기존 코드 그대로 옮긴 것이다. 기존 `timeSaleKeys.variantMap`·`detail` 은 쓰는 곳이 없으면 지운 상태가 맞다.

- [ ] **Step 6: 목록 화면**

`marketing-time-sale-template.tsx`:
- `STATUS_CLASS` 에 `draft: 'bg-amber-100 text-amber-700'` 추가.
- `deleteTarget` 타입을 `{ title: string; id: string } | null`, `confirmDelete` 는 `deleteTimeSale.mutateAsync(deleteTarget.id)`.
- `useSetTimeSaleStatus` 를 import 하고 `const setStatus = useSetTimeSaleStatus();`, 공개 확인용 상태 `const [publishTarget, setPublishTarget] = useState<{ id: string; title: string; startsAt: string; endsAt: string } | null>(null);`.
- 행: `const status = resolveTimeSaleStatus(sale.period, now, sale.status);`, `const editPath = \`/mall/marketing/time-sale/${sale.id}/edit\`;`, `<tr key={sale.id} …>`, 멤버십 칸은 `sale.hasMembership ? '있음' : '없음'`.
- 수정 버튼 앞에 전환 버튼:
```tsx
{sale.status === 'draft' ? (
  <Button
    variant="outline"
    size="sm"
    onClick={() =>
      setPublishTarget({ id: sale.id, title: sale.title, startsAt: sale.period.startsAt, endsAt: sale.period.endsAt })
    }
  >
    공개
  </Button>
) : (
  <Button
    variant="ghost"
    size="sm"
    disabled={setStatus.isPending}
    onClick={() =>
      setStatus.mutate(
        { id: sale.id, status: 'draft' },
        {
          onSuccess: () => toast.success('비공개로 바꿨습니다. 세일가가 내려갑니다.'),
          onError: (error) => toast.error(error instanceof Error ? error.message : '전환에 실패했습니다.'),
        },
      )
    }
  >
    비공개
  </Button>
)}
```
- 삭제 버튼 `onClick={() => setDeleteTarget({ title: sale.title, id: sale.id })}`.
- 삭제 `AlertDialog` 아래에 공개 확인창:
```tsx
<AlertDialog open={!!publishTarget} onOpenChange={(open) => !open && setPublishTarget(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{publishTarget?.title} 공개</AlertDialogTitle>
      <AlertDialogDescription>
        {publishTarget && `${formatDate(publishTarget.startsAt)} → ${formatDate(publishTarget.endsAt)}`} 동안 세일가가
        고객에게 적용됩니다. 기간을 바꾸려면 먼저 수정하세요.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>취소</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => {
          if (!publishTarget) return;
          setStatus.mutate(
            { id: publishTarget.id, status: 'active' },
            {
              onSuccess: () => toast.success('공개했습니다.'),
              onError: (error) => toast.error(error instanceof Error ? error.message : '공개에 실패했습니다.'),
              onSettled: () => setPublishTarget(null),
            },
          );
        }}
      >
        공개
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 7: 폼 화면**

`time-sale-form-template.tsx`:
- prop 을 `{ timeSaleId }: { timeSaleId?: string }` 로, `isEdit = Boolean(timeSaleId)`, `useTimeSaleDetail(timeSaleId ?? null)`.
- `useTimeSaleVariantMap()` 호출이 있으면 `useTimeSaleVariantMap(timeSaleId)` (자기 세일 품목을 «이미 세일 중» 으로 표시하지 않게).
- 저장 분기:
```tsx
      if (isEdit && detail) {
        await updateTimeSale.mutateAsync({
          id: detail.id,
          title: title.trim(),
          period,
          status: detail.status,
          rows: mergedRows,
        });
        toast.success('타임세일이 수정되었습니다.');
      } else {
        await createTimeSale.mutateAsync({ title: title.trim(), period, status: 'active', rows: mergedRows });
        toast.success('타임세일이 등록되었습니다.');
      }
```
- 그 밖에 `detail.generalId`/`detail.membershipId` 참조가 남아 있으면 `detail.id` 로 바꾼다.

`src/app/(admin)/mall/marketing/time-sale/[id]/edit/page.tsx`: `<TimeSaleFormTemplate timeSaleId={id} />`.

- [ ] **Step 8: 타입·테스트 확인**

```bash
cd apps/admin-web && npx tsc --noEmit -p . 2>&1 | grep -i "time-sale\|time_sale\|price-lists" ; cd ../.. && npm run test:admin-web -- time-sale
grep -rn "generalId\|membershipId\|buildPriceListPayloads\|MEMBERSHIP_LIST_TITLE_SUFFIX" apps/admin-web/src
```
Expected: tsc 출력에 타임세일 관련 에러 없음(admin-web tsc 는 CI 게이트가 아니므로 여기서 직접 본다), 테스트 PASS, grep 출력 없음.

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): 타임세일 저장을 서버 라우트 한 번으로 바꾸고 비공개·공개 전환을 더한다"
```

---

### Task 6: 스토어프론트 — 합본 한 섹션 · 전체 보기

**Files:**
- Modify: `web/almondyoung-storefront/src/lib/api/medusa/time-sale.ts`
- Create: `web/almondyoung-storefront/src/lib/utils/time-sale-merge.ts`, `time-sale-merge.test.ts`
- Modify: `web/almondyoung-storefront/src/domains/home/template/time-sale/index.tsx`
- Modify: `web/almondyoung-storefront/src/domains/home/components/sections/time-sale-section/index.tsx`
- Create: `web/almondyoung-storefront/src/domains/time-sale/templates/time-sale-all-template.tsx`
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(main)/time-sale/page.tsx`
- Modify: `web/almondyoung-storefront/src/i18n/messages/{ko,en,ja}/home.json`

**Interfaces:**
- Consumes: Task 4 의 `GET /store/time-sale` 응답.
- Produces:
  - `type TimeSale = { id: string; startsAt: string | null; endsAt: string | null; priceListIds: string[]; productIds: string[] }` (`lib/api/medusa/time-sale.ts`, 기존 이름 유지·`title` 제거)
  - `listActiveTimeSales(): Promise<TimeSale[]>` (기존 이름 유지 — 레이아웃·카트가 쓴다)
  - `getTimeSaleOverview(): Promise<TimeSaleOverview>`; `type TimeSaleOverview = { sales: TimeSale[]; products: Array<{ id: string; categoryIds: string[] }> }`
  - `time-sale-merge.ts`: `earliestEnd(sales: TimeSale[]): string | null`, `productEndsAt(sales: TimeSale[]): Map<string, string>`, `orderedProducts(overview: { sales: TimeSale[]; products?: Array<{ id: string; categoryIds: string[] }> }): Array<{ id: string; categoryIds: string[] }>`, `paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; totalPages: number }`

- [ ] **Step 1: 실패하는 테스트**

`web/almondyoung-storefront/src/lib/utils/time-sale-merge.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { earliestEnd, orderedProducts, paginate, productEndsAt } from "./time-sale-merge"

const sale = (id: string, endsAt: string, productIds: string[]) => ({
  id,
  startsAt: "2030-01-01T00:00:00.000Z",
  endsAt,
  priceListIds: [`pl_${id}`],
  productIds,
})

describe("earliestEnd", () => {
  it("returns the soonest end across sales", () => {
    expect(
      earliestEnd([sale("a", "2030-01-09T00:00:00.000Z", []), sale("b", "2030-01-05T00:00:00.000Z", [])])
    ).toBe("2030-01-05T00:00:00.000Z")
  })

  it("returns null without sales", () => {
    expect(earliestEnd([])).toBeNull()
  })
})

describe("productEndsAt", () => {
  it("uses the earlier end when a product is in two sales", () => {
    const map = productEndsAt([
      sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"]),
      sale("b", "2030-01-05T00:00:00.000Z", ["p2"]),
    ])
    expect(map.get("p1")).toBe("2030-01-09T00:00:00.000Z")
    expect(map.get("p2")).toBe("2030-01-05T00:00:00.000Z")
  })
})

describe("orderedProducts", () => {
  it("uses the server order when products is present", () => {
    expect(
      orderedProducts({
        sales: [sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"])],
        products: [
          { id: "p2", categoryIds: ["c1"] },
          { id: "p1", categoryIds: [] },
        ],
      }).map((p) => p.id)
    ).toEqual(["p2", "p1"])
  })

  it("falls back when products is missing", () => {
    expect(
      orderedProducts({
        sales: [sale("a", "2030-01-09T00:00:00.000Z", ["p1", "p2"]), sale("b", "2030-01-05T00:00:00.000Z", ["p2", "p3"])],
      })
    ).toEqual([
      { id: "p1", categoryIds: [] },
      { id: "p2", categoryIds: [] },
      { id: "p3", categoryIds: [] },
    ])
  })
})

describe("paginate", () => {
  it("clamps the page into range", () => {
    const items = Array.from({ length: 85 }, (_, i) => i)
    expect(paginate(items, 3, 40)).toEqual({ items: items.slice(80), page: 3, totalPages: 3 })
    expect(paginate(items, 99, 40).page).toBe(3)
    expect(paginate(items, 0, 40).page).toBe(1)
    expect(paginate([], 1, 40)).toEqual({ items: [], page: 1, totalPages: 1 })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/lib/utils/time-sale-merge.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 순수 함수 구현**

`web/almondyoung-storefront/src/lib/utils/time-sale-merge.ts`:
```ts
import type { TimeSale } from "@/lib/api/medusa/time-sale"

type ProductRef = { id: string; categoryIds: string[] }

/**
 * 진행 중 세일 중 가장 먼저 끝나는 시각. 제목 옆 카운트다운에 쓴다 — 실제보다 길게 보이면
 * "아직 세일인 줄 알았다" CS 가 되므로 짧은 쪽이다.
 */
export function earliestEnd(sales: TimeSale[]): string | null {
  return sales.reduce<string | null>((earliest, sale) => {
    if (!sale.endsAt) return earliest
    return !earliest || sale.endsAt < earliest ? sale.endsAt : earliest
  }, null)
}

/** 상품 → 그 상품이 든 세일 중 가장 이른 종료. 카드마다 자기 남은 시간을 그린다. */
export function productEndsAt(sales: TimeSale[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const sale of sales) {
    if (!sale.endsAt) continue
    for (const id of sale.productIds) {
      const current = map.get(id)
      if (!current || sale.endsAt < current) map.set(id, sale.endsAt)
    }
  }
  return map
}

/**
 * 세일 상품 전체를 보여줄 순서. 서버가 판매순 → 리뷰순 → 최신순으로 준 `products` 를 쓴다.
 * 배포가 섞여 옛 Medusa 가 `products` 없이 응답하면 세일별 목록을 이어 붙인다(카테고리 탭은 빈다).
 */
export function orderedProducts(overview: { sales: TimeSale[]; products?: ProductRef[] }): ProductRef[] {
  if (overview.products) return overview.products
  const seen = new Set<string>()
  const ordered: ProductRef[] = []
  for (const sale of overview.sales) {
    for (const id of sale.productIds) {
      if (seen.has(id)) continue
      seen.add(id)
      ordered.push({ id, categoryIds: [] })
    }
  }
  return ordered
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    totalPages,
  }
}
```

- [ ] **Step 4: API 함수**

`web/almondyoung-storefront/src/lib/api/medusa/time-sale.ts` 교체:
```ts
"use server"

import { sdk } from "@/lib/config/medusa"
import { TIME_SALE_TAG } from "@lib/data/cache-tags"

export type TimeSale = {
  id: string
  startsAt: string | null
  endsAt: string | null
  /** 카드가 "이 가격이 타임세일에서 나왔는가" 를 판별할 때 쓴다. */
  priceListIds: string[]
  productIds: string[]
}

export type TimeSaleOverview = {
  sales: TimeSale[]
  /** 진행 중 세일 상품 전체(판매순 → 리뷰순 → 최신순). 옛 Medusa 응답이면 없다. */
  products?: Array<{ id: string; categoryIds: string[] }>
}

type Response = {
  timeSales?: TimeSale[]
  products?: Array<{ id: string; categoryIds: string[] }>
}

/**
 * 진행 중인 타임세일. 세일 이름은 오지 않는다 — 운영자 내부용이라 고객에게 보이지 않는다.
 *
 * 태그 무효화(Medusa 쓰기·경계 크론)가 1차 신호이고, `revalidate` 는 그게 죽었을 때의 안전망이다.
 * 남은 시간 계산은 화면이 `endsAt` 으로 직접 하므로 이 응답이 낡아도 카운트다운은 정확하다.
 */
export const getTimeSaleOverview = async (): Promise<TimeSaleOverview> => {
  return sdk.client
    .fetch<Response>("/store/time-sale", {
      method: "GET",
      next: { tags: [TIME_SALE_TAG], revalidate: 60 },
    })
    .then((response) => ({ sales: response.timeSales ?? [], products: response.products }))
    .catch(() => ({ sales: [] }))
}

export const listActiveTimeSales = async (): Promise<TimeSale[]> =>
  (await getTimeSaleOverview()).sales
```
`sale.title` 참조가 남았는지 확인: `grep -rn "\.title" src/components/providers/time-sale-provider.tsx src/lib/api/medusa/cart.ts | grep -i sale` → 없어야 한다.

- [ ] **Step 5: 홈 — 섹션 하나**

`src/domains/home/components/sections/time-sale-section/index.tsx`:
- props 에 `productEndsAt: Record<string, string>` 추가.
- `renderOverlay={(product) => <TimeSaleCountdown endsAt={productEndsAt[product.id] ?? endsAt} compact clockOnly className="…기존 그대로…" />}`.
(Map 대신 Record 인 이유: 서버 컴포넌트 → 클라이언트 컴포넌트 props 는 직렬화 가능해야 한다.)

`src/domains/home/template/time-sale/index.tsx` 를 다음 흐름으로 바꾼다(카테고리 탭 소스 계산·`FIXED_CATEGORIES`·`collectCategoryIds`·`filterSoldOut` 등 기존 헬퍼는 그대로 쓴다):
```tsx
export async function TimeSaleWrapper({
  countryCode,
  background,
}: {
  countryCode: string
  background?: "white" | "muted"
}) {
  const overview = await getTimeSaleOverview()
  const sales = overview.sales.filter((sale) => sale.endsAt && sale.productIds.length > 0)
  const endsAt = earliestEnd(sales)
  if (!endsAt) return null

  const region = await getRegion(countryCode)
  // 홈은 상위 HOME_ROWS 칸만 쓰지만 품절을 빼고 다음 상품을 당겨 올려야 하므로 넉넉히 받는다.
  const candidateIds = orderedProducts({ sales, products: overview.products })
    .slice(0, MAX_PRODUCTS)
    .map((product) => product.id)

  const {
    response: { products: fetched },
  } = await listProducts({
    queryParams: { id: candidateIds, limit: MAX_PRODUCTS, fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES },
    regionId: region?.id,
  })
  // `listProducts` 는 id 필터라 순서를 보존하지 않는다 — 서버가 준 순서로 되돌린다.
  const byId = new Map(filterSoldOut(fetched).map((product) => [product.id, product]))
  const products = candidateIds
    .map((id) => byId.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .slice(0, HOME_ROWS)
  if (products.length === 0) return null

  /* customer, wishlistIds, categories, t, sources 계산은 기존 코드 그대로 */

  return (
    <TimeSaleSection
      endsAt={endsAt}
      productEndsAt={Object.fromEntries(productEndsAt(sales))}
      products={products}
      tabs={deriveTimeSaleTabs(
        products.map((product) => ({
          id: product.id,
          categoryIds: (product.categories ?? []).map((category) => category.id),
        })),
        sources,
        t("allTab")
      )}
      customer={customer}
      wishlistIds={wishlistIds}
      background={background}
    />
  )
}
```
import: `getTimeSaleOverview` (기존 `listActiveTimeSales` import 대체), `earliestEnd, orderedProducts, productEndsAt` from `@/lib/utils/time-sale-merge`. 세일별 `sections` 맵과 `sale.title` 참조는 삭제.

- [ ] **Step 6: `/time-sale` 전체 보기**

i18n — `src/i18n/messages/ko/home.json` 의 `timeSale` 객체에 키 추가(en/ja 도 같은 키):
```json
    "allTitle": "타임세일 전체",
    "productCount": "{count}개 상품"
```
en: `"allTitle": "All time sale items"`, `"productCount": "{count} items"`. ja: `"allTitle": "タイムセール全商品"`, `"productCount": "{count}件"`.

`web/almondyoung-storefront/src/domains/time-sale/templates/time-sale-all-template.tsx`:
```tsx
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { TimeSaleDeadline } from "@/components/shared/time-sale-deadline"
import ProductCard from "@/components/products/product-card"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { listCategories } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getWishlist } from "@lib/api/users/wishlist"
import type { TimeSaleOverview } from "@/lib/api/medusa/time-sale"
import { earliestEnd, orderedProducts, paginate, productEndsAt } from "@/lib/utils/time-sale-merge"
import { ALL_TAB_KEY, deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { cn } from "@lib/utils"

const PAGE_SIZE = 40

/**
 * 진행 중 세일 상품 전체. 홈 섹션은 상위 10개만 보이므로 «더보기» 가 여기로 온다.
 *
 * 상품 수백 개를 한 번에 받지 않는다 — id 목록(서버가 정렬·카테고리까지 준다)을 탭으로 거른 뒤
 * 한 페이지(40개)만 `/store/products` 로 받는다. 그래야 멤버십가 은닉·가격 계산이 다른 목록과 같다.
 */
export async function TimeSaleAllTemplate({
  overview,
  countryCode,
  tabKey,
  page,
}: {
  overview: TimeSaleOverview
  countryCode: string
  tabKey: string
  page: number
}) {
  const t = await getTranslations("home.timeSale")
  const sales = overview.sales
  const all = orderedProducts(overview)
  const endsAt = earliestEnd(sales)
  const endsByProduct = productEndsAt(sales)

  const categories = await listCategories()
  const sources = buildTabSources(categories) // 홈 템플릿의 sources 계산을 이 파일로 옮겨 공유한다(Step 6 끝 참고)
  const tabs = deriveTimeSaleTabs(all, sources, t("allTab"))
  const activeTab = tabs.find((tab) => tab.key === tabKey) ?? tabs[0]
  const filtered = activeTab ? all.filter((p) => activeTab.productIds.includes(p.id)) : all
  const { items, page: current, totalPages } = paginate(filtered, page, PAGE_SIZE)

  const [region, customer] = await Promise.all([getRegion(countryCode), retrieveCustomer().catch(() => null)])
  const ids = items.map((p) => p.id)
  const [{ response }, wishlist] = await Promise.all([
    ids.length
      ? listProducts({ queryParams: { id: ids, limit: ids.length }, regionId: region?.id })
      : Promise.resolve({ response: { products: [] as Awaited<ReturnType<typeof listProducts>>["response"]["products"] } }),
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
  ])
  const byId = new Map(response.products.map((product) => [product.id, product]))
  const products = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const wishlistIds = new Set(wishlist.map((item: { productId: string }) => item.productId))

  const href = (key: string, p: number) => {
    const params = new URLSearchParams()
    if (key !== ALL_TAB_KEY) params.set("tab", key)
    if (p > 1) params.set("page", String(p))
    const query = params.toString()
    return `/time-sale${query ? `?${query}` : ""}`
  }

  return (
    <section>
      <h1 className="text-xl font-bold text-foreground">{t("allTitle")}</h1>
      {endsAt && <TimeSaleDeadline endsAt={endsAt} className="mt-2" />}

      {tabs.length > 0 && (
        <nav className="mt-4 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <LocalizedClientLink
              key={tab.key}
              href={href(tab.key, 1)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm",
                tab.key === activeTab?.key ? "border-foreground bg-foreground text-background" : "border-border"
              )}
            >
              {tab.name}
            </LocalizedClientLink>
          ))}
        </nav>
      )}

      <p className="mt-4 text-sm text-muted-foreground">{t("productCount", { count: filtered.length })}</p>

      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              customer={customer}
              isWishlisted={wishlistIds.has(product.id)}
              overlay={
                <TimeSaleCountdown
                  endsAt={endsByProduct.get(product.id) ?? endsAt ?? ""}
                  compact
                  clockOnly
                  className="absolute inset-x-0 bottom-0 z-10 bg-black/55 py-1 text-center text-[13px] font-semibold text-white tabular-nums"
                />
              }
            />
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav className="mt-8 flex justify-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <LocalizedClientLink
              key={p}
              href={href(activeTab?.key ?? ALL_TAB_KEY, p)}
              className={cn(
                "min-w-9 rounded-md px-2 py-1.5 text-center text-sm",
                p === current ? "bg-foreground text-background" : "text-muted-foreground"
              )}
            >
              {p}
            </LocalizedClientLink>
          ))}
        </nav>
      )}
    </section>
  )
}
```
구현 전 확인할 실제 이름(위 코드는 이 이름들을 가정한다 — 다르면 실제 것으로 맞춘다):
- 상품 카드 컴포넌트와 props: `src/domains/home/components/shared/product-section/index.tsx:106` 이 `overlay={renderOverlay(p, index)}` 로 넘기는 그 카드 컴포넌트를 import 하고, 같은 props(`customer`, 위시리스트 여부 prop 이름)를 쓴다.
- `listCategories`·`retrieveCustomer`·`getWishlist` 경로는 `src/domains/home/template/time-sale/index.tsx` 의 import 를 그대로 복사한다.
- 탭 소스: 홈 템플릿의 `rootHandles`/`sources` 계산(현재 60~79행)을 `src/lib/utils/time-sale-tabs.ts` 에 `export function buildTabSources(categories): TimeSaleTabSource[]` 로 옮기고 홈·전체 보기 둘 다 그걸 쓴다. `FIXED_CATEGORIES`·`collectCategoryIds` import 도 함께 옮긴다.
- 페이지 수가 많을 때(>10) 번호를 다 그리는 게 거슬리면 `src/components/shared/pagination` 의 `SharedPagination` 을 쓸 수 있지만, 그건 클라이언트 콜백형이라 링크형인 여기선 위의 단순 링크로 둔다(835개 / 40 = 21페이지 — 감당 가능).

`src/app/[countryCode]/(main)/time-sale/page.tsx` 교체:
```tsx
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { TimeSaleAllTemplate } from "@/domains/time-sale/templates/time-sale-all-template"
import { getTimeSaleOverview } from "@/lib/api/medusa/time-sale"
import { NOINDEX } from "@lib/seo"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

// 내용이 며칠마다 통째로 바뀌고 세일 사이엔 비어 있다. 크롤 시점의 세일가가 색인되면
// 세일이 끝난 뒤에도 검색결과에 남는데, revalidateTag 로는 구글 색인을 못 지운다.
export const metadata: Metadata = { robots: NOINDEX }

export default async function TimeSalePage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const [{ countryCode }, query] = await Promise.all([params, searchParams])
  const [overview, t] = await Promise.all([getTimeSaleOverview(), getTranslations("home.timeSale")])

  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("titleFirst") + t("titleSecond") }]} />

      {/* 세일이 없어도 404 로 보내지 않는다 — 이 링크는 홈·카트·상품상세에 박혀 있어서
          세일 사이에 죽은 링크가 된다. */}
      {overview.sales.length > 0 ? (
        <TimeSaleAllTemplate
          overview={overview}
          countryCode={countryCode}
          tabKey={query.tab ?? "all"}
          page={Number(query.page ?? "1")}
        />
      ) : (
        <div className="py-24 text-center">
          <p className="text-lg font-semibold">{t("noSaleTitle")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("noSaleDescription")}</p>
        </div>
      )}
    </div>
  )
}
```
(기존 breadcrumb 의 하드코딩 「타임세일」을 i18n 으로 바꾼 것이다.)

- [ ] **Step 7: 확인**

```bash
cd web/almondyoung-storefront && npx vitest run && npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
grep -rn "sale\.title\|section\.sale" src
```
Expected: vitest 전부 PASS. tsc 에러 수 **46**(이 브랜치 이전 기준선, 10-09 실측) 이하이고 새 에러가 타임세일 파일에 없다. grep 출력 없음.

로컬 E2E 로 눈 확인(사용자가 브라우저 로그인): 홈에 「타임세일」 섹션 하나, 카드 카운트다운, 「더보기」 → `/time-sale` 에 전체 상품·탭·페이지 이동.

- [ ] **Step 8: 커밋**

```bash
git add web/almondyoung-storefront
git commit -m "feat(storefront): 타임세일을 한 섹션으로 합치고 /time-sale 에서 세일 상품 전체를 보여준다"
```

---

### Task 7: 복구 스크립트

**Files:**
- Create: `scripts/ops/time-sale-recovery-2026-10-09/reconstruct.ts`
- Test: `scripts/ops/time-sale-recovery-2026-10-09/reconstruct.spec.ts`
- Create: `scripts/ops/time-sale-recovery-2026-10-09/run.ts`
- Create: `scripts/ops/time-sale-recovery-2026-10-09/README.md`

**Interfaces:**
- Consumes: Task 4 의 `POST /admin/time-sales` 본문 형식(`TimeSaleWriteInput`), `GET /admin/time-sales`.
- Produces:
  - `type BackupFile = { exportedAt: string; lists: BackupList[]; rules: BackupRule[]; prices: BackupPrice[] }`
  - `type RecoveryPlanEntry = { name: string; generalListId: string; membershipListIds: string[]; body: { title: string; starts_at: string; ends_at: string; status: 'draft' | 'active'; general_prices: Array<{ variant_id: string; amount: number }>; membership_prices: Array<{ variant_id: string; amount: number }> }; summary: { generalCount: number; generalSum: number; membershipCount: number; membershipSum: number } }`
  - `reconstruct(backup: BackupFile, targets: RecoveryTarget[]): RecoveryPlanEntry[]`; `type RecoveryTarget = { name: string; generalListId: string; membershipListIds: string[]; status: 'draft' | 'active'; startsAt: string; endsAt: string }`
  - `latestBatch(prices: BackupPrice[]): Map<string, number>` — variant → amount

- [ ] **Step 1: 실패하는 테스트**

`scripts/ops/time-sale-recovery-2026-10-09/reconstruct.spec.ts`:
```ts
import { latestBatch, reconstruct, type BackupFile, type BackupPrice } from './reconstruct';

const price = (list: string, variant: string, amount: number, createdAt: string, deletedAt: string | null = null): BackupPrice => ({
  id: `${list}_${variant}_${createdAt}`,
  price_list_id: list,
  variant_id: variant,
  amount: String(amount),
  created_at: createdAt,
  deleted_at: deletedAt,
});

describe('latestBatch', () => {
  it('takes the prices of the newest created_at minute', () => {
    const map = latestBatch([
      price('g', 'v1', 900, '2026-10-07T11:45:10.000Z'),
      price('g', 'v1', 900, '2026-10-07T12:12:03.000Z'),
      price('g', 'v2', 800, '2026-10-07T12:12:04.000Z'),
    ]);
    expect([...map.entries()]).toEqual([
      ['v1', 900],
      ['v2', 800],
    ]);
  });

  it('throws when batches disagree on an amount', () => {
    expect(() =>
      latestBatch([price('g', 'v1', 900, '2026-10-07T11:45:00.000Z'), price('g', 'v1', 850, '2026-10-07T12:12:00.000Z')]),
    ).toThrow(/v1/);
  });
});

describe('reconstruct', () => {
  const backup: BackupFile = {
    exportedAt: '2026-10-09T02:50:00.000Z',
    lists: [],
    rules: [],
    prices: [
      price('g', 'v1', 900, '2026-10-07T11:45:00.000Z'),
      price('g', 'v2', 800, '2026-10-07T11:45:00.000Z'),
      price('m1', 'v1', 700, '2026-10-07T11:45:00.000Z'),
      price('m2', 'v1', 700, '2026-10-07T12:18:00.000Z'),
    ],
  };
  const target = {
    name: '복구 ①',
    generalListId: 'g',
    membershipListIds: ['m1', 'm2'],
    status: 'draft' as const,
    startsAt: '2026-10-08T15:00:00.000Z',
    endsAt: '2026-10-16T14:59:00.000Z',
  };

  it('builds a draft body and a summary', () => {
    const [entry] = reconstruct(backup, [target]);
    expect(entry.body).toEqual({
      title: '복구 ①',
      starts_at: '2026-10-08T15:00:00.000Z',
      ends_at: '2026-10-16T14:59:00.000Z',
      status: 'draft',
      general_prices: [
        { variant_id: 'v1', amount: 900 },
        { variant_id: 'v2', amount: 800 },
      ],
      membership_prices: [{ variant_id: 'v1', amount: 700 }],
    });
    expect(entry.summary).toEqual({ generalCount: 2, generalSum: 1700, membershipCount: 1, membershipSum: 700 });
  });

  it('throws when two membership lists disagree', () => {
    const conflicting = { ...backup, prices: [...backup.prices, price('m2', 'v1', 650, '2026-10-07T12:19:00.000Z')] };
    expect(() => reconstruct(conflicting, [target])).toThrow();
  });

  it('throws when a target list has no prices in the backup', () => {
    expect(() => reconstruct(backup, [{ ...target, generalListId: 'missing' }])).toThrow(/missing/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest scripts/ops/time-sale-recovery-2026-10-09`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 순수 재구성 구현**

`scripts/ops/time-sale-recovery-2026-10-09/reconstruct.ts`:
```ts
/**
 * 2026-10-09 타임세일 사고 복구 — 백업 JSON 에서 세일별 «마지막으로 의도한 가격» 을 되살린다.
 *
 * 백업은 사고 당일 라이브 Medusa 에서 뜬 sale price list 19개·가격 16,407행이다(삭제된 행 포함).
 * 수정이 가격을 «교체» 하지 못하고 «덧붙여» 한 리스트에 같은 품목의 가격이 여러 벌 있다. 실측으로
 * 모든 벌의 금액이 같았지만, 다르면 어느 게 의도인지 알 수 없으므로 멈춘다.
 */

export type BackupList = { id: string; title: string; starts_at: string | null; ends_at: string | null; created_at: string };
export type BackupRule = { price_list_id: string; attribute: string };
export type BackupPrice = {
  id: string;
  price_list_id: string;
  variant_id: string | null;
  amount: string | number;
  created_at: string;
  deleted_at: string | null;
};
export type BackupFile = { exportedAt: string; lists: BackupList[]; rules: BackupRule[]; prices: BackupPrice[] };

export type RecoveryTarget = {
  name: string;
  generalListId: string;
  membershipListIds: string[];
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
};

type PriceInput = { variant_id: string; amount: number };

export type RecoveryPlanEntry = {
  name: string;
  generalListId: string;
  membershipListIds: string[];
  body: {
    title: string;
    starts_at: string;
    ends_at: string;
    status: 'draft' | 'active';
    general_prices: PriceInput[];
    membership_prices: PriceInput[];
  };
  summary: { generalCount: number; generalSum: number; membershipCount: number; membershipSum: number };
};

const minute = (iso: string) => iso.slice(0, 16);

/** 한 리스트의 가격들 → variant → 금액. 가장 늦은 저장 묶음(같은 분)의 값을 쓰고, 묶음끼리 다르면 던진다. */
export function latestBatch(prices: BackupPrice[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const p of prices) {
    if (!p.variant_id) continue;
    const amount = Number(p.amount);
    const prev = seen.get(p.variant_id);
    if (prev !== undefined && prev !== amount) {
      throw new Error(`저장 묶음끼리 금액이 다릅니다: ${p.variant_id} (${prev} vs ${amount})`);
    }
    seen.set(p.variant_id, amount);
  }
  if (prices.length === 0) return new Map();

  const last = prices.map((p) => minute(p.created_at)).sort().at(-1)!;
  const map = new Map<string, number>();
  for (const p of [...prices].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (p.variant_id && minute(p.created_at) === last) map.set(p.variant_id, Number(p.amount));
  }
  return map;
}

const pricesOf = (backup: BackupFile, listId: string) => {
  const rows = backup.prices.filter((p) => p.price_list_id === listId);
  if (rows.length === 0) throw new Error(`백업에 가격이 없는 리스트: ${listId}`);
  return latestBatch(rows);
};

const toInputs = (map: Map<string, number>): PriceInput[] =>
  [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variant_id, amount]) => ({ variant_id, amount }));

const sum = (inputs: PriceInput[]) => inputs.reduce((total, p) => total + p.amount, 0);

export function reconstruct(backup: BackupFile, targets: RecoveryTarget[]): RecoveryPlanEntry[] {
  return targets.map((target) => {
    const general = pricesOf(backup, target.generalListId);

    // 멤버십 리스트가 둘 붙은 세일(수정 중 새로 생긴 것)은 두 리스트를 합친다 — 같은 품목이 다르면 던진다.
    const membership = new Map<string, number>();
    for (const listId of target.membershipListIds) {
      for (const [variant, amount] of pricesOf(backup, listId)) {
        const prev = membership.get(variant);
        if (prev !== undefined && prev !== amount) {
          throw new Error(`멤버십 리스트끼리 금액이 다릅니다: ${variant} (${prev} vs ${amount})`);
        }
        membership.set(variant, amount);
      }
    }
    // 일반 세일가 없는 멤버십 품목은 서버가 거절한다 — 미리 걸러 원인을 여기서 드러낸다.
    const orphan = [...membership.keys()].filter((v) => !general.has(v));
    if (orphan.length > 0) throw new Error(`${target.name}: 일반 세일가 없는 멤버십 품목 ${orphan.length}개`);

    const generalPrices = toInputs(general);
    const membershipPrices = toInputs(membership);
    return {
      name: target.name,
      generalListId: target.generalListId,
      membershipListIds: target.membershipListIds,
      body: {
        title: target.name,
        starts_at: target.startsAt,
        ends_at: target.endsAt,
        status: target.status,
        general_prices: generalPrices,
        membership_prices: membershipPrices,
      },
      summary: {
        generalCount: generalPrices.length,
        generalSum: sum(generalPrices),
        membershipCount: membershipPrices.length,
        membershipSum: sum(membershipPrices),
      },
    };
  });
}
```

Run: `npx jest scripts/ops/time-sale-recovery-2026-10-09` → PASS (5).

- [ ] **Step 4: CLI**

`scripts/ops/time-sale-recovery-2026-10-09/run.ts`:
```ts
/**
 * 실행:
 *   npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>            # dry-run (기본)
 *   MEDUSA_ADMIN_API_KEY=sk_... npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts \
 *     --backup <백업.json> --medusa https://medusa.almondyoung.com --apply
 *
 * DB 에 직접 쓰지 않는다 — 정상 저장과 같은 `POST /admin/time-sales` 를 부른다(같은 검증·같은 워크플로).
 * 재실행 안전: 같은 이름의 세일이 이미 있으면 건너뛴다.
 */
import { readFileSync } from 'node:fs';
import { reconstruct, type BackupFile, type RecoveryTarget } from './reconstruct';

// 10-09 KST 00:00 ~ 10-16 KST 23:59. 인기 상품과 ①의 일반용은 운영자가 종료를 당겨 끝내 원래 종료가
// 남아 있지 않다 — 모두 이 기간으로 넣고, 운영자가 공개 전에 고친다.
const STARTS_AT = '2026-10-08T15:00:00.000Z';
const ENDS_AT = '2026-10-16T14:59:00.000Z';

const TARGETS: RecoveryTarget[] = [
  { name: '복구 ① 741품목', generalListId: 'plist_01M4B2Y5X9NR2VY2CSSDEDQ88J', membershipListIds: ['plist_01M4B2Y76621BA5XXCNY3JTQ1Z', 'plist_01M4B4T0N4YMPM9D8M885A9EAQ'] },
  { name: '복구 ② 642품목', generalListId: 'plist_01M4CKCFD3GQR19EF4QKS8MH0D', membershipListIds: ['plist_01M4CKCGD13VQBGPF7WRMXM5F8'] },
  { name: '복구 ③ 400품목', generalListId: 'plist_01M4B9MY88N7TJD8HSN1QCBNEN', membershipListIds: ['plist_01M4B9MYZWX2QH4BQ7K8A7K78P'] },
  { name: '복구 ④ 322품목', generalListId: 'plist_01M4CH5TRSDSSACGT9ZKBQDG9P', membershipListIds: ['plist_01M4CH5VG16XN7PBJANGG4Y4HC'] },
  { name: '복구 ⑤ 87품목', generalListId: 'plist_01M4DSVM1PEP2TBSD1WZ4RHGYY', membershipListIds: ['plist_01M4DSVMJ2HJDY57Y0BCW4WA88'] },
  { name: '인기 상품 타임 세일', generalListId: 'plist_01M4DPPRWYA5FZ7RNPD2QHAD3K', membershipListIds: ['plist_01M4DPPSEFVFZYFZ4BRA32EYKS'] },
].map((t) => ({ ...t, status: 'draft' as const, startsAt: STARTS_AT, endsAt: ENDS_AT }));

// 진행 중인 노몬드: 같은 기간·같은 가격의 active 세일로 옮긴 뒤 옛 리스트를 지운다.
const NOMOND: RecoveryTarget = {
  name: '노몬드 펌제 글루 출시 타임 세일',
  generalListId: 'plist_01M40PH53WQFC025YFBND1Z8E7',
  membershipListIds: ['plist_01M40PH5ACN26W7W8S34T60SZ6'],
  status: 'active',
  startsAt: '2026-10-03T10:50:00.000Z',
  endsAt: '2026-10-16T14:59:00.000Z',
};

// 새 구조로 옮긴 뒤 지울 옛 리스트(아직 삭제 안 된 것만). 노몬드 둘 + 끝난 인기 상품 둘.
const LEGACY_LISTS_TO_DELETE = [
  'plist_01M40PH53WQFC025YFBND1Z8E7',
  'plist_01M40PH5ACN26W7W8S34T60SZ6',
  'plist_01M4DPPRWYA5FZ7RNPD2QHAD3K',
  'plist_01M4DPPSEFVFZYFZ4BRA32EYKS',
];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const backupPath = arg('--backup');
  if (!backupPath) throw new Error('--backup <파일> 이 필요합니다.');
  const apply = process.argv.includes('--apply');
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as BackupFile;

  // 노몬드 시작·종료는 백업의 실제 값으로 덮는다(위 상수는 표시용 기본값).
  const nomondList = backup.lists.find((l) => l.id === NOMOND.generalListId);
  const nomond = nomondList?.starts_at && nomondList.ends_at
    ? { ...NOMOND, startsAt: new Date(nomondList.starts_at).toISOString(), endsAt: new Date(nomondList.ends_at).toISOString() }
    : NOMOND;

  const plan = reconstruct(backup, [...TARGETS, nomond]);
  console.table(plan.map((e) => ({ name: e.name, status: e.body.status, ...e.summary })));

  if (!apply) {
    console.log('dry-run — 반영하려면 --apply. 위 품목 수·합계를 백업과 대조할 것.');
    return;
  }

  const base = arg('--medusa');
  const key = process.env.MEDUSA_ADMIN_API_KEY;
  if (!base || !key) throw new Error('--medusa <URL> 와 MEDUSA_ADMIN_API_KEY 가 필요합니다.');
  const headers = {
    'content-type': 'application/json',
    // Medusa secret API key 는 Basic 인증(키를 사용자명, 비밀번호 비움)으로 보낸다.
    authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };

  const existing = new Set(
    ((await call('/admin/time-sales')).timeSales as Array<{ title: string }>).map((s) => s.title),
  );
  for (const entry of plan) {
    if (existing.has(entry.body.title)) {
      console.log(`건너뜀(이미 있음): ${entry.name}`);
      continue;
    }
    const { timeSale } = await call('/admin/time-sales', { method: 'POST', body: JSON.stringify(entry.body) });
    console.log(`생성: ${entry.name} → ${timeSale.id} (${timeSale.status})`);
  }

  for (const id of LEGACY_LISTS_TO_DELETE) {
    await call(`/admin/price-lists/${id}`, { method: 'DELETE' });
    console.log(`옛 리스트 삭제: ${id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

**주의(노몬드 겹침):** 노몬드 새 세일(active)과 옛 노몬드 리스트는 같은 variant 를 쓰지만, 옛 리스트는 `time_sale` 에 연결되지 않아 서버 겹침 검사에 안 걸린다(검사는 `time_sale` 기준). 겹치는 몇 초 동안 두 리스트 금액이 같아 가격이 흔들리지 않는다.

- [ ] **Step 5: README**

`scripts/ops/time-sale-recovery-2026-10-09/README.md`:
```markdown
# 2026-10-09 타임세일 사고 복구

배경·결정은 `docs/superpowers/specs/2026-10-09-time-sale-module-design.md` §1·§8.

## 전제
- 새 Medusa(타임세일 모듈 포함)가 라이브에 배포돼 있다. 확인: `GET /admin/time-sales` 가 `{ timeSales: [...] }` 를 준다.
- 백업 JSON(사고 당일 11:50 KST 추출, 라이브 데이터라 저장소에 없다). 위치는 운영자가 안다.
- Medusa secret API key(`sk_…`). Medusa 어드민 «설정 → Secret API Keys» 에서 발급하고, 끝나면 폐기한다.

## 순서
1. dry-run: `npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>`
   - 표의 `generalCount` 가 741·642·400·322·87·148·3 인지 본다.
2. 적용: `MEDUSA_ADMIN_API_KEY=sk_… npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json> --medusa https://medusa.almondyoung.com --apply`
3. 어드민 타임세일 목록: 복구 6개가 「비공개」, 노몬드가 「진행중」.
4. 스토어프론트 홈: 타임세일 섹션에 노몬드 3품목만.
5. API key 폐기.
```

- [ ] **Step 6: 루트 게이트 확인 · 커밋**

```bash
npx jest scripts/ops/time-sale-recovery-2026-10-09 && npm run type-check
git add scripts/ops/time-sale-recovery-2026-10-09
git commit -m "feat(ops): 10-09 타임세일 사고를 백업에서 비공개 세일로 복구하는 스크립트"
```

`run.ts` 의 dry-run 은 이 시점에 로컬에서 실제 백업으로 한 번 돌려 표를 확인한다(백업 경로는 사용자에게 묻는다).

---

### Task 8: 전체 게이트 · PR

**Files:** 없음(검증·PR).

- [ ] **Step 1: 게이트**

```bash
npm run type-check
npx jest
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest && cd ../..
scripts/local/run-medusa-integration.sh
cd web/almondyoung-storefront && npx vitest run && cd ../..
npm run test:admin-web
```
Expected: 모두 0 실패. 하나라도 빨가면 고치고 해당 태스크 커밋에 fixup.

- [ ] **Step 2: 로컬 E2E 스모크** (사용자 브라우저 로그인 필요 — `docs/local-e2e-environment.md`)

1. 어드민에서 세일 하나를 **비공개**로 등록 → 목록에 「비공개」. 스토어프론트 홈에 안 보임.
2. 공개 → 홈 섹션에 나타남, 카드 카운트다운.
3. 수정(이름·가격) 저장 → DB 에서 `select count(*) from price where price_list_id in (…) and deleted_at is null` 가 품목 수와 같음.
4. 겹치는 품목으로 두 번째 세일 공개 → 서버 사유 토스트.
5. `/time-sale` 탭·페이지 이동.

- [ ] **Step 3: push · PR**

```bash
git push -u origin fix/time-sale-module
gh pr create --base develop --title "fix: 타임세일을 Medusa 모듈로 옮기고 10-09 사고를 복구한다" --body "$(cat <<'EOF'
## 왜
10-09 타임세일 사고 — 수정 저장이 브라우저에서 API 를 여러 번 순서대로 부르다 멈춰 세일이 둘로 갈렸고, 가격이 교체되지 않고 덧붙었으며, 같은 이름 세일이 어드민에서 하나로 합쳐졌다. 원인·실측은 spec §1.

## 무엇
- Medusa `time_sale` 모듈 + price list 링크. 저장은 보상이 있는 워크플로 하나.
- 어드민: 라우트 한 번 호출, 비공개/공개 전환.
- 스토어프론트: 타임세일 한 섹션, `/time-sale` 전체 보기(탭·페이지·카드별 남은 시간). 세일 이름은 고객 응답에서 제거.
- 복구 스크립트: 백업 → 비공개 세일 6개, 노몬드 이전.

## 배포
spec §9. `sst deploy` 는 순서 지정 불가 — 혼합 창 저하는 표로 정리. **배포 동안 담당자 타임세일 작업 중지**, 배포 후 `scripts/ops/time-sale-recovery-2026-10-09/README.md`.

Spec: docs/superpowers/specs/2026-10-09-time-sale-module-design.md
Plan: docs/superpowers/plans/2026-10-09-time-sale-module.md
EOF
)"
```
