# 상품 일괄 등록/수정 세션 6단계 — 옛 `product_import_*` 제거 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1~v3 엑셀 대량등록(`product_import_*`)의 코드·화면·스키마·테이블을 전부 제거해, 상품 일괄 등록/수정 세션(`product_bulk_*`)을 유일한 대량등록 경로로 만든다.

**Architecture:** 이 브랜치는 **삭제만** 한다. 새 동작이 없으므로 TDD 의 "실패 테스트 먼저"가 성립하지 않고, 각 태스크의 검증은 *게이트를 돌려 신규 오류가 0인지*와 *잔여 참조 grep 이 0건인지*다. 삭제는 소비자 → 제공자 순으로 계층을 따라 내려간다(admin-web → core 배선 → core 본체 → 스키마 → 마이그레이션): 이 레포는 전역 `tsc`·`jest`·`nest build core` 가 develop 에서도 red 라 "전체 초록"으로 판정할 수 없고, 계층 순으로 지워야 각 커밋의 **신규** 오류가 정확히 그 계층에 남은 참조를 가리킨다.

**Tech Stack:** NestJS (apps/core) · Drizzle ORM + drizzle-kit · Next.js (apps/admin-web) · Jest · TypeScript

**근거 문서:** `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` **§11** (6단계 착수 전 확정 사항). §11.2 가 삭제 인벤토리, §11.3 이 순서, §11.4 가 전제, §11.5 가 배포, §11.6 이 갭 범위, §11.7 이 검증이다.

---

## Global Constraints

- **전역 게이트는 권위가 아니다.** `npm run lint`(전역 `--fix`) · 전역 `jest` · 전역 `tsc` · `nest build core`(webpack module-not-found 12건)는 develop 에서도 red 인 레포 상시 debt 다. **판정은 언제나 "변경 전 대비 신규 오류 0"** 이며, 필요하면 변경 전 기준선을 먼저 캡처해 비교한다.
- **core 타입 게이트는 `npm run type-check:scoped`** (`tsc -p tsconfig.spec-scope.json --noEmit`). 이 파일의 `include` 에 삭제 대상 경로가 들어있다(Task 4 에서 함께 지운다).
- **`grep -a` 를 반드시 쓴다.** 이 이니셔티브의 스펙 파일은 UTF-8 이지만 grep 이 binary 로 판정해, `-a` 없이는 **조용히 0건**을 돌려준다(2026-08-03 실측). 잔여 참조 검사에서 `-a` 를 빠뜨리면 "깨끗함"이 거짓으로 나온다.
- **마이그레이션은 손으로 쓰지 않는다.** `npm run db:generate:core -- --name <kebab-description>` 로 생성하고 산출 SQL 을 눈으로 검토한다. 잘못 나오면 `git rm` 후 `schema.ts` 를 고쳐 재생성한다(CLAUDE.md).
- **마이그레이션 파일은 `schema.ts` 변경과 같은 커밋에 넣는다** — 쪼개면 다른 사람 체크아웃이 어긋난다(CLAUDE.md). 이 계획은 그래서 Task 5(스키마)와 Task 6(마이그레이션)을 **한 커밋**으로 합친다.
- **DB 가 필요한 검증이 둘 있다** — Task 1 과 Task 6 의 통합 스위트. ⚠️ **`npm run test:bulk-session:integration` 을 그냥 부르면 안 된다.** 그 스크립트는 `dotenv -e apps/core/.env` 로 `DATABASE_URL` 을 `dev_core` 로 채우는데, `dev_core` 에는 2~5단계 테이블이 없어 스위트가 **행이 아니라 무한정 멈춘다**(2026-08-03 실측: CPU 3초/경과 14분, DB 백엔드 2개가 `ClientRead` 대기). `bulk-session-publish.integration.spec.ts:91` 의 가드가 `bulk_stage<N>_scratch` 가 아닌 DATABASE_URL 을 거부하도록 되어 있는 것이 그 근거다. **반드시 이렇게 부른다:**

  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bulk_stage6_scratch npm run test:bulk-session:integration
  ```

  앞에 붙인 환경변수가 `dotenv -e` 를 이긴다(실측 확인). `bulk_stage6_scratch` 는 core 마이그레이션이 전부 올라간 138테이블짜리 전용 DB 로 이미 존재한다. 연결이 안 되면 그 스텝을 건너뛰지 말고 **막혔다고 보고**한다.
- 커밋 메시지는 한국어. 기존 이니셔티브 커밋과 같은 형식(`refactor(bulk-session): …`).
- **배포 순서는 `deploy` → `migrate`** 다(§11.5). 이 브랜치는 배포하지 않지만, PR 설명에 이 순서와 §11.5 체크리스트를 그대로 옮긴다.

---

## File Structure

**Task 1 — 위생 (수정 3파일)**

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts` | 세션 HTTP 경계 | `approve`·`cancel` 에 404 `@ApiResponse` 추가 |
| `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts` | DI 배선 회귀 | 낡은 의존성 개수 주석 정정 |
| `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts` | 발행 레인 통합 | `afterAll` 에 `try/finally`, 하드코딩 `variantCode` → `randomUUID` |

**Task 2 — admin-web 제거 (삭제 15 · 수정 8)**

