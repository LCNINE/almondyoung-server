# 피킹 계획을 작업 항목 배정 장부로 흡수한다

ADR-0030 을 부분 대체한다(계획 층의 «존재»를 대체, 3방식 diff ≤ 4 공유 규칙은 새 배정 층에 그대로 적용된다).
설계: `docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md`.

## Decision

- `picking_plans`·`picking_plan_members` 를 없앤다. 배정(`picking_source_allocations`)은 `work_item_id` 로
  작업 항목에 매단다. 「이 박스가 이 배치에 있다」는 작업 항목 한 곳에만 적힌다.
- 「계획 초안 → 시작」을 「배치 시작」 한 번으로 합친다(`startBatchPicking`). 배정과 인계가 한 트랜잭션이라
  계획이 낡을 틈이 없고, 초안·무효화·재계획 장치가 통째로 필요 없다.
- 배치 시작이 배정하는 대상은 `queued` 뿐이 아니라 `UNSTARTED_BATCH_WORK_ITEM_STATUSES`(`queued`·`picking`)
  전부다 — 시작 전 피커의 선점(claim)은 허용된다. 시작 전에는 재고 세션이 없어 custody 자체가 존재하지 않으므로,
  `picking` 상태가 «이미 집기 시작함」을 뜻하지 않는다.
- 세션 신원은 «세션의 계획 id»가 아니라 «세션의 배치 id»다. HAND_IN payload 는 `batchId`·`workItemId`·`allocationId`.
- 배치의 전략은 컬럼이 아니라 `STRATEGY_BY_PICKING_METHOD[pickingMethod]` 로 도출한다(스펙 §4.2 의 `batches.strategy` 는 두지 않는다).

## Why

계획은 배치의 「고정된 집합」 사진이었고, 같은 사실(박스가 배치에 있다)을 작업 항목과 계획 구성원 두 곳에
적은 뒤 둘의 일치를 강제했다. 그 이중 기록 때문에 시작된 배치에 박스를 넣을 길도, 결품 외에 뺄 길도 없었다.
고정이 지켜 주던 것은 대체된다: 배정은 변경마다 잠금 아래 그 박스 몫만 정하고(지금 배정은 위치 id 순 선착이라
집합 전체를 볼 때만 얻는 최적화가 없다), 복구는 배정마다 이벤트 합과 대조한다.

기각: 계획을 남기고 구성원에 합류·은퇴 수명주기를 주는 안 — 이중 기록이 남아 모든 연산이 둘을 함께
움직여야 하고, 재합류에 «구성원 세대» 장치가 다시 필요하다.

## Consequences

- 발송의 «계획 구성원 버전 스냅샷» 검사가 사라진다. 배정 합 = 줄 수량, 송장 manifestVersion 일치, 예약 소진이
  함께 같은 것을 증명한다.
- 시작된 배치에 박스를 추가하면 `OUTBOUND_BATCH_ALREADY_STARTED`. 합류는 S1-B 가 연다.
- 배포는 expand(`work_item_id` 추가, `plan_id` NULL 허용) → contract(계획 테이블·`plan_id` 삭제) 두 번.
- `started_at` 이 NULL 인데 작업 항목이 `picking` 을 넘어선 배치(이 전환 이전에 만들어진 배치)가 있을 수 있다.
  단순출고는 이를 새 409 코드가 아니라 기존 준비 차단 표지 `ACTIVE_WORK_REQUIRES_REVIEW` 로 낸다 —
  현장 앱 계약(`SIMPLE_OUTBOUND_PLAN_INVALIDATED`)은 그대로 두고 `invalidatedPlanId` 는 항상 `null`.
