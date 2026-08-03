# Task 11 — 2단계(업로드·검증) 마무리 검증 보고서

Worktree: `.claude/worktrees/feat+product-bulk-session-stage2`, branch `feat/product-bulk-session-stage2`
Merge base (develop): `beb85f1fc` — 1단계와 같다
1단계 브랜치 tip (= 이 브랜치의 스택 베이스): `aaa8920d3`
검증 시점 브랜치 head: `3fda1271f` (이 태스크의 첫 커밋 직전). 커밋 후 Part A 의 스위트·게이트를
**다시 돌려** 같은 결과를 확인했다. 이후 두 번의 픽스 웨이브가 있었다 — (1) Task 11 리뷰
픽스(문서·테스트·스크립트만), (2) **최종 전체 브랜치 리뷰 픽스(`5a65bf48c`, 프로덕션 코드
변경 있음)**. 아래 두 "픽스 웨이브" 절 참조.
검증 실행: 2026-08-02, Node v22.23.1, Postgres 컨테이너 `almondyoung-server-postgres-1`

**결론: DONE_WITH_CONCERNS — 머지 가능. 머지 금지 조건은 남아 있지 않다.** 2단계 코드에
기인한 회귀는 하나도 찾지 못했다. 남은 우려는 (1) 이 태스크가 **브리프가 준 통합테스트 실행
스크립트의 결함**을 실행 중에 발견해 고쳤다는 것, (2) 배포 선행조건 표의 **환경변수 이름 2건이
실제 코드와 다르다**는 것, (3) 이연 Minor 중 **6건**이 "곧 고칠 것"이라는 것, (4) **수동
스모크가 전 구간 미수행**. 자세한 내용은 Part D·F.

> **초판 대비 바뀐 판정 하나.** 초판은 F.1 #7(접수 게이트 거부 스모크)을 **머지 금지** 조건으로
> 지정했다. 근거는 "그 게이트의 유일한 자동 커버인 목 하네스가 WHERE 술어를 버린다"(Part D
> #22)였다. 최종 리뷰 픽스 웨이브가 그 하네스를 고쳐(`5a65bf48c`) 게이트의 두 술어
> (`eq(exports.id)`·`isNull(items.snapshot)`)가 **뮤테이션으로 검증된 자동 커버**를 갖게 됐으므로,
> F.1 #7 은 **머지 금지 → 배포 전 확인 항목**으로 내린다. 실 file-service·실 엑셀 왕복은
> 여전히 목이 대신할 수 없으므로 스모크 자체는 남는다.

> ⚠️ **이 단계가 증명한 것의 경계.** 설계 스펙 §8 의 핵심 주장은 "작업자가 A필드를, 남이
> B필드를 바꿨을 때 **발행 후** 둘 다 살아있는가"다. *발행*(포크-후-diff 적용 → draft →
> publish)은 4·5단계 몫이라 이 브랜치에 코드가 없다. 이 태스크가 실 Postgres 로 못 박은
> 것은 **"payload 가 A 만 담고 B 를 안 건드린다"**까지 — 즉 4단계가 남의 값을 보존할 수 있는
> *입력*을 2단계가 정확히 만든다는 것뿐이다. "정말로 둘 다 살아남았다"는 4·5단계 통합
> 테스트가 생긴 뒤에야 검증된다. 이 경계는 `bulk-session-merge.integration.spec.ts` 헤더
> 주석에도 같은 문구로 박아 두었다.

---

## Part A — 테스트·게이트 증거

### A.1 — 이 태스크가 추가한 것

| 파일 | 테스트 수 | 무엇을 잠그는가 |
|---|---|---|
| `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-lease.integration.spec.ts` | 16 | lease 소유권·취소·`payload IS NULL` 불변식·jsonb 왕복. 일회용 스키마 격리 |
| `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-merge.integration.spec.ts` | 6 | 병합 시나리오(핵심 주장). 실 상품 픽스처, 롤백 전용 격리 |
| `package.json` | — | `test:bulk-session:integration` 스크립트 |

### A.2 — 기능 스코프: `npx jest apps/core/src/modules/catalog/operations/bulk-session/`

DATABASE_URL 없이(5개 DB 게이트 스위트가 skip):

```
$ npx jest apps/core/src/modules/catalog/operations/bulk-session/
Test Suites: 5 skipped, 19 passed, 19 of 24 total
Tests:       47 skipped, 299 passed, 346 total
Time:        3.586 s
```

> **최종 리뷰 픽스 웨이브(`5a65bf48c`) 후 재실행** — 아래 "최종 브랜치 리뷰 픽스 웨이브" 절에
> 근거가 있다:
>
> ```
> $ npx jest apps/core/src/modules/catalog/operations/bulk-session/
> Test Suites: 5 skipped, 19 passed, 19 of 24 total
> Tests:       48 skipped, 325 passed, 373 total
> ```

scratch DB 를 붙여 전 스위트 실행:

```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" \
  npx jest apps/core/src/modules/catalog/operations/bulk-session/ --forceExit
Test Suites: 24 passed, 24 total
Tests:       346 passed, 346 total
Time:        4.885 s
```

**결과: PASS. DB 가 있으면 skip 0, 실패 0.**

> **출력이 pristine 하지 않다.** DB 없는 실행에 `[FormExportJobManager] 양식 생성 잡 lease 를
> 잃어 결과를 반영하지 못했습니다 (export=exp-1)` WARN 1건(1단계에서 유래, 의도된 경합 로그).
> 통합 실행에는 여기에 더해 이 태스크가 추가한 3건 — 취소 중단 LOG 1건, 연속 실패 상한
> ERROR 1건, lease 상실 WARN 1건 — 이 찍힌다. 전부 **테스트가 일부러 만든 경로의 의도된
> 로그**이고, 각각 그 경로를 단정하는 테스트가 있다. postgres.js 의 `DROP SCHEMA CASCADE`
> NOTICE 도 `console.log` 로 올라온다(드라이버 동작, 억제하지 않았다).

### A.3 — DB 통합 스위트 (scratch DB, `dev_core` 는 절대 쓰지 않는다)

```
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage2_scratch"
DROP DATABASE
$ docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage2_scratch"
CREATE DATABASE
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
[✓] migrations applied successfully!
```

이것이 Part C 의 "빈 DB 에 전체 마이그레이션 체인이 깨끗이 적용된다" 증거이기도 하다.

`dotenv-cli` 가 이미 export 된 셸 변수를 덮지 않는다는 것을 **믿지 않고 직접 확인**했다
(`apps/core/.env` 는 `dev_core` 를 가리킨다):

```
$ DATABASE_URL="postgresql://.../bulk_stage2_scratch" npx dotenv -e apps/core/.env -- node -e "console.log(process.env.DATABASE_URL)"
postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch
```

```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npm run test:bulk-session:integration
PASS apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-lease.integration.spec.ts
PASS apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-merge.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       22 passed, 22 total
Ran all test suites matching /apps\/…\/bulk-session-lease.integration.spec.ts|apps\/…\/bulk-session-merge.integration.spec.ts/i.
```

1단계 통합 스위트도 같은 scratch DB 에서 회귀 없음:

```
$ DATABASE_URL="postgresql://.../bulk_stage2_scratch" npm run test:form-export:integration
PASS .../form-export-job-lease.integration.spec.ts
PASS .../form-export-snapshot.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       24 passed, 24 total
```

**롤백 전용 격리 실측** — 전 스위트 실행 뒤 scratch DB 에 남은 행:

```
$ docker exec ... psql -U postgres -d bulk_stage2_scratch -At -c "SELECT ..."
product_bulk_sessions=0
product_bulk_items=0
product_bulk_images=0
product_form_exports=0
product_form_export_items=0
product_masters=0
product_master_versions=0
product_categories=0
pricing_rules=0
product_audit_log=0
leftover_schemas=0        ← 일회용 스키마 bs_lease_% 도 남지 않았다
```

**`dev_core` 미오염 실측** — 2단계 테이블이 하나도 만들어지지 않았다:

```
$ docker exec ... psql -U postgres -d dev_core -At -c "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
    ('product_bulk_sessions','product_bulk_items','product_bulk_images',
     'product_form_exports','product_form_export_items')"
0
```

### A.4 — ⚠️ 브리프가 준 통합테스트 스크립트에 결함이 있었다 (고침)

브리프 Step 3 의 스크립트를 **그대로** 넣으면 이 워크트리에서 조용히 전 레포 통합
테스트를 돌린다:

```json
"test:bulk-session:integration": "... jest --testPathPattern=bulk-session.*integration"
```

`--testPathPattern` 은 **절대경로**에 정규식을 건다. 이 워크트리 경로는
`.../worktrees/feat+product-bulk-session-stage2/...` 라 이미 `bulk-session` 을 포함하고,
`.*integration` 이 그 뒤 아무 `integration` 에나 걸린다. 실측:

