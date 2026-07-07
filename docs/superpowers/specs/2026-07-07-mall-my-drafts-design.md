# mall '작성중인 상품'(내 draft 목록) 기능 설계

- 작성일: 2026-07-07
- 목적: 로그인한 관리자가 **자신이 만든 draft(임시저장) 상품 버전**을 한 곳에서 조회하고, 그 중 하나를 골라 편집을 이어갈 수 있게 한다.
- 상태: 설계 승인됨. 구현은 별도 세션에서 진행 (이 문서만 보고 구현 가능하도록 작성).

## 1. 목표와 범위

**만드는 것**: admin-web에 새 라우트 `/mall/my-drafts`("작성중인 상품")를 추가한다. 현재 사용자가 소유한 draft 버전을 목록으로 보여주고, 각 행의 "이어서 편집"으로 기존 상세/편집 화면(`/mall/products-list/{masterId}?versionId={versionId}`)으로 이동한다. 디자인은 기존 `mall/products-list` 목록 페이지를 참고해 시각적 일관성을 맞춘다.

**해결할 문제**: 지금은 "내가 만들다 중단한 상품"을 다시 찾으려면 전체 상품 목록에서 `mode=all`(작성중 포함) 또는 `approvalStatus=draft` 필터를 걸어 **모든 사람의** draft를 뒤져야 한다. 내 것만 모아 보는 화면이 없다.

**핵심 제약 (이번에 함께 고침)**: draft 버전 테이블에 `draftOwnerId` 컬럼은 이미 있으나, **신규 상품 등록 경로(`POST /masters`)가 소유자를 기록하지 않는다**(현재 `createdBy`를 zero-UUID로 하드코딩, `@User`도 안 받음). "상품 만들다 중단 → 이어서 편집"이 가장 흔한 케이스이므로, 이 경로가 소유자를 기록하도록 백엔드를 함께 수정한다.

**범위 밖 (안 건드림)**:

- 수정 배포 **이전에** 생성돼 `draftOwnerId`가 비어 있는 orphan draft는 목록에 뜨지 않는다 — **백필하지 않는다**(합의됨).
- draft 삭제/휴지통/복원 등 다른 draft 관리 기능. 기존 상세 화면의 `VersionLifecycleActions`(publish/삭제)는 그대로 두고 재사용만 한다.
- 카테고리/브랜드/승인상태 등 상세 필터 — 이 화면은 **검색 + 정렬 최소 구성**만 둔다.
- 다른 사용자의 draft, 팀 공유 draft 개념 — 오직 "내가 소유한" draft만.

## 2. 현재 상태 (2026-07-07 확인)

### 백엔드 (`apps/core`)

| 파일 | 사실 |
|---|---|
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | `product_master_versions`에 `draftOwnerId: uuid('draft_owner_id')`(line 133, nullable, **인덱스 없음**). publish 시 `null`로 비워짐. |
| `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts` | `@Controller('masters')`. `createMaster()`가 **`@User` 없이** 서비스 호출. |
| `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts` | `createMaster()`(≈lines 176-197)가 master + 첫 draft 버전을 만들며 `draftOwnerId` 미설정, `createdBy`를 `'00000000-...-0'`로 하드코딩. |
| `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` | `createDraftVersion(parentVersionId, userId, ...)`·`createInitialDraftVersion(masterId, userId)`는 `draftOwnerId = userId` 설정. publish 시 `draftOwnerId: null`. `canUserModifyVersion(versionId, userId)`가 `draftOwnerId`로 소유권 확인. |
| `apps/core/src/modules/catalog/core/products/controllers/product-versions.controller.ts` | `@Controller('versions')`. `GET /versions/draft`(모든 draft, **owner 필터 없음**, `total`이 페이지 길이로 잡히는 기존 버그). |
| `libs/authorization` | 전역 `JwtAuthGuard`. `@User() user: { userId: string }` 데코레이터(`@app/authorization`)로 사용자 id 취득. `userId = JWT.sub`. |

