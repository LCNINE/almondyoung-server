# 쿠폰 그랜트 모델 배포 노트 (#488)

이 브랜치는 쿠폰 「한 장」을 여러 장으로 만드는 14태스크 작업이다. 구현은 전부 끝났다.
이 문서는 배포 담당자가 실제로 해야 할 일과, 로컬 게이트를 돌릴 때 브리프를 그대로 믿으면
빠지는 함정을 적는다.

## 게이트 명령 — 브리프 원문 두 개는 틀렸다

Task 14 브리프(`task-14-brief.md`) Step 1 의 아래 두 줄은 **이 저장소에서 동작하지 않거나
아무것도 검증하지 않는다**. 다음 사람이 브리프를 그대로 복붙하면 같은 함정에 빠진다.

1. **`cd apps/admin-web && npx jest` 는 동작하지 않는다.** `apps/admin-web` 에 jest 설정도
   transform 도 없어 전 스펙이 `SyntaxError: Cannot use import statement outside a module`
   로 죽는다(직접 재현 확인). **올바른 명령은 저장소 루트의 `npm run test:admin-web`.**
2. **루트 `npm run type-check` 는 `apps/medusa` 와 `apps/admin-web` 을 «둘 다» 제외한다.**
   그 게이트가 0 이어도 이 브랜치가 만든 코드(medusa 쪽 대부분, admin-web 쪽 전부)를 본 적이
   없다는 뜻이다. 실질 타입 게이트는 **`cd apps/medusa && npx tsc --noEmit`** 와
   **`cd apps/admin-web && npx tsc --noEmit`** 다.

## 🔴 상시 구멍 — CI 는 medusa tsc 도, 어떤 통합 스펙도 돌리지 않는다

이건 이 브랜치의 사정이 아니라 **저장소의 상태**다. 고쳐지기 전까지 계속 참이다.

`.github/workflows/` 를 직접 확인했다 — `apps/medusa` 전체 tsc 도, `coupon-`/`promotion-meta`
통합 스펙도 CI 워크플로에 **없다**. CI 의 medusa 유닛 테스트는 transpile-only 라 타입을 안
본다. admin-web 도 같다: `npm run test:admin-web` 의 jest 는 transpile-only 다.

**결과: `apps/medusa` 와 `apps/admin-web` 의 타입 회귀와 통합 회귀는 PR 초록을 그대로
통과한다.** 이 트리를 만지는 모든 작업에서 아래 네 명령이 유일한 방어선이다.

```
scripts/local/run-medusa-integration.sh --testPathPattern 'integration-tests/http/'
scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'
cd apps/medusa && npx tsc --noEmit
cd apps/admin-web && npx tsc --noEmit   # 루트 npm run type-check 는 이 트리를 제외한다
```

이 구멍을 닫는 것(=CI 에 위 네 줄을 넣는 것)은 이 브랜치의 범위가 아니지만, **다음 사람이
가져가야 할 부채**다.

## 게이트별 실측 결과 (2026-09-02 실행)

| 게이트 | 명령 | 결과 |
|---|---|---|
| 루트 type-check | `npm run type-check` | exit 0, 출력 없음 |
| 루트 jest | `npx jest --maxWorkers=2` | 522 passed / 0 failed (109 skipped, DB 가드) — Suites 631, Tests 5422 |
| admin-web 타입 | `cd apps/admin-web && npx tsc --noEmit` | exit 0, 출력 없음 |
| admin-web jest | `npm run test:admin-web` | 98 passed / 0 failed (1 skipped) — Tests 828 passed / 18 skipped |
| medusa 타입 | `cd apps/medusa && npx tsc --noEmit` | exit 2, **선재 3건**(develop 조상 커밋 소유, 이 브랜치가 만들지 않음). 증가 0 |
| medusa 유닛 | `cd apps/medusa && npm run test:unit` | 36 suites / 354 tests 전부 PASS |
| 모듈 통합 (promotion-meta) | `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'` | 5 suites / 78 tests 전부 PASS |
| HTTP 통합 (coupon- 스코프) | `scripts/local/run-medusa-integration.sh --testPathPattern 'integration-tests/http/coupon-'` | 8 suites / 94 tests 전부 PASS |
| HTTP 통합 (전체, 최종 확인) | `scripts/local/run-medusa-integration.sh --testPathPattern 'integration-tests/http/'` | **10 suites / 108 tests 전부 PASS** (T6 재작성 후 재실행 — 아래 "스코프 구멍" 절) |
| 어휘 드리프트 가드 | `npx jest --testPathPattern 'coupon-vocabulary-drift' --maxWorkers=2` | 1 suite / 12 tests 전부 PASS |

