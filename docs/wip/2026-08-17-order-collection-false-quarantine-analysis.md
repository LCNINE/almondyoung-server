# 분석 기록 — 주문 수집 격리 117건의 정체 (2026-08-17)

> 결론: **주문 유실 0건.** `channel_product_identification_failed` 117건은 전부 거짓 경보다.
> 조치 항목은 #647 에 있다. 이 문서는 그 판정의 **근거 기록**이다.

대상 DB: **channel-adapter** (core 아님).

---

## 1. 무엇을 물었나

핸드오프(`2026-08-16-channel-adapter-multichannel-handoff.md` §7)가 남긴 두 질문:

1. `channel_product_identification_failed` **117**건 — Core 판매주문이 아예 안 만들어진 것이라 급한가?
2. `collected_order_modification_not_accepted` **1,514**건 — 배포에 의한 일회성 버스트인가?

둘 다 **아니오**로 판정됐다.

## 2. 판정을 가른 것

`order_collection_failures.status` 는 신뢰할 수 없다. `recordFailure` 의 `onConflictDoUpdate`
가 재발 시 status 를 `quarantined` 로 되돌리고 `replayed_at` 을 지운다
(`order-collection-failure.service.ts:44-55`). 그래서 "한 번도 해소 안 됨"과 "해소됐다가 재발"이
같은 모양이 된다.

**결정적 판정은 `wms_order_mappings` 대조다.** 매핑 행 = 그 주문이 Core 판매주문이 됐다는 뜻이다
(매핑 insert 와 아웃박스 적재가 같은 트랜잭션이다).

## 3. 실측 결과

### 3-1. 유실 여부 — 없음

```sql
SELECT f.status,
       (m.channel_order_id IS NOT NULL) AS has_core_mapping,
       count(*) AS orders
FROM order_collection_failures f
LEFT JOIN wms_order_mappings m
       ON m.sales_channel = f.channel AND m.channel_order_id = f.external_order_id
WHERE f.reason = 'channel_product_identification_failed'
GROUP BY 1, 2;
```

| status | has_core_mapping | orders |
|---|---|---|
| quarantined | **true** | **117** |

`has_core_mapping = false` 는 **0행**이다.

### 3-2. 순서 — 매핑이 격리보다 **먼저** 생겼다

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE m.created_at <  f.created_at) AS mapped_before_quarantine,
       count(*) FILTER (WHERE m.created_at >= f.created_at) AS mapped_after_quarantine,
       min(m.created_at - f.created_at) AS min_gap,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY m.created_at - f.created_at) AS median_gap,
       max(m.created_at - f.created_at) AS max_gap
FROM order_collection_failures f
JOIN wms_order_mappings m
  ON m.sales_channel = f.channel AND m.channel_order_id = f.external_order_id
WHERE f.reason = 'channel_product_identification_failed';
```

| total | before | after | min_gap | median_gap | max_gap |
|---|---|---|---|---|---|
| 117 | **117** | **0** | −56일 07:05 | **−23일 03:00** | −00:28:54 |

전부 음수 = 매핑이 먼저다. 즉 **117건 모두 격리되기 전에 이미 Core 에 있었다.**

### 3-3. replay 흔적 — 없음

```sql
SELECT status, count(*) AS rows,
       count(replayed_at) AS has_replayed_at,
       count(replayed_wms_order_id) AS has_replayed_wms_id,
       count(error_message) AS has_error_message
FROM order_collection_failures
WHERE reason = 'channel_product_identification_failed'
GROUP BY status;
```

| status | rows | replayed_at | replayed_wms_id | error_message |
|---|---|---|---|---|
| quarantined | 117 | **0** | **0** | **0** |

사람이 고친 것도, 자동 재시도가 성공한 것도 아니다. **고칠 게 없었다.**

### 3-4. 실패 라인의 모양 — `variant` 관계가 통째로 없다

```sql
SELECT (item ? 'variant')                        AS has_variant_obj,
       (item->'variant' ? 'metadata')            AS has_metadata_key,
       (item->'variant' ? 'product')             AS has_product_obj,
       count(*)                                  AS failed_lines,
       count(DISTINCT f.external_order_id)       AS orders
FROM order_collection_failures f
CROSS JOIN LATERAL jsonb_array_elements(f.raw_order->'items') AS item
JOIN LATERAL jsonb_array_elements_text(f.affected_line_ids) AS bad(line_id)
  ON bad.line_id = item->>'id'