- REST 경로엔 글로벌 prefix 없음 → 실제 경로가 곧 `/masters`, `/versions`.
- **소유자 필터 API는 어디에도 없다** — 이번에 신규로 만든다.

### 프론트엔드 (`apps/admin-web`)

| 파일 | 역할 (참고 대상) |
|---|---|
| `apps/admin-web/src/app/(admin)/mall/products-list/page.tsx` | 목록 라우트 진입점 |
| `apps/admin-web/src/features/mall/products-list/template/index.tsx` | 목록 템플릿(제목/서브타이틀 + 테이블 조립) |
| `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` | 테이블 조립 |
| `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx` | 컬럼 정의. `STATUS_LABELS = { active:'활성', inactive:'판매중단', draft:'임시저장', archived:'보관' }` — **draft 뱃지 재사용** |
| `apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts` | 쿼리 파라미터 → API 호출 |
| `apps/admin-web/src/lib/api/domains/products/versions.client.ts` | 버전 API 클라이언트(`listByMaster` 등) — 여기에 `listMyDrafts` 추가 |
| `apps/admin-web/src/lib/types/dto/products.ts` | 상품/버전 DTO 타입 모음 |
| `apps/admin-web/src/lib/utils/menu.ts` | 상품관리(product-management) 메뉴 정의(≈lines 207-256, children: 목록/등록) |

- 편집 이어가기 URL: `/mall/products-list/{masterId}?versionId={versionId}` (등록 플로우가 새 draft 생성 후 리다이렉트하는 것과 동일 경로). 상세 라우트 `.../products-list/[masterId]/page.tsx`가 `?versionId=`를 소비.

## 3. 설계

### 3.1 백엔드 — 소유자 기록 수정 (신규 등록 draft가 목록에 잡히게)

**목표**: `POST /masters`로 새 상품을 만들 때 생성되는 첫 draft 버전에 `draftOwnerId`를 현재 사용자로 기록한다.

- `product-masters.controller.ts` `createMaster()` — `@User() user: { userId: string }` 파라미터 추가, `user.userId`를 서비스에 전달.
- `product-masters.service.ts` `createMaster(dto, ownerId)` — 첫 draft 버전 insert 시 `draftOwnerId: ownerId`, `createdBy: ownerId`(master·version 공통)로 설정. zero-UUID 하드코딩 제거.
- **구현 시 확인**: 첫 draft가 `createMaster` 내부에서 인라인 insert 되는지, 아니면 `createInitialDraftVersion(masterId, userId)`를 호출하는지 코드로 확인하고, 어느 경로든 `userId`가 흘러가 `draftOwnerId`가 채워지게 한다. (`createInitialDraftVersion`은 이미 세팅하므로, 그 경로면 호출부에 userId만 넘기면 됨.)
- 프론트 등록 플로우(`product-registration`)는 **변경 불필요** — userId는 서버가 JWT에서 취득한다.

### 3.2 백엔드 — 신규 조회 엔드포인트 `GET /versions/my-drafts`

`product-versions.controller.ts`(`@Controller('versions')`)에 라우트 추가. 기존 `GET /versions/draft`는 **건드리지 않는다**(의미/버그 격리).

**컨트롤러**
```ts
@Get('my-drafts')
async getMyDrafts(
  @User() user: { userId: string },
  @Query() query: ListMyDraftsQueryDto,
) {
  return this.productVersionsService.getMyDraftVersions(user.userId, query);
}
```

**쿼리 DTO** — `ListMyDraftsQueryDto`(신규): `page?`, `limit?`, `q?`(상품명 검색), `sort?: 'updatedAt' | 'createdAt'`(기본 `updatedAt`), `order?: 'asc' | 'desc'`(기본 `desc`). 최소 구성 — 카테고리/브랜드/승인상태 필터 없음.