| 파일 | 처리 |
|---|---|
| `apps/admin-web/src/app/(admin)/mall/product-imports/**` (3) | 삭제 |
| `apps/admin-web/src/features/mall/product-imports/**` (8) | 삭제 |
| `apps/admin-web/src/lib/api/domains/products/product-import.client.ts` | 삭제 |
| `apps/admin-web/src/lib/types/dto/product-import.ts` | 삭제 |
| `apps/admin-web/src/lib/services/products/import-progress.ts` · `import-progress.spec.ts` | 삭제 |
| `apps/admin-web/src/lib/api/domains/products/index.ts` | 3줄 제거 |
| `apps/admin-web/src/lib/services/products/query-keys.ts` · `query-keys.spec.ts` | 블록 제거 |
| `apps/admin-web/src/lib/services/products/queries.ts` · `queries.spec.ts` | 블록 + `isProgressRunning` import 제거 |
| `apps/admin-web/src/lib/services/products/mutations.ts` | 블록 제거 |
| `apps/admin-web/src/lib/utils/menu.ts` · `components/common/breadcrumb-items.ts` | 항목 1개씩 제거 |

**Task 3 — core 배선 제거 (수정 3파일)**: `catalog.module.ts` · `apps/core/src/config/env.validation.ts` · `package.json`

**Task 4 — core 본체 제거 (삭제 46파일 · 수정 1)**: `apps/core/src/modules/catalog/operations/import/` 전체 · `tsconfig.spec-scope.json`

**Task 5 — 스키마 + 마이그레이션 (수정 1 · 생성 1)**: `apps/core/src/modules/catalog/schema/catalog.schema.ts` · `apps/core/drizzle/<timestamp>_remove-product-import-tables.sql`(+ `drizzle/meta/`)

**Task 6 — 최종 검증 (변경 없음)**: 잔여 참조 grep · 양쪽 타입 게이트 · DB 붙인 통합 스위트 · PR 본문 · 스펙 부록 E

삭제 커밋 4개(Task 2~5)가 커밋 메시지의 `6단계 1/4`~`4/4` 에 대응한다. Task 1(위생)과 Task 6(검증·부록)은 그 번호 밖이다.

---

### Task 1: 저비용 위생 4건

§11.6 이 이번 PR 범위로 합의한 넷이다. **삭제와 무관하므로 먼저 끝낸다** — 뒤 태스크가 되돌려지더라도 이 커밋은 살아남고, 파괴적 마이그레이션이 든 커밋에 동작 변경이 섞이지 않는다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts:150-165`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts:110-111`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts:191-257, 881-914`

**Interfaces:**
- Consumes: 없음 (기존 코드만 손댄다)
- Produces: 없음 (뒤 태스크가 이 변경에 의존하지 않는다)

- [ ] **Step 1: `approve`·`cancel` 라우트에 404 문서를 단다**

`bulk-session.controller.ts` 의 두 라우트만 404 `@ApiResponse` 가 없다 — 이웃한 `publish`·`retry-draft`·`exclude`·`purge-drafts` 는 전부 갖고 있다. 매니저는 세션이 없거나 내 것이 아니면 `NotFoundError` 를 던지고 `GlobalExceptionFilter` 가 404 로 옮기므로, 지금 Swagger 가 실제 응답과 불일치한다.

`@Post(':id/approve')` 블록에서 `@ApiResponse({ status: 409, … })` **바로 앞**에 한 줄 넣는다:

```typescript
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '검증 결과 승인. review → awaiting_images 또는 drafting.' })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })
  @ApiResponse({ status: 409, description: '미결정 충돌이 있거나 review 단계가 아님' })
```

`@Post(':id/cancel')` 블록도 같은 자리에 같은 줄을 넣는다:

```typescript
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '세션 취소. 진행 중 phase → canceled. failed 도 취소 대상이다.' })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })
  @ApiResponse({ status: 409, description: '이미 종료된 세션(published·canceled)' })
```

⚠️ 위 두 블록의 `@ApiOperation`·`@HttpCode` 는 **현재 파일에 이미 있는 줄이다.** 그대로 두고 `404` 줄만 삽입한다. 문구는 이웃 라우트와 **글자 하나까지 동일**해야 한다(`'세션이 없거나 내 것이 아님'`).

- [ ] **Step 2: 낡은 의존성 개수 주석을 정정한다**

`bulk-session.module.spec.ts:110-111` 의 주석은 2단계(`bbeef8443`)에 쓰였을 때는 사실이었지만, `BulkSessionManager` 생성자는 5단계 이후 `db, fileClient, reader, versions, masters` **5개**다.

찾을 것:

```typescript
    // { strict: false } 로 컨테이너 전체에서 찾는다. BulkSessionManager 가 해석된다는 건
    // 그 생성자가 받는 DbService<PimSchema>/FormExportFileClient 2개 의존성도 함께
    // 실제로 해석됐다는 뜻이다.
```

바꿀 것:

```typescript
    // { strict: false } 로 컨테이너 전체에서 찾는다. BulkSessionManager 가 해석된다는 건
    // 그 생성자가 받는 DbService<PimSchema>/FormExportFileClient/BulkSessionReader/
    // ProductVersionsService/ProductMastersService 5개 의존성도 함께 실제로 해석됐다는
    // 뜻이다(5단계 Task 6 이 정리·발행 경로를 붙이며 3개가 늘었다).
