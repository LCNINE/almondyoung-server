# Task 10 — 마무리 검증 보고서

Worktree: `.claude/worktrees/feat+product-bulk-session-stage1`, branch `feat/product-bulk-session-stage1`
Merge base: `beb85f1fc` (develop, 2026-08-01 03:47:09 +0900)
Branch head at time of verification: `fe27ff154`
Verification run: 2026-08-01, Node v22.23.1

Status headline: **DONE_WITH_CONCERNS**. No functional regressions found anywhere. The concerns are: (1) two admin-web ESLint findings that are real but only surface when the wrong (root) ESLint config is pointed at admin-web files — using each area's own config, zero new lint errors exist; (2) several deferred design findings from earlier tasks that are real but were already explicitly judged/deferred by the task chain; (3) Part D's ownership-check asymmetry (`getStatus` has no `requestedBy` guard) is a genuine gap worth fixing soon, not a blocker for an internal-admin-only endpoint. See Part D for the full table.

---

## Part A — test and gate evidence

### A.1 — Feature scope: `npx jest apps/core/src/modules/catalog/operations/bulk-session/`

Run without `DATABASE_URL` (3 DB-gated suites skip):

```
$ npx jest apps/core/src/modules/catalog/operations/bulk-session/
Test Suites: 3 skipped, 8 passed, 8 of 11 total
Tests:       22 skipped, 94 passed, 116 total
Time:        2.502 s
```

Re-run with the scratch DB (see A.2 setup) so all 11 suites execute, including the DB-gated `bulk-session.module.spec.ts` (DI wiring) and the two integration specs:

```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sdd_stage1_scratch" \
  npx jest apps/core/src/modules/catalog/operations/bulk-session/ --forceExit
Test Suites: 11 passed, 11 total
Tests:       116 passed, 116 total
Time:        4.24 s
```

**Result: PASS, 0 failures, 0 skips when DB is available.**

### A.2 — DB-backed suites (scratch DB, never `dev_core`)

```
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS sdd_stage1_scratch"
DROP DATABASE
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE sdd_stage1_scratch"
CREATE DATABASE
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sdd_stage1_scratch" \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
[✓] migrations applied successfully!
```