**서비스** `getMyDraftVersions(userId, query)` (`product-versions.service.ts`):
- `product_master_versions`(`v`)에서 `v.status = 'draft' AND v.draft_owner_id = userId`.
- `product_masters`(`m`) `innerJoin`으로 상품명/썸네일/상품유형/브랜드 취득. (master가 soft-delete 됐으면 제외 — `m.deletedAt IS NULL` 조건 확인.)
- `q`가 있으면 상품명 `ilike` 검색.
- 정렬: 기본 `v.updatedAt desc`(최근 편집 순 → 이어서 편집 UX에 자연스러움).
- **정확한 페이지네이션**: 별도 `count()` 쿼리로 `total` 산출(기존 `/versions/draft`의 length=total 버그 답습 금지).
- Drizzle 쿼리 규칙 준수: `trx.select().from().innerJoin().where().orderBy()`, `db.query.*`·`with`·`any`/`as` 금지.

**응답 DTO** — `MyDraftListItemDto` + 페이지네이션 래퍼:
```ts
class MyDraftListItemDto {
  masterId: string;
  versionId: string;
  productName: string;
  thumbnailUrl: string | null;
  productType: string;      // schema enum 값
  brand: string | null;
  status: 'draft';
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
}
// { items: MyDraftListItemDto[]; page; limit; total }
```
(중첩 DTO는 별도 클래스로 정의 — `@ApiProperty({ type:'object' })` 금지.)

**인덱스** — `catalog.schema.ts`의 `product_master_versions`에 `draft_owner_id` 인덱스 추가(소유자 조회 성능). additive 변경이므로 CLAUDE.md 컨벤션상 코드와 같은 PR 가능. drizzle 마이그레이션 1건 생성(`npm run db:generate:core -- --name add-draft-owner-id-index`). 스키마 변경이 있는 서비스라 `core`의 drizzle 설정 대상 확인.

### 3.3 프론트엔드 — 라우트 & 피처 (products-list 디자인 참고)

**라우트**: `apps/admin-web/src/app/(admin)/mall/my-drafts/page.tsx` — `products-list/page.tsx`를 참고한 얇은 진입점(피처 템플릿 렌더).

**피처 디렉터리** `apps/admin-web/src/features/mall/my-drafts/`:
- `template/index.tsx` — 제목 "작성중인 상품", 서브타이틀 예: "내가 만든 임시저장 상품을 이어서 편집할 수 있습니다." + 테이블 조립. `products-list/template/index.tsx` 구조 미러링.
- `components/table/index.tsx` — 테이블 조립. 공용 `DataTable`/`useDataTable` 재사용.
- 컬럼/쿼리 훅 — `products-list`의 훅 구조를 참고하되 my-drafts 전용으로 신설(`use-my-drafts-table-columns.tsx`, `use-my-drafts-table-query.ts`). 기존 products-list 훅은 재사용이 아니라 **참고**만(파라미터·컬럼이 다름).

**컬럼**:
- 썸네일 + 상품명
- 상품유형(productType)
- 상태 — `STATUS_LABELS`의 "임시저장" 뱃지 재사용(값은 항상 draft)
- 최종수정일(updatedAt)
- 액션 "이어서 편집" → `router.push('/mall/products-list/${masterId}?versionId=${versionId}')`

**필터/검색 (최소)**: 상품명 검색(q) + 정렬(최종수정일/생성일). 카테고리·브랜드·승인상태 없음.

**빈 상태**: "작성 중인 임시저장 상품이 없습니다." (예: 등록 화면으로 유도하는 링크는 선택).

**API 클라이언트**: `versions.client.ts`에 `listMyDrafts(query): Promise<PaginatedMyDrafts>` 추가 — `GET /versions/my-drafts` 호출. 응답 타입은 `lib/types/dto/products.ts`(또는 인접 파일)에 `MyDraftListItem` 등 추가.

**메뉴**: `menu.ts`의 상품관리 children에 항목 추가 — `{ label: '작성중인 상품', path: '/mall/my-drafts' }`. 위치는 목록/등록과 나란히.

## 4. 손대는 파일 요약

