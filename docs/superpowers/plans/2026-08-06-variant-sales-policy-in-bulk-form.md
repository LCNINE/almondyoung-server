# 품목 판매정책을 대량등록 양식에 넣기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 품목별 판매정책 5종(수동 품절·출시 예정·출시예정일·선판매·항상 판매)을 대량등록 엑셀 양식의 조합 시트에서 읽고 발행 시점에 적용한다.

**Architecture:** 정책은 버전에 담기지 않는다(설계 의도). 양식 열 → 프리필 → 차분 → 충돌 검사까지는 기존 기계를 그대로 타고, 버전 적용기 직전에 분기해 발행 트랜잭션 끝에서 `ProductSkuMappingService.updateVariantStockPolicy` 로 적용한다. 버전 필드 변경분이 비면 draft 버전을 만들지 않고 `draft_version_id=NULL` 로 남긴다.

**Tech Stack:** NestJS · Drizzle ORM · Postgres · Jest · Next.js(admin-web)

## Global Constraints

- **마이그레이션 0건.** 컬럼·enum 값을 추가하지 않는다. 새 상태는 기존 nullable `product_bulk_items.draft_version_id` 의 NULL 로 표현한다.
- **시크릿 0 · env 0 · 이벤트 계약 0.**
- 스펙: `docs/superpowers/specs/2026-08-06-variant-sales-policy-in-bulk-form-design.md` — 본문과 어긋나면 스펙이 우선한다.
- 트랜잭션 규약: 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, private 헬퍼는 `tx: DbTransaction` 필수. `this.dbService.run(cb, tx)` 단일 러너만 쓴다 (ADR-0025). per-class `inTx` 헬퍼를 새로 만들지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError` 를 쓴다. 서비스에서 `HttpException` 을 import 하지 않는다.
- 게이트는 **변경 파일 스코프**로만 판정한다. 전역 `npm test`·`npx tsc`·`npm run lint` 는 develop 에서도 red 다(레포 상시 debt). 쓰는 명령:
  - `npm run type-check:scoped` (core 타입)
  - `npx jest --testPathPattern=<해당 spec>` (범위 테스트)
  - `npx eslint <변경 파일>` (lint 차분)
- 통합 테스트는 **전용 scratch DB** 에서만 돈다. 실행법(환경변수 접두가 `dotenv -e` 를 이긴다):
  ```
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern=<spec>
  ```
  정상 소요는 7초 내외. 분 단위로 끌면 DB 를 잘못 잡은 것이다.
- 커밋 메시지는 한국어 본문 + conventional prefix. 각 태스크 끝에서 커밋한다.

## File Structure

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` | 발행 시 CoW 를 건너 정책 인계 | 수정 |
| `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.ts` | 조합 시트 열 정의 + 열 설명(`note`) | 수정 |
| `.../services/form-export.columns-doc.ts` | 스킬용 열 문서 생성기 — `note` 렌더 | 수정 |
| `.../services/form-export.snapshot.reader.ts` | 프리필에 정책 5값 | 수정 |
| `.../services/bulk-session.validator.ts` | 정책 칸 값 검증 | 수정 |
| `.../services/bulk-session.policy.ts` | **정책 키 목록 · 추출기 · 스트리퍼 (순수)** | 신규 |
| `.../services/bulk-session.combos.ts` | **조합키 → variantId 해석기 (applier 에서 추출)** | 신규 |
| `.../services/bulk-draft.applier.ts` | 정책 경로 제외 · 빈 변경분이면 draft 없음 | 수정 |
| `.../services/bulk-session-job.manager.ts` | `draftOne` NULL 수용 · `publishOne` 정책 적용 | 수정 |
| `.../bulk-session.module.ts` | `ProductMatchingModule` 주입 | 수정 |
| `apps/admin-web/src/features/mall/bulk-sessions/lib/item-version-state.ts` | **행의 버전 상태 판정 (순수)** | 신규 |
| `.../session-detail/drafted-panel/index.tsx` | 행에 상태 배지 | 수정 |

---

### Task 1: 발행이 CoW 를 건너 판매정책을 인계한다

독립 버그 수정이다. 나머지 태스크와 결합이 없고 먼저 넣어야 뒤의 발행 경로가 옳은 바닥 위에 선다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts:429-563`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `_reconcileMatchingsAfterPublish(newVersionId: string, previousActiveVersionId: string | null, tx: DbTransaction): Promise<void>` — 시그니처는 그대로. 동작만 확장한다.

- [ ] **Step 1: 유실을 재현하는 통합 테스트를 쓴다**

`bulk-session-publish.integration.spec.ts` 의 마지막 `it` 뒤에 붙인다. 이 스위트의 픽스처 헬퍼(`createPublishedMaster` 계열)와 `db`/`module` 참조는 파일 상단 `beforeAll` 이 이미 만들어 둔 것을 쓴다 — 새 부트스트랩을 만들지 마라.

```ts
it('CoW 로 variantId 가 갈려도 판매정책이 새 품목으로 인계된다', async () => {
  // ① active 버전 + 품목 하나를 만든다
  const { masterId, versionId, variantId } = await createPublishedMasterWithVariant();

  // ② 그 품목에 수동 품절을 건다 (화면이 하는 것과 같은 경로)
  await db.run((trx) =>
    trx.insert(salesVariantPolicies).values({
      variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    }),
  );

  // ③ draft 를 떠서 품목코드를 바꾼다 → CoW 가 새 variantId 를 만든다
  const draft = await db.run((trx) => versionsService.createDraftVersion(versionId, USER_ID, true, trx));
  const cow = await db.run((trx) =>
    variantsService.updateVariantInDraft(masterId, draft.id, variantId, { variantCode: 'CHANGED-1' }, trx),
  );
  expect(cow.cowed).toBe(true);
  expect(cow.variantId).not.toBe(variantId);

  // ④ 발행
  await db.run((trx) => versionsService.publishVersion(draft.id, trx));

  // ⑤ 새 variantId 가 정책을 이어받았는가
  const [policy] = await db.run((trx) =>
    trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, cow.variantId)),
  );
  expect(policy?.availabilityOverride).toBe('manual_out_of_stock');
});
```

`salesVariantPolicies` 는 `../../../../inventory/schema/inventory.schema` 에서 가져온다 — 이 파일이 이미 `outboxEvents`·`productSellableQuantityProjections` 를 같은 경로로 임포트하고 있으니 그 import 문에 이름만 더한다. `afterAll` 정리 목록에도 `salesVariantPolicies` 를 더한다(catalog CASCADE 가 닿지 않는다 — 같은 파일의 기존 주석이 설명하는 이유와 동일).

`createPublishedMasterWithVariant`·`versionsService`·`variantsService` 이름이 이 스위트에 없으면, 기존 케이스가 쓰는 헬퍼·주입 이름을 그대로 따라 쓴다(스위트 상단 `beforeAll` 참조). **손으로 INSERT 해서 master/version 을 만들지 마라** — 파일 헤더가 금지한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern=bulk-session-publish.integration -t 'CoW 로 variantId'`
Expected: FAIL — `policy` 가 `undefined` 라 `expect(undefined?.availabilityOverride).toBe('manual_out_of_stock')` 가 깨진다.

- [ ] **Step 3: 인계를 구현한다**

`product-versions.service.ts` 상단 import 에 `salesVariantPolicies` 를 더한다(이미 같은 파일이 `productMatchings`, `productVariantSkuLinks` 를 `'../../../../inventory/schema/inventory.schema'` 에서 가져온다 — 그 줄에 이름만 추가).

`_reconcileMatchingsAfterPublish` 의 `let inheritedCount = 0;` 바로 위에 정책 인계 블록을 넣는다. **매칭 인계의 `unmatched` 집합을 재사용하지 않는다** — 매칭은 있는데 정책 행만 없는 품목이 있다.