```
$ DATABASE_URL=".../bulk_stage2_scratch" npm run test:bulk-session:integration   # 브리프 원안
Test Suites: 18 failed, 1 skipped, 59 passed, 77 of 78 total
Tests:       56 failed, 12 skipped, 4 todo, 380 passed, 452 total
Ran all test suites matching /bulk-session.*integration/i.
```

78 스위트가 매칭되고, 이 태스크와 무관한 fulfillment·inventory·medusa 통합 스위트가
"18 failed" 로 뜬다 — **정확히 사람이 이 브랜치의 회귀로 오독하기 좋은 모양**이다.

정규식 대신 **형제 DB 통합 스크립트 5개와 같은 관례**(`jest --runInBand <파일경로>`)로 바꿔
함정 자체를 구조적으로 없앴다. `--runInBand` 는 두 스위트가 같은 scratch DB 에 병렬로 붙는
타이밍 결합(lease 스펙 `afterAll` 의 `public.product_bulk_sessions = 0` 단정 vs merge 스펙의
롤백 트랜잭션)도 함께 없앤다:

```json
"test:bulk-session:integration": "REQUIRE_BULK_SESSION_DB=1 dotenv -e apps/core/.env -- jest --runInBand apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-lease.integration.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-merge.integration.spec.ts"
```

매칭 스위트 수를 `--listTests` 로 직접 세어 확인했다:

```
$ npx jest --listTests --testPathPattern='bulk-session.*integration' | wc -l      # 브리프 원안
78
$ npx jest --listTests <위 두 파일 경로> | wc -l                                    # 현재 스크립트
2
```

> **1단계 스크립트에는 같은 함정이 잠복해 있다.** `test:form-export:integration` 의 패턴은
> `form-export.*integration` 인데, 1단계 워크트리 이름에 `form-export` 가 없어서 우연히
> 안 터졌을 뿐이다. `form-export` 를 포함하는 경로(디렉터리·워크트리 이름)에서 실행하면
> 같은 사고가 난다. 이 태스크의 범위 밖이라 고치지 않았다 — Part D **#29** 로 올린다.

### A.5 — 이 테스트들이 정말 그 사고를 무는가 (뮤테이션 검증)

"통과하지만 아무것도 보증하지 못하는 테스트"를 이 브랜치가 여러 번 만났으므로,
`bulk-session-job.manager.ts` 에 실제 결함을 하나씩 심고 **어느 테스트가 죽는지** 확인했다.
(각 뮤테이션 후 원본으로 복구했고, 최종 `git diff` 로 매니저 파일이 무변경임을 확인했다.)

| # | 심은 결함 | 기대 | 실측 |
|---|---|---|---|
| M1 | `createImageKeyAllocator(baseSnapshot.images)` → `createImageKeyAllocator()` (이미지 키 seed 제거) | merge #4 실패 | ✅ `이미지 키 seed …` 1건만 실패, 나머지 5건 통과 |
| M2 | `flattenBundle(input.bundle, present)` → `flattenBundle(input.bundle)` (열 삭제 ≠ 비움 무력화) | merge #5 실패 | ✅ `열을 통째로 지운 파일 …` 1건만 실패 |
| M3 | `present` 를 배열 복사 없이 `Set` 그대로 jsonb 에 저장 | 두 스위트 다수 실패 | ✅ 22건 중 9건 실패 |
| M4 | `finishValidating` 의 `eq(leaseToken, …)` CAS 제거 | lease #11 실패 | ✅ `옛 토큰으로는 마감하지 못한다 …` 1건만 실패 |
| M5 | `if (current.versionId !== item.baseVersionId)` 로 충돌 판정을 감싼다 (= **versionId 재구성 설계** 재현) | merge #3 실패, merge #2 통과 | ✅ 정확히 그렇게 — `§F1 회귀 잠금` 1건만 실패 |