| 파일 | 변경 |
|---|---|
| `apps/core/.../controllers/product-masters.controller.ts` | `createMaster`에 `@User` 추가, userId 전달 |
| `apps/core/.../services/product-masters.service.ts` | 첫 draft 버전에 `draftOwnerId`/`createdBy` = ownerId 설정 (zero-UUID 제거) |
| `apps/core/.../controllers/product-versions.controller.ts` | `GET /versions/my-drafts` 라우트 추가 |
| `apps/core/.../services/product-versions.service.ts` | `getMyDraftVersions(userId, query)` 추가 |
| `apps/core/.../dto/*` (신규) | `ListMyDraftsQueryDto`, `MyDraftListItemDto` + 페이지네이션 응답 |
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | `product_master_versions.draft_owner_id` 인덱스 추가 |
| `apps/core/drizzle/<ts>_add-draft-owner-id-index.sql` (신규) | 인덱스 마이그레이션 (+ `drizzle/meta/`) |
| `apps/admin-web/src/app/(admin)/mall/my-drafts/page.tsx` (신규) | 라우트 진입점 |
| `apps/admin-web/src/features/mall/my-drafts/**` (신규) | template, table, 컬럼/쿼리 훅 |
| `apps/admin-web/src/lib/api/domains/products/versions.client.ts` | `listMyDrafts` 추가 |
| `apps/admin-web/src/lib/types/dto/products.ts` | `MyDraftListItem` 등 타입 추가 |
| `apps/admin-web/src/lib/utils/menu.ts` | 상품관리 children에 '작성중인 상품' 추가 |

## 5. 엣지 케이스 / 리스크

- **Orphan draft(소유자 미기록)**: 수정 배포 이전 draft는 `draftOwnerId=null`이라 목록에 안 뜸. 백필 안 함(수용). 이후 새로 만드는 draft부터 정상 노출.
- **한 master에 draft 다수**: 버전 트리상 한 상품이 draft를 여러 개 가질 수 있음. 행 단위가 버전이라 각 draft가 개별 행으로 정상 표시(각기 다른 versionId로 편집 이어가기).
- **소유자 vs 편집 이어가기 권한**: 목록은 `draftOwnerId=me`만 보여주므로, 상세 편집 화면의 `canUserModifyVersion`(동일 `draftOwnerId` 기준)과 일관됨 — 목록에 뜬 draft는 내가 편집 가능.
- **publish/삭제로 사라진 draft**: publish되면 `draftOwnerId=null`이 되어 자동으로 목록에서 빠짐(별도 처리 불필요). 삭제도 마찬가지.
- **`total` 정확도**: 반드시 별도 count 쿼리. `/versions/draft`의 length=total 버그를 신규 엔드포인트에 답습하지 말 것.
- **인덱스 회귀 없음**: `draft_owner_id` 인덱스는 순수 additive.
- **`createMaster` 소유자 기록의 파급**: `createdBy`를 실제 userId로 바꾸면 이 값을 zero-UUID로 가정하던 다른 코드가 있는지 확인(감사/표시 로직 등). 없으면 그대로 진행.

## 6. 테스트

- **백엔드(단위/e2e)**:
  - `getMyDraftVersions`: (a) 내 draft만 반환(다른 소유자·다른 status 제외), (b) 페이지네이션·total 정확, (c) 기본 정렬 updatedAt desc, (d) `q` 상품명 검색.
  - `createMaster`: 호출 시 첫 draft 버전의 `draftOwnerId`/`createdBy`가 요청 사용자로 기록되는지.
- **프론트(컴포넌트)**: 테이블 렌더 + "이어서 편집" 링크가 `/mall/products-list/{masterId}?versionId={versionId}`로 생성되는지. 빈 상태 렌더. 기존 admin-web 테스트 컨벤션을 따름.

## 7. 검증 방법 (수동)

1. 로그인 상태에서 신규 상품 등록(`/mall/product-registration`)으로 draft 생성 → 중단.
2. `/mall/my-drafts` 진입 → 방금 만든 draft가 목록 최상단(최근수정)에 뜨는지.
3. "이어서 편집" 클릭 → 해당 draft의 상세/편집 화면으로 이동하고 편집 지속 가능.
4. 다른 계정으로 만든 draft는 내 목록에 안 뜨는지.
5. 해당 draft를 publish → 목록에서 사라지는지.