### ⚠️ `--testPathPattern 'coupon-'` (브리프 원문)를 그대로 쓰면 워크트리 이름이 또 오염시킨다

브리프 Step 1 이 지시한 문자 그대로의 명령은
`scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'` 이다. 이 워크트리
경로가 `.claude/worktrees/coupon-grant-model` 이라 `coupon-` 패턴이 **작업 디렉터리 절대경로
자체**에 걸려, 진짜 `coupon-*.spec.ts` 8개 외에 `health.spec.ts` 와
`deferred-approval-checkout.spec.ts` 까지 같이 돈다(CLAUDE.md 가 경고하는 워크트리 이름 오염과
같은 부류의 함정 — Task 4 리포트가 이미 한 번 이 현상을 기록했다). 실행 결과:

```
Test Suites: 1 failed, 9 passed, 10 total
Tests:       1 failed, 107 passed, 108 total
```

**진짜 `coupon-*.spec.ts` 8개는 전부 통과한다**(위 표의 "HTTP 통합 (coupon- 스코프)" 행 — 좁힌
패턴 `integration-tests/http/coupon-` 로 재실행해 확인). 실패는 오직
`deferred-approval-checkout.spec.ts` 의 테스트 하나다:

```
● C1: public 쿠폰 사용이 발급 링크를 만들면 안 된다 › 발급된(assigned_only) 쿠폰으로 주문을
  완료하면 그 링크 행에 used_at/order_id 가 채워진다 (T6)

  expect(received).not.toBeNull()
  Received: null
    > expect(row.used_at).not.toBeNull();
```

**이건 이 브랜치가 만든 진짜 회귀였다 — 처음엔 고치지 않고 보고만 했으나, 오케스트레이터
지시로 재작성해 고쳤다** (아래 "이 태스크가 발견하고 고친 것" 절). 이 테스트("T6")는
customer↔promotion 링크 행의 `used_at`/`order_id` 가 주문 완료 시 채워지는 *옛* 동작을
검증했다. 그런데 이 브랜치의 `record-coupon-usage.ts`(`eb62421f2` 에서 도입)는 주문 완료 시
링크 행이 아니라 `coupon_grant.used_at` 을 `consumeGrant()` 로 채운다 — 링크 행 쓰기는 더
이상 일어나지 않는다. `deferred-approval-checkout.spec.ts` 는 `coupon-` 로 시작하지 않는
파일명이라 이 브랜치의 여러 태스크가 돌린 "coupon- 전체 재실행" 관례적 회귀 확인에 한 번도
걸리지 않았고(각 태스크 리포트가 쓴 패턴은 `integration-tests/http/coupon-` 로 좁혀져 있어
이 파일을 스코프 밖에 뒀다), CI 도 이 스펙을 안 돌리므로 Task 14 전까지 아무도 못 봤다.

## 어휘 드리프트 가드

`npx jest --testPathPattern 'coupon-vocabulary-drift' --maxWorkers=2` — PASS, 12/12.
어휘(`issued_via`, `auto_issue_trigger`)를 이 브랜치가 늘리지 않았다는 뜻이므로 통과가 정상이다.

## 배포 전 실측 SQL (결과는 #488 코멘트에 남길 것 — 이 노트는 쿼리만 제공)

```sql
-- ① use_by_attribute 예산을 가진 활성 프로모션. 0이면 아무 조치도 필요 없다.
SELECT count(*) FROM promotion p
  JOIN campaign c ON c.id = p.campaign_id
  JOIN campaign_budget b ON b.campaign_id = c.id
 WHERE p.status = 'active' AND b.type = 'use_by_attribute';
```

0이 아니면 그 프로모션들은 엔진 예산과 grant 가 이중으로 제약한다(더 엄격한 쪽이 이긴다).
기능상 안전하나 관리자에게 설명되지 않는 거절이 생기므로 detach 를 검토한다.
**이 쿼리는 라이브 DB 에서 실행해야 의미가 있다 — 이 태스크는 로컬/개발 DB만 접근했으므로
숫자를 채우지 않았다.**

## 🔴 모듈 마이그레이션 SQL — 배포가 첫 실행인 경로와, 로컬에서 이미 여러 번 실행된 경로가 갈린다

