좋습니다. SO는 손대지 않고 FO만으로 합포장을 운영하려면, “FO=송장 1장/상자 1개”라는 정의를 더 엄격히 하고, FO가 여러 SO/SOL을 품을 수 있도록 구성하세요. 아래처럼 설계하면 매끄럽습니다.

핵심 개념

SO/SOL은 불변(상거래 사실의 기록), 변경은 채널 이벤트로만 들어옵니다.

FO/FOL이 합포장 조합의 SoT입니다. 하나의 FO가 여러 SO의 라인(SOL)을 수량 단위로 품습니다.

재고 예약은 SOL 기준으로 유지하고, 피킹·패킹은 FO 기준으로 실행합니다.

최소 스키마(요점만)

sales_orders(id, channel, channel_order_id, state, ship_to, …)

sales_order_lines(id, so_id, sku_id, qty, cancelled_qty, …)

fulfillment_orders(id, state, ship_to_hash, carrier_service, latest_ship_by, …)

fulfillment_order_lines(id, fo_id, so_id, sol_id, sku_id, qty) ← 합포장의 핵심 연결

stock_reservations(id, sol_id, sku_id, qty_reserved, …) ← SOL 기준 예약

예약은 SOL에 걸려 있고, FOL은 “이 예약을 어느 FO로 집행할지”의 라우팅만 담당합니다.

합포장 정책(Eligibility)

합포장 후보를 고를 때 최소 다음 키를 맞추세요.

목적지 동일성: ship_to_hash(이름/전화/주소를 정규화+해시)

운송정책 일치: carrier_service, 착불/선불 여부, 위험물 여부

SLA/출고 마감: latest_ship_by(늦은 쪽을 전체 SLA로 채택하면 리스크↑)

채널 정책: 같은 채널만 허용(권장). 크로스채널은 정산 이슈가 커서 기본 금지.

홀드 윈도우: 예) 결제 후 2~4시간 내 주문만 합포장 고려

운영 플로우(자동/수동 공통)

후보 수집(Queue)

이벤트로 들어온 SO/SOL을 “합포장 후보 풀”에 넣고 위 정책으로 그룹핑.

FO 구성(Compose)

그룹당 FO 1건 생성 → 해당 그룹 안의 SOL들을 FOL로 매핑(수량 단위).

카토나이제이션(부피/중량 기반 박스 선정) 후 운임/라벨 사전견적.

재고 연계

피킹 전 단계(allocated)에서는 SOL 예약만 존재. FO가 pick 지시를 내리면 예약을 consume → pick.

락킹

state=locked_for_pick 진입 시 구조 변경 금지(합포장/분할 모두 Stop). 락 기준은 “피킹 시작” 또는 “라벨 발급” 중 하나로 사내 표준화.

피킹/패킹/출고

피킹리스트는 FO 기준으로 출력(아이템 옆에 원 SO번호 표기 필수).

출고 시 트래킹번호 1개를 각 원 SO에 통지(채널이 여러 주문-한 송장 수신을 지원하면 API, 미지원이면 내부 reconciliation_issue 생성 + 수기 CS).

이미 만들어진 FO들을 “합치기” (두 경로)

A안(권장): 초기에 SO 들어올 때 FO를 만들지 말고 후보 풀→단일 FO 구성으로만 운영.

B안(필요 시): 이미 생성된 FO들(드래프트/할당 상태)을 **“라인 이동”**으로 합침

대상 FO_A(유지)·FO_B(흡수)를 고름

FO_B의 FOL을 FO_A로 이동(수량 단위 가능)

FO_B가 비면 취소

FO_A 재계산(부피/중량/운임)

언제든 락 전 상태에서만 허용. 락 이후엔 구조 변경 금지, 라벨 발급 후면 라벨 무효화→재발급이 필요.

채널 이벤트와의 상호작용(취소/변경)

취소(한쪽 SO만 취소): 해당 SOL의 FOL을 감산/제거 → FO 재계산 → 비면 FO 취소. 예약 해제.

주소/운송수단 변경: 정책 불일치가 생기면 이슈로 승격(출고 블록 또는 재구성).

