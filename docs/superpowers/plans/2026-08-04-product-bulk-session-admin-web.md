# 상품 일괄 등록/수정 세션 — admin-web 화면 단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업자가 양식 다운로드 → 업로드 → 검토·충돌 해소 → 이미지 업로드 → draft 검토 → 일괄 발행을 화면만으로 완주할 수 있게 만든다.

**Architecture:** admin-web 에 `/mall/bulk-sessions` 목록과 `/mall/bulk-sessions/[id]` phase 구동 상세 2화면을 만든다. core 라우트는 이미 전부 있고, 화면을 붙이며 드러난 갭 3건(빈 양식 · `bulkSessionId` 노출 · 충돌 필터)만 additive 로 더한다. admin-web 에 렌더러가 없으므로 판정 로직은 전부 `bulk-session-model.ts` 의 순수 함수로 뽑고 컴포넌트는 배선만 한다.

**Tech Stack:** NestJS + Drizzle (core), Next.js App Router + TanStack Query v5 + shadcn/ui + sonner (admin-web), exceljs, jest + ts-jest

**스펙:** `docs/superpowers/specs/2026-08-04-product-bulk-session-admin-web-design.md` (본 계획의 §참조는 이 문서를 가리킨다. 그 문서가 §로 인용하는 것은 모체 스펙 `2026-07-31-product-bulk-session-design.md` 다)

**추가 (2026-08-04, Task 9 리뷰 → 사용자 결정): core 변경이 3건에서 4건이 된다.**
`BulkSessionItemDto` 에 `productName` 을 더한다. `상품명` 이 워크북 필수 열이라 프리필된 수정 행은
항상 현재 이름을 싣고, `toItemDto` 가 `before !== after` 로 `changes` 를 거르므로 **이름을 실제로
바꾼 행에만** `product.name` 항목이 남는다. 즉 가격만 고치는 흔한 수정 세션은 검토 표 전 행이
`12 · P-000042 · 수정 · — · 변경 3` 으로 뜬다. `rowKey` 는 합성 키(`P-000042`)라 SKU 도 상품코드도
아니고, `masterId` 는 UUID, `draftVersionId` 는 `review` 단계에 null 이다. `toItemDto` 가 이미
`flattenBundle(baseSnapshot)` 을 before 값 계산에 쓰고 있어 값이 그 자리에 있다 — 마이그레이션 0건.

**스펙과 다른 점 셋** (계획이 우선한다):

- **커밋 수.** 스펙 §7 은 "계층순 5개"라고 적었지만 계획은 13개다. 계층 **순서**는 그대로다(core → 배선 → 모델 → 훅 → 목록 → 상세 셸 → 패널 → 마감). 태스크마다 독립적으로 검증 가능한 산출물이 나오도록 더 잘게 쪼갠 것이고, 리뷰 단위가 작아지는 쪽이 낫다는 판단이다
- **`computeItemProgress` 가 둘로 나뉜다.** 스펙 §8 표의 이름은 `computeItemProgress` 하나지만, draft 생성 진행률과 발행 진행률은 분모가 다르다(후자는 `idle` 을 뺀다). `computeDraftingProgress`·`computePublishProgress` 두 함수로 만든다
- **`computeImageGate` 를 만들지 않는다.** 스펙 §8 표에 있지만, 서버가 `requiredResolved`·`requiredTotal` 을 필터와 무관한 값으로 그대로 내려주므로 계산할 것이 없다. 함수를 만들면 값을 옮겨 담기만 하는 껍데기가 된다

## Global Constraints

- **워크트리에서 작업한다** — `.claude/worktrees/feat+product-bulk-session-admin-web`, 브랜치 `feat/product-bulk-session-admin-web`. 메인 체크아웃(`/home/pauseb/workspace/almondyoung-server`)의 파일을 절대 건드리지 않는다
- **마이그레이션 0건.** 스키마를 바꾸는 변경이 하나라도 나오면 계획이 잘못된 것이므로 멈추고 보고한다
- **`any` / `as` 캐스팅 금지.** 불가피하면 주석으로 근거를 남긴다
- **`.tsx` 는 레포 `npm run lint` 글롭(`**/*.ts`) 밖이다** — 변경한 `.tsx` 는 `npx eslint <파일>` 로 직접 본다
- **admin-web 테스트는 루트에서** `npm run test:admin-web -- <경로>`. `apps/admin-web` 안에는 jest 설정이 없다. 이 스크립트의 transform 은 `^.+\.(t|j)s$` 라 **`.tsx` 는 아예 트랜스파일되지 않는다** — 컴포넌트 테스트를 시도하지 마라
- **jest 환경은 node 다** — `File`·`DOM` 타입에 의존하는 순수 함수를 만들지 않는다. 파일은 `{ name: string }` 구조로 받는다
- **전역 `jest`·`tsc`·`nest build core` 는 develop 에서도 red 다**(상시 debt). "전체 초록"으로 판정하지 말고 **변경 파일 기준 차분**으로 본다
- **core 타입 게이트는** `npm run type-check:scoped`, **admin-web 은** `cd apps/admin-web && npm run type-check` (차분 0건이 기준선)
- **한국어 UI 문구는 스펙에 적힌 문장을 그대로 쓴다.** 임의로 바꾸지 않는다
- 커밋 메시지는 한국어, 기존 컨벤션(`feat(scope):` / `fix(scope):`)을 따른다

---

## File Structure

**core (Task 1~3)**

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.types.ts` | `PrefillWorkbookData.exportId` 를 `string \| null` 로 |
| `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.ts` | `exportId === null` 이면 메타 시트를 만들지 않는다 |
| `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.blank.ts` | **신규** — 카테고리 트리만 읽어 빈 워크북을 조립 |
| `.../services/form-export.service.ts` · `../form-export.controller.ts` | 빈 양식 라우트 배선 |
| `.../bulk-session.module.ts` | 신규 provider 등록 |
| `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.ts` | `bulkSessionId` 를 상세 응답에 싣는다 |
| `.../services/bulk-session.conflicts.ts` | **신규** — 충돌 판정 순수 함수(리더·매니저 공용) |
| `.../services/bulk-session.reader.ts` | `getItems` 에 `conflict` 필터 |
| `.../services/bulk-session.manager.ts` | `approve` 가 공용 판정 함수를 쓴다 |
| `.../bulk-session.controller.ts` | `conflict` 쿼리 검증 |

**admin-web (Task 4~12)**

| 파일 | 책임 |
|---|---|
| `apps/admin-web/src/lib/types/dto/bulk-session.ts` | core DTO 미러 타입 |
| `apps/admin-web/src/lib/api/domains/products/bulk-session.client.ts` | 세션 라우트 13개 |
| `.../products/form-export.client.ts` | (기존) + `downloadBlankForm` |
| `.../products/index.ts` | `bulkSession` 배선 |
| `apps/admin-web/src/lib/services/products/query-keys.ts` | `bulkSessions` 계열 키 |
| `apps/admin-web/src/lib/services/products/bulk-session-model.ts` | **★ 순수 헬퍼 — 유일한 자동 검증 대상** |
| `apps/admin-web/src/lib/services/products/bulk-session.ts` | 쿼리·뮤테이션 훅 |
| `apps/admin-web/src/app/(admin)/mall/bulk-sessions/page.tsx` · `[id]/page.tsx` | 라우트 |
| `apps/admin-web/src/features/mall/bulk-sessions/session-list/*` | 목록 + 업로드 모달 |
| `apps/admin-web/src/features/mall/bulk-sessions/session-detail/*` | 상세 셸 + 패널 7종 |
| `apps/admin-web/src/lib/utils/menu.ts` · `components/common/breadcrumb-items.ts` | 내비게이션 |
| `.../products-detail/components/version-lifecycle-actions/*` | 잠금 배너 |

---

### Task 1: core — 빈 양식 다운로드 (`GET /product-forms/blank`)

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.types.ts:11`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.ts:60-65`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.blank.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts:63-79`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `buildFormWorkbook(data: PrefillWorkbookData): Promise<Buffer>` · `flattenCategoryTree(nodes: CategoryTreeNodeDto[]): FlatCategory[]` (`form-export.snapshot.reader.ts` 가 export) · `ProductCategoriesService.getCategoryTree(parentId, includeInactive, tx)` → `{ categories: CategoryTreeNodeDto[] }`
- Produces: `FormExportBlankBuilder.build(tx?: DbTransaction): Promise<Buffer>` · `FormExportService.buildBlankWorkbook(): Promise<Buffer>` · `GET /product-forms/blank` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**⚠️ 라우트 순서 함정:** `@Get('blank')` 은 **반드시 `@Get(':exportId')` 보다 위**에 선언해야 한다. Nest 는 선언 순서로 매칭하므로 아래에 두면 `blank` 가 `:exportId` 파라미터로 잡혀 404 가 난다.

- [ ] **Step 1: `exportId` 를 nullable 로 여는 실패 테스트를 쓴다**

`form-export.workbook.spec.ts` 맨 아래에 추가:

```typescript
describe('buildFormWorkbook — 빈 양식 (exportId 없음)', () => {
  const blank: PrefillWorkbookData = {
    exportId: null,
    products: [],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    categoryPaths: ['여성패션', '여성패션>니트'],
  };

  it('메타 시트를 만들지 않는다 — 보이는 7개뿐이다', async () => {
    const wb = await load(await buildFormWorkbook(blank));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      SHEET_NAMES.products,
      SHEET_NAMES.options,
      SHEET_NAMES.variants,
      SHEET_NAMES.categories,
      SHEET_NAMES.constraints,
      SHEET_NAMES.images,
      SHEET_NAMES.categoryReference,
    ]);
  });

  it('exportId 를 읽으면 null 이다 — 업로드가 신규 전용 세션으로 해석한다', async () => {
    expect(await readExportIdFromWorkbook(await buildFormWorkbook(blank))).toBeNull();
  });

  it('데이터가 0행이어도 한국어 헤더는 그대로 있다', async () => {
    const wb = await load(await buildFormWorkbook(blank));
    const header = wb.getWorksheet(SHEET_NAMES.products)!.getRow(1);
    expect(labelsOf(PRODUCT_COLUMNS).map((_, i) => header.getCell(i + 1).text)).toEqual(
      labelsOf(PRODUCT_COLUMNS),
    );
  });

  it('카테고리 참조 시트는 0행이 아니라 트리를 담는다', async () => {
    const wb = await load(await buildFormWorkbook(blank));
    const ws = wb.getWorksheet(SHEET_NAMES.categoryReference)!;
    expect(ws.getRow(2).getCell(1).text).toBe('여성패션');
    expect(ws.getRow(3).getCell(1).text).toBe('여성패션>니트');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:product-form-export 2>/dev/null || npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts`
Expected: FAIL — `exportId: null` 이 `PrefillWorkbookData` 타입에 맞지 않아 ts-jest 가 타입 에러를 낸다

- [ ] **Step 3: 타입과 조립기를 고친다**

`form-export.types.ts:11`:

```typescript
export interface PrefillWorkbookData {
  /** null 이면 빈 양식이다 — 숨은 메타 시트를 만들지 않아 업로드가 신규 전용 세션으로 읽는다. */
  exportId: string | null;
