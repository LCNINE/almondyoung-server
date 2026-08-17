# 핸드오프 — 채널 어댑터 다채널 주문 수집 (2026-08-16)

> 목표: 네이버·쿠팡 주문 수집 개통. 이 세션은 **그 토대**를 놓았다 — 결정(ADR-0031), 수집 층
> 재설계, 죽은 층 제거. 실제 네이버 수집은 아직 시작 안 했다.

> ⚠️ **최종 갱신 2026-08-18.** 이 문서는 08-16 세션의 핸드오프이고, 그 뒤로 상태가 여러 번
> 바뀌었다. **§5·§6 은 08-18 기준으로 갱신했으니 그 두 절을 신뢰할 것.** §1~§4 는 08-16
> 시점의 기록이며 여전히 유효하다(결정·실측·함정은 바뀌지 않았다).
>
> 전체 이슈 현황은 현황판 아티팩트에 한 장으로 정리돼 있다 —
> https://claude.ai/code/artifact/66f6afe7-704c-49fa-a8ea-92c329235592

## 한 줄 요약

develop `21da4557a` 까지 머지·푸시·배포·**라이브 검증 완료**(08-16). 그 뒤 #647·#649·#650 이
해소되고 **판매채널 생성이 처음으로 가능해졌다**(PR #653, 08-18 배포·스모크 완료).

남은 것은 네이버 `ChannelOrderSource` 구현(#643)이고, **그 선행은 이제 #599 · #654 · #652 셋**이다
(#639 는 완료).

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

## 5. 열린 이슈 (2026-08-18 갱신)

### 해소됨

| 번호 | 내용 | 어떻게 |
|---|---|---|
| #638 | `channel_products` 폐기 | PR #645 · #646 |
| #639 | `sales_channels.site` 어휘 정렬 | PR #644 |
| #647 | 기수집 주문이 재폴링에서 가짜 격리 | PR #651 |
| #649 결함 1 | 판매채널 폼의 type/site 혼동 | PR #653 — **배포·스모크 완료(08-18). 이제 화면에서 `site='naver'` 행을 만들 수 있다** |
| #650 | 죽은 `credentials` 시크릿 입력면 | PR #653 |

### #643(네이버 개통) 선행 — 서로 독립

| 번호 | 내용 | 왜 개통 전인가 |
|---|---|---|
| **#599** | 폴러 이중 실행 + 해시 확인이 트랜잭션 밖 | 네이버를 켜면 취소·환불 lifecycle 이 실트래픽이 된다. 중복 발행된 두 이벤트는 messageId 가 달라 core 멱등 가드가 못 잡는다. **08-18 코드 확인 결과 미수정** |
| **#654** | `sales_channels.is_active` 에 집행 지점 없음 | 문제가 생겨도 "일단 네이버 끄자"가 안 통한다. #649 결함 2가 여기로 이관됐다 |
| **#652** | publish 후 리스팅이 옛 variant 를 가리킨 채 남음 | 네이버는 `mapped` 라 매 라인이 리스팅 조회를 탄다. 조회가 실패하지 않고 **옛 값을 반환**해 격리도 로그도 없이 옛 버전 판매정책으로 처리된다 |

### 그 외

| 번호 | 내용 | 상태 |
|---|---|---|
| #643 | 네이버 `ChannelOrderSource` — **본류** | 판정 4건이 코딩보다 먼저 |
| #640 | 미매핑 주문 격리 큐 운영 화면 | 머지는 #643 뒤여도 되나 **라이브 개통은 동시** |
| #642 | 죽은 테이블 3개 + 이벤트 3종 정리 | **판단 대기 소멸** — 세 테이블 0행 실측(08-17). 배포 있는 날에 끼울 것 |
| #641 | `variantCode` notNull 승격 (장기) | **보류.** `variant_code` 8,114 / 35,239 (23%) null 실측 |
| #625 | 상품 동기화가 price list 갱신보다 캐시를 먼저 걷음 | 개통과 독립 |
| #509 | 자체 `RetryPolicy` 데코레이터 이관 | 개통과 독립 |

## 6. 다음에 할 일 (2026-08-18 기준 추천 순서)

```
#599(1번 항목만) → #654 → #652 → #643 + #640 개통
```

1. **#599 의 1번 항목만** — 해시 확인을 트랜잭션 안으로 + 조건부 갱신. **판정 0이고 지금 바로
   가능하다.** 유일하게 현재형 위험이기도 하다(이중 크론이 없어도 폴이 겹치면 성립).
   ⚠️ 2번(이중 크론 원인 규명)·3번(core·membership·wallet 영향)은 **떼어낼 것** — 성격이 다르고
   범위가 번진다.
2. **#654** — 작고, 그 뒤 모든 작업의 안전망이 된다. 선행 판정 하나: channel-adapter 가 채널
   활성 상태를 어떻게 읽을지(내부 키 권고 / `@Public()` 추가는 무인증 내부 API 축소 흐름에 역행).
3. **#652** — 착수 전 "이미 끊긴 리스팅" 카운트 쿼리부터. 0이면 reconciler 하나, 0이 아니면
   일회성 재지정 스크립트가 붙는다.
4. **#643 + #640** — 머지는 순차라도 **설계는 한자리에서**. #643 의 판정 1(`channelProductId` 정본)이
   #640 화면에서 운영자가 등록할 값과 같아야 한다. 첫 판은 `OrderCreated` 만 열고 취소·환불은
   2차로 미루는 것을 권한다.

**곁가지**: #642 는 판단 0이지만 destructive 마이그레이션이라 `deploy → migrate` 순서가 붙는다.
자체 심부름으로 만들지 말고 **어차피 배포가 있는 날에 끼워 넣을 것**.

네이버 구현 시 참고할 옛 API 지식은 조회 경로에 남아 있다: 2단계 조회
(`getLastChangedStatuses` → `getOrderDetails`), `orderId`→`productOrderIds` 조합 조회,
`transformProductInfosToInternalEvents`, `mapNaverStatusToInternal`.
**참고용이지 재사용 대상이 아니다** — 삭제된 얕은 층의 어휘로 말한다.

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
- `apps/channel-adapter/CLAUDE.md` — `f7c262d98` 에서 정정됨. 2026-08-18 에 `ACTIVE_CHANNELS`
  항목을 한 번 더 손봤다(활성화가 "결정"됐을 뿐 **집행 코드가 없다**는 사실을 명시 — #654).