```ts
// 판매정책은 버전에 담기지 않지만(설계 의도), CoW 로 variantId 가 갈리면 "같은 상품의
// 같은 품목"인데 정책이 끊긴다. 매칭 인계와 **조건이 독립**이어야 한다 — 매칭이 이미
// 있는 품목도 정책 행은 없을 수 있으므로 위 `unmatched` 를 재사용하면 안 된다.
const existingPolicies = await tx
  .select({ variantId: salesVariantPolicies.variantId })
  .from(salesVariantPolicies)
  .where(inArray(salesVariantPolicies.variantId, newVariantIds));
const hasPolicy = new Set(existingPolicies.map((p) => p.variantId));

let inheritedPolicyCount = 0;
for (const nv of newVariants) {
  if (hasPolicy.has(nv.variantId)) continue;
  const twin = prevByComboKey.get(this._comboKey(nv.optionValueIds));
  if (!twin) continue;

  const [prevPolicy] = await tx
    .select()
    .from(salesVariantPolicies)
    .where(eq(salesVariantPolicies.variantId, twin.variantId));
  if (!prevPolicy) continue;

  await tx.insert(salesVariantPolicies).values({
    variantId: nv.variantId,
    inventoryManagement: prevPolicy.inventoryManagement,
    preStockSellable: prevPolicy.preStockSellable,
    alwaysSellableZeroStock: prevPolicy.alwaysSellableZeroStock,
    availabilityOverride: prevPolicy.availabilityOverride,
    comingSoonDate: prevPolicy.comingSoonDate,
    effectiveFrom: prevPolicy.effectiveFrom,
    effectiveTo: prevPolicy.effectiveTo,
    updatedBy: prevPolicy.updatedBy,
  });
  inheritedPolicyCount++;
}

if (inheritedPolicyCount > 0) {
  this.logger.log(
    `Policy reconciliation: inherited ${inheritedPolicyCount} variant sales policies from version ${previousActiveVersionId} to ${newVersionId}`,
  );
}
```

이 블록은 `prevByComboKey` 가 만들어진 **뒤**(`:461-464` 이후)에 와야 한다. `unmatched.length === 0` 조기 return(`:451`)보다 **위**로 옮겨야 한다 — 매칭이 전부 있는 버전에서도 정책 인계는 필요하다. 조기 return 을 정책 블록 아래로 내리거나, 정책 블록을 `prevByComboKey` 생성 직후로 올린다. 후자를 택하면 `prevVariants`/`prevByComboKey` 생성이 조기 return 위로 올라가야 하므로, **`unmatched.length === 0` 조기 return 을 지우고 매칭 루프가 빈 `unmatched` 를 자연히 0회 도는 것으로 바꾼다**(비용은 같다 — `unmatched` 가 비면 루프가 안 돈다).

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern=bulk-session-publish.integration`
Expected: PASS — 새 케이스 포함 전량 초록.

- [ ] **Step 5: 역검증 — 수정을 되돌리면 실제로 빨개지는가**

Step 3 의 블록을 통째로 주석 처리하고 Step 4 명령을 다시 돌린다. 새 케이스만 FAIL 해야 한다. 확인 후 주석을 되돌린다. **초록이 나오면 테스트가 아무것도 안 잠그고 있는 것이다** — 픽스처가 CoW 를 정말 일으켰는지(`expect(cow.cowed).toBe(true)`)부터 다시 본다.

- [ ] **Step 6: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/core/products/services/product-versions.service.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts
git add apps/core/src/modules/catalog/core/products/services/product-versions.service.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts
git commit -m "fix(catalog): 발행이 CoW 를 건너 품목 판매정책을 인계한다

품목코드를 바꾼 draft 는 CoW 로 새 variantId 를 얻는데, publish 가
sales_variant_policies 를 인계하지 않아 수동 품절·출시 예정이 조용히
풀렸다. product_matchings 와 같은 자리에서 같은 조합키로 잇는다.

매칭 인계와 조건은 독립이다 — 매칭은 있는데 정책 행만 없는 품목이 있다."
```

---

### Task 2: 조합 시트에 정책 5열을 더한다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.ts:1-80`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.ts:22-30`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.spec.ts`

**Interfaces:**
- Produces:
  - `ColumnDef` 에 `note?: string` 추가
  - `VARIANT_COLUMNS` 에 키 4개 추가: `availabilityOverride` · `comingSoonDate` · `preStockSellable` · `alwaysSellableZeroStock` (라벨 `판매상태재정의` · `출시예정일` · `선판매` · `항상판매`, 전부 `required: false`)

이 태스크만 넣으면 워크북에 빈 열이 생긴다. 수정 행은 base 도 upload 도 빈 문자열이라 차분이 생기지 않으므로 **단독으로 배포해도 안전하다**.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`form-export.columns-doc.spec.ts` 에 추가한다.

```ts
it('조합 시트에 판매정책 열 4종이 있고 각각 설명을 갖는다', () => {
  const keys = VARIANT_COLUMNS.map((c) => c.key);
  expect(keys).toEqual(
    expect.arrayContaining(['availabilityOverride', 'comingSoonDate', 'preStockSellable', 'alwaysSellableZeroStock']),
  );
  for (const key of ['availabilityOverride', 'comingSoonDate', 'preStockSellable', 'alwaysSellableZeroStock']) {
    const col = VARIANT_COLUMNS.find((c) => c.key === key);
    expect(col?.required).toBe(false);
    // 허용값과 빈칸 의미가 스킬 문서에 실려야 한다 — 열 이름만으로는 '품절'/'출시예정' 을 알 수 없다.
    expect(col?.note ?? '').not.toBe('');
  }
});

it('생성된 마크다운이 열 설명을 싣는다', () => {
  const md = buildColumnsMarkdown();
  expect(md).toContain('판매상태재정의');
  expect(md).toContain('품절');
  expect(md).toContain('출시예정');
});
```

`VARIANT_COLUMNS` 임포트가 없으면 파일 상단 import 에 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=form-export.columns-doc`
Expected: FAIL — `expect(keys).toEqual(arrayContaining([...]))` 에서 깨진다.

- [ ] **Step 3: 열과 설명을 더한다**

`form-export.sheets.ts`:

```ts
export interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  /** 허용값·빈칸 의미. 스킬이 읽는 열 문서에 그대로 실린다(form-export.columns-doc.ts). */
  note?: string;
}

const req = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: true, note });
const opt = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: false, note });
```

`VARIANT_COLUMNS` 를 다음으로 바꾼다:

```ts
export const VARIANT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('combination', '조합'),
  opt('combinationLabel', '조합명(참고용)'),
  opt('basePrice', '판매가'),
  opt('membershipPrice', '멤버십가'),
  opt('variantCode', '품목코드'),
  // ── 판매정책. 버전에 담기지 않고 발행 시점에 즉시 적용된다(설계 스펙 §2). ──
  opt(
    'availabilityOverride',
    '판매상태재정의',
    "'품절' 또는 '출시예정'. 값이 찍혀 있던 칸을 비우면 해제된다. 원래 비어 있던 칸은 변경 없음.",
  ),
  opt('comingSoonDate', '출시예정일', "YYYY-MM-DD. 같은 행의 판매상태재정의가 '출시예정'일 때만 쓸 수 있다. 표시 전용이며 판매를 열지 않는다."),
  opt('preStockSellable', '선판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).'),
  opt('alwaysSellableZeroStock', '항상판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).'),
];
```

`form-export.columns-doc.ts` 의 `buildColumnsMarkdown` 표를 4열로 넓힌다:

```ts
    lines.push(`## ${set.name}`, '', '| 열 | 내부 키 | 필수 | 설명 |', '|---|---|---|---|');
    for (const col of set.columns) {
      const label = col.required ? `**${col.label}**` : col.label;
      lines.push(`| ${label} | \`${col.key}\` | ${col.required ? 'O' : ''} | ${col.note ?? ''} |`);
    }
```

`buildColumnsJson` 의 map 에도 `note: col.note ?? null` 을 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern='form-export.(columns-doc|sheets|skill-interop|workbook)'`
Expected: PASS. `skill-interop` 스펙이 생성물 스냅샷을 들고 있으면 그 기대값도 함께 갱신한다 — **스냅샷을 무조건 덮어쓰지 말고**, 늘어난 4행이 위 열 정의와 일치하는지 눈으로 대조한 뒤 갱신한다.

- [ ] **Step 5: 스킬 산출물을 재생성한다**

Run: `npx ts-node scripts/generate-bulk-form-columns.ts`
생성된 파일이 git 에 추적되면 함께 커밋한다. 스크립트가 없거나 경로가 다르면 `form-export.columns-doc.ts` 상단 주석의 명령을 따른다.

- [ ] **Step 6: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.ts apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.ts
git add -A apps/core/src/modules/catalog/operations/bulk-session/services/ scripts/
git commit -m "feat(bulk-session): 조합 시트에 품목 판매정책 4열을 더한다

판매상태재정의·출시예정일·선판매·항상판매. ColumnDef 에 note 를 두어
허용값과 빈칸 의미가 스킬이 읽는 열 문서에 자동으로 실리게 한다.