WHERE f.reason = 'channel_product_identification_failed'
GROUP BY 1, 2, 3;
```

| has_variant_obj | failed_lines | orders |
|---|---|---|
| **false** | **166** | 117 |

"있는데 metadata 만 빈" 경우는 **0건**이다. 라인 원본 JSON 을 보면 `variant_id`, `product_id`,
`variant_title`, `variant_barcode`, `product_title` 같은 **비정규화 복사 필드는 멀쩡한데**
`variant` 객체만 없다.

### 3-5. 라인 단위인가 주문 단위인가 — **라인 단위**

주문의 라인이 *전부* 실패한 경우는 117건 중 **2건뿐**이다. 대부분 6중1, 7중1, 88중3, 75중17 처럼
일부만 실패한다.

→ 응답 단위로 관계가 빠지는 게 아니라 **특정 variant 단위** 문제다. 같은 상품이 반복 등장한다
(컬리넌 핀셋이 variant id 3개, 긴 마이크로 면봉, 브로우 마스터 엠보 니들 …).

### 3-6. 1,514건의 분포 — 버스트 아님

일별(`created_at`) 집계: 07-09부터 08-14까지 **두 달에 걸쳐 매일** 발생하고 스파이크가 여럿이다.

| 날짜 | 건수 | 날짜 | 건수 |
|---|---|---|---|
| 08-05 | 283 | 08-04 | 115 |
| 08-11 | 225 | 07-28 | 51 |
| 08-10 | 111 | 08-07 | 46 |

"배포에 의한 일회성 버스트" 가설은 이 분포로 **기각**된다. 그리고 이 사유는 100% 가 core mapping
을 갖는 것이 **정상**이다 — 이미 수집된 주문의 사후 변경이므로.

다만 **왜 08-14 이후 뚝 끊겼는지는 미규명**으로 남는다.

## 4. 메커니즘

폴러는 `updated_at > 워터마크` 로 묻기 때문에 **이미 수집한 주문도 바뀌면 다시 온다**(정상).

- 정상 경로: `processOrderItem` 이 **매핑 조회를 제일 먼저** 한다 (`order-poller.orchestrator.ts:272-281`)
- 문제 경로: 라인 식별이 훨씬 앞, 번역기 안에서 일어나고 실패하면 거기서 끝난다
  (`channel-order.translator.ts:47` 하드 early-return). orchestrator 도 실패 항목을 **무조건**
  기록한다 (`:118-123`)

매핑 조회 코드는 있고 잘 돈다 — **갈림길의 반대편에 있을 뿐이다.**

식별자(`variant.metadata.pimVariantId` 등)는 비정규화 복사본이 아니라 **원본 variant 를 따라가서**
읽으므로(`medusa-order.source.ts:112-120`), 원본이 사라지면 복사 필드는 남고 식별자만 증발한다.

### 실제 타임라인 (order_01KZP2XRJRSZ2A6BGRQPASHHJE)

```
08-10 14:58   주문 생성 → 식별 성공 → Core 판매주문 생성 ✅ (매핑 행 생성)
   …          그 사이 컬리넌 핀셋 variant 가 Medusa 에서 사라짐
08-11 00:41   주문 변경 → updated_at 갱신
08-12 12:26   폴러가 다시 집어옴 → 식별 실패 → 격리 ❌  ← 잘못된 판단
```

### replay 로는 구조적으로 못 고친다

`replayFailure` 는 `fetchOrder()` → 번역기 → **같은 early-return** 에 걸려
`recordFailure` 를 다시 호출하고 `still_quarantined` 를 반환한다 (`:221-229`).
매핑 조회가 있는 `processOrderItem` 에 **도달조차 못 한다.**

## 5. 두 사유는 같은 뿌리다

재폴링된 기수집 주문이 갈릴 뿐이다.

| 식별 | 경로 | 사유 | 건수 |
|---|---|---|---|
| 성공 | 매핑 조회 → 변경 감지 | `collected_order_modification_not_accepted` | 1,514 |
| 실패 | 그 앞에서 잘림 | `channel_product_identification_failed` | 117 |

## 6. 남은 질문

**Medusa 에서 그 variant 들이 왜 사라졌나** — 삭제인지 재등록인지 미확인. 확인은 Medusa DB 에서
해당 `variant_id` 의 존재/`deleted_at` 조회. #647 의 수정은 원인과 무관하게 유효하다.

**1,514건이 08-14 이후 끊긴 이유** — 미규명.

## 7. 관련

- **#647** — 이 분석에서 나온 조치 항목 (기수집 주문 가짜 격리)
- #643 (네이버 개통) · #640 (격리 큐 화면) — 둘 다 #647 이 선행
- ADR-0031 · 핸드오프 `2026-08-16-channel-adapter-multichannel-handoff.md` §7
