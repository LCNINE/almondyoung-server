# 공개 레포 README 재작성 — 설계

작성일: 2026-08-08

## 배경

레포가 공개로 전환됐으나 `README.md` 는 NestJS 보일러플레이트, 멤버십 정책 설명, 창고
레이아웃 조각이 층층이 쌓인 상태다. 179줄 중 실제로 이 레포를 설명하는 부분은 없고,
`apps/membership` 와 `apps/core` 두 개만 언급하며 나머지 앱·라이브러리는 존재조차 드러나지
않는다. 문서 절반은 NestJS 프로젝트 페이지 링크다.

동시에 루트 디렉터리에는 2025-09 ~ 2026-01 시기의 일회성 작업 문서 10개가 공개 상태로
남아 있고, 그중 일부는 내용이 이미 틀렸다. 라이선스는 없으면서 `package.json` 은
`UNLICENSED` 로 선언돼 있어 공개 의도와 모순된다.

## 목표

이 레포를 처음 보는 사람에게 **무엇을 지향하는 시스템인지**와 **전체 구조**를 압축적으로
전달한다.

- 독자: 코드를 참고하러 온 외부 개발자 + 새로 합류할 개발자
- 언어: 한국어 (영문판은 자리만 마련하고 이번에 만들지 않는다)
- 분량: 스크롤 2~3회. 세부는 전부 기존 문서로 링크

## 범위 밖 (명시적으로 하지 않는 것)

- 영문 번역본 작성
- `CONTEXT.md`, `CLAUDE.md`, `AGENTS.md`, `docs/adr/` 수정
- 아래 "부수 발견" 의 `channel-adapter` 구독 누락 수정
- 설계 규율 소개, 온보딩 진입로 안내, 로컬 실행 가이드 (독자 논의 후 제외 결정)

---

## 1. README 섹션 설계

### 섹션 1 — 이 시스템을 쓸 이유가 있는가

질문형으로 연다. "우리는 대단하다" 대신 **"이게 맞지 않는 경우"를 먼저 인정**하는 구조가
이 프로젝트의 포지션을 가장 정확히 전달한다.

논지:

> 자사몰 하나면 충분하다면 — 쓸 이유가 없다. 카페24 같은 SaaS 를 쓰면 된다.
> 있다면 이유는 하나다. 커머스를 중심으로 하는 비즈니스에서, 플랫폼이 허락하는 범위가
> 아니라 내가 정한 범위로 움직이고 싶을 때.

그 "완전한 컨트롤" 을 주장이 아니라 **확인 가능한 사실**로 만든다. 세 근거를 각각 실제
경로에 연결한다.

| 근거 | 코드 |
|---|---|
| 인증 모델이 우리 것이다 | `apps/user-service` |
| 앱을 늘리는 비용이 낮다 — 앱은 동기 호출이 아니라 이벤트로 엮인다 | `libs/events` (outbox · DLQ · retry · 스키마 검증 · graceful shutdown) |
| 인프라 얼개까지 코드다 | `deployments/lcnine/{auth,platform,services}` — SST 배포 단위 3개 |

### 섹션 2 — 주문 하나가 지나가는 길

README 의 심장. 앱 13개를 나열하는 대신 **주문 하나를 따라가며** 앱을 등장시킨다. 경계·
이벤트 흐름·앱이 나뉜 이유가 한 번에 드러난다.

핵심은 **왕복 구조**다. 선형 파이프라인이 아니다.

```
             채널 (Medusa · 네이버 · 쿠팡)
                  │                  ▲
        주문 수집  │                  │  발송 · 재고 · 상품 상태 반영
                  ▼                  │
             channel-adapter ────────┘
                  │                  ▲
   orders.events  │                  │  fulfillment · shipment
        .v1       │                  │  product · inventory
                  ▼                  │
             ┌─ core ────────────────┘
             │   sales-order   재고 예약 → 출고주문
             │   inventory     append-only 원장
             └─ ▲ ─────────────────────────
                │ HTTP
             warehouse-app   피킹 · 검수 · 송장 발행
```

전달할 설계 사실 두 가지.

1. **Core 는 쿠팡·네이버가 존재한다는 사실 자체를 모른다.** `channel-adapter` 가 양방향
   번역기이고, Core 는 채널 중립적인 자기 계약만 다룬다.
2. **물류 현장은 이벤트가 아니라 HTTP 로 붙는다.** `warehouse-app` 은 Kafka 를 전혀 쓰지
   않고 `core.almondyoung.com` 을 직접 호출한다 — 사람이 스캐너를 찍는 동기적 작업이기 때문.

각 단계에 "왜 이 경계가 있나" 를 한 줄씩 붙인다.

#### 검증된 이벤트 토폴로지

