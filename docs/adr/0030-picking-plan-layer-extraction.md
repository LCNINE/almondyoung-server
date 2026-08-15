# 피킹 계획 층은 전략 어댑터 바깥의 단일 순수 함수 모듈로 둔다

출고작업 피킹의 세 전략 어댑터(`discrete` / `pick_to_tote` / `aggregate_then_sort`)가 **계획 층 전체를 손으로 복사**하고 있었다. 이 ADR 은 그 중복을 어디까지 어떤 형태로 통합할지에 대한 결정과 근거를 못 박는다. 설계 스펙은 `docs/superpowers/specs/2026-08-15-picking-plan-layer-design.md`.

[[0026-version-cow-targeted-decomposition]] 과 짝을 이룬다. 그건 "같은 규칙이 네 번 복사됐다"는 전제를 **측정으로 반증해 통합을 기각한** 사례이고, 이건 같은 종류의 측정이 **통합을 지지한** 사례다. 근거의 형식이 같으니 나란히 읽어야 한다.

## Decision

- **계획 층을 `fulfillment/picking/plan/` 의 단일 함수 모듈로 추출한다.** 대상은 `plan` · `start` 와 그들이 쓰는 잠금·조회·검증 헬퍼 총 14개(3벌 합계 2,832줄 → 1벌 944줄).

- **경계는 측정된 diff 로 긋는다 — diff ≤ 4 인 것만 공유한다.** 전략명 정규화 후 메서드별 diff 를 재면 분포에 **빈 구간**이 있다:

  | 층 | 메서드 | discrete↔pick_to_tote | discrete↔aggregate |
  |---|---|---|---|
  | 계획 (공유) | `lockAggregate` `lockSourceCapacities` `plan` `start` `planStalenessReason` `assertActivePlanSession` | **0 ~ 4** | ~1 ~ 41† |
  | custody (전략별) | `unpickShipment` `handoff` `completePick` `scan` | 11 ~ 64, 상이 | 82 ~ 108, 상이 |

  † `plan` 의 41줄은 의미 차이가 아니다 — `aggregate_then_sort` 만 `plannedResult()` 를 뽑아 썼고 나머지 둘은 인라인이다. `discrete↔pick_to_tote` 의 diff 4줄은 전부 문자열 리터럴(`'picking.discrete.plan'`)이다.

  **custody 층은 통합하지 않는다.** completePick 의 diff 108/128 은 "복사 후 살짝 수정" 이 아니라 진짜 다른 로직(`BULK_CART → SORTING → PACKING` vs `WORKER → PACKING`)이다. 이걸 hook 으로 밀어 넣으면 ADR-0026 이 경계한 "본문이 전부 hook 인 과추상화" 가 된다.

- **계획 층은 전략에 의존하지 않는다는 사실이 이 경계의 근거다.** 옮길 메서드 안에서 `this.capabilities` 는 오직 `.name` 문자열로만 쓰인다(14 지점). `requiresPhysicalTote` / `supportsAggregateSourcePick` 로 분기하는 곳은 **0곳**. 따라서 `strategyName` 인자 하나면 전략 무관해진다.

- **`PickingStrategy` interface 에서 `plan` / `start` 를 제거한다.** 호출자는 `PickingProcessService` 단 한 곳이었고, 특히 `start` 는 `picking_plans.strategy` 를 읽어 registry 에서 전략 객체를 꺼낸 다음 **전략 무관 코드를 부르고** 있었다. 창고 허용 검사(`registry.resolveForWarehouse`)는 유지한다.

- **상속(추상 base class)이 아니라 순수 함수 모듈로 한다.** 2층 구조: 8개는 `(trx, …)` 만 받는 순수 함수, 진입점 `plan`/`start` 는 `PickingPlanDeps`(6필드) 를 받는다. 측정상 옮길 14개 중 협력자를 쓰는 건 6개뿐이고 `dbService` 는 아예 안 쓴다.

- **곁다리 둘을 같이 정리하되 별도 커밋으로 분리한다.** `requestedStrategy`(실호출자 0) 제거, 이중 창고 검사(`assertWarehouseConfiguration`, 에러코드 참조자 0) 제거. 둘 다 각각 revert 가능해야 한다.

## Why this shape

검토한 대안과 채택/기각 이유:

- **(a) 추상 base class (template method)** — 기각. 처음엔 이쪽을 추천했다. 근거는 세 전략의 생성자가 동일(8개, tote 만 +1)하고, **단위 스펙이 private 메서드를 이름으로 34회 mock** 하는데 상속이면 `jest.spyOn` 이 그대로 살아 "테스트를 한 줄도 안 고치고 통과" 가 가능하다는 것이었다. 그 추천은 **틀렸다** — 진짜 안전망은 mock 쪽이 아니었다(아래 참조). 게다가 base class 는 `protected` 멤버까지가 사실상 interface 라 seam 이 넓어지고, Nest DI 가 상속과 잘 맞지 않아 서브클래스마다 생성자와 `@InjectTypedDb()` 를 재기입해야 한다.

