# 판매상품 대량등록 admin-web 재구축 — 설계

- 날짜: 2026-07-10
- 대상: `apps/admin-web` (Next.js admin) — 기존 CSV 대량등록 UI 제거 + 신규 엑셀 임포트 UI 구축
- 짝이 되는 백엔드: 브랜치 `feat/product-bulk-import-redesign` (tip `213e418e1`, 미병합).
  백엔드 설계: `docs/superpowers/specs/2026-07-10-product-bulk-import-redesign-design.md`

## 1. 배경 / 문제

백엔드 대량등록이 근본적으로 재설계되었다(`operations/csv/` → `operations/import/`). 기존 CSV 경로는 canonical 단건 등록을 **우회**해 스칼라 필드만 draft로 insert 했고(카테고리·옵션·variant·노출 이벤트 누락), 신규 경로는 멀티시트 엑셀 → 무상태 `validate` → 세션 `commit`(전부 draft) → 세션 단위 일괄 `publish` 흐름으로 canonical `createMaster`+`updateVersion`+`publishVersion` 을 그대로 재사용한다.

admin-web에는 아직 대응 UI가 없다. 기존 `/mall/csv` 페이지(template/import/export 3섹션 단발 폼)는 새 흐름(2단계 + 세션 + publish)과 구조가 맞지 않으므로 **제거하고 새로 구축**한다.

### 통합 대상 백엔드 API 계약 (`/product-imports`)

| 메서드 | 경로 | 반환 DTO | 용도 |
|--------|------|----------|------|
| GET | `/product-imports/template` | xlsx blob | Products/Options 시트 + 헤더 + 예시행 다운로드 |
| POST | `/product-imports/validate` (multipart `file`) | `ValidatePreviewDto` | 무상태 프리뷰(DB 쓰기 0). 행별 valid/invalid + errors[] + resolved{name, categoryNames[], variantCount} |
| POST | `/product-imports/commit` (multipart `file`) | `CommitResultDto` | **같은 파일** 재업로드 → 세션+draft 상품 일괄 생성. `{sessionId, createdCount, failedCount, items[{rowNumber, productKey, status, masterId?, errorMessage?}]}` |
| GET | `/product-imports?page&limit` | 세션 목록(페이지네이션) | `SessionSummaryDto[]` |
| GET | `/product-imports/:sessionId` | `SessionDetailDto` | 세션 요약 + items 전체(성공·실패) |
| POST | `/product-imports/:sessionId/publish` | `PublishResultDto` | draft 일괄 게시 → `{published, failed[{masterId, reason}]}` |

DTO 형태(백엔드 `import-response.dto.ts` 미러링):
- `ValidatePreviewDto` = `{ totalRows, validCount, invalidCount, rows: ValidatePreviewRowDto[] }`
- `ValidatePreviewRowDto` = `{ rowNumber, productKey, status: 'valid'|'invalid', errors: string[], resolved: { name, categoryNames: string[], variantCount } }`
- `CommitResultDto` = `{ sessionId, createdCount, failedCount, items: CommitItemDto[] }`
- `CommitItemDto` = `{ rowNumber, productKey, status: 'created'|'failed', masterId?, errorMessage? }`
- `SessionSummaryDto` = `{ id, fileName: string|null, totalRows, createdCount, failedCount, status, createdAt }`
- `SessionDetailDto extends SessionSummaryDto` = `{ ...summary, items: CommitItemDto[] }`
- `PublishResultDto` = `{ published, failed: PublishFailureDto[] }`, `PublishFailureDto` = `{ masterId, reason }`

### 핵심 제약 (반드시 준수)
1. **commit은 파일을 다시 받는다.** validate가 무상태라서 프론트는 validate/commit 사이에 `File` 객체를 메모리에 보관했다가 같은 파일을 commit에 재전송한다.
2. **commit은 `@User()` 로 서버에서 userId를 얻는다.** 기존 CSV 클라이언트처럼 body에 `userId`를 넣지 않는다.
3. **publish로만 노출된다.** commit은 draft만 만든다. publish → `ProductMasterActiveVersionChanged` 이벤트 → Medusa·검색·analytics 동기화가 실제 노출 시점.
4. **롤아웃 결합.** `/products/csv/*` 백엔드 제거는 API 계약 변경 → admin-web의 신규 `/product-imports/*` 전환과 **같은 배포**에 묶여야 한다(CLAUDE.md expand-contract).

## 2. 목표 / 비목표

**목표 (v1)**
- 운영자가 엑셀 템플릿 다운로드 → 작성 → 업로드 → 검증 프리뷰 → 커밋 → 세션 리뷰 → 일괄 게시 흐름을 admin-web에서 완결.
- 백엔드 `/product-imports/*` 6개 엔드포인트에 대응하는 API 클라이언트 + react-query 훅 + 3개 페이지.
- 기존 CSV 대량등록/내보내기 UI 통째 제거.