아래는 각 앱 `main.ts` 의 `EventsModule.forConsumer` 호출에서 확인한 **실제 런타임 구독**
이다. `forRoot` / `forConsumerModule` 등록은 발행·검증·DLQ 용이라 구독을 만들지 않으므로
집계에서 제외했다.

| 앱 | 구독 스트림 |
|---|---|
| `core` | `ORDER_STREAM` |
| `channel-adapter` | `FULFILLMENT` · `FULFILLMENT_V2` · `SHIPMENT` · `PRODUCT` · `INVENTORY` · `MEMBERSHIP` |
| `notification` | `USER` · `ORDER` · `PAYMENT` |
| `search` | `PRODUCT` · `UGC_EVENT` |
| `analytics` | `ORDER` · `MEMBERSHIP` |
| `wallet` | `UGC_COMMAND` · `WALLET_COMMAND` |
| `membership` | `PAYMENT` |

발행 쪽은 `@InjectStreamPublisher` 로 확인했다. `core` 가 발행하는 스트림은
`CORE_ORDER` · `FULFILLMENT` · `FULFILLMENT_V2` · `SHIPMENT` · `PRODUCT` · `INVENTORY` 다.

`native/warehouse-app` 은 Kafka 를 쓰지 않는다 (관련 의존성·코드 0). `httpClient` 로
`https://core.almondyoung.com/*` 를 호출하는 HTTP 클라이언트다.

주문 인바운드와 아웃바운드는 토픽이 분리돼 있다 (`packages/event-contracts/streams/orders.stream.ts`).

- `orders.events.v1` — 외부 채널 → Core
- `core.orders.events.v1` — Core → channel-adapter

다이어그램은 이 표를 넘어서는 흐름을 그리지 않는다. 확인되지 않은 화살표는 넣지 않는다.

### 섹션 3 — 전체 구성

`<details>` 로 접는다. 섹션 2 를 읽고 더 보고 싶은 사람만 펼친다.

- 백엔드 앱 10: `core` `user-service` `wallet` `membership` `notification` `channel-adapter`
  `file-service` `search` `analytics` `ugc-service`
- 커머스/프론트 앱 3: `medusa` `admin-web` `wallet-web`
- 공유 라이브러리 4: `@app/db` `@app/events` `@app/authorization` `@app/shared`
- 웹 2: `almondyoung-storefront` `auth-web`
- 네이티브 2: `warehouse-app` (Tauri, 물류 스테이션) `storefront-app` (Expo)
- 패키지 5: `domain-types` `event-contracts` `hms-api-wrapper` `product-description`
  `web-observability`

### 섹션 4 — 어디로 가는가

자사 운영에서 출발했지만 **범용 제품을 지향한다**는 점을 명시한다. 섹션 1 의 질문형 오프닝
("이 시스템을 쓸 이유가 있는가")이 이미 제3자 사용을 전제하므로 자연스럽게 닫힌다.

영문판 안내도 여기 둔다.

> **영문판 링크는 `README.en.md` 가 실제로 생긴 뒤에 넣는다.** 공개 레포에서 존재하지 않는
> 파일로 링크하면 404 가 된다. 그때까지는 영문 한 줄 안내만 둔다.

---

## 2. 루트 정리

첫인상을 해치는 파일을 정리한다. 참조 여부는 `node_modules` · `.git` · `dist` 를 제외한
전수 grep 으로 확인했다.

### 삭제 (6)

| 파일 | 최종 수정 | 근거 |
|---|---|---|
| `문서` | — | 오타 섞인 개인 결제 흐름 메모 |
| `point.md` | 2025-10-14 | 포인트 결제 MVP 명세 — `apps/wallet` 으로 구현 완료 |
| `refector.md` | 2025-10-26 | channel-adapter 리팩토링 명세 — 완료됨 |
| `IMPLEMENTATION_SUMMARY_VERSION_MANAGEMENT.md` | 2025-11-19 | 구현 완료 보고서 |
| `docker-guide.md` | 2025-09-28 | Neon DB + Confluent Kafka 전제 — 현재 구성과 다름 |
| `check-env.js` | 2025-11-13 | 참조 0곳 |

### `docs/` 로 이동 (3)

`docs/` 바로 아래로 옮긴다 (하위 폴더를 새로 만들지 않는다). 파일명은 유지한다.

`PIM_VERSION_MANAGEMENT_GUIDE.md` · `SEED_GUIDE.md` · `SEED_DATA_ANALYSIS.md`

낡았을 가능성이 높으나 (앞의 둘은 `apps/pim` → `apps/core` 통합 이전 문서) 시드 운영에
쓸모가 남아 있을 수 있어 지우지 않는다.

### `scripts/` 로 이동 (1)

`trigger-search-index.mjs` — 참조 0곳이지만 운영 스크립트로 보인다.

### 유지

`README.md` `CLAUDE.md` `AGENTS.md` `CONTEXT.md` `swagger-config.json`
(마지막 것은 `scripts/generate-swagger-docs.ts` 가 참조한다) 및 설정 파일 일체.