```

`form-export.workbook.ts` 의 메타 시트 블록(`:60-65`)을 조건부로 바꾼다:

```typescript
  // exportId 는 숨은 시트에 둔다. 스펙의 "숨은 열"을 시트로 구현한 것으로, 열은 정렬·삭제로
  // 쉽게 유실되지만 시트는 훨씬 덜 건드려진다. 유실되면 2단계가 신규 전용 세션으로 해석한다.
  //
  // **빈 양식(exportId === null)은 이 시트를 아예 만들지 않는다.** 심어두면 30일 뒤 잡이
  // 만료되면서 그 워크북이 "exportId 는 있는데 해석 안 됨" 으로 업로드 거부된다
  // (bulk-session.manager.ts). 빈 양식은 프리필이 없어 만료라는 개념 자체가 없어야 한다.
  if (data.exportId !== null) {
    const meta = wb.addWorksheet(SHEET_NAMES.meta);
    meta.getCell('A1').value = 'exportId';
    meta.getCell(META_CELL).value = data.exportId;
    meta.state = 'veryHidden';
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts`
Expected: PASS (기존 케이스 포함 전부)

- [ ] **Step 5: 빈 워크북 조립 서비스를 만든다**

Create `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.blank.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../../catalog.types';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { flattenCategoryTree } from './form-export.snapshot.reader';
import { buildFormWorkbook } from './form-export.workbook';

/**
 * 빈 양식(신규 전용) 워크북을 만든다.
 *
 * 잡도 스냅샷도 만들지 않는다 — 프리필할 상품이 없으므로 읽을 것이 카테고리 트리뿐이고,
 * 그래서 ALB 60초 안에 동기로 끝난다. 양식 잡 경로(POST /product-forms)와 달리 만료도
 * 없다: `exportId` 를 심지 않아 워크북이 어떤 잡에도 매이지 않는다(form-export.workbook.ts).
 */
@Injectable()
export class FormExportBlankBuilder {
  constructor(private readonly categories: ProductCategoriesService) {}

  async build(tx?: DbTransaction): Promise<Buffer> {
    // 스냅샷 리더와 같은 규약으로 읽는다 — includeInactive=true 로 트리를 받고
    // 참조 시트에는 활성만 싣는다(비활성 카테고리는 새로 고를 수 없어야 한다).
    const tree = await this.categories.getCategoryTree(undefined, true, tx);
    const categoryPaths = flattenCategoryTree(tree.categories)
      .filter((c) => c.isActive)
      .map((c) => c.path);

    return buildFormWorkbook({
      exportId: null,
      products: [],
      options: [],
      variants: [],
      categories: [],
      constraints: [],
      images: [],
      categoryPaths,
    });
  }
}
```

- [ ] **Step 6: 서비스·컨트롤러·모듈을 배선한다**

`form-export.service.ts` — 생성자에 빌더를 더하고 메서드 하나 추가:

```typescript
import { FormExportBlankBuilder } from './form-export.blank';

  constructor(
    private readonly manager: FormExportManager,
    private readonly blankBuilder: FormExportBlankBuilder,
  ) {}

  buildBlankWorkbook(): Promise<Buffer> {
    return this.blankBuilder.build();
  }
```

`form-export.controller.ts` — **`@Get(':exportId')` 위에** 다음을 넣는다:

```typescript
import { Header, StreamableFile } from '@nestjs/common';

  // ⚠️ 이 핸들러는 반드시 `@Get(':exportId')` 보다 **위**에 있어야 한다. Nest 는 선언
  // 순서로 매칭하므로 아래에 두면 'blank' 가 :exportId 로 잡혀 404 가 난다.
  @Get('blank')
  @ApiOperation({ summary: '빈 양식 다운로드. 신규 전용 세션용 — 잡도 만료도 없다.' })
  @ApiResponse({ status: 200, description: 'xlsx 바이너리' })
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="product-bulk-form-blank.xlsx"')
  async getBlank(): Promise<StreamableFile> {
    return new StreamableFile(await this.service.buildBlankWorkbook());
  }
```

`bulk-session.module.ts` — `providers` 배열에 `FormExportBlankBuilder` 를 더하고 import 문을 추가한다. `CategoriesModule` 은 이미 `imports` 에 있어 의존성이 해석된다.

- [ ] **Step 7: 타입 게이트와 부팅 확인**

Run: `npm run type-check:scoped`
Expected: 이 변경으로 인한 **신규** 에러 0건

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.module.spec.ts`
Expected: PASS — DI 그래프가 새 provider 를 해석한다

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 빈 양식 다운로드 라우트

신규 전용 세션은 exportId 없는 워크북에서 시작한다고 매니저가 전제하지만
(bulk-session-job.manager.ts:357) 그런 워크북을 만들 방법이 없었다.
카테고리 트리만 읽어 동기로 조립한다 — 잡도 스냅샷도 만료도 없다."
```

---

### Task 2: core — 버전 상세에 `bulkSessionId` 노출

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.ts:9` (인터페이스) · `:102` 부근 (매핑)
- Test: `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: `ProductDetailDto extends ProductMasterVersion` (`catalog.types.ts:323`) — `bulkSessionId` 는 `InferSelectModel` 이라 이미 타입에 있고, 리더가 `select()` 로 전 컬럼을 읽으므로 런타임 값도 이미 있다
- Produces: `ProductVersionDetailResponseDto.bulkSessionId: string | null`

**왜 매퍼만 고치면 되는가:** `ProductReadAssembler.getVersionDetail` 은 `{ ...version, ... }` 로 전 컬럼을 실어 보내지만, 컨트롤러가 `ProductVersionMapper.toDetailResponseDto` 로 **필드를 골라 담아** 응답한다(`product-master-versions.controller.ts:88`). 그 화이트리스트에 `bulkSessionId` 가 없는 것이 유일한 원인이다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`product-version.mapper.spec.ts` 가 없으면 만들고, 있으면 추가한다:

```typescript
import { ProductVersionMapper } from './product-version.mapper';
import type { ProductDetailDto } from '../../../catalog.types';

function detailFixture(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  // 매퍼가 읽는 필드만 채운다 — 나머지는 매퍼가 건드리지 않으므로 형태만 맞으면 된다.
  //
  // `as unknown as` 근거: ProductDetailDto 는 productMasterVersions 전 컬럼(InferSelectModel)
  // 위에 관계 6개를 얹은 타입이라 픽스처가 40여 필드를 전부 채워야 한다. 이 테스트가 보는
  // 것은 매퍼가 bulkSessionId 를 통과시키는가 하나뿐이고, 나머지 필드를 채우면 매퍼가
  // 읽지도 않는 값이 테스트 의도를 가린다. 캐스팅 범위를 이 헬퍼 하나로 가둔다.
  return {
    id: 'v1',
    masterId: 'm1',
    version: 1,
    status: 'draft',
    name: '테스트 상품',
    createdAt: new Date('2026-08-04T00:00:00Z'),
    updatedAt: new Date('2026-08-04T00:00:00Z'),
    images: [],
    categories: [],
    optionGroups: [],
    variants: [],
    channelProducts: [],
    ...overrides,
  } as unknown as ProductDetailDto;
}

describe('ProductVersionMapper.toDetailResponseDto — bulkSessionId', () => {
  it('일괄 세션에 잠긴 draft 는 세션 id 를 실어 보낸다', () => {
    const dto = ProductVersionMapper.toDetailResponseDto(
      detailFixture({ bulkSessionId: 'session-1' } as Partial<ProductDetailDto>),
    );
    expect(dto.bulkSessionId).toBe('session-1');
  });

  it('평범한 draft 는 null 이다', () => {
    const dto = ProductVersionMapper.toDetailResponseDto(
      detailFixture({ bulkSessionId: null } as Partial<ProductDetailDto>),
    );
    expect(dto.bulkSessionId).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts`
Expected: FAIL — `Property 'bulkSessionId' does not exist on type 'ProductVersionDetailResponseDto'`

- [ ] **Step 3: 매퍼를 고친다**

`product-version.mapper.ts:9` 의 `ProductVersionDetailResponseDto` 인터페이스에 `draftOwnerId` 바로 아래로:

```typescript
  /**
   * 일괄 등록/수정 세션이 이 draft 를 잠갔다면 그 세션 id. 화면은 이 값이 있으면
   * 발행·삭제 버튼을 숨긴다 — 서버가 둘 다 409 로 거부하기 때문이다
   * (product-versions.service.ts 의 세션 잠금 가드).
   */
  bulkSessionId: string | null;
```

`toDetailResponseDto` 의 `draftOwnerId: detail.draftOwnerId,` 바로 아래로:

```typescript
      bulkSessionId: detail.bulkSessionId ?? null,
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts`
Expected: PASS

Run: `npm run type-check:scoped`
Expected: 신규 에러 0건

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/mappers/
git commit -m "feat(catalog): 버전 상세 응답에 bulkSessionId

세션 draft 는 개별 발행·삭제가 409 인데 응답에 그 사실이 없어, 화면이
눌러도 실패하는 버튼을 띄우고 있었다. 값은 리더가 이미 읽고 있었고
매퍼 화이트리스트에만 빠져 있었다."
```

---

### Task 3: core — `GET :id/items` 충돌 필터

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.conflicts.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.conflicts.spec.ts`
- Modify: `.../services/bulk-session.reader.ts:207-235` (`getItems`)
- Modify: `.../services/bulk-session.manager.ts:308-345` (`approve`)
- Modify: `.../services/bulk-session.service.ts` (시그니처 통과)
- Modify: `.../bulk-session.controller.ts:112-133`

**Interfaces:**
- Consumes: `toConflictMap(value: unknown)` · `toConflictDecisionMap(value: unknown)` — 둘 다 `bulk-session.reader.ts` 가 이미 가진 되살리기 함수. **이 태스크가 그 둘을 `bulk-session.conflicts.ts` 로 옮기고 리더는 재export 한다**
- Produces:
  - `export type ConflictFilter = 'any' | 'undecided'`
  - `export function isConflictFilter(v: string): v is ConflictFilter`
  - `export function countUndecided(conflict: unknown, decision: unknown): number`
  - `export function hasUndecided(conflict: unknown, decision: unknown): boolean`
  - `BulkSessionReader.getItems(sessionId, userId, status, conflict, page, limit, tx?)`
  - `GET /product-bulk-sessions/:id/items?conflict=any|undecided`

**페이징 규약:** `conflict` 필터가 붙으면 `getImages` 와 같은 방식으로 **충돌 행만 SQL 로 뽑아 메모리에서 슬라이스**한다. `undecided` 는 jsonb 두 개의 키 차집합이라 SQL 술어로 못 내리고, 충돌은 정의상(작업자가 바꾼 필드 ∩ 남이 바꾼 필드) 드물다. 필터가 없으면 기존 SQL 페이징 경로 그대로다.

- [ ] **Step 1: 순수 판정 함수의 실패 테스트를 쓴다**

Create `bulk-session.conflicts.spec.ts`:

```typescript
import { countUndecided, hasUndecided, isConflictFilter } from './bulk-session.conflicts';

const conflict = {
  name: { base: 'A', mine: 'B', current: 'C' },
  brand: { base: 'X', mine: 'Y', current: 'Z' },
};

describe('countUndecided', () => {
  it('결정이 없으면 충돌 필드 전부가 미결정이다', () => {
    expect(countUndecided(conflict, null)).toBe(2);
  });

  it('일부만 결정하면 나머지만 센다', () => {
    expect(countUndecided(conflict, { name: 'overwrite' })).toBe(1);
  });

  it('전부 결정하면 0 이다 — skip 도 결정이다', () => {
    expect(countUndecided(conflict, { name: 'overwrite', brand: 'skip' })).toBe(0);
  });

  it('충돌하지 않은 필드의 결정은 세지 않는다', () => {
    expect(countUndecided({ name: conflict.name }, { name: 'skip', ghost: 'overwrite' })).toBe(0);
  });

  it('충돌이 없으면 0 이다', () => {
    expect(countUndecided(null, null)).toBe(0);
    expect(countUndecided({}, null)).toBe(0);
  });

  it('형태가 깨진 jsonb 는 그 필드를 버린다', () => {
    expect(countUndecided({ name: 'not-an-object' }, null)).toBe(0);
  });

  it('overwrite/skip 이 아닌 결정 값은 결정으로 치지 않는다', () => {
    expect(countUndecided({ name: conflict.name }, { name: 'maybe' })).toBe(1);
  });
});

describe('hasUndecided', () => {
  it('하나라도 미결정이면 true', () => {
    expect(hasUndecided(conflict, { name: 'skip' })).toBe(true);
  });
  it('전부 결정이면 false', () => {
    expect(hasUndecided(conflict, { name: 'skip', brand: 'skip' })).toBe(false);
  });
});

describe('isConflictFilter', () => {
  it.each(['any', 'undecided'])('%s 를 받는다', (v) => {
    expect(isConflictFilter(v)).toBe(true);
  });
  it.each(['', 'ANY', 'decided', 'true'])('%s 는 거부한다', (v) => {
    expect(isConflictFilter(v)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.conflicts.spec.ts`
Expected: FAIL — `Cannot find module './bulk-session.conflicts'`

- [ ] **Step 3: 판정 함수를 만든다**

`bulk-session.reader.ts` 에 있는 `toConflictMap`·`toConflictDecisionMap`(그리고 그 둘이 쓰는 타입)을 **잘라내어** 새 파일로 옮긴다. 리더는 새 파일에서 import 한다 — 판정 로직이 두 벌이 되면 승인과 목록 필터가 서로 다른 답을 내는 자리가 생긴다.

Create `bulk-session.conflicts.ts`:

```typescript
/**
 * 충돌 판정을 한 곳에 모은다.
 *
 * 승인 가드(`BulkSessionManager.approve`)와 목록 필터(`BulkSessionReader.getItems`)가
 * **같은** 술어를 써야 한다. 복사본이 생기면 "목록에는 미결정이 안 보이는데 승인은
 * 409" 같은 상태가 만들어진다.
 */

export const CONFLICT_FILTER_VALUES = ['any', 'undecided'] as const;
export type ConflictFilter = (typeof CONFLICT_FILTER_VALUES)[number];

export function isConflictFilter(value: string): value is ConflictFilter {
  return (CONFLICT_FILTER_VALUES as readonly string[]).includes(value);
}

export interface ConflictEntry {
  base: string;
  mine: string;
  current: string;
}

export type ConflictMap = Record<string, ConflictEntry>;
export type ConflictDecisionMap = Record<string, 'overwrite' | 'skip'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** jsonb 로 왕복한 conflict 열을 되살린다. 형태가 다르면(옛 코드가 쓴 값 등) 그 필드만 버린다. */
export function toConflictMap(value: unknown): ConflictMap {
  if (!isRecord(value)) return {};
  const out: ConflictMap = {};
  for (const [field, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { base, mine, current } = entry;
    if (typeof base !== 'string' || typeof mine !== 'string' || typeof current !== 'string') continue;
    out[field] = { base, mine, current };
  }
  return out;
}

/** jsonb 로 왕복한 conflictDecision 열을 되살린다. `overwrite`/`skip` 이 아닌 값은 버린다. */
export function toConflictDecisionMap(value: unknown): ConflictDecisionMap {
  if (!isRecord(value)) return {};
  const out: ConflictDecisionMap = {};
  for (const [field, decision] of Object.entries(value)) {
    if (decision === 'overwrite' || decision === 'skip') out[field] = decision;
  }
  return out;
}

/** 이 행에서 아직 사람이 정하지 않은 충돌 **필드** 수. 행 수가 아니다. */
export function countUndecided(conflict: unknown, decision: unknown): number {
  const conflictMap = toConflictMap(conflict);
  const decisionMap = toConflictDecisionMap(decision);
  return Object.keys(conflictMap).filter((field) => !decisionMap[field]).length;
}

export function hasUndecided(conflict: unknown, decision: unknown): boolean {
  return countUndecided(conflict, decision) > 0;
}
```

> **구현 시 실측할 것:** `bulk-session.reader.ts` 의 기존 `toConflictMap`/`toConflictDecisionMap` 본문을 **바이트 그대로** 옮겼는지 확인하라. 위 코드는 리더의 것을 옮겨 적은 것이지만, 실제 파일이 다르면 **실제 파일이 정답**이다 — 동작을 바꾸면 이 태스크가 리팩터링이 아니라 기능 변경이 된다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.conflicts.spec.ts`
Expected: PASS

- [ ] **Step 5: 리더의 `getItems` 에 필터를 단다**

`bulk-session.reader.ts` 의 `getItems` 를 다음 모양으로 바꾼다:

```typescript
  async getItems(
    sessionId: string,
    userId: string,
    status: BulkItemStatus | undefined,
    conflict: ConflictFilter | undefined,
    page = 1,
    limit = 20,
    tx?: DbTransaction,
  ): Promise<BulkSessionItemListDto> {
    return this.db.run(async (trx) => {
      await this.assertOwned(trx, sessionId, userId);

      const base = [eq(productBulkItems.sessionId, sessionId)];
      if (status) base.push(eq(productBulkItems.status, status));
      // 'any'·'undecided' 둘 다 "충돌이 있는 행"이 출발점이다. undecided 는 그 위에
      // 메모리 필터를 한 번 더 건다.
      if (conflict) base.push(isNotNull(productBulkItems.conflict));
      const conditions = and(...base);

      const safePage = Math.max(page, 1);
      const safeLimit = Math.max(limit, 1);

      // 필터가 없으면 기존 경로 그대로 — SQL 페이징이다.
      if (!conflict) {
        const rows = await trx
          .select(bulkItemRowColumns)
          .from(productBulkItems)
          .where(conditions)
          .orderBy(productBulkItems.rowNumber)
          .limit(safeLimit)
          .offset((safePage - 1) * safeLimit);
        const [totalRow] = await trx.select({ value: count() }).from(productBulkItems).where(conditions);
        return {
          data: rows.map((row) => this.toItemDto(row)),
          total: Number(totalRow?.value ?? 0),
          page: safePage,
          limit: safeLimit,
        };
      }

      // 충돌 필터는 getImages 와 같은 방식이다 — 대상 행만 적재해 메모리에서 자른다.
      // `undecided` 가 jsonb 두 개의 키 차집합이라 SQL 술어로 못 내리고, 충돌은 정의상
      // (작업자가 바꾼 필드 ∩ 남이 바꾼 필드) 드물어 전량 적재가 감당된다.
      const all = await trx
        .select(bulkItemRowColumns)
        .from(productBulkItems)
        .where(conditions)
        .orderBy(productBulkItems.rowNumber);
      const filtered =
        conflict === 'undecided' ? all.filter((row) => hasUndecided(row.conflict, row.conflictDecision)) : all;
      const offset = (safePage - 1) * safeLimit;

      return {
        data: filtered.slice(offset, offset + safeLimit).map((row) => this.toItemDto(row)),
        total: filtered.length,
        page: safePage,
        limit: safeLimit,
      };
    }, tx);
  }
```

`isNotNull` 을 `drizzle-orm` import 에 추가하고, `hasUndecided`·`ConflictFilter` 를 `./bulk-session.conflicts` 에서 import 한다. 파일 안의 `toConflictMap`/`toConflictDecisionMap` 정의는 지우고 같은 곳에서 import 한다(`toItemDto` 가 계속 쓴다).

- [ ] **Step 6: 매니저가 공용 함수를 쓰게 한다**

`bulk-session.manager.ts:323-338` 의 손수 센 루프를 다음으로 바꾼다:

```typescript
      let undecidedCount = 0;
      // Task 10 리뷰 #7: "결정하지 않은 충돌이 N건" 만으로는 1,000행 세션에서 그 행을 찾을
      // 수 없다 — 이미 읽고 있는 rowNumber 를 메시지에 미리보기로 싣는다(추가 쿼리 없음).
      const undecidedRowNumbers: number[] = [];
      for (const item of conflictedItems) {
        // 목록 필터(getItems?conflict=undecided)와 **같은** 술어다. 복사본을 만들면
        // 화면에 안 보이는 미결정 때문에 승인이 409 나는 상태가 생긴다.
        const rowUndecided = countUndecided(item.conflict, item.conflictDecision);
        if (rowUndecided > 0) {
          undecidedCount += rowUndecided;
          undecidedRowNumbers.push(item.rowNumber);
        }
      }
```

`toConflictMap`/`toConflictDecisionMap` import 를 `countUndecided` 로 바꾼다(다른 곳에서 안 쓰면 제거).

- [ ] **Step 7: 서비스·컨트롤러를 배선한다**

`bulk-session.service.ts` 의 `getItems` 에 `conflict` 파라미터를 `status` 뒤에 끼워 리더로 넘긴다.

`bulk-session.controller.ts` 의 `getItems` 핸들러:

```typescript
  @Get(':id/items')
  @ApiOperation({ summary: '행 목록(변경분·충돌·라벨 포함). status·conflict 필터·페이지' })
  @ApiQuery({ name: 'status', required: false, enum: BULK_ITEM_STATUS_VALUES })
  @ApiQuery({
    name: 'conflict',
    required: false,
    enum: CONFLICT_FILTER_VALUES,
    description: 'any=충돌 있는 행, undecided=미결정 충돌이 남은 행. status 와 AND 로 걸린다',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: BulkSessionItemListDto })
  async getItems(
    @Param('id') id: string,
    @Query('status') status: string | undefined,
    @Query('conflict') conflict: string | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @User() user: { userId: string },
  ): Promise<BulkSessionItemListDto> {
    let validatedStatus: BulkItemStatus | undefined;
    if (status !== undefined) {
      if (!isBulkItemStatus(status)) {
        throw new BadRequestException(`status 는 ${BULK_ITEM_STATUS_VALUES.join(', ')} 중 하나여야 합니다`);
      }
      validatedStatus = status;
    }
    let validatedConflict: ConflictFilter | undefined;
    if (conflict !== undefined) {
      if (!isConflictFilter(conflict)) {
        throw new BadRequestException(`conflict 는 ${CONFLICT_FILTER_VALUES.join(', ')} 중 하나여야 합니다`);
      }
      validatedConflict = conflict;
    }
    return this.service.getItems(id, user.userId, validatedStatus, validatedConflict, parsePage(page), parseLimit(limit));
  }
```

- [ ] **Step 8: 기존 테스트가 그대로 초록인지 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts`
Expected: PASS. `getItems` 시그니처가 바뀌었으므로 **호출부 인자를 고쳐야 하는 기존 테스트가 있다** — 고친다. 동작 기대값은 바꾸지 않는다

Run: `npm run type-check:scoped`
Expected: 신규 에러 0건

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 행 목록에 충돌 필터

status 축에 충돌이 없어 1,000행 세션에서 충돌 행을 찾을 방법이 없었다.
승인 가드가 이미 하던 판정을 bulk-session.conflicts.ts 로 뽑아 목록
필터와 공유한다 — 복사본이 생기면 목록과 승인이 다른 답을 낸다."
```

---

### Task 4: admin-web — 미러 타입 · API 클라이언트 · 쿼리키

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/bulk-session.ts`
- Create: `apps/admin-web/src/lib/api/domains/products/bulk-session.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/form-export.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/index.ts`
- Modify: `apps/admin-web/src/lib/types/dto/form-export.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Modify: `apps/admin-web/src/lib/services/products/products-detail.types.ts:163` 부근

**Interfaces:**
- Produces: `bulkSessionClient` (아래 시그니처 전량) · `products.bulkSession` · `formExportClient.downloadBlank()` · `productQueryKeys.bulkSessions*` · `MasterVersionDetailDto.bulkSessionId`

**⚠️ 두 가지 함정**
1. **multipart 업로드에 axios `client` 를 쓰지 마라.** 인스턴스가 `'Content-Type': 'application/json'` 을 기본값으로 박아 두어 FormData 의 boundary 가 붙지 않는다. `fetchWithRefresh` 를 쓴다 — `upload.client.ts` 가 같은 이유로 같은 선택을 했고, `fetch-with-refresh.ts` 주석이 "FormData 는 재시도 안전"이라고 명시한다
2. **브라우저 경로는 `/api/proxy/api/...`** 다. axios `client` 의 baseURL 이 `/api` 이고 `ALMONDYOUNG_API_BASE_URL` 이 브라우저에서 `/proxy/api` 라, raw fetch 에는 둘을 합친 절대경로를 직접 써야 한다

- [ ] **Step 1: 미러 타입을 쓴다**

Create `apps/admin-web/src/lib/types/dto/bulk-session.ts`:

```typescript
// src/lib/types/dto/bulk-session.ts
// 상품 일괄 등록/수정 세션 API DTO 미러 타입.
// 백엔드: apps/core/src/modules/catalog/operations/bulk-session/dto/

export const BULK_SESSION_PHASES = [
  'uploaded',
  'validating',
  'review',
  'awaiting_images',
  'drafting',
  'drafted',
  'publishing',
  'published',
  'canceled',
  'failed',
] as const;
export type BulkSessionPhase = (typeof BULK_SESSION_PHASES)[number];

export type BulkItemStatus = 'pending' | 'invalid' | 'drafted' | 'excluded' | 'failed';
export type BulkPublishStatus = 'idle' | 'pending' | 'published' | 'failed';
export type BulkImageStatus = 'resolved' | 'awaiting_upload';
export type BulkImageUsage = 'main' | 'description';
export type ConflictFilter = 'any' | 'undecided';
export type ConflictDecision = 'overwrite' | 'skip';

export interface BulkSessionAccepted {
  sessionId: string;
  phase: 'uploaded';
  totalRows: number;
}

export interface BulkSessionSummary {
  id: string;
  name: string;
  fileName: string;
  phase: BulkSessionPhase;
  phaseError: string | null;
  totalRows: number;
  cancelRequestedAt: string | null;
  createdAt: string;
}

export interface BulkSessionList {
  data: BulkSessionSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface StatusCount<S extends string> {
  status: S;
  count: number;
}

export interface BulkSessionProgress {
  sessionId: string;
  phase: BulkSessionPhase;
  phaseError: string | null;
  /** 진행률 분모로 쓰지 마라 — 합성 아이템이 빠져 itemTotal 과 어긋난다. */
  totalRows: number;
  /** 진행률의 올바른 분모. */
  itemTotal: number;
  itemCounts: StatusCount<BulkItemStatus>[];
  imageCounts: StatusCount<BulkImageStatus>[];
  publishCounts: StatusCount<BulkPublishStatus>[];
  cancelRequestedAt: string | null;
}

export interface BulkSessionItemChange {
  field: string;
  /** 서버가 붙인 워크북 한국어 헤더 라벨. 화면이 다시 매핑하지 않는다. */
  label: string;
  before: string;
  after: string;
}

export interface BulkSessionItemConflict {
  field: string;
  label: string;
  base: string;
  mine: string;
  current: string;
  /** 미결정이면 null — 서버가 기본값을 정하지 않는다. */
  decision: ConflictDecision | null;
}

export interface BulkSessionItem {
  id: string;
  rowNumber: number;
  rowKey: string;
  kind: 'create' | 'update';
  status: BulkItemStatus;
  masterId: string | null;
  errorMessage: string | null;
  draftVersionId: string | null;
  /** status 와 축이 다르다 — drafted 이면서 failed 일 수 있다. */
  publishStatus: BulkPublishStatus;
  publishError: string | null;
  changes: BulkSessionItemChange[];
  conflicts: BulkSessionItemConflict[];
}

export interface BulkSessionItemList {
  data: BulkSessionItem[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkSessionImage {
  imageKey: string;
  usage: BulkImageUsage;
  /** 이 용도로 업로드할 때 써야 하는 file-service 컨텍스트. */
  contextId: string;
  sourceKind: 'file_id' | 'file_name';
  /** file_name 이면 작업자가 올려야 할 로컬 파일명. */
  sourceValue: string;
  status: BulkImageStatus;
  fileId: string | null;
  required: boolean;
}

export interface BulkSessionImageList {
  data: BulkSessionImage[];
  total: number;
  page: number;
  limit: number;
  /** 필터와 무관한 세션 전체 기준 — 전량 게이트의 분모. */
  requiredTotal: number;
  requiredResolved: number;
}

export interface ResolveImageEntry {
  imageKey: string;
  usage: BulkImageUsage;
  fileId: string;
}

export interface ResolveImageResult {
  imageKey: string;
  usage: BulkImageUsage;
  ok: boolean;
  /** ok=false 일 때 작업자에게 그대로 보여줄 문구. */
  error: string | null;
}

export interface ResolveImagesResponse {
  /** 인덱스로 짝지으면 안 된다 — (imageKey, usage) 로 짝짓는다. */
  results: ResolveImageResult[];
  progress: BulkSessionProgress;
}

export interface PurgeDraftsResult {
  purged: number;
  failed: number;
  /** remaining===0 또는 purged===0 이 될 때까지 다시 호출한다. */
  remaining: number;
}
```

- [ ] **Step 2: API 클라이언트를 쓴다**

Create `apps/admin-web/src/lib/api/domains/products/bulk-session.client.ts`:

```typescript
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  BulkImageStatus,
  BulkItemStatus,
  BulkSessionAccepted,
  BulkSessionImageList,
  BulkSessionItem,
  BulkSessionItemList,
  BulkSessionList,
  BulkSessionProgress,
  ConflictDecision,
  ConflictFilter,
  PurgeDraftsResult,
  ResolveImageEntry,
  ResolveImagesResponse,
} from '@/lib/types/dto/bulk-session';
import { client } from '../../client';
import { fetchWithRefresh } from '../../fetch-with-refresh';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/product-bulk-sessions`;

// raw fetch 용 절대경로. axios `client` 의 baseURL('/api')이 붙지 않으므로 직접 합친다.
const RAW_BASE = `/api${BASE}`;

export const bulkSessionClient = {
  /**
   * 워크북 업로드.
   *
   * axios `client` 를 쓰지 않는다 — 인스턴스가 'Content-Type: application/json' 을
   * 기본값으로 박아 두어 FormData 의 multipart boundary 가 붙지 않는다.
   * upload.client.ts 가 같은 이유로 같은 선택을 했다.
   */
  upload: async (file: File, name?: string): Promise<BulkSessionAccepted> => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);

    const res = await fetchWithRefresh(RAW_BASE, {
      method: 'POST',
      body: form, // Content-Type 은 브라우저가 boundary 와 함께 자동 설정 — 직접 지정 금지
      credentials: 'include',
    });
    if (!res.ok) {
      // 서버 메시지를 그대로 살려 올린다 — 화면이 400 을 "양식 만료"로 옮겨 읽는다.
      const body = await res.json().catch(() => null);
      const error = new Error(body?.message ?? '업로드에 실패했습니다.');
      Object.assign(error, { statusCode: res.status, response: { status: res.status, data: body } });
      throw error;
    }
    return (await res.json()) as BulkSessionAccepted;
  },

  list: async (page: number, limit: number): Promise<BulkSessionList> =>
    (await client.get(BASE, { params: { page, limit } })).data,

  getProgress: async (id: string): Promise<BulkSessionProgress> =>
    (await client.get(`${BASE}/${id}`)).data,

  getItems: async (
    id: string,
    query: { status?: BulkItemStatus; conflict?: ConflictFilter; page: number; limit: number }
  ): Promise<BulkSessionItemList> =>
    (await client.get(`${BASE}/${id}/items`, { params: query })).data,

  setConflictDecision: async (
    id: string,
    itemId: string,
    decisions: Record<string, ConflictDecision>
  ): Promise<BulkSessionItem> =>
    (await client.patch(`${BASE}/${id}/items/${itemId}/conflict-decision`, { decisions })).data,

  approve: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/approve`)).data,

  cancel: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/cancel`)).data,

  publish: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/publish`)).data,

  retryDraft: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/retry-draft`)).data,

  excludeItem: async (id: string, itemId: string): Promise<BulkSessionItem> =>
    (await client.post(`${BASE}/${id}/items/${itemId}/exclude`)).data,

  purgeDrafts: async (id: string): Promise<PurgeDraftsResult> =>
    (await client.post(`${BASE}/${id}/purge-drafts`)).data,

  getImages: async (
    id: string,
    query: { status?: BulkImageStatus; onlyRequired?: boolean; page: number; limit: number }
  ): Promise<BulkSessionImageList> =>
    (await client.get(`${BASE}/${id}/images`, { params: query })).data,

  resolveImages: async (id: string, resolutions: ResolveImageEntry[]): Promise<ResolveImagesResponse> =>
    (await client.post(`${BASE}/${id}/images/resolve`, { resolutions })).data,
};
```

- [ ] **Step 3: 빈 양식 다운로드를 기존 클라이언트에 더한다**

`form-export.client.ts` 의 `formExportClient` 객체에 추가:

```typescript
  /**
   * 빈 양식을 내려받는다. 잡도 폴링도 없는 동기 다운로드다.
   *
   * axios 를 쓰지 않는다 — 응답이 xlsx 바이너리라 envelope unwrap 인터셉터가
   * 다룰 대상이 아니고, blob 처리를 fetch 로 하는 편이 짧다.
   */
  downloadBlank: async (): Promise<Blob> => {
    const res = await fetchWithRefresh(`/api${BASE}/blank`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`빈 양식을 내려받지 못했습니다. (status: ${res.status})`);
    }
    return res.blob();
  },
```

`import { fetchWithRefresh } from '../../fetch-with-refresh';` 를 추가한다. `lib/types/dto/form-export.ts` 에는 새 타입이 필요 없다(Blob 이다).

- [ ] **Step 4: 배선과 쿼리키를 더한다**

`lib/api/domains/products/index.ts` 의 `products` 객체에 `bulkSession: bulkSessionClient` 를 더한다(기존 `formExport` 옆).

`lib/services/products/query-keys.ts` 의 `formExport` 아래에:

```typescript
  // 일괄 등록/수정 세션 관련
  bulkSessions: ['product-bulk-sessions'] as const,
  bulkSessionList: (page: number, limit: number) =>
    [...productQueryKeys.bulkSessions, 'list', page, limit] as const,
  bulkSession: (id: string) => [...productQueryKeys.bulkSessions, id] as const,
  bulkSessionItems: (id: string, query: Record<string, unknown>) =>
    [...productQueryKeys.bulkSession(id), 'items', query] as const,
  bulkSessionUndecided: (id: string) =>
    [...productQueryKeys.bulkSession(id), 'undecided'] as const,
  bulkSessionImages: (id: string, query: Record<string, unknown>) =>
    [...productQueryKeys.bulkSession(id), 'images', query] as const,
```

`lib/services/products/products-detail.types.ts` 의 `MasterVersionDetailDto` 에 `draftOwnerId` 아래로:

```typescript
  /** 일괄 세션이 이 draft 를 잠갔으면 그 세션 id. 있으면 발행·삭제가 409 다. */
  bulkSessionId?: string | null;
```

- [ ] **Step 5: 타입 게이트**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/lib/api/domains/products/bulk-session.client.ts apps/admin-web/src/lib/types/dto/bulk-session.ts`
Expected: 에러 0건

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/lib/
git commit -m "feat(admin-web): 일괄 세션 API 배선

미러 타입·클라이언트 13개 라우트·쿼리키. 업로드와 빈 양식만 axios 를
우회한다 — 전자는 FormData boundary 가 인스턴스 기본 Content-Type 에
막히고, 후자는 xlsx 바이너리라 envelope unwrap 대상이 아니다."
```

---

### Task 5: admin-web — 순수 헬퍼 `bulk-session-model.ts` (TDD)

**Files:**
- Create: `apps/admin-web/src/lib/services/products/bulk-session-model.ts`
- Create: `apps/admin-web/src/lib/services/products/bulk-session-model.spec.ts`

**Interfaces:**
- Consumes: `BulkSessionPhase` · `BulkSessionProgress` · `BulkSessionImage` · `ResolveImageEntry` · `ResolveImageResult` · `PurgeDraftsResult` (Task 4)
- Produces:
  - `getBulkSessionView(phase: BulkSessionPhase): BulkSessionView`
  - `isBulkSessionWorking(phase: BulkSessionPhase | undefined): boolean`
  - `bulkSessionRefetchInterval(progress: BulkSessionProgress | undefined): number | false`
  - `bulkSessionListRefetchInterval(sessions: { phase: BulkSessionPhase }[] | undefined): number | false`
  - `toCountMap<S extends string>(counts: StatusCount<S>[]): Record<string, number>`
  - `computeDraftingProgress(p: BulkSessionProgress): { done: number; total: number }`
  - `computePublishProgress(p: BulkSessionProgress): { done: number; total: number }`
  - `normalizeFileName(name: string): string`
  - `matchFilesToImageRows<F extends NamedFile>(files: F[], rows: BulkSessionImage[]): MatchResult<F>`
  - `chunkResolutions(entries: ResolveImageEntry[], size?: number): ResolveImageEntry[][]`
  - `pairResolveResults(sent: ResolveImageEntry[], results: ResolveImageResult[]): PairedResolveResult[]`
  - `shouldContinuePurge(r: PurgeDraftsResult): boolean`
  - `canApprove(phase: BulkSessionPhase, undecidedCount: number): boolean`

**이것이 이 브랜치의 유일한 자동 검증 대상이다.** admin-web 에는 렌더러가 없고 `.tsx` 는 jest transform 밖이다. 컴포넌트 안에 남은 조건문은 테스트되지 않는 코드라는 뜻이므로, 판정은 전부 여기로 온다.

- [ ] **Step 1: 실패 테스트 전량을 쓴다**

Create `bulk-session-model.spec.ts`:

```typescript
import type {
  BulkSessionImage,
  BulkSessionPhase,
  BulkSessionProgress,
  ResolveImageEntry,
  ResolveImageResult,
} from '@/lib/types/dto/bulk-session';
import {
  bulkSessionListRefetchInterval,
  bulkSessionRefetchInterval,
  canApprove,
  chunkResolutions,
  computeDraftingProgress,
  computePublishProgress,
  getBulkSessionView,
  isBulkSessionWorking,
  matchFilesToImageRows,
  normalizeFileName,
  pairResolveResults,
  shouldContinuePurge,
} from './bulk-session-model';

function progress(overrides: Partial<BulkSessionProgress> = {}): BulkSessionProgress {
  return {
    sessionId: 's1',
    phase: 'review',
    phaseError: null,
    totalRows: 0,
    itemTotal: 0,
    itemCounts: [],
    imageCounts: [],
    publishCounts: [],
    cancelRequestedAt: null,
    ...overrides,
  };
}

function imageRow(overrides: Partial<BulkSessionImage> = {}): BulkSessionImage {
  return {
    imageKey: 'IMG-1',
    usage: 'main',
    contextId: 'product-image',
    sourceKind: 'file_name',
    sourceValue: 'front.jpg',
    status: 'awaiting_upload',
    fileId: null,
    required: true,
    ...overrides,
  };
}

describe('getBulkSessionView', () => {
  // phase 가 하나라도 빠지면 그 세션은 빈 화면이 된다. 전량을 못 박는다.
  const cases: Array<[BulkSessionPhase, string]> = [
    ['uploaded', 'working'],
    ['validating', 'working'],
    ['review', 'review'],
    ['awaiting_images', 'images'],
    ['drafting', 'working'],
    ['drafted', 'drafted'],
    ['publishing', 'working'],
    ['published', 'published'],
    ['canceled', 'canceled'],
    ['failed', 'failed'],
  ];

  it.each(cases)('%s → %s', (phase, view) => {
    expect(getBulkSessionView(phase)).toBe(view);
  });
});

describe('isBulkSessionWorking', () => {
  it.each(['uploaded', 'validating', 'drafting', 'publishing'] as BulkSessionPhase[])(
    '%s 는 워커 차례다',
    (phase) => expect(isBulkSessionWorking(phase)).toBe(true)
  );
  it.each(['review', 'awaiting_images', 'drafted', 'published', 'canceled', 'failed'] as BulkSessionPhase[])(
    '%s 는 워커 차례가 아니다',
    (phase) => expect(isBulkSessionWorking(phase)).toBe(false)
  );
  it('undefined 는 진행 중으로 본다 — 첫 응답 전에 화면이 굳지 않게', () => {
    expect(isBulkSessionWorking(undefined)).toBe(true);
  });
});

describe('bulkSessionRefetchInterval', () => {
  it('데이터가 없으면 2초 — 첫 요청이 실패해도 화면이 얼지 않는다', () => {
    expect(bulkSessionRefetchInterval(undefined)).toBe(2000);
  });
  it('워커 차례면 2초', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'validating' }))).toBe(2000);
  });
  it('사람 차례면 멈춘다', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'review' }))).toBe(false);
  });
  it('종단이면 멈춘다', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'published' }))).toBe(false);
  });
});