출고 후: 구조 변경 금지. 반품/환불 워크플로우로 전가.

UI/프로세스 가드레일

합포장 홀드 타이머 표시: 종료 전에는 자동 합포장 후보로만 존재, 종료 시 자동 FO 구성.

충돌 경고: SLA 상이, 위험물 혼재, 채널 상이 등은 수동 승인 없이는 합포장 불가.

분할/해제(Split): 락 전까지만 가능. 버튼 한 번으로 FO→여러 FO로 나눔(라인/수량 단위).

감사로그: FO_COMPOSED / FO_RECOMPOSED / FO_SPLIT / FO_LOCKED / LABEL_VOIDED / SHIPPED 등 이벤트+사유코드 기록.

짧은 SQL 스케치(라인 이동 방식)
-- FO_B의 한 라인을 FO_A로 “부분 이동(합포장)”
with m as (
  update fulfillment_order_lines
  set qty = qty - :move_qty
  where id = :fol_id_b
  returning so_id, sol_id, sku_id
)
insert into fulfillment_order_lines(fo_id, so_id, sol_id, sku_id, qty)
select :fo_a, m.so_id, m.sol_id, m.sku_id, :move_qty from m
on conflict (fo_id, sol_id, sku_id) do update set qty = fulfillment_order_lines.qty + excluded.qty;

-- FO_B가 비었으면 취소
delete from fulfillment_orders fo
where fo.id = :fo_b
  and not exists (select 1 from fulfillment_order_lines where fo_id = fo.id);

예시로 보는 흐름

고객이 같은 주소로 SO#101, SO#102를 결제 → 후보 풀에서 같은 그룹으로 묶임

홀드 2시간 후 FO#9001 생성: FOL = {SO#101 x2, SO#102 x1}

SO#102가 채널에서 취소됨(홀드 종료 직후) → FOL에서 SO#102 라인 제거, 예약 해제 → FO#9001에 SO#101만 남음 → 운임 재계산

피킹 시작(락) → 라벨 발급 → 출고 → 트래킹#T를 SO#101에만 통지

포인트 요약

합포장은 언제나 FO 레벨의 조합행위로만 표현합니다. SO는 “원본 그대로” 보존.

락 전까지만 합치고 쪼갭니다. 락 이후엔 구조 고정, 필요하면 라벨 무효화+재발급.

채널이 “다중 주문→단일 송장” 통지를 미지원하면, 출고는 진행하되 정산/CS 이슈를 자동 생성해 후속 처리합니다.

원하시면 위 정책을 바탕으로 **상태도(머메이드)**와 **체크리스트(운영 매뉴얼 1페이지)**까지 바로 만들어 드릴게요.

나의 말:
구조가 좀 달라. SO는 판매상품(PIM에 SoT가 있음)으로 이루어져 있고 FO는 재고상품(=sku, WMS에 SoT가 있음)으로 이루어져 있어. 판매상품에 대해 어떤 재고상품이 출고되어야 할지는 WMS에서 상품 매칭 리스트를 관리해서 해결해. "[특가] 립스틱 1호" 판매상품은 "립스틱 1호" 재고상품에 매칭될 거고, "[세트] 립스틱 4종세트" 판매상품은 "립스틱 1호"부터 "립스틱 4호"까지의 재고상품 4종 각 1개씩 총 4개에 매칭되어 있을 거야. 이걸 고려해야 해. 여러 SO를 한 송장으로 보내는 것과 한 SO를 여러 송장으로 분리하는 것 모두를 처리할 수 있어야 하지. 송장 분리는 기존에는 SO와 FO를 다대다 대응되게 해서 해결했었어. 이제는 어떻게 해야 하지?
ChatGPT의 말:
36s 동안 생각함

좋아요. **“SO=판매상품(제품 단위) / FO=재고상품(SKU 단위)”**라는 전제를 그대로 살리면서, 합포장/분할출고를 깔끔하게 처리하려면 중간 계층을 1단 추가하는 게 가장 안정적입니다.

핵심 아이디어: “SKU 수요(Demand) 계층”을 둔다