`apps/medusa/src/modules/promotion-meta/migrations/Migration20260902100000.ts` 가
`coupon_grant` 테이블·보조 인덱스 3개(`customer_id`·`promotion_id`·`order_id`)·파셜 유니크
인덱스(`WHERE deleted_at IS NULL`)·`issued_via` CHECK 제약을 만든다. 이 SQL 이 어떤 자동 검증을 통과하는지는 **테스트 종류에
따라 다르다** (medusa `node_modules/@medusajs/test-utils` 소스를 직접 읽어 확인):

- **모듈 통합 러너(`--modules`, `moduleIntegrationTestRunner`)는 이 마이그레이션 파일을
  실행하지 않는다.** `pathToMigrations` 를 안 넘기므로 `getPendingMigrations()` 가 항상
  비어 `orm.schema.refreshDatabase()`(DML 모델에서 스키마 합성)로 빠진다. 즉
  `--modules --testPathPattern 'promotion-meta'` 가 초록이어도 **손으로 쓴 마이그레이션
  SQL 자체는 한 번도 실행된 적이 없다.**
  - ✅ **정정(2026-09-02 전체 리뷰 — 옛 서술은 틀렸다).** 「DML 이 partial 을 표현 못 해
    모듈 러너의 인덱스는 full」은 **사실이 아니다.**
    `@medusajs/utils/dist/dml/helpers/entity-builder/build-indexes.js` 의
    `transformIndexWhere` 가 **모든 DML 인덱스에** `deleted_at IS NULL` 을 주입한다(where 가
    없으면 그것을 박고, 있으면 `AND deleted_at IS NULL` 을 덧댄다 — 예외 없음). 즉 모듈
    러너가 합성하는 스키마의 유니크 인덱스도 **파셜이고**, 회수 후 재발급은
    `src/modules/promotion-meta/__tests__/service.integration.spec.ts` 의
    「회수(soft delete) 후 같은 issue_key 로 재발급된다 — 파셜 유니크」가 **실제로 검증한다**.
    모델 파일(`models/coupon-grant.ts`)의 옛 주석도 같이 고쳤다.
  - ⚠️ **CHECK 제약 쪽은 옛 서술이 맞다.** 모델에 `.checks()` 가 없으므로 모듈 러너가
    만드는 스키마엔 `coupon_grant_issued_via_check` 가 **없다**. 어휘를 벗어난 `issued_via`
    값은 모듈 통합 스펙에서 안 걸린다 — 그 방어선은 마이그레이션(=실 DB)뿐이다.
- **HTTP 통합 러너(`medusaIntegrationTestRunner`, `coupon-*.spec.ts` 가 쓰는 경로)는 다르다.**
  `medusa-test-runner.js` 가 `migrateDatabase(appLoader)` 를 명시적으로 부른다 — 로그로
  직접 확인: `coupon-*.spec.ts` 8개를 이번에 실행하며 "Migrating Migration20260902100000" /
  "✔ Migrated Migration20260902100000" 가 스펙 파일마다(임시 DB를 새로 만들 때마다) 여러 차례
  찍혔다. 즉 **이 마이그레이션의 SQL 문법·제약·인덱스는 이미 로컬에서 여러 번 실제로 실행되고
  성공했다** — 단, 매번 **임시로 만들었다 지우는 test DB** 위에서다. `coupon-admin.spec.ts` 의
  "auto-issues by trigger, is idempotent, and RE-ISSUES after revoke" 케이스가 통과했다는
  것은, 회수(soft delete) 후 재발급이 그 파셜 유니크 인덱스에 의존하는 시나리오이므로 파셜
  인덱스가 실제로 파셜로 만들어졌다는 간접 증거이기도 하다.

**결론**: SQL 자체의 구문·제약 오류 위험은 낮다(HTTP 통합 스펙이 반복 검증했다). 하지만
**개발/라이브의 영속 DB에 대해 이 마이그레이션이 실제로 적용되는 건 배포가 처음이다** — 임시
test DB 와 달리 기존 데이터·기존 스키마 상태·컨테이너 부팅 경합(리더 선출 없음, 여러 태스크가
동시에 `ADD CONSTRAINT` 를 시도할 수 있음 — 그래서 마이그레이션 파일 자체가 `DROP CONSTRAINT
IF EXISTS` 를 먼저 하는 방어를 넣어뒀다)이라는 변수가 남는다. **배포 후 확인 항목에 인덱스·
제약이 실제로 생겼는지 검사를 반드시 넣을 것** (아래 배포 후 확인 참고).

