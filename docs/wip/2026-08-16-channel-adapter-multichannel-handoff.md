# 핸드오프 — 채널 어댑터 다채널 주문 수집 (2026-08-16)

> 목표: 네이버·쿠팡 주문 수집 개통. 이 세션은 **그 토대**를 놓았다 — 결정(ADR-0031), 수집 층
> 재설계, 죽은 층 제거. 실제 네이버 수집은 아직 시작 안 했다.

## 한 줄 요약

develop `21da4557a` 까지 머지·푸시·배포·**라이브 검증 완료**. 남은 것은 네이버
`ChannelOrderSource` 구현이고, 그 선행은 #639 다.

---

## 1. 이 세션에서 develop 에 올린 것 (전부 배포·검증됨)

| 커밋 | 내용 |
|---|---|
| `50063b48b` | ADR-0031 + `CONTEXT.md` (채널 능력 / 채널상품·채널 리스팅 항목 신설) |
| `c299e3ae4` | 주문 수집 port 를 채널 원어로 좁힘 — `ChannelOrderSource` → `ChannelOrderTranslator` → `TranslatingOrderProvider` |
| `117f0a7a7` | 쿠팡 발송이 리스팅 식별자(`vendorItemId`)에 키를 걸게 수정 |
| `21da4557a` | 얕은 주문 수집 층 삭제 (−3,138 / +51) |

마이그레이션 0 · 이벤트 계약 변경 0 · env/secret 0. 게이트: type-check 0 · jest 411 suites /
3,439 tests 실패 0.

## 2. 이미 결정된 것 — 다시 논의하지 말 것

`docs/adr/0031-channel-capability-vector-and-listing-ownership.md` 가 정본이다. 요약:

- 채널을 **등급(퍼스트/서드파티)으로 나누지 않는다.** 능력 벡터로 표현한다.
  `CHANNEL_CAPABILITIES`(코드 상수, 키 = `SalesChannel`, exhaustive `Record`).
- 축: `integration`(`api`/`none` 판별 유니온) · `productOwnership` · `lineIdentity`
  (`embedded`/`mapped`) · 축별 `route`(`projection`/`adapter`/`manual`/`none`).
- **`none`(비대상)과 `manual`(미구현)을 섞지 않는다.** `manual` 은 durable 운영 큐에 남아야 한다.
- 채널상품 **내용**의 SoT 는 능력에 따라 갈린다(link 채널 = 채널). 대가로 link 채널 주문의
  `unitPrice` 는 채널 값을 그대로 싣고 delta 를 기록하지 않는다. **이름은 Core 값**을 쓴다.
- 채널상품 ↔ variant **매핑**의 정본은 능력 무관 **항상 Core `channel_variant_listings`**.
  push 채널도 row 를 갖는다 — row = 선언, 채널 metadata = 관측(식별 fast path).
- 활성화(`sales_channels.is_active`)는 능력이 아니다. `ACTIVE_CHANNELS` env 는 폐기됨.

## 3. 프로덕션 실측 (2026-08-16 기준, 재조사 불필요)

- `sales_channels`: **1행뿐** — `019d0003-0001-7000-a000-000000000001` / `site='MEDUSA'`(대문자)
  / 아몬드영 자사몰 / active. **naver·coupang 행 없음.**
- `sales_orders` by channel: **`medusa` 2,571 이 전부.** naver·coupang·3pl **0건.**
- `channel_products`: **0행.**
- `wms_order_mappings`(medusa): 2,568.
- `order_collection_failures`: `channel_product_identification_failed` **117** /
  `collected_order_modification_not_accepted` **1,514** — 둘 다 `quarantined`,
  최신 각각 08-12·08-14.

### 배포 검증 결과 (통과)

- 폴러 하트비트 `updated_at` age 2분 23초 — 정상 주기(`*/5`).
- 두 스냅샷 사이 `total_syncs`/`successful_syncs` **+62**, `failed_syncs` **+0**,
  `last_error_message` 없음.
- 최근 24h `OrderCreated` **16건** = `wms_order_mappings` 신규 **16건** — 매핑 insert 와 아웃박스
  적재가 같은 트랜잭션이라는 불변식이 지켜짐. 아웃박스 전부 `PUBLISHED`, `PENDING` 0.
- **배포 이후 신규 격리 0건** → 해시 계약이 실동작으로 확인됨.

## 4. 반드시 알아야 하는 함정

- 🔴 **`OrderFetchItem.changes` 에 채널 원어를 넣지 말 것.** 그 값이 `polling_change_hashes` 의
  입력이라, 모양이 바뀌면 배포 직후 한 폴링 주기의 주문이 전부
  `collected_order_modification_not_accepted` 로 격리되고 **그 사유는 replay 가 거부한다**
  (운영자가 화면·API 로 못 지운다). 계약을 `channel-order.translator.spec.ts` 가 못 박고 있다.
- 🔴 **라인 식별자는 채널마다 다른 것을 가리킨다.** 네이버는 주문 라인(`productOrderId` =
  `orderItemId`), 쿠팡은 리스팅(`vendorItemId` = `channelProductId`). `ChannelCommand.items` 가
  둘 다 싣는다. 하나만 쓰면 한쪽 채널이 반드시 깨진다.
