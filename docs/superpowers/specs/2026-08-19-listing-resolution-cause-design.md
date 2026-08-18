# 격리 사유 라인 단위 세분화 (#674)

- 날짜: 2026-08-19
- 이슈: #674
- 선행: #670 (PR #673) — 이 설계는 그 술어 세 축을 전제한다
- 관련: #640 (화면) · #643 (네이버 개통) · ADR-0031 · CONTEXT.md §채널 상품 식별 실패

## 1. 문제

CONTEXT.md line 234 는 이렇게 못 박고 있다.

> **격리 큐는 채널 능력과 무관하게 하나다.** … **해소 수단도 하나다 — 리스팅을 만들면 격리된 주문이 재처리된다.**

**#670 이 그 불변식을 깼다.** 리스팅 조회 술어가 버전·품목·채널 세 축으로 늘면서 해소 수단이 갈렸다.

| 원인 | 조치 |
|---|---|
| 매핑 없음 | 리스팅을 만든다 |
| 품목 판매중지 | 품목을 활성화한다 |
| 활성 버전 없음 | publish 한다 |

그런데 `order_collection_failures.reason` 은 `channel_product_identification_failed` **한 종류**다. 운영자는 셋 중 무엇을 해야 하는지 알 수 없고, **리스팅을 만들어도 안 풀리는 격리**가 생겼다.

이건 UX 개선이 아니라 #670 이 만든 부채를 갚는 일이다.

## 2. 핵심 판단 — 사유는 주문이 아니라 **라인** 단위다

네이버 주문 한 건에 라인이 셋이면 라인 A 는 매핑 없음, 라인 B 는 품목 판매중지일 수 있다. `reason` 은 주문당 한 칸이므로, 거기에 세분화된 값을 넣으면 **우선순위 규칙을 강제하고 나머지 라인의 사유를 버린다.** 채널·라인 수가 늘수록 손실이 커진다 — 다채널 미래에서 정확히 반대 방향이다.

따라서 세분화는 `reason` 을 쪼개는 게 아니라 **라인별 진단을 담는 새 필드**로 간다.

부수 효과 둘이 이 선택을 더 밀어준다.

