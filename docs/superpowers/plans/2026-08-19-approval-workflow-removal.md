# 상품 승인 워크플로 제거 구현 계획 (#663)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `publishVersion` 을 우회해 승계 3종을 건너뛰는 상품 승인 워크플로를, core·admin-web 양쪽에서 파생 표면까지 제거한다. DB 는 건드리지 않는다.

**Architecture:** 순수 삭제 작업이다. 새 동작을 만들지 않으므로 대부분의 태스크는 "지우고 → 타입체크 0 → 커밋" 사이클이다. 단 core 스펙 2개는 삭제 대상을 *기대값으로 박아둔* 테스트라서 진짜 TDD 가 성립한다 — 스펙을 먼저 고쳐 RED 를 만들고, 프로덕션 코드를 지워 GREEN 으로 만든다. 순서는 admin-web(호출자) → core(피호출자) 로, 배포 순서와 같게 간다.

**Tech Stack:** NestJS(core) · Next.js(admin-web) · Drizzle ORM · Jest · class-validator

**Spec:** `docs/superpowers/specs/2026-08-19-approval-workflow-removal-design.md`

## Global Constraints

- **마이그레이션 0건.** `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 테이블·컬럼·enum·인덱스 정의를 **삭제하지 않는다.** `npm run db:generate:core` 를 부를 일이 없다. 새 SQL 파일이 생겼다면 잘못한 것이다.
- **루트 `npm run type-check` 는 `apps/admin-web` 을 보지 않는다.** 루트 `tsconfig.json` 의 `exclude` 목록에 들어 있다. admin-web 검증은 반드시 `cd apps/admin-web && npm run type-check` 로 따로 돌린다.
- 루트 `tsconfig.json` 은 `incremental: true` 다. 삭제 규모에 비해 결과가 지나치게 깨끗하면 `find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete` 후 다시 돌린다.
- **`npx jest` 는 단독 실행 시 OOM 난다.** 항상 `npx jest --maxWorkers=2`.
- **워크트리를 쓴다면 디렉터리 이름에 `+` 를 넣지 않는다.** 이 저장소의 jest 무시 패턴은 정규식이라 `+` 가 수량자로 해석돼 패턴이 조용히 안 걸리고, `apps/medusa` 스펙이 딸려 들어와 실패가 17건 늘어난다.
- 커밋 메시지는 저장소 컨벤션을 따른다: `type(scope): 한국어 설명 (#663)`.
- 브랜치: `refactor/663-remove-product-approval-workflow`. `develop` 위에서 직접 커밋하지 않는다.

---

## File Structure

**삭제 (파일/디렉터리 통째, 8개)**

| 경로 | 책임 (제거 사유) |
|---|---|
| `apps/core/src/modules/catalog/operations/approval/approval.module.ts` | 승인 모듈 등록 |
| `apps/core/src/modules/catalog/operations/approval/product-approval.controller.ts` | 승인 라우트 5개 |
| `apps/core/src/modules/catalog/operations/approval/product-approval.service.ts` | `publishVersion` 우회 활성화 로직 — 이 이슈의 본체 |
| `apps/core/src/modules/catalog/operations/approval/dto/index.ts` | 배럴 |
| `apps/core/src/modules/catalog/operations/approval/dto/product-approval.dto.ts` | 승인 요청 DTO 3종 |
| `apps/admin-web/src/lib/api/domains/products/approval.client.ts` | 승인 API 클라이언트 |
| `apps/admin-web/src/features/mall/audit/components/pending-approval-table/` | 승인 대기 목록 |
| `apps/admin-web/src/features/mall/audit/components/approval-modal/` | 승인/거부 모달 |

**수정 (core 11 · admin-web 10)** — 각 태스크에 정확한 지점과 지울 코드를 인용한다.

**유지 (건드리지 않음)**

- `apps/core/src/modules/catalog/schema/catalog.schema.ts` — 주석 추가만 (Task 6)
- `apps/core/src/modules/catalog/catalog.types.ts` · `schema/catalog.schema.types.ts` — schema 의 기계적 미러이므로 `ProductApprovalHistory*` 타입 export 를 남긴다
- `apps/admin-web/src/features/mall/audit/components/audit-log-table/` · `history-drawer/` · `app/(admin)/mall/audit/page.tsx` — 별개 `/products/audit/*` API 를 쓴다
- `apps/core/src/modules/inventory/**` 의 `approvedBy` — 발주 승인이라는 별개 도메인이다

---

### Task 1: 브랜치 생성 + admin-web 승인 워크플로 제거

승인 화면·훅·클라이언트·타입을 지운다. `/mall/audit` 페이지는 감사 로그 단일 화면으로 남는다.

**Files:**
- Create: (없음)
- Delete: `apps/admin-web/src/features/mall/audit/components/pending-approval-table/`, `apps/admin-web/src/features/mall/audit/components/approval-modal/`, `apps/admin-web/src/lib/api/domains/products/approval.client.ts`
- Modify: `apps/admin-web/src/features/mall/audit/template/index.tsx`, `apps/admin-web/src/lib/api/domains/products/index.ts:4,39,58`, `apps/admin-web/src/lib/services/products/queries.ts:540-557`, `apps/admin-web/src/lib/services/products/mutations.ts:865-902`, `apps/admin-web/src/lib/services/products/query-keys.ts:156-159`, `apps/admin-web/src/lib/types/dto/products.ts:1191-1217`, `apps/admin-web/src/components/common/breadcrumb-items.ts:15`, `apps/admin-web/src/lib/utils/menu.ts:247`
- Test: 없음 (admin-web 은 컴포넌트 테스트 불가 — `tsc --noEmit` 이 유일한 검증)

**Interfaces:**
- Consumes: (없음 — 첫 태스크)
- Produces: 이후 태스크는 `approvalClient`, `useSubmitApproval`, `useApprove`, `useReject`, `usePendingApprovals`, `useApprovalHistory`, `productQueryKeys.pendingApprovals`, `productQueryKeys.approvalHistory`, `PendingApprovalDto`, `ApprovalHistoryItemDto`, `ApproveProductDto`, `RejectProductDto` 를 **참조하지 않는다** (전부 사라짐)

- [ ] **Step 1: 브랜치를 끊는다**

```bash
git checkout develop
git pull --ff-only
git checkout -b refactor/663-remove-product-approval-workflow
```

- [ ] **Step 2: 승인 전용 파일/디렉터리를 지운다**

```bash
git rm -r apps/admin-web/src/features/mall/audit/components/pending-approval-table
git rm -r apps/admin-web/src/features/mall/audit/components/approval-modal
git rm apps/admin-web/src/lib/api/domains/products/approval.client.ts
```

- [ ] **Step 3: `/mall/audit` 템플릿을 감사 로그 단일 화면으로 바꾼다**

`apps/admin-web/src/features/mall/audit/template/index.tsx` 를 통째로 아래로 교체한다. Tabs 와 `PendingApprovalTable` import 가 사라진다.

```tsx
'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { AuditLogTable } from '../components/audit-log-table';

export default function AuditTemplate() {
  return (
    <Container>
      <Header
        title="감사 이력"
        subtitle="상품 변경 이력을 확인합니다."
      />
      <div className="px-4 pb-4 pt-4">
        <AuditLogTable />
      </div>
    </Container>
  );
}
```

- [ ] **Step 4: products API 배럴에서 `approvalClient` 를 걷는다**

`apps/admin-web/src/lib/api/domains/products/index.ts` 에서 세 줄을 지운다.

```ts
// 4번째 줄 — import 제거
import { approvalClient } from './approval.client';

// products 객체(39번째 줄 부근) — 항목 제거
  approval: approvalClient,

// 파일 끝(58번째 줄) — 재export 제거
export { approvalClient } from './approval.client';
```

- [ ] **Step 5: 승인 쿼리 훅 2개를 지운다**

`apps/admin-web/src/lib/services/products/queries.ts` 의 540-557 줄, 아래 블록 전체를 섹션 주석까지 지운다.

```ts
// ===== 승인 =====

export const usePendingApprovals = () => {
  return useQuery({
    queryKey: productQueryKeys.pendingApprovals,
    queryFn: () => products.approval.getPending(),
    staleTime: 30 * 1000,
  });
};

export const useApprovalHistory = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.approvalHistory(masterId),
    queryFn: () => products.approval.getApprovalHistory(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
  });
};
```

- [ ] **Step 6: 승인 뮤테이션 훅 3개를 지운다**

`apps/admin-web/src/lib/services/products/mutations.ts` 의 865-902 줄을 지운다. 865 줄의 `// ===== 승인 =====` 주석부터 `useReject` 의 닫는 `};` 까지이며, `useSubmitApproval` · `useApprove` · `useReject` 세 개가 포함된다. 904 줄의 `// ===== 공지사항 뮤테이션 =====` 은 남긴다.

- [ ] **Step 7: 승인 쿼리 키를 지운다**

`apps/admin-web/src/lib/services/products/query-keys.ts` 의 156-159 줄을 지운다.

```ts
  // 승인 관련
  pendingApprovals: ['approval', 'pending'] as const,
  approvalHistory: (masterId: string) =>
    ['approval', 'history', masterId] as const,
```

- [ ] **Step 8: 승인 전용 DTO 인터페이스 4개를 지운다**

`apps/admin-web/src/lib/types/dto/products.ts` 의 1191-1217 줄, `// ===== 승인 관련 =====` 섹션 전체를 지운다. `PendingApprovalDto` · `ApprovalHistoryItemDto` · `ApproveProductDto` · `RejectProductDto` 네 개가 여기에 있다. **`MastersQuery`(137줄)와 `BulkUpdateDto`(1129줄)의 `approvalStatus` 필드는 이 태스크에서 건드리지 않는다 — Task 2 소관이다.**

- [ ] **Step 9: 메뉴·브레드크럼 라벨에서 '승인' 을 뺀다**

```ts
// apps/admin-web/src/components/common/breadcrumb-items.ts:15
  { prefix: '/mall/audit', label: '감사 이력' },

// apps/admin-web/src/lib/utils/menu.ts:247
      { id: 'product-audit', title: '감사 이력', path: '/mall/audit' },
```

- [ ] **Step 10: admin-web 타입체크 — 남은 참조가 없어야 한다**

```bash
cd apps/admin-web && npm run type-check
```

Expected: 에러 0. 에러가 나면 그 파일이 방금 지운 심볼을 아직 import 하고 있다는 뜻이므로, 참조를 지우고 다시 돌린다.

- [ ] **Step 11: 커밋**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add -A apps/admin-web
git commit -m "refactor(admin-web): 상품 승인 워크플로 화면·훅·클라이언트를 제거한다 (#663)"
```

---

### Task 2: admin-web `approvalStatus` 파생 표면 제거

승인 워크플로가 사라졌으니 `approvalStatus` 를 읽고 쓰는 필터·대량작업도 지운다. 이 값은 `publishVersion` 이 갱신하지 않아 실질적으로 `'draft'` 한 종류뿐이다.

**Files:**
- Modify: `apps/admin-web/src/hooks/table/filters/use-products-list-table-filters.ts:71-81`, `apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts:25,43,79-84`, `apps/admin-web/src/lib/types/dto/products.ts:137,1129`, `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx`, `apps/admin-web/src/features/mall/bulk/components/table/index.tsx:62-67`
- Test: 없음

**Interfaces:**
- Consumes: Task 1 이 남긴 상태 — 승인 훅/클라이언트/DTO 가 이미 없다
- Produces: `MastersQuery` 와 `BulkUpdateDto` 에서 `approvalStatus` 필드가 사라진다. `BulkActionType` 유니온에서 `'approvalStatus'` 멤버가 사라진다. Task 5 의 core `BulkUpdateDto` 변경과 짝을 이룬다.

- [ ] **Step 1: 상품목록 '승인 상태' 필터 정의를 지운다**

`apps/admin-web/src/hooks/table/filters/use-products-list-table-filters.ts` 의 71-81 줄, 아래 객체를 배열에서 통째로 지운다.

```ts
    {
      key: 'approvalStatus',
      label: '승인 상태',
      type: 'select',
      options: [
        { label: '임시저장', value: 'draft' },
        { label: '승인대기', value: 'pending' },
        { label: '승인완료', value: 'approved' },
        { label: '반려', value: 'rejected' },
      ],
    },
```

- [ ] **Step 2: 목록 쿼리 훅에서 `approvalStatus` 3곳을 지운다**

`apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts` 에서:

```ts
// (1) 25번째 줄 — 허용 쿼리 파라미터 목록에서 제거
    'approvalStatus',

// (2) 43번째 줄 — 구조분해에서 제거
    approvalStatus,

// (3) 79-84번째 줄 — searchParams 매핑에서 제거
    approvalStatus:
      approvalStatus === 'draft' ||
      approvalStatus === 'pending' ||
      approvalStatus === 'approved' ||
      approvalStatus === 'rejected'
        ? approvalStatus
        : undefined,
```

- [ ] **Step 3: 두 DTO 에서 `approvalStatus` 필드를 지운다**

```ts
// apps/admin-web/src/lib/types/dto/products.ts:137 — MastersQuery
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';

// apps/admin-web/src/lib/types/dto/products.ts:1129 — BulkUpdateDto
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
```

- [ ] **Step 4: 대량작업 모달에서 승인 상태 액션을 걷는다**

`apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx` 에서 다섯 지점을 지운다.

```tsx
// (1) 34-40줄 부근 — BulkActionType 유니온에서 멤버 제거
  | 'approvalStatus'

// (2) 68줄 — 상태 훅 제거
  const [approvalStatus, setApprovalStatus] = useState('');

// (3) 89-90줄 — getTitle() 의 case 제거
      case 'approvalStatus':
        return '승인 상태 일괄 변경';

// (4) 121-129줄 — bulkUpdate 페이로드의 조건부 스프레드 제거
          ...(action === 'approvalStatus' && approvalStatus
            ? {
                approvalStatus: approvalStatus as
                  | 'draft'
                  | 'pending'
                  | 'approved'
                  | 'rejected',
              }
            : {}),

// (5) 206-221줄 — 렌더의 Select 블록 제거
          {action === 'approvalStatus' && (
            <div className="space-y-2">
              <Label>승인 상태</Label>
              <Select value={approvalStatus} onValueChange={setApprovalStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="승인 상태 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">임시저장</SelectItem>
                  <SelectItem value="pending">승인 대기</SelectItem>
                  <SelectItem value="approved">승인됨</SelectItem>
                  <SelectItem value="rejected">거부됨</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
```

- [ ] **Step 5: 대량작업 툴바에서 진입 버튼을 지운다**

`apps/admin-web/src/features/mall/bulk/components/table/index.tsx` 의 62-67 줄을 지운다.

```tsx
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('approvalStatus')}
          >
            승인 상태 변경
          </Button>
```

- [ ] **Step 6: admin-web 타입체크**

```bash
cd apps/admin-web && npm run type-check
```

Expected: 에러 0. `Select`/`SelectItem` 등이 모달에서 더 이상 안 쓰이면 unused import 로 잡히니 같이 정리한다.

- [ ] **Step 7: admin-web lint**

```bash
cd apps/admin-web && npm run lint
```

Expected: 통과.

- [ ] **Step 8: 커밋**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add -A apps/admin-web
git commit -m "refactor(admin-web): 상품 목록·대량작업의 승인 상태 축을 제거한다 (#663)"
```

---

### Task 3: core 승인 모듈 삭제

라우트 5개와 `publishVersion` 우회 로직이 사라진다. 이 태스크가 이슈의 본체다.

**Files:**
- Delete: `apps/core/src/modules/catalog/operations/approval/` (5개 파일 전부)
- Modify: `apps/core/src/modules/catalog/catalog.module.ts:18,47`
- Test: 없음 (승인 서비스에 스펙이 없다 — 그 자체가 이 경로가 방치돼 있었다는 증거다)

**Interfaces:**
- Consumes: Task 1·2 가 끝나 admin-web 에 호출자가 없다
- Produces: `ProductApprovalService`, `ProductApprovalController`, `ApprovalModule`, `SubmitForApprovalDto`, `ApproveProductDto`, `RejectProductDto` 가 core 에서 사라진다. `NewProductApprovalHistory` 타입은 `catalog.types.ts` 에 남지만 소비처가 0이 된다.

- [ ] **Step 1: 사라질 라우트를 먼저 기록한다**

```bash
grep -rn "@Post\|@Get" apps/core/src/modules/catalog/operations/approval/product-approval.controller.ts
```

Expected: 5줄. `POST :id/submit-approval` · `POST :id/approve` · `POST :id/reject` · `GET pending-approval` · `GET :id/approval-history`. 이 목록을 PR 본문에 옮겨 적는다.

- [ ] **Step 2: 승인 디렉터리를 통째로 지운다**

```bash
git rm -r apps/core/src/modules/catalog/operations/approval
```

- [ ] **Step 3: `catalog.module.ts` 에서 모듈 등록을 걷는다**

두 줄을 지운다.

```ts
// 18번째 줄 — import
import { ApprovalModule } from './operations/approval/approval.module';

// 47번째 줄 — imports 배열의 // Operations 구획 첫 항목
    ApprovalModule,
```

- [ ] **Step 4: 타입체크 — 남은 참조가 없어야 한다**

```bash
npm run type-check
```

Expected: 에러 0. 에러가 나면 `ProductApprovalService` 를 주입하는 곳이 남았다는 뜻이다 (실측상 없어야 한다).

- [ ] **Step 5: 유닛 테스트**

```bash
npx jest --maxWorkers=2
```

Expected: 실패 0.

- [ ] **Step 6: 커밋**

```bash
git add -A apps/core
git commit -m "refactor(catalog): publishVersion 을 우회하던 상품 승인 모듈을 제거한다 (#663)"
```

---

### Task 4: core 조회 필터 축 제거 (스펙 먼저)

`GET /masters?approvalStatus=` 필터를 컨트롤러·DTO·서비스에서 걷는다. **스펙 2개가 이 필드를 기대값으로 박아두고 있어 진짜 RED→GREEN 사이클이 성립한다.**

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.spec.ts:44,57,63`, `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.spec.ts:40,57,71`, `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.ts:39-41`, `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts:152-158,215,262`, `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts:116,717-722`
- Test: 위 스펙 2개

**Interfaces:**
- Consumes: Task 3 이후 상태
- Produces: `ListProductMastersQueryDto` 와 `ProductMastersService.getMasters` 의 필터 타입에서 `approvalStatus` 가 사라진다

- [ ] **Step 1: 실패하는 스펙을 먼저 쓴다 — 쿼리 DTO**

`apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.spec.ts` 에서 세 곳을 고친다.

```ts
// (1) 44번째 줄 — 유효 쿼리 픽스처에서 제거
      approvalStatus: 'pending',

// (2) 57번째 줄 — 잘못된 enum 픽스처에서 제거
      approvalStatus: 'bogus',

// (3) 63번째 줄 — 기대 프로퍼티 목록에서 제거
    expect(props).toEqual(['order', 'productType', 'sort', 'status']);
```

(3)이 핵심이다. DTO 에 필드가 남아 있는 한 `approvalStatus: 'bogus'` 가 여전히 검증 에러를 만들어 목록이 5개가 되므로 이 스펙은 실패한다.

- [ ] **Step 2: 실패하는 스펙을 먼저 쓴다 — 컨트롤러**

`apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.spec.ts` 에서 세 줄을 지운다.

```ts
// 40번째 줄 — toHaveBeenCalledWith 의 정확 일치 객체에서 제거
      approvalStatus: undefined,

// 57번째 줄 — 입력 픽스처에서 제거
      approvalStatus: 'pending',

// 71번째 줄 — objectContaining 기대값에서 제거
        approvalStatus: 'pending',
```

40번째 줄이 핵심이다. `toHaveBeenCalledWith` 는 정확 일치라, 컨트롤러가 아직 `approvalStatus: undefined` 를 넘기는 동안은 이 스펙이 실패한다.

- [ ] **Step 3: 스펙이 실패하는지 확인한다 (RED)**

```bash
npx jest --maxWorkers=2 list-product-masters-query.dto.spec product-masters.controller.spec
```

Expected: FAIL 2건. 쿼리 DTO 쪽은 `Expected: ["order","productType","sort","status"] / Received: ["approvalStatus","order","productType","sort","status"]`, 컨트롤러 쪽은 호출 인자 불일치.

- [ ] **Step 4: 쿼리 DTO 에서 필드를 지운다**

`apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.ts` 의 39-41 줄.

```ts
  @IsOptional()
  @IsIn(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
```

- [ ] **Step 5: 컨트롤러에서 ApiQuery 와 전달 2곳을 지운다**

`apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts`:

```ts
// (1) 152-158줄 — Swagger 쿼리 문서
  @ApiQuery({
    name: 'approvalStatus',
    required: false,
    enum: ['draft', 'pending', 'approved', 'rejected'],
    description:
      "승인 상태. mode='active'(기본)에선 승인된 active 버전만 조회되므로 draft/pending/rejected 필터는 mode='all'과 함께 사용.",
  })

// (2) 215번째 줄 — getMasters 로 넘기는 필터
      approvalStatus: query.approvalStatus,

// (3) 262번째 줄 — 두 번째 목록 라우트의 같은 줄
      approvalStatus: query.approvalStatus,
```

- [ ] **Step 6: 서비스에서 필터 옵션과 where 술어를 지운다**

`apps/core/src/modules/catalog/core/products/services/product-masters.service.ts`:

```ts
// (1) 116번째 줄 — 필터 타입
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';

// (2) 717-722줄 — 주석까지 통째로
    // 승인 상태 필터: mode 와 교차한다. 기본 mode='active' 는 status='active'(대개 approved) 버전만
    // 보여주므로, draft/pending/rejected 로 필터하려면 mode='all'(또는 'active-or-inactive')을
    // 함께 지정해야 한다. 승인 대기 전용 조회는 GET /masters/pending-approval 참고.
    if (filters.approvalStatus) {
      whereConditions.push(eq(productMasterVersions.approvalStatus, filters.approvalStatus));
    }
```

- [ ] **Step 7: 스펙이 통과하는지 확인한다 (GREEN)**

```bash
npx jest --maxWorkers=2 list-product-masters-query.dto.spec product-masters.controller.spec
```

Expected: PASS 2건.

- [ ] **Step 8: 타입체크**

```bash
npm run type-check
```

Expected: 에러 0.

- [ ] **Step 9: 커밋**

```bash
git add -A apps/core
git commit -m "refactor(catalog): 상품 목록 조회에서 승인 상태 필터를 제거한다 (#663)"
```

---

### Task 5: core 응답·집계·대량작업 표면 제거

`approvalStatus` 를 응답에 싣거나 집계하거나 쓰는 나머지를 걷는다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/mappers/product.mapper.ts:31`, `apps/core/src/modules/catalog/core/products/dto/products/product-response.dto.ts:65-66`, `apps/core/src/modules/catalog/core/products/dto/entities/master-version.entity.ts:109-110`, `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts:17-19`, `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts:92`, `apps/core/src/modules/catalog/analytics/dashboard/dto/dashboard.dto.ts:21-35,66-70,101-105`, `apps/core/src/modules/catalog/analytics/dashboard/dashboard.service.ts:9,53-61,85-88,95,113,132`
- Test: 기존 유닛 스펙 전체 (`npx jest --maxWorkers=2`)

**Interfaces:**
- Consumes: Task 4 이후 상태
- Produces: `ProductDto` · `MasterVersionEntity` · `BulkUpdateDto`(core) 에서 `approvalStatus` 필드가 사라진다. `ApprovalBreakdownDto` 클래스와 `DashboardMetricsResponseDto.byApproval` · `TopProductItemDto.approvalStatus` 가 사라진다.

- [ ] **Step 1: 응답 매퍼와 DTO 2개에서 필드를 지운다**

```ts
// apps/core/src/modules/catalog/core/products/mappers/product.mapper.ts:31
      approvalStatus: version.approvalStatus,

// apps/core/src/modules/catalog/core/products/dto/products/product-response.dto.ts:65-66
  @ApiProperty({ description: '승인 상태' })
  approvalStatus: string;

// apps/core/src/modules/catalog/core/products/dto/entities/master-version.entity.ts:109-110
  @ApiProperty({ description: '승인 상태', enum: ['draft', 'pending', 'approved', 'rejected'] })
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected';
```

- [ ] **Step 2: 대량작업 DTO 와 서비스에서 걷는다**

```ts
// apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts:17-19
  @IsOptional()
  @IsEnum(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: string;

// apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts:92
    if (dto.approvalStatus) updateData.approvalStatus = dto.approvalStatus;
```

- [ ] **Step 3: 대시보드 DTO 에서 승인 집계 표면을 지운다**

`apps/core/src/modules/catalog/analytics/dashboard/dto/dashboard.dto.ts` 에서 세 지점.

```ts
// (1) 21-35줄 — ApprovalBreakdownDto 클래스 통째
// ===== Approval Breakdown DTO =====
export class ApprovalBreakdownDto {
  @ApiProperty({
    description: '승인 상태 (draft/pending/approved/rejected)',
    example: 'approved',
  })
  approvalStatus: string;

  @ApiProperty({
    description: '해당 승인 상태의 제품 수',
    example: 120,
    minimum: 0,
  })
  count: number;
}

// (2) 66-70줄 — DashboardMetricsResponseDto 의 필드
  @ApiProperty({
    description: '승인 상태별 제품 수',
    type: [ApprovalBreakdownDto],
  })
  byApproval: ApprovalBreakdownDto[];

// (3) 101-105줄 — TopProductItemDto 의 필드
  @ApiProperty({
    description: '승인 상태',
    example: 'approved',
  })
  approvalStatus: string;
```

- [ ] **Step 4: 대시보드 서비스에서 집계 쿼리와 매핑을 지운다**

`apps/core/src/modules/catalog/analytics/dashboard/dashboard.service.ts` 에서 여섯 지점.

```ts
// (1) 9번째 줄 — import 목록에서
  ApprovalBreakdownDto,

// (2) 53-61줄 — 집계 쿼리 통째
    // 3. 승인 상태별 제품 수
    const productsByApproval = await this.db
      .select({
        approvalStatus: productMasterVersions.approvalStatus,
        count: sql<number>`count(*)`,
      })
      .from(productMasterVersions)
      .where(and(isNull(productMasterVersions.deletedAt), eq(productMasterVersions.status, 'active')))
      .groupBy(productMasterVersions.approvalStatus);

// (3) 85-88줄 — 결과 매핑
    const byApproval: ApprovalBreakdownDto[] = productsByApproval.map((a) => ({
      approvalStatus: a.approvalStatus || 'unknown',
      count: Number(a.count),
    }));

// (4) 95번째 줄 — 리턴 객체의 필드
      byApproval,

// (5) 113번째 줄 — getTopProducts 의 select 항목
        approvalStatus: productMasterVersions.approvalStatus,

// (6) 132번째 줄 — getTopProducts 의 리턴 매핑
      approvalStatus: p.approvalStatus || 'unknown',
```

`dashboard.service.ts:113` 근처에 `eq(productMasterVersions.status, 'active')` 가 두 번 들어간 중복 술어가 있는데, 승인과 무관하므로 **고치지 않는다.**

- [ ] **Step 5: 타입체크**

```bash
npm run type-check
```

Expected: 에러 0. `ApprovalBreakdownDto` 를 아직 import 하는 곳이 있으면 여기서 잡힌다.

- [ ] **Step 6: 유닛 테스트 전량**

```bash
npx jest --maxWorkers=2
```

Expected: 실패 0.

- [ ] **Step 7: lint**

```bash
npm run lint
```

Expected: 통과.

- [ ] **Step 8: 커밋**

```bash
git add -A apps/core
git commit -m "refactor(catalog): 응답·대시보드·대량작업의 승인 상태 표면을 제거한다 (#663)"
```

---

### Task 6: 스키마 주석 + 전체 검증 + PR

DB 는 그대로 두되, 코드에서 읽지 않게 된 사실을 스키마에 남긴다. 주석이 없으면 다음 사람이 이 컬럼을 살아있는 축으로 오해한다.

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:204,662`
- Test: 전체 검증 명령 4종

**Interfaces:**
- Consumes: Task 1-5 의 모든 삭제
- Produces: (없음 — 마무리 태스크)

- [ ] **Step 1: 컬럼 블록에 주석을 단다**

`apps/core/src/modules/catalog/schema/catalog.schema.ts:204` 의 `// Approval Workflow` 주석을 아래로 교체한다. **컬럼 정의 4줄은 그대로 둔다.**

```ts
    // Approval Workflow — 승인 워크플로는 #663 으로 제거됨(2026-08).
    // 이 컬럼들을 읽거나 쓰는 코드는 없다. publishVersion 도 approvalStatus 를 갱신하지 않으므로
    // 실데이터는 사실상 'draft' 한 종류다. DROP 은 ADR-0005 §5 contract phase 라 별도 판단.
    approvalStatus: ProductMasterVersionApprovalStatusEnum('approval_status').notNull().default('draft'),
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by'),
    rejectionReason: text('rejection_reason'),
```

- [ ] **Step 2: 테이블 정의에 주석을 단다**

`apps/core/src/modules/catalog/schema/catalog.schema.ts:662` 의 섹션 주석을 아래로 교체한다. **`pgTable` 정의 전체는 그대로 둔다.**

```ts
// ===== 13. PRODUCT APPROVAL HISTORY =====
// 승인 워크플로는 #663 으로 제거됨(2026-08). 이 테이블에 쓰는 코드는 없다.
// 상품 변경 이력 화면(/mall/audit)은 이 테이블이 아니라 product_audit_log 를 쓴다.
// DROP 은 ADR-0005 §5 contract phase 라 별도 판단.
```

- [ ] **Step 3: 마이그레이션이 생기지 않았는지 확인한다**

```bash
git status --short apps/core/drizzle
```

Expected: 출력 없음. 새 `.sql` 파일이 있다면 스키마 정의를 실수로 지운 것이므로 되돌린다.

- [ ] **Step 4: 백엔드 전체 검증**

```bash
npm run type-check
npx jest --maxWorkers=2
npm run lint
```

Expected: 각각 에러 0 / 실패 0 / 통과. `type-check` 결과가 삭제 규모에 비해 지나치게 깨끗하면 캐시를 지우고 다시 돌린다:

```bash
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && npm run type-check
```

- [ ] **Step 5: admin-web 전체 검증**

```bash
cd apps/admin-web && npm run type-check && npm run lint && npm run build
```

Expected: 타입 에러 0, lint 통과, 빌드 성공.

- [ ] **Step 6: 잔여 참조 전수 확인**

```bash
cd /home/pauseb/workspace/almondyoung-server
grep -rn "approvalStatus\|approval_status\|ProductApproval\|approvalClient\|pendingApprovals\|approvalHistory" \
  apps/core/src apps/admin-web/src --include=*.ts --include=*.tsx
```

Expected: `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 스키마 정의와 주석, `catalog.types.ts` · `schema/catalog.schema.types.ts` 의 `ProductApprovalHistory*` 타입 미러 **만** 남는다. 그 밖의 히트가 있으면 지우지 못한 참조다.

- [ ] **Step 7: 커밋**

```bash
git add -A apps/core
git commit -m "docs(catalog): 승인 컬럼·테이블이 코드에서 죽었음을 스키마에 명시한다 (#663)"
```

- [ ] **Step 8: 푸시하고 PR 을 연다**

```bash
git push -u origin refactor/663-remove-product-approval-workflow
gh pr create --base develop \
  --title "refactor(catalog,admin-web): 상품 승인 워크플로를 제거한다 (#663)" \
  --body "$(cat <<'BODY'
## 배경

`ProductApprovalService.approve` 가 `publishVersion` 을 부르지 않고 활성 버전 전환을 직접 수행해, 승계 3종(`_reconcileMatchingsAfterPublish` · `_reconcileAssetLinksAfterPublish` · `_reconcileChannelListingsAfterPublish`)이 모두 건너뛰어졌다. #652 가 고친 증상이 이 경로에는 그대로 남아 있었다.

실측 결과 이 경로는 쓰이지 않는다 — 버전을 `pending` 으로 만드는 UI 가 없고(`useSubmitApproval` 호출자 0곳), `publishVersion` 은 `approvalStatus` 를 갱신하지 않아 실데이터가 사실상 `'draft'` 한 종류다. 잘못 배선된 채 방치된 경로이므로 고치지 않고 제거한다. 승인 기능이 필요해지면 `publishVersion` 을 타는 올바른 경로로 새로 만든다.

## 범위

- 승인 라우트 5개 + `ApprovalModule` 삭제
- admin-web 승인 화면·훅·클라이언트 삭제 (`/mall/audit` 는 감사 로그 단일 화면으로 유지)
- `approvalStatus` 파생 표면 제거 — 목록 필터 · 응답 DTO · 대시보드 집계 · 대량작업 액션
- **DB 는 손대지 않는다.** 컬럼·테이블·enum·인덱스 유지, 마이그레이션 0건. 스키마에 주석만 추가.

## 배포

마이그레이션 0 · 시크릿 0 · env 0 · 이벤트 계약 0. 순서는 **admin-web → core**.

## 설계 문서

`docs/superpowers/specs/2026-08-19-approval-workflow-removal-design.md`

Closes #663
BODY
)"
```

- [ ] **Step 9: 라이브 실측을 이슈에 남긴다**

배포 전 프로덕션 DB 에서 아래를 돌리고 결과를 #663 에 코멘트로 남긴다. 제거 여부를 바꾸지는 않지만, 나중에 컬럼 DROP(L3)을 판단할 유일한 근거다.

```sql
SELECT approval_status, count(*) FROM product_master_versions GROUP BY 1;
SELECT count(*) FROM product_approval_history;
```

---

## 배포 후 수동 확인 (사람)

- [ ] `/mall/audit` 이 열리고 감사 로그가 정상 표시된다 (탭 없이 단일 화면)
- [ ] 상품목록 필터에 '승인 상태' 가 없다
- [ ] 대량작업 툴바에 '승인 상태 변경' 버튼이 없다
- [ ] Swagger 에서 `/masters/*/approve` 계열 라우트 5개가 사라졌다
- [ ] 좌측 메뉴 라벨이 '감사 이력' 이다