```

- [ ] **Step 3: 정정한 개수가 실제와 맞는지 생성자로 확인한다**

Run:
```bash
grep -a -A 12 "constructor(" apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts | head -20
```
Expected: 주입 파라미터가 정확히 5개. **다르면 주석을 실제 개수·실제 타입명으로 고친다** — 이 스텝의 목적이 "또 낡은 주석을 쓰지 않는 것"이다.

- [ ] **Step 4: 통합 스위트 `afterAll` 을 `try/finally` 로 감싼다**

지금은 정리 쿼리가 던지면 `await moduleRef?.close()` 에 도달하지 못해 Nest 풀이 안 닫히고 행·워커가 잔존한다.

`bulk-session-publish.integration.spec.ts` 의 `afterAll` 을 이 모양으로 만든다 — **본문(`if (db) { … }` 안쪽)은 한 글자도 바꾸지 않고** 감싸기만 한다:

```typescript
  afterAll(async () => {
    try {
      if (db) {
        // ── 기존 본문 전체를 그대로 둔다 (sessionIds 수집 → masterIds → variantIds/
        //    pricingRuleIds → delete 트랜잭션까지) ──
      }
    } finally {
      await moduleRef?.close();
    }
  });
```

- [ ] **Step 5: 하드코딩 `variantCode` 픽스처를 유일하게 만든다**

케이스 7(품목코드 중복 사전검사)의 `'DUP-CODE-1'`·`'SELF-CODE-1'` 은 상수라, 중단된 실행이 scratch DB 에 행을 남기면 다음 실행이 조용히 오염된다.

`randomUUID` 는 이 파일이 **이미 import 하고 있다**(`seedActiveProduct` 가 쓴다) — 새 import 가 필요 없다. 케이스 7 의 `it` 본문 맨 위에 접미사를 만들고 네 자리에 끼운다:

```typescript
    const suffix = randomUUID().slice(0, 8);
    const dupCode = `DUP-CODE-${suffix}`;
    const selfCode = `SELF-CODE-${suffix}`;
```

그리고 `'DUP-CODE-1'` 두 곳(`:881` 의 `seedActiveProduct({ … variantCode })` 와 `:889` 의 `'variant:.variantCode'` 값)을 `dupCode` 로, `'SELF-CODE-1'` 두 곳(`:905`·`:914`)을 `selfCode` 로 바꾼다.

⚠️ **같은 `it` 안에서 두 값이 짝을 이뤄야 한다** — `:881` 이 심은 코드와 `:889` 가 업로드하는 코드가 같아야 "다른 상품이 이미 쓰는 코드"라는 중복 조건이 성립하고, `:905`·`:914` 는 같은 세션 안 자기 중복 조건이다. 접미사를 각각 따로 만들면 케이스가 무력해진다.

- [ ] **Step 6: 타입 게이트를 돌린다**

Run: `npm run type-check:scoped`
Expected: 변경 전과 동일한 출력(신규 오류 0). 기준선이 불확실하면 `git stash push -u -m "stage6-t1-baseline"` 로 잠시 치우고 한 번 돌려 비교한 뒤 **`git stash list --format='%H %gs'` 로 SHA 를 잡아 `git stash apply <sha>`** 로 되돌린다(bare `git stash pop` 금지 — 스택이 다른 워크트리와 공유된다).

- [ ] **Step 7: 단위 스펙을 돌린다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts`
Expected: PASS. (주석만 고쳤으므로 동작 변화가 없어야 한다.)

- [ ] **Step 8: 통합 스위트를 실제 DB 로 돌린다**

Run:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bulk_stage6_scratch npm run test:bulk-session:integration
```
Expected: 5스위트 47건 PASS. 특히 케이스 7(품목코드 중복 사전검사)이 초록이어야 `randomUUID` 치환이 짝을 안 깼다는 뜻이다.

⚠️ `DATABASE_URL=` 접두를 빼면 `dev_core` 로 붙어 **멈춘다**(Global Constraints 참조).

`DATABASE_URL` 이 없어 스킵되면 **초록으로 보고하지 말고 막혔다고 보고한다** — `describeIfDb` 가 스킵을 초록으로 표시한다.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts
git commit -m "$(cat <<'EOF'
fix(bulk-session): 5단계가 남긴 저비용 위생 4건

- approve·cancel 라우트의 404 Swagger 문서 누락 (부록 D.1#8)
- bulk-session.module.spec.ts 의 BulkSessionManager 의존성 개수 주석 2→5
- 통합 afterAll 에 try/finally — 정리 실패가 Nest 풀을 안 닫던 것
- 통합 케이스 7 의 하드코딩 variantCode → randomUUID 접미사
EOF
)"
```

---

### Task 2: admin-web 의 옛 임포트 제거 (소비자 계층)

§11.3 의 첫 계층. 화면·훅·클라이언트·타입·메뉴를 전부 걷는다. **이 커밋 뒤 admin-web 은 `/product-imports` 를 한 번도 부르지 않는다.**

**Files:**
- Delete: `apps/admin-web/src/app/(admin)/mall/product-imports/` (3파일)
- Delete: `apps/admin-web/src/features/mall/product-imports/` (8파일)
- Delete: `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`
- Delete: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Delete: `apps/admin-web/src/lib/services/products/import-progress.ts`
- Delete: `apps/admin-web/src/lib/services/products/import-progress.spec.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/index.ts:14,34,52`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts:166-176`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.spec.ts:21-42`
- Modify: `apps/admin-web/src/lib/services/products/queries.ts:8,638-683`
- Modify: `apps/admin-web/src/lib/services/products/queries.spec.ts:4,18`
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts:1023-1074`
- Modify: `apps/admin-web/src/lib/utils/menu.ts:242-246`
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.ts:14`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 — core 태스크들은 admin-web 을 참조하지 않는다. 순서만 계약이다(소비자가 먼저 죽는다).

- [ ] **Step 1: 화면·피처·클라이언트·타입 디렉터리를 지운다**