- **(b) 주입되는 협력 객체 (`PickingPlanService`)** — 기각. seam 은 좁지만 전략에 얕은 위임 스텁 3벌이 남고, "전략 객체가 전략 무관 연산의 소유자인 척하는" 구조가 그대로다. `plan`/`start` 를 interface 에서 빼기로 한 이상 위임 대상 자체가 필요 없다.

- **(c, 채택) 순수 함수 모듈** — 채택. 결정적 근거는 **통합 스펙 6개(39 test)가 `spyOn` 을 0회 호출한다**는 측정이다. 실 DB 로 진짜 전략 객체를 만들어 public interface 로만 구동하므로, private 메서드가 통째로 사라져도 **한 줄도 안 고치고 통과한다.** 즉 행동 동일성 증거가 리팩터 형태와 무관하게 보존된다. 깨지는 34개 mock 은 애초에 **옮길 로직을 걷어내던 것들**이라 리팩터 후엔 존재 이유가 없다.

  > 이 판단 근거는 코드를 읽어서는 재구성할 수 없다. "단위 스펙 34개가 깨지니 상속이 안전하다" 는 논증이 겉보기에 그럴듯한데, `grep -c spyOn` 을 통합 스펙에 돌려 봐야만 그게 틀렸음을 안다. 다음에 같은 판단을 할 사람이 같은 실수를 하지 않도록 여기 남긴다.

- **착수 시점 — 토탈피킹 개통 전에 한다.** `git log` 전수 결과 세 전략이 공존한 이후 이 디렉터리를 건드린 커밋 **4개가 전부 3파일을 함께 수정했다(4/4, 예외 0)**. 토탈피킹은 카페24·셀메이트를 버리고 자체 시스템으로 나온 도입 목적 자체이므로 반드시 켜지며, 그 전 실험도 예상된다. 지금 실험하면 그 실험을 3번 반복하게 된다.

## Consequences

- `fulfillment/picking/` 5,888줄 → 약 4,060줄 (**−1,888**). core 전체 클론 클러스터 14개 중 13개가 사라진다.
- 다음 계획 층 변경이 3파일 → 1파일. 네 번째 피킹 방식 추가 비용이 ~2,000줄 → `scan` + custody hook.
- **배송정보 규칙이 3벌→1벌로 줄지만 5벌 문제는 남는다.** `assertRecipientComplete`/`assertProfileComplete` 는 `assertPlanningEligibility` 안에서만 호출되어 자동으로 따라온다. 그러나 `outbound-batch-orchestrator.service.ts` 와 `shipment-planning.service.ts` 의 2벌은 그대로이고, **`shipment-planning.service.ts:1437` 은 같은 에러코드를 쓰면서 발송인 이름·전화번호 검사를 빠뜨린 더 느슨한 벌이다.** 강도 통일은 `delivery_profiles` 프로덕션 실측이 선행돼야 해서 별도 이슈로 남긴다.
- 기본 게이트 커버리지는 크게 오르지 않는다(~50%). `plan`/`start` 본문 339줄은 여전히 DB 게이트 뒤에서만 검증된다. **효과는 "덮이지 않는 코드가 3벌에서 1벌로 주는 것"이다.**
- 계약 스펙 `definePickingStrategyContract` 가 검증하던 "세 전략이 같은 계획 절차를 쓴다" 는 **검증할 대상 자체가 사라진다.** 계약 스펙에는 custody 층 계약만 남는다.
- 마이그레이션 0건, 이벤트 계약 변경 0건, secret/env 변경 0건.

## 재검토 트리거

- **공유층에는 3전략 diff ≤ 4 로 측정된 것만 들어간다.** 새 로직을 `plan/` 에 넣기 전 그 측정을 다시 한다. 이 규칙이 없으면 함수 모듈이 자석처럼 custody 로직을 끌어당긴다.
- custody 층(`completePick` / `handoff` / `unpickShipment`)의 세 벌이 **측정상 수렴하면** 그때 같은 방식으로 다시 검토한다. 현재 diff 는 각각 64~108 로 멀다.
- 네 번째 피킹 방식이 계획 층에 **분기**를 요구하면(예: 방식별로 다른 로케이션 결정 규칙) 그 시점에 `PickingPlanDeps` 에 전략 hook 을 추가할지, 계획 층을 다시 쪼갤지 재검토한다. 지금은 그런 분기가 0곳이라 hook 을 미리 만들지 않는다.
