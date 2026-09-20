# Medusa 는 거래 엔진이다 — 표시는 Core, 거래는 Medusa

## Status
Accepted (2026-09-21). 트래킹 이슈 **#904**. ADR-0037 이 마지막 항에서 「결정하지 않는다」로
비워 둔 자리(Medusa 를 읽기 경로에서 빼는 것)를 이 ADR 이 채운다. 구현은 §8 의 4단계이고 1단계는 #856.
전제가 되는 결정: ADR-0031(채널 능력 벡터·리스팅 소유), ADR-0033(쿠폰은 채널 소유), ADR-0035(트리거는
사실이 확정되는 곳에서 발화), ADR-0038(읽기 경로의 개인화는 세그먼트 하나).

## Context
판매상품의 SoT 는 Core 의 catalog 모듈이고 판매는 Medusa 에서 일어난다. Core → Kafka → channel-adapter →
Medusa admin API 로 상품 **1건씩** 동기화한다 (`apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts`
의 `upsertProduct` → `attachProductToCategories` → `syncPriceLists`, 상품당 호출 3~5회).

- 호출당 비용은 데이터 양이 아니라 **워크플로 고정비**다 — #631 설계 §2-2·§5A 실측: 바닥 약 1.5초, 상품당
  Medusa 시간 10.6초 중 price list 가 6.6초(62%), 상품 생성 2.9초(27%). 대량등록이 Medusa 를 포화시킨다(#852).
  빨리 보내면 포화, 천천히 보내면 드리프트 — 이 딜레마는 구조가 아니라 **호출 단위**가 만든 것이다.
- Medusa 는 카탈로그 전체(설명·이미지·카테고리·정렬)의 사본을 든다. 스토어프론트는 목록·카테고리·정렬을
  Medusa(`web/almondyoung-storefront/src/lib/api/medusa/products.ts`)에서, 상세·검색·가격계산·콘텐츠를
  Core(`lib/api/pim/*`, `apps/search`)에서 읽는다. **두 소스가 둘 다 신선해야 하고 둘 다 무효화되는
  중간 상태**다.
- 검토하고 기각한 안: **Medusa Product 모듈을 Core 의 read-through 로 교체.** 기각 사유 넷.
  1. 문서에 없는 확장이다. Medusa 가 «교체 가능»이라 적는 건 Provider(결제·배송·인증·파일·알림·분석)와
     인프라 모듈뿐이고 Product 에는 provider 개념이 없다. CLAUDE.md 규칙대로 모듈 서비스 교체 결론은 오답 신호.
  2. Product 모듈은 read model 이 아니라 **정체성 앵커**다. 코어 링크 넷이 product/variant id 에 묶인다
     (`apps/medusa/node_modules/@medusajs/link-modules/dist/definitions/product-*.js`), cart·order line 도
     variant id 를 든다. 가격은 Pricing, 판매가능수량은 Inventory 모듈이라 read-through 로 바꿔도 상품당
     비용의 73% 는 그대로 동기화로 남는다.
  3. 결합의 종류가 바뀐다 — 스키마 결합이 **런타임 가용성 결합**으로. 목록 렌더·담기마다 Core 를 부르게
     되어 Core 장애가 체크아웃 정지가 된다.
  4. `/store/products` 의 `query.graph`/`query.index` 계약(필터·페이지네이션·검색어·카테고리 트리·가격
     컨텍스트)을 Core API 위에서 재구현해야 하고 Index Module 은 못 쓴다.
  이벤트 버스는 기각 사유가 **아니다** — 커스텀 라우트·워크플로가 `emitEventStep` 으로 `product.*` 를 낼 수 있다.
- Medusa 문서가 PIM/ERP 가 SoT 인 경우에 권하는 형태: 동기화 로직을 워크플로로 두고 `batchProductsWorkflow` 를
  50건 단위 **in-process** 로 subscriber·job 에서 실행(learn/best-practices/third-party-sync). 아키텍처 문서의
  예시가 CMS(Sanity)는 콘텐츠, Medusa 는 커머스 상품. 저장소 선례 `apps/medusa/src/scripts/backfill-from-core.ts`.

## Decision

### 1. 정의 — 거래 엔진
**돈이 오가는 순간에 참이어야 하는 사실을 소유하는 시스템.** 판정 기준은 하나다. 그 데이터가 틀렸을 때
주문이 무효가 되거나 누군가 돈을 잃으면 거래 엔진의 것이고, 손님이 낡은 글과 그림을 볼 뿐이면 표시의 것이다.
**Core 는 「무엇을 파는가」의 SoT, Medusa 는 「어떻게 팔리는가」의 SoT.**

| 축 | 거래 엔진 = Medusa 가 소유 | 표시 = Core read model 이 서빙 |
|---|---|---|
| 상품 | variant id·SKU·옵션값·판매상태·판매채널 링크. 주문 스냅샷용 제목·썸네일·옵션명 | 설명·이미지·표시정보·속성·카테고리 트리·정렬·검색 |
| 가격 | 청구되는 가격. price set·회원가·티어가·타임세일 price list·`calculated_price` | 카드·상세에 보이는 가격 |
| 재고 | 담기 가능 여부와 주문 시 예약(출고 전 홀드) | 「품절」 배지 |
| 프로모션 | 쿠폰·자동발급과 그 적용 계산 | 프로모션 배너 |
| 장바구니·결제·주문 성립 | 전부. 카트·체크아웃·결제 웹훅·주문 생성 | 없음 |
| 고객 | 고객 정체성(투영)·인증·SSO·멤버십 그룹(투영) | 없음 |
| 콘텐츠 | 없음 | 배너·공지·팝업·샵매매 리스팅·리뷰 |

### 2. 분류 기준
데이터마다 두 가지를 묻는다. **채널에 독립적인가**(네이버·쿠팡·자사몰이 같은 값인가), **거래 성립 시점에
평가되는가.**

| | 거래 성립 시점에 평가됨 | 표시에만 쓰임 |
|---|---|---|
| **채널 독립 사실** | Core 가 SoT, Medusa 에 투영. 상품 정체성·가격 정책(타임세일 포함)·판매가능수량·고객·멤버십 | Core read model 만. Medusa 에 두지 않는다 |
| **채널 고유 규칙** | 채널이 SoT, admin-web 이 채널 admin API 에 직접 씀. 쿠폰·프로모션·배송비 정책 | 채널이 서빙하거나 read model 로 역투영 |

칸 경계에 걸치는 두 경우의 처리:
- **Core 의 사실이 방아쇠인 채널 규칙**(멤버십 활성화 → 웰컴 쿠폰): 사실은 Core 쪽이 내고 규칙은 Medusa 가
  평가한다. ADR-0035 의 모양을 원칙 §3-4 로 승격한다.
- **채널 규칙이 카탈로그 속성을 타깃**(카테고리 X 10% 할인): 그 속성 어휘는 투영에 포함한다(§5.7).

### 3. 원칙 넷
1. **채널 동기화의 단위는 배치이고, 속도는 소비자가 정한다.** 이벤트는 상품 1건씩 와도 어댑터가 묶는다.
   같은 상품의 연속 변경은 합쳐지고(최신 버전만), 버전으로 멱등하다. 어댑터가 pacing 을 고민하는 구조 자체가 병이다.
2. **표시는 Core, 거래는 Medusa. 프론트는 두 SoT 의 합성층이다.** 「우리 앱은 채널 형식을 모른다」는
   **백엔드 앱**의 원칙이며 storefront·admin-web 에는 적용하지 않는다. 채널 고유 규칙의 편집은 admin-web 이
   채널 admin API 에 직접 쓴다 — Core 프록시를 두지 않는다. 쿠폰이 이미 그렇다
   (`apps/admin-web/src/lib/api/domains/medusa/promotions.ts`).
3. **Medusa 에는 판매에 필요한 만큼만 투영한다.** 투영 범위가 곧 드리프트 노출면이다.
4. **Core 는 사실을 내고 Medusa 는 규칙을 평가한다.** 역방향으로, 채널의 사실은 **주문 수집**(channel-adapter)
   으로만 Core 에 들어온다. Medusa 가 우리 앱을 직접 부르는 경로는 예외 목록(§5.4)에만 존재한다.

### 4. 책임 배치
| 층 | 소유하는 것 | 하지 않는 것 |
|---|---|---|
| **Core** | 정책과 사실의 SoT. 이벤트 발행(스냅샷 포함). 타임세일 도메인(§5.1) | Medusa 의 존재를 모른다. 채널 어휘를 갖지 않는다 |
| **channel-adapter** | 두 형식을 아는 **유일한** 투영기. 인박스, masterId 별 coalescing, 배치 구성, 변환, backpressure(in-flight 배치 하나), 매핑·버전 기록, 일일 대사(§5.2), 리스팅 상태 사실 발행(§5.8), 주문 수집과 역투영(§5.5). 네이버·쿠팡과 같은 자리(ADR-0031 `productProjection`) | 정책 결정, 규칙 평가, 읽기 서빙 |
| **Medusa** | 거래 엔진. **배치 수신 라우트는 채널 API 의 확장이지 동기화 로직이 아니다** — 입력은 Medusa 어휘, 하는 일은 검증 + 워크플로 한 번 실행 + 건별 결과 반환. REST 모양→워크플로 입력 어댑터는 `apps/medusa/src/scripts/lib/payload-to-workflow-input.ts` 가 이미 있다 | Core 어휘를 모른다. 표시를 서빙하지 않는다(§8 2단계 뒤) |
| **Core read model** (`apps/search` + Core PIM 읽기 API) | 표시 서빙. Core 이벤트로 적재. masterId 단위 정밀 무효화. 타임세일 경계 시각 무효화 | 거래 판정 |
| **프론트** (storefront·admin-web) | 합성. 표시는 read model, 거래는 Medusa, 채널 규칙 편집은 Medusa 직접 | 두 소스를 중계하는 서버 프록시를 두지 않는다 |

변환이 Medusa 가 아니라 어댑터에 남는 이유: (a) `apps/medusa` 는 `@app/*` 별칭을 못 써 이벤트 계약을
복제해야 한다, (b) 네이버·쿠팡 어댑터와 대칭이다, (c) 라우트 계약이 Medusa 어휘면 Core 픽스처 없이 Medusa
통합 테스트로 검증된다, (d) 라우트가 Core 스냅샷을 받으면 Medusa 가 Core 스키마의 소비자가 된다.

### 5. 개별 결정
**5.1 타임세일은 Core 의 가격 정책이다.** 지금은 Medusa 커스텀이다 — `apps/medusa/src/api/admin/time-sales`,
`api/store/time-sale`, `jobs/time-sale-cache-boundary.ts`, `utils/time-sale.ts`, admin-web 의
`lib/api/domains/medusa/time-sales.ts`. 타임세일은 쿠폰이 아니라 **한시 가격 정책**이고(ADR-0033 이 이미 둘을
구분), 가격 정책은 채널 독립 사실이다. 옮긴다: Core 에 타임세일 도메인(휴면 `promotions`·`promotion_products`,
`apps/core/src/modules/catalog/schema/catalog.schema.ts:744·757` 이 그 자리 — 재사용할지 새로 만들지는 구현
시 판단) → admin-web 은 Core 에 쓴다 → Core 이벤트 → channel-adapter → Medusa **price list `type: 'sale'` +
`starts_at`/`ends_at`** (Pricing 모듈 모델이 두 필드를 갖고, 어댑터 `ensurePriceList` 가 이미 `type` 을 받는다).
카트 가격은 Medusa 가 날짜로 자동 적용한다. 카드 표시와 경계 시각 무효화는 read model 의 일이다.
**이중 소유 기간을 두지 않는다** — 컷오버 한 번.

**5.2 표시가 = Core 계산, 청구가 = Medusa.** 타임세일이 Core 로 가고 쿠폰은 카트에서만 적용되므로 카드
표시가는 Core 계산으로 완결되며 Medusa 를 부르지 않는다. Medusa 의 price list 는 «같아야 하는 투영»이다.
불변식 「투영 == 정책」은 셋으로 지킨다: (a) 1단계의 빠른 동기화, (b) 가격 변경은 단건 우선 레인
(`inbox-worker.service.ts` 의 bulk 후순위 ORDER BY 가 이미 그렇다), (c) **channel-adapter 의 일일 대사 잡**과
불일치 알림. 대사 없이 (a)(b) 만으로 켜지 않는다 — 표시가≠청구가가 조용히 남는다. 스토어프론트
`lib/api/pim/pricing.server.ts` 의 호출자 0 함수 `calculateMasterPrice` 가 표시가 계산의 자리다.

**5.3 판매량·정렬의 원천은 Core `sales_orders` 다.** 지금은 Medusa `product_sort_index` 가
`apps/medusa/src/utils/search-sales-sync.ts` 로 검색 앱에 직접 민다. 순위는 표시이고 판매량은 채널 독립
사실이라(네이버·쿠팡 판매도 세야 한다) 원천이 틀렸다. Medusa 의 `product-sorting` 모듈·`sync-sort-index`
워크플로·`search-sales-sync.ts`·`products-sorted` 라우트는 §8 2~3단계에서 제거한다.

**5.4 역방향 채널의 단일화.** Medusa 가 우리 앱을 직접 부르는 경로는 셋이고 예외 목록에 올린다 —
검색 판매량(→ 5.3 과 함께 제거), ugc 리뷰 자격(`workflows/orders/steps/create-review-eligibility-step.ts`,
→ 주문 수집 이벤트로 대체), membership internal(→ 별도 판단). **새 예외를 만들지 않는다.**

**5.5 주문 생애주기의 분할점.** 성립(카트→주문·결제 캡처)은 Medusa, 이행·취소·반품·교환 **판정**은 Core
sales-order(`apps/core/src/modules/sales-order`), 돈 이동은 wallet. Core → Medusa 역투영(취소·배송 상태,
`medusa.client.ts` 의 `cancelOrder`·`updateOrderShippingProjection`)은 유지한다. 이 ADR 은 바꾸지 않고
이름만 붙인다. 확인 항목: 수집된 주문이 **할인 배분**을 실어 부분취소 환불 계산이 맞는가.

**5.6 Medusa 대시보드는 개발자 진단 전용이다.** 운영 편집 표면은 admin-web 하나. 대시보드에서 투영 데이터를
고치면 다음 투영이 덮어쓴다 — 결함이 아니라 설계다.

**5.7 투영의 최소 범위** = 정체성(product·variant id·handle·SKU·옵션·상태·판매채널) + 카트·주문 스냅샷에
보이는 것(제목·썸네일·옵션명) + **채널 규칙이 참조하는 속성.** 마지막 항은 3단계 전에 조사한다 —
프로모션 규칙이 실제로 카테고리·태그·컬렉션 중 무엇을 타깃하는지 세고, 안 쓰는 건 투영에서 뺀다.

**5.8 채널 판매가능 사실.** read model 이 상품을 보여주는데 Medusa 에 variant 가 아직 없으면 담기가 404 다.
channel-adapter 의 매핑 성공(`mappingRepo.recordSuccess`)을 `ChannelListingSynced{channel, masterId, version}`
사실로 발행하고 read model 이 소비한다. 미투영 상품은 담기 불가로 표시한다. ADR-0031 `productProjection` 의 구체화.

### 6. 이미 정해져 있어 이름만 붙이는 것
- **쿠폰** — ADR-0033. Core 에 테이블·읽기모델 없음. Core 가 쿠폰을 아는 유일한 순간은 수집 주문의 할인 배분.
- **배송 그룹** — 상품이 어느 그룹인지는 Core 속성(스냅샷 `shippingGroupCode`), 그룹의 요금·지역은 Medusa
  정책(`api/admin/shipping-area-templates`, almond-fulfillment). 속성과 규칙이 정확히 갈라져 있다.
- **재고** — Core availability(#618)가 SoT, Medusa 재고 projection 이 담기 게이트, 주문 시 Medusa 예약은
  출고 전 홀드. 유령 예약 결함은 남아 있으나 재결정 사항이 아니다.
- **고객·멤버십** — user-service·membership 앱이 SoT, Medusa customer·customer group 은 투영(#786,
  `membership-medusa-sync.service.ts`).

### 7. 뜻하지 않는 것
- Medusa 의 Product 모듈을 없애는 것이 아니다. 남되 얇아진다. 정체성은 반드시 Medusa 안에 있어야 한다.
- Medusa 를 결제 게이트웨이로 축소하는 것이 아니다. 결제는 wallet 과 almond-payment 가 맡고, Medusa 는 그
  위의 카트·주문·프로모션 계산을 소유한다.
- 스토어프론트가 Medusa 를 읽지 않게 되는 것이 아니다. 장바구니·주문내역·고객 정보는 Medusa 에서 읽는다.
  빠지는 건 «구경하기 위한 읽기»뿐이다.

### 8. 순서 — 각 단계가 독립적으로 값어치가 있고 되돌릴 수 있다
1. **배치 라우트 + 어댑터 coalescing·backpressure** — #856 을 확장해 그대로 쓴다. 페이로드는 지금 모양.
   지금의 딜레마를 없애는 단계이며 나머지의 배관이 된다.
2. **목록·카테고리 페이지를 read model 로**(#905) — Medusa 읽기 부하의 최대 항목이 빠지고 무효화가 masterId 단위로
   정밀해진다(#859 흡수). 타임세일 이전(5.1)·표시가(5.2)·판매량 원천(5.3)이 이 단계에 붙는다.
3. **투영 축소**(#906) — 5.7 조사 선행. 설명·이미지·메타 동기화 중단, 5.3 의 Medusa 정렬 제거.
4. **채널 판매가능 사실 승격**(#907) — 5.8.

하지 말 것: 3 을 2 앞에(Medusa 가 아직 목록의 소스라 깨진다) / #855 실측을 기다리기(1 은 그 결과와 무관하게
옳다) / 2 의 read model 을 지금 고르기(`apps/search` 인덱스가 카드 필드를 다 갖는지가 2단계 첫 질문이다).

## Consequences
- **제거 대상**: Medusa `api/admin/time-sales`·`api/store/time-sale`·`jobs/time-sale-cache-boundary.ts`·
  `utils/time-sale.ts`·`modules/product-sorting`·`workflows/sync-sort-index`·`utils/search-sales-sync.ts`·
  `api/admin/products-sorted`; admin-web `domains/medusa/time-sales.ts`; channel-adapter 의 상품당 호출 경로;
  storefront 의 `/store/products`·`/store/products-sorted` 목록 읽기.
- **신규**: Core 타임세일 도메인, Core read model 목록 API 또는 `apps/search` 확장, Medusa 배치 수신 라우트,
  channel-adapter 대사 잡, `ChannelListingSynced` 이벤트.
- **미확정 확인 항목** — 추정을 사실로 옮기지 않는다.

  | 항목 | 확정 방법 |
  |---|---|
  | 수집 주문이 할인 배분을 싣는가(5.5) | `apps/core/src/modules/sales-order` 의 생성 이벤트 스펙과 Medusa order adjustments 대조 |
  | 프로모션 규칙이 타깃하는 속성 어휘(5.7) | `apps/medusa/src/modules/promotion-meta` 와 Medusa promotion rule attribute 전수 |
  | `apps/search` 인덱스가 목록 카드 필드를 갖는가(8-2) | `SearchProductDocument` 와 카드 컴포넌트 props 대조 |
  | `batchProductsWorkflow` 의 부분 실패가 배치 전체를 되돌리는가(8-1) | 문서 + `moduleIntegrationTestRunner` 실 DB 스펙 |
  | 타임세일 경계 시각 무효화의 주체(5.1) | 2단계 스펙에서 결정 |
- **리스크**: 합성층 정합(미투영 상품 담기 404 → 5.8 이 답이므로 2단계와 4단계 사이 창을 짧게) / 타임세일
  컷오버 창(대량등록과 마찬가지로 비활성 시각에) / 5.2 를 대사 없이 켜는 것.
- 기존 트래커와의 관계: #856 은 #853 에서 이 ADR 의 트래킹 이슈로 옮겨 1단계가 된다. #859(정밀 무효화)는
  2단계가 흡수하며 #854 아래 그대로 둔다. #853·#854 의 나머지 sub-issue 는 움직이지 않는다. #855 의 닫기
  판정은 «분리 뒤 남는 잔여»를 재는 것이라 그대로 둔다.
- 관련 메모리: [[storefront-perf-structural-roots]] · [[bulk-import-saturates-medusa]] ·
  [[framework-extension-points-need-docs]].