아직 프리필이 값을 채우지 않으므로 이 커밋만으로는 차분이 생기지 않는다."
```

---

### Task 3: 프리필이 현재 정책을 채운다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.ts:254-277`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `VARIANT_COLUMNS` 키 4종
- Produces: `renderMaster` 가 돌려주는 `PrefillBundle.variants[]` 각 행에 `availabilityOverride`·`comingSoonDate`·`preStockSellable`·`alwaysSellableZeroStock` 문자열이 실린다. 값 표기는 `품절`/`출시예정`/`''`, `YYYY-MM-DD`/`''`, `Y`/`N`.

**왜 서비스를 주입하는가:** 정책 읽기에는 우선순위가 있다 — `preStockSellable`·`alwaysSellableZeroStock` 는 `product_matchings` 가 먼저이고 `sales_variant_policies` 는 폴백이다(`product-sku-mapping.service.ts:196`). 두 테이블을 직접 조회하면 그 규칙이 두 벌이 되고, 엑셀에 찍힌 값과 화면 체크박스가 어긋난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`form-export.snapshot.reader.spec.ts` 에 추가한다. 이 스펙은 로더들을 페이크로 넣는 방식이다 — 기존 `beforeEach` 의 페이크 구성에 `skuMapping` 페이크를 더한다.

```ts
it('프리필이 화면과 같은 우선순위로 판매정책을 채운다', async () => {
  skuMapping.getVariantMatchingBatch.mockResolvedValue({
    data: [
      {
        variantId: 'v1',
        exists: true,
        matching: null,
        stockPolicy: {
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
          comingSoonDate: null,
        },
        projection: null,
      },
    ],
  });

  const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

  expect(bundle?.variants[0]).toMatchObject({
    availabilityOverride: '품절',
    comingSoonDate: '',
    preStockSellable: 'Y',
    alwaysSellableZeroStock: 'N',
  });
});

it('출시예정은 날짜와 함께 찍힌다', async () => {
  skuMapping.getVariantMatchingBatch.mockResolvedValue({
    data: [
      {
        variantId: 'v1',
        exists: true,
        matching: null,
        stockPolicy: {
          preStockSellable: false,
          alwaysSellableZeroStock: true,
          availabilityOverride: 'coming_soon',
          comingSoonDate: '2026-09-01',
        },
        projection: null,
      },
    ],
  });

  const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

  expect(bundle?.variants[0]).toMatchObject({
    availabilityOverride: '출시예정',
    comingSoonDate: '2026-09-01',
    preStockSellable: 'N',
    alwaysSellableZeroStock: 'Y',
  });
});

it('정책 행이 없는 품목은 기본값으로 찍힌다', async () => {
  skuMapping.getVariantMatchingBatch.mockResolvedValue({ data: [] });

  const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

  expect(bundle?.variants[0]).toMatchObject({
    availabilityOverride: '',
    comingSoonDate: '',
    preStockSellable: 'Y',
    alwaysSellableZeroStock: 'N',
  });
});
```

기존 `beforeEach` 에 페이크를 더한다. 품목 페이크가 `id: 'v1'` 을 돌려주도록 `versionLoader.getVariants` 페이크를 맞춘다(기존 값이 다르면 테스트의 `variantId` 를 그 값으로 맞춘다).

```ts
const skuMapping = { getVariantMatchingBatch: jest.fn() };
// reader 생성자 인자 마지막에 skuMapping 을 넣는다.
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=form-export.snapshot.reader`
Expected: FAIL — 생성자 인자 수가 안 맞거나 `variants[0]` 에 정책 키가 없다.

- [ ] **Step 3: 구현한다**

`form-export.snapshot.reader.ts` 생성자에 주입을 더한다:

```ts
constructor(
  // ... 기존 인자들 그대로 ...
  private readonly skuMapping: ProductSkuMappingService,
) {}
```

`renderMaster` 안, `const versionVariants = await this.versionLoader.getVariants(...)` 바로 뒤에 배치 조회를 넣는다:

```ts
// 정책 읽기 우선순위(matching ?? policy ?? 기본값)를 여기서 재구현하지 않는다 —
// 화면이 쓰는 것과 같은 서비스를 부른다. 두 벌이 되면 엑셀과 화면이 조용히 갈린다.
// 배치 API 상한이 500 이라 그 단위로 자른다.
const policyByVariantId = new Map<string, VariantStockPolicyDto>();
for (let i = 0; i < versionVariants.length; i += 500) {
  const chunk = versionVariants.slice(i, i + 500).map((v) => v.id);
  const batch = await this.skuMapping.getVariantMatchingBatch(chunk, tx);
  for (const row of batch.data) policyByVariantId.set(row.variantId, row.stockPolicy);
}
```

`VariantStockPolicyDto` 는 `apps/core/src/modules/product-matching/dto/variant-matching-batch.dto.ts:52` 에 이미 있다 — 새 타입을 만들지 마라.

변환 헬퍼를 파일 지역 함수로 둔다 (`yn` 헬퍼가 이미 이 파일에 있다 — 그 옆에):

```ts
/** DB enum → 워크북 표기. null 은 빈칸(= 재정의 없음). */
function overrideCell(value: 'manual_out_of_stock' | 'coming_soon' | null | undefined): string {
  if (value === 'manual_out_of_stock') return '품절';
  if (value === 'coming_soon') return '출시예정';
  return '';
}
```

`variantsOut.push({...})` 에 네 줄을 더한다:

```ts
      const policy = policyByVariantId.get(variant.id);
      variantsOut.push({
        combination: /* 기존 그대로 */,
        combinationLabel: /* 기존 그대로 */,
        basePrice: /* 기존 그대로 */,
        membershipPrice: /* 기존 그대로 */,
        variantCode: str(variant.variantCode),
        availabilityOverride: overrideCell(policy?.availabilityOverride),
        // coming_soon 이 아닐 때 날짜를 찍으면 검증기가 그 행을 오류로 잡는다(Task 4).
        comingSoonDate: policy?.availabilityOverride === 'coming_soon' ? (policy.comingSoonDate ?? '') : '',
        // 정책 행이 없는 품목의 기본값은 배치 API 의 기본값과 같아야 한다 — 프리필이 다른
        // 기본값을 찍으면 아무도 손대지 않은 행이 전부 차분을 만든다.
        preStockSellable: yn(policy?.preStockSellable ?? true),
        alwaysSellableZeroStock: yn(policy?.alwaysSellableZeroStock ?? false),
      });
```

`bulk-session.module.ts` 의 `imports` 에 `ProductMatchingModule` 을 더한다. 순환 참조로 죽으면 `forwardRef(() => ProductMatchingModule)` 로 감싼다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern='form-export.snapshot.reader|bulk-session.module'`
Expected: PASS.

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.ts apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 프리필이 품목 판매정책을 채운다

읽기 우선순위(matching ?? policy ?? 기본값)를 재구현하지 않고 화면과
같은 getVariantMatchingBatch 를 부른다 — 두 벌이 되면 엑셀과 화면이
조용히 갈린다.

기본값을 배치 API 와 일치시킨다. 다르게 찍으면 아무도 손대지 않은
행이 전부 차분을 만든다."
```

---

### Task 4: 정책 칸 값을 검증한다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.ts:343-374`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 열 키
- Produces: 없음 (검증만)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('판매정책 칸', () => {
  it("판매상태재정의가 '품절'·'출시예정'·빈칸 외면 오류다", () => {
    const errors = validateFields(rowWithVariant({ availabilityOverride: '단종' }), { pricingEditable: true });
    expect(errors.map((e) => e.message).join()).toContain('판매상태재정의');
  });

  it("판매상태재정의가 '출시예정'이 아닌데 출시예정일이 있으면 오류다", () => {
    const errors = validateFields(
      rowWithVariant({ availabilityOverride: '품절', comingSoonDate: '2026-09-01' }),
      { pricingEditable: true },
    );
    expect(errors.map((e) => e.message).join()).toContain('출시예정일');
  });

  it('출시예정일 형식이 틀리면 오류다', () => {
    const errors = validateFields(
      rowWithVariant({ availabilityOverride: '출시예정', comingSoonDate: '2026/09/01' }),
      { pricingEditable: true },
    );
    expect(errors.map((e) => e.message).join()).toContain('YYYY-MM-DD');
  });

  it('선판매·항상판매는 Y/N/빈칸만 받는다', () => {
    const errors = validateFields(rowWithVariant({ preStockSellable: 'true' }), { pricingEditable: true });
    expect(errors.map((e) => e.message).join()).toContain('선판매');
  });

  it('정상값은 오류가 없다', () => {
    const errors = validateFields(
      rowWithVariant({
        availabilityOverride: '출시예정',
        comingSoonDate: '2026-09-01',
        preStockSellable: 'Y',
        alwaysSellableZeroStock: 'N',
      }),
      { pricingEditable: true },
    );
    expect(errors).toEqual([]);
  });
});
```

`rowWithVariant(overrides)` 는 이 스펙에 이미 있는 행 빌더를 쓴다. 없으면 기존 케이스가 `validateFields` 에 넘기는 객체 모양을 그대로 복사해 파일 지역 헬퍼로 만든다 — 조합 행 하나를 가진 최소 번들이면 된다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=bulk-session.validator`
Expected: FAIL — 다섯 케이스 중 앞 넷이 오류를 못 찾아 깨진다.

