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

## 🔴 CI 는 이 브랜치를 사실상 검증하지 않는다

`.github/workflows/` 를 직접 확인했다 — `apps/medusa` 전체 tsc 도, `coupon-`/`promotion-meta`
통합 스펙도 CI 워크플로에 없다. CI 의 medusa 유닛 테스트는 transpile-only 라 타입을 안 본다.
**즉 이 브랜치를 지키는 건 사람이 로컬에서 돌리는 명령뿐이다.** 아래 「게이트별 실측 결과」의
명령들이 그 방어선 전부다 — 다음 회귀가 있다면 이 명령들을 다시 돌리는 사람이 유일한 방어선이다.

admin-web 쪽도 마찬가지다: **`npm run test:admin-web` 의 jest 는 transpile-only 라 타입을
검사하지 않는다.** admin-web 의 타입 회귀는 `cd apps/admin-web && npx tsc --noEmit` 로만 잡힌다.

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
`coupon_grant` 테이블·인덱스 2개·파셜 유니크 인덱스(`WHERE deleted_at IS NULL`)·
`issued_via` CHECK 제약을 만든다. 이 SQL 이 어떤 자동 검증을 통과하는지는 **테스트 종류에
따라 다르다** (medusa `node_modules/@medusajs/test-utils` 소스를 직접 읽어 확인):

- **모듈 통합 러너(`--modules`, `moduleIntegrationTestRunner`)는 이 마이그레이션 파일을
  실행하지 않는다.** `pathToMigrations` 를 안 넘기므로 `getPendingMigrations()` 가 항상
  비어 `orm.schema.refreshDatabase()`(DML 모델에서 스키마 합성)로 빠진다. 즉
  `--modules --testPathPattern 'promotion-meta'` 가 초록이어도 **손으로 쓴 마이그레이션
  SQL 자체는 한 번도 실행된 적이 없다.**
  - 이게 중요한 이유: `coupon-grant.ts` DML 모델은 유니크 인덱스를 **파셜이 아니라 full** 로만
    선언할 수 있다(모델 파일 자체의 주석이 이걸 명시한다 — DML DSL 이 partial 조건을 표현
    못함). `issued_via` 의 CHECK 제약도 DML 모델엔 아예 없다(마이그레이션에만 있다). 모듈
    테스트가 통과해도 이 두 가지(파셜 인덱스가 실제로 파셜인지, CHECK 제약이 실제로 걸리는지)는
    **아무것도 검증되지 않는다.**
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

## 배포 순서 (`migrate → deploy`, expand)

1. **`npm run db:migrate` 는 이 케이스에 별도로 부를 필요가 없다.** Medusa 는 컨테이너 CMD가
   자체 `medusa db:migrate --execute-safe-links` 를 부르므로, **`sst deploy` 가 새 Medusa
   태스크를 띄우는 순간이 곧 migrate 시점이다** — `coupon_grant` 는 모듈 마이그레이션이라
   이 경로로만 적용된다. 롤링 중 옛 태스크는 새 테이블을 모르고 링크 테이블만 보므로 안전하다
   (expand 컨벤션 그대로 — additive 만 있고 옛 코드를 깨지 않는다).
2. `sst deploy`
3. **백필 1회 — dry-run 먼저.** `src/scripts/backfill-coupon-grants.ts` 는 기존
   customer↔promotion 링크 행을 `coupon_grant` 로 1장씩 이관한다.
   ```
   medusa exec ./src/scripts/backfill-coupon-grants.ts
   GRANT_BACKFILL_DRY_RUN=false GRANT_BACKFILL_CONFIRM=backfill-coupon-grants \
     medusa exec ./src/scripts/backfill-coupon-grants.ts
   ```
   🔴 **이 백필을 빠뜨리면 기존에 발급된 쿠폰이 전부 사라진 것처럼 보인다.** 판정 로직이
   이제 `coupon_grant` 를 보는데, 백필 전에는 grant 행이 0개이기 때문이다 — 고객 마이페이지에
   보유 쿠폰이 0장으로 뜨고, 이미 발급받은 고객이 재발급을 시도하면 "처음 발급"으로 처리된다.
   dry-run 이 기본값이고(`GRANT_BACKFILL_DRY_RUN` 미설정 시 dry-run), 실제 반영은 확인값
   (`GRANT_BACKFILL_CONFIRM=backfill-coupon-grants`)을 명시해야만 실행된다 — 실수로 반영되는
   걸 막는 장치이지, 실행 자체를 건너뛰어도 되는 장치가 아니다.
4. 백필 후 검증: `SELECT count(*) FROM coupon_grant;` 가 (백필이 이관한) 링크 행 수와 같은지
   확인한다. dry-run 로그의 `created` 합계와도 대조한다.

## 배포 후 확인

- **스키마 실측** (위 "모듈 마이그레이션 SQL" 절의 근거): 아래가 실제로 생겼는지 확인한다.
  ```sql
  -- 파셜 유니크 인덱스가 실제로 partial 인지 (WHERE 절 있어야 함)
  SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_coupon_grant_issue_key';
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