describe('bulkSessionListRefetchInterval', () => {
  it('워커 차례인 세션이 하나라도 있으면 2초', () => {
    expect(bulkSessionListRefetchInterval([{ phase: 'review' }, { phase: 'drafting' }])).toBe(2000);
  });
  it('전부 사람 차례면 멈춘다', () => {
    expect(bulkSessionListRefetchInterval([{ phase: 'review' }, { phase: 'published' }])).toBe(false);
  });
  it('빈 목록은 멈춘다', () => {
    expect(bulkSessionListRefetchInterval([])).toBe(false);
  });
  it('데이터가 없으면 2초', () => {
    expect(bulkSessionListRefetchInterval(undefined)).toBe(2000);
  });
});

describe('computeDraftingProgress', () => {
  it('분모는 itemTotal 이지 totalRows 가 아니다', () => {
    const p = progress({
      totalRows: 3,
      itemTotal: 5,
      itemCounts: [
        { status: 'pending', count: 2 },
        { status: 'drafted', count: 3 },
      ],
    });
    expect(computeDraftingProgress(p)).toEqual({ done: 3, total: 5 });
  });

  it('pending 이 아닌 것은 전부 처리된 것으로 센다', () => {
    const p = progress({
      itemTotal: 4,
      itemCounts: [
        { status: 'pending', count: 1 },
        { status: 'drafted', count: 1 },
        { status: 'failed', count: 1 },
        { status: 'invalid', count: 1 },
      ],
    });
    expect(computeDraftingProgress(p)).toEqual({ done: 3, total: 4 });
  });

  it('아이템이 없으면 0/0 이다 — 0 나누기를 만들지 않는다', () => {
    expect(computeDraftingProgress(progress())).toEqual({ done: 0, total: 0 });
  });
});