SO/SOL(판매상품) → (매핑 스냅샷을 사용해) → SKU 수요(sku_demands) → (할당) → FO/피킹

SO는 끝까지 “판매상품”만 알고, FO는 끝까지 “SKU”만 압니다.

연결과 추적은 sku_demands가 담당합니다. 이 계층이 있으면 “여러 SO를 한 송장(FO)으로”도, “한 SO를 여러 송장(FO)으로”도 자연스럽게 됩니다.

최소 스키마(요점)
-- SO(판매) 쪽: 그대로 유지
sales_orders(id, channel, channel_order_id, state, ship_to, ...)
sales_order_lines(id, so_id, product_id, qty, cancelled_qty, ...)

-- 상품→SKU 매핑 규칙(버전 관리; WMS가 SoT)
product_sku_maps(id, product_id, version, effective_from, ship_together boolean, ...)
product_sku_map_items(id, map_id, sku_id, qty_per_product)

-- 주문시점 스냅샷 기반 SKU 수요(=SO 라인을 SKU로 “폭발”한 결과)
sku_demands(
  id bigserial primary key,
  so_id bigint not null,
  sol_id bigint not null,
  sku_id bigint not null,
  qty int not null,
  kit_group uuid null,              -- 세트/키트 묶음 식별자
  mapping_version int not null,     -- 당시 매핑 버전(스냅샷)
  state text not null default 'pending' -- pending/allocated/fulfilled/cancelled
);

-- 예약은 수요 단위로(판매 사실에 귀속)
stock_reservations(id, sku_demand_id, location_id, qty_reserved, ...)

-- FO(송장=상자)와 피킹은 SKU 기준
fulfillment_orders(id, warehouse_id, state, ship_to, carrier_service, latest_ship_by, locked_at, ...)
-- FO가 어떤 수요를 몇 개 집행하는지(정밀 추적)
fo_allocations(fo_id, sku_demand_id, qty) -- 핵심 연결
-- 피킹 퍼포먼스를 위해 SKU 합계를 별도 테이블/머티리얼라이즈 뷰로 캐싱(선택)
fulfillment_order_skus(fo_id, sku_id, qty) -- fo_allocations의 집계본


운영·추적은 fo_allocations(정밀 링크), 피킹은 fulfillment_order_skus(집계)로 처리하면 UX/성능 모두 챙깁니다.
SO↔FO 다대다는 직접 테이블을 두지 말고 so_fo_links 뷰로 파생하세요.

create view so_fo_links as
select distinct sd.so_id, fa.fo_id
from fo_allocations fa
join sku_demands sd on sd.id = fa.sku_demand_id;

동작 흐름
1) 주문 수신 → “SKU 수요” 폭발(Explosion)

SOL마다 당시의 매핑 규칙 스냅샷으로 sku_demands 다건 생성.
예) “[세트] 립스틱 4종” 1개 → sku_demands: {1호×1, 2호×1, 3호×1, 4호×1} + kit_group 동일하게 부여.

ship_together 정책(세트는 반드시 한 상자)에 따라 kit_group을 세팅.

2) 합포장(여러 SO → 1 FO)

그룹핑 키: 정규화 주소/수취인, carrier_service, SLA(latest_ship_by), 채널 정책(가능하면 동일 채널) 등.

그룹 후보에서 여러 SO의 sku_demands를 한 FO로 할당(fo_allocations insert).

kit_group이 있는 수요는 한 FO로 강제(정책이 ship_together면).

카토나이제이션(부피/중량)으로 박스/운임 산출 → fulfillment_order_skus 업데이트.

락 전(draft/allocated) 상태에서만 구조 변경 허용.

3) 분할출고(1 SO → 여러 FO)

특정 수요 일부를 다른 FO로 할당 분리(fo_allocations를 여러 FO로 나눔).

예) 재고부족/다창고/용적 초과/익일배송 분리 등.

4) 락/피킹/출고

state=locked_for_pick 진입 시 구조 동결(합포장/분할 불가).

피킹은 fulfillment_order_skus를 기반으로 진행하되, 피킹 화면에는 원 SO/라인을 툴팁·서브라인으로 노출(fo_allocations 역추적).