---

## 3. 라이선스 — BSL 1.1

### 결정 근거

지향점("완전한 컨트롤을 원하는 사업자를 위한 시스템")과 맞물린다. 자가호스팅하려는 독자
에게는 제약이 없고, 제3자가 이 코드로 경쟁 호스팅 서비스를 파는 것만 막는다.

AGPL-3.0 은 검토 후 제외했다. §13 이 네트워크로 상호작용하는 **모든 사용자**에게 소스 제공
의무를 지우므로, 코드를 수정해 쇼핑몰을 운영하는 사업자가 자기 쇼핑몰 방문 고객에게 소스를
제공해야 한다. 겨냥한 독자를 정면으로 때린다.

Apache-2.0 도 제외했다. 되돌릴 수 없는 결정이고, 지금 그 결정을 내릴 필요가 없다. BSL 은
나중에 더 관대하게 푸는 선택지를 남긴다.

### 파라미터

아래는 **가정이다. 검토 시 확인 필요.**

| 항목 | 값 |
|---|---|
| Licensor | LCNINE — *법인 정식 명칭 확인 필요* |
| Licensed Work | almondyoung-server |
| Change Date | 2030-08-08 (4년 후) |
| Change License | Apache License, Version 2.0 |
| Additional Use Grant | 자기 사업 운영을 위한 프로덕션 사용은 허용한다. 이 저작물을 제3자에게 상용 호스팅 서비스 또는 매니지드 서비스로 제공하는 것은 허용하지 않는다. |

### 함께 수정할 것

- 루트 `package.json` 의 `"license": "UNLICENSED"` → `"BUSL-1.1"`
- `apps/medusa/package.json` 의 `"license": "MIT"` — Medusa 스타터 잔재로 보인다. 의도한
  값인지 확인 후 정리
- **`web/almondyoung-storefront/` 는 예외로 명시한다.** 이 디렉터리는 medusa-next (MIT,
  © 2022 Medusa) 의 파생물이라 상위 라이선스로 덮을 수 없다. `LICENSE` 파일을 그대로 두고
  루트 라이선스 문서에 예외를 한 줄 적는다.

법적 방어가 실제로 중요해지는 시점에는 변호사 확인을 권한다. 이 문서는 각 라이선스의
실무적 결과만 정리한 것이다.

---

## 부수 발견 — 이번 범위 밖

### channel-adapter 가 `core.orders.events.v1` 을 구독하지 않는다

주문 흐름을 검증하다 발견했다. **이번 작업에서 고치지 않는다.**

- `apps/core/src/modules/fulfillment/outbox/outbox-dispatcher.service.ts:202` — Core 가
  `core.orders.events.v1` 로 `SalesOrderCancelled` 발행
- `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts:158` —
  `@OnEvent('core.orders.events.v1', 'SalesOrderCancelled')` 핸들러 존재
- `apps/channel-adapter/src/adapter.module.ts:129` — `EventsModule.forRoot` 에
  `CORE_ORDER_STREAM` 등록됨
- `apps/channel-adapter/src/main.ts:88` — `forConsumer` 스트림 목록에 `CORE_ORDER_STREAM`
  **없음**

`forConsumer` 만 실제 Kafka 구독을 만든다. channel-adapter 안의 `forConsumer` 호출은 이
하나뿐이고 `core.orders.events.v1` 을 구독하는 다른 경로도 없다. 핸들러 주석(`:121`)이
"주문 취소 projection 은 SalesOrderCancelled 의 단일 채널 경로가 담당한다" 고 적고 있으므로,
그 단일 경로가 끊겨 있다면 **Core 주문 취소가 판매채널에 반영되지 않는다.** 에러도 로그도
남지 않는 무증상 유형이다.

정적 판독이며 실행으로 재현하지 않았다. 수정은 `main.ts` 의 스트림 목록에
`CORE_ORDER_STREAM` 을 추가하는 한 줄로 보인다.

---

## 검증 방법

README 는 테스트로 검증되지 않으므로 아래를 수행한다.

1. **사실 검증** — README 가 언급하는 모든 경로(`apps/*`, `libs/*`, `deployments/*`)가 실제로
   존재하는지 확인
2. **링크 검증** — 문서 내 모든 상대 링크가 존재하는 파일을 가리키는지 확인.
   특히 `README.en.md` 링크를 넣지 않았는지
3. **다이어그램 검증** — 그린 화살표가 위 "검증된 이벤트 토폴로지" 표를 벗어나지 않는지
4. **루트 정리 검증** — 이동/삭제 후 `npm run type-check` 와 `scripts/generate-swagger-docs.ts`
   경로가 깨지지 않는지
5. **렌더 확인** — GitHub 에서 mermaid 또는 코드블록 다이어그램이 의도대로 보이는지