**비목표 (v1)**
- CSV export 대체 UI(제거만).
- 오류 리포트 엑셀 다운로드(화면 프리뷰 테이블로 대체).
- 이미지/변형 SKU 직접 입력 UI(등록 후 기존 단건 UI로 보완 — 백엔드 v1 비목표와 일치).
- 세션 아카이브 UI(백엔드 최종 컨트롤러에 archive 엔드포인트 없음).
- 게시 상태 영속 추적(§7 알려진 제약 참고).
- `/mall/bulk`(일괄 수정/삭제/정책, BulkModule) 개편 — 무관, 그대로 유지.

## 3. 결정 요약

| 항목 | 결정 |
|------|------|
| 페이지 구조 | **3페이지 분해** — 목록 / 위저드(3스텝) / 세션 상세 |
| 게시 위치 | **세션 상세에서만** (커밋 직후 위저드엔 "세션 상세로 이동" 링크만) |
| 커밋 게이팅 | `invalidCount > 0` 이면 커밋 버튼 비활성 → 파일 수정·재검증 강제 |
| 라우트/메뉴 | `/mall/product-imports`, 메뉴 라벨 "엑셀 대량등록"(기존 `product-csv` 교체) |
| CSV export | 대체 없이 제거 |
| 오류 리포트 | 화면 프리뷰 테이블만(다운로드 없음, ≤1,000행) |
| 게시상태 추적 | 미추적(결과 배너만, 버튼 재실행 가능) → 백엔드 후속 |
| userId | body 미전달(`@User()` 서버 처리) |

## 4. 라우트 & 메뉴

- 신규 페이지(모두 `(admin)` 그룹, `RouteGuard requireRole={['admin','master']}`, `getTokenPayload` 가드):
  - `app/(admin)/mall/product-imports/page.tsx` — 세션 목록
  - `app/(admin)/mall/product-imports/new/page.tsx` — 등록 위저드
  - `app/(admin)/mall/product-imports/[sessionId]/page.tsx` — 세션 상세
- `lib/utils/menu.ts`: `product-csv`("CSV 가져오기/내보내기", `/mall/csv`) 항목을 `product-imports`("엑셀 대량등록", `/mall/product-imports`)로 교체.
- `components/common/breadcrumb-items.ts`: `/mall/csv` prefix 항목을 `/mall/product-imports`("엑셀 대량등록")로 교체. 세션 상세용 동적 라벨 필요 시 기존 패턴 따름.
- `product-bulk`("일괄 작업", `/mall/bulk`)는 손대지 않는다.

## 5. 제거 대상 (신규 구축과 같은 PR)

- `app/(admin)/mall/csv/` (page)
- `features/mall/csv/` (template / import-section / export-section / template-section 전부)
- `lib/api/domains/products/csv.client.ts`
- `lib/services/products/` 내 CSV 훅(예: `useCsvBulkImport`) 및 query-keys의 csv 항목
- `lib/types/dto/products.ts` 의 `CsvImportResultDto` 등 CSV 전용 타입
- menu.ts / breadcrumb-items.ts 의 csv 항목(§4에서 교체)

제거 후 `apps/admin-web` 빌드가 깨지지 않도록 참조를 모두 정리한다. 권위 게이트는 `apps/admin-web` 빌드/`type-check`(단, [[lint-scope-caveat]] — 변경 파일 신규 error만 스코프).

## 6. 아키텍처 — API 클라이언트 · 훅 · 페이지

### 6.1 API 클라이언트
`lib/api/domains/products/product-import.client.ts` (기존 `csv.client.ts` 패턴: axios `client` + `ALMONDYOUNG_API_BASE_URL`):
```ts
export const productImportClient = {
  downloadTemplate(): Promise<Blob>                       // GET /template, responseType 'blob'
  validate(file: File): Promise<ValidatePreviewDto>       // POST /validate, FormData('file')
  commit(file: File): Promise<CommitResultDto>            // POST /commit, FormData('file') — userId 미전달
  getSessions(page: number, limit: number): Promise<...>  // GET /?page&limit
  getSession(sessionId: string): Promise<SessionDetailDto>// GET /:sessionId
  publish(sessionId: string): Promise<PublishResultDto>   // POST /:sessionId/publish
}
```
`lib/api/domains/products/index` 및 `lib/api/domains` 배럴에 등록. csv.client export 제거.