- [ ] **Step 3: 구현한다**

파일 상단 상수 옆에 더한다:

```ts
/** 워크북 표기 → DB enum. 빈칸은 여기 없다(= 재정의 해제). */
const AVAILABILITY_OVERRIDE_CELLS = ['품절', '출시예정'];
const COMING_SOON_DATE = /^\d{4}-\d{2}-\d{2}$/;
```

`for (const variant of row.bundle.variants) { ... }` 루프 안, `checkMaxLength(variant, VARIANT_MAX_LENGTH, pushVariant);` 바로 뒤에 넣는다:

```ts
    const overrideRaw = (variant.availabilityOverride ?? '').trim();
    if (overrideRaw !== '' && !AVAILABILITY_OVERRIDE_CELLS.includes(overrideRaw)) {
      pushVariant(`${label('availabilityOverride')}는 '품절' 또는 '출시예정'이어야 합니다: ${overrideRaw}`);
    }

    const comingSoonRaw = (variant.comingSoonDate ?? '').trim();
    if (comingSoonRaw !== '') {
      if (!COMING_SOON_DATE.test(comingSoonRaw)) {
        pushVariant(`${label('comingSoonDate')}은(는) 'YYYY-MM-DD' 형식이어야 합니다: ${comingSoonRaw}`);
      }
      // 서버는 coming_soon 이 아니면 날짜를 비운다(product-sku-mapping.service.ts:50-56).
      // 조용히 버리면 작업자는 자기가 넣은 날짜가 사라진 것을 모른다.
      if (overrideRaw !== '출시예정') {
        pushVariant(
          `${label('comingSoonDate')}은(는) ${label('availabilityOverride')}가 '출시예정'일 때만 쓸 수 있습니다.`,
        );
      }
    }

    for (const key of ['preStockSellable', 'alwaysSellableZeroStock'] as const) {
      const raw = (variant[key] ?? '').trim();
      if (raw !== '' && raw !== 'Y' && raw !== 'N') {
        pushVariant(`${label(key)}는 Y 또는 N 이어야 합니다: ${raw}`);
      }
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern=bulk-session.validator`
Expected: PASS.

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.ts
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.spec.ts
git commit -m "feat(bulk-session): 판매정책 칸을 검증한다

출시예정이 아닌데 날짜가 있으면 서버가 조용히 버리므로 행 오류로 잡는다.
검증기는 차분이 아니라 업로드 시트 행 전체를 보므로 이 교차 검사가 된다."
```

---

### Task 5: 정책 추출기와 스트리퍼 (순수 함수)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.spec.ts`

**Interfaces:**
- Consumes: `FlatFields`(`bulk-session.types.ts`) · `PrefillRow`(같은 파일) · `parseFieldPath`(`bulk-session.fields.ts`) · `UpdateVariantStockPolicyDto`(`apps/core/src/modules/product-matching/dto/variant-matching-batch.dto.ts`)
- Produces:
  - `export const VARIANT_POLICY_KEYS: ReadonlySet<string>` — 네 키
  - `export function stripPolicyFields(fields: FlatFields): FlatFields` — 정책 경로를 뺀 나머지
  - `export function hasPolicyFields(fields: FlatFields): boolean`
  - `export function extractVariantPolicies(fields: FlatFields, variantRows: PrefillRow[]): Map<string, UpdateVariantStockPolicyDto>` — 조합키 → 패치

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { extractVariantPolicies, hasPolicyFields, stripPolicyFields } from './bulk-session.policy';

const rows = (combo: string, cells: Record<string, string>) => [{ combination: combo, ...cells }];

describe('stripPolicyFields', () => {
  it('정책 경로만 빼고 나머지는 그대로 둔다', () => {
    const out = stripPolicyFields({
      'product.name': '새 이름',
      'variant:c1.variantCode': 'V-1',
      'variant:c1.preStockSellable': 'Y',
      'variant:c1.availabilityOverride': '품절',
    });
    expect(out).toEqual({ 'product.name': '새 이름', 'variant:c1.variantCode': 'V-1' });
  });

  it('옵션 없는 상품의 빈 조합키도 걸러낸다', () => {
    // combination 이 빈 문자열인 것은 예외가 아니라 계약이다(form-export.snapshot.reader.ts:263-267).
    expect(stripPolicyFields({ 'variant:.preStockSellable': 'Y' })).toEqual({});
  });
});

