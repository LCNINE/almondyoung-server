# K8 PR 10b — 옛 반품·교환·inventory 반품 표·enum DROP (contract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 10 이 코드에서 걷은 옛 core 반품·교환·inventory 반품의 표 일곱·enum 여섯을 스키마에서 지우고 DROP 마이그 하나로 라이브에서도 없앤다.

**Architecture:** contract 마이그 하나 + 스키마 정의 삭제 + 가드가 스키마 파일까지 보게 하기. 새 동작은 없다 — 라이브 코드(PR 10, 태그 `deploy/live/20261028-2229`)는 이미 이 표를 읽지도 쓰지도 않는다. 위험은 마이그 SQL 자체(drizzle 이 만든 DROP 순서)와 라이브에만 있을 수 있는 의존(손으로 만든 뷰·FK·enum 사용 칸)이라, 그 둘을 스크래치 DB 와 읽기 전용 점검 스크립트로 먼저 잡는다.

**Tech Stack:** Drizzle(drizzle-kit 0.31, postgres.js) · Jest(루트) · node(점검 스크립트, `sst shell`).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §5 «PR 10b 로 넘기는 것»·§7(contract 는 맨 마지막, `deploy → migrate`)·§8 PR 10b 행. 이전 PR 본문이 PR 10b 에 넘긴 것:
- PR 10(#1174) N2·Merge Danger — 코드와 DROP 을 나눴다. 🔴 PR 10b 뒤엔 PR 10 이전 Core 로 롤백 금지(옛 K6 SQL 이 모든 라인 수량 읽기에서 없는 표를 읽는다). 배포 전 점검 SQL(옛 표·`business_links`·`order_progress` 0).
- PR 10 계획 «PR 10b 로 넘기는 것» — 지울 이름 목록, `db:generate:core -- --name drop-legacy-claim-tables`, 스크래치 DB 에서 먼저, expand 와 한 배치 금지, 가드의 «스키마 파일 제외» 지우기.
- PR 1~9(#1146~#1173) 본문이 PR 10 에 넘긴 숙제는 PR 10 이 전부 받았다(#1174 본문 «PR 1~9 본문이 넘긴 숙제»). PR 10b 로 직접 넘어온 것은 없다.
- PR 10 의 «알려진 잔여(미룬 Minor)» 넷은 표와 무관하다 — 이 PR 범위 밖이다.

## 결정 (이 계획에서 정한 것)

| # | 결정 |
| --- | --- |
| B1 | **지우는 것은 정확히 표 일곱·enum 여섯이다.** 표: `returns`·`return_items`·`return_requests`·`return_request_items`·`return_refund_attempts`·`exchange_requests`·`exchange_request_items`. enum: `return_status`·`return_request_status`·`exchange_request_status`·`return_reason_code`·`exchange_reason_code`·`return_refund_attempt_status`. 이 밖의 것(`customer_returns` 계열, `PiiSubjectType` 의 옛 두 값 — PR 10 N8, 이벤트 계약 — PR 10 N10)은 남는다 |
| B2 | **가드의 스키마 제외는 필터 한 줄이 아니라 `filesMatchingIn` 의 전역 제외에서 온다.** `line-quantity-read.guard.spec.ts` 의 `filesMatchingIn` 이 모든 테스트에서 `inventory.schema.ts` 를 뺀다(취소 라인 표 정의가 스키마에 있어서). 그래서 PR 10 이 단 `.filter((path) => path !== INVENTORY_SCHEMA)` 만 지우면 가드는 여전히 스키마를 안 본다. 옛 청구 두 테스트만 스키마를 포함해 훑는 `filesMatchingWithSchema` 를 쓴다 |
| B3 | 가드 패턴에 **표·enum 정의 꼴**을 더한다 — `pgTable\(\s*'(returns\|return_items)'`·`pgEnum\(\s*'(return_status\|return_request_status\|exchange_request_status\|return_reason_code\|exchange_reason_code\|return_refund_attempt_status)'`. 기존 패턴은 camelCase·snake 표 이름만 보고 inventory 쪽은 `returnItems` 만 봐서, `returns` 표나 enum 을 다시 정의해도 안 걸린다 |
| B4 | 생성된 마이그는 **적용 전이므로 손으로 고친다**: 첫 줄 `SET LOCAL lock_timeout = '10s';--> statement-breakpoint`(선례 `20261014162912_drop-legacy-line-matching-columns.sql`), 스크래치 DB 롤백 실행이 실패하면 FK → 인덱스 → 표 → enum 순으로 순서를 고친다. 지울 표가 `sales_orders`·`shipments`·`shipment_lines`·`dispatch_attempts`·`skus`·`warehouses`·`locations` 를 FK 로 가리키므로 DROP 은 그 뜨거운 표의 잠금도 잡는다 — 기다리다 트래픽을 막지 않게 10초에서 포기하고, 포기하면 `db:migrate` 를 다시 돌린다 |
| B5 | **읽기 전용 점검 스크립트** `scripts/ops/k8-pr10b-contract-preflight.js`(선례 `scripts/ops/1063-pr4-contract-preflight.js` 꼴). 마이그 파일이 아는 의존은 스크래치 DB 가 잡지만, 라이브에만 있는 뷰·FK·enum 사용 칸은 라이브에서만 보인다. 머지 전 한 번, `db:migrate` 직전 한 번 사람이 돌린다 |
| B6 | 배포는 contract: **`deploy → migrate`**. 이 PR 의 코드 변경은 정의 삭제뿐이라 순서가 틀려도 깨지지 않지만 컨벤션대로 간다. 그 배치에 expand 마이그가 섞이면 `deploy:preflight` 가 1 로 끝난다 — 섞이면 이 PR 을 다음 배치로 미룬다 |
| B7 | ADR(`0017`·`0047`)과 옛 감사 문서의 옛 표 언급은 그대로 둔다 — 그때의 결정 기록이다. 설계 문서 §5·§8 만 고친다 |

## Global Constraints

- 마이그는 이 PR 에 하나: `apps/core/drizzle/<timestamp>_drop-legacy-claim-tables.sql` + `drizzle/meta/` 갱신, `inventory.schema.ts` 와 **한 커밋**(CLAUDE.md «Daily cycle» 5).
- `drizzle-kit push` 금지. generate 는 이 dev 머신에서만.
- 스크래치 DB 는 `almondyoung-server-postgres-1` 컨테이너 안 `k8_pr10b_scratch`(빈 DB 에서 시작). 로컬 DB 로 라이브 질문에 답하지 않는다 — 라이브 의존은 B5 스크립트만 본다.
- 가드·게이트: `npm run type-check` 0 · 루트 `npx jest` 실패는 admin-web 근태 4건(이 PC ICU 기준선)뿐 · `npx jest scripts/ops` 통과.
- 워크트리 루트 type-check 가 `@tauri-apps/plugin-http` 1건이면 `native/warehouse-app/node_modules` 링크가 없는 것이다(코드 문제 아님).

## Review Focus

1. **drizzle 이 낸 DROP 순서가 PG 에서 실패한다**(CASCADE 가 이미 지운 FK·인덱스를 다시 지우려 함) → 스크래치 DB `BEGIN … ROLLBACK` 이 오류 없이 끝나야 한다. → Task 2 Step 5.
2. **빈 DB 부트스트랩**(마이그 141개를 한 트랜잭션에) → 새 스크래치 DB 에서 `drizzle-kit migrate` 가 끝나고 표 일곱·enum 여섯이 없다. 로컬 E2E bootstrap·CI 통합 DB 가 이 경로다. → Task 2 Step 6.
3. **라이브에만 있는 의존**(손으로 만든 뷰, 다른 표의 FK, 옛 enum 을 쓰는 칸) → 점검 스크립트 ②가 0 이 아니면 멈춘다. `CASCADE` 가 그 뷰·FK 를 조용히 지워 버리기 때문이다. → Task 1.
4. **옛 이름이 스키마에 다시 생긴다**(다른 사람이 같은 이름 표를 다시 정의, 머지 충돌 해소 중 블록이 되살아남) → 가드 ①·②가 스키마 파일도 보고 빨갛다. → Task 2 Step 1.
5. **스키마와 스냅샷이 갈린다**(정의를 지웠는데 생성을 빠뜨림, 또는 손으로 고친 SQL 이 스냅샷과 다름) → 마이그 적용 뒤 `db:generate:core` 를 다시 돌려 «No schema changes». → Task 2 Step 7.

---

### Task 1: 읽기 전용 contract 점검 스크립트

**Files:**
- Create: `scripts/ops/k8-pr10b-contract-preflight.js`

**Interfaces:**
- Produces: 사람이 부르는 명령 하나(아래 머리 주석). 다른 Task 가 import 하지 않는다.

- [ ] **Step 1: 스크립트를 쓴다** — `1063-pr4-contract-preflight.js` 의 머리 주석·연결(`SST_RESOURCE_Db` + `DB_TUNNEL_HOST/PORT`, database `core`, `ssl: 'require'`, `max: 1`)·`sql.begin('read only', …)` 꼴을 그대로 따른다. 로컬 검증용으로 `process.env.DATABASE_URL` 이 있으면 그걸 쓴다(그때 `ssl` 없음). 출력 셋:
  - ① 행 수 — 표 일곱 각각 `count(*)::int`(`to_regclass('public.<표>')` 가 null 이면 «이미 없음»), 그리고 옛 행을 가리키던 `business_links where relation_name in ('return_lifecycle_event','exchange_lifecycle_event')`. **게이트: 전부 0**(PR 10 배포 전 점검과 같은 값이어야 한다 — PR 10 이후 쓰는 코드가 없다).
  - ② 바깥 의존 — (a) 일곱 표 밖의 표가 일곱 표를 가리키는 FK(`pg_constraint contype='f'`, `confrelid` ∈ 일곱, `conrelid` ∉ 일곱) (b) 일곱 표에 기대는 뷰·머티리얼라이즈드 뷰(`pg_depend` → `pg_rewrite.ev_class`, 자기 자신 제외) (c) 일곱 표 밖의 칸이 enum 여섯을 쓰는 것(`information_schema.columns.udt_name` ∈ 여섯, `table_name` ∉ 일곱) (d) 함수 인자·반환이 enum 여섯을 쓰는 것(`pg_proc` 의 `proargtypes`/`prorettype`). **게이트: 전부 0행**.
  - ③ 상태 — 표·enum 이 남은 개수(migrate 전 7·6, 뒤 0·0). 대기 마이그 판정은 `deploy:preflight` 가 하므로 여기선 하지 않는다.

- [ ] **Step 2: 스크래치 DB 를 만들고 돌려 본다** —
  ```bash
  docker exec almondyoung-server-postgres-1 createdb -U postgres k8_pr10b_scratch
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/k8_pr10b_scratch npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/k8_pr10b_scratch node scripts/ops/k8-pr10b-contract-preflight.js
  ```
  (접속 문자열은 `apps/core/.env` 의 사용자·암호·포트에 맞춘다.) Expected: ① 전부 0 ② 전부 0행 ③ 표 7·enum 6. 그다음 스크래치 DB 에서 `create view tmp_v as select id from return_requests;` 를 만들고 다시 돌려 ②(b)가 `tmp_v` 를 보이는지 확인한 뒤 `drop view tmp_v;`.

- [ ] **Step 3: Commit**
  ```bash
  git add scripts/ops/k8-pr10b-contract-preflight.js
  git commit -m "K8 PR10b — 옛 반품 표 DROP 전 라이브 점검 스크립트(행 수·바깥 의존, 읽기 전용)"
  ```

### Task 2: 스키마 정의 삭제 + DROP 마이그 + 가드가 스키마까지 본다

**Files:**
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts:30-44,105-128`
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` — 지우는 곳: `returnStatusEnum`(118-124), RETURNS 블록 `returns`·`returnItems`(2432-2488 근처, 머리 주석 포함), `wmsTables` 의 `returns,`·`returnItems,`(4042-4043), 타입 `Return`·`NewReturn`·`ReturnItem`·`NewReturnItem`(5233-5238), RETURN / EXCHANGE REQUEST 블록 전체(5348-5556: enum 다섯·표 다섯·`returnExchangeTables`·`returnExchangeSchema`·타입 열)
- Create: `apps/core/drizzle/<timestamp>_drop-legacy-claim-tables.sql`, `apps/core/drizzle/meta/<timestamp>_snapshot.json`, Modify: `apps/core/drizzle/meta/_journal.json`(생성물)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §5(«PR 10b 로 넘기는 것» 뒤), §8 PR 10b 행

**Interfaces:**
- Consumes: Task 1 의 스크립트(Step 8 에서 마이그 뒤 상태 확인).
- Produces: 없음(지우는 Task).

- [ ] **Step 1: 가드를 먼저 고친다(빨강)** — `filesMatchingWithSchema(predicate)` 를 더한다: `filesMatchingIn` 과 같되 `SCHEMA_FILE` 을 빼지 않는다(`walk` 는 그대로 — 스펙·`__support__`·`__fixtures__` 제외). `retired legacy claims stay gone`·`inventory 옛 반품은 다시 오지 않는다` 두 테스트를 이걸로 바꾸고 `.filter((path) => path !== INVENTORY_SCHEMA)` 와 `INVENTORY_SCHEMA` 상수를 지운다. B3 의 정의 꼴 둘을 각 패턴에 더한다(`LEGACY_CLAIM_IDENTIFIERS` 에 `pgEnum\(\s*'(return_request_status|exchange_request_status|return_reason_code|exchange_reason_code|return_refund_attempt_status)'`, inventory 패턴에 `pgTable\(\s*'(returns|return_items)'` 와 `pgEnum\(\s*'return_status'`). 두 블록 머리 주석을 «PR 10b 가 DROP 했다 — 스키마 포함 어디서든 이 이름이 다시 나오면 빨갛다»로 고친다.

- [ ] **Step 2: 빨강을 본다** — `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts`. Expected: 두 테스트 FAIL, 받은 값 `["apps/core/src/modules/inventory/schema/inventory.schema.ts"]`. 나머지 테스트는 PASS(전역 제외는 그대로라 취소 라인 테스트가 안 흔들린다).

- [ ] **Step 3: 스키마 정의를 지운다** — 위 Files 목록 그대로. 지운 뒤 `git grep -n -E "returnStatusEnum|returnRequest|returnRefundAttempt|exchangeRequest|returnExchange|\breturnItems\b|\bNewReturn\b|\bReturnItem\b|type Return\b" -- apps/core/src libs` 이 0 이어야 한다(가드 스펙 패턴 문자열 자체는 제외). 이제 안 쓰게 된 import(`json` 등)가 생기면 함께 지운다 — 다른 표가 쓰면 남긴다.

- [ ] **Step 4: 마이그를 만든다** — `npm run db:generate:core -- --name drop-legacy-claim-tables`. 이 PR 은 추가가 없어 rename 질문이 나올 수 없다 — 나오면 다른 변경이 섞인 신호이니 멈추고 `git diff` 를 본다. 생성된 SQL 이 표 일곱 DROP·enum 여섯 DROP 뿐인지 읽는다. 첫 줄에 `SET LOCAL lock_timeout = '10s';--> statement-breakpoint` 를 넣는다(B4).

- [ ] **Step 5: 스크래치 DB 에서 롤백 실행(Review Focus 1)** — Task 1 의 `k8_pr10b_scratch`(마이그 140개 적용 상태)에서:
  ```bash
  ( echo 'BEGIN;'; sed 's/--> statement-breakpoint//' apps/core/drizzle/<timestamp>_drop-legacy-claim-tables.sql; echo 'ROLLBACK;' ) \
    | docker exec -i almondyoung-server-postgres-1 psql -U postgres -d k8_pr10b_scratch -v ON_ERROR_STOP=1
  ```
  Expected: `ROLLBACK` 까지 오류 없음. `constraint … does not exist`·`index … does not exist` 면 그 줄을 지우거나 FK → 인덱스 → 표 → enum 순으로 옮기고 다시 돌린다. 그다음 실제 적용: `DATABASE_URL=…/k8_pr10b_scratch npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → 성공.

- [ ] **Step 6: 빈 DB 부트스트랩(Review Focus 2)** —
  ```bash
  docker exec almondyoung-server-postgres-1 createdb -U postgres k8_pr10b_scratch_fresh
  DATABASE_URL=…/k8_pr10b_scratch_fresh npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  ```
  Expected: 성공. 두 스크래치 DB 모두 `select count(*) from pg_class where relname in (<표 일곱>) and relkind = 'r'` = 0, `select count(*) from pg_type where typname in (<enum 여섯>)` = 0.

- [ ] **Step 7: 스냅샷 일치(Review Focus 5)** — `npm run db:generate:core -- --name should-be-empty` → «No schema changes, nothing to migrate». 파일이 생기면 Step 3·4 를 다시 본다(생긴 파일은 지운다).

- [ ] **Step 8: 점검 스크립트로 뒤 상태 확인** — `DATABASE_URL=…/k8_pr10b_scratch node scripts/ops/k8-pr10b-contract-preflight.js` → ① 전부 «이미 없음» ② 0행 ③ 표 0·enum 0. 그리고 preflight 분류: `npx tsx -e "import { readFileSync } from 'fs'; import { classifyMigration } from './scripts/ops/batch-deploy-preflight.lib'; console.log(classifyMigration(readFileSync('apps/core/drizzle/<timestamp>_drop-legacy-claim-tables.sql','utf8')))"` → `kind: 'contract'`(`mixed`·`expand` 면 SQL 에 DROP 아닌 것이 섞였다).

- [ ] **Step 9: 초록과 게이트** — `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts` PASS · `npm run type-check` 0 · 루트 `npx jest` 실패는 근태 4건뿐 · `npx jest scripts/ops` 통과.

- [ ] **Step 10: 설계 문서** — §5 «PR 10b 로 넘기는 것» 바로 뒤에 «PR 10b 에서 확정한 결과» 블록: B1(지운 표·enum 목록), B2·B3(가드가 스키마까지 본다), B4(lock_timeout·고친 순서가 있으면 그 내용), B5(점검 스크립트 경로), 🔴 PR 10 이전 Core 롤백 금지. §8 PR 10b 행 비고에 «결과는 §5 의 «PR 10b 에서 확정한 결과»».

- [ ] **Step 11: Commit**(스키마·마이그·meta·가드·설계 한 커밋)
  ```bash
  git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md
  git commit -m "K8 PR10b — 옛 반품·교환·inventory 반품 표 일곱·enum 여섯 DROP, 가드가 스키마 파일까지 본다"
  ```
  스크래치 DB 둘은 남겨 두고 PR 본문에 이름을 적는다.

---

## 배포 (PR 본문 Merge Danger 로 옮긴다)

- **Door: one-way.** DROP 뒤엔 표·enum 이 없다(0행이라 잃는 데이터는 없다). 🔴 **Core 는 PR 10(태그 `deploy/live/20261028-2229`) 이전으로 롤백 금지** — 옛 K6 SQL 이 모든 라인 수량 읽기에서 없는 표를 읽는다. PR 10 이후 Core 로 롤백하는 것은 괜찮다(그 코드는 표를 안 읽는다).
- **머지 전:** 사용자가 `npx sst tunnel --stage live` 를 띄우고 `cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k8-pr10b-contract-preflight.js)"` → ① 전부 0 ② 전부 0행. 아니면 멈추고 그 행·의존을 본다.
- **배치:** `npm run deploy:preflight -- --stage live` 가 이 마이그를 contract 로, 같은 배치에 expand 가 없음을 보여야 한다(B6). 섞였으면 이 PR 은 다음 배치.
- **순서: `sst deploy`(services) → 롤아웃 끝 확인 → 점검 스크립트 한 번 더 → `npm run db:migrate -- --stage live --deployment lcnine-services --yes`.** `lock_timeout` 에 걸려 실패하면 트래픽이 적을 때 migrate 만 다시 돌린다(한 트랜잭션이라 반쯤 적용은 없다).
- **배포 뒤:** 점검 스크립트 ③ 표 0·enum 0, `deploy:preflight -- --mark-deployed` 로 대기 마이그 0 확인 후 태그. core 로그에 `relation "return_requests" does not exist` 류 0.