### 6.2 react-query 훅
`lib/services/products/` (기존 queries/mutations/query-keys 컨벤션):
- query-keys: `productImports` 네임스페이스(`list(page)`, `detail(id)`).
- mutations: `useValidateImport()`, `useCommitImport()`, `usePublishSession()`. publish 성공 시 해당 세션 detail 쿼리 무효화.
- queries: `useImportSessions(page)`, `useImportSession(sessionId)`.
- 타입: 백엔드 DTO 미러 타입을 신설 `lib/types/dto/product-import.ts` 에 정의(기존 `products.ts` 는 CSV 타입 제거만).

### 6.3 페이지 1 — 세션 목록 `/mall/product-imports`
- `Container` + `Header`("엑셀 대량등록"), 우상단 **"새 대량등록"** 버튼 → `/mall/product-imports/new`.
- `DataTable`(기존 `useDataTable` 패턴, PAGE_SIZE 20): 컬럼 = 파일명 · 시도(totalRows) · 성공(createdCount) · 실패(failedCount) · 상태 · 생성일시. 행 클릭 → `/[sessionId]`.
- 데이터: `useImportSessions(page)`.

### 6.4 페이지 2 — 등록 위저드 `/mall/product-imports/new`
3스텝 스테퍼. 선택한 `File`을 위저드 상위 컴포넌트 state에 보관(validate·commit 재사용).
- **Step 1 · 업로드**: "템플릿 다운로드" 버튼(`downloadTemplate` → blob 저장) + 드롭존/클릭 파일선택(`accept=".xlsx"`). 파일 선택 시 Step 2로.
- **Step 2 · 검증 프리뷰**: `useValidateImport` 로 `validate(file)`. 요약(총 `totalRows` · 유효 `validCount` · 오류 `invalidCount`) + 행별 테이블(rowNumber · productKey · 상태 뱃지 · resolved{name·categoryNames·variantCount} · errors[]). 필터(전체 / 오류만). "파일 다시 선택" → Step 1 재업로드 루프.
  - **커밋 게이팅**: `invalidCount > 0` → "커밋" 버튼 `disabled` + "오류 N건을 수정 후 재검증하세요" 안내. `invalidCount === 0 && totalRows > 0` 일 때만 활성.
- **Step 3 · 커밋 결과**: `useCommitImport` 로 `commit(file)`(같은 file). 성공/실패 요약(`createdCount`/`failedCount`) + 실패 아이템 간단 표시 + **"세션 상세로 이동"**(→`/[sessionId]`). 게시 버튼 없음.
- 게이팅 순수 함수(`canCommit(preview)`)는 별도 유닛 테스트 대상으로 분리.

### 6.5 페이지 3 — 세션 상세 `/mall/product-imports/[sessionId]`
- 세션 요약 헤더(파일명 · 시도/성공/실패 · 상태 · 생성일시). 데이터: `useImportSession(sessionId)`.
- 아이템 테이블: rowNumber · productKey · 상태(created/failed) · 성공 → 상품 상세 링크(`masterId` → `/mall/products-list/[masterId]`) · 실패 → `errorMessage`.
- **"세션 일괄 게시"** 버튼 → `usePublishSession` → 완료 후 결과 배너(`published N` / `failed[{masterId, reason}]` 목록). 성공 후 세션 detail 무효화.

## 7. 알려진 제약 / 후속

- **게시 상태 미추적**: 백엔드 `product_import_items` 에 published 플래그가 없고 세션 status 는 `completed/archived` 뿐이라, "이미 게시됨"을 영속 추적할 수 없다. → 세션 상세는 게시 후 결과 배너만 표시하고 게시 버튼을 "다시 게시"로 남긴다(publishSession 은 best-effort/재실행 안전). 영속 게시상태(세션 status 확장 또는 item published_at)는 **백엔드 후속** 으로 별도 트래킹(admin-web v1 범위 밖).
- **롤아웃**: `/products/csv/*` 백엔드 제거 배포와 이 admin-web PR 은 같은 배포에 묶는다. 백엔드 브랜치 병합 → 배포 순서에 맞춰 admin-web 전환 PR 병합.
- **WMS phantom masterId**([[product-bulk-import-redesign]] 후속 1)는 백엔드 이슈로, admin-web 설계와 무관.

## 8. 테스트

- API 클라이언트: FormData 구성 / blob 응답 / 엔드포인트 경로 단위 테스트(기존 client 테스트 컨벤션).
- 훅: mutation/query 훅 스모크(mock client).
- 위저드 게이팅: `canCommit(preview)` 순수 함수 유닛 테스트(invalid>0 → false, valid만 && total>0 → true, total 0 → false).
- DTO transformer(있으면) 매핑 테스트.
- E2E/실기동 스모크는 백엔드 배포 후.