This is also the Part C evidence that the full migration chain (including this branch's new migration) applies cleanly to an empty database.

```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sdd_stage1_scratch" npm run test:form-export:integration
PASS apps/core/src/modules/catalog/operations/bulk-session/services/form-export-snapshot.integration.spec.ts
PASS apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job-lease.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       21 passed, 21 total
```

Post-run check confirms rollback-only isolation, `dev_core` never touched:

```
$ docker exec almondyoung-server-postgres-1 psql -U postgres -d sdd_stage1_scratch -c "SELECT count(*) FROM product_form_exports;" -c "SELECT count(*) FROM product_masters;"
 count            count
-------          -------
     0                0
```

**Result: PASS, 21/21 integration tests, 0 failures.**

### A.3 — Neighbouring module: `npx jest apps/core/src/modules/catalog/operations/import/`

```
$ npx jest apps/core/src/modules/catalog/operations/import/
Test Suites: 4 skipped, 18 passed, 18 of 22 total
Tests:       34 skipped, 340 passed, 374 total
Time:        5.143 s
```

(4 skipped are the same class of DB-gated integration specs, unaffected by this task — not run here since the brief didn't ask for a DB-backed pass of the neighbour module and Part B's differential separately covers it.)

**Result: PASS, 0 failures. No regression in the sibling import module.**

### A.4 — `npm run type-check:scoped`

```
$ npm run type-check:scoped
> tsc -p tsconfig.spec-scope.json --noEmit
(exit 0, no output)
```

Confirmed `tsconfig.spec-scope.json` includes `apps/core/src/modules/catalog/operations/bulk-session/**/*.ts` (this was a real gap Task 5 found and fixed retroactively — re-verified still present and the check is non-vacuous today).

**Result: PASS, exit 0.**

### A.5 — `cd apps/admin-web && npx tsc --noEmit`

```
$ cd apps/admin-web && npx tsc --noEmit
(exit 0, no output)
```

**Result: PASS, exit 0.**

### A.6 — admin-web tests for touched areas

The brief's literal command `cd apps/admin-web && npx jest src/lib/services/products/form-export.spec.ts` **fails** — not because of a code defect, but because `apps/admin-web` has no local Jest config or `jest`/`ts-jest` devDependency of its own (its `package.json` has no `jest` key and no test script). Run that way, `npx jest` resolves the hoisted root binary but finds no config in that directory, falls back to Jest's default (no TypeScript transform), and the `.spec.ts` file fails to parse (`SyntaxError: ... Unexpected token` on `as never`).

The repository's actual sanctioned invocation is the root `test:admin-web` script (`package.json`), which supplies the `ts-jest` transform + `apps/admin-web/tsconfig.jest.json`:

```
$ npx jest --roots ./apps/admin-web --transform '{"^.+\\.(t|j)s$":["ts-jest",{"tsconfig":"apps/admin-web/tsconfig.jest.json"}]}' --testPathPattern='(form-export|request-guard)\.spec\.ts'
PASS apps/admin-web/src/lib/services/products/form-export.spec.ts
PASS apps/admin-web/src/features/mall/products-list/components/form-export-modal/request-guard.spec.ts
Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
```

Both admin-web spec files this branch added (`form-export.spec.ts`, `request-guard.spec.ts`) pass, 10/10 tests.

**Result: PASS via the correct invocation. Brief's literal command does not work in this repo layout — documented above so the next person doesn't waste time on it.**

### A.7 — ESLint on every file this branch added or changed under `apps/`

File list derived from `git diff --name-only beb85f1fc..HEAD -- apps/` (42 `.ts`/`.tsx` files: 10 admin-web, 32 core/file-service).

**core + file-service files, root ESLint config** (the correct config for these paths):

```
$ npx eslint <32 core/file-service files>
apps/core/src/modules/catalog/schema/catalog.schema.ts
   19:10  error  'eq' is defined but never used
  351:4   error  'table' is defined but never used

apps/file-service/src/database/default-file-contexts.ts
  28:5   error  Unsafe return of a value of type `any[]`
  33:13  error  Unsafe assignment of an `any` value
  34:7   error  Unsafe return of a value of type `any[]`

✖ 5 problems (5 errors, 0 warnings)
```

Traced both files' flagged lines against `git diff beb85f1fc..HEAD`:
- `catalog.schema.ts:19` (`import { eq, sql } from 'drizzle-orm'`, `eq` unused) and `:351` (`(table) =>` in an unrelated pre-existing `pgTable` third-arg callback) are **byte-identical between `beb85f1fc` and HEAD** — this branch only appended new table definitions later in the file; it did not touch these lines. Pre-existing debt.
- `default-file-contexts.ts:28,33,34` are inside `normalizeAllowedMimeTypes()` (lines 26–41), also untouched by this branch's diff — the branch only appended one new `FileContextSeed` object literal at line 150. Pre-existing debt.

**admin-web files, root ESLint config** (wrong config for this path — included here only to show why it's wrong): produced 2 more findings — `react-hooks/exhaustive-deps` "rule not found" (root config doesn't register the `eslint-plugin-react-hooks` that the `eslint-disable-next-line` comment references) and one `no-misused-promises` on `onClick={handleDownload}`. Re-run with admin-web's **own** `eslint.config.mjs` (`next/core-web-vitals` + `next/typescript`, the config `npm run lint:admin-web` actually uses):

```
$ cd apps/admin-web && npx eslint src/features/.../form-export-modal/index.tsx src/features/.../form-export-modal/request-guard.spec.ts src/features/.../form-export-modal/request-guard.ts src/features/.../table/index.tsx src/lib/api/domains/products/form-export.client.ts src/lib/api/domains/products/index.ts src/lib/services/products/form-export.spec.ts src/lib/services/products/form-export.ts src/lib/services/products/query-keys.ts src/lib/types/dto/form-export.ts
(exit 0, no output)
```

**Result: 0 new ESLint errors introduced by this branch, in any file, under each file's own project's config.** 5 pre-existing errors remain in 2 files this branch happened to also touch (in unrelated regions) — not this branch's debt to pay down, listed above for completeness. The 2 admin-web root-config findings are false positives caused by running the wrong linter and are not present under `apps/admin-web`'s own config.

---

## Part B — global regression differential

Full `npx jest` across the whole monorepo takes ~5 minutes and is documented repo debt (`lint-scope-caveat.md`), so "all green" was never the bar. To get an honest differential without running `git checkout`/`git switch`/`git worktree` inside this worktree (forbidden by the task), I made a **disposable local clone** of the repo at `beb85f1fc` in the scratchpad directory (`git clone --local`, then `git checkout beb85f1fc` *inside that separate clone only* — the assigned worktree here was never touched), symlinked `node_modules` (root, `apps/admin-web`, `packages/hms-api-wrapper`) from this worktree into it since `package-lock.json` is unchanged on this branch (only `package.json` gained one script line — confirmed via `git diff --name-only beb85f1fc..HEAD -- package.json package-lock.json`), and ran the identical `npx jest` command in both trees, in background, at the same time.

```
HEAD:     Test Suites: 42 failed, 65 skipped, 321 passed, 363 of 428 total   (301s)
baseline: Test Suites: 43 failed, 62 skipped, 310 passed, 353 of 415 total   (308s)
```

(428 vs 415 total suites = +13 on HEAD, matching exactly the 11 new bulk-session suites + 2 new admin-web spec files this branch adds — sanity check passes.)

Diffed the failing-suite-name sets (after stripping per-run timing suffixes, which otherwise make identical suite names compare as different lines):

```
NEW failures on HEAD (not failing at baseline):
  apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts

FIXED on HEAD (failing at baseline, passing on HEAD):
  apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts
  apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts
```

I did not stop at the raw diff. All three are `"Exceeded timeout of 5000 ms for a test"` failures, not assertion failures — confirmed by grepping both full logs for suites whose failure block contains `Exceeded timeout`: exactly these three suite names, one per run, no others. All three are ExcelJS-heavy suites (xlsx buffer write/read). None of the three (old or new) set a custom `jest.setTimeout` — this is a pre-existing repo characteristic (default 5s Jest timeout is too tight for real ExcelJS I/O once ~428 suites are saturating 14 cores in parallel), not something this branch changed. Confirmed the "new" failure is not a real regression by re-running it in isolation:

```
$ npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts
Tests:       9 passed, 9 total
Time:        0.652 s
```

9/9 pass in under a second standalone, and it also passed cleanly in the full bulk-session directory run (A.1) and the isolated scope run. The apparent "new failure" is which single ExcelJS-heavy suite draws the short straw under full-monorepo parallel contention in a given run — at baseline it was the two `product-import` xlsx suites; on this run of HEAD it was the new `form-export.workbook.spec.ts` instead. This is symmetric flake noise, not something this branch caused or fixed.

**Delta: 0 genuine new regressions.** (Literal name-diff shows 1 new / 2 fixed; investigated and both sides resolve to the same pre-existing timeout-under-load flake class affecting whichever ExcelJS suite runs unluckily that pass — this branch's new spec inherits that pre-existing fragility but does not introduce a new failure mode.) The other 41 suites failing on both branch and baseline are unchanged repo debt, confirmed identical by name.

Baseline clone was deleted after the comparison; nothing was left running or mutated outside the scratchpad.

---

## Part C — migration safety

Single new migration: `apps/core/drizzle/20260731203528_product-form-exports.sql`. Full contents inspected:

```sql
CREATE TYPE "public"."product_form_export_status" AS ENUM('queued', 'running', 'completed', 'failed');
CREATE TABLE "product_form_export_items" ( ... );
CREATE TABLE "product_form_exports" ( ... );
ALTER TABLE "product_form_export_items" ADD CONSTRAINT ... FOREIGN KEY ... ;
CREATE UNIQUE INDEX "uq_form_export_items_master" ...;
CREATE UNIQUE INDEX "uq_form_export_items_row_key" ...;
CREATE INDEX "idx_form_exports_claim" ...;
CREATE INDEX "idx_form_exports_expires" ...;
CREATE INDEX "idx_form_exports_requested_by" ...;
```

`grep -ci "DROP\|ALTER TYPE"` on the file → **0**. Confirmed: `CREATE TYPE` (brand-new enum, not `ALTER TYPE ... ADD VALUE` on an existing one), 2 `CREATE TABLE`, 1 additive `ALTER TABLE ADD CONSTRAINT` (FK), 5 `CREATE INDEX`. Zero drops, zero destructive statements, zero enum-value additions to a pre-existing type. Confirmed via `_journal.json` diff that this is the *only* new migration entry added by this branch (idx 51, one journal line added, no reordering of prior entries).

Full chain applies cleanly to an empty database: see Part A.2 (`drizzle-kit migrate` against a freshly `CREATE DATABASE`'d `sdd_stage1_scratch`, output `[✓] migrations applied successfully!`).

**Verdict: entirely additive. Safe for the expand-phase `migrate` → `deploy` order (ADR-0005 §5).**

---

## Part D — triage of deferred findings (`progress.md`)

| # | Finding | Where | Verdict | Justification |
|---|---|---|---|---|
| 1 | Comment typo "밖을 때" → "밖일 때" | `form-export.sheets.ts:72` | **accept** | Pure comment typo, zero functional impact. |
| 2 | Category-reference sheet test named "...보호된다" only asserts cell text, never `ws.sheetProtection` | `form-export.workbook.spec.ts` (`카테고리 참조 시트에...보호된다`) | **accept** | Task 4 independently verified (out-of-band script against the real installed exceljs 4.4.0) that `protect()` genuinely survives the write→load round trip (`sheetProtection.sheet === true` after reload). The test-name/assertion mismatch is a documentation gap, not a functional gap. Real Excel/Sheets confirmation is correctly routed to this task's manual smoke (Part E item 2). |
| 3 | No test asserts the frozen header pane (`ws.views`); `header.commit()` is a no-op in a non-streaming workbook | `form-export.workbook.ts:24,31` | **accept** | Same Task 4 out-of-band verification confirmed `views[0].state === 'frozen'` and `ySplit === 1` survive the round trip. `header.commit()` being a no-op here is harmless leftover boilerplate (copied from exceljs's streaming-writer pattern) — it doesn't do anything wrong, it just doesn't do anything. |
| 4 | `PrefillCell` type has zero consumers today | `form-export.types.ts:6` | **accept** | `type PrefillCell = string` — a type alias, not a code path. Explicitly pre-built for the stage-2 upload parser per the plan's "intentionally left out" section. Zero risk. |
| 5 | Real Excel/Sheets round-trip of `veryHidden` + sheet protection deferred to T10 | design note, Task 4 | **routed to Part E** | This *is* Task 10 — see manual smoke item 2 below. Not a code finding to fix. |
| 6 | Stage-2 parser doesn't exist yet | design note, Task 4/7 | **accept** | Explicit phase split per spec §7; this task's scope is form generation only. Not a gap in this task. |
| 7 | Empty `combination` string = "default item for a product with no option axis" | Task 5, spec-owner judgment | **accept** | Deliberate, spec-owner-confirmed semantics, documented in code comment (`form-export.snapshot.reader.ts:216-220`) and covered by a dedicated test. Resolved. |
| 8a | Orphan category → empty path fallback | `form-export.snapshot.reader.ts:238` (`categoryPathById.get(category.id) ?? ''`) | **accept** | Degrades gracefully (blank cell, no crash) on a rare data-integrity edge case (category tree missing a node). Verified the fallback path exists in code. |
| 8b | Sibling categories with identical names produce identical path strings, ambiguous for a future reverse-lookup | `flattenCategoryTree()` | **accept for this merge** | The reference sheet is currently write-only / informational (no reverse parser exists yet — see #6). This becomes a real design question only when stage 2's upload parser needs to map a path string back to a category id; flagging forward for whoever builds that, not a defect in this task's scope. |
| 8c | Per-product query count: sequential `getActiveVersion` → `getVersionRules` → `getImages` → `getOptionGroups` → `getVariants` (+ nested `getVariantOptionValues` per variant) → `getCategories` → `getPurchaseConstraint`, repeated per masterId, up to `MAX_FORM_EXPORT_PRODUCTS = 5000` (`create-form-export.dto.ts:5`) | `form-export.snapshot.reader.ts:124-253` | **should-fix-soon** | Confirmed in code: this is a real N+1 pattern, ~7+ round trips per product plus one more per variant, with no batching. It's bounded (hard DTO cap of 5000) and the only current mitigation is Task 8's 30-minute lease (`DEFAULT_EXPORT_LEASE_MS`), which buys time but doesn't fix the DB load. Not a correctness bug and typical real usage (a handful to a few hundred products per admin selection) won't hit this, so not a merge blocker — but a large selection could genuinely strain the DB and should be batched before this feature sees heavy use. |
| 8d | "Empty cell renders as blank string" is asserted for only one field (`seoTitle`) | `form-export.workbook.spec.ts` | **accept** | Test-thoroughness gap, not a functional gap — the rendering logic (`str()` helper) is applied uniformly to all fields, so one representative assertion is a reasonable (if not exhaustive) proxy. |
| 8e | Images sheet `sourceValue` is the raw file-service `fileId`, not a resolvable URL | `form-export.snapshot.reader.ts:119` | **accept** | Explicitly a stage-2 parser precondition per design note — the operator can't visually verify *which* image is `IMG-1` from the xlsx alone today. This is a real UX rough edge worth a manual-smoke callout (added to Part E) but not a code defect for this stage's write-only scope. |
| 9 | `tsconfig.spec-scope.json` didn't include `bulk-session`, making T1-T4's `type-check:scoped` pass vacuous | Task 5 finding | **resolved, re-verified** | Fixed in `2b5b29b0d`. Independently re-confirmed today: `bulk-session/**/*.ts` is present in `tsconfig.spec-scope.json`, and `npm run type-check:scoped` passes clean (Part A.4). Not vacuous. |
| 10 | Retained integration test's inline comment overstates what it actually verifies (real catch coverage lives in newer unit tests) | Task 5 note | **accept** | Documentation-accuracy issue in a comment, not a coverage gap — the actual behavior is covered, just not by the test the comment implies. |
| 11a | `getStatus` has no ownership check (`row.requestedBy` vs. caller); `getDownloadUrl` only indirectly relies on file-service's own JWT-scoped check, asymmetric | `form-export.manager.ts:46-60` (`getStatus`) vs. `:62-80` (`getDownloadUrl`) | **should-fix-soon** | Confirmed by reading the controller and manager: `getStatus(exportId)` takes no `userId` at all and returns `productCount`/`errorMessage`/`status` for any export id to any authenticated caller who can guess/obtain a UUIDv7 export id. `getDownloadUrl` forwards `userId` to file-service as a JWT claim, so it's protected only if file-service itself enforces ownership on that claim (not verified in this task's scope) — inconsistent, and worth an explicit `row.requestedBy === userId` check in both methods for defense in depth. Not a merge blocker: this is `core`'s internal admin API surface (`product-forms`), used only by admin-web with `master`-scope tokens per `FormExportFileClient`'s own token minting (`scopes: ['master']`) — the blast radius is metadata about other admins' bulk-export jobs, not customer data, and every caller with access to this route already has broad product-data read access by design. |
| 11b | `db:seed:ref`'s file-service step inserts new contexts with `ON CONFLICT (id) DO NOTHING` (only `DIGITAL_ASSET_FILE_CONTEXT_ID` gets `DO UPDATE`), so a future edit to the `product-bulk-form` context's shape (mime types, size limit, path prefix) won't apply on re-seed | `scripts/seeding/steps/file-service.seed-step.ts:96-115` | **accept, note for Part E** | Pre-existing seed-step behavior applying uniformly to every non-digital-asset context, not something this branch introduced (this branch just adds one more entry to an array that inherits the existing insert strategy). For the *first* deploy this is exactly what's needed (fresh insert succeeds cleanly since the row doesn't exist yet) — see Part E deploy prerequisites. Only becomes a problem for a *future* PR that edits this context's parameters; flagging forward. |
| 12 | `purgeExpired` was unwired/untested when Task 7 landed | Task 7 note | **resolved, re-verified** | Confirmed in code: `form-export-job.worker.ts:66-69` has `@Cron(CronExpression.EVERY_DAY_AT_4AM)` calling `this.manager.purgeExpired(new Date())`, as Task 8 claimed. Wired and covered by Task 8's lease tests. |
| 13 | Lease sizing: `DEFAULT_EXPORT_LEASE_MS` raised to 30 minutes | Task 8, spec-owner judgment | **accept** | Deliberate judgment call, justified by the 5000-product cap × the N+1 pattern in finding 8c — this *is* the current mitigation for 8c. Resolved as designed. |
| 14 | No `@testing-library/react` in the repo → `FormExportModal`'s render/wiring logic (polling, race guard, retry) has zero automated coverage; only the extracted pure logic (`request-guard.ts`, `form-export.ts` hooks) is unit-tested | Task 9 note | **should-fix-soon** | Confirmed: `@testing-library/react` is not installed anywhere in the monorepo (`apps/admin-web/package.json` has no jest/testing-library deps at all). This is a repo-wide gap, not specific to this branch, so not a fair merge blocker for this task alone — but worth flagging with real weight: Task 9's own review already found and fixed one genuine concurrency bug in exactly this component (stale POST response overwriting a fresher `exportId` after close/reopen), and that class of bug is exactly what render-level tests would catch on the next refactor. Manual repro steps are the only regression net right now (Part E item 3). |

**Must-fix-before-merge count: 0.**
**Should-fix-soon: 3** (8c query-count/N+1, 11a ownership-check asymmetry, 14 missing render-level test harness).
**Accept: 11.**

---

## Part E — what a human still has to do

### E.1 — Manual smoke (nothing automated on this branch can establish these)

1. **End-to-end modal flow.** Start core (`npm run start:main:dev`) and admin-web (`npm run start:admin-web:dev`) locally. Go to the products list (`/mall/products` or equivalent), select 3–5 products via the row checkboxes, click **"양식 다운로드"** in the selection toolbar (`apps/admin-web/.../products-list/components/table/index.tsx`, disabled unless something is selected). Confirm the modal cycles 대기 ("접수 중...") → 진행 ("데이터를 모으는 중...") → 완료, driven by the status poll (`useFormExportStatus`).
2. **Real Excel/Google Sheets round-trip of the hidden sheet and sheet protection.** Task 4 verified programmatically (via a standalone exceljs script, not committed) that `veryHidden` state and `protect()` survive an in-process exceljs write→load round trip — but never against a real Excel or Google Sheets client. After downloading a real xlsx from step 1:
   - Open in Microsoft Excel: confirm there is **no visible way** to unhide the meta sheet from the right-click "Unhide" menu (only `veryHidden` — not `hidden` — guarantees this; `hidden` sheets *do* show up in that menu).
   - Confirm the "카테고리 참조" (category reference) sheet shows a lock icon / rejects cell edits without a password prompt for "unprotect".
   - Repeat both checks after uploading the same file to Google Sheets and reopening — Google's xlsx import doesn't always preserve every OOXML flag identically to Excel.
3. **Whether `window.location.href = url` actually triggers a download vs. in-tab navigation.** Depends on the `Content-Disposition` header on the S3-signed URL returned by file-service, which was out of scope to inspect in code review. Click "다운로드" in the completed modal and confirm the browser downloads the file rather than navigating away from/replacing the admin-web tab.
4. **Modal close→reopen race.** Task 9's review found and fixed a stale-response bug (late POST response after close/reopen overwriting a fresh `exportId`); the fix is covered by `request-guard.spec.ts` at the pure-logic level only. Manually: open the modal, immediately close it before the first status poll returns, reopen quickly, and confirm the modal shows the *second* request's state, not a stale first one (no console errors, no flash of the wrong export's data).
5. **Full workbook content check** (per the brief's own Step 4 script, still valid):
   - 8 sheets total: 상품·옵션·조합·카테고리·구매제약·이미지·카테고리 참조 (7 visible) + 1 hidden meta sheet.
   - Headers are Korean; only **required** columns are bold.
   - Product data matches real DB values for the 3–5 selected products.
   - The 조합(combination) column is a sorted `optionValueId` join; the adjacent "조합명(참고용)" column is human-readable.
   - The "카테고리 참조" sheet contains the entire category tree as `조상>자식` name paths.
   - Include one product with a complex pricing rule (`tiered_price` or `scale`) — confirm its 판매가 cell renders the literal sentinel `[복합 가격규칙]` rather than a number.
   - Query `product_form_export_items` directly and confirm `version_id` matches that product's current active version.
   - (New, from Part D 8e) Confirm the "이미지" sheet's `sourceValue` is a raw file-service `fileId` (UUID), not a viewable URL — expected by design, but worth eyeballing once so nobody mistakes it for a bug later.

### E.2 — Deploy prerequisites, ordered

1. **Migrate first** (expand phase, additive-only migration → `migrate` before `deploy`, per ADR-0005 §5):
   ```
   npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes
   ```
   Applies `20260731203528_product-form-exports.sql` (Part C: purely additive, safe for old code to ignore during the rolling window).
2. **Deploy `file-service`.** No schema change needed here (this branch touches `apps/file-service/src/database/default-file-contexts.ts` only — an in-memory seed *data* list, not a migration; `file_contexts` table itself predates this branch, confirmed no new file-service drizzle migration on this branch).
3. **Seed the new file-service context — this step is easy to forget and is not a migration:**
   ```
   npm run db:seed:ref -- --stage <stage> --deployment lcnine-services --yes
   ```
   Must run **after** `file-service` is deployed (its own reference-data step) and **before** `core` starts accepting real form-export requests. Without this, the first real upload attempt from `FormExportFileClient` (`contextId: 'product-bulk-form'`) 404s/fails against file-service with an unrecognized-context error — deploying code alone does not create this row (Part D 11b: the insert is `ON CONFLICT (id) DO NOTHING`, so this is safe to re-run repeatedly, but only actually inserts once — until this row exists, it does not exist).
4. **Deploy `core`.**
5. **Deploy `admin-web`.**

Order recap: `migrate` → `file-service` deploy → `db:seed:ref` → `core` deploy → `admin-web` deploy.

### E.3 — New environment variables (both have safe defaults; no action required unless overriding)

| Variable | Default | Where |
|---|---|---|
| `FORM_EXPORT_WORKER_ENABLED` | enabled unless the string literal `'false'` | `form-export-job.worker.ts:30` |
| `FORM_EXPORT_LEASE_MS` | `1_800_000` (30 minutes) | `form-export-job.manager.ts:25,54-55` |

**No new secrets.** `AUTH_SECRET` and `FILE_SERVICE_URL` are already present in Core's live environment block (`deployments/lcnine/services/infra/services.ts:344,352`) — confirmed by reading the deployment infra file directly, not just trusting the progress ledger's claim.

---

## Final review fix wave (2026-08-01)

Single pass fixing the four items the final whole-branch reviewer returned before merge. Worktree/branch unchanged (`feat/product-bulk-session-stage1`). No functional change outside the files listed below.

### Item 1 — `download=true` missing from the download-URL request

**File:** `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts:77-92`

Added `?download=true` to the `GET /files/:fileId/download` request in `FormExportFileClient.getDownloadUrl`. Confirmed the exact shape by reading `apps/file-service/src/download/download.controller.ts:44,50` (`@Query('download') download?: string`, truthy check is `download === 'true' || download === '1'`) and `download.service.ts:30-33` (only sets `Content-Disposition: attachment; filename*=…` when `download` is truthy) before writing the change, and matched the existing precedent at `apps/core/src/modules/library/clients/file-service.client.ts:98` (`?expiresIn=${expiresIn}&download=true`) exactly on the parameter name/value.

Pinned in `form-export-file.client.spec.ts`'s existing `getDownloadUrl` request-URL assertion — it now asserts the full `?download=true` suffix, so a regression that drops the param fails the existing test rather than needing a new one.

### Item 2 — no ownership check on `getStatus`/`getDownloadUrl`

**Files:** `form-export.manager.ts`, `form-export.service.ts`, `form-export.controller.ts` (+ specs)

**Decision: foreign export reads as `NotFoundError` (404), not `ForbiddenError` (403).** Rationale: distinguishing "doesn't exist" from "exists but isn't yours" is itself an oracle — a caller who gets 403 instead of 404 has learned the id is valid, which they shouldn't be able to confirm for someone else's data. This repo already has exactly this precedent: `apps/core/src/modules/library/services/ownership.service.ts:365-368` (`_loadOwnedOrThrow`) explicitly does the same collapse with the comment "본인 외 접근은 존재 여부를 노출하지 않기 위해 404 와 동등 취급" ("non-owner access is treated as equivalent to 404, to avoid exposing existence"). I followed that precedent rather than inventing a new convention for this module, since stage 2+ will copy this module's shape per the brief.

Implementation:
- `getStatus(exportId, userId, tx?)` now checks `row.requestedBy !== userId` alongside the existing `!row` check, both collapsing to the same `NotFoundError` message/format as before (no new message shape a caller could use to distinguish the two cases by content).
- `getDownloadUrl(exportId, userId, tx?)` — added `requestedBy` to the existing `select()` projection and checks ownership **before** the completed/`fileId` check. Order matters: if the status check ran first, a non-owner could distinguish "your export exists and is still running" (409) from "doesn't exist" (404) for someone else's job by watching which error comes back — that's the same oracle problem one level down. Ownership check now gates everything else.
- `form-export.service.ts` and `form-export.controller.ts` thread `userId` through `getStatus` the same way `getDownloadUrl` already did — controller pulls it from `@User() user: { userId: string }`, matching the existing pattern on `create`/`getDownloadUrl` in the same controller.

Tests added (`form-export.manager.spec.ts`):
- `getStatus`: "본인 소유가 아닌 export 조회는 NotFoundError 다" — owner mismatch on a `completed` row still yields `NotFoundError`.
- `getDownloadUrl`: "본인 소유가 아닌 export 는 완료 상태여도 NotFoundError 고, fileClient 를 부르지 않는다" — same, plus asserts `fileClient.getDownloadUrl` is never called (proves the ownership gate short-circuits before any file-service call, not just before the response).

### Item 3 — `purgeExpired` leaked the xlsx

**Files:** `form-export-file.client.ts` (+ spec unaffected, no existing softDelete tests to extend), `form-export.manager.ts` (+ spec)

Added `FormExportFileClient.softDelete(fileId, userId)` — `DELETE /files/:fileId` with the same master-scope token minting as the rest of the client, 404 treated as success (idempotent cleanup), mirroring the existing `ProductImportFileClient.softDelete` (`apps/core/src/modules/catalog/operations/import/services/product-import-file.client.ts:124-134`) byte-for-byte in shape.

Rewrote `FormExportManager.purgeExpired`: the `DELETE FROM product_form_exports WHERE expires_at < now` now returns `fileId` and `requestedBy` per row (added to the existing `.returning()`), and after the DB delete completes, loops over the returned rows calling `fileClient.softDelete(fileId, requestedBy)` for every row that has a `fileId` (jobs still `queued`/`running`/`failed` at expiry have none — skipped, nothing to delete). Each `softDelete` call is wrapped in try/catch; a failure logs a warning (`this.logger.warn`, includes export id, file id, and the upstream error message) and the loop continues — it does **not** abort the purge or affect the returned count. Order is deliberate: DB deletion commits first, file cleanup runs after and is best-effort, so a file-service outage or an already-gone file (404, already handled as success by `softDelete` itself) never blocks job-row cleanup for the rest of the batch.

**Note per the brief: file-service's delete is a soft delete** — the `product_form_exports`/`product_form_export_items` rows are gone and the `files` row is marked deleted, but the underlying S3 object is untouched by this call. That's consistent with the design spec's known-defect list and is explicitly not something this client or this task is meant to fix.

Tests added (`form-export.manager.spec.ts`, new `describe('FormExportManager.purgeExpired')` block):
- Happy path: two purged rows, one with `fileId` and one without — asserts `softDelete` is called exactly once, with the right `(fileId, requestedBy)` pair, and the returned count is still 2 (both rows, not just the one with a file).
- Continue-on-failure: two purged rows both with `fileId`s, first `softDelete` call rejects — asserts `purgeExpired` still resolves (does not throw), both `softDelete` calls happen (the second is not skipped because the first failed), the count is still 2, and the warning log fires with the failed row's export id in it.

### Item 4 — `recordJobError` could flip a completed job to `failed`

**File:** `form-export-job.manager.ts:37-40, 185-224`

Added `TERMINAL_EXPORT_STATUSES: Array<'completed' | 'failed'> = ['completed', 'failed']` (declared as a plain typed array, not `as const` — `notInArray` requires a mutable array type and a `readonly` tuple fails `type-check:scoped` with a real TS2769 overload error, caught while running the gate). `recordJobError`'s first `UPDATE` — the one that bumps `consecutiveFailures` and writes `errorMessage` — now guards its `WHERE` with `and(eq(id, exportId), notInArray(status, TERMINAL_EXPORT_STATUSES))`. Once a job is `completed` or `failed`, this update matches zero rows, `row` comes back `undefined`, and the existing `if (row && row.failures >= MAX_CONSECUTIVE_EXPORT_FAILURES)` guard never fires — no zombie exception can push an already-finished job's counter up or flip it to `failed`.

Extended the docstring to explicitly separate the two failure modes the id-only-match design produces: the *accepted* one (a zombie's exceptions can wrongly fail the successor's still-**running** job — documented and accepted pre-existing, unchanged by this fix) from the *not-accepted* one this task closes (a zombie's exceptions reaching an already-**completed** job and undoing it, silently making `getDownloadUrl` return 409 forever for a workbook that's actually fine). `claim()`'s candidate condition (`status IN ('queued', 'running')`) is why this guard never fires on the legitimate path — a terminal job is never claimed again, so `recordJobError` only ever needs to touch one in the zombie-vs-terminal case this closes.

Tests added (`form-export-job.manager.spec.ts`, in `describe('FormExportJobManager.recordJobError')`):
- "WHERE 절이 종결 상태(completed/failed)를 제외한다" — renders the captured `where` condition to SQL via the existing `renderQuery` helper and asserts it contains `"status" not in`.
- "가드가 0 행을 매치하면(이미 종결 상태) failed 확정 update 를 시도하지 않는다" — simulates the DB returning zero rows (as it would for a terminal-status row) via `returningRows: [[]]` and asserts only one `UPDATE` call happened total (the second, `failed`-confirming one, never runs).

### Item 5 (cosmetic) — dead branch + wrong zero-product copy

**File:** `apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx:164-187`

Removed the `completed && !downloadable` branch (dead: `downloadable` and `fileId` are always set together in the same DB write in `runExport`, so `completed` implies `downloadable` in every real code path). Split the remaining `completed && downloadable` branch on `data.productCount > 0` — the normal case keeps its existing copy unchanged; `productCount === 0` (every requested product lacked an active version) now renders "선택한 상품 중 판매 중인 버전이 있는 상품이 없어 담을 데이터가 없습니다" instead of the previous "상품 0건이 담긴 양식이 준비됐습니다". Left the download button's visibility condition unchanged (`completed && downloadable`, no `productCount` check) — the zero-product case still produces a real (empty) xlsx, so downloading it remains a legitimate action; only the messaging was wrong.

`.tsx` files aren't covered by `npm run lint`, so ran directly: `cd apps/admin-web && npx eslint src/features/mall/products-list/components/form-export-modal/index.tsx` — exit 0, no output. Also `npx prettier --check` on the same file — matches repo style.

### Test commands and full output

Unit/DI suite (no DB, matches CI baseline):
```
$ npx jest apps/core/src/modules/catalog/operations/bulk-session/
Test Suites: 3 skipped, 8 passed, 8 of 11 total
Tests:       22 skipped, 100 passed, 122 total
```
(+6 tests vs. the 94 passed recorded in Part A.1 above — exactly the 6 new tests across items 2/3/4.)

Full run including the 3 DB-gated suites, against a scratch DB created and dropped per this task's constraints (`fixwave_scratch`, not `dev_core` — never touched):
```
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS fixwave_scratch"
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE fixwave_scratch"
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fixwave_scratch" npx drizzle-kit migrate --config apps/core/drizzle.config.ts
[✓] migrations applied successfully!
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fixwave_scratch" npx jest apps/core/src/modules/catalog/operations/bulk-session/ --forceExit
Test Suites: 11 passed, 11 total
Tests:       122 passed, 122 total
```

Sanctioned integration-test invocation (`apps/core/.env` sets `DATABASE_URL=…/dev_core`, but `dotenv-cli` never overrides an already-exported shell variable — verified directly with a throwaway `node -e "console.log(process.env.DATABASE_URL)"` probe before trusting it, same as Part A.2's methodology; confirmed `dev_core` was never touched):
```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fixwave_scratch" npm run test:form-export:integration
PASS apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job-lease.integration.spec.ts
PASS apps/core/src/modules/catalog/operations/bulk-session/services/form-export-snapshot.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       21 passed, 21 total
```
Post-run row-count check on `fixwave_scratch` (rollback-only isolation, both 0): confirmed, then dropped the scratch DB.

Isolated per-item test runs (all new/changed tests, verbose):
```
$ npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts --verbose
Test Suites: 3 passed, 3 total
Tests:       33 passed, 33 total
```
All new test names listed above (Items 2/3/4) appear with ✓ in this run.

admin-web sanctioned invocation (unaffected files, re-run to confirm no regression from the `.tsx` edit):
```
$ npx jest --roots ./apps/admin-web --transform '{"^.+\\.(t|j)s$":["ts-jest",{"tsconfig":"apps/admin-web/tsconfig.jest.json"}]}' --testPathPattern='(form-export|request-guard)\.spec\.ts'
Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
```

### Gate results

| Gate | Command | Result |
|---|---|---|
| Core scoped type-check | `npm run type-check:scoped` | exit 0, no output (after fixing the `notInArray`/readonly-tuple TS2769 caught by this gate) |
| admin-web type-check | `cd apps/admin-web && npx tsc --noEmit` | exit 0, no output |
| ESLint, core+file-service changed files (root config) | `npx eslint <9 changed .ts files>` | exit 0, no output — no new findings (the 5 pre-existing errors noted in Part A.7 are in files this wave didn't touch) |
| ESLint, admin-web changed file (own config, `.tsx` escapes `npm run lint`) | `cd apps/admin-web && npx eslint src/features/mall/products-list/components/form-export-modal/index.tsx` | exit 0, no output |
| Prettier | `npx prettier --write` on all 9 changed `.ts` files, `--check` on the `.tsx` | all formatted/matching; prettier's reflow of the controller/manager signatures is reflected in the diffs above |
| Targeted jest | see above | 133 test executions across the 3 touched-heaviest spec files + the full bulk-session directory, all green; 0 skips with DB present |

### Files changed

```
apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx
apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.ts
apps/core/src/modules/catalog/operations/bulk-session/services/form-export.service.ts
```

No schema/migration changes in this wave — all four items were application-code fixes to logic that already had its migration merged (Part C, unchanged).