변경·예외 처리
A. 한 묶음(합포장) 중 어느 SO가 채널에서 취소

해당 SO의 sku_demands를 cancelled로 전이, 남은 qty 예약 해제.

락 전이면: fo_allocations에서 해당 수요 할당분 삭제/감산 → FO 용적·운임 재계산 → 비면 FO 자체 취소.

락 후면: 집품 취소 가능 범위까지 reverse-pick 처리, 불가하면 출고 유지 + 사후(반품/환불) 루트.

B. SO 라인의 부분취소/수량변경

sku_demands.qty를 감소시키고, 감소분 만큼 fo_allocations/reservations에서 해제.

kit_group(세트) 정책이 모두-또는-없음(all-or-nothing) 이면, 세트 전체를 같은 FO에서 같이 조정.

C. 주소/운송수단 변경(채널 이벤트)

그룹핑 키가 깨지면 재구성 필요. 락 전에는 할당을 재배치(FO 이동), 락 후엔 이슈로 승격하여 오퍼레이터 개입(라벨 무효화+재발급 여부 결정).

D. 매핑 규칙 변경(신제품/대체 SKU)

규칙은 버전드(effective_from) 관리.

이미 생성된 sku_demands는 스냅샷 버전 고정(주문시점 기준). 필요 시 대체 허용 정책을 둬 substitution_rules(예: 1호→1호B) 범위 내에서 오퍼레이터가 교체 승인.

운영 가드레일(권장)

합포장 홀드 윈도우(예: 결제 후 2~4시간): 이 시간 동안 들어온 sku_demands를 같은 그룹에 모아 자동 합포장 후보로 큐잉.

FO 락 기준의 표준화(피킹 시작 vs 라벨 발급). 락 이후 구조 변경 금지.

크로스채널 합포장 금지(권장): 정산/CS가 꼬이므로 동일 채널/정책만 허용.

가상품목(non-physical) 플래그: 사은품·다운로드권 등은 sku_demands를 만들지 않음.

감사로그: DEMAND_EXPLODED / FO_ALLOCATED / FO_RECOMPOSED / FO_LOCKED / SHIPPED / CXL_PROPAGATED 등 이벤트+사유코드.

“기존 SO↔FO 다대다를 어떻게 대체/이행?”

직접 매핑 테이블은 Deprecate하고, 상위 호환으로

정밀 추적: fo_allocations (fo_id, sku_demand_id, qty)

파생 링크: so_fo_links 뷰(위 정의)

마이그레이션

현행 SO↔FO 링크를 스캔 → 각 SO 라인의 SKU 폭발로 sku_demands 백필

기존 FO가 담던 SKU 합계에 맞춰 fo_allocations 생성(수요별 분해)

운영 화면/리포트는 so_fo_links 뷰로 교체

짧은 예시

여러 SO 합포장: SO#101(세트A1개→SKU1,2,3,4), SO#102(립1호 2개→SKU1×2)
→ sku_demands 총 6줄 → 동일 주소·서비스로 그룹 → FO#9001에 전부 fo_allocations

한 SO 분할: 세트 중 SKU3이 타창고에만 있음 → SKU3만 FO#9002로 할당, 나머지는 FO#9001

취소 이벤트: SO#102 취소 → 해당 수요 cancelled → FO#9001에서 할당 제거 → 운임 재계산, 비면 FO 취소

요약하면, “SKU 수요 계층(sku_demands) + fo_allocations” 두 축으로 **SO(제품)과 FO(SKU)**를 느슨하게 결합하면, 합포장/분할/세트/부분취소/대체까지 전부 일관 규칙으로 처리할 수 있습니다.
원하시면 이 구조로 머메이드 ER 다이어그램과 상태 전이 도표도 바로 그려드리겠습니다.

나의 말:
그러면 재고예약은 누가 갖게 되지?
ChatGPT의 말:
53s 동안 생각함

짧은 결론: 재고예약(Reservation)의 “소유자”는 sku_demands 입니다.
FO(송장/상자)는 그 예약을 소비·구체화(allocate/pick/consume) 하는 주체일 뿐, 예약의 SoT가 되지는 않습니다.