```bash
git rm -r apps/admin-web/src/app/\(admin\)/mall/product-imports
git rm -r apps/admin-web/src/features/mall/product-imports
git rm apps/admin-web/src/lib/api/domains/products/product-import.client.ts
git rm apps/admin-web/src/lib/types/dto/product-import.ts
git rm apps/admin-web/src/lib/services/products/import-progress.ts
git rm apps/admin-web/src/lib/services/products/import-progress.spec.ts
```

- [ ] **Step 2: `domains/products/index.ts` 배선 3줄을 지운다**

세 줄 전부 제거한다 — `import { productImportClient } from './product-import.client';`(:14), 객체 속 `productImport: productImportClient,`(:34), 재수출 `export { productImportClient } from './product-import.client';`(:52).

- [ ] **Step 3: 쿼리 키를 지운다**

`query-keys.ts` 에서 `// 대량등록(엑셀 임포트) 관련` 주석부터 `productImportProgress` 정의 끝까지(`:166-176`)를 통째로 지운다. 그 **아래** `// 프리필 양식(대량등록 재출력) 관련` 의 `formExports`·`formExport` 는 **새 세션(1단계) 자산이므로 남긴다.** 이름이 비슷해 실수하기 쉽다 — `product-forms` 를 가리키는 것이 남길 것이다.

`query-keys.spec.ts` 에서는 `describe('productImports query keys', …)` 블록 전체를 지운다.

- [ ] **Step 4: 쿼리 훅을 지운다**

`queries.ts` 에서 `// ===== 대량등록(엑셀 임포트) 쿼리 =====`(:638) 부터 **파일 끝까지**(:683) 지운다 — `useImportSessions`·`useImportSession`·`useImportProgress` 셋이 이 블록의 전부이고 뒤에 다른 내용이 없다.

같은 파일 상단의 `import { isProgressRunning } from './import-progress';`(:8) 도 지운다 — `import-progress.ts` 를 Step 1 에서 삭제했으므로 남기면 모듈 해석이 깨진다.

`queries.spec.ts` 에서는 `import type { ImportJobStatus, ImportProgressDto } from '@/lib/types/dto/product-import';`(:4) 와 목 객체의 `productImport: { … }` 항목(:18 부근)을 지운다. 그 스펙에 임포트 훅 전용 `describe` 가 있으면 함께 지운다.

- [ ] **Step 5: 뮤테이션을 지운다**

`mutations.ts` 에서 `// ===== 대량등록(엑셀 임포트) 뮤테이션 =====`(:1023) 부터 **파일 끝까지**(:1074) 지운다 — `useValidateImport`·`useCommitImport`·`usePublishSession`·`useCancelSession` 넷이다.

⚠️ `usePublishSession`·`useCancelSession` 은 이름이 새 세션 것처럼 보이지만 **`products.productImport.*` 를 부르는 옛 것**이다. 새 세션에는 아직 admin-web 훅이 없다(화면 단계 미착수).

- [ ] **Step 6: 메뉴와 브레드크럼에서 뺀다**

`menu.ts:242-246` 의 항목 객체를 지운다:

```typescript
      {
        id: 'product-imports',
        title: '엑셀 대량등록',
        path: '/mall/product-imports',
      },
```

`breadcrumb-items.ts:14` 의 한 줄을 지운다:

```typescript
  { prefix: '/mall/product-imports', label: '엑셀 대량등록' },
```

- [ ] **Step 7: 잔여 참조가 0인지 확인한다**

Run:
```bash
grep -arn "productImport\|product-import" apps/admin-web/src
```
Expected: **출력 없음.** 남으면 그 파일을 마저 정리한다. (`-a` 필수 — Global Constraints 참조.)

- [ ] **Step 8: admin-web 타입 게이트를 돌린다**

Run: `cd apps/admin-web && npm run type-check`
Expected: 변경 전과 동일한 출력(신규 오류 0). admin-web `type-check` 는 레포 상시 debt 라 **초록이 아닐 수 있다** — 반드시 기준선과 비교한다. `product-import` 를 언급하는 오류가 하나라도 새로 뜨면 Step 7 이 놓친 참조다.

- [ ] **Step 9: admin-web 단위 테스트를 돌린다**

Run: `npm run test:admin-web`
Expected: 변경 전 대비 신규 실패 0. 삭제한 두 스펙(`import-progress.spec.ts`, `query-keys.spec.ts` 의 한 describe)만큼 **통과 건수가 줄어드는 것은 정상**이다.

- [ ] **Step 10: 커밋**

```bash
git add -A apps/admin-web
git commit -m "$(cat <<'EOF'
refactor(admin-web): 옛 엑셀 대량등록 화면 제거 (6단계 1/4)

/mall/product-imports 위저드·세션 목록·상세와 그 훅·클라이언트·타입·메뉴를
전부 걷는다. 이 커밋 뒤 admin-web 은 /product-imports 를 부르지 않는다.

1단계 산출물인 "양식 다운로드"(products.formExport, /product-forms)는 새 세션
자산이라 남긴다 — query-keys 의 formExports 가 그것이다.
EOF
)"
```

---

### Task 3: core 배선 제거

옛 임포트 모듈을 앱에서 떼어낸다. **파일은 아직 지우지 않는다** — 이 커밋의 목적은 "core 안에서 이 모듈을 참조하는 곳이 정말 배선 한 곳뿐인가"를 컴파일러로 확인하는 것이다.

**Files:**
- Modify: `apps/core/src/modules/catalog/catalog.module.ts:17,44`
- Modify: `apps/core/src/config/env.validation.ts:65-69`
- Modify: `package.json:71-73`