## 계약 변경 2건 (배포 순서에 영향 없음 — 기록용)

1. **`POST /admin/customers/:id/promotions` 의 `submit_id` 가 필수가 됐다** (없으면 400).
   서버가 만들어 주던 시절엔 재도착마다 새 키라 따닥이 곧 두 배 발급이었다. 유일한
   admin-web 클라이언트(`medusaPromotionsApi.assignToCustomer`)는 **오늘 소비자가 0곳**이라
   깨질 화면이 없고, 그 클라이언트도 `submitId` 를 보내도록 같이 고쳤다. 외부 호출자는 없다
   (형제 라우트 `POST /admin/promotions/:id/customers` 는 처음부터 필수였다).
2. **카트 게이트가 `COUPON_NOT_STARTED` 를 낼 수 있게 됐다.** 전에는 「아직 시작 전」이
   `COUPON_EXPIRED` 로 뭉개졌다(그리고 장을 가진 고객에겐 아예 검사되지 않았다 — 아래
   "고친 것" 참고). 스토어프론트(`web/almondyoung-storefront`)에 그 토큰의 매핑과 문구를
   같이 넣었다. 스토어프론트가 늦게 배포되면 그 구간에는 전용 문구 대신 일반 실패 토스트가
   뜰 뿐이고, **거절 자체는 정상 동작한다** — 배포 순서 제약이 아니다.

## 배포 순서 (`migrate → deploy`, expand)

1. **`npm run db:migrate` 는 이 케이스에 별도로 부를 필요가 없다.** Medusa 는 컨테이너 CMD가
   자체 `medusa db:migrate --execute-safe-links` 를 부르므로, **`sst deploy` 가 새 Medusa
   태스크를 띄우는 순간이 곧 migrate 시점이다** — `coupon_grant` 는 모듈 마이그레이션이라
   이 경로로만 적용된다. 롤링 중 옛 태스크는 새 테이블을 모르고 링크 테이블만 보므로 안전하다
   (expand 컨벤션 그대로 — additive 만 있고 옛 코드를 깨지 않는다).