describe('extractVariantPolicies', () => {
  it('선판매·항상판매를 boolean 으로 옮긴다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.preStockSellable': 'Y', 'variant:c1.alwaysSellableZeroStock': 'N' },
      rows('c1', {}),
    );
    expect(out.get('c1')).toEqual({ preStockSellable: true, alwaysSellableZeroStock: false });
  });

  it('빈칸은 지시 없음이라 키를 만들지 않는다', () => {
    const out = extractVariantPolicies({ 'variant:c1.preStockSellable': '' }, rows('c1', {}));
    expect(out.get('c1')).toBeUndefined();
  });

  it('판매상태재정의를 비우면 해제(null)로 옮긴다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.availabilityOverride': '' },
      rows('c1', { availabilityOverride: '', comingSoonDate: '' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: null, comingSoonDate: null });
  });

  it('출시예정은 날짜와 한 단위로 실린다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.availabilityOverride': '출시예정' },
      rows('c1', { availabilityOverride: '출시예정', comingSoonDate: '2026-09-01' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: 'coming_soon', comingSoonDate: '2026-09-01' });
  });

  it('날짜만 바뀐 행도 override 를 함께 싣는다', () => {
    // upsertSalesVariantPolicy 가 comingSoonDate 를 availabilityOverride **키의 존재**로
    // 게이팅한다 — 날짜만 보내면 조용히 버려진다. 차분에는 override 가 없으므로 시트에서 읽는다.
    const out = extractVariantPolicies(
      { 'variant:c1.comingSoonDate': '2026-10-01' },
      rows('c1', { availabilityOverride: '출시예정', comingSoonDate: '2026-10-01' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: 'coming_soon', comingSoonDate: '2026-10-01' });
  });

  it('정책 차분이 없는 조합은 항목을 만들지 않는다', () => {
    const out = extractVariantPolicies({ 'variant:c1.variantCode': 'V-1' }, rows('c1', {}));
    expect(out.size).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=bulk-session.policy`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

```ts
import type { UpdateVariantStockPolicyDto } from '../../../../product-matching/dto/variant-matching-batch.dto';
import { parseFieldPath } from './bulk-session.fields';
import type { FlatFields, PrefillRow } from './bulk-session.types';

/**
 * 조합 시트의 판매정책 열. **이 목록이 유일한 출처다** — 버전 적용기에서 빼는 쪽과
 * 정책으로 뽑는 쪽이 같은 집합을 봐야 한다. 두 벌이 되면 한쪽만 고쳤을 때 정책이 버전
 * 데이터로 새거나 그 반대가 된다.
 */
export const VARIANT_POLICY_KEYS: ReadonlySet<string> = new Set([
  'availabilityOverride',
  'comingSoonDate',
  'preStockSellable',
  'alwaysSellableZeroStock',
]);

function isPolicyPath(path: string): boolean {
  const parsed = parseFieldPath(path);
  return parsed?.scope === 'variant' && VARIANT_POLICY_KEYS.has(parsed.key);
}

/** 버전 적용기에 넘길 적용분 — 정책 경로를 뺀 나머지. */
export function stripPolicyFields(fields: FlatFields): FlatFields {
  const out: FlatFields = {};
  for (const [path, value] of Object.entries(fields)) {
    if (isPolicyPath(path)) continue;
    out[path] = value;
  }
  return out;
}

export function hasPolicyFields(fields: FlatFields): boolean {
  return Object.keys(fields).some(isPolicyPath);
}

/** 워크북 표기 → DB enum. 빈칸은 해제(null). */
function toOverride(cell: string): 'manual_out_of_stock' | 'coming_soon' | null {
  const raw = cell.trim();
  if (raw === '품절') return 'manual_out_of_stock';
  if (raw === '출시예정') return 'coming_soon';
  return null;
}

/**
 * 차분에서 조합별 정책 패치를 뽑는다.
 *
 * **`판매상태재정의` 와 `출시예정일` 은 한 단위다.** 둘 중 하나라도 차분에 있으면 둘 다
 * **시트 행에서** 읽어 싣는다 — `upsertSalesVariantPolicy` 가 날짜를 override 키의
 * *존재*로 게이팅하므로(product-sku-mapping.service.ts:47-56) 날짜만 보내면 조용히
 * 버려진다. 차분에는 안 바뀐 키가 없으니 시트가 필요하다.
 *
 * **`선판매`·`항상판매` 의 빈칸은 지시 없음이다**(설계 스펙 §4.1) — Y/N 두 상태뿐인 칸을
 * 비우는 것은 해제가 아니다. 키를 만들지 않는다.
 */
export function extractVariantPolicies(
  fields: FlatFields,
  variantRows: PrefillRow[],
): Map<string, UpdateVariantStockPolicyDto> {
  const cellsByCombo = new Map<string, PrefillRow>();
  for (const row of variantRows) cellsByCombo.set((row.combination ?? '').trim(), row);

  const touched = new Map<string, Set<string>>();
  for (const path of Object.keys(fields)) {
    const parsed = parseFieldPath(path);
    if (!parsed || parsed.scope !== 'variant' || !VARIANT_POLICY_KEYS.has(parsed.key)) continue;
    const keys = touched.get(parsed.scopeKey) ?? new Set<string>();
    keys.add(parsed.key);
    touched.set(parsed.scopeKey, keys);
  }

  const out = new Map<string, UpdateVariantStockPolicyDto>();
  for (const [combo, keys] of touched) {
    const cells = cellsByCombo.get(combo);
    const patch: UpdateVariantStockPolicyDto = {};

    if (keys.has('availabilityOverride') || keys.has('comingSoonDate')) {
      const override = toOverride(cells?.availabilityOverride ?? fields[`variant:${combo}.availabilityOverride`] ?? '');
      patch.availabilityOverride = override;
      patch.comingSoonDate = override === 'coming_soon' ? ((cells?.comingSoonDate ?? '').trim() || null) : null;
    }

    for (const key of ['preStockSellable', 'alwaysSellableZeroStock'] as const) {
      if (!keys.has(key)) continue;
      const raw = (fields[`variant:${combo}.${key}`] ?? '').trim();
      if (raw === '') continue; // 빈칸 = 지시 없음
      patch[key] = raw === 'Y';
    }

    if (Object.keys(patch).length > 0) out.set(combo, patch);
  }

  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern=bulk-session.policy`
Expected: PASS (7건).

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.spec.ts
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.policy.spec.ts
git commit -m "feat(bulk-session): 판매정책 추출기와 스트리퍼

정책 키 목록을 한 곳에 둔다 — 버전 적용기에서 빼는 쪽과 정책으로 뽑는
쪽이 같은 집합을 봐야 한다.

판매상태재정의와 출시예정일은 한 단위로 움직인다. 서버가 날짜를 override
키의 존재로 게이팅하므로 날짜만 보내면 조용히 버려진다."
```

---

### Task 6: 정책만 바뀐 행은 버전을 만들지 않는다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts:99-165`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts:1097-1106`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts`

**Interfaces:**
- Consumes: Task 5 의 `stripPolicyFields`
- Produces: `BulkDraftApplier.apply(...)` 의 반환 타입이 `{ draftVersionId: string | null; masterId: string }` 로 넓어진다. 신규(create) 행은 여전히 항상 non-null 이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('정책만 바뀐 수정 행은 draft 버전을 만들지 않는다', async () => {
  const result = await applier.apply(
    updateInput({ fields: { 'variant:c1.availabilityOverride': '품절' } }),
    tx,
  );

  expect(result.draftVersionId).toBeNull();
  expect(versions.createDraftVersion).not.toHaveBeenCalled();
});

it('변경분이 아예 없는 수정 행도 draft 버전을 만들지 않는다', async () => {
  const result = await applier.apply(updateInput({ fields: {} }), tx);

  expect(result.draftVersionId).toBeNull();
  expect(versions.createDraftVersion).not.toHaveBeenCalled();
});

it('충돌을 전부 skip 으로 결정해 비게 된 행도 버전을 만들지 않는다', async () => {
  // applyDecisions 가 skip 필드를 빼므로 **결정 후에야** 빈다. 앞에서 재면 빈 버전이 생긴다.
  const result = await applier.apply(
    updateInput({
      fields: { 'product.brand': '나이키' },
      conflictDecision: { 'product.brand': 'skip' },
    }),
    tx,
  );

  expect(result.draftVersionId).toBeNull();
  expect(versions.createDraftVersion).not.toHaveBeenCalled();
});

it('버전 필드가 하나라도 바뀌면 draft 를 만든다', async () => {
  const result = await applier.apply(
    updateInput({
      fields: { 'product.brand': '나이키', 'variant:c1.availabilityOverride': '품절' },
    }),
    tx,
  );

  expect(result.draftVersionId).toBe('draft-1');
});

it('정책 경로는 버전 적용기에 넘어가지 않는다', async () => {
  await applier.apply(
    updateInput({ fields: { 'product.brand': '나이키', 'variant:c1.preStockSellable': 'Y' } }),
    tx,
  );

  const passedFields = buildVersionDataMock.mock.calls[0][0];
  expect(passedFields).not.toHaveProperty('variant:c1.preStockSellable');
});
```

`updateInput(...)` 은 이 스펙의 기존 입력 빌더를 쓴다. `buildVersionDataMock` 은 `bulk-draft.fields` 모듈의 `buildVersionData` 를 `jest.mock` 으로 감싼 것이다 — 스펙에 이미 그런 모킹이 있으면 그것을 쓰고, 없으면 마지막 케이스만 `versions.updateVersion`/`masters.updateVersion` 에 넘어간 인자를 검사하는 형태로 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=bulk-draft.applier`
Expected: FAIL — `draftVersionId` 가 `'draft-1'` 로 와서 `toBeNull()` 이 깨진다.

- [ ] **Step 3: 구현한다**

`bulk-draft.applier.ts` 의 `applyUpdate` 를 고친다. `const fields = applyDecisions(...)` 바로 뒤에 분기를 넣는다:

```ts
    const fields = applyDecisions(input.payload.fields, input.conflictDecision);

    // ①′ 판매정책은 버전에 담기지 않는다(설계 스펙 §2). 버전 적용기에 넘길 적용분에서 뺀다.
    //    정책 자체는 발행 시점에 publishOne 이 적용한다.
    const versionFields = stripPolicyFields(fields);

    // ①″ 버전 필드 변경분이 비면 **버전을 만들지 않는다**. 정책만 바뀐 행과 완전 무변경
    //     행이 같은 경로다. 판정이 applyDecisions **뒤**인 것이 중요하다 — 충돌을 전부
    //     skip 으로 결정한 행은 그때서야 비고, 앞에서 재면 빈 버전이 생긴다.
    if (Object.keys(versionFields).length === 0) {
      return { draftVersionId: null, masterId };
    }
```

이후 `applyUpdate` 본문에서 `fields` 를 쓰던 자리를 전부 `versionFields` 로 바꾼다 — `buildVersionData` · `buildOptionModify` · `touchesVariant` · `touchesPrice` · `applyVariantCodes` · `applyConstraintUpdate`. **`touchesVariant` 를 따로 손보지 않아도 되는 이유가 여기 있다**: 정책 경로가 이미 빠진 맵을 보므로 자동으로 거짓이 된다.

반환 타입을 넓힌다:

```ts
  private async applyUpdate(
    input: DraftInput,
    tx: DbTransaction,
  ): Promise<{ draftVersionId: string | null; masterId: string }> {
```

`apply` 의 반환 타입도 같은 유니온으로 넓힌다. `applyCreate` 는 그대로 `string` 을 돌려주므로 유니온에 자연히 들어간다.

`bulk-session-job.manager.ts` 의 `draftOne` 은 `draftVersionId: result.draftVersionId` 를 그대로 쓴다 — 컬럼이 이미 nullable 이라 코드 변경이 없다. 타입만 통과하면 된다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern='bulk-draft.applier|bulk-session-job'`
Expected: PASS. 기존 케이스가 `draftVersionId` 를 `string` 으로 단정하다 타입 오류가 나면 그 단정을 `expect(...).toBe('draft-1')` 형태로 바꾼다 — **`as string` 캐스팅으로 덮지 마라.**

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts
git add apps/core/src/modules/catalog/operations/bulk-session/services/
git commit -m "feat(bulk-session): 버전 필드 변경분이 비면 draft 를 만들지 않는다

정책만 바뀐 행과 완전 무변경 행이 같은 경로다. draft_version_id 는
NULL 로 남고, 제외·정리·이미지 청소는 이미 NULL 을 견딘다.

판정은 applyDecisions 뒤다 — 충돌을 전부 skip 으로 결정한 행은 그때서야
비고, 앞에서 재면 빈 버전이 생긴다."
```

---

### Task 7: 조합키 해석기를 공용 모듈로 뽑는다

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.combos.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts:238-381`
- Test: 기존 `bulk-draft.applier.spec.ts` 가 회귀 방어선이다 (동작 변경 없음)

**Interfaces:**
- Produces:
  - `export class BulkSessionComboResolver` — `@Injectable()`
  - `resolveExisting(masterId: string, versionId: string, tx: DbTransaction): Promise<Map<string, string>>` — 조합키(optionValueId 정렬 조인) → variantId
  - `resolveCreated(masterId: string, versionId: string, fields: FlatFields, plan: OptionPlan, tx: DbTransaction): Promise<Map<string, string>>` — 워크북 이름 기반 조합키 → variantId

**순수 이동이다.** 로직을 고치지 않는다 — 발행 경로(Task 8)가 같은 해석을 써야 하므로 복제 대신 옮긴다.

- [ ] **Step 1: 모듈을 만들고 두 메서드를 그대로 옮긴다**

`bulk-draft.applier.ts` 의 `resolveCreatedCombos`(`:238`)와 `resolveExistingCombos`(`:361`)를 새 파일의 클래스 메서드로 옮긴다. **독스트링을 함께 옮긴다** — 특히 `resolveExistingCombos` 위의 "수정 행의 조합키는 이미 idKey 다"와 "옵션 없는 상품은 idKey 가 자연히 '' 로 떨어진다"는 이 기능의 계약이다. 옮기면서 지우면 다음 사람이 같은 함정을 다시 판다.

의존은 생성자로 받는다 (`optionLoader`, 그리고 `tx` 로 접근하는 `productMasterVariants`). applier 가 쓰던 것과 같은 주입 토큰을 쓴다.

- [ ] **Step 2: applier 가 새 모듈에 위임하게 바꾼다**

applier 생성자에 `private readonly combos: BulkSessionComboResolver` 를 더하고, 두 private 메서드 호출을 `this.combos.resolveExisting(...)` / `this.combos.resolveCreated(...)` 로 바꾼다. 옛 private 메서드는 지운다.

`bulk-session.module.ts` 의 `providers` 에 `BulkSessionComboResolver` 를 더한다.

- [ ] **Step 3: 회귀가 없는지 확인한다**

Run: `npx jest --testPathPattern='bulk-draft.applier|bulk-session.module'`
Expected: PASS — **기존 케이스가 하나도 안 바뀐 채로** 통과해야 한다. 스펙을 고쳐야 통과한다면 순수 이동이 아니다. 그 경우 무엇이 달라졌는지 찾아서 되돌린다.

- [ ] **Step 4: 통합 회귀도 돌린다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern=bulk-session-draft.integration`
Expected: PASS — 이 해석기는 실 DB 에서 옵션값 조회를 N+1 로 돈다. 유닛 페이크만으로는 이동이 옳았는지 증명되지 않는다.

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.combos.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "refactor(bulk-session): 조합키 해석기를 공용 모듈로 뽑는다

발행 경로가 같은 해석을 써야 한다 — 복제하면 수정 행(idKey)과 신규 행
(이름 기반)의 비대칭이 두 벌이 되어 한쪽만 고쳐진다.

순수 이동이다. 기존 스펙을 고치지 않고 통과해야 한다."
```

---

### Task 8: 발행이 정책을 적용한다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts:895-977`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 `extractVariantPolicies` · Task 7 `BulkSessionComboResolver` · `ProductSkuMappingService.updateVariantStockPolicy(variantId, dto, tx)`
- Produces: 없음 (레인 내부)

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

```ts
it('draft 가 없는 행은 버전을 발행하지 않고 정책만 적용한다', async () => {
  const item = draftedItem({
    draftVersionId: null,
    masterId: 'm1',
    payload: { fields: { 'variant:c1.availabilityOverride': '품절' } },
    input: { bundle: { variants: [{ combination: 'c1', availabilityOverride: '품절' }] } },
  });
  combos.resolveExisting.mockResolvedValue(new Map([['c1', 'v1']]));

  await manager.runPublishSlice(claimed([item]));

  expect(versions.publishVersion).not.toHaveBeenCalled();
  expect(skuMapping.updateVariantStockPolicy).toHaveBeenCalledWith(
    'v1',
    { availabilityOverride: 'manual_out_of_stock', comingSoonDate: null },
    expect.anything(),
  );
  expect(updatedItem('publishStatus')).toBe('published');
});

it('draft 가 있는 행은 발행 뒤에 정책을 적용한다', async () => {
  const order: string[] = [];
  versions.publishVersion.mockImplementation(async () => void order.push('publish'));
  skuMapping.updateVariantStockPolicy.mockImplementation(async () => void order.push('policy'));
  combos.resolveExisting.mockResolvedValue(new Map([['c1', 'v1']]));

  await manager.runPublishSlice(claimed([draftedItem({
    draftVersionId: 'draft-1',
    payload: { fields: { 'variant:c1.preStockSellable': 'Y' } },
    input: { bundle: { variants: [{ combination: 'c1', preStockSellable: 'Y' }] } },
  })]));

  // 신규 행은 발행되어야 variant 가 존재하고, 수정 행은 CoW 인계를 받은 뒤라야 덮어쓰기가
  // 의미를 갖는다. 순서가 뒤집히면 둘 다 조용히 틀린다.
  expect(order).toEqual(['publish', 'policy']);
});

it('정책 변경이 없는 행은 정책 API 를 부르지 않는다', async () => {
  await manager.runPublishSlice(claimed([draftedItem({
    draftVersionId: 'draft-1',
    payload: { fields: { 'product.brand': '나이키' } },
    input: { bundle: { variants: [] } },
  })]));

  expect(skuMapping.updateVariantStockPolicy).not.toHaveBeenCalled();
});

it('조합키가 안 풀리면 그 행을 실패로 남긴다', async () => {
  combos.resolveExisting.mockResolvedValue(new Map());

  await manager.runPublishSlice(claimed([draftedItem({
    draftVersionId: null,
    masterId: 'm1',
    payload: { fields: { 'variant:c1.availabilityOverride': '품절' } },
    input: { bundle: { variants: [{ combination: 'c1', availabilityOverride: '품절' }] } },
  })]));

  expect(updatedItem('publishStatus')).toBe('failed');
  expect(updatedItem('publishError')).toContain('조합');
});
```

`draftedItem`·`claimed`·`updatedItem` 은 이 스펙의 기존 헬퍼를 쓴다. 없으면 기존 `runPublishSlice` 케이스가 쓰는 형태를 그대로 복사한다. `combos`·`skuMapping` 페이크는 매니저 생성자에 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=bulk-session-job.manager`
Expected: FAIL — 첫 케이스에서 `publishStatus` 가 `'failed'`(“생성된 draft 가 없어 발행할 수 없습니다”)로 온다.

- [ ] **Step 3: 구현한다**

매니저 생성자에 주입을 더한다:

```ts
    private readonly combos: BulkSessionComboResolver,
    private readonly skuMapping: ProductSkuMappingService,
```

`publishOne` 을 고친다. **관문 ①② 의 순서는 계약이므로 손대지 않는다.**

```ts
  private async publishOne(sessionId: string, item: typeof productBulkItems.$inferSelect): Promise<void> {
    const draftVersionId = item.draftVersionId;
    const payload = isBulkItemPayload(item.payload) ? item.payload : null;
    if (!payload) {
      await this.failPublish(item.id, '행 데이터 형식이 달라 발행할 수 없습니다.');
      return;
    }
    const variantRows = isBulkItemInput(item.input) ? item.input.bundle.variants : [];
    const policies = extractVariantPolicies(payload.fields, variantRows);

    // draft 도 정책도 없으면 할 일이 없다 — 변경이 아예 없던 행이다.
    if (!draftVersionId && policies.size === 0) {
      await this.markPublished(item.id);
      return;
    }

    try {
      await this.db.run(async (trx) => {
        // ① 취소 재확인 — 기존 코드 그대로
        // ② 행 상태 재확인 — 기존 코드 그대로
        // ...

        let versionId = draftVersionId;

        if (draftVersionId) {
          // ③ 발행 시점 가드 + ④ 잠금 해제 → publishVersion — 기존 코드 그대로
          // (멱등 분기 포함)
        } else {
          // 버전 없는 행: 정책을 적용할 대상 버전은 현재 active 다.
          if (!item.masterId) throw new BadRequestError('기준 상품이 없어 판매정책을 적용할 수 없습니다.');
          const active = await this.versions.getActiveVersion(item.masterId, trx);
          versionId = active.id;
        }

        // ③′ 정책 적용. 발행 **뒤**여야 한다 — 신규 행은 발행되어야 variant 가 생기고,
        //    수정 행은 CoW 인계(_reconcileMatchingsAfterPublish)를 받은 뒤라야 덮어쓰기가
        //    의미를 갖는다.
        if (policies.size > 0) {
          const masterId = item.masterId;
          if (!masterId || !versionId) {
            throw new BadRequestError('기준 상품이 없어 판매정책을 적용할 수 없습니다.');
          }
          // 신규 행의 조합키는 작업자가 지은 이름이라 되읽어 짝지어야 한다(F7). 그 열쇠인
          // OptionPlan.valueNameByKey 는 `buildOptionAdd` 가 **순수 함수로** 만들고, 그
          // 입력(payload.fields + 옵션 시트 행)이 둘 다 행에 저장돼 있으므로 발행 시점에
          // 그대로 다시 만들 수 있다. applyCreate 가 쓰는 것과 같은 호출이다.
          const comboToVariant =
            item.kind === 'create'
              ? await this.combos.resolveCreated(
                  masterId,
                  versionId,
                  payload.fields,
                  buildOptionAdd(payload.fields, isBulkItemInput(item.input) ? item.input.bundle.options : []).plan,
                  trx,
                )
              : await this.combos.resolveExisting(masterId, versionId, trx);

          for (const [combo, patch] of policies) {
            const variantId = comboToVariant.get(combo);
            // 조용히 건너뛰지 않는다 — 정책이 안 걸렸는데 '발행됨'으로 보이는 것이
            // 이 기능에서 가장 나쁜 침묵이다.
            if (!variantId) {
              throw new BadRequestError(`조합 '${combo}' 에 해당하는 품목을 찾지 못해 판매정책을 적용하지 못했습니다.`);
            }
            await this.skuMapping.updateVariantStockPolicy(variantId, patch, trx);
          }
        }

        await this.markPublishedIn(trx, item.id);
      });
    } catch (error) {
      // 기존 catch 그대로
    }
  }
```

`markPublished`/`markPublishedIn` 은 지금 `publishOne` 안에 인라인으로 두 번 쓰이는 `update(productBulkItems).set({ publishStatus: 'published', publishError: null, updatedAt })` 를 private 헬퍼로 뽑은 것이다. 세 번째 호출자가 생겼으므로 뽑는다.

`buildOptionAdd` 는 `./bulk-draft.options` 에서 가져온다. `isBulkItemInput` 은 이 매니저가 이미 임포트하고 있다(`draftOne` 이 쓴다).

**`buildOptionAdd` 의 `errors` 는 여기서 버린다** — 신규 행이 여기까지 왔다는 것은 `applyCreate` 가 이미 같은 호출로 오류 0 을 확인했다는 뜻이고(`bulk-draft.applier.ts:179-181`), 그 뒤로 입력이 바뀌지 않았다. 다시 검사하면 같은 결론을 두 번 내면서 실패 경로만 늘어난다.

- [ ] **Step 4: 유닛 통과를 확인한다**

Run: `npx jest --testPathPattern=bulk-session-job.manager`
Expected: PASS.

- [ ] **Step 5: 통합 테스트를 더한다**

`bulk-session-publish.integration.spec.ts` 에 추가한다. 실 DB 가 아니면 못 잡는 것 셋이다.

```ts
it('정책만 바뀐 행은 새 버전 없이 정책만 적용된다', async () => {
  const { masterId, versionId, variantId, combo } = await createPublishedMasterWithVariant();
  const beforeCount = await countVersions(masterId);

  await insertSessionItem({
    kind: 'update',
    masterId,
    draftVersionId: null,
    status: 'drafted',
    publishStatus: 'pending',
    payload: { fields: { [`variant:${combo}.availabilityOverride`]: '품절' } },
    input: { bundle: { variants: [{ combination: combo, availabilityOverride: '품절' }] } },
  });

  await jobManager.runPublishSlice(claimSession());

  expect(await countVersions(masterId)).toBe(beforeCount); // 버전이 안 늘었다
  const [policy] = await db.run((trx) =>
    trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, variantId)),
  );
  expect(policy?.availabilityOverride).toBe('manual_out_of_stock');
});

it('조합키가 안 풀리면 그 행만 실패한다', async () => {
  const { masterId } = await createPublishedMasterWithVariant();
  const itemId = await insertSessionItem({
    kind: 'update',
    masterId,
    draftVersionId: null,
    status: 'drafted',
    publishStatus: 'pending',
    payload: { fields: { 'variant:없는조합.availabilityOverride': '품절' } },
    input: { bundle: { variants: [{ combination: '없는조합', availabilityOverride: '품절' }] } },
  });

  await jobManager.runPublishSlice(claimSession());

  const [row] = await db.run((trx) =>
    trx.select().from(productBulkItems).where(eq(productBulkItems.id, itemId)),
  );
  expect(row.publishStatus).toBe('failed');
  expect(row.publishError).toContain('조합');
});
```

`insertSessionItem`·`claimSession`·`countVersions` 는 이 스위트의 기존 헬퍼를 쓴다. 없으면 기존 케이스가 세션·아이템 행을 직접 INSERT 하는 형태를 그대로 따라 만든다(파일 헤더가 그 방식을 명시한다).

- [ ] **Step 6: 통합을 돌린다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern=bulk-session-publish.integration`
Expected: PASS 전량. 소요 7초 내외.

- [ ] **Step 7: 역검증**

첫 통합 케이스에서 `expect(await countVersions(masterId)).toBe(beforeCount)` 를 `toBe(beforeCount + 1)` 로 잠깐 뒤집어 **빨개지는지** 본다. 안 빨개지면 `countVersions` 가 아무것도 안 세고 있는 것이다. 확인 후 되돌린다.

- [ ] **Step 8: 게이트 + 커밋**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts
git add apps/core/src/modules/catalog/operations/bulk-session/services/
git commit -m "feat(bulk-session): 발행이 품목 판매정책을 적용한다

관문 ①② 는 그대로 두고 ③④ 를 draft 유무로 갈랐다. 정책 적용은 발행
**뒤**다 — 신규 행은 발행되어야 variant 가 생기고, 수정 행은 CoW 인계를
받은 뒤라야 덮어쓰기가 의미를 갖는다.

조합키 해석은 발행 트랜잭션 안에서 한다. 정책만 바뀐 행은 발행 시점
가드가 없어, 미리 풀어 저장하면 고아 variantId 를 가리킬 수 있다.

해석 실패는 조용히 건너뛰지 않고 그 행의 실패로 남긴다."
```

---

### Task 9: admin-web 이 버전 없는 행을 구분해 보여준다

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/item-version-state.ts`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/item-version-state.spec.ts`
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/drafted-panel/index.tsx:196-228`

**Interfaces:**
- Consumes: `BulkSessionItem`(`@/lib/types/dto/bulk-session`) — `draftVersionId: string | null` 과 `changes: Array<{...}>` 를 이미 갖는다. **서버 변경이 없다.**
- Produces: `export function itemVersionState(item: Pick<BulkSessionItem, 'draftVersionId' | 'changes'>): 'version' | 'policy-only' | 'no-change'` · `export function itemVersionStateLabel(state): string | null`

**판정을 `.ts` 로 뽑는 이유:** admin-web 은 컴포넌트 테스트가 불가능하다(렌더러가 없고 `.tsx` 가 transform 밖). `.tsx` 안에 두면 검증되지 않는다. `session-labels.ts` 가 선례다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { itemVersionState, itemVersionStateLabel } from './item-version-state';

describe('itemVersionState', () => {
  it('draft 가 있으면 버전 발행이다', () => {
    expect(itemVersionState({ draftVersionId: 'v1', changes: [] })).toBe('version');
  });

  it('draft 가 없고 변경분이 있으면 정책만 적용이다', () => {
    // `as` 캐스팅을 쓰지 않는다(레포 규칙) — BulkSessionItemChange 를 온전히 만든다.
    expect(
      itemVersionState({
        draftVersionId: null,
        changes: [
          {
            field: 'variant:c1.availabilityOverride',
            label: '판매상태재정의 (조합 c1)',
            before: '',
            after: '품절',
          },
        ],
      })
    ).toBe('policy-only');
  });

  it('draft 도 변경분도 없으면 변경 없음이다', () => {
    expect(itemVersionState({ draftVersionId: null, changes: [] })).toBe('no-change');
  });
});

describe('itemVersionStateLabel', () => {
  it('버전 발행 행에는 배지를 달지 않는다', () => {
    // 대다수가 이 상태다 — 전부에 배지를 달면 예외가 눈에 안 띈다.
    expect(itemVersionStateLabel('version')).toBeNull();
  });

  it('나머지 둘은 이유를 밝힌다', () => {
    expect(itemVersionStateLabel('policy-only')).toBe('판매정책만 적용 (새 버전 없음)');
    expect(itemVersionStateLabel('no-change')).toBe('변경 없음 (새 버전 없음)');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=item-version-state --config apps/admin-web/jest.config.js`
Expected: FAIL — 모듈이 없다.

admin-web 의 jest 호출법이 다르면 `apps/admin-web/package.json` 의 test 스크립트를 따른다. 기존 `session-labels.spec.ts` 가 어떻게 실행되는지 확인해 같은 방식을 쓴다.

- [ ] **Step 3: 구현한다**

```ts
import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

export type ItemVersionState = 'version' | 'policy-only' | 'no-change';

/**
 * 이 행이 새 버전을 만들었는가.
 *
 * 품목 판매정책은 버전에 담기지 않으므로(설계 의도), 정책만 바뀐 행과 아무것도 안 바뀐
 * 행은 서버가 draft 를 만들지 않고 `draftVersionId` 를 NULL 로 남긴다. 두 상태는
 * `changes` 의 유무로 갈린다 — 서버가 이미 내려주는 두 필드로 전부 파생되므로 이 판정에
 * 새 API 가 필요 없다.
 */
export function itemVersionState(
  item: Pick<BulkSessionItem, 'draftVersionId' | 'changes'>
): ItemVersionState {
  if (item.draftVersionId) return 'version';
  return item.changes.length > 0 ? 'policy-only' : 'no-change';
}

/** 배지 문구. 통상 경로(`version`)에는 달지 않는다 — 전부에 달면 예외가 눈에 안 띈다. */
export function itemVersionStateLabel(state: ItemVersionState): string | null {
  if (state === 'policy-only') return '판매정책만 적용 (새 버전 없음)';
  if (state === 'no-change') return '변경 없음 (새 버전 없음)';
  return null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: Step 2 와 같은 명령
Expected: PASS (5건).

- [ ] **Step 5: 패널에 배선한다**

`drafted-panel/index.tsx` 의 행 렌더(`:203-213`)를 고친다:

```tsx
                <div className="flex flex-col gap-1 text-sm">
                  <span>
                    {item.rowNumber} · {item.rowKey} · {KIND_LABEL[item.kind]} ·{' '}
                    {displayName}
                  </span>
                  {itemVersionStateLabel(itemVersionState(item)) && (
                    <span className="text-xs text-muted-foreground">
                      {itemVersionStateLabel(itemVersionState(item))}
                    </span>
                  )}
                  {item.errorMessage && (
                    <span role="alert" className="text-destructive">
                      {item.errorMessage}
                    </span>
                  )}
                </div>
```

파일 상단에 import 를 더한다:

```tsx
import { itemVersionState, itemVersionStateLabel } from '../../lib/item-version-state';
```

- [ ] **Step 6: 타입·lint 게이트**

```bash
cd apps/admin-web && npm run type-check && cd ../..
npx eslint apps/admin-web/src/features/mall/bulk-sessions/lib/item-version-state.ts apps/admin-web/src/features/mall/bulk-sessions/session-detail/drafted-panel/index.tsx
```

`type-check` 는 레포 상시 debt 가 있을 수 있다 — **변경 파일에서 새로 생긴 오류만** 본다. 기존 오류 목록과 대조한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/
git commit -m "feat(admin-web): 버전을 만들지 않은 행을 구분해 표시한다

draftVersionId 와 changes 로 전부 파생되므로 서버 변경이 없다.
판정은 .ts 순수 함수로 뽑는다 — admin-web 은 컴포넌트 테스트가
불가능해서 .tsx 안에 두면 검증되지 않는다.

통상 경로(버전 발행)에는 배지를 달지 않는다. 전부에 달면 예외가
눈에 안 띈다."
```

---

### Task 10: 전 구간 회귀와 수동 스모크 항목 추가

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-product-bulk-session-smoke-checklist.md`

**Interfaces:**
- Consumes: Task 1~9 전부

- [ ] **Step 1: 범위 전체 회귀를 돌린다**

```bash
npx jest --testPathPattern='bulk-session|form-export|product-versions'
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bulk_stage6_scratch npx jest --testPathPattern='bulk-session.*integration'
npm run type-check:scoped
```
Expected: 전량 PASS.

- [ ] **Step 2: 스모크 항목을 더한다**

체크리스트 끝에 절을 더한다. **아직 아무도 실행하지 않은 53항목이 이미 있다** — 이 기능의 항목을 그 뒤에 붙이되, 앞의 것을 대체하지 않는다.

```markdown
## 판매정책 열 (2026-08-06 추가)

- [ ] 품절이 걸린 품목이 있는 상품으로 양식을 받아, 조합 시트의 `판매상태재정의` 에 `품절` 이 찍혀 있다
- [ ] `출시예정` 품목의 `출시예정일` 이 함께 찍혀 있다
- [ ] `선판매`·`항상판매` 가 화면 체크박스와 같은 값으로 찍혀 있다
- [ ] `판매상태재정의` 에 `단종` 을 넣고 올리면 그 행만 검증 오류로 잡힌다
- [ ] `품절` + `출시예정일` 을 함께 넣으면 그 행만 검증 오류로 잡힌다
- [ ] 정책만 바꾼 행을 발행하면 **상품 버전이 늘지 않고** 화면 체크박스가 바뀐다
- [ ] 그 행이 검토 목록에서 "판매정책만 적용 (새 버전 없음)" 으로 보인다
- [ ] 아무것도 안 바꾼 행이 "변경 없음 (새 버전 없음)" 으로 보이고 버전이 늘지 않는다
- [ ] 품절이 걸린 품목의 `품목코드` 를 바꿔 발행해도 품절이 유지된다 (CoW 인계)
- [ ] 양식을 받은 뒤 화면에서 같은 품목의 품절을 바꾸고 양식을 올리면 충돌로 뜬다
- [ ] 정책 열을 통째로 지운 파일을 올리면 정책이 하나도 안 바뀐다
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-08-04-product-bulk-session-smoke-checklist.md
git commit -m "docs(bulk-session): 판매정책 열 수동 스모크 11항목 추가"
```

---

## 배포 메모

- **마이그레이션 0건 · 시크릿 0 · env 0 · 이벤트 계약 0.**
- core 선배포가 필수는 아니다 — admin-web 변경이 라벨 파생뿐이고 새 API 를 부르지 않는다.
- 배포 전에 이미 만들어진 양식에는 정책 열이 없다. 열 부재 = "이 필드는 이번에 안 건드림"(`present` 규약)이라 안전하다.
- Task 1 은 대량등록과 무관하게 화면 경로의 버그도 함께 고친다 — 먼저 배포해도 된다.
