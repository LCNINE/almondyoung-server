# 서울 당일 판정 이중 변환 + 입고계획 생성 락 (#724 항목 11 · 10-a)

- 이슈: #724 항목 **11**(발견 ⑪) · 항목 **10-a**(파킹 1)
- 근거 문서: `docs/inventory-procurement-audit-2026-08.md` §2 ⑪ / `2026-08-25-purchase-order-line-lifecycle.md` "남은 것"
- 마이그레이션: **0건**
- 범위: `apps/core` 백엔드만. admin-web 변경 없음.
- 왜 둘을 같이: 서로 독립이고 둘 다 작다. 10-a 는 항목 12(admin-web 라인 실행 UI)의 **선행**이라
  12 착수 전에 들어가 있어야 한다.

## 항목 11 — `isSameSeoulDay(nowSeoul(), …)` 이중 변환

### 증상

`POST /inbound/receipts/:id/cancel` 계열의 당일 취소가 **KST 15:00~24:00 에 전부 400**
(`cancel is allowed only on the same day (Asia/Seoul)`). 창고 저녁 근무 시간과 정확히 겹친다.

### 기전

`apps/core/src/modules/inventory/inbound/services/inbound.service.ts:1074`

```ts
if (!isSameSeoulDay(nowSeoul(), receiptRow.occurredAt)) { … }
```

- `nowSeoul()` = `toZonedTime(new Date(), 'Asia/Seoul')` — **이미 시프트된 Date** 를 돌려준다.
- `isSameSeoulDay` 는 두 인자에 각각 `toSeoulTime` 을 **다시** 건다.
- 그래서 왼쪽만 오프셋이 두 번 먹는다. 프로세스 TZ 가 UTC 면 `now + 18h` vs `occurredAt + 9h`
  → **기준 "오늘"이 9시간 앞선다.** KST 15:00 부터 다음 날로 넘어가 당일 영수증이 어제가 된다.

### ⚠️ 로컬에서는 재현되지 않는다

`toZonedTime` 은 **런타임 TZ 에 상대적**이다. 개발 머신은 `Asia/Seoul` 이라 두 번 걸어도
사실상 항등이고 버그가 사라진다. 라이브(ECS/Lambda)는 UTC 라 터진다.
**따라서 스펙은 `TZ=UTC` 를 강제해야 하고, 그러지 않으면 RED 단계가 거짓 GREEN 이 된다.**

### 고칠 방법

호출부만 고치면(`isSameSeoulDay(new Date(), …)`) 같은 오용이 언제든 재발한다 — `nowSeoul()` 은
export 돼 있고 이름이 "지금"이라 자연스럽게 손이 간다. 그래서 **오용이 불가능한 표면**을 만든다:

```ts
/** 인자는 '진짜 순간'(UTC 기준 Date)이어야 한다. nowSeoul() 을 넘기지 말 것 — 이중 변환된다. */
export function isTodaySeoul(instant: Date | string | number, now: Date = new Date()): boolean
```

- 호출부는 `isTodaySeoul(receiptRow.occurredAt)` 하나로 줄어 `nowSeoul()` 을 아예 안 만진다.
- `now` 를 주입 가능하게 둬 스펙이 벽시계를 고정할 수 있다.
- `isSameSeoulDay` 자체는 **원시 순간 두 개에 대해서는 옳다** — 건드리지 않고 경고 주석만 단다.

## 항목 10-a — `createInboundPlan` 에 `FOR UPDATE` 없음

`inbound.service.ts:646` 의 `createInboundPlan` 은 PO 를 잠그지 않고 읽은 뒤
`inbound_plans` 존재를 검사하고 insert 한다. 같은 PO 로 동시 `POST /inbound/plans` 2건이면
둘 다 "계획 없음"을 보고 **계획 2행**을 만든다 → 그 PO 전 SKU 의 `inbound_pending` 2배.

`ensurePlanForPurchaseOrder` (`:709`) 는 이미 PO 를 `.for('update')` 로 잠그고 같은 검사를
하지만, 공개 `POST /inbound/plans` 는 그 경로를 안 거친다. 유니크 제약을 안 쓰는 이유는
기존 주석이 소유한다(라이브에 PO 하나당 계획 둘인 행이 남아 있을 수 있어 마이그레이션이
배포 중 실패할 위험).

**고칠 방법**: PO select 에 `.for('update')` 추가 (1줄).

### 잠금 불변식과의 정합

계획서 "잠금 불변식": **PO 행 → 라인 행 순서로만 잠근다.** 이 편집은 PO 행만 추가로 잠그고
라인은 안 잠그므로 순서를 깨지 않는다. `ensurePlanForPurchaseOrder` → `createInboundPlan(…, trx)`
경로는 같은 트랜잭션에서 같은 행을 다시 잠그는 것이라 no-op 이다(자기 데드락 없음).

## 테스트 (TDD — 실제로 일어난 일)

| # | 스펙 | 종류 | RED 가 증명한 것 |
|---|---|---|---|
| 1 | `shared/services/time.util.spec.ts` | 유닛 | `isTodaySeoul` 부재(15/15 실패) |
| 2 | `inbound.service.same-day-cancel.integration.spec.ts` | DB 통합 | **`TZ=UTC` 로 띄웠을 때만** 라이브 400 이 재현됐다 |
| 3 | `inbound-plan-concurrent-create.integration.spec.ts` | DB 통합, 커밋형 | 두 번째 요청이 계획을 하나 더 만들었다(`created`) |