2. `sst deploy`
3. **백필 1회 — dry-run 먼저.** `src/scripts/backfill-coupon-grants.ts` 는 기존
   customer↔promotion 링크 행을 `coupon_grant` 로 1장씩 이관한다.

   ### 🔴 이건 「빠뜨리면 화면이 이상해진다」가 아니다 — **장애 구간**이다

   **새 태스크가 트래픽을 받기 시작한 순간부터 백필이 끝날 때까지, 기존에 발급된 모든
   쿠폰이 «없는 것»이 된다.** 판정의 정본이 링크 행에서 `coupon_grant` 로 옮겨갔는데 그
   테이블이 아직 비어 있기 때문이다. 구체적으로 그 창 안에서:

   - **카트에 안 붙는다.** `assigned_only`/`claimable` 쿠폰을 코드로 입력하면
     `COUPON_NOT_ASSIGNED` 400 이다(발급 개념이 없는 `public` 쿠폰만 계속 동작한다).
   - **마이페이지에서 사라진다.** 보유 쿠폰이 0장으로 뜬다.
   - **🔴 `claimable` 을 이미 받은 고객이 다시 받을 수 있다.** grant 가 없으니 「이미 받음」
     판정이 서지 않아 **두 번째 장이 실제로 발급되고 `issued_count` 도 한 번 더 깎인다.**
     이건 화면 문제가 아니라 되돌리기 어려운 데이터 변화다.

   그래서 이 창은 **분 단위로 짧게** 유지한다. `sst deploy` 가 끝나 새 태스크가 뜬 것을
   확인하는 즉시 백필을 돌린다. 트래픽이 적은 시간대를 고르는 것이 좋다.

   ### 환경마다 한 번씩 — dev 와 live 는 별개다

   백필은 **DB 단위**로 1회다. `dev` 에서 돌렸다고 `live` 가 되지 않는다. 두 환경 각각에
   대해 (a) 배포 → (b) dry-run → (c) 실제 반영 → (d) 검증을 따로 수행한다.

   ### 배포된 ECS 태스크에서 부르는 법

   `medusa exec` 는 컨테이너 **안에서** 돌아야 한다(스크립트가 컨테이너의 DI 컨테이너를
   받는다). 로컬에서 라이브 DB 를 향해 부르지 말 것 — 다른 env 로 뜬 모듈 설정이 섞인다.
   ECS Exec 으로 실행 중인 Medusa 태스크에 붙는다:

   ```bash
   # ① 대상 태스크 ARN 확인 (클러스터·서비스 이름은 sst 콘솔/`aws ecs list-services` 로)
   aws ecs list-tasks --cluster <cluster> --service-name <medusa-service> --desired-status RUNNING

   # ② 셸을 연다 (태스크에 enableExecuteCommand 가 켜져 있어야 한다)
   aws ecs execute-command --cluster <cluster> --task <task-arn> \
     --container <medusa-container> --interactive --command "/bin/sh"

   # ③ 컨테이너 안에서 — dry-run 먼저
   npx medusa exec ./src/scripts/backfill-coupon-grants.ts

   # ④ 로그의 created/skippedExisting 수를 확인한 뒤에만 실제 반영
   GRANT_BACKFILL_DRY_RUN=false GRANT_BACKFILL_CONFIRM=backfill-coupon-grants \
     npx medusa exec ./src/scripts/backfill-coupon-grants.ts
   ```

   `enableExecuteCommand` 가 꺼져 있으면 그 태스크엔 붙을 수 없다 — 그때는 같은 이미지·같은
   env 로 일회성 태스크를 띄워(`aws ecs run-task` + command override) ④ 만 실행한다.

   dry-run 이 기본값이고(`GRANT_BACKFILL_DRY_RUN` 미설정 시 dry-run), 실제 반영은 확인값
   (`GRANT_BACKFILL_CONFIRM=backfill-coupon-grants`)을 명시해야만 실행된다 — 실수로 반영되는
   걸 막는 장치이지, 실행 자체를 건너뛰어도 되는 장치가 아니다.

   ### 재실행은 안전하다 (2026-09-02 전체 리뷰 이후)

   스크립트는 **「(쿠폰, 고객) 쌍에 살아있는 장이 하나라도 있으면 만들지 않는다」** 로
   건너뛴다. 유니크 인덱스(=`issue_key` 일치)만 믿던 옛 버전은 **개통 후 재실행이 공짜
   쿠폰을 찍어냈다** — 배포 후 생긴 링크 행은 `issued_via` 가 비어 `issue_key='legacy'` 로
   떨어지는데 라이브 발급이 쓴 키는 `${submit_id}:${n}` 이라 중복으로 안 읽혔기 때문이다.
   dry-run 도 같은 판정을 쓰므로, 반영이 끝난 뒤의 dry-run 은 `created=0` 이 정상이다.

4. **백필 후 검증.**
   - `SELECT count(*) FROM coupon_grant;` 가 dry-run 로그의 `created` 합계와 일치하는지.
   - 반영 후 dry-run 을 한 번 더 돌려 **`created=0` / `skippedExisting=<링크 수>`** 인지.
     0 이 아니면 그만큼이 아직 안 옮겨진 것이다.
   - 표본 고객 한 명으로 마이페이지에 쿠폰이 다시 보이는지, 카트에 붙는지.

### ↩️ 롤백 주의 — `down()` 은 테이블을 통째로 지운다

`Migration20260902100000.down()` 은 `DROP TABLE "coupon_grant"` 다. **개통 이후에 되감으면
그 사이에 만들어진 모든 grant 가 사라진다** — 백필로 이관한 과거분은 링크 행이 남아 있어
다시 백필할 수 있지만, **개통 후 새로 발급된 장(관리자 발급·클레임·자동 발급)과 사용
기록(`used_at`/`order_id`)은 복구할 방법이 없다.** 링크 행에는 더 이상 그 정보가 안 실린다.

즉 이 마이그레이션의 롤백은 **개통 직후 짧은 창에서만** 실질적으로 안전하다. 그 뒤에
문제가 생기면 되감지 말고 앞으로 고친다(코드 롤백은 가능하다 — 테이블을 남겨두면 된다).

## 배포 후 확인

- **스키마 실측** (위 "모듈 마이그레이션 SQL" 절의 근거): 아래가 실제로 생겼는지 확인한다.
  CHECK 제약은 모듈 통합 스펙이 **한 번도 안 보는** 것이라 여기가 유일한 확인 지점이다.
  ```sql
  -- 파셜 유니크 인덱스가 실제로 partial 인지 (WHERE 절 있어야 함)
  SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_coupon_grant_issue_key';
  -- order_id 인덱스 (restoreGrantsByOrder 가 order.canceled 마다 탄다)
  SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_coupon_grant_order';
  -- CHECK 제약이 실제로 걸렸는지
  SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'coupon_grant_issued_via_check';
  ```