**Interfaces:**
- Consumes: 없음
- Produces: 없음. Task 4 가 이 커밋 뒤 고아가 된 디렉터리를 지운다.

- [ ] **Step 1: 삭제 전 기준선을 잡는다**

Run:
```bash
npm run type-check:scoped 2>&1 | tail -5
```
Expected: 이 출력을 적어둔다. Task 3~5 의 판정이 전부 이것과의 차분이다.

- [ ] **Step 2: `catalog.module.ts` 에서 모듈을 뗀다**

두 줄을 지운다 — `:17` 의 `import { ProductImportModule } from './operations/import/product-import.module';` 와 `:44` 의 `imports` 배열 항목 `ProductImportModule,`.

`// Operations` 주석 아래 이웃(`ApprovalModule`·`BulkModule`·`ProductExportModule`·`AuditModule`·`BulkSessionModule`)은 그대로 둔다.

- [ ] **Step 3: env 선언 4개를 지운다**

`env.validation.ts:65-69` 의 주석 한 줄과 변수 넷을 함께 지운다:

```typescript
    // 대량등록 비동기 잡 워커 (3단계)
    PRODUCT_IMPORT_WORKER_ENABLED: z.enum(['true', 'false']).optional(),
    PRODUCT_IMPORT_COMMIT_SLICE: z.string().regex(/^\d+$/).optional(),
    PRODUCT_IMPORT_PUBLISH_SLICE: z.string().regex(/^\d+$/).optional(),
    PRODUCT_IMPORT_LEASE_MS: z.string().regex(/^\d+$/).optional(),
```

⚠️ 바로 아래 `// OpenTelemetry` 블록과 위 `WALLET_*` 는 건드리지 않는다. **`PRODUCT_BULK_*` 는 새 세션 것이므로 절대 지우지 않는다** — 이 파일에 있다면 그대로 둔다.

넷 다 `.optional()` 이라, 라이브 환경변수에 값이 남아 있어도 이 삭제로 부팅이 깨지지 않는다.

- [ ] **Step 4: `package.json` 의 통합 테스트 스크립트 3개를 지운다**

`test:product-import-lease:integration`(:71) · `test:product-import-progress:integration`(:72) · `test:product-import-payload:integration`(:73) 세 줄을 지운다.

⚠️ 바로 아래 `test:form-export:integration` · `test:bulk-session:integration` 은 **새 세션 것이므로 남긴다.** 바로 위 `test:variant-preview:integration` 도 무관하니 남긴다.

- [ ] **Step 5: JSON 이 유효한지 확인한다**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok` (쉼표를 잘못 지우면 여기서 걸린다)

- [ ] **Step 6: 타입 게이트로 차분을 본다**

Run: `npm run type-check:scoped 2>&1 | tail -5`
Expected: Step 1 의 기준선과 동일. `tsconfig.spec-scope.json` 이 아직 `operations/import/**` 를 포함하므로 그 파일들은 계속 컴파일되며, **`ProductImportModule` 을 못 찾는다는 오류가 새로 뜨면 안 된다**(배선만 뗐지 파일은 그대로다).

- [ ] **Step 7: core 부팅 스펙을 돌린다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts`
Expected: PASS. 새 세션 모듈의 DI 가 옛 모듈 제거에 영향받지 않음을 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/catalog.module.ts apps/core/src/config/env.validation.ts package.json
git commit -m "$(cat <<'EOF'
refactor(core): 옛 임포트 모듈 배선 해제 (6단계 2/4)

CatalogModule 에서 ProductImportModule 을 떼고, 그 워커 전용 env 선언 4개와
통합 테스트 스크립트 3개를 지운다. 파일 본체는 다음 커밋이 지운다 — 이 커밋은
"core 안의 참조가 정말 배선 한 곳뿐인가"를 컴파일러로 확인하는 자리다.

env 넷은 전부 optional 이라 라이브에 값이 남아 있어도 부팅이 깨지지 않는다.
EOF
)"
```

---

### Task 4: core 본체 제거

§11.2 의 46파일 / 약 10,070줄을 지운다.

**Files:**
- Delete: `apps/core/src/modules/catalog/operations/import/` 전체
- Modify: `tsconfig.spec-scope.json:7`

**Interfaces:**
- Consumes: Task 3 이 배선을 뗀 상태여야 한다 — 안 뗀 채로 지우면 `catalog.module.ts` 가 없는 모듈을 import 한다
- Produces: 없음. Task 5 가 남은 스키마를 지운다.

- [ ] **Step 1: 디렉터리를 통째로 지운다**

```bash
git rm -r apps/core/src/modules/catalog/operations/import
```
Expected: 46개 파일이 삭제로 스테이징된다.

- [ ] **Step 2: 삭제 파일 수를 확인한다**

Run: `git diff --cached --stat | tail -1`
Expected: 46 files changed 부근, 약 10,070줄 삭제. 크게 다르면 잘못된 경로를 지웠는지 확인한다.

- [ ] **Step 3: `tsconfig.spec-scope.json` 의 죽은 include 를 지운다**

`:7` 의 한 줄을 지운다:

```json
    "apps/core/src/modules/catalog/operations/import/**/*.ts",