1. **unique 키가 조용히 옳아진다.** `uq_order_collection_failure` 는 `(channel, external_order_id, reason)` 이고 `recordFailure` 가 그 키로 upsert 한다. `reason` 이 상수로 고정되면 실질 키가 `(channel, external_order_id)` 가 된다 — 채널당 주문당 격리 하나. `reason` 을 쪼갰다면 사유가 바뀌는 주문이 큐에 **두 건으로** 보이고 옛 행이 `quarantined` 인 채 영원히 남는다.
2. **필터는 이 선택의 대가가 아니다.** jsonb 배열에 GIN 인덱스 + containment(`@>`) 면 "품목 판매중지가 낀 격리만" 을 그대로 거른다. 인덱스는 필요해질 때(#640) 붙인다.

## 3. Core 계약

### 3.1 `/channel-listings/resolve` 신설

옛 `GET /channel-listings/lookup` 은 **손대지 않는다.**

이유: 미스가 JSON `null` 이 아니라 **HTTP 204** 다 (`channel-listing.client.ts:60`). 같은 경로를 200+본문으로 바꾸면 옛 어댑터가 `{found:false, cause}` 를 `LookupVariantResult` 로 읽어 **`variantId: undefined` 인 채 "식별 성공"으로 처리한다.** 배포 순서를 지켜도 롤백 한 번이면 발생하는 조용한 오염이다.

경로로 버전을 가르면 배포 순서가 어느 쪽이든 안전하다.

```ts
type ResolveResult =
  | { found: true;  listing: LookupVariantResult }
  | { found: false; cause: ListingResolutionCause };
```

쿼리 파라미터는 `/lookup` 과 동일: `salesChannelId` | `channelCode`, `channelItemId`. 미스도 **200** 이다.

`/lookup` 삭제는 어댑터가 다 넘어간 뒤 후속 PR (expand-contract).

### 3.2 사유 어휘

가르는 기준은 "증상이 다른가"가 아니라 **"운영자가 할 일이 다른가"** 다.

| cause | 상태 | 조치 | 산출 |
|---|---|---|---|
| `listing_not_found` | 매핑 행 자체가 없다 | 리스팅을 만든다 | Core |
| `listing_inactive` | 매핑은 있으나 꺼져 있다 | 리스팅을 켠다 | Core |
| `channel_inactive` | 판매채널이 꺼져 있다 | 채널을 켠다 | Core |
| `variant_inactive` | 품목이 판매중지 | 품목을 활성화한다 | Core |
| `no_active_version` | 활성 버전이 없다 (비활성·draft) | publish 한다 | Core |
| `product_deleted` | 마스터/버전이 soft delete | 다른 상품으로 재매핑한다 | Core |
| `no_embedded_ids` | `embedded` 채널인데 라인에 식별자 3종이 없다 | Core 를 통해 상품을 다시 만든다 | 어댑터 |
| `no_lookup_key` | 라인에 채널 상품 id 조차 없다 | 채널 데이터 확인 | 어댑터 |
| `unknown` | 판정 불가 (구 Core 폴백·옛 행) | — | 어댑터 |

전부 **Core 카탈로그 상태**에 대한 말이고 채널 특성이 아니다. 채널이 열 개가 돼도 이 표는 안 늘어난다 — CONTEXT.md 234 의 "격리 큐는 채널 능력과 무관하게 하나다"가 유지된다.

뒤 셋은 Core 를 부르기 전/후에 어댑터가 낸다. 어휘는 한 벌, 산출 지점은 둘이다.

**어휘의 집은 `@packages/domain-types` 다.** 어댑터는 지금 `LookupVariantResult` 를 자체 재정의해 쓰고 있는데(`channel-listing.client.ts:6`), 그 방식을 이 어휘에 그대로 쓰면 안 된다 — 이 값들은 **영속되고** 화면이 렌더한다. 한쪽에만 값이 늘면 다른 쪽은 조용히 틀린다.

그래도 **어댑터는 모르는 값을 만날 수 있다** (Core 를 먼저 배포하므로). 받은 문자열이 알려진 집합 밖이면 `unknown` 으로 낮춰 저장한다 — 타입이 거짓말하는 것보다 낫고, 화면도 "판정 불가"로 일관되게 읽는다.

### 3.3 사유 계산

```
sellable 술어로 조회 → 행 있으면 { found: true }   ← 지금과 동일, 비용 동일
                     → 0행이면 진단 쿼리 1회 추가   ← 미스 경로에서만
```

진단 쿼리는 `channel_variant_listings` 에서 시작해 **전부 LEFT JOIN** 한다. inner join 이면 master-variant 행이 없는 리스팅이 0행을 내 `listing_not_found` 로 오진된다.

우선순위 (여럿이 동시에 성립할 때):

```
listing_not_found → listing_inactive → channel_inactive
  → product_deleted → no_active_version → variant_inactive
```

`product_deleted` 를 `variant_inactive` 앞에 두는 이유: 상품이 지워졌으면 품목 상태를 볼 의미가 없고 조치도 재매핑 하나다.

**경계 하나를 명시한다**: 리스팅과 품목은 있는데 `product_master_variants` 행이 없어 어떤 버전에도 안 매달린 경우 → `no_active_version`. 조치가 publish 로 같기 때문이다. (반대로 품목 행 자체가 없는 경우는 생기지 않는다 — `channel_variant_listings.variant_id` 가 `onDelete: 'cascade'` 라 리스팅이 품목보다 오래 살 수 없다.)

별도 진단 엔드포인트를 두지 않는다 — 다채널일수록 HTTP 왕복 수가 곱해지므로 한 번에 끝낸다.

### 3.4 파일

- `apps/core/.../channels/channel-listing-diagnosis.query.ts` — 진단 쿼리 + 우선순위
- Core 마이그레이션 **0** (읽기만)

## 4. 어댑터

### 4.1 전파 — `null` 을 판별 유니온으로

```ts
// ChannelLineIdentityResolver.resolve
type LineResolution =
  | { identified: true;  identity: ResolvedLineIdentity }
  | { identified: false; cause: ListingResolutionCause };
```

이 파일은 이미 `OrderLifecycleEventItem` 주석에서 같은 이유로 판별 유니온을 채택했다 (*"계약이 잡아 줄 것을 캐스팅으로 덮는 것은 ADR-0029 가 없애려는 실패 모드"*).

`ChannelOrderTranslator` 는 `unidentifiedLineIds: string[]` 대신 `{ lineId, cause }[]` 를 모은다.

### 4.2 저장

```ts
affectedLines: jsonb('affected_lines').$type<{ lineId: string; cause: ListingResolutionCause }[]>()
```

- **nullable.** `COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED` 행과 기존 행은 `null` 이다 — 옛 격리 건은 사유를 모르는 게 사실이므로 `null` 이 정직하다. 백필하지 않는다
- `affected_line_ids` 는 **그대로 둔다.** rename 이 아니다 — `order-poller.orchestrator.ts:480` 의 다른 사유가 같은 필드를 쓴다. 따라서 ADR-0005 §5 의 3-PR 이관이 필요 없다
- `reason` 은 그대로 ⇒ unique 키 의미 불변
- `recordFailure` 의 `onConflictDoUpdate` `set` 에 새 필드를 **반드시** 넣는다. 사유는 폴링마다 달라진다 (매핑을 만들면 `listing_not_found` → `variant_inactive`)

마이그레이션 **1건** (channel-adapter, additive).

### 4.3 롤아웃 폴백

`ChannelListingClient` 가 `/resolve` 를 부르고 **404 면 `/lookup` 으로 폴백**한다 (미스 → `cause: 'unknown'`). Core 를 롤백해도 어댑터가 안 깨진다. 폴백 제거는 후속 PR.

### 4.4 운영 표면

`GET /adapter/order-collection-failures` 목록·상세에 필드가 그대로 실린다 (행 전체 반환 구조). **사유 필터는 만들지 않는다** — 화면이 없어 쓸 데가 없고, 필요해지면 GIN + containment 한 줄이다.

## 5. 문서

CONTEXT.md line 234 의 *"해소 수단도 하나다 — 리스팅을 만들면 격리된 주문이 재처리된다"* 를 §3.2 의 사유별 조치표로 대체한다. 이 문장이 남으면 다음 사람이 사유 세분화를 불필요한 것으로 읽는다.

## 6. 검증

전부 TDD — RED 를 먼저 확인한다.

| 층 | 대상 |
|---|---|
| Core 계약 스펙 (`.toSQL()`, DB 불필요) | 진단 쿼리가 LEFT JOIN 이고 sellable 술어를 안 건다 |
| Core 통합 (실 Postgres) | Core 산출 사유 6종 각각 → 기대 cause. 우선순위 겹침 2건 |
| 어댑터 유닛 | resolver 유니온 · translator 수집 · `recordFailure` 사유 flip 시 **행이 하나로 유지** |
| 어댑터 유닛 | `/resolve` 404 → `/lookup` 폴백 → `unknown` |

게이트: `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0 · `npm run test:core:integration:local`.

## 7. 배포 순서

```
1) channel-adapter migrate   (nullable 컬럼 — expand 이므로 migrate → deploy)
2) Core deploy               (/resolve 신설)
3) channel-adapter deploy    (/resolve 사용 + 컬럼 기록)
```

2·3 이 뒤집혀도 §4.3 폴백이 받는다. **1 은 3 보다 반드시 앞.**

라이브 영향: 없다. 네이버·쿠팡 리스팅이 0행이고 Medusa 는 `embedded` 라 이 조회를 타지 않는다. 실효는 #643 개통 시점.

## 8. 범위 밖

auto-replay 정책 · 사유별 알림 · `/lookup` 삭제 · jsonb GIN 인덱스 · 격리 큐 화면(#640) · 옛 행 백필.