- 발급 → 마이페이지에 장수 표시 → 주문 → 장 1개 소모 → 취소 → 장 복구
- 발급 버튼 따닥 → 장수가 안 늘어남 (파셜 유니크 인덱스가 지키는 불변식)
- 백필 후 `SELECT count(*) FROM coupon_grant;` 가 예상 행 수와 일치

## 남은 미지수 (설계 §11, `docs/superpowers/specs/2026-09-02-coupon-grant-model-design.md`)

1. `use_by_attribute` 예산 보유 활성 프로모션 수 — 위 SQL, 라이브 미실행
2. 전액 환불이 `order.canceled` 없이 끝나는 경로가 있는가 — 있으면 A2 가 그만큼 안 닫힌다
3. `almond_user_id` 없는 라이브 고객 수 — 많으면 「미해결」 케이스가 자주 뜬다
4. 브라우저 수동 확인 0회 — 새 발급 다이얼로그. #488 리허설 2차 몫

## 이 태스크가 발견하고 고친 것 — `deferred-approval-checkout.spec.ts` T6

위 "⚠️" 절에 적은 것과 같다: `record-coupon-usage.ts` 가 링크 행이 아니라 `coupon_grant` 를
갱신하도록 바뀌면서, 링크 행의 `used_at`/`order_id` 를 검증하던 옛 테스트 하나(T6)가 깨졌다.
이 브랜치의 13개 선행 태스크 중 어느 리포트에도 이 파일이 언급되지 않는다 — `coupon-` 로
시작하지 않는 파일명이라 관례적 회귀 확인 패턴(`integration-tests/http/coupon-`)의 스코프
밖에 있었고, CI 도 이 스펙 자체를 안 돌린다. 이 태스크는 브리프 원문의 넓은 패턴(`coupon-`)이
워크트리 이름과 우연히 충돌한 덕에 이걸 발견했다.

**코드는 틀리지 않았다 — 테스트가 옛 계약을 보고 있었다.** 사용 기록의 정본이 grant 로 옮겨간
것은 이 브랜치의 의도한 설계다. 하지만 T6 이 지키던 불변식(「체크아웃이 완료되면 사용이
기록된다」)은 여전히 지켜야 하고, 이건 이 브랜치에서 자동 테스트가 못 덮는다고 명시했던 구간
(주문 완료 → 장 소모, 「이 플랜이 끝나도 남는 것」 표 참고)에 실제로 도달하는 몇 안 되는
테스트라 특히 아까웠다. 그래서 **재작성했다**(폐기하지 않음) — 단언을 링크 행 대신
`listGrantsForCustomer` 로 가져온 grant 로 바꿨고, 「무언가 기록됐다」가 아니라 「발급된
그 한 장이 정확히 그 주문으로 소모됐다」(`toHaveLength(1)` + `used_at`/`order_id` 값 확인)를
보도록 강화했다. C1(같은 describe 블록의 다른 테스트 — public 쿠폰이 링크 행을 만들면 안
된다)은 원래부터 링크 행을 봐야 하는 불변식이라 그대로 뒀다. 상세 diff·근거·재실행 결과는
`task-14-report.md` 의 "Fix: T6 재작성" 절.

## 🕳 스코프 구멍 — 다음 사람에게

**이 브랜치의 회귀 확인은 `coupon-` 접두사 스펙으로 돌렸고, 그 때문에
`deferred-approval-checkout.spec.ts` 의 stale 테스트를 마지막(Task 14)에야 발견했다.** 쿠폰
경로를 만지는 스펙이 그 이름 규칙 밖에도 있다 — 파일명 접두사만으로 스코프를 정하면
사각지대가 생긴다. Task 14 이후로는 `integration-tests/http/` 전체(파일 10개, 이 브랜치가
`apps/medusa` 에 스펙을 새로 추가하지 않는 한 이게 전량이다)를 최종 확인으로 한 번 더
돌렸다 — 결과는 `task-14-report.md` 참고. 다음 브랜치에서 쿠폰/프로모션 관련 코드를 다시
만지면, 접두사가 아니라 **디렉터리 전체**를 스코프로 잡을 것.