describe('computePublishProgress', () => {
  it('idle 은 분모에서 뺀다 — 발행 대상이 아닌 행이다', () => {
    const p = progress({
      publishCounts: [
        { status: 'idle', count: 10 },
        { status: 'pending', count: 2 },
        { status: 'published', count: 5 },
        { status: 'failed', count: 1 },
      ],
    });
    expect(computePublishProgress(p)).toEqual({ done: 6, total: 8 });
  });

  it('아무도 발행 대상이 아니면 0/0 이다', () => {
    expect(computePublishProgress(progress({ publishCounts: [{ status: 'idle', count: 3 }] }))).toEqual({
      done: 0,
      total: 0,
    });
  });
});

describe('normalizeFileName', () => {
  it('대소문자와 앞뒤 공백을 무시한다', () => {
    expect(normalizeFileName('  Front.JPG ')).toBe('front.jpg');
  });
  it('경로가 붙어 있으면 파일명만 남긴다 — 폴더 드롭이 상대경로를 준다', () => {
    expect(normalizeFileName('images/2026/Front.JPG')).toBe('front.jpg');
  });
  it('역슬래시 경로도 자른다', () => {
    expect(normalizeFileName('images\\Front.JPG')).toBe('front.jpg');
  });
});

describe('matchFilesToImageRows', () => {
  it('파일명이 맞는 행에 붙인다', () => {
    const rows = [imageRow({ imageKey: 'IMG-1', sourceValue: 'front.jpg' })];
    const result = matchFilesToImageRows([{ name: 'FRONT.JPG' }], rows);
    expect(result.tasks).toEqual([
      { imageKey: 'IMG-1', usage: 'main', contextId: 'product-image', file: { name: 'FRONT.JPG' } },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('한 파일이 두 용도에 걸리면 작업이 둘 생긴다 — contextId 가 달라 두 번 올린다', () => {
    const rows = [
      imageRow({ imageKey: 'IMG-1', usage: 'main', contextId: 'product-image', sourceValue: 'a.jpg' }),
      imageRow({
        imageKey: 'IMG-1',
        usage: 'description',
        contextId: 'product-description-image',
        sourceValue: 'a.jpg',
      }),
    ];
    const result = matchFilesToImageRows([{ name: 'a.jpg' }], rows);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((t) => t.contextId)).toEqual(['product-image', 'product-description-image']);
  });

  it('요구 목록에 없는 파일은 unmatchedFiles 로 간다', () => {
    const result = matchFilesToImageRows([{ name: 'ghost.png' }], [imageRow()]);
    expect(result.tasks).toEqual([]);
    expect(result.unmatchedFiles).toEqual(['ghost.png']);
  });

  it('아직 파일이 안 온 요구는 missing 에 남는다', () => {
    const rows = [imageRow({ imageKey: 'IMG-1', sourceValue: 'a.jpg' }), imageRow({ imageKey: 'IMG-2', sourceValue: 'b.jpg' })];
    const result = matchFilesToImageRows([{ name: 'a.jpg' }], rows);
    expect(result.missing.map((r) => r.imageKey)).toEqual(['IMG-2']);
  });

  it('같은 이름의 파일이 둘 이상이면 duplicateNames 로 알린다', () => {
    const result = matchFilesToImageRows(
      [{ name: 'a/front.jpg' }, { name: 'b/FRONT.jpg' }],
      [imageRow({ sourceValue: 'front.jpg' })]
    );
    expect(result.duplicateNames).toEqual(['front.jpg']);
    // 뒤엣것이 이긴다 — 워크북이 파일명만 받으므로 구조적으로 구분할 수 없다.
    expect(result.tasks).toHaveLength(1);
  });

  it('이미 resolved 인 행은 요구가 아니다', () => {
    const rows = [imageRow({ status: 'resolved', fileId: 'f1' })];
    expect(matchFilesToImageRows([{ name: 'front.jpg' }], rows).tasks).toEqual([]);
  });

  it('required=false 인 행은 요구가 아니다 — invalid 행만 참조하던 이미지다', () => {
    const rows = [imageRow({ required: false })];
    expect(matchFilesToImageRows([{ name: 'front.jpg' }], rows).tasks).toEqual([]);
  });
});

describe('chunkResolutions', () => {
  const entry = (i: number): ResolveImageEntry => ({ imageKey: `IMG-${i}`, usage: 'main', fileId: `f${i}` });

  it('기본 50개씩 자른다 — 서버 상한이다', () => {
    const chunks = chunkResolutions(Array.from({ length: 120 }, (_, i) => entry(i)));
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it('상한 이하면 한 덩어리다', () => {
    expect(chunkResolutions([entry(1)])).toEqual([[entry(1)]]);
  });

  it('빈 입력은 빈 배열이다 — 빈 요청을 보내면 400 이다', () => {
    expect(chunkResolutions([])).toEqual([]);
  });
});

describe('pairResolveResults', () => {
  const sent: ResolveImageEntry[] = [
    { imageKey: 'IMG-1', usage: 'main', fileId: 'f1' },
    { imageKey: 'IMG-1', usage: 'description', fileId: 'f2' },
  ];

  it('인덱스가 아니라 (imageKey, usage) 로 짝짓는다', () => {
    // 서버가 순서를 뒤집어 돌려줘도 올바르게 붙어야 한다.
    const results: ResolveImageResult[] = [
      { imageKey: 'IMG-1', usage: 'description', ok: false, error: '파일을 찾을 수 없습니다' },
      { imageKey: 'IMG-1', usage: 'main', ok: true, error: null },
    ];
    expect(pairResolveResults(sent, results)).toEqual([
      { imageKey: 'IMG-1', usage: 'main', ok: true, error: null },
      { imageKey: 'IMG-1', usage: 'description', ok: false, error: '파일을 찾을 수 없습니다' },
    ]);
  });

  it('응답이 요청보다 짧으면 빠진 항목을 실패로 본다', () => {
    const results: ResolveImageResult[] = [{ imageKey: 'IMG-1', usage: 'main', ok: true, error: null }];
    const paired = pairResolveResults(sent, results);
    expect(paired[1]).toEqual({
      imageKey: 'IMG-1',
      usage: 'description',
      ok: false,
      error: '서버가 이 항목의 결과를 돌려주지 않았습니다.',
    });
  });
});

describe('shouldContinuePurge', () => {
  it('남았고 이번에 진전이 있었으면 계속한다', () => {
    expect(shouldContinuePurge({ purged: 100, failed: 0, remaining: 40 })).toBe(true);
  });
  it('다 지웠으면 멈춘다', () => {
    expect(shouldContinuePurge({ purged: 40, failed: 0, remaining: 0 })).toBe(false);
  });
  it('남았는데 진전이 없으면 멈춘다 — 영구 실패 행 앞에서 무한 루프를 막는다', () => {
    expect(shouldContinuePurge({ purged: 0, failed: 3, remaining: 3 })).toBe(false);
  });
});

describe('canApprove', () => {
  it('review 이고 미결정이 0 이면 승인할 수 있다', () => {
    expect(canApprove('review', 0)).toBe(true);
  });
  it('미결정이 남았으면 못 한다', () => {
    expect(canApprove('review', 1)).toBe(false);
  });
  it('review 가 아니면 못 한다', () => {
    expect(canApprove('drafted', 0)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/lib/services/products/bulk-session-model.spec.ts`
Expected: FAIL — `Cannot find module './bulk-session-model'`

- [ ] **Step 3: 구현한다**

Create `apps/admin-web/src/lib/services/products/bulk-session-model.ts`:

```typescript
// src/lib/services/products/bulk-session-model.ts
// 일괄 세션 화면의 판정 로직 전량.
//
// admin-web 에는 렌더러가 없고(@testing-library 미설치) jest transform 이 `.ts` 만
// 다루므로, 컴포넌트 안에 남은 조건문은 테스트되지 않는 코드다. 판정은 전부 여기로 온다.

import type {
  BulkSessionImage,
  BulkSessionPhase,
  BulkSessionProgress,
  PurgeDraftsResult,
  ResolveImageEntry,
  ResolveImageResult,
  StatusCount,
} from '@/lib/types/dto/bulk-session';

export type BulkSessionView =
  | 'working'
  | 'review'
  | 'images'
  | 'drafted'
  | 'published'
  | 'canceled'
  | 'failed';

/** 서버가 한 요청에 받는 해석 통보 상한. bulk-image.dto.ts 의 @ArrayMaxSize(50) 과 같아야 한다. */
export const RESOLVE_CHUNK_SIZE = 50;

/** 폴링 간격. form-export.ts 의 선례와 같은 값이다. */
const POLL_MS = 2000;

/** 워커가 claim 하는 phase — 이 동안은 사람이 할 일이 없고 화면은 진행률만 보여준다. */
const WORKING_PHASES: readonly BulkSessionPhase[] = ['uploaded', 'validating', 'drafting', 'publishing'];

const VIEW_BY_PHASE: Record<BulkSessionPhase, BulkSessionView> = {
  uploaded: 'working',
  validating: 'working',
  review: 'review',
  awaiting_images: 'images',
  drafting: 'working',
  drafted: 'drafted',
  publishing: 'working',
  published: 'published',
  canceled: 'canceled',
  failed: 'failed',
};

export function getBulkSessionView(phase: BulkSessionPhase): BulkSessionView {
  return VIEW_BY_PHASE[phase];
}

/**
 * 알 수 없는 상태(undefined)는 **진행 중으로 본다.** 접수 직후 첫 응답 전이나 일시적
 * 5xx 에서 멈춤으로 읽으면 화면이 마운트 내내 굳는다(form-export.ts 가 같은 함정을 밟았다).
 */
export function isBulkSessionWorking(phase: BulkSessionPhase | undefined): boolean {
  if (phase === undefined) return true;
  return WORKING_PHASES.includes(phase);
}

export function bulkSessionRefetchInterval(progress: BulkSessionProgress | undefined): number | false {
  return isBulkSessionWorking(progress?.phase) ? POLL_MS : false;
}

export function bulkSessionListRefetchInterval(
  sessions: { phase: BulkSessionPhase }[] | undefined
): number | false {
  if (sessions === undefined) return POLL_MS;
  return sessions.some((s) => isBulkSessionWorking(s.phase)) ? POLL_MS : false;
}

export function toCountMap<S extends string>(counts: StatusCount<S>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { status, count } of counts) out[status] = count;
  return out;
}

/**
 * draft 생성 진행률.
 *
 * **분모는 `itemTotal` 이다.** `totalRows` 는 "상품" 시트 데이터 행 수라 합성 아이템이
 * 빠져 아이템 수와 어긋난다(서버 DTO 가 명시 경고).
 */
export function computeDraftingProgress(p: BulkSessionProgress): { done: number; total: number } {
  const counts = toCountMap(p.itemCounts);
  const pending = counts.pending ?? 0;
  const total = p.itemTotal;
  return { done: Math.max(0, total - pending), total };
}

/**
 * 발행 진행률.
 *
 * `idle` 은 분모에서 뺀다 — 발행 대상으로 큐에 들어간 적 없는 행이라 분모에 넣으면
 * 진행률이 영원히 100% 에 도달하지 않는다.
 */
export function computePublishProgress(p: BulkSessionProgress): { done: number; total: number } {
  const counts = toCountMap(p.publishCounts);
  const pending = counts.pending ?? 0;
  const published = counts.published ?? 0;
  const failed = counts.failed ?? 0;
  return { done: published + failed, total: pending + published + failed };
}

/**
 * 파일명 정규화. 폴더 드롭은 `webkitRelativePath` 가 섞인 이름을 줄 수 있어 경로를 자른다.
 * 매칭 규약은 스펙 §3.9 — 대소문자 무시, 앞뒤 공백 제거.
 */
export function normalizeFileName(name: string): string {
  const basename = name.split(/[\\/]/).pop() ?? name;
  return basename.trim().toLowerCase();
}

export interface NamedFile {
  name: string;
}

export interface UploadTask<F extends NamedFile> {
  imageKey: string;
  usage: BulkSessionImage['usage'];
  contextId: string;
  file: F;
}

export interface MatchResult<F extends NamedFile> {
  tasks: UploadTask<F>[];
  /** 요구 목록에 없어 무시한 파일명. */
  unmatchedFiles: string[];
  /** 아직 파일이 오지 않은 요구. */
  missing: BulkSessionImage[];
  /** 정규화 후 이름이 겹치는 파일 — 뒤엣것이 이긴다. */
  duplicateNames: string[];
}

/**
 * 떨군 파일을 요구 행에 붙인다.
 *
 * **작업 단위는 파일이 아니라 행이다.** 같은 파일명을 `main` 과 `description` 이 각각
 * 요구하면 `contextId` 가 달라 같은 파일을 두 번 올린다(스펙 §3.9).
 */
export function matchFilesToImageRows<F extends NamedFile>(
  files: F[],
  rows: BulkSessionImage[]
): MatchResult<F> {
  const byName = new Map<string, F>();
  const duplicateNames: string[] = [];
  for (const file of files) {
    const key = normalizeFileName(file.name);
    if (byName.has(key) && !duplicateNames.includes(key)) duplicateNames.push(key);
    byName.set(key, file); // 뒤엣것이 이긴다 — 워크북이 파일명만 받아 구분할 방법이 없다
  }

  const wanted = rows.filter((row) => row.required && row.status === 'awaiting_upload');
  const tasks: UploadTask<F>[] = [];
  const missing: BulkSessionImage[] = [];
  const used = new Set<string>();

  for (const row of wanted) {
    const key = normalizeFileName(row.sourceValue);
    const file = byName.get(key);
    if (!file) {
      missing.push(row);
      continue;
    }
    used.add(key);
    tasks.push({ imageKey: row.imageKey, usage: row.usage, contextId: row.contextId, file });
  }

  const unmatchedFiles = files.filter((f) => !used.has(normalizeFileName(f.name))).map((f) => f.name);

  return { tasks, unmatchedFiles, missing, duplicateNames };
}

export function chunkResolutions(
  entries: ResolveImageEntry[],
  size: number = RESOLVE_CHUNK_SIZE
): ResolveImageEntry[][] {
  const out: ResolveImageEntry[][] = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

export type PairedResolveResult = ResolveImageResult;

/**
 * 보낸 항목과 결과를 짝짓는다.
 *
 * **인덱스로 짝지으면 안 된다** — 서버 DTO 가 "같은 (imageKey, usage) 중복은 마지막 것만
 * 남아 길이가 줄 수 있다"고 명시 경고한다.
 */
export function pairResolveResults(
  sent: ResolveImageEntry[],
  results: ResolveImageResult[]
): PairedResolveResult[] {
  const key = (e: { imageKey: string; usage: string }): string => `${e.imageKey} ${e.usage}`;
  const byKey = new Map(results.map((r) => [key(r), r]));
  return sent.map(
    (entry) =>
      byKey.get(key(entry)) ?? {
        imageKey: entry.imageKey,
        usage: entry.usage,
        ok: false,
        error: '서버가 이 항목의 결과를 돌려주지 않았습니다.',
      }
  );
}

/**
 * `purge-drafts` 를 한 번 더 부를지.
 *
 * `remaining === 0` 만으로는 종료가 보장되지 않는다 — 영구 실패 행이 남으면 remaining 이
 * 줄지 않아 영원히 돈다. `purged === 0`(진전 없음)도 종료 조건이다.
 */
export function shouldContinuePurge(result: PurgeDraftsResult): boolean {
  return result.remaining > 0 && result.purged > 0;
}

export function canApprove(phase: BulkSessionPhase, undecidedCount: number): boolean {
  return phase === 'review' && undecidedCount === 0;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/lib/services/products/bulk-session-model.spec.ts`
Expected: PASS — 전 케이스

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/services/products/bulk-session-model.ts apps/admin-web/src/lib/services/products/bulk-session-model.spec.ts
git commit -m "feat(admin-web): 일괄 세션 화면 판정 로직 + 테스트

렌더러가 없어 컴포넌트를 테스트할 수 없으므로 판정을 전부 순수 함수로
뽑는다. phase→패널 매핑 전량, 폴링 인터벌(undefined→2000 포함), 진행률
분모(itemTotal), 파일명 매칭, 50건 청킹, (imageKey,usage) 짝짓기,
purge 종료 조건 둘, 승인 게이트."
```

---

### Task 6: admin-web — 쿼리·뮤테이션 훅

**Files:**
- Create: `apps/admin-web/src/lib/services/products/bulk-session.ts`
- Modify: `apps/admin-web/src/lib/services/products/index.ts` (있으면 재export)

**Interfaces:**
- Consumes: `bulkSessionClient` (Task 4) · `bulkSession*` 쿼리키 (Task 4) · `bulkSessionRefetchInterval`·`bulkSessionListRefetchInterval` (Task 5)
- Produces:
  - `useBulkSessionList(page, limit)`
  - `useBulkSessionProgress(id)`
  - `useBulkSessionItems(id, query)`
  - `useBulkSessionUndecidedCount(id, enabled)`
  - `useBulkSessionImages(id, query)`
  - `useUploadBulkSession()` · `useSetConflictDecision(id)` · `useApproveBulkSession(id)` · `useCancelBulkSession(id)` · `usePublishBulkSession(id)` · `useRetryDraft(id)` · `useExcludeItem(id)` · `usePurgeDrafts(id)` · `useResolveImages(id)`

- [ ] **Step 1: 훅 파일을 쓴다**

Create `apps/admin-web/src/lib/services/products/bulk-session.ts`:

```typescript
// src/lib/services/products/bulk-session.ts
// 일괄 등록/수정 세션 쿼리·뮤테이션 훅. 판정은 전부 bulk-session-model.ts 가 한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import type {
  BulkImageStatus,
  BulkItemStatus,
  BulkSessionProgress,
  ConflictDecision,
  ConflictFilter,
} from '@/lib/types/dto/bulk-session';
import { bulkSessionListRefetchInterval, bulkSessionRefetchInterval } from './bulk-session-model';
import { productQueryKeys } from './query-keys';

export function useBulkSessionList(page: number, limit: number) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionList(page, limit),
    queryFn: () => products.bulkSession.list(page, limit),
    refetchInterval: (query) => bulkSessionListRefetchInterval(query.state.data?.data),
  });
}

export function useBulkSessionProgress(id: string) {
  return useQuery({
    queryKey: productQueryKeys.bulkSession(id),
    queryFn: () => products.bulkSession.getProgress(id),
    refetchInterval: (query) => bulkSessionRefetchInterval(query.state.data),
  });
}

export function useBulkSessionItems(
  id: string,
  query: { status?: BulkItemStatus; conflict?: ConflictFilter; page: number; limit: number }
) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionItems(id, query),
    queryFn: () => products.bulkSession.getItems(id, query),
  });
}

/**
 * 미결정 충돌 **개수**만 필요할 때. 진행률 DTO 를 늘리지 않기로 해서(스펙 §3.1③)
 * limit=1 로 부르고 total 만 읽는다. 폴링 대상이 아니다.
 */
export function useBulkSessionUndecidedCount(id: string, enabled: boolean) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionUndecided(id),
    queryFn: () => products.bulkSession.getItems(id, { conflict: 'undecided', page: 1, limit: 1 }),
    select: (data) => data.total,
    enabled,
  });
}

export function useBulkSessionImages(
  id: string,
  query: { status?: BulkImageStatus; onlyRequired?: boolean; page: number; limit: number }
) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionImages(id, query),
    queryFn: () => products.bulkSession.getImages(id, query),
  });
}

export function useUploadBulkSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) => products.bulkSession.upload(file, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productQueryKeys.bulkSessions });
    },
  });
}

/**
 * 진행률 응답인지 구조로 확인한다. `as` 캐스팅 대신 가드를 쓰는 이유는 이 훅이 진행률을
 * 돌려주는 라우트(approve·cancel·publish·retry)와 아이템을 돌려주는 라우트(exclude·
 * conflict-decision)를 **같이** 감싸기 때문이다 — 캐스팅하면 아이템 응답이 진행률 캐시에
 * 들어가 화면이 조용히 깨진다.
 */
function isProgress(value: unknown): value is BulkSessionProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'phase' in value &&
    'itemTotal' in value &&
    'itemCounts' in value
  );
}

/** 세션 상태를 바꾸는 뮤테이션들의 공통 후처리 — 진행률과 행 목록을 함께 무효화한다. */
function useSessionMutation<TArgs, TResult>(
  id: string,
  mutationFn: (args: TArgs) => Promise<TResult>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      // 진행률을 돌려주는 라우트는 재조회 없이 캐시를 갱신한다.
      if (isProgress(result)) {
        qc.setQueryData(productQueryKeys.bulkSession(id), result);
      } else {
        void qc.invalidateQueries({ queryKey: productQueryKeys.bulkSession(id) });
      }
      void qc.invalidateQueries({ queryKey: [...productQueryKeys.bulkSession(id), 'items'] });
      void qc.invalidateQueries({ queryKey: productQueryKeys.bulkSessionUndecided(id) });
    },
  });
}

export function useSetConflictDecision(id: string) {
  return useSessionMutation(
    id,
    ({ itemId, decisions }: { itemId: string; decisions: Record<string, ConflictDecision> }) =>
      products.bulkSession.setConflictDecision(id, itemId, decisions)
  );
}

export function useApproveBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.approve(id));
}

export function useCancelBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.cancel(id));
}

export function usePublishBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.publish(id));
}

export function useRetryDraft(id: string) {
  return useSessionMutation(id, () => products.bulkSession.retryDraft(id));
}

export function useExcludeItem(id: string) {
  return useSessionMutation(id, (itemId: string) => products.bulkSession.excludeItem(id, itemId));
}

export function usePurgeDrafts(id: string) {
  return useSessionMutation(id, () => products.bulkSession.purgeDrafts(id));
}

export function useResolveImages(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resolutions: Parameters<typeof products.bulkSession.resolveImages>[1]) =>
      products.bulkSession.resolveImages(id, resolutions),
    onSuccess: (response) => {
      // 전량 게이트가 열렸으면 응답의 progress 가 이미 drafting 이다 — 폴링을 기다리지 않는다.
      qc.setQueryData(productQueryKeys.bulkSession(id), response.progress);
      void qc.invalidateQueries({ queryKey: [...productQueryKeys.bulkSession(id), 'images'] });
    },
  });
}
```

- [ ] **Step 2: 타입 게이트와 lint**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/lib/services/products/bulk-session.ts`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/lib/services/products/bulk-session.ts
git commit -m "feat(admin-web): 일괄 세션 쿼리·뮤테이션 훅

진행률을 돌려주는 라우트는 재조회 없이 캐시를 갱신한다. 이미지 해석은
응답의 progress 로 전량 게이트 통과를 즉시 반영해 폴링을 기다리지 않는다."
```

---

### Task 7: admin-web — 목록 화면 + 업로드 모달 + 빈 양식

**Files:**
- Create: `apps/admin-web/src/app/(admin)/mall/bulk-sessions/page.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-list/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-list/upload-modal.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/session-labels.ts`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/session-labels.spec.ts`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/upload-error.ts`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/upload-error.spec.ts`

**Interfaces:**
- Consumes: `useBulkSessionList`·`useUploadBulkSession` (Task 6) · `formExportClient.downloadBlank` (Task 4)
- Produces:
  - `PHASE_LABELS: Record<BulkSessionPhase, string>` · `phaseLabel(phase)` · `phaseBadgeVariant(phase)`
  - `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`
  - `parseUploadError(error: unknown): string`
  - 라우트 `/mall/bulk-sessions`

- [ ] **Step 1: 라벨·오류 헬퍼의 실패 테스트를 쓴다**

Create `session-labels.spec.ts`:

```typescript
import { BULK_SESSION_PHASES } from '@/lib/types/dto/bulk-session';
import { PHASE_LABELS, phaseLabel } from './session-labels';

describe('PHASE_LABELS', () => {
  it('phase 전량에 한국어 라벨이 있다 — 빠지면 배지가 빈 칸이 된다', () => {
    for (const phase of BULK_SESSION_PHASES) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
    }
  });

  it('사람이 읽는 문구다', () => {
    expect(phaseLabel('awaiting_images')).toBe('이미지 대기');
    expect(phaseLabel('review')).toBe('검토 대기');
    expect(phaseLabel('published')).toBe('발행 완료');
  });
});
```

Create `upload-error.spec.ts`:

```typescript
import { parseUploadError } from './upload-error';

function httpError(status: number, message?: string): unknown {
  return { statusCode: status, response: { status, data: message ? { message } : null } };
}

describe('parseUploadError', () => {
  it('400 은 양식 만료 안내로 옮긴다 — 원문 예외로는 뭘 해야 할지 알 수 없다', () => {
    expect(parseUploadError(httpError(400, 'export not found'))).toBe(
      '양식이 만료되었습니다. 상품 목록에서 양식을 다시 받아 작성해 주세요.'
    );
  });

  it('403 은 권한 안내다', () => {
    expect(parseUploadError(httpError(403))).toBe('이 기능은 admin·master 권한이 필요합니다.');
  });

  it('413 은 파일 크기 안내다', () => {
    expect(parseUploadError(httpError(413))).toBe('파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.');
  });

  it('그 밖은 서버 메시지를 그대로 쓴다', () => {
    expect(parseUploadError(httpError(500, '서버 오류'))).toBe('서버 오류');
  });

  it('메시지가 없으면 기본 문구다', () => {
    expect(parseUploadError(httpError(500))).toBe('업로드에 실패했습니다.');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/features/mall/bulk-sessions/lib/`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 헬퍼를 구현한다**

Create `session-labels.ts`:

```typescript
import type { BulkSessionPhase } from '@/lib/types/dto/bulk-session';

export const PHASE_LABELS: Record<BulkSessionPhase, string> = {
  uploaded: '접수됨',
  validating: '검증 중',
  review: '검토 대기',
  awaiting_images: '이미지 대기',
  drafting: '임시 버전 생성 중',
  drafted: '검토 가능',
  publishing: '발행 중',
  published: '발행 완료',
  canceled: '취소됨',
  failed: '실패',
};

export function phaseLabel(phase: BulkSessionPhase): string {
  return PHASE_LABELS[phase];
}

/** shadcn Badge variant. 사람의 손이 필요한 단계를 눈에 띄게 한다. */
export function phaseBadgeVariant(phase: BulkSessionPhase): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (phase === 'failed') return 'destructive';
  if (phase === 'review' || phase === 'awaiting_images' || phase === 'drafted') return 'default';
  if (phase === 'published') return 'secondary';
  return 'outline';
}
```

Create `upload-error.ts`:

```typescript
import { parseServerError } from '@/lib/api/server-error';

/** 서버 상한과 같은 값. bulk-upload.parser.ts 의 MAX_UPLOAD_BYTES 와 어긋나면 안 된다. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * 업로드 실패를 작업자가 행동할 수 있는 문구로 옮긴다.
 *
 * 400 이 핵심이다 — "해석할 수 없는 양식"은 **만료된 exportId 를 든 워크북**이라는
 * 뜻이고, 스펙 §3.1 이 그 거부를 "선택이 아니라 필수 조건"으로 못 박았다. 원문 예외를
 * 그대로 띄우면 작업자는 자기가 뭘 해야 하는지 알 수 없다.
 */
export function parseUploadError(error: unknown): string {
  const parsed = parseServerError(error, '업로드에 실패했습니다.');
  if (parsed.status === 400) {
    return '양식이 만료되었습니다. 상품 목록에서 양식을 다시 받아 작성해 주세요.';
  }
  if (parsed.status === 403) return '이 기능은 admin·master 권한이 필요합니다.';
  if (parsed.status === 413) return '파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.';
  return parsed.message;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/features/mall/bulk-sessions/lib/`
Expected: PASS

- [ ] **Step 5: 목록 화면과 업로드 모달을 만든다**

Create `app/(admin)/mall/bulk-sessions/page.tsx`:

```tsx
import RouteGuard from '@/components/layout/route-guard';
import BulkSessionListTemplate from '@/features/mall/bulk-sessions/session-list';

export default function BulkSessionsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BulkSessionListTemplate />
      </div>
    </RouteGuard>
  );
}
```

`session-list/index.tsx` 는 다음을 한다 (구현 시 `my-drafts/components/table/index.tsx` 의 표 패턴과 `Container`/`Header` 사용을 그대로 따른다):

- `useBulkSessionList(page, 20)` 로 목록. 열은 **이름 · 파일명 · 상태(`phaseLabel` 배지) · 행 수 · 생성일**
- 행 클릭 → `router.push(`/mall/bulk-sessions/${id}`)`
- 헤더 우측 버튼 둘: `[양식 업로드]`(모달 열기) · `[빈 양식 다운로드]`
- 빈 양식 버튼 핸들러:

```tsx
  async function handleBlankForm() {
    setDownloading(true);
    try {
      const blob = await products.formExport.downloadBlank();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '상품일괄등록_빈양식.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('빈 양식을 내려받지 못했습니다.');
    } finally {
      setDownloading(false);
    }
  }
```

- 목록이 비어 있으면 안내: 「아직 세션이 없습니다. 상품 목록에서 양식을 받아 작성한 뒤 올리거나, 빈 양식으로 신규 상품만 등록할 수 있습니다.」
- **목록 조회가 403 이면** 「이 기능은 admin·master 권한이 필요합니다.」 를 화면 본문에 `role="alert"` 로 띄운다. `RouteGuard` 가 먼저 막긴 하지만 가드가 보는 클라이언트 롤과 서버 토큰의 `roles` 클레임이 어긋나면 통과한 뒤 403 이 난다 — 그 경우가 배포 선행조건(MD 계정 롤 실측)이 안 지켜졌을 때의 증상이라, 빈 화면이 아니라 원인을 말해야 한다

`session-list/upload-modal.tsx`:

- `<input type="file" accept=".xlsx" />` + 이름 입력(선택, placeholder 「비우면 파일명이 들어갑니다」)
- 제출 전 `file.size > MAX_UPLOAD_BYTES` 면 `toast.error('파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.')` 로 막는다
- `useUploadBulkSession()` 성공 시 `router.push(`/mall/bulk-sessions/${res.sessionId}`)`
- 실패 시 `toast.error(parseUploadError(error))`

- [ ] **Step 6: 검증**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/bulk-sessions/ apps/admin-web/src/app/\(admin\)/mall/bulk-sessions/`
Expected: 에러 0건

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/ "apps/admin-web/src/app/(admin)/mall/bulk-sessions/"
git commit -m "feat(admin-web): 일괄 세션 목록 + 업로드 + 빈 양식

업로드 400 을 '양식이 만료되었습니다'로 옮긴다 — 스펙 §3.1 이 필수
조건으로 못 박은 거부가 사람에게 드러나는 유일한 자리다."
```

---

### Task 8: admin-web — 상세 셸 (헤더 · working 패널 · phase 라우팅)

**Files:**
- Create: `apps/admin-web/src/app/(admin)/mall/bulk-sessions/[id]/page.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/header.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/working-panel.tsx`

**Interfaces:**
- Consumes: `useBulkSessionProgress`·`useCancelBulkSession` (Task 6) · `getBulkSessionView`·`computeDraftingProgress`·`computePublishProgress` (Task 5) · `phaseLabel`·`phaseBadgeVariant` (Task 7)
- Produces: 라우트 `/mall/bulk-sessions/[id]` · `<BulkSessionDetail sessionId />` — 이후 태스크는 이 파일의 `switch` 에 패널을 꽂는다

- [ ] **Step 1: 페이지와 셸을 만든다**

`app/(admin)/mall/bulk-sessions/[id]/page.tsx`:

```tsx
import RouteGuard from '@/components/layout/route-guard';
import BulkSessionDetail from '@/features/mall/bulk-sessions/session-detail';

export default async function BulkSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BulkSessionDetail sessionId={id} />
      </div>
    </RouteGuard>
  );
}
```

`params` 가 `Promise` 인 것은 Next 15(`^15.5.7`) 규약이고, 같은 앱의 `app/(admin)/mall/products-list/[masterId]/page.tsx` 가 이미 이 형태다 — 실측 확인 완료.

`session-detail/index.tsx`:

```tsx
'use client';

import { getBulkSessionView } from '@/lib/services/products/bulk-session-model';
import { useBulkSessionProgress } from '@/lib/services/products/bulk-session';
import { BulkSessionHeader } from './header';
import { WorkingPanel } from './working-panel';

export default function BulkSessionDetail({ sessionId }: { sessionId: string }) {
  const { data: progress, isPending, isError } = useBulkSessionProgress(sessionId);

  if (isPending) return <p className="p-6 text-sm text-muted-foreground">세션을 불러오는 중입니다…</p>;
  if (isError || !progress) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        세션을 찾을 수 없습니다.
      </p>
    );
  }

  const view = getBulkSessionView(progress.phase);

  return (
    <div className="flex flex-col gap-4">
      <BulkSessionHeader sessionId={sessionId} progress={progress} />
      {view === 'working' && <WorkingPanel progress={progress} />}
      {/* Task 9~11 이 review · images · drafted · published · canceled · failed 를 꽂는다 */}
    </div>
  );
}
```

`header.tsx` 는 다음을 한다:

- `phaseLabel`/`phaseBadgeVariant` 로 상태 배지
- ~~`cancelRequestedAt` 이 있으면 「취소 요청됨 — 진행 중인 작업이 끝나면 멈춥니다」~~ **→ 삭제 (2026-08-04, 사용자 결정).** Task 8 리뷰가 백엔드로 확인했다: `cancel_requested_at` 과 `phase='canceled'` 는 **같은 UPDATE** 로만 쓰이고(`bulk-session.manager.ts:411-417` 이 유일 write site), 그 컬럼이 non-null 인데 phase 가 `canceled` 가 아닌 상태는 도달 불가다. 즉 이 배너가 가정한 "취소 요청됐지만 아직 도는 중"이 존재하지 않아, 종단 세션마다 「취소됨」 배지 옆에 미래형 문장이 영구히 붙는다. 배지가 이미 같은 말을 하므로 배너를 없앤다 — 정리 안내는 Task 11 의 `canceled` 패널이 맡는다
- `[세션 취소]` 버튼 — `published`·`canceled` 가 아닐 때만(**`failed` 는 취소 대상이다** — §3.2 가 "취소로만 풀린다"로 정의). 확인창 문구: 「취소하면 재개할 수 없습니다. 이미 만들어진 임시 버전은 남으며, 취소 후 이 화면에서 정리할 수 있습니다.」
- `phaseError` 가 있으면 그 아래 `role="alert"` 로 표시

`working-panel.tsx`:

```tsx
'use client';

import { Loader2 } from 'lucide-react';
import type { BulkSessionProgress } from '@/lib/types/dto/bulk-session';
import { computeDraftingProgress, computePublishProgress } from '@/lib/services/products/bulk-session-model';

const MESSAGES: Record<string, string> = {
  uploaded: '업로드를 접수했습니다. 곧 검증을 시작합니다…',
  validating: '워크북을 검증하는 중입니다…',
  drafting: '임시 버전을 만드는 중입니다…',
  publishing: '상품을 발행하는 중입니다…',
};

export function WorkingPanel({ progress }: { progress: BulkSessionProgress }) {
  const { done, total } =
    progress.phase === 'publishing' ? computePublishProgress(progress) : computeDraftingProgress(progress);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-10">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{MESSAGES[progress.phase] ?? '처리 중입니다…'}</p>
      {total > 0 && (
        <p className="text-sm">
          <strong>{done}</strong> / {total}건
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 검증**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/bulk-sessions/session-detail/ "apps/admin-web/src/app/(admin)/mall/bulk-sessions/[id]/page.tsx"`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/session-detail/ "apps/admin-web/src/app/(admin)/mall/bulk-sessions/"
git commit -m "feat(admin-web): 일괄 세션 상세 셸

phase 하나로 몸통을 갈아끼운다. 진행률 분모는 itemTotal 이고, 발행
단계만 idle 을 뺀 publishCounts 를 쓴다."
```

---

### Task 9: admin-web — review 패널

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/item-row.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/conflict-field.tsx`
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/index.tsx`

**Interfaces:**
- Consumes: `useBulkSessionItems`·`useBulkSessionUndecidedCount`·`useSetConflictDecision`·`useApproveBulkSession` (Task 6) · `canApprove`·`toCountMap` (Task 5)
- Produces: `<ReviewPanel sessionId progress />`

**필터 탭 4개는 전부 서버 필터다.**

| 탭 | 쿼리 |
|---|---|
| 전체 | `{}` |
| 정상 | `{ status: 'pending' }` |
| 오류 | `{ status: 'invalid' }` |
| 충돌 | `{ conflict: 'any' }` |

- [ ] **Step 1: 충돌 필드 컴포넌트를 만든다**

`conflict-field.tsx` — 라디오 둘. **기본 선택이 없다**(`decision === null` 이면 둘 다 미선택). 서버가 기본값을 정하지 않는 이유가 화면에도 같이 적용된다 — 「덮어쓰기」는 항상 남의 편집을 되돌리는 결정이다.

```tsx
'use client';

import type { BulkSessionItemConflict, ConflictDecision } from '@/lib/types/dto/bulk-session';

interface Props {
  conflict: BulkSessionItemConflict;
  disabled: boolean;
  onDecide: (field: string, decision: ConflictDecision) => void;
}

export function ConflictField({ conflict, disabled, onDecide }: Props) {
  const name = `conflict-${conflict.field}`;
  return (
    <div className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
      <div className="font-medium">
        충돌 · {conflict.label}
        <span className="ml-2 font-normal text-muted-foreground">기준 「{conflict.base}」</span>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          disabled={disabled}
          checked={conflict.decision === 'overwrite'}
          onChange={() => onDecide(conflict.field, 'overwrite')}
        />
        <span>
          내 값 「{conflict.mine}」
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          disabled={disabled}
          checked={conflict.decision === 'skip'}
          onChange={() => onDecide(conflict.field, 'skip')}
        />
        <span>
          현재 값 「{conflict.current}」
          <span className="ml-1 text-muted-foreground">(남이 바꿈)</span>
        </span>
      </label>
      {conflict.decision === null && (
        <p className="text-xs text-amber-700">
          아직 정하지 않았습니다. 「내 값」을 고르면 남의 편집을 되돌립니다.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 행 컴포넌트를 만든다**

`item-row.tsx` — 접힌 상태는 `rowNumber · rowKey · kind(신규/수정) · 이름 · 변경 N · 충돌 M`. 펼치면:

- `changes` 를 `{label} {before || '(비움)'} → {after || '(비움)'}` 로 나열. **서버가 붙인 `label` 을 그대로 쓴다** — 라벨 매핑을 화면에 두 번째로 두지 않는다
- `conflicts` 를 `<ConflictField>` 로 나열
- `status === 'invalid'` 면 `errorMessage` 를 `role="alert"` 로 보여주고 결정 UI 를 달지 않는다

- [ ] **Step 3: 패널을 조립한다**

`review-panel/index.tsx` 가 하는 일:

- 탭 상태(`'all' | 'pending' | 'invalid' | 'conflict'`)와 페이지 상태
- `useBulkSessionItems(sessionId, query)` — 탭에 따라 위 표대로 쿼리를 만든다
- `useBulkSessionUndecidedCount(sessionId, true)` — 헤더 배지
- 결정: `useSetConflictDecision(sessionId)` 를 `{ itemId, decisions: { [field]: decision } }` 로 부른다(**부분 갱신이라 필드 하나만 보낸다**)
- 승인 버튼: `canApprove(progress.phase, undecided ?? 0)` 로 활성화. 확인창 문구는 `invalid` 수를 넣어

```
오류 {invalidCount}건은 제외하고 {pendingCount}건을 진행합니다.
```

  두 수는 `toCountMap(progress.itemCounts)` 에서 읽는다
- 409 를 받으면 `toast.error('세션 상태가 바뀌었습니다. 새 상태를 불러왔습니다.')` — 훅의 `onSuccess` 무효화와 별개로 `onError` 에서 진행률을 무효화한다

`session-detail/index.tsx` 의 분기에 `{view === 'review' && <ReviewPanel sessionId={sessionId} progress={progress} />}` 를 더한다.

- [ ] **Step 4: 검증**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/`
Expected: 에러 0건

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/session-detail/
git commit -m "feat(admin-web): 일괄 세션 검토 패널

충돌 라디오에 기본 선택을 두지 않는다 — 서버가 기본값을 정하지 않는
이유와 같다. 승인 확인창이 '오류 N건은 제외하고 진행합니다'를 명시한다:
approve 는 pending 행만 보므로 invalid 는 조용히 빠진다."
```

---

### Task 10: admin-web — images 패널

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/images-panel/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/images-panel/dropzone.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/images-panel/use-image-uploader.ts`
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/index.tsx`

**Interfaces:**
- Consumes: `useBulkSessionImages`·`useResolveImages` (Task 6) · `matchFilesToImageRows`·`chunkResolutions`·`pairResolveResults`·`RESOLVE_CHUNK_SIZE` (Task 5) · `uploadFileToFileService(file, { contextId })` (`lib/api/domains/files/upload.client.ts`)
- Produces: `<ImagesPanel sessionId progress />` · `useImageUploader(sessionId)`

**동시성 5.** 수백 장을 한꺼번에 던지면 브라우저 커넥션 한도와 프록시가 막는다.

- [ ] **Step 1: 업로드 훅을 만든다**

Create `use-image-uploader.ts` — 순수 판정은 전부 Task 5 의 함수를 부르고 여기엔 오케스트레이션만 남는다:

```typescript
'use client';

import { useCallback, useRef, useState } from 'react';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import type {
  BulkSessionImage,
  BulkSessionPhase,
  ResolveImageEntry,
} from '@/lib/types/dto/bulk-session';
import {
  chunkResolutions,
  matchFilesToImageRows,
  pairResolveResults,
  type UploadTask,
} from '@/lib/services/products/bulk-session-model';
import { useResolveImages } from '@/lib/services/products/bulk-session';

/** 동시 업로드 상한. 수백 장을 한꺼번에 던지면 브라우저 커넥션 한도와 프록시가 막는다. */
const CONCURRENCY = 5;

export interface FailedUpload {
  imageKey: string;
  usage: BulkSessionImage['usage'];
  fileName: string;
  reason: string;
}

export interface UploaderState {
  running: boolean;
  done: number;
  total: number;
  failed: FailedUpload[];
  unmatchedFiles: string[];
  duplicateNames: string[];
}

const INITIAL: UploaderState = {
  running: false,
  done: 0,
  total: 0,
  failed: [],
  unmatchedFiles: [],
  duplicateNames: [],
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : '업로드에 실패했습니다.';
}

/**
 * 작업 배열을 고정 개수의 워커로 소진한다.
 *
 * `Promise.all` 로 전부 던지지 않는 이유는 수백 장에서 브라우저 커넥션 한도와 Next
 * 프록시가 막기 때문이다. 인덱스를 공유 커서로 써서 워커가 끝나는 대로 다음 것을 집는다 —
 * 청크로 나눠 배리어를 두는 것보다 느린 파일 하나가 전체를 잡아두지 않는다.
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export function useImageUploader(sessionId: string) {
  const [state, setState] = useState<UploaderState>(INITIAL);
  const resolveImages = useResolveImages(sessionId);
  // 재시도는 같은 파일 핸들을 다시 써야 한다. 브라우저가 경로를 돌려주지 않으므로
  // 사용자가 떨군 File 객체를 들고 있는 것이 유일한 방법이다.
  const lastTasksRef = useRef<UploadTask<File>[]>([]);

  const runTasks = useCallback(
    async (tasks: UploadTask<File>[]): Promise<BulkSessionPhase | null> => {
      lastTasksRef.current = tasks;
      setState((prev) => ({ ...prev, running: true, done: 0, total: tasks.length, failed: [] }));

      const entries: ResolveImageEntry[] = [];
      const failed: FailedUpload[] = [];

      await runPool(tasks, CONCURRENCY, async (task) => {
        try {
          const uploaded = await uploadFileToFileService(task.file, { contextId: task.contextId });
          entries.push({ imageKey: task.imageKey, usage: task.usage, fileId: uploaded.id });
        } catch (error) {
          failed.push({
            imageKey: task.imageKey,
            usage: task.usage,
            fileName: task.file.name,
            reason: reason(error),
          });
        } finally {
          setState((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      });

      // 서버가 한 요청에 50건까지 받는다. 청크마다 항목별 결과가 오므로 부분 성공이다.
      let lastPhase: BulkSessionPhase | null = null;
      for (const chunk of chunkResolutions(entries)) {
        try {
          const response = await resolveImages.mutateAsync(chunk);
          lastPhase = response.progress.phase;
          // 인덱스가 아니라 (imageKey, usage) 로 짝짓는다 — 중복이 축약돼 길이가 줄 수 있다.
          for (const result of pairResolveResults(chunk, response.results)) {
            if (result.ok) continue;
            const task = tasks.find((t) => t.imageKey === result.imageKey && t.usage === result.usage);
            failed.push({
              imageKey: result.imageKey,
              usage: result.usage,
              fileName: task?.file.name ?? result.imageKey,
              reason: result.error ?? '서버가 이 파일을 받아들이지 않았습니다.',
            });
          }
        } catch (error) {
          // 청크 하나가 통째로 실패해도 나머지 청크는 계속 보낸다 — 부분 진행이 남는 편이
          // 전부 되돌리는 것보다 낫다(서버가 멱등이라 재시도가 안전하다).
          for (const entry of chunk) {
            const task = tasks.find((t) => t.imageKey === entry.imageKey && t.usage === entry.usage);
            failed.push({
              imageKey: entry.imageKey,
              usage: entry.usage,
              fileName: task?.file.name ?? entry.imageKey,
              reason: reason(error),
            });
          }
        }
      }

      setState((prev) => ({ ...prev, running: false, failed }));
      return lastPhase;
    },
    [resolveImages]
  );

  const run = useCallback(
    async (files: File[], rows: BulkSessionImage[]): Promise<BulkSessionPhase | null> => {
      const matched = matchFilesToImageRows(files, rows);
      setState((prev) => ({
        ...prev,
        unmatchedFiles: matched.unmatchedFiles,
        duplicateNames: matched.duplicateNames,
      }));
      if (matched.tasks.length === 0) return null;
      return runTasks(matched.tasks);
    },
    [runTasks]
  );

  const retryFailed = useCallback(async (): Promise<BulkSessionPhase | null> => {
    const keys = new Set(state.failed.map((f) => `${f.imageKey} ${f.usage}`));
    const retry = lastTasksRef.current.filter((t) => keys.has(`${t.imageKey} ${t.usage}`));
    if (retry.length === 0) return null;
    return runTasks(retry);
  }, [state.failed, runTasks]);

  return { state, run, retryFailed };
}
```

> `UploadTask<File>` 로 제네릭 인자를 명시한다 — 모델의 `matchFilesToImageRows` 는 `{ name: string }` 구조만 요구하지만(jest 가 node 환경이라 `File` 을 쓸 수 없다), 실제 업로드는 진짜 `File` 이 필요하다.

- [ ] **Step 2: 드롭존을 만든다**

`dropzone.tsx`:

- `<input type="file" multiple />` 과 폴더용 `<input type="file" webkitdirectory="" directory="" multiple />` 둘을 둔다. `webkitdirectory` 는 React 타입에 없으므로 다음 주석과 함께 확장한다:

```tsx
// webkitdirectory 는 표준이 아니라 React.InputHTMLAttributes 에 없다. 폴더 선택은
// 이 속성으로만 열리므로 로컬 확장으로 좁게 연다 — any 캐스팅보다 범위가 작다.
declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}
```

- `onDrop` 은 `DataTransferItemList` 를 순회해 파일을 모은다. 폴더 재귀는 `webkitGetAsEntry` 로 하되, **지원하지 않는 브라우저에서는 파일만 받는다**(경고 문구 없이 조용히 동작해야 한다 — 폴더 입력 버튼이 대체 경로다)

- [ ] **Step 3: 패널을 조립한다**

`images-panel/index.tsx` 가 하는 일:

- `useBulkSessionImages(sessionId, { onlyRequired: true, status: 'awaiting_upload', page: 1, limit: 200 })`
- 게이트 표시: `requiredResolved / requiredTotal` (응답의 필터 무관 값)
- 요구 파일명 목록을 보여준다 — 작업자가 "무엇을 올려야 하는지"를 보는 자리다
- 드롭 후:
  - `duplicateNames.length > 0` → `toast.warning(`같은 이름의 파일이 ${n}건 있습니다. 마지막 파일이 사용됩니다.`)`
  - `unmatchedFiles.length > 0` → 목록으로 표시(무시하되 알린다)
  - 실패 목록이 있으면 `[실패한 것만 다시 시도]`
- `run()` 이 돌려준 `phase === 'drafting'` 이면 `toast.success('이미지가 모두 준비돼 임시 버전 생성을 시작합니다.')`. 패널 전환은 훅의 `setQueryData` 가 이미 처리한다
- 업로드 중 이탈 경고:

```tsx
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 이탈해도 이미 올라간 것은 서버에 남는다 — 남은 것만 다시 떨구면 된다.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);
```

`session-detail/index.tsx` 분기에 `{view === 'images' && <ImagesPanel sessionId={sessionId} progress={progress} />}` 를 더한다.

- [ ] **Step 4: 검증**

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/bulk-sessions/session-detail/images-panel/`
Expected: 에러 0건

Run: `npm run test:admin-web -- apps/admin-web/src/lib/services/products/bulk-session-model.spec.ts`
Expected: PASS — 매칭·청킹·짝짓기 헬퍼가 여전히 초록

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/session-detail/
git commit -m "feat(admin-web): 일괄 세션 이미지 패널

작업 단위가 파일이 아니라 행이다 — 같은 파일명을 main·description 이
각각 요구하면 contextId 가 달라 두 번 올린다. 해석 결과는 인덱스가
아니라 (imageKey, usage) 로 짝짓는다."
```

---

### Task 11: admin-web — drafted · published · canceled · failed 패널

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/drafted-panel/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/drafted-panel/item-actions.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/published-panel/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/canceled-panel/index.tsx`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/failed-panel.tsx`
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/index.tsx`

**Interfaces:**
- Consumes: `useBulkSessionItems`·`usePublishBulkSession`·`useRetryDraft`·`useExcludeItem`·`usePurgeDrafts`·`useCancelBulkSession` (Task 6) · `shouldContinuePurge`·`toCountMap`·`computePublishProgress` (Task 5) · `buildDraftEditPath(masterId, versionId)` (`features/mall/my-drafts/lib/draft-edit-path.ts`)
- Produces: `<DraftedPanel>` · `<PublishedPanel>` · `<CanceledPanel>` · `<FailedPanel>`

- [ ] **Step 1: drafted 패널**

- 행 표: `status` 필터(`drafted`/`failed`/`excluded`)와 `publishStatus` 배지. **두 축이 다르다** — 한 행이 `drafted` 이면서 `publishStatus='failed'` 일 수 있다
- 행 액션(`item-actions.tsx`):
  - `masterId && draftVersionId` 면 `<Link href={buildDraftEditPath(masterId, draftVersionId)} target="_blank">임시 버전 열기</Link>`. 없으면(신규 생성 자체 실패) 링크를 두지 않는다
  - `[제외]` — 확인창: 「제외한 행은 다시 넣을 수 없습니다. 풀린 임시 버전은 작성중인 상품 목록에 나타납니다.」
- 액션 둘:
  - `[일괄 발행]` → `usePublishBulkSession`
  - `status='failed'` 행이 있으면 `[draft 실패 행 재시도]` → `useRetryDraft`. **버튼 아래 경고를 고정 표시한다**:

```
실패한 행만 다시 처리합니다. 신규 상품 행은 재시도할 때마다 내부 등록
기록이 한 번 더 쌓이므로, 원인을 확인한 뒤 눌러 주세요.
```

- [ ] **Step 2: published 패널**

- `computePublishProgress(progress)` 로 집계
- **실패 수가 0 이 아니면 실패 블록이 완료 문구보다 위에 온다.** 세션은 `published` 로 마감되지만 발행 안 된 행이 남을 수 있고(§10.4), 완료만 크게 띄우면 그 행들이 묻힌다
- 실패 행 표: `rowNumber`·`rowKey`·`publishError`(서버가 이미 한국어로 분류) + `[제외]`
- `[실패 행 재발행]` — `usePublishBulkSession` 과 **같은 라우트**다

- [ ] **Step 3: canceled 패널**

```tsx
  async function handlePurge() {
    setPurging(true);
    let purged = 0;
    let failed = 0;
    try {
      // remaining===0 또는 purged===0(진전 없음)까지 반복한다. 후자가 없으면
      // 영구 실패 행 앞에서 영원히 돈다.
      for (;;) {
        const result = await purgeDrafts.mutateAsync();
        purged += result.purged;
        failed += result.failed;
        setStats({ purged, failed, remaining: result.remaining });
        if (!shouldContinuePurge(result)) break;
      }
    } catch (error) {
      toast.error(parseServerError(error, '정리 중 오류가 발생했습니다.').message);
    } finally {
      setPurging(false);
    }
  }
```

패널에 정리 규칙을 고정 표시한다:

```
발행된 적 있는 행과 제외된 행은 건드리지 않습니다.
수정 행은 임시 버전만, 신규 행은 상품까지 함께 지웁니다.
```

- [ ] **Step 4: failed 패널**

`phaseError` 와 `[세션 취소]` 뿐이다. **재시도·재개 버튼을 두지 않는다** — 스펙 §3.2 가 `failed` 를 "취소로만 풀린다"로 정의했고, 버튼을 두면 화면이 그 정의를 어긴다.

- [ ] **Step 5: 셸에 꽂고 검증**

`session-detail/index.tsx` 의 분기에 남은 넷을 더한다.

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/bulk-sessions/session-detail/`
Expected: 에러 0건

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/session-detail/
git commit -m "feat(admin-web): 일괄 세션 draft·발행·취소·실패 패널

purge 반복은 remaining===0 또는 purged===0 에서 멈춘다. published 여도
실패 행이 남을 수 있어 실패 블록을 완료 문구보다 위에 둔다. failed 에는
재개 버튼을 두지 않는다 — 취소로만 풀리는 상태다."
```

---

### Task 12: admin-web — 메뉴 · breadcrumb · 상품 상세 잠금 배너

**Files:**
- Modify: `apps/admin-web/src/lib/utils/menu.ts:222` 부근
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.ts:6-18`
- Modify: `.../products-detail/components/version-lifecycle-actions/version-lifecycle-actions-model.ts`
- Modify: `.../products-detail/components/version-lifecycle-actions/version-lifecycle-actions-model.spec.ts`
- Modify: `.../products-detail/components/version-lifecycle-actions/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx`

**Interfaces:**
- Consumes: `VersionLifecycleDetail` (기존) · `useBulkSessionProgress` (Task 6)
- Produces: `VersionLifecycleDetail.bulkSessionId: string | null` — `getVersionLifecycleActions` 가 이 값이 있으면 `canPublish`·`canDeleteDraft` 둘 다 false

- [ ] **Step 1: 잠금 판정의 실패 테스트를 쓴다**

`version-lifecycle-actions-model.spec.ts` 에 추가:

```typescript
describe('getVersionLifecycleActions — 일괄 세션 잠금', () => {
  const locked = {
    source: 'version' as const,
    status: 'draft' as const,
    versionId: 'v1',
    bulkSessionId: 'session-1',
  };

  it('세션에 잠긴 draft 는 발행도 삭제도 못 한다 — 서버가 둘 다 409 다', () => {
    expect(getVersionLifecycleActions(locked)).toEqual({ canPublish: false, canDeleteDraft: false });
  });

  it('잠기지 않은 draft 는 평소대로다', () => {
    expect(getVersionLifecycleActions({ ...locked, bulkSessionId: null })).toEqual({
      canPublish: true,
      canDeleteDraft: true,
    });
  });

  it('inactive 버전도 세션에 잠겨 있으면 발행하지 못한다', () => {
    expect(
      getVersionLifecycleActions({ ...locked, status: 'inactive' })
    ).toEqual({ canPublish: false, canDeleteDraft: false });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/features/mall/products-detail/components/version-lifecycle-actions/`
Expected: FAIL — `bulkSessionId` 가 `VersionLifecycleDetail` 에 없다

- [ ] **Step 3: 모델을 고친다**

```typescript
export type VersionLifecycleDetail = {
  source: 'master' | 'version';
  status: VersionLifecycleStatus;
  versionId: string | null;
  /**
   * 일괄 등록/수정 세션이 이 버전을 잠갔다면 그 세션 id.
   * 서버가 개별 발행·삭제를 둘 다 409 로 거부하므로 버튼을 아예 내린다.
   */
  bulkSessionId?: string | null;
};

export function getVersionLifecycleActions(
  detail: VersionLifecycleDetail
): VersionLifecycleActions {
  const isVersionDetail = detail.source === 'version' && Boolean(detail.versionId);
  const locked = Boolean(detail.bulkSessionId);
  const canPublish =
    !locked &&
    isVersionDetail &&
    (detail.status === 'draft' || detail.status === 'inactive');
  const canDeleteDraft = !locked && isVersionDetail && detail.status === 'draft';

  return { canPublish, canDeleteDraft };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- apps/admin-web/src/features/mall/products-detail/components/version-lifecycle-actions/`
Expected: PASS — 기존 케이스 포함 전부

- [ ] **Step 5: 배너를 붙인다**

`version-lifecycle-actions/index.tsx` 에서 `bulkSessionId` 를 상세 응답에서 받아 모델에 넘기고, 값이 있으면 배너를 그린다. 세션 이름은 조회를 **한 번 시도**한다:

```tsx
  // 세션 API 는 소유자 스코프라 남의 세션은 404/403 이다. 링크를 무조건 걸어놓고
  // 눌렀을 때 404 로 보내는 것보다, 조회해 보고 없으면 링크를 안 거는 편이 정직하다.
  const session = useQuery({
    queryKey: productQueryKeys.bulkSession(bulkSessionId ?? ''),
    // `enabled` 가 bulkSessionId 있을 때만 이 queryFn 을 부르지만 TS 는 같은 객체
    // 리터럴의 두 옵션 사이 관계를 좁혀주지 않는다. non-null 단언 대신 가드로 좁힌다 —
    // 이 분기에 실제로 들어오면 enabled 배선이 깨진 것이므로 바로 던진다
    // (form-export.ts 의 useFormExportStatus 가 같은 함정을 같은 방식으로 처리했다).
    queryFn: () => {
      if (!bulkSessionId) {
        throw new Error('세션 배너 쿼리는 bulkSessionId 가 있을 때만 호출돼야 한다(enabled 배선 확인)');
      }
      return products.bulkSession.getProgress(bulkSessionId);
    },
    enabled: Boolean(bulkSessionId),
    retry: false,
  });
```

- 성공 → 「일괄 세션에 속한 임시 버전입니다. 발행·삭제는 세션에서 합니다.」 + `<Link href={`/mall/bulk-sessions/${bulkSessionId}`}>세션 열기</Link>`
- 실패 → 「다른 작업자의 일괄 세션에 속한 임시 버전입니다. 발행·삭제는 그 세션에서 합니다.」 (링크 없음)

**편집은 그대로 열어 둔다** — 스펙 §3.3 이 세션 draft 의 편집을 허용으로 두었다.

- [ ] **Step 6: 메뉴와 breadcrumb**

`menu.ts` 의 `product-management` 그룹, `product-drafts` 바로 아래:

```ts
      {
        id: 'product-bulk-sessions',
        title: '엑셀 일괄 등록/수정',
        path: '/mall/bulk-sessions',
      },
```

`breadcrumb-items.ts` 의 `mallProductBreadcrumbs` 배열에:

```ts
  { prefix: '/mall/bulk-sessions', label: '엑셀 일괄 등록/수정' },
```

> **이름 주의:** 같은 그룹에 `{ id: 'product-bulk', title: '일괄 작업', path: '/mall/bulk' }` 가 이미 있다(정책·액션 일괄 적용 — 별개 기능). 「일괄 등록」으로만 쓰면 구분되지 않는다.

- [ ] **Step 7: 양식 모달에 안내 링크를 더한다**

`form-export-modal/index.tsx` 의 `data?.status === 'completed' && data.downloadable && data.productCount > 0` 분기 문구 뒤에:

```tsx
                <p className="mt-2 text-muted-foreground">
                  작성을 마치면{' '}
                  <Link href="/mall/bulk-sessions" className="underline">
                    엑셀 일괄 등록/수정
                  </Link>{' '}
                  화면에서 올려 주세요.
                </p>
```

- [ ] **Step 8: 검증**

Run: `npm run test:admin-web -- apps/admin-web/src/features/mall/ apps/admin-web/src/lib/services/products/`
Expected: PASS

Run: `cd apps/admin-web && npm run type-check`
Expected: 신규 에러 0건

Run: `npx eslint apps/admin-web/src/features/mall/products-detail/components/version-lifecycle-actions/ apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx`
Expected: 에러 0건

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/
git commit -m "feat(admin-web): 메뉴·breadcrumb·세션 draft 잠금 배너

잠긴 draft 는 발행·삭제 버튼을 내리고 배너로 이유를 말한다. 편집은
그대로 열어 둔다 — 스펙 §3.3 이 세션 draft 편집을 허용으로 두었다.
메뉴 이름은 기존 '일괄 작업'(/mall/bulk)과 구분되게 '엑셀 일괄 등록/수정'."
```

---

### Task 13: 스모크 체크리스트 문서

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-product-bulk-session-smoke-checklist.md`

**Interfaces:**
- Consumes: 모체 스펙 §8 의 수동 스모크 항목 · §10.7·§10.8·§11.5 의 배포 선행조건
- Produces: 사람이 실행하는 체크리스트 하나

**왜 산출물인가:** 백엔드 2~6단계는 화면이 없어 **수동 스모크를 한 번도 돌리지 않은 채 배포됐다.** 이 단계가 그것을 처음으로 가능하게 하므로, 흩어진 항목을 한 문서로 모으는 것이 이 브랜치의 마지막 일이다.

- [ ] **Step 1: 문서를 쓴다**

다음 구조로 작성한다. **각 항목은 실행 가능한 한 문장**이어야 하고, 기대 결과를 함께 적는다.

```markdown
# 상품 일괄 등록/수정 — 수동 스모크 체크리스트

- 날짜: 2026-08-04
- 대상: core 1~6단계 + admin-web 화면 단계
- 전제: 배포 후 dev 또는 live 에서 사람이 실행한다

## 0. 배포 선행조건 (이것부터)

- [ ] **MD 계정 `roles` 실측** — 라이브 user DB 에서 실제 MD 계정의 롤 매핑을 확인한다.
      `master` 또는 `admin` 이 없으면 `/product-forms`·`/product-bulk-sessions` 전체가 403 이고
      화면이 통째로 안 열린다. 시드 롤은 master·admin·membership·user·logistics_worker·logistics_manager 여섯이다
- [ ] core 배포 → admin-web 배포 순서
- [ ] 마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건임을 배포 전 재확인

## 1. 양식 (1단계 + 화면)

- [ ] 상품 목록에서 10건 선택 → 「양식 다운로드」 → 완료 후 다운로드 → 7시트가 열린다
- [ ] 「카테고리 참조」 시트에 현재 카테고리 트리가 경로 문자열로 들어 있다
- [ ] 복합 가격규칙 상품이 섞여 있으면 그 행의 판매가 셀이 `[복합 가격규칙]` 이다
- [ ] `/mall/bulk-sessions` → 「빈 양식 다운로드」 → 데이터 0행 + 헤더 + 카테고리 참조 시트

## 2. 업로드·검증 (2단계 + 화면)

- [ ] 프리필 양식을 고쳐 올린다 → 상세로 이동, 검증 중 표시 → 검토 대기로 전진
- [ ] 필수 칸을 비운 행이 「오류」 탭에 뜨고 사유가 한국어다
- [ ] 옵션 구조를 바꾼 행(옵션값 추가·삭제)이 행 오류로 잡힌다
- [ ] 가격 센티넬을 고친 행이 행 오류로 잡힌다
- [ ] 상품키를 중복시킨 행이 행 오류로 잡힌다
- [ ] **만료된 exportId 워크북 업로드가 거부되고 「양식이 만료되었습니다」가 뜬다**
      (양식 잡 행을 수동으로 지운 뒤 그 워크북을 올려 재현한다)
- [ ] 빈 양식으로 신규 행만 채워 올리면 전 행이 「신규」로 분류된다

## 3. 충돌 (2단계 + 화면)

- [ ] 양식을 받은 뒤 같은 상품의 **다른** 필드를 화면에서 고쳐 발행 → 업로드 → 충돌이 아니다(자동 병합)
- [ ] 같은 필드를 고쳐 발행 → 업로드 → 「충돌」 탭에 뜨고 미결정 배지가 오른다
- [ ] 미결정이 남으면 「승인」이 비활성이다
- [ ] 필드별로 「내 값」/「현재 값」을 각각 고를 수 있다(한 행에서 섞어서)
- [ ] 오류 행이 있는 채 승인하면 확인창이 「오류 N건은 제외하고 M건을 진행합니다」를 말한다
- [ ] **발행 후 두 필드가 모두 살아 있다** — 이 스펙 전체가 걸린 한 줄이다

## 4. 이미지 (3단계 + 화면)

- [ ] 로컬 파일명을 참조한 행이 있으면 「이미지 대기」로 간다
- [ ] 폴더를 드롭하면 파일명으로 매칭돼 업로드가 돈다(대소문자 달라도 붙는다)
- [ ] 요구에 없는 파일이 「사용하지 않은 파일」로 표시된다
- [ ] 같은 파일명을 대표/본문이 각각 요구하면 두 번 올라간다
- [ ] 마지막 하나가 채워지는 순간 자동으로 다음 단계로 넘어간다
- [ ] 업로드 도중 새로고침 → 이미 올라간 것은 남고 남은 것만 다시 요구한다

## 5. draft 생성·검토 (4단계 + 화면)

- [ ] 신규 행이 상품+임시 버전으로 만들어진다
- [ ] 수정 행이 현재 active 에서 포크된 임시 버전으로 만들어진다
- [ ] 행의 「임시 버전 열기」가 상품 상세를 연다
- [ ] **그 화면에 발행·삭제 버튼이 없고 잠금 배너가 뜬다**
- [ ] 그 화면에서 편집은 되고 저장된다
- [ ] 세션 draft 가 「작성중인 상품」 목록에 **나타나지 않는다**
- [ ] draft 생성 실패 행이 있으면 「실패 행 재시도」가 뜨고 경고 문구가 함께 보인다

## 6. 발행·제외·재시도 (5단계 + 화면)

- [ ] 「일괄 발행」 → 발행 중 진행률 → 발행 완료
- [ ] 발행된 상품이 목록에서 새 버전으로 보인다
- [ ] 행 「제외」 → 그 draft 가 「작성중인 상품」에 다시 나타난다
- [ ] 제외한 행은 발행되지 않는다
- [ ] 발행 실패 행이 있으면 완료 문구보다 **위**에 실패 블록이 뜨고 사유가 한국어다
- [ ] 「실패 행 재발행」이 이미 발행된 행을 두 번 발행하지 않는다
- [ ] 발행 시점 가드 — 발행 직전에 그 상품을 화면에서 따로 발행해 두면 그 행만 실패하고
      「기준이 변경되었습니다」가 뜬다

## 7. 취소·정리 (3~5단계 + 화면)

- [ ] 진행 중 세션을 취소하면 진행 중 슬라이스가 멈춘다
- [ ] **취소 뒤 상품이 더 발행되지 않는다**
- [ ] `failed` 세션도 취소된다
- [ ] 취소된 세션에서 「남은 draft 정리」가 반복 호출로 끝까지 돈다
- [ ] 정리 후 발행된 행은 그대로 남아 있다
- [ ] 신규 행은 상품까지 사라지고 수정 행은 원래 active 가 멀쩡하다

## 8. 권한

- [ ] admin·master 가 아닌 계정으로는 메뉴가 보이더라도 화면이 403 안내를 띄운다
```

- [ ] **Step 2: 커밋**

```bash
git add docs/superpowers/specs/2026-08-04-product-bulk-session-smoke-checklist.md
git commit -m "docs(bulk-session): 수동 스모크 체크리스트

2~6단계는 화면이 없어 스모크를 한 번도 돌리지 않은 채 배포됐다.
이 단계가 처음으로 가능하게 하므로 흩어진 항목을 한 문서로 모은다.
맨 앞이 MD 계정 roles 실측 — 없으면 화면 전체가 403 이다."
```

---

## 최종 검증 (전 태스크 완료 후)

- [ ] `npm run test:admin-web -- apps/admin-web/src/lib/services/products/ apps/admin-web/src/features/mall/bulk-sessions/ apps/admin-web/src/features/mall/products-detail/` → PASS
- [ ] `npx jest apps/core/src/modules/catalog/operations/bulk-session/` → 이 브랜치가 만든 **신규** 실패 0건
- [ ] `npm run type-check:scoped` → 신규 에러 0건
- [ ] `cd apps/admin-web && npm run type-check` → 신규 에러 0건 (기준선과 동일)
- [ ] `git diff --name-only origin/develop..HEAD` 로 변경 범위 확인 — `apps/core`·`apps/admin-web`·`docs/superpowers` 뿐이어야 한다
- [ ] **마이그레이션 디렉터리에 새 파일이 없는지 확인** — `git diff --name-only origin/develop..HEAD -- 'apps/core/drizzle/*'` 가 비어야 한다
- [ ] 메인 체크아웃이 오염되지 않았는지 확인 — `git -C /home/pauseb/workspace/almondyoung-server status --short` 가 비어야 한다
