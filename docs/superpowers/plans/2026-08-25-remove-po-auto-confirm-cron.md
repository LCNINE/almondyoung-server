# 발주 자동 확정 크론 제거 (#724 항목 1)

- 이슈: #724 항목 1 (발견 ①)
- 근거 문서: `docs/inventory-procurement-audit-2026-08.md` §2 ①
- 마이그레이션: **0건**
- 범위: `apps/core` 백엔드만. admin-web 변경 없음.

## 왜 복구가 아니라 제거인가

당초 계획은 "매일 밤 `TypeError` 로 죽는 크론을 살린다"였다. 결함은 실재했고 고쳤으나
(raw `sql` 에 JS `Date` 바인딩 + 프로세스 TZ 의존), **설계 검토에서 기능 자체가 축이 틀렸다는
결론이 나왔다.** 근거는 진단 문서 §2 ① 의 "더 큰 사실" 절이 소유한다. 요약하면:

- `confirmed` 가 곧 가시성 스위치인데(`on_order_qty` 는 뷰에서 `0` 고정), 크론은 그 스위치를
  **도착 당일까지 미룬다** — 주문~도착 구간 전체가 사각지대가 된다. 중국 해상 운송이면 수 주~수 개월.
- `expected_arrival` 은 nullable 인데 조건이 날짜 일치라, **ETA 를 모르는 발주는 영원히 안 보인다.**
- 중국 창고 도착일은 판매 가능 시점이 아니다(비판매 창고). 상태 전이 트리거로 삼을 이정표가 아니다.
- 확정은 이미 사람이 하는 행위다(`PUT /:id/status` + admin-web 버튼). 크론은 능력이 아니라 정책이다.

**결정적 함의**: 크래시라서 여태 아무 일도 안 일어났다. **고친 채로 배포하면 원치 않는 자동
전환이 실제로 돌기 시작한다.** 지금은 `audit_status='approved'` 필터가 우연히 방벽 노릇을
하지만(기본값 `draft`), D1 이 심사 축 제거로 가면 그 방벽도 사라진다. 그래서 복구본을 배포하지
않고 제거한다.

## 이 PR 이 하는 일

1. `purchase-order-cron.service.ts` 삭제
2. `inbound.module.ts` providers 에서 제거
3. 끝. 마이그레이션·설정·이벤트 변경 없음.

복구 과정에서 만들었던 `time.util` 헬퍼(`toSeoulDateOnly` / `seoulDayBoundsForNaiveTimestamp`)와
그 스펙도 **함께 되돌렸다** — 크론이 유일한 소비자였고, 소비자 없는 export 를 남기면 죽은 코드다.
발견한 사실들은 코드가 아니라 진단 문서에 남겼다.

## 이 제거로 잃는 것

없다. 크론은 한 번도 성공한 적이 없으므로 제거로 사라지는 동작이 없다. `created` 상태로 남아
있던 발주는 그대로 남고, 사람이 확정하면 지금과 똑같이 계획이 생긴다.

## 다음 단계 — 합의된 3단계 중 1단계다

사용자와 합의한 접근(2026-08-25):

| 단계 | 내용 | 마이그 | 상태 |
|---|---|---|---|
| **1** | **크론 제거** (이 PR) | 0 | 이 PR |
| 2 | 발주 **라인 생명주기** 도입 | additive | 미착수 |
| 3 | 헤더 `expected_arrival`·심사 축 정리 (contract) | 있음 | D1 대기 |

2단계의 배경: 실무는 발주서를 만든 뒤 직원이 **라인을 하나씩** 실제 발주 실행한다. 실행 순간
**수량·단가·도착예정일이 확정되고, 아예 못 사는 라인도 생긴다**(사용자 확인). 한 라인을 나눠서
두 번 사는 일은 없다 — 그래서 별도 실행 테이블 없이 라인에 컬럼을 붙이는 평평한 모델로 충분하다.

지금 스키마는 이걸 담지 못한다:

| 필요 | 현재 |
|---|---|
| 라인 상태 (요청/발주됨/발주불가) | 없음 |
| 실발주 수량 (요청과 별개) | 없음 — `quantity` 한 벌 |
| 라인별 ETA | 없음 — 헤더 `expected_arrival` 뿐 |
| 단가 | `unit_price` nullable — **이미 실행 시점 확정을 전제한 모양** |

입고 쪽은 이미 준비돼 있다: `inbound_plan_items` 는 자체 `id`·`status` 를 갖고
`InboundService.addInboundPlanItems()` 라는 증분 포트가 있다. 다만 라인별 ETA 는
`inbound_plans.expected_date`(plan 단위)에 담을 수 없다 — plan 을 쪼개면
`purchase-order-single-plan.integration.spec.ts` 가 지키는 "해외 발주는 계획 하나" 불변식이
깨지고 이중계상이 되살아난다. 예정일은 `inbound_plan_items` 로 내려가야 하고, 파이프라인 ①의
ETA 계산(`min(plans.expected_date)`)도 따라온다.

**2단계는 항목 4(`inbound_plans` writer 단일화)가 선행이다.** 라인마다 계획에 붙이려면
`createInboundPlanFromPO`(재구현본)를 없애고 `addInboundPlanItems` 포트로 통일해야 한다.

2단계 설계는 별도 스펙(`docs/superpowers/specs/`)으로 쓴다.

## 부수적으로 확인한 사실 (코드 변경 없음, 진단 문서에 기록)

- **발견 ⑪** — `inbound.service.ts:997` 의 `isSameSeoulDay(nowSeoul(), …)` 이중 변환.
  KST 15:00–24:00 의 당일 입고 취소가 전부 400 으로 거부된다(실측 재현). §3 권고 표 9번.
- **drizzle raw `sql` 에 `Date` 바인딩 함정** — 같은 함정의 미수정 사례가
  `apps/notification/src/shared/services/metrics.service.ts:54` 에 있다(다른 앱, 범위 밖).
- **jest 안에서는 `process.env.TZ` 를 바꿔도 로컬 타임존이 안 바뀐다** — 테스트가 vm
  컨텍스트에서 돌아 Node 의 env setter 가 그 컨텍스트의 Date 타임존 캐시를 무효화하지 못한다.
  TZ 를 오가는 in-process 스윕은 **통과하면서 아무것도 검증하지 않는 no-op** 이 된다. 그런
  테스트가 필요하면 자식 프로세스로 내보내고, 하네스가 실제로 존을 바꿨는지부터 단언할 것.
- **`@IsDateString()` 은 오프셋·naked datetime 을 통과시킨다** — `'2026-08-26T00:00:00+09:00'`
  는 naive `timestamp` 컬럼에 `'2026-08-25 15:00'` 으로 저장돼 날짜가 하루 밀린다. 현재
  admin-web 은 `<input type="date">` 라 안 나지만 API 계약이 막지는 않는다. 2단계에서 라인 ETA
  컬럼을 만들 때 `date` 타입을 쓰면 이 문제가 구조적으로 사라진다.