### 🔴 첫 RED 가 거짓 GREEN 이었다 — 기록해 둔다

2번 스펙을 처음 썼을 때 **수정 없이 통과했다.** 원인은 스펙 안의 TZ 고정이 무효였던 것:

- **jest 안에서 `process.env.TZ` 를 바꿔도 먹지 않는다.** 실측했다 — 할당 전후로
  `new Date().getTimezoneOffset()` 이 `-540` 그대로고 `Intl…resolvedOptions().timeZone` 도
  `Asia/Seoul` 그대로다. (jest 밖 순수 node 에서는 런타임 할당이 먹는다 — 그래서 더 헷갈린다.)
- 개발 머신이 `Asia/Seoul` 이라 `toZonedTime(x, 'Asia/Seoul')` 이 **항등**이 되고,
  이중 변환과 정상 코드가 **문자 그대로 같은 함수**가 된다. 서울 머신에서는 이 버그를
  어떤 테스트로도 관측할 수 없다.

**따라서 TZ 는 프로세스를 띄울 때 박아야 한다:**

```bash
TZ=UTC DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
  npx jest --testPathPattern=same-day-cancel.integration --runInBand
```

이 스펙의 **방어력은 CI 에서 나온다**(러너가 UTC). 서울 머신 로컬 실행은 통과하지만
아무것도 증명하지 않는다. 스펙 헤더에 이 사실을 적어 뒀다 — 무효한 TZ 조작 코드를
남겨 두면 다음 사람이 "고정돼 있네"라고 오독한다.

> 파생 질문(이 PR 범위 밖): **jest 를 UTC 로 띄우는 게 맞지 않나.** 라이브가 UTC 인데
> 테스트가 KST 로 돌면 이 부류 전체가 로컬에서 안 보인다. `globalSetup` 으로 워커 포크
> 전에 박으면 되지만, 다른 날짜 스펙들의 폭발 반경을 재야 해서 별도 항목이어야 한다.

## 검증 게이트

- `npm run type-check` → **0** ✅
- `npx jest --maxWorkers=2` → **470 suite 통과 / 실패 0** (99 suite 는 DB 가드로 skip) ✅
- DB 통합 스위트 → **내 변경이 만든 실패 0건** (아래 기준선 대조) ✅
- 신규 2개 스펙을 `TZ=UTC` · `TZ=Asia/Seoul` · `TZ=America/New_York` 에서 각각 실행 → 전부 통과 ✅

### 통합 스위트 기준선 대조 (숫자를 그냥 읽으면 오독한다)

러너 패턴이 `integration` 이라 **다른 서비스 스펙까지 딸려 온다** — analytics·channel-adapter·
membership 은 각자 DB 가 필요한데 `DATABASE_URL` 은 core 를 가리키므로 통째로 빨갛다.
전체 19 suite 실패 중 core 는 8 suite 뿐이고, 그중 3개는 전용 scratch DB 를 요구하는
환경 가드다(`variant_preview_scratch` 등).

**그래서 숫자 대신 기준선과 대조했다** — `git stash -u` 로 변경을 걷어내고 같은 8 suite 를
같은 DB 에 다시 돌렸다:

| | Test Suites | Tests | 실패 항목명 |
|---|---|---|---|
| 기준선(develop) | 8 failed | 12 failed / 12 passed | 13건 |
| 현재(이 변경 포함) | 8 failed | 12 failed / 12 passed | 13건 |

실패 항목명 13건이 **문자열까지 동일**(diff 결과 없음). 이 변경이 만든 실패는 0건이다.

발주·입고 계열은 전부 초록이다 — `purchase-order-single-plan` · `inbound-plan-port-invariant` ·
`purchase-order-line-execution` · `cancel-plan-restore` · `plan-receive` + 신규 2개.

## 배포

마이그레이션 0건이므로 `deploy` 만. 순서 제약 없음. 계약 변경 없음(400 이 사라지는 방향이라
admin-web 은 손댈 것이 없다).

## 범위 밖 — 발견해서 남기는 것

`nowSeoul()` 오용이 **한 군데 더 있다**: `inventory/shared/services/audit.service.ts:311` 이
`audit_logs.timestamp` 에 `nowSeoul()` 을 그대로 insert 한다 → 라이브 감사 로그의 모든 행이
**9시간 미래**로 저장되고, 같은 파일의 `fromDate`/`toDate` 필터(진짜 순간)와 어긋난다.

여기서 같이 고치지 않는 이유: 고치는 순간 **옛 행(+9h)과 새 행(정상)이 섞여** 감사 로그 시간축이
두 벌이 된다. 백필을 할지(어느 시점부터?) 말지가 사람의 결정이라 별도 항목이어야 한다.
`fulfillment/services/policies.service.ts:27` · `sales-order/services/policies.service.ts:31` 의
`nowSeoul()` 비교도 같은 부류이나 **세 갈래가 전부 `return policy` 라 죽은 비교**다(무해).