```

남는 5개 항목(`bulk-session/**`, `product-versions.service.spec.ts`, channel-adapter 3건)은 그대로 두고, **JSON 배열의 쉼표가 유효한지** 확인한다(첫 항목을 지우므로 뒤 항목이 새 첫 줄이 된다).

이 줄을 남기면 `type-check:scoped` 의 include 가 아무것도 매칭하지 않는 패턴을 계속 들고 있게 된다 — 지금은 다른 패턴이 파일을 찾아 오류가 안 나지만 죽은 설정이다.

- [ ] **Step 4: JSON 이 유효한지 확인한다**

Run: `node -e "JSON.parse(require('fs').readFileSync('tsconfig.spec-scope.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: 잔여 참조가 0인지 확인한다**

Run:
```bash
grep -arn "operations/import\|ProductImportModule\|ProductImportService" apps/ libs/ scripts/ packages/ 2>/dev/null | grep -v node_modules
```
Expected: **출력 없음.**

주의: `product-import` 문자열 자체는 `bulk-session` 의 **주석**에 17개 파일에 걸쳐 남아 있고 이는 정상이다(§11.2 — 이식 출처를 적은 것). 위 grep 은 **코드 결합**만 노린 패턴이라 주석에 걸리지 않아야 한다. 걸린다면 그건 진짜 잔여 참조다.

- [ ] **Step 6: 타입 게이트로 차분을 본다**

Run: `npm run type-check:scoped 2>&1 | tail -5`
Expected: Task 3 Step 1 의 기준선과 동일하거나 **오류가 줄어든다**(삭제된 파일이 내던 오류가 사라진다). 신규 오류는 0이어야 한다.

- [ ] **Step 7: 새 세션 단위 스펙 전량을 돌린다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session`
Expected: 변경 전과 동일한 통과 건수. 옛 모듈 삭제가 새 세션에 아무 영향이 없어야 한다 — §11.2 의 "코드 결합 0" 주장이 여기서 증명된다.

- [ ] **Step 8: 커밋**

```bash
git add -A apps/core/src/modules/catalog/operations tsconfig.spec-scope.json
git commit -m "$(cat <<'EOF'
refactor(core): 옛 임포트 구현 46파일 제거 (6단계 3/4)

operations/import/ 전체(약 10,070줄)와 tsconfig.spec-scope.json 의 죽은
include 를 지운다. bulk-session 단위 스펙 전량이 그대로 초록인 것이
"두 모듈의 코드 결합은 0이고 언급은 전부 이식 출처 주석"이라는 §11.2 의
주장을 증명한다.
EOF
)"
```

---

### Task 5: 스키마 제거 + DROP 마이그레이션

CLAUDE.md 가 `schema.ts` 변경과 생성 SQL 을 **한 커밋**에 넣으라고 요구하므로 둘을 합친다.

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts` (섹션 1개 + export 3줄)
- Create: `apps/core/drizzle/<timestamp>_remove-product-import-tables.sql` (+ `apps/core/drizzle/meta/`)

**Interfaces:**
- Consumes: Task 4 가 끝나 있어야 한다 — 테이블을 참조하는 코드가 남은 채로 지우면 타입 오류가 쏟아진다
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: 스키마 섹션을 통째로 지운다**

`catalog.schema.ts` 의 `// ===== PRODUCT IMPORT (엑셀 대량등록 세션) =====`(:1083) 부터 `productImportImages` 테이블 정의가 끝나는 `);`(:1303) 까지를 지운다. 그 안에 있는 것:

- enum 6: `productImportSessionStatusEnum` · `productImportItemStatusEnum` · `productImportJobStatusEnum` · `productImportItemPublishStatusEnum` · `productImportImageStatusEnum` · `productImportImageUsageEnum`
- 테이블 3: `productImportSessions` · `productImportItems` · `productImportImages`

⚠️ **경계를 정확히 잡는다.** 바로 **위**는 `productFormExportItems` 의 닫는 `);`(1단계 자산), 바로 **아래**는 `// ===== PRODUCT BULK SESSIONS (일괄 세션 2단계 — 업로드·검증) =====`(2단계 자산)다. 둘 다 새 세션 것이므로 절대 건드리지 않는다.

- [ ] **Step 2: schema export 객체에서 3줄을 지운다**

`:1499-1501` 의 세 줄을 지운다:

```typescript
  productImportSessions,
  productImportItems,
  productImportImages,
```

바로 아래 `productFormExports`·`productFormExportItems`·`productBulkSessions`·`productBulkItems`·`productBulkImages` 다섯은 **새 세션 것이므로 남긴다.**

- [ ] **Step 3: 심볼이 완전히 사라졌는지 확인한다**

Run:
```bash
grep -arn "productImport" apps/core/src/modules/catalog/schema/catalog.schema.ts
```
Expected: **출력 없음.**

- [ ] **Step 4: 타입 게이트를 돌린다**

Run: `npm run type-check:scoped 2>&1 | tail -5`
Expected: Task 3 Step 1 의 기준선 대비 신규 오류 0.

- [ ] **Step 5: 마이그레이션을 생성한다**

Run:
```bash
npm run db:generate:core -- --name remove-product-import-tables
```
Expected: `apps/core/drizzle/<timestamp>_remove-product-import-tables.sql` 이 생기고 `apps/core/drizzle/meta/` 가 갱신된다.

**손으로 SQL 을 쓰지 않는다.** drizzle-kit 이 rename 후보를 물으면(순수 삭제라 안 물어야 정상) **아무것도 rename 으로 인정하지 말고** 전부 삭제로 답한다 — rename 으로 답하면 새 세션 테이블이 옛 이름으로 바뀌는 재앙이 난다.

- [ ] **Step 6: 생성된 SQL 을 눈으로 검토한다**

Run: `cat apps/core/drizzle/*_remove-product-import-tables.sql`

Expected — 다음 9개만 있어야 한다:

```sql
DROP TABLE "product_import_images" CASCADE;
DROP TABLE "product_import_items" CASCADE;
DROP TABLE "product_import_sessions" CASCADE;
DROP TYPE "public"."product_import_image_status";
DROP TYPE "public"."product_import_image_usage";
DROP TYPE "public"."product_import_item_publish_status";
DROP TYPE "public"."product_import_item_status";
DROP TYPE "public"."product_import_job_status";
DROP TYPE "public"."product_import_session_status";
```

**`product_bulk_*` · `product_form_export*` 를 건드리는 문장이 하나라도 있으면 즉시 멈춘다.** `git rm` 으로 생성물을 지우고 `schema.ts` 의 삭제 경계(Step 1)를 다시 확인한 뒤 재생성한다. 문장 순서·`CASCADE` 유무는 drizzle-kit 판단에 맡기되, **위 목록 밖의 테이블/타입이 등장하는 것만은 절대 허용하지 않는다.**

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle
git commit -m "$(cat <<'EOF'
refactor(core)!: product_import_* 테이블 3·enum 6 제거 (6단계 4/4)

catalog.schema.ts 의 PRODUCT IMPORT 섹션과 schema export 3줄을 지우고
DROP 마이그레이션을 생성한다.

BREAKING: 파괴적 마이그레이션이다. 배포 순서는 contract phase 규약대로
deploy → migrate 이고, migrate 전에 SELECT count(*) FROM product_import_sessions
가 0인지 반드시 확인한다(스펙 §11.5). 0이 아니면 DROP 을 멈추고 §11.4 표의
원안(이력 백업·고아 파일 실측·공지)으로 돌아간다.
EOF
)"
```

---

### Task 6: 최종 검증

브랜치 전체가 일관된지 확인하고 PR 본문을 만든다. 새 코드가 없으므로 **부록 C.7 의 부팅 사고**만이 이 단계에 남은 실질 위험이다.

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~5 전부
- Produces: PR 본문

- [ ] **Step 1: 레포 전역 잔여 참조를 세 패턴으로 훑는다**

Run:
```bash
grep -arn "product_import" apps/ libs/ scripts/ packages/ 2>/dev/null | grep -v node_modules
grep -arn "ProductImport" apps/ libs/ scripts/ packages/ 2>/dev/null | grep -v node_modules
grep -arn "product-import" apps/ libs/ scripts/ packages/ 2>/dev/null | grep -v node_modules
```

Expected:
- 첫째: 마이그레이션 SQL(옛 4건 + 새 DROP 1건)에만 등장. `apps/core/drizzle/` 밖에 있으면 잔여 참조다
- 둘째: **출력 없음**
- 셋째: `bulk-session` 의 이식 출처 주석만(Step 2 가 그것을 따로 검사한다). `import`/`require` 문이 하나라도 있으면 잔여 결합이다

⚠️ **세 번째 패턴이 `product-imports`(복수) 가 아니라 `product-import`(단수) 인 것은 실측으로 얻은 교훈이다.** Task 4 가 `bulk-session.structure.ts:1` 에서 `'../../import/services/product-import-image.directive'` 를 import 하는 진짜 결합을 발견했는데, 착수 전 조사가 쓴 경로 패턴(`operations/import`)에도 복수형 패턴에도 안 걸렸다(스펙 §11.2 정정). **결합의 권위 있는 계수기는 grep 이 아니라 삭제 후 타입 체크다** — 이 결합도 `type-check:scoped` 가 잡았다. Step 3 을 grep 보다 신뢰한다.

`apps/core/drizzle/2026071*`·`2026072*`·`2026073*` 의 옛 마이그레이션은 **지우지 않는다** — 적용 이력이라 삭제하면 `drizzle/meta` 와 어긋난다.

- [ ] **Step 2: `product-import` 언급이 주석뿐인지 확인한다**

Run:
```bash
grep -arn "product-import" apps/core/src/modules/catalog/operations/bulk-session/
```
Expected: 17개 파일의 주석 줄만. 각 줄이 `*` 또는 `//` 로 시작해야 한다. **코드 줄이 하나라도 있으면 잔여 결합이다.**

이 주석들은 그대로 둔다 — 이식 출처 기록이고, 여러 주석이 "6단계가 그 파일을 지운다"고 예고하므로 이제 사실이 됐다.

- [ ] **Step 3: core 타입 게이트 최종 확인**

Run: `npm run type-check:scoped 2>&1 | tail -5`
Expected: Task 3 Step 1 기준선 대비 신규 오류 0.

- [ ] **Step 4: admin-web 타입 게이트 최종 확인**

Run: `cd apps/admin-web && npm run type-check 2>&1 | tail -5`
Expected: Task 2 Step 8 에서 잡은 기준선과 동일.

- [ ] **Step 5: 새 세션 단위 스펙 전량**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session`
Expected: 변경 전과 동일한 통과 건수.

- [ ] **Step 6: DB 붙인 통합 스위트 1회 — 이 태스크의 핵심**

Run:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bulk_stage6_scratch npm run test:bulk-session:integration
```
Expected: 5스위트 47건 PASS. `DATABASE_URL=` 접두를 빼면 `dev_core` 로 붙어 멈춘다(Global Constraints).

**왜 필수인가:** 부록 C.7 이 4단계에서 겪은 사고는 정적 임포트가 통합 스위트를 **부팅 단계에서** 죽인 것이었고, `describeIfDb` 는 그런 실패를 스킵(초록)으로 감춘다. 임포트가 *사라지는* 이번 변경도 같은 종류의 모듈 해석 사고를 낼 수 있다. §11.7 이 "§11.4 의 전제와 무관하게 남는 유일한 검증 항목"이라 부른 것이 이것이다.

`DATABASE_URL` 이 없으면 **초록으로 보고하지 말고 막혔다고 보고한다.**

- [ ] **Step 7: 커밋 5개가 계층 순인지 확인한다**

Run: `git log --oneline develop..HEAD`
Expected: 5개 커밋이 위생 → admin-web → core 배선 → core 본체 → 스키마+마이그레이션 순.

- [ ] **Step 8: PR 본문을 만든다**

`docs/superpowers/plans/` 에 파일을 더 만들지 말고 PR 설명에 직접 넣는다. 반드시 담을 것:

1. **배포 순서** — core·admin-web 배포(순서 무관) → `npm run db:migrate`. `deploy` → `migrate` 는 §11.5 의 규약이고, 어기면 롤링 중인 옛 core task 가 5초마다 `relation does not exist` 를 뿜는다(옛 워커가 `@Cron(EVERY_5_SECONDS)` 로 행이 없어도 claim 을 던진다)
2. **DROP 전 필수 확인** — `SELECT count(*) FROM product_import_sessions;` 가 0. `_items`·`_images` 는 `ON DELETE CASCADE` FK 라 이 한 줄이 셋을 다 덮는다. **0이 아니면 머지·배포를 멈추고 §11.4 원안으로 돌아간다**
3. **기능 공백** — 새 세션 화면이 나올 때까지 대량등록 UI 경로가 없다(§11.1, 사용자 결정)
4. **5단계 미배포분** — `source_file_id` nullable 마이그(§10.6)와 MD 계정 `roles` 실측(§10.7)이 아직 남아 있으면 그것부터
5. 이벤트 계약 변경 0 · 새 시크릿 0 · 새 env 0. `origin: 'bulk_import'` 는 그대로 두며 이제 유일한 bulk 경로를 가리킨다

- [ ] **Step 9: 부록 E 를 스펙에 추가한다**

부록 A~D 의 관례를 잇는다 — `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` 끝에 `# 부록 E — 6단계 구현이 실측한 사실 (2026-08-03)` 를 붙인다. **구현 중 실제로 확인한 것만** 담는다:

- §11.2 의 인벤토리가 맞았는가 (파일 수·줄 수·enum 개수)
- 생성된 DROP SQL 이 예상과 같았는가
- 통합 스위트가 부팅 사고 없이 돌았는가 (Step 6)
- 계획서가 틀렸던 곳 — 부록 A~D 가 전부 이 항목을 갖고 있고, 그것이 이 부록의 존재 이유다

```bash
git add docs/superpowers/specs/2026-07-31-product-bulk-session-design.md
git commit -m "docs(bulk-session): 6단계 구현이 실측한 사실(부록 E) 추가"
```

---

## Self-Review

**1. 스펙 §11 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §11.1 화면 단계를 안 기다린다 | Task 2 (화면 제거) · Task 6 Step 8-3 (공백 명시) |
| §11.2 제거 인벤토리 | Task 2(admin-web) · 3(배선·env·scripts) · 4(본체·tsconfig) · 5(스키마·마이그) |
| §11.3 소비자 → 제공자 순 | Task 2 → 3 → 4 → 5 순서와 각 태스크의 Interfaces 블록 |
| §11.4 미사용 전제 | Task 5 Step 7 커밋 메시지 · Task 6 Step 8-2 |
| §11.5 배포 | Task 6 Step 8-1·8-2·8-4 |
| §11.6 갭 4건 | Task 1 |
| §11.7 검증 | Task 6 Step 1~6 |

**커버리지 갭 없음.** §11.6 이 "닫지 않는다"고 적은 것들(이미지 스윕 세션 게이트, 조합 중복 검사 2건, `retry-draft` 일방통행 등)은 의도적으로 태스크가 없다.

**2. 플레이스홀더 스캔**

"TBD"·"적절히 처리"·"에러 핸들링 추가" 류 없음. 모든 코드 스텝이 실제 코드/명령/기대 출력을 담는다. Task 1 Step 4 의 `afterAll` 만 기존 본문을 `── … ──` 주석으로 축약했는데, 이는 **"본문을 한 글자도 바꾸지 말라"는 지시를 명시했으므로** 플레이스홀더가 아니라 보존 지시다.

**3. 타입·이름 일관성**

- `type-check:scoped` 는 전 태스크에서 같은 이름으로 쓰였고 `package.json:81` 에 실재
- `test:bulk-session:integration` 은 Task 1 Step 8 과 Task 6 Step 6 에서 같은 이름, `package.json` 에 실재하며 Task 3 Step 4 가 **지우지 말라고 명시**
- `randomUUID` 는 Task 1 Step 5 에서 쓰이는데, 대상 파일이 이미 import 하고 있음을 확인함(`seedActiveProduct`, `:271`)
- Task 3 이 지우는 `PRODUCT_IMPORT_*` 4개와 Task 5 가 지우는 enum 6·테이블 3 은 §11.2 인벤토리와 정확히 일치

**4. 위험 지점 재확인**

가장 위험한 스텝은 **Task 5 Step 6**(생성 SQL 검토)이다. drizzle-kit 이 삭제를 rename 으로 오해하면 새 세션 테이블이 파괴된다 — 그래서 그 스텝이 허용 문장 9개를 명시하고 "목록 밖 테이블 등장 시 즉시 중단"을 지시한다. 그 다음은 **Task 6 Step 6**(DB 통합)으로, 스킵을 초록으로 오인하지 말라는 지시를 두 곳(Task 1 Step 8·Task 6 Step 6)에 중복해 뒀다.