- ⚠️ **`sync_statuses.last_sync_at` 은 하트비트가 아니다.** `recordSyncComplete` 가
  `if (result.watermark !== null)` 로 감싸므로, 폴링에서 아무것도 안 잡히면 갱신되지 않는다.
  살아있는지 보려면 **`updated_at`** 을 본다.
- ⚠️ **jest 는 반드시 저장소 루트에서 돌린다.** `apps/channel-adapter` 에서 돌리면
  `tsconfig.jest.json` 을 못 찾거나 다른 앱 스펙이 딸려 들어와 가짜 실패가 난다.
  `npx jest --maxWorkers=2` (OOM 방지).
- ⚠️ `sales_channels.site` 는 자유 문자열이고 시드가 **대문자** `'MEDUSA'` 를 넣는다.
  조회(`channel-listing.service.ts:118`)는 대소문자를 그대로 비교한다. → #639.

## 5. 열린 이슈

| 번호 | 내용 | 라벨 | 상태 |
|---|---|---|---|
| #638 | `channel_products` 폐기 (2 PR) | `ready-for-agent` | **선행 충족(0행)** — 바로 착수 가능 |
| #639 | `sales_channels.site` 어휘 정렬 (1행) | `ready-for-agent` | 네이버·쿠팡 개통의 선행 |
| #640 | 미매핑 주문 격리 큐 운영 화면 | `needs-triage` | ADR-0031 결정 4가 필수로 만듦 |
| #641 | `variantCode` notNull + 리스팅 키 이관 (장기) | `needs-triage` | expand-contract 3 PR |
| #642 | 죽은 테이블 3개 + 이벤트 3종 정리 | `needs-triage` | 수집 층 삭제의 파급 |

## 6. 다음에 할 일 (추천 순서)

1. **#639** — 1행짜리 마이그레이션. 끝나면 운영자가 `site='naver'` 판매채널 행을 만들어야
   한다(그 작업을 시드에 넣을지 수기로 할지 미결).
2. **네이버 `ChannelOrderSource` 구현** — 후보 2가 자리를 비워뒀다. 옛 코드의 API 지식은
   조회 경로에 남아 있다: 2단계 조회(`getLastChangedStatuses` → `getOrderDetails`),
   `orderId`→`productOrderIds` 조합 조회, `transformProductInfosToInternalEvents`,
   `mapNaverStatusToInternal`.
3. **#638** — 독립적이라 아무 때나.
4. **#640** — 네이버를 켜면 미매핑이 실제로 쌓이므로 그 전에.

## 7. 미해결 질문

> **✅ 아래 두 질문(1,514건 / 117건)은 2026-08-17 에 해소됐다.** 근거는
> `2026-08-17-order-collection-false-quarantine-analysis.md`, 조치 항목은 **#647**.
> 아래 서술은 당시 가설이며 **둘 다 실측으로 기각됐다** — 남겨두는 것은 기록 목적이다.

- ~~**`collected_order_modification_not_accepted` 1,514건의 정체.**~~ **기각.** 일회성 버스트가
  아니라 07-09~08-14 두 달에 걸친 상시 발생이었다(스파이크 다수: 08-05 283, 08-11 225).
  100% 가 core mapping 을 갖는 것은 이 사유에선 **정상**이다. 08-14 이후 끊긴 이유는 미규명.
- ~~**`channel_product_identification_failed` 117건의 처리 여부.**~~ **기각. 주문 유실 0건.**
  117건 **전부** 격리보다 먼저(중앙값 23일 전) 이미 Core 판매주문이 만들어져 있었다. "Core
  판매주문이 아예 안 만들어진 것"이라는 위 서술은 격리 *시점*에는 맞지만, 그 주문들은 이미
  수집된 뒤 재폴링에서 **가짜로 격리된 것**이다. 원인은 검사 순서 — 식별 게이트가 dedup 앞에
  있다 (#647).
- **조회 표면의 최종 처분.** `/adapter/:channel/query/*` 를 남겼다(부작용 없음 + 개통 전 유용).
  네이버가 붙은 뒤에도 필요한지 재검토.
- **`3pl` 채널 실사용 0건.** admin-web 이 `phone_order → 3pl` 매핑을 갖고 있는데 주문이 없다.
  ADR-0031 의 `integration: 'none'` 분류는 유효하나 미검증이다.

## 8. 참고 문서

- `docs/adr/0031-channel-capability-vector-and-listing-ownership.md` (이번 세션 산출)
- `CONTEXT.md` §채널 능력 · §채널상품·채널 리스팅 · §채널 주문 수집 신뢰성 · §채널 상품 식별 실패
- ADR-0013(판매채널 projection) · 0016(Payment Accepted 이후 lifecycle) · 0011(공통 판매가능수량)
- `apps/channel-adapter/CLAUDE.md` — **일부 낡음**: Provider 패턴 설명과 `ACTIVE_CHANNELS`,
  `pending_orders` 서술이 이번 삭제로 사실과 어긋난다. 갱신 대상.