M5 가 이 보고서에서 가장 중요한 줄이다. **"남이 새 버전을 발행했다"(merge #2)는
versionId 재구성 설계로도 잡히지만, "남이 active 행을 인플레이스로 UPDATE 했다"(merge #3)는
조용히 통과한다** — 스냅샷을 값으로 저장하는 설계(§F1)가 존재하는 이유가 실측으로 남았다.
merge #3 은 목이 아니라 **진짜 `ProductBulkService.bulkUpdate`** 를 부른다.

### A.5b — 최종 리뷰 픽스 웨이브(`5a65bf48c`)의 뮤테이션 검증

새 단정도 같은 방법으로 검증했다 — **픽스 이전 코드를 그대로 되돌려** 어느 테스트가 죽는지
확인하고, 매번 원본으로 복구한 뒤 백업 파일과 `diff -q` 로 무변경을 확인했다.

| # | 되돌린 것 | 대상 스위트 | 실측 |
|---|---|---|---|
| M6 | `flattenBundle` 의 카테고리 행-부재 규칙 제거 | fields | ✅ 3건 실패 (열-부재 테스트는 통과 — 두 축이 섞이지 않는다) |
| M7 | `flattenBundle` 을 픽스 이전 형태로 완전 복원(카테고리+구매제약) | merge (실 DB) | ✅ **새 테스트 1건만** 실패, 기존 6건 통과 |
| M8 | `approve` 이미지 게이트에서 `status='pending'` 참조 필터 제거 | manager | ✅ 3건 실패 |
| M9 | `assertExportUsable` 에서 `eq(productFormExports.id, exportId)` 제거 | manager | ✅ 7건 실패 |
| M10 | `assertExportUsable` 에서 `isNull(productFormExportItems.snapshot)` 제거 | manager | ✅ 5건 실패 |
| M11 | `resolveImageRefs` 의 프리필 관용 분기 제거 | structure + job manager | ✅ 2건 실패 |
| M12 | `pricingEditable` 을 센티넬 역산만으로 되돌림 | job manager | ✅ 2건 실패 |
| M13 | 파싱 슬라이스가 `base_snapshot` 에 권위 컬럼을 안 싣게 되돌림 | job manager | ✅ 1건 실패 |
| M14 | `parseFieldPath` 정규식 `(.*)` → `(.+)` | fields | ✅ 2건 실패 |

**M9·M10 이 이 절에서 가장 중요한 줄이다.** 픽스 이전 `harness()` 는 `where: () => rows` 라
**두 뮤테이션 모두 목이 초록이었다** — 즉 접수 게이트는 자동 커버가 있는 것처럼 보였을 뿐
실제로는 없었다. M7 도 마찬가지로 중요하다: 픽스 이전 코드에서 기존 6건이 전부 통과한다는
것이 "기존 스위트가 이 사고를 못 잡았다"의 실측이다.

### A.6 — 브리프 표 + 지시받은 회귀 잠금 6건의 커버리지

| 요구 | 어느 테스트 | 상태 |
|---|---|---|
| claim 이 대기 세션 하나를 잡고 lease 를 미래로 민다 (UUIDv7) | lease #1 | ✅ |
| lease 살아있으면 두 번째 워커가 못 잡는다 | lease #3 | ✅ |
| lease 만료 시 후임이 이어받는다(재개) | lease #4 | ✅ |
| 옛 토큰으로는 마감하지 못한다 | lease #11 (+M4) | ✅ |
| `cancel_requested_at` 세션은 claim 되지 않는다 | lease #5 | ✅ |
| 검증 슬라이스 중 취소 → 남은 행 payload 가 NULL 유지 | lease #12 (3행 중 1행 처리 후 취소) | ✅ |
| payload·input jsonb 왕복 후 값이 전부 문자열 | lease #10(`payload.fields`) + lease #7(`input.present`) | ⚠️ **부분** — 브리프 문구를 축자로 만족시키지 않는다. `input` 전체는 "전부 문자열"이 **설계상 성립하지 않는다**(`input.errors[].rowNumber` 는 숫자다). 그래서 `payload.fields` 전 leaf 는 lease #10 이 문자열로 잠그고, `input` 쪽은 성질별로 나눠 잠근다 — `present` 배열 보존(lease #7), 그 배열이 diff 에 미치는 영향(merge #5). 테스트 이름도 `payload.fields …` 로 좁혀 이름이 세우는 사실과 단정을 일치시켰다 |
| `payload IS NULL` 이 미검증의 유일한 의미 | lease #9 (오류 행) + merge #4 (변경 0건 행) | ✅ |
| A/B 분리 — payload 에 A 만 | merge #1 | ✅ |
| 같은 필드 → base·mine·current 충돌 | merge #2 | ✅ |
| **인플레이스 수정 경로도 충돌로 잡힌다 (§F1)** | merge #3 (+M5) | ✅ |
| **이미지 키 seed** | merge #4 (+M1) | ✅ |
| **열 삭제 ≠ 비움** | merge #5 (+M2) | ✅ |
| **`present` 배열 직렬화** | lease #7 + merge #5 후반부 (+M3) | ✅ |
| **0행 양식은 정상이다** | merge #6 | ✅ |
| (추가) export_id NULL + 워크북 exportId 있음 → 세션 실패 (중복 생성 방어선) | lease #8 | ✅ |

브리프에 없지만 넣은 것: 연속 실패 상한(lease #13), 레인 밖 세션에 대한 좀비
`recordJobError` 차단(lease #14), 카운터 리셋(lease #15), 좀비 토큰의 lease 갱신 실패(lease #16),
파싱 슬라이스의 phase/총행수/lease 해제(lease #6).

### A.7 — 이웃 모듈 회귀: `npx jest apps/core/src/modules/catalog/operations/import/`

```
Test Suites: 4 skipped, 18 passed, 18 of 22 total
Tests:       34 skipped, 340 passed, 374 total
```

**PASS, 실패 0.** 1단계 검증 시점과 숫자가 동일하다(374 total) — 2단계는 옛 임포트 모듈을
건드리지 않았다.

### A.8 — `npm run type-check:scoped`

```
$ npm run type-check:scoped
> tsc -p tsconfig.spec-scope.json --noEmit
(출력 없음)
exit=0
```

`tsconfig.spec-scope.json` 의 `include` 에 `apps/core/src/modules/catalog/operations/bulk-session/**/*.ts`
가 들어 있음을 다시 확인했다 — 새 스펙 2개가 실제로 이 게이트에 포함된다(비공허).

### A.9 — ESLint

이 브랜치가 `apps/` 아래에서 바꾼 `.ts` 파일 전량(작업 트리 포함) 기준.

**2단계 범위 (`aaa8920d3...HEAD`, 42개 파일):**

```
$ npx eslint <42 files>
apps/core/src/modules/catalog/schema/catalog.schema.ts
   19:10  error  'eq' is defined but never used     @typescript-eslint/no-unused-vars
  351:4   error  'table' is defined but never used  @typescript-eslint/no-unused-vars
✖ 2 problems (2 errors, 0 warnings)
```

두 줄 다 merge base 와 **바이트 동일**하고, 이 브랜치의 hunk 는 전부 append 다:

```
$ git diff -U0 beb85f1fc..HEAD -- apps/core/src/modules/catalog/schema/catalog.schema.ts | grep '^@@'
@@ -977,0 +978,92 @@
@@ -1199,0 +1292,154 @@
@@ -1235,0 +1482,5 @@
```

즉 19행·351행은 이 브랜치가 건드리지 않은 기존 debt다(1단계 보고서 A.7 과 같은 판정).

이 태스크가 만든 두 스펙만 따로:

```
$ npx eslint .../bulk-session-lease.integration.spec.ts .../bulk-session-merge.integration.spec.ts
(exit 0, 출력 없음)
$ npx prettier --check <두 스펙> package.json
All matched files use Prettier code style!
```

**전 브랜치 범위(`develop...HEAD`, 69개 파일)** 로 넓히면 1단계 보고서가 이미 트리아지한
findings 이 그대로 재현된다: admin-web 파일 6건(루트 config 로 admin-web 을 린트한 결과 —
그 앱의 자기 config 가 아니다) + `file-service/default-file-contexts.ts` 3건(기존 debt).
2단계는 admin-web 과 file-service 를 **한 파일도 건드리지 않았다**
(`git diff --name-only aaa8920d3...HEAD -- apps/admin-web` → 빈 출력).

**결과: 2단계가 새로 만든 ESLint error 0.**

---

## Part B — 전역 회귀 차분

전 레포 `npx jest` 는 이 레포에서 develop 에서도 red 다(`lint-scope-caveat` 메모리 항목).
"전체 그린"은 애초에 판정 기준이 아니므로 **차분**으로 봤다.

방법: 스크래치 디렉터리에 `git clone --local` 로 merge base(`beb85f1fc`) 일회용 클론을 만들고
(그 클론 **안에서만** `git checkout beb85f1fc`, 배정된 워크트리는 건드리지 않았다),
`package-lock.json` 이 이 브랜치에서 무변경임을 확인한 뒤(`git diff --name-only beb85f1fc..HEAD
-- package.json package-lock.json` → `package.json` 만) 루트 `node_modules` 를 심링크하고,
**두 트리에서 순차로**(동시 실행하면 타임아웃 flake 가 서로를 오염시킨다) 같은 명령을
`DATABASE_URL` 을 벗긴 동일 환경에서 돌렸다.

```
baseline: Test Suites: 42 failed, 62 skipped, 311 passed, 353 of 415 total   (22.2s)
HEAD:     Test Suites: 43 failed, 67 skipped, 331 passed, 374 of 441 total   (21.5s)
Tests:    baseline 77 failed / HEAD 77 failed
```

441 − 415 = **+26 스위트**. 1단계가 +13(bulk-session 11 + admin-web 2), 2단계가 +13
(bulk-session 디렉터리 11 → 24) — 정확히 맞는다. 실패한 **테스트 수는 양쪽 다 77 로 동일**하다.

실패 스위트 **이름 집합** 차분:

```
=== NEW on HEAD ===
apps/admin-web/src/lib/services/products/form-export.spec.ts
=== FIXED on HEAD ===
(없음)
```

이 한 건을 끝까지 파고들었다. 결론은 **2단계 회귀가 아니고, 코드 결함도 아니다**:

```
$ npx jest apps/admin-web/src/lib/services/products/form-export.spec.ts
Cannot find module '@tanstack/react-query' from 'apps/admin-web/src/lib/services/products/form-export.ts'
```

- 해당 파일은 **1단계**가 추가한 것이다. **2단계는 admin-web 을 한 파일도 안 건드렸다**
  (`git diff --name-only aaa8920d3...HEAD -- apps/admin-web` → 빈 출력). 이것만으로도
  "2단계 회귀 아님"은 성립한다 — 아래 원인 분석과 독립적인 근거다.
- `@tanstack/react-query`(`^5.89.0`)는 `apps/admin-web/package.json` 의 **정식 선언 의존성**이다.
  즉 의존성 누락이 아니다.
- **원인은 설치 상태가 아니라 루트 jest 설정이다.** `package.json` 의
  `modulePathIgnorePatterns` 에 `<rootDir>/apps/admin-web/node_modules` 가 들어 있어
  (`package.json:363`), **설치돼 있더라도 루트 `npx jest` 는 그 패키지를 해석하지 않는다.**
  admin-web 스펙의 공인 실행 경로는 `npm run test:admin-web`(자기 tsconfig + `--roots
  ./apps/admin-web`)이고, 1단계 보고서 A.6 도 같은 결론이다.
  ⚠️ **`npm install` 로 고쳐지지 않는다 — 시도하지 마라.**
- 부수적으로, 이 워크트리에는 `apps/admin-web/node_modules` 자체도 없다
  (`existsSync('apps/admin-web/node_modules') === false`; 1단계 워크트리에는 있다). 그래서
  이 워크트리에서는 공인 실행 경로로도 이 스펙을 돌릴 수 없다 — 하지만 위에서 보듯
  **루트 전역 실행 결과는 설치 여부와 무관하다.** 태스크 지시가 `npm install` 금지이기도 하다.

즉 이 실패는 "**루트 jest 로는 구조적으로 해석 불가능한 admin-web 스펙이, baseline 에는 파일
자체가 없다가 1단계에서 새로 생겼다**"는 것이지 회귀가 아니다.

**2단계 코드에 기인한 새 실패: 0.** 나머지 42개는 baseline 과 이름까지 동일한 기존 debt다.
전역 실행에서 bulk-session 디렉터리 24개 스위트 중 **FAIL 0**
(`grep -c "^FAIL apps/core/.../bulk-session/" head.log` → **0**, `^PASS` → 19,
나머지 5개는 `DATABASE_URL` 이 없어 skip — A.2 의 5 skipped/19 passed 와 같은 분해다).

스위트 수 검산: 1단계 tip(`aaa8920d3`)의 bulk-session 스펙 11개 → HEAD(커밋됨) 22개 →
이 태스크의 2개를 더해 24개. 즉 2단계가 +13, 1단계가 +13(bulk-session 11 + admin-web 2)
= +26 으로 441 − 415 와 정확히 맞는다.

baseline 클론은 비교 후 삭제했다. 워크트리 밖에서 변경된 것은 없다 —
`git checkout`/`switch`/`worktree`/`stash` 를 쓰지 않았고 `develop` 은 건드리지 않았다
(baseline 은 스크래치 디렉터리의 일회용 `git clone --local` 안에서만 체크아웃했다).

---

## Part C — 마이그레이션 안전성

이 브랜치가 추가한 마이그레이션은 두 개이고, 그중 **2단계 것은 하나**다.

| 파일 | 단계 |
|---|---|
| `apps/core/drizzle/20260731203528_product-form-exports.sql` | 1단계 (이미 1단계 보고서 Part C 가 검증) |
| `apps/core/drizzle/20260801055128_product-bulk-sessions.sql` | **2단계 — 이 보고서의 대상** |

```
$ grep -ci "drop\|alter type" apps/core/drizzle/20260801055128_product-bulk-sessions.sql
0
```

문장 종류 실측:

```
      7 CREATE TYPE          (전부 신규 enum — 기존 타입에 ALTER TYPE ... ADD VALUE 하는 것이 아니다)
      3 CREATE TABLE         product_bulk_sessions / product_bulk_items / product_bulk_images
      4 ALTER TABLE          3건 = ADD CONSTRAINT(FK), 1건 = ADD COLUMN (nullable)
      2 CREATE UNIQUE INDEX
      4 CREATE INDEX
      0 DROP*
```

유일하게 기존 테이블을 건드리는 문장:

```sql
ALTER TABLE "product_form_export_items" ADD COLUMN "snapshot" jsonb;
```

**nullable 컬럼 추가**라 additive 다. 이 컬럼은 1단계 테이블에 붙지만, 1단계 tip
(`aaa8920d3`)의 코드는 이 컬럼을 **쓰지도 읽지도 않는다** — 실제로 확인했다: 1단계 tip 의
`SnapshotItem` 에는 `snapshot` 필드 자체가 없고, `catalogSchema` 의
`productFormExportItems` 정의에도 `snapshot` 이 없다. 컬럼과 그 writer(2단계의
`renderMaster` 스냅샷)를 같은 마이그레이션·같은 단계가 함께 들여온다. 즉 **1단계만 배포된
상태도, 2단계 마이그레이션만 먼저 적용된 상태도 둘 다 안전**하다.

`_journal.json`:

```
$ git diff develop...HEAD -- apps/core/drizzle/meta/_journal.json | grep '^-' | grep -v '^---' | wc -l
0        ← 기존 항목의 삭제·재정렬 0
추가된 항목: idx 51 (20260731203528_product-form-exports, 1단계) + idx 52 (20260801055128_product-bulk-sessions, 2단계)
```

빈 DB 에 전체 체인 적용: A.3 참조 (`[✓] migrations applied successfully!`).

**판정: 전량 additive. ADR-0005 §5 의 expand phase 규칙(`migrate` → `deploy`)을 따른다.**

---

## Part D — 이연 항목 트리아지

원장(`progress.md`)의 `minor (deferred)` 줄 **23개**를 개별 항목 **28건**으로 풀고(한 줄에 여러
건이 묶인 줄이 있다), 이 태스크가 새로 발견한 1건(#29)을 더해 **표는 29행**이다. 판정은 원장
문구를 되풀이하지 않고 **코드를 다시 읽어** 내렸다 — 그 과정에서 원장이 놓친 해소 1건(#7)과,
**원장·이 보고서 초판이 해소로 잘못 적었던 1건(#22)**을 찾았다.

| # | 항목 | 출처 | 판정 | 근거 |
|---|---|---|---|---|
| 1 | `pricingEditable` 을 스냅샷 판매가 셀이 센티넬인지로 역산 | T2, `bulk-session-job.manager.ts:566` | **해소됨 (최종 리뷰 픽스, `5a65bf48c`)** | 권위 있는 컬럼 `product_form_export_items.pricing_editable` 이 바로 옆에 있는데 아무도 읽지 않고 있었다. 파싱 슬라이스가 이미 그 테이블에서 `masterId/versionId/snapshot` 을 읽고 있으므로 컬럼 하나를 더 select 해 `base_snapshot` 에 실어 나른다(**스키마 변경 없음**). 센티넬 역산은 롤링 배포 폴백으로만 남는다. 초판이 남긴 "바꿀 때 backfill 이 필요하다"는 조건도 함께 사라진다. 뮤테이션 검증: 폴백만 남기면 새 테스트 2건이 빨간불 |
| 2 | `renderMaster` 재호출 테스트가 필드 2개만 비교 | T2, `form-export-snapshot.integration.spec.ts:349` | **수용** | 이 태스크가 사실상 메웠다 — merge #4 가 **실 상품 2건**으로 재렌더 키 배정을 잠근다(M1 로 뮤테이션 검증). 원래 지적(product 전량 `toEqual`)은 여전히 더 강하지만 공백은 닫혔다 |
| 3 | 스펙 파일 2곳의 `as unknown` 근거 주석 없음 / 주석 축자 중복 / `EMPTY_SNAPSHOT` 픽스처 중복 | T2 | **수용** | 테스트 코드 위생. 이 태스크의 새 스펙 2개는 모든 `as`/`as never` 에 근거 주석을 달았다(레포 규칙 준수) |
| 4 | `productImages` 로더가 `sortOrder` 동값 타이브레이크 없이 정렬 | T2 → T9 인계, `product-version-read.loader.ts:189` | **곧 고칠 것** | 코드로 재확인: `.orderBy(desc(isPrimary), asc(sortOrder))` — id 타이브레이크가 없다. 부가이미지 2장 이상이 **같은 `sortOrder`** 를 가지면 재렌더에서 `additionalImageKeys` 의 `\|` 순서가 뒤집혀 아무도 안 건드린 행이 변경/충돌로 뜬다. **이 태스크의 merge #4 픽스처도 부가이미지 1장이라 못 잡는다**(정직하게 공개된 갭). 고치는 것은 `asc(productImages.id)` 한 줄이지만, 로더는 catalog 전역이 공유하므로 2단계 범위 밖이다. T9 리뷰가 "완화하지 않는 것이 옳다"고 판정한 것(정렬 정규화는 의도한 재정렬을 지운다)과 모순되지 않는다 — 필요한 것은 **결정적 정렬**이지 정규화가 아니다 |
| 5 | 스코프 jest 출력에 의도된 `logger.warn` 1건 | T2 | **수용** | A.2 에 실측으로 공개했다. 로그를 없애려면 경합 경로의 유일한 운영 신호를 없애야 한다 |
| 6 | 열 집합 회귀 테스트가 오늘의 열을 리터럴로 단정 | T3 | **수용** | 구조적 수정(ColumnDef 순회) 자체는 이미 들어갔다. 기대값을 배열에서 파생시키면 테스트가 구현을 그대로 베끼게 되는 트레이드오프가 있다 |
| 7 | `parseUploadWorkbook` 이 같은 버퍼를 두 번 파싱 | T4 | **이미 해소됨** | 코드 확인: `bulk-upload.parser.ts:161` 이 `readExportIdFromLoadedWorkbook(wb)` 를 쓴다(로드 1회). T8 픽스 라운드에서 닫혔는데 원장에 반영되지 않았다 |
| 8 | `capped()` 반환값 미사용 / 헤더 앞뒤 공백 테스트 없음 | T4 | **수용** | `capped` 는 throw 부수효과 전용 — 무해. 공백은 코드가 `trim` 으로 처리 중 |
| 9 | 중복 헤더 검사의 도달 불가능한 방어 분기 | T4, `bulk-upload.parser.ts:78-81` | **수용** | 재확인: `keyByColumn[col]` 은 같은 열 인덱스를 두 번 방문해야 참인데 `eachCell` 은 그러지 않는다. 죽은 코드지만 기능 무해하고, 지우면 "왜 없앴는지" 주석이 또 필요하다 |
| 10 | 이미지 시트 `present` 가 계산되지만 반환되지 않음 | T4 | **수용** | 설계상 맞다 — 이미지 시트는 diff 대상이 아니다(`PresentColumns` 는 5시트) |
| 11 | 빈 상품키 행 두 개가 서로를 중복으로 잡지 않는다는 사실이 테스트로 미고정 | T5 | **수용** | 코드는 맞고(빈 키는 `seen` 에 안 들어간다), 두 행 다 "상품키는 필수" 오류로 invalid 가 된다 — 결과가 같다 |
| 12 | 고아 참조 테스트가 '옵션' 시트만 덮는다 | T5 | **수용** | 조합/카테고리/구매제약이 **같은 `attach()` 헬퍼**를 통과한다(`bulk-upload.assembler.ts:81-94`) — 대표 1건으로 충분한 부류 |
| 13 | `[...value].length` 유니코드 계산 | T6 | **수용** | 코드포인트 기준 길이는 Postgres `varchar(n)` 의 문자 수 계산과 일치하는 방향이다 |
| 14 | `Number('1e3')`·`'0x10'` 이 정수 검증을 통과 | T6, `bulk-session.validator.ts:180` | **곧 고칠 것** | 재확인: `Number('1e3') === 1000` 이라 `Number.isInteger` 를 통과한다. 작업자가 최소구매수량에 `1e3` 을 오타로 적으면 **오류 없이 1000** 이 된다. 조용히 틀리는 부류이고 고치는 것은 정규식 한 줄(`/^-?\d+$/`)이다. 머지 차단은 아니다 — 오늘도 값이 저장되기 전에 사람이 프리뷰로 본다 |
| 15 | `FIELD_LABELS` 에 시트 스코프가 없다 | T6 | **수용** | 시트 간 key 충돌은 `basePrice`/`membershipPrice`/`rowKey` 뿐이고 라벨이 서로 같다 |
| 16 | 날짜 `99:99` 를 '존재하지 않는 날짜'로 안내 | T6 | **수용** | 문구 정확도 문제. 거부는 정확히 된다 |
| 17 | 신규행 판매가 필수 검사가 `pricingEditable` 안에 중첩 | T6 | **수용** | `pricingEditable=false` 인 신규 행은 만들 수 없다(신규는 항상 true) — 도달 불가 조합 |
| 18 | varchar·열거 테스트 커버리지 비대칭 | T6 | **수용** | 길이 검증은 `kind` 와 무관하게 같은 `checkMaxLength` 를 탄다 |
| 19 | `parseIntInRange` 의 `'∞'` 분기가 죽은 코드 | T6, `bulk-session.validator.ts:182` | **수용** | 재확인: 호출부 4곳 전부 유한 상한(100 / `POSTGRES_INTEGER_MAX`). 무해한 잔여물 |
| 20 | 오류 문구가 워크북 헤더 라벨 규약과 어긋나는 곳들 | T7 | **곧 고칠 것** | `'옵션값을 추가할 수 없습니다'`(실제 헤더는 '옵션값키/옵션값명'), `'대표 카테고리'`(실제 헤더는 '대표여부'). 작업자가 **엑셀에서 그 칸을 못 찾는다** — 2단계 산출물이 결국 사람이 읽는 오류 문자열이라는 점에서 실질적이다. 문구만 바꾸는 저위험 수정이고 머지 차단은 아니다 |
| 21 | `buildCategoryPathIndex` 가 `isActive` 를 필터하지 않는다 | T7 | **수용** | 의도적이다 — 이미 비활성 카테고리에 배정된 상품의 경로가 인덱스에서 빠지면 카테고리를 건드리지도 않은 행이 통째로 오류가 된다. 호출자 책임으로 남긴 것이 맞다 |
| 22 | `bulk-session.manager.spec` 의 목 하네스가 where 술어/from 인자를 무시 / `sourceFileId`·`uploadedBy`·`upload` 인자 미단정 | T8 | **해소됨 (최종 리뷰 픽스, `5a65bf48c`)** | 이 항목은 두 번 판정이 바뀌었다: 원장·초판이 "해소됨"으로 잘못 적었고 → Task 11 리뷰가 "부분 해소"로 정정했고 → 최종 리뷰 픽스가 실제로 닫았다. 픽스 내용: `PgDialect().sqlToQuery()` 렌더러(`rowMatchesCondition`/`writeSelectChain`)를 파일 상단으로 올려 **두 하네스가 공유**하게 하고, `harness()` 를 select 호출 순서 큐에서 **테이블 정체성 픽스처**로 바꿨다. 픽스처에 늘 **남의 양식 행**(`OTHER_EXPORT_ID`, NULL 스냅샷 포함)을 섞어 두어 술어 상실이 통과할 수 없게 했다. 후반부(`sourceFileId`·`uploadedBy`·`upload` 인자)도 함께 단정한다. 뮤테이션 검증(A.5b): `eq(exports.id)` 제거 → 7건 실패, `isNull(items.snapshot)` 제거 → 5건 실패 |
| 23 | 비-UUID 가드 테스트가 가드 유무를 구분하지 못한다 | T8 | **수용** | 코드 자체는 리뷰어가 직접 확인했다. 이 태스크의 lease #8 이 인접한 사고(export_id NULL + 워크북 exportId)를 실 DB 로 잠갔다 |
| 24 | `accept` 의 `tx?` 에 미래 호출자가 앰비언트 tx 를 넘기면 'fetch 를 걸친 트랜잭션'이 재발 | T8 | **수용** | 현재 호출자 0. 위험이 실재하려면 새 호출부가 생겨야 하고, 그 PR 이 리뷰를 받는다 |
| 25 | `isForeignKeyViolation` 이 제약 이름을 안 본다 | T8 | **수용** | `product_bulk_sessions` 에 FK 가 하나뿐이라 오늘은 정확하다. FK 가 늘 때 같이 봐야 한다 |
| 26 | `runParseSlice` 213줄 — 순수 헬퍼로 분해 가능 | T9 | **수용** | 이 태스크가 그 함수를 **실 DB 로** 덮었다(lease #6·#8·#12, merge 전량). 분해의 원래 동기(DB 목 없는 단위 테스트)가 약해졌다 |
| 27 | 소유권 검사 3벌 중복 / `toConflictMap` 위치 / GROUP BY 어서션 / page·limit 대 status 엄격도 / `select()` 전 컬럼 | T10 | **수용** | 재확인: `bulk-session.manager.ts:219,288,388` 에 같은 `!session \|\| session.uploadedBy !== userId` 가 3벌 있고 리더에는 `assertOwned` 가 있다. **동작은 정확하다** — 중복은 리팩터 대상이지 결함이 아니다 |
| 28 | `cancel` 의 CAS 가드에 독립 레이스 테스트 없음 | T10 | **수용** | 정직하게 공개된 갭이고, 이 태스크의 lease #12 가 인접 경로(슬라이스 중 취소)를 실 DB 로 잠갔다 |
| 29 | (**이 태스크가 새로 발견**) `test:form-export:integration` 의 `--testPathPattern` 이 경로 전체에 걸린다 | A.4 | **곧 고칠 것** | 1단계 스크립트에 잠복. `form-export` 를 포함하는 디렉터리에서 돌리면 전 레포 통합 스위트를 돌리고 무관한 실패를 보여준다. 이 태스크의 새 스크립트는 이미 앵커했다. 1단계 스크립트 수정은 이 태스크 범위 밖이라 손대지 않았다 |

표 29행 + 최종 리뷰가 새로 만든 3행(#30~#32, 아래) = **32행**의 분포(합계 32):

**머지 전 필수: 0건.**
**곧 고칠 것: 6건** — #4(이미지 로더 정렬 결정성), #14(숫자 리터럴 파싱), #20(오류 문구 라벨),
#29(1단계 스크립트 패턴), #30(고아 아이템의 rowNumber/rowKey 노출), #32(옵션 시트 통째 삭제 시
오류 문구 + `applyDecisions` 주석).
**수용: 23건.**
**이미 해소됨: 3건** — #7, 그리고 최종 리뷰 픽스 웨이브가 닫은 **#1**(pricingEditable 역산)과
**#22**(accept 하네스가 WHERE 를 버린다).

최종 전체 브랜치 리뷰가 **이연으로 남긴** 3건(원장에 새로 실린다):

| # | 항목 | 출처 | 판정 | 근거 |
|---|---|---|---|---|
| 30 | 고아 시트 오류로 만든 합성 아이템이 `rowNumber`/`rowKey` 를 이미지 시트 좌표로 노출 | 최종 리뷰 M-2 | **곧 고칠 것** | 화면에서 그 행이 "상품 행"처럼 보인다. 표시 문제고 데이터는 정확하다 — 3단계가 화면을 붙일 때 함께 정리하는 것이 자연스럽다 |
| 31 | 상한 크기(10MB/1,000행) 파일의 접수 지연 실측 없음 | 최종 리뷰 M-3 | **수용(수동 스모크로 남긴다)** | `accept` 가 동기로 파싱을 한 번 더 돈다(게이트 목적, 그 근거는 `accept` 독스트링에 있다). ALB 60초 여유는 실 파일로만 확인된다 — F.1 에 스모크로 남아 있다 |
| 32 | '옵션' 시트를 통째로 지웠을 때의 오류 문구 / `applyDecisions` 주석 | 최종 리뷰 M-6 | **곧 고칠 것** | 문구·주석만. 거부·판정 자체는 정확하다(#20 과 같은 부류라 같이 고치는 것이 싸다) |

표 밖 항목: 원장의 T9 → T10 인계 항목(`total_rows` 가 진행률 분모로 쓰이면 어긋난다)도 **해소됐다**:
`bulk-session.reader.ts:166-171` 이 `totalRows` 를 그대로 내려주되 분모용 `itemTotal`(집계 합)을
따로 준다.

---

## Part E — 3·4단계로 넘어가는 것 (결함이 아니라 범위)

이건 트리아지 대상이 아니라 **다음 단계가 이어받는 목록**이다. 사람이 2단계만 배포한 상태를
운영할 때 알아야 하는 것들이기도 하다.

1. **`awaiting_images`·`drafting` 을 처리하는 워커가 없다.** 승인된 세션은 그 phase 에서
   멈춘 채 기다린다. 2단계만 배포된 상태에서 승인까지 가면 세션이 거기 남는다 — 취소로 풀 수
   있다(취소는 phase 무관하게 동작). 3·4단계가 이어받는다.
2. **취소 시 이미지·draft 정리 없음** — 3·5단계 몫. 2단계 시점에는 지울 것이 없다
   (`product_bulk_images` 행은 세션 CASCADE 로 사라진다).
3. **`변경분`이 실제로 적용되는지는 4단계가 증명한다.** 2단계는 "무엇을 적용할지"까지만
   확정한다. 이 보고서 맨 위 ⚠️ 와 같은 이야기다.
4. **`productCode` 유니크 충돌은 발행 시점에야 확정된다**(스펙 §5.2). 다른 master 와의
   충돌이라 업로드 검증으로 완전히 못 잡는다.
5. **`renderMaster` 의 N+1** — 1단계 검증 보고서 8c 가 지적한 상품당 7+ 왕복이 **검증
   슬라이스에도 그대로** 온다(행마다 `renderMaster` 1회). 슬라이스 크기(기본 20)로 유계지만,
   1,000행 세션이면 검증 전체에 최소 7,000+ 왕복이다. 대량 세션에서 실측하고 배치화를
   검토해야 한다.
6. **카테고리 동명 형제 모호성** — 1단계 8b 가 넘긴 항목을 2단계가 "모호하면 행 오류"로
   닫았다(`resolveCategories`). 근본 해결(경로에 id 를 싣기)은 워크북 규약 변경이라 별건이다.
7. **로더 `sortOrder` 타이브레이크**(Part D #4) — 3·4단계가 이미지 순서를 실제로 쓰기 전에
   닫는 것이 자연스럽다.

---

## Part F — 사람이 해야 할 일

### F.1 — 수동 스모크 (⛔ **전 구간 미수행**)

2단계는 화면이 없으므로 curl 로 돈다. `$AUTH` 는 admin 토큰, `$CORE` 는 core 호스트.
아래 8개는 **하나도 수행되지 않았다** — 자동화가 커버하지 못하는 것들이다
(file-service 실 업로드/다운로드, ALB 타임아웃, 실제 엑셀 클라이언트 왕복, 워커 크론 타이밍).

1. 1단계 화면에서 상품 3건을 골라 양식을 받는다.
2. 엑셀에서 한 상품의 **상품명**만 고친다. 다른 상품은 손대지 않는다.
3. `curl -X POST $CORE/product-bulk-sessions -H "$AUTH" -F file=@양식.xlsx -F name=스모크`
   → 202 + sessionId
4. `curl $CORE/product-bulk-sessions/$ID -H "$AUTH"` 를 몇 초 간격으로 →
   `phase` 가 `uploaded` → `validating` → `review` 로 간다.
5. `curl "$CORE/product-bulk-sessions/$ID/items" -H "$AUTH"` → 고친 상품 1건만 `changes` 에
   상품명 한 줄, 나머지 2건은 `changes: []`.
6. **충돌 스모크**: 4번과 5번 사이에 admin 화면에서 그 상품의 상품명을 다른 값으로 바꿔
   발행한 뒤 업로드 → `conflicts` 에 한 줄. `PATCH .../items/:itemId/conflict-decision` 으로
   `skip` 을 주고 `POST .../approve` → `phase` 가 `drafting`(이미지가 있으면
   `awaiting_images`)이 된다.
   *(응답에 `id` 가 실려야 이 호출이 가능하다 — Task 10 리뷰 #1 이 고친 지점이다. 스모크에서
   실제로 `id` 가 오는지 눈으로 확인할 것.)*
7. **거부 스모크**: `product_form_exports` 에서 그 양식 행을 지우고 같은 파일을 다시 올린다
   → **400** 과 "양식을 다시 받아" 문구. 실패하면 카탈로그 중복 생성 사고가 열려 있는 것이다.
   **판정: 머지 금지 → 배포 전 확인 항목** (최종 리뷰 픽스 웨이브에서 내렸다).
   *(자동 커버가 이제 두 겹이다. (1) lease #8 이 "접수는 통과했는데 그 뒤 양식이 지워진"
   인접 케이스를 실 DB 로 잠근다. (2) **접수 게이트 자체(400)의 목 하네스가 이제 WHERE 술어를
   실제로 건다** — `PgDialect().sqlToQuery()` 로 조건을 렌더해 픽스처에 평가하고, 픽스처에
   섞어 둔 "남의 양식" 행 때문에 `eq(exports.id)`·`isNull(items.snapshot)` 중 하나만 빠져도
   빨간불이 된다(Part D #22, A.5b 뮤테이션 실측). 그래도 실 file-service 왕복·실제 엑셀
   클라이언트가 만든 파일·ALB 경계는 목이 대신할 수 없으므로 이 스모크는 남는다.)*
8. **취소 스모크**: 큰 파일을 올려 `validating` 인 동안 `POST .../cancel` → 진행이 멈추고
   `phase='canceled'`, 이후 워커 로그에 그 세션이 다시 나타나지 않는다.
   *(lease #12 가 슬라이스 중단을 실 DB 로 잠갔지만, 워커 크론이 그 뒤 다시 안 집는지는
   실제 프로세스로만 확인된다.)*

추가로 권장:

9. **실제 엑셀/구글시트 왕복**: 이 태스크의 테스트는 전부 exceljs 안에서 쓰고 읽는다.
   "작업자가 열을 지운 파일"(merge #5)도 exceljs `spliceColumns` 로 만든 것이다.
   **진짜 Excel 에서 열을 지우고 저장한 파일**이 같은 결과를 내는지는 확인되지 않았다.

### F.2 — 배포 선행조건, 순서대로

- 마이그레이션은 **전부 additive** → ADR-0005 §5 **expand phase = `migrate` → `deploy`**.
  ```
  npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes
  ```
  (AWS `dev` stage 는 폐기됐다 — `--stage dev` 는 죽은 명령이다.)
- **1단계와 함께 나가야 한다.** 이 브랜치는 1단계 위에 스택돼 있고 둘 다 develop 미머지다.
  1단계의 배포 선행조건(file-service `product-bulk-form` 컨텍스트 `db:seed:ref`)이 먼저다.
- 배포 순서: `migrate` → file-service → `db:seed:ref` → core. **admin-web 은 2단계에 변경이 없다.**
- **신규 시크릿 없음.** `AUTH_SECRET`·`FILE_SERVICE_URL` 은 Core live env 에 이미 있다
  (1단계 보고서가 배포 인프라 파일을 직접 읽어 확인).

### F.3 — 새 환경변수 (전부 안전한 기본값, 설정 없이도 동작)

⚠️ **브리프의 표에 적힌 이름 2건이 실제 코드와 다르다.** 아래가 **코드에서 읽은 실제 이름**이다.

| 변수 | 기본값 | 위치 | 브리프 표기 |
|---|---|---|---|
| `PRODUCT_BULK_SESSION_WORKER_ENABLED` | 문자열 `'false'` 가 아니면 켜짐 | `bulk-session-job.worker.ts:30` | 일치 |
| `PRODUCT_BULK_LEASE_MS` | `60_000` | `bulk-session-job.manager.ts:50,134` | ❌ 브리프는 `BULK_SESSION_LEASE_MS` |
| `PRODUCT_BULK_VALIDATE_SLICE` | `20` | `bulk-session-job.manager.ts:52,138` | ❌ 브리프는 `BULK_SESSION_VALIDATE_SLICE` |

브리프 이름으로 설정하면 **조용히 무시되고 기본값이 쓰인다**(`positiveInt` 가 파싱 실패 시
fallback). 운영 문서에 옮길 때 이 표를 쓸 것.

### F.4 — ⚠️ 통합 테스트를 돌릴 때: `DATABASE_URL` 을 반드시 명시하라

`test:bulk-session:integration`(과 1단계의 `test:form-export:integration`)은
`dotenv -e apps/core/.env` 를 통과하고, **그 파일의 `DATABASE_URL` 은 `dev_core` 를 가리킨다.**
즉 셸에서 `DATABASE_URL` 을 export 하지 않고 그냥 돌리면 **기본 타깃이 `dev_core`** 다.

오늘은 `dev_core` 에 2단계 테이블이 없어서 요란하게 실패하므로 사고가 눈에 띈다. 하지만
**이 브랜치의 마이그레이션이 `dev_core` 에 적용된 뒤에는 조용히 `dev_core` 를 탄다** —
merge 스펙은 롤백 전용이라 흔적이 거의 없지만, lease 스펙은 `dev_core` 에 일회용 스키마를
만들고 지운다. 항상 이렇게 돌릴 것:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" \
  npm run test:bulk-session:integration
```

(`dotenv-cli` 는 이미 export 된 셸 변수를 덮지 않는다 — A.3 에서 직접 확인했다.)

### F.5 — 이 워크트리의 환경 결함 (배포와 무관, 다음 사람 참고)

- `apps/admin-web/node_modules` 가 이 워크트리에 설치돼 있지 않아 admin-web 스펙을 이
  워크트리에서 **공인 경로(`npm run test:admin-web`)로도** 돌릴 수 없다. 태스크 지시가
  `npm install` 금지라 손대지 않았다.
- 다만 Part B 의 "새 실패" 1건은 **이것 때문이 아니다** — 루트 `npx jest` 는
  `modulePathIgnorePatterns` 때문에 설치 여부와 무관하게 그 스펙을 해석하지 못한다.
  **`npm install` 로 그 차분 항목이 사라지지 않는다.**

---

## 부록 — 새 스펙의 격리 방식

두 스펙이 **서로 다른 격리 전략**을 쓴다. 같은 이유가 아니라서다.

- `bulk-session-lease.integration.spec.ts` — **일회용 스키마**. `CREATE SCHEMA bs_lease_<uuid>`
  후 3개 bulk 테이블을 `LIKE public.x INCLUDING ALL` 로 복제하고, admin/워커A/워커B 세
  커넥션 전부의 `search_path` 를 **접속 startup 파라미터**로 그 스키마에 고정한다
  (`SET search_path` 문은 postgres.js 가 물리 재연결하면 조용히 public 으로 되돌아간다).
  이 스위트만 `claim()` 을 부르는데, `claim()` 에는 세션을 골라내는 필터가 없어(가장 오래된
  자격 세션을 집는 게 본래 동작) public 에 붙으면 **남의 대기 세션을 running 으로 만들어놓고
  되돌리지 않는다.** `afterAll` 이 `SELECT count(*) FROM public.product_bulk_sessions` 가 0
  임을 단정해 격리 성립을 매 실행 실측한다.
- `bulk-session-merge.integration.spec.ts` — **롤백 전용**. 실 상품·카테고리·가격규칙 픽스처가
  필요해 스키마 복제로는 감당이 안 된다(수십 개 테이블). 각 테스트가 트랜잭션 하나를 열어
  픽스처 → 양식 조립 → 남의 편집 → 워크북 편집 → 파싱/검증까지 전부 그 안에서 돌리고 항상
  롤백한다. 이 스위트는 **`claim()` 을 한 번도 부르지 않는다** — lease 토큰을 직접 심어
  CAS 를 만족시킨다. 가짜 `DbService.run` 이 tx 없는 호출을 **앰비언트 트랜잭션**으로
  폴백시켜(선례의 `db.transaction()` 폴백과 다른 점) 매니저의 모든 왕복이 같은 롤백
  트랜잭션에 합류한다.

merge 스펙은 `ProductBulkService` 를 진짜로 부르기 위해 레포 선례
(`product-versions.service.spec.ts:1-7`)와 같은 모양의
`jest.mock('@packages/event-contracts', …, { virtual: true })` 를 쓴다 — 루트 jest 의
`moduleNameMapper` 에 bare `@packages/event-contracts` 항목이 없어서다(레포 상시 debt).
그 두 서비스는 인스턴스화되지도 호출되지도 않고, `bulkUpdate` 의 brand/seller 경로가
협력자를 한 번도 건드리지 않는다는 것을 코드로 확인한 뒤 `undefined as never` 로 비웠다
(경로 밖을 부르면 즉시 TypeError 로 터지므로 조용히 잘못될 수 없다).

---

## 픽스 웨이브 ① — Task 11 리뷰 (2026-08-02)

Task 11 리뷰가 돌려준 항목을 한 번에 반영했다. **프로덕션 코드는 한 줄도 바꾸지 않았다** —
이 문서, 두 통합 스펙, `package.json` 스크립트뿐이다. 리뷰 판정은 spec ✅ 였고, 리뷰어가
A.5 의 M1·M2·M4·M5 뮤테이션 기전을 코드로 독립 재구성해 전부 성립함을 확인했다(즉
"통과하지만 아무것도 보증하지 못하는 테스트" 부류가 아니다).

| # | 지적 | 반영 |
|---|---|---|
| 1 (Important) | Part D #22 의 "이미 해소됨"이 사실과 다르다 — T10 픽스는 `writeHarness`(쓰기 경로)만 고쳤고 `accept` 경로 `harness()` 는 여전히 WHERE/`from` 을 버린다 | #22 를 **"부분 해소 — 잔여는 곧 고칠 것"** 으로 재분류하고 근거(파일·줄번호·`:345` 주석)를 실었다. 요약 집계와 최상단 결론, F.1 #7 의 커버리지 문장도 함께 정정 |
| 2 | Part B 의 admin-web 원인 진단이 자기모순 — "설치 상태 artifact" 라 해놓고 다음 문단이 "설치돼 있어도 루트 jest 는 해석 못 한다"고 적는다 | 두 문단을 합쳐 **원인은 `modulePathIgnorePatterns`(설정)** 로 바로잡고, "`npm install` 로 고쳐지지 않는다"를 명시. 결론("2단계 회귀 아님")은 독립 근거(admin-web 무변경)로 유지. F.4 → F.5 에도 같은 경고 |
| 3 | Part D 집계가 표(29행)와 어긋난다 | 원장 23줄 → 항목 28건 + 이 태스크 발견 1건 = **표 29행**, 분포는 **곧 고칠 것 5 / 이미 해소됨 1 / 수용 23**(합 29)으로 재계산 |
| 4 | 통합 스크립트를 레포 관례(`jest --runInBand <파일경로>`)에 맞춰라 + `DATABASE_URL` 미지정 시 `dev_core` 를 탄다 | 정규식을 **경로 두 개 명시 + `--runInBand`** 로 교체(함정이 구조적으로 사라지고, 두 스위트가 같은 scratch DB 에 병렬로 붙는 타이밍 결합도 없어진다). `--listTests` 실측을 A.4 에 추가(원안 78 vs 현재 2). `dev_core` 경고는 **F.4** 로 신설 |
| 5 | merge 스펙에 공유 목 리셋이 없다 | `beforeEach(() => download.mockReset()…)` 추가. 리셋 후 기본 구현은 **던지게** 했다 — 빈 버퍼를 돌려주면 세션이 조용히 failed 가 되고 원인이 한 단계 멀어진다 |
| 6 | `connect()` 헬퍼를 admin 커넥션도 쓰게 | `admin = connect(DATABASE_URL as string, schemaName)` 로 통일. 헬퍼 주석에 "모든 커넥션이 이걸 통과해야 한다"는 이유를 박았다 |
| 7 | 테스트 이름이 세우는 사실보다 단정이 좁다 | 이름을 `payload.fields 의 값은 …` 으로 좁혔다. `input` 전체는 **설계상** "전부 문자열"이 아니다(`errors[].rowNumber` 가 숫자) — 그 사실과 `input` 쪽을 어디서 잠그는지를 테스트 주석과 A.6 행에 적었다 |

픽스 후 재실행:

```
$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npm run test:bulk-session:integration
PASS .../bulk-session-merge.integration.spec.ts
PASS .../bulk-session-lease.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       22 passed, 22 total
```

**머지 판정 불변: 머지 가능.** #1 은 보고서의 커버리지 서술이 실제보다 높았던 것을 바로잡은
것이지 새 결함이 아니다 — 그 경로의 실질 게이트(F.1 #7 수동 스모크)는 이 시점까지 **머지 금지**
조건으로 지정돼 있었다. (그 판정은 아래 픽스 웨이브 ②에서 내려간다.)

---

## 픽스 웨이브 ② — 최종 전체 브랜치 리뷰 (2026-08-02, `5a65bf48c`)

브랜치 전체 리뷰 판정은 **"With fixes"** — Critical 0 · Important 4 · Minor 다수였다.
Important 4건 + 채택한 Minor 2건을 **한 번의 웨이브**로 닫았다. **웨이브 ①과 달리 프로덕션
코드가 바뀐다.** 스키마 변경은 없다 — 마이그레이션 목록(Part C)은 그대로다.

| # | 지적 | 반영 | 무엇이 그 사고를 무는가 |
|---|---|---|---|
| I-1 (Imp) | 하위 시트 **행 삭제**가 '변경 없음'이 아니라 **명시적 비움**으로 흘러가, 카테고리 전량 해제가 `status='pending'` 으로 굳었다 | `flattenBundle` 이 카테고리 행 0개면 `category.set` 을, 구매제약 행이 없으면 `constraint.*` 를 **아예 담지 않는다**. 규칙은 **세 상태 모두**에 같게 건다 | fields spec 7건(행/열 두 축 분리 + diff 왕복) + **merge 통합 1건(실 DB)**. 뮤테이션 M6·M7 |
| I-2 (Imp) | `approve` 이미지 게이트가 **버려질(invalid) 행**의 이미지까지 요구 | `hasPendingImageWork()` 로 분리하고 `status='pending'` 행이 `payload.imageRefs` 로 실제 참조하는 (imageKey, usage) 만 센다 | manager spec 4건(invalid만 참조 / 고아 / usage 불일치 / 형제 혼재). 뮤테이션 M8 |
| I-3 (Imp) | '이미지' 시트가 없으면 이미지를 **건드리지도 않은** 수정 행이 전부 invalid | 변경분에 없는 이미지 칸의 참조는 `base_snapshot.images` 로 해석해 통과시킨다. 바뀐 칸은 여전히 시트에서 해석돼야 한다 | structure spec 5건 + job manager spec 2건. 뮤테이션 M11 |
| I-4 (Imp) | `BulkItemPayload.optionPlan` 이 선언만 되고 아무도 안 채운다 | 선언 삭제 + `parseFieldPath()` export 로 스코프 키 되파싱을 한 곳에 모은다 | parseFieldPath spec 4건 |
| I-5 (Imp) | 접수 게이트의 유일한 자동 커버가 WHERE 를 버린다 | `PgDialect().sqlToQuery()` 렌더러를 두 하네스가 공유. `harness()` 를 테이블 정체성 픽스처로 교체 + `sourceFileId`·`uploadedBy`·`upload` 인자 단정 추가 | `accept` describe 13건 중 게이트를 지나는 것이 전부 술어에 의존하게 됐다(뮤테이션 M9 에서 7건, M10 에서 5건 사망) |
| M-1 (Min) | 옵션 없는 상품(빈 `combination` 이 계약)의 조합 필드 라벨이 깨진다 | 정규식 `(.+)` → `(.*)`, 스코프키가 비면 접미 생략 | fields spec 2건. 뮤테이션 M14 |
| M-5 (Min) | 권위 컬럼 `pricing_editable` 을 안 읽고 센티넬로 역산 | 파싱 슬라이스가 컬럼을 하나 더 select 해 `base_snapshot` 에 실어 나른다(스키마 변경 없음) | job manager spec 3건. 뮤테이션 M12·M13 |
| M-4 (Min) | 새 라우트에 역할 가드가 없다 | **적용하지 않았다.** 근거는 아래 | — |
| M-2·M-3·M-6 | 고아 아이템 좌표 노출 / 상한 파일 실측 / 오류 문구 | 이연 — Part D 표에 #30·#31·#32 로 실었다 | — |

### M-4 를 적용하지 않은 근거

리뷰는 `RolesGuard('master','admin')` 을 권했고, 지시는 "레포 선례를 직접 확인하되 확신이
없으면 붙이지 말고 보고하라"였다. 확인 결과 **확신이 서지 않아 붙이지 않았다.**

- `catalog` 모듈의 컨트롤러 **24개 중 가드가 있는 것은 1개**(`notices.controller.ts`)뿐이다.
  상품 쓰기 표면 전량(`product-masters`·`product-versions`·`product-approval`·`product-bulk`·
  `product-import`·`product-export`·`pricing`·`channels`…)이 전역 `JwtAuthGuard` 만 쓴다.
- 이 브랜치가 **대체하려는** 두 표면(`product-imports`, `masters/bulk`)이 정확히 그 무가드
  쪽이다. 새 세션 라우트만 조이면 같은 일을 하는 옛 경로는 열린 채 남고, 새 경로를 쓰려던
  정당한 사용자만 막힌다.
- 1단계 컨트롤러(`form-export.controller.ts`, 같은 모듈·같은 워크플로)도 무가드다. 2단계만
  막으면 워크플로가 반만 잠긴다 — 양식은 받을 수 있는데 올릴 수는 없다.
- 레포에는 **경쟁하는 두 관례**가 있고 catalog 는 어느 쪽도 안 쓴다: 역할 이름 기반
  `RolesGuard`(notices·CS·library)와, 더 나중에 도입된 스코프 기반 `@RequireScopes` +
  `ScopeGuard`(inventory·fulfillment — `INVENTORY_SCOPE`/`FULFILLMENT_SCOPE` 상수가 있다).
  **catalog 용 스코프 상수는 없다.**
- 지시가 읽으라고 한 `@app/roles` 는 **이 레포에 존재하지 않는다**(`libs/` 는 authorization·
  db·events·shared 4개뿐). `RolesGuard` 는 `libs/authorization/src/guards/master-role.guard.ts`
  에 있고, 역할 이름을 **자유 문자열로** 받아 `request.user.roles` 와 비교한다. 역할은
  user-service 에서 CRUD 되는 **데이터**라, 실제 MD 운영자가 어떤 역할을 들고 있는지는 이
  레포만 보고 확인할 수 없다.

**권고**: 이 브랜치와 분리해서, (1) catalog 가 역할/스코프 중 무엇을 쓸지 정하고 (2) 실
인증 DB 에서 운영자 역할을 확인한 뒤 (3) `form-export.controller.ts` 와
`bulk-session.controller.ts` 를 **같이** 잠근다. 셋 다 이 픽스 웨이브의 범위 밖이다.

### 재실행 (픽스 후)

```
$ npm run type-check:scoped
> tsc -p tsconfig.spec-scope.json --noEmit          # exit 0, 출력 없음

$ npx eslint <변경된 10개 파일>
eslint exit: 0                                       # 신규 error 0

$ npx jest apps/core/src/modules/catalog/operations/bulk-session/
Test Suites: 5 skipped, 19 passed, 19 of 24 total
Tests:       48 skipped, 325 passed, 373 total       # 299 → 325 (+26)

$ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" \
  npm run test:bulk-session:integration
PASS .../bulk-session-merge.integration.spec.ts
PASS .../bulk-session-lease.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       23 passed, 23 total                     # 22 → 23 (+1)
```

**머지 판정: 머지 가능. 머지 금지 조건 0건.** F.1 #7 이 배포 전 확인 항목으로 내려갔고
(A.5b·Part D #22), 나머지 수동 스모크 8건은 여전히 **전 구간 미수행**이다.

---

## 픽스 웨이브 ② 재리뷰 판정 (2026-08-02, `951b2ddc4`)

최종 전체 브랜치 리뷰의 픽스 웨이브를 스코프 재리뷰에 걸었다. **판정: All findings
addressed, no new Critical/Important breakage — 이 브랜치의 마지막 게이트 통과.**

재리뷰가 독립 검증한 것 중 기록할 가치가 있는 것:

- **I-1 의 대칭성 논증이 코드로 성립한다.** 구현자가 "스냅샷·현재 렌더 쪽에 비대칭을
  만들지 않았다"고 주장한 근거(diff 가 `base[k] ?? ''`·`current[k] ?? ''` 로 읽어
  프리필 쪽에선 키 제거와 빈 문자열이 같은 결과)를 재리뷰가 소비자 **셋 전부**에서
  확인했다 — `bulk-session.diff.ts:12,27-28` 과 `bulk-session.reader.ts:223`, 그리고
  `base`/`current` 의 키를 순회하는 코드가 하나도 없다는 것까지.
- **I-1 이 과교정되지 않았다.** 파서(`bulk-upload.parser.ts` 의 `readSheet` 가
  *모든 매핑 셀이 빈* 행만 건너뛴다)까지 따라가, 상품키 칸이 채워진 채 값 칸만 비운
  구매제약 행은 살아남아 **해제가 여전히 변경분에 들어간다**는 것을 확인했다.
- **I-5 의 뮤테이션 숫자가 정확하다.** `eq(id)` 제거 시 7건, `isNull(snapshot)` 제거 시
  5건 사망을 재리뷰가 손으로 재구성해 일치시켰다. 픽스 전에는 **둘 다 초록이었다.**
- **M-4 미적용 근거 다섯 항목이 전부 사실이다**(catalog 컨트롤러 24개 중 가드는
  `notices` 하나뿐 / `@app/roles` 는 레포에 부재 / catalog 스코프 상수 없음 /
  `product-imports`·`masters/bulk`·1단계 `form-export` 전부 무가드 / `RolesGuard` 는
  자유 문자열을 `request.user.roles` 와 대조).

### 잔여 항목 판정 (컨트롤러 adjudication — 전부 park, 머지 차단 아님)

| # | 항목 | 판정과 근거 |
|---|---|---|
| P-1 | `isBulkBaseSnapshot`(`bulk-session.types.ts:132`)이 `pricingEditable` 의 **타입**을 검사하지 않는다 | **park.** 유일한 writer 가 `toBaseSnapshot` 이고 원본 컬럼이 `boolean notNull` 이라 현실 도달 경로가 없다. 다만 `typeof v.pricingEditable === 'boolean' \|\| v.pricingEditable === undefined` 한 줄로 닫히므로 다음에 이 파일을 여는 사람이 함께 처리할 것 |
| P-2 | 새 라우트에 역할 가드 없음 (M-4) | **park — 별건.** 이 브랜치의 회귀가 아니고(형제 컨트롤러 전부 무가드), 역할명이 user-service DB 데이터라 이 브랜치 안에서 검증할 수 없다. **1단계 `form-export.controller.ts` 와 함께 잠그는 별도 이슈**로 다룬다 — 반쪽만 잠그면 우회 경로가 남는다 |
| P-3 | A.5b 의 M8 라벨이 술어 단위로 읽히고, 웨이브 ② 표의 I-5 커버리지 문장이 과장됐다 | **park.** 절 서두가 "픽스 이전 코드를 그대로 되돌려"라고 밝혀 숫자 자체는 정합하고, 실질(두 술어가 뮤테이션으로 잠긴다)은 성립한다. 문서 정밀도 문제이지 판정을 바꾸지 않는다 |
| P-4 | create 행의 "카테고리 0개"가 유효로 통과 — `bulk-upload.assembler.ts:25-26` 독스트링("대표 카테고리 없는 상품은 만들 수 없다")과 불일치 | **park, 단 4단계 착수 전 결정 필요.** 픽스 전후 동작이 같아 회귀는 아니지만 문서-코드가 어긋난 채 남는다. 신규 상품에 카테고리를 필수로 할지가 스펙 판단이라 이 브랜치에서 임의로 정하지 않는다 |