왜 sku_demands가 소유자여야 하나

SO는 “판매상품” 기준, FO는 “집행 컨테이너(상자)” 기준입니다. 실제 재고는 SKU 단위이므로, SOL×매핑 스냅샷 → sku_demands(SKU 수요) 가 재고와 1:1로 맞닿는 “원인(cause)”입니다.

합포장(여러 SO→1 FO)·분할출고(1 SO→여러 FO)를 해도 수요(sku_demands)는 그대로이고, FO는 그 수요를 어디서 얼마나 담았는지의 결과(fo_allocations) 만 바뀝니다. 따라서 예약의 주인은 수요가 가장 자연스럽습니다.

예약 생명주기(권장)

수요 생성(pending)

SOL을 SKU로 “폭발”해 sku_demands 생성(세트는 kit_group으로 묶음).

소프트 예약(soft / hold)

stock_reservations(sku_demand_id, sku_id, warehouse/location?, qty, state='soft', expires_at…)

재고가 충분치 않으면 부분 예약+백오더 표식 가능.

FO에 배정(hard allocate)

FO 구성 시, 소프트 예약을 FO에 귀속: state='hard', fo_id=… (위치 확정).

피킹/락/소비

locked_for_pick 진입 후 구조 고정.

피킹 진행: picked → 포장/출고 시 consumed(예약 소진).

취소/변경

채널 취소/부분취소 시 해당 sku_demands 감소/취소 → 예약 해제(release).

락 전이면 FO 재구성(fo_allocations 감산/이동), 락 후면 reverse-pick 가능 범위만 되돌리고 나머지는 사후처리.

합포장/분할과의 관계

여러 SO → 1 FO(합포장): 여러 sku_demands의 예약을 한 FO로 hard allocate 하면 끝입니다(예약 주인은 계속 sku_demands).

1 SO → 여러 FO(분할): 한 sku_demand의 예약을 여러 FO로 쪼개어 hard allocate 합니다(예약 행을 분할하거나 수량 감산/신규행 생성).

세트/대체/멀티창고 가드레일

세트(kit_group): 정책이 “함께 배송(ship_together)”이면 모든 구성 SKU가 hard allocate 가능할 때만 FO 락 허용(모자라면 전량 보류 또는 정책대로 부분 허용).

대체 SKU(substitution): sku_demands는 원 SKU 기준을 보존하고, 승인 시 substituted_sku_id로 전환(예약/배정도 함께 교체 이벤트 기록).

멀티창고: soft는 global 또는 후보창고 다건으로 잡을 수 있으나, hard는 단일 창고/위치로 확정(운송/라벨 제약 때문).

최소 스키마 스케치
-- 재고 예약(현황 테이블; 원장은 이벤트로 운영해도 좋음)
create table stock_reservations (
  id bigserial primary key,
  sku_demand_id bigint not null references sku_demands(id),
  sku_id bigint not null,
  warehouse_id bigint,
  location_id bigint,
  fo_id bigint null,                      -- hard allocate 시 귀속
  qty int not null check (qty > 0),
  state text not null check (state in ('soft','hard','picked','consumed','released','expired')),
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);

-- FO가 어떤 수요를 집행했는지(정밀 링크)
create table fo_allocations(
  fo_id bigint not null references fulfillment_orders(id),
  sku_demand_id bigint not null references sku_demands(id),
  qty int not null check(qty > 0),
  primary key (fo_id, sku_demand_id)
);

불변식(운영 체크)

sum(reservations.qty where state in ('soft','hard','picked')) ≤ on_hand.

sum(fo_allocations.qty by sku_demand_id) ≤ sku_demands.qty.

hard/hard→picked→consumed 전이는 FO 상태와 동기(락 이후 구조 변경 금지).

요약하면, 예약의 SoT= sku_demands(원인), FO= 그 예약을 “소비·집행”하는 컨테이너입니다. 이렇게 두면 합포장/분할/세트/부분취소 모두가 일관된 규칙으로 깔끔하게 돌아갑니다.