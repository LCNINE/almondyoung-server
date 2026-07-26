# warehouse-app 적치 대기 큐 — 설계

- 날짜: 2026-07-26
- 대상: `native/warehouse-app` (핸드헬드 프로필) + `apps/core` inbound 모듈
- 선행: Phase 2 입고/검수 (PR #540, `docs/superpowers/specs/2026-07-25-warehouse-app-phase2-inbound-design.md`)

## 1. 문제

Phase 2 는 적치를 **입고 직후 연속 흐름**으로만 구현했고, 건너뛰기를 허용했다. 건너뛴 라인을 다시 잡을 방법이 앱에 없다. `lineId` 는 입고 직후 화면의 로컬 상태로만 존재하고, 화면을 벗어나면 사라진다.

결과:

- 재고는 입고기본존에 남고, 작업자는 그 사실을 앱에서 알 수 없다.
- 일반 이동(`POST /movement/move`)으로 옮기면 `PUTAWAY` 워크로그가 안 남고 `putawayFromOriginQty` 도 안 오른다. 회송·취소 잠금이 걸리지 않아 부기가 조용히 어긋난다.
- Phase 3 피킹은 "재고가 실제 로케이션에 있다"를 전제한다. 미적치 재고가 쌓인 상태로 피킹을 붙이면 피킹리스트가 입고기본존을 가리킨다.

**admin-web 경로도 살아 있지 않다.** `receipt-detail-drawer/index.tsx:59` 가 `row as unknown as { lines?: … }` 로 라인을 꺼내는데, `GET /inbound/receipts` 응답에 `lines` 가 없다(`inbound.service.ts:495-504` 는 `lineId` 조차 select 하지 않는다). 항상 빈 배열이라 `PutawayDialog` 는 열리지 않는다. 즉 **현재 시스템 전체에서 입고 직후 화면을 벗어난 라인은 어디서도 적치할 수 없다.**

## 2. core 의 적치 계약 (기존 사실)

`POST /inbound/putaway` → `InboundService.putawayFromOrigin` (`inbound.service.ts:822`).

입력은 `{ lineId, toLocationId, quantity, idempotencyKey }` 뿐이다. **출발지는 입력이 아니라 `inbound_receipt_lines.originLocationId` 에서 읽는다**(`:834`).

동작:

1. 목적지 검증 — 존재 · `isActive` · 영수증과 같은 창고 (`:838-844`)
2. 라인 잔량 검증 — `quantity − putawayFromOriginQty − returnedQty − canceledQty` (`:846`)
3. 원장 검증 — 출발지 `ON_HAND >= quantity` (`:852`)
4. `commandService.moveInternal(...)` — **평범한 `MOVE` 이벤트 1건**, `reason: 'putaway_internal_move'`
5. 라인의 `putawayFromOriginQty` 증가
6. `inbound_work_logs` 에 `type: 'PUTAWAY'` 기록

원장 관점에서 적치는 이동과 동일하다. 전용 transition type 이 없다. 다른 것은 부기 셋뿐이다: 입고 라인 스코프, 회송·취소를 막는 카운터(`:909`, `:982`), 타임라인의 `PUTAWAY` 기록.

따라서 **적치의 대상은 로케이션이 아니라 입고 라인의 미적치 잔량이다.** 입고기본존에 있어도 라인이 없는 재고(위치 미지정 `ADJUST_UP` — `inventory-command.service.ts:449`, 이동으로 들여놓은 재고, 실사 반영분)는 적치할 수 없고, 일반 이동으로만 옮긴다.

## 3. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 기본 기간 필터 | 최근 1일 | 당일 소진이 주 용도. 7일·전체로 넓힐 수 있음 |
| 대상 선택 동선 | 상품 스캔 우선 + 목록 병존 | 손에 든 물건이 출발점. 목록은 훑어보기용으로 남김 |
| 다중 라인 (같은 SKU) | 후보 목록 제시 | 부분 실패가 없고 구현이 단순. 단건이면 목록을 건너뜀 |
| 부분 적치 | 수량 수정 가능 (`NumberPad`, 프리필=잔량) | 선반이 모자라 나눠 넣는 상황. 서버가 이미 허용 |
| 큐 포함 조건 | 출발지가 `isSystem` 로케이션인 라인만 | 임시로 쌓아둔 것 = 할 일. 직입고된 라인은 이미 제자리 |
| 백엔드 조회 | 전용 엔드포인트 신설 | 큐는 이력 조회가 아니라 작업 목록 |

검토했으나 채택하지 않은 백엔드 안:

- **`listInboundReceipts` 확장** — 이력 조회와 작업 큐를 한 엔드포인트가 겸하게 된다. admin-web 의 `InboundReceiptDto` 는 이미 실제 응답과 어긋나 있어(응답은 `receiptId`, 타입은 `id`), 이 엔드포인트를 건드리면 그 불일치를 함께 떠안는다. 이 작업의 목적과 무관하다.
- **프론트 합성** — 불가능. 어떤 목록 엔드포인트도 `lineId` 를 내려주지 않고, `lineId` 없이는 적치를 호출할 수 없다.

## 4. 백엔드

### 4.1 신규 리더

**`apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts`**

`inbound.service.ts` 는 1141줄이고 `db.query.*` 규칙 위반이 후속 티켓으로 잡혀 있다(`:1115`, `:1124`). 여기에 조회를 더하지 않고 리더를 신설한다. `stock-projection.reader.ts` · `sku-catalog.reader.ts` 와 같은 패턴이며, 새 코드는 단독으로 테스트된다. 기존 서비스는 건드리지 않는다 — 이 작업의 범위가 아니다.

### 4.2 엔드포인트

`GET /inbound/putaway/pending`

| 파라미터 | 필수 | 의미 |
|---|---|---|
| `warehouseId` | 예 | 앱은 항상 창고 컨텍스트 안에 있다 |
| `days` | 아니오 | 최근 N일. 미지정이면 전체 기간. 앱 기본값 `1` |

`days` 는 **달력일이 아니라 rolling 기준**이다: `occurred_at >= now() − days × 24h`. 야간 조가 자정을 넘겨도 방금 입고한 물건이 큐에서 사라지지 않게 하기 위해서다. 취소 가능 조건("당일 Asia/Seoul")과 기준이 다르지만, 그쪽은 서버가 강제하는 제약이고 이쪽은 화면 필터라 성격이 다르다.

기존 `@Get('pending')`(예정 목록) · `@Post('putaway')` 어느 쪽과도 경로가 충돌하지 않는다.

가드는 인벤토리 컨트롤러 관례대로 전역 `JwtAuthGuard` 만. 이 작업에서 `ScopeGuard` 체계를 새로 도입하지 않는다.

### 4.3 쿼리

`inbound_receipt_lines` 에서 출발해 `inbound_receipts`(status `posted`, 창고 일치) · `skus` · `locations`(출발지)를 `innerJoin`. 조건 둘:

```
locations.is_system = true
quantity − putaway_from_origin_qty − returned_qty − canceled_qty > 0
```

두 번째 식은 `putawayFromOrigin` 의 `originAvailable` 검증식(`inbound.service.ts:846`)과 **같은 식이다.** 큐가 보여주는 잔량과 서버가 허용하는 잔량이 정의상 어긋날 수 없게 하는 것이 목적이다.

정렬은 `inbound_receipts.occurred_at` 오름차순 — 작업 목록이므로 먼저 들어온 것부터 치운다.

인벤토리 쿼리 규칙에 따라 `trx.select().from().innerJoin().where().orderBy()` 로 작성한다. `db.query.*` · `with` 관계 · `any`/`as` 캐스팅 금지.

### 4.4 응답

```ts
{
  total: number;
  items: Array<{
    lineId: string;
    skuId: string;
    skuName: string;
    skuCode: string;
    pendingQty: number;
    originLocationId: string;
    originLocationCode: string;
    receivedAt: string;      // ISO
  }>;
}
```

`pendingQty` 는 서버가 계산해 내려준다. 프론트가 세 카운터를 받아 빼면 같은 식이 두 곳에 생기고, 한쪽만 고쳐지는 순간 화면이 서버가 거부할 수량을 제안하게 된다.

DTO 는 중첩 객체 없이 평평하게 정의한다 (`@ApiProperty({ type: 'object' })` 금지 규칙).

### 4.5 변경하지 않는 것

마이그레이션 0건, 스키마 0건, 기존 엔드포인트 0건.

## 5. 프론트

### 5.1 파일

| 파일 | 성격 |
|---|---|
| `app/routes/PutawayRoute.tsx` | 신규 |
| `app/routeTree.tsx` | 수정 — `/putaway` 의 `PlaceholderScreen` 교체 |
| `domains/inbound/PutawayQueueScreen.tsx` | 신규 |
| `domains/inbound/PutawaySheet.tsx` | 수정 — §6 |
| `domains/inbound/queries.ts` | 수정 — `usePutawayPending` 추가 |
| `domains/inbound/types.ts` | 수정 — `PutawayPendingItem` · `PutawayTarget` 추가 |
| `domains/inbound/mutations.ts` | 수정 — 무효화 목록에 `putaway-pending` 추가 |
| `core/data/errorMessage.ts` | 수정 — `putaway` 문맥 추가 |

`mutations.ts` 변경이 중요하다. `invalidateAfterLedgerWrite` 에 `['putaway-pending']` 을 넣어야 입고 직후 화면에서 적치를 건너뛴 라인이 큐에 즉시 나타나고, 큐에서 적치한 라인이 사라진다. 두 화면이 같은 원장을 움직이므로 한쪽만 갱신되면 서로 거짓말을 한다.

### 5.2 상태 흐름

```
창고 미설정 → WarehousePicker (PendingPlanListScreen 과 동일 패턴)
       ↓
큐 로드 (usePutawayPending(warehouseId, days))
       ↓
  ┌─────────────────────────────────┬──────────────────┐
  │ 스캔 (useScanner)                │ 목록에서 탭       │
  │   ↓ useSkuByBarcode.mutate       │                  │
  │   ↓ skuId 로 로드된 큐를 필터     │                  │
  │  0건 → "적치 대기 없음" 안내      │                  │
  │  1건 → 시트                      │  → 시트           │
  │  N건 → 후보 목록 → 시트           │                  │
  └─────────────────────────────────┴──────────────────┘
       ↓ 적치 성공
  무효화 → 큐 재조회 (잔량이 남으면 줄어든 채로 남는다)
```

후보 목록의 한 행은 `입고시각 · 잔여수량 · 출발지 코드` 를 보여준다. 작업자가 같은 SKU 의 두 라인을 구분할 근거가 그 셋뿐이고, 실제로 갈라지는 것은 출발지다(반품기본존에서 온 건과 입고기본존에서 온 건은 갈 곳이 다를 수 있다).

목록 화면의 한 행도 같은 정보를 쓴다 — `상품명 · 잔여수량` 을 주 행에, `출발지 코드 · 입고시각` 을 보조 행에.

스캔 필터를 **클라이언트에서** 하는 이유는 왕복 절감보다도, 큐에 없는 상품을 스캔했을 때 "이 상품은 적치 대기가 없습니다"를 즉시 구분해 말할 수 있어서다. 서버 필터라면 빈 응답이 "없음"인지 "조회 실패"인지 화면이 알 수 없다.

`useSkuByBarcode`(`GET /inventory/skus?barcode=`)를 그대로 재사용한다. 스캔을 `useQuery` 가 아니라 `useMutation` 으로 다루는 이유 — 캐시 신선도와 실제 스캔 횟수의 어긋남 — 가 그 파일에 문서화돼 있고 같은 함정이 여기에도 적용된다.

### 5.3 기간 필터

`[최근 1일 ▾]` — 1일 / 7일 / 전체 3단, 기본 1일. `useState` 로컬 상태가 쿼리 키를 구동한다. URL 에 두지 않는 것은 재고조회 DataTable 과 같은 이유다(memory routing 이라 URL 이 없다).

쿼리 키: `['putaway-pending', warehouseId, days]`.

### 5.4 직전 대상지 칩

큐 화면에도 둔다. 한 파렛트를 같은 선반에 연속으로 넣는 동선이 입고 직후와 동일하다.

## 6. PutawaySheet 개편

현재 시트는 `FreshLine`(입고 직후 전용 타입)을 받고, 출발지를 "입고기본존" 문자열로 하드코딩하며, 수량을 `line.quantity` 로 고정한다(`PutawaySheet.tsx:84`, `:165`).

### 6.1 입력 타입

```ts
export interface PutawayTarget {
  lineId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationCode: string;    // 표시용
  originLocationId?: string;     // 있으면 대상지 후보에서 제외
}
```

호출자 둘이 각자 어댑팅한다. 큐는 응답을 그대로 넘기고, 입고 직후 화면은 `pendingQty = line.quantity`, `originLocationCode = '입고기본존'` 으로 채운다.

`originLocationId` 가 **선택**인 이유: 입고 직후 경로는 그 값을 모른다. `ReceiveFromPlanResult` 는 `{success, receiptId, lineId}` 뿐이고 `SimpleInboundLine` 도 `{id, skuId, quantity}` 뿐이다(`types.ts:41,54`). 그 경로는 출발지가 항상 입고기본존이라 작업자가 그것을 대상지로 스캔할 일이 사실상 없다. 없을 때 가드를 못 거는 것을 타입으로 드러내는 편이, 응답에 없는 값을 추측해 채우는 것보다 정직하다.

### 6.2 변경 넷

1. **수량 입력** — `NumberPad` 프리필 `pendingQty`, "전량" 버튼. 유효 범위 `1..pendingQty`. 서버도 `originAvailable` 로 같은 상한을 건다.
2. **출발지 표시** — `{originLocationCode} · 잔여 {pendingQty}개`.
3. **동일 로케이션 차단** — `originLocationId` 가 있으면 대상지 후보에서 제외한다. 서버는 이를 막지 않는다 (`movement.service.ts:45` 의 가드가 `putawayFromOrigin` 에는 없다). 통과시키면 자기 자신으로의 `MOVE` 가 남고 `putawayFromOriginQty` 만 올라 **회송·취소가 영구히 잠긴다.**
4. **멱등키 회전 조건에 수량 추가** — 지금 `keyPayloadRef` 는 `{lineId, to}` 만 본다(`PutawaySheet.tsx:64`). 수량이 고정일 때는 충분했다. 가변이 되면 이 경로가 열린다:

   ```
   30개 전송 → 서버 커밋 → 응답 유실 → 작업자가 50으로 고쳐 재전송
   → 같은 멱등키 → 서버가 30개 결과를 replay → 화면은 "50개 완료"
   → 실제 원장은 30개. 20개가 남아 있는데 화면은 끝났다고 말한다
   ```

   `keyPayloadRef` 를 `{lineId, toLocationId, quantity}` 로 넓힌다. Phase 2 브랜치 리뷰가 잡은 "응답유실 후 수량 고쳐 재제출 → 이중 입고"와 같은 종류의 결함이며, 부분 적치를 켜는 순간 적치 쪽에도 그 문이 열린다.

## 7. 에러 처리와 경계 상황

### 7.1 새 에러 문맥

`errorMessage.ts` 의 `inbound` 문맥은 400 을 "입고기본존 재고가 부족해요"로 번역한다. 큐는 출발지가 입고기본존이 아닐 수 있고(반품기본존·재작업존도 `isSystem`), 조회 실패에도 이 문구가 붙으면 거짓말이 된다. `putaway` 문맥을 추가한다:

```ts
putaway: {
  400: '출발지 재고가 부족하거나 이미 적치됐어요. 새로고침 후 확인해 주세요.',
  404: '입고 라인을 찾을 수 없어요. 새로고침 해주세요.',
}
```

`inbound` 문맥의 오적용 자체는 후속 티켓으로 이미 잡혀 있다. 여기서 고치지 않는다 — 새 화면이 물려받지만 않으면 된다.

### 7.2 경계 상황

| 상황 | 처리 |
|---|---|
| 다른 작업자가 먼저 적치 | 서버 400 → 문구 표시 → 무효화로 큐 갱신 → 라인이 목록에서 사라짐 |
| 스캔한 바코드가 미등록 | `useSkuByBarcode` 404 → `barcode` 문맥 |
| 스캔한 상품이 큐에 없음 | 서버 오류가 아님 — "이 상품은 적치 대기가 없어요"를 별도 표시 |
| 큐가 비어 있음 | "적치할 항목이 없어요" — 기간 필터가 걸려 있음을 함께 안내 |

뒤의 둘을 구분하는 것이 요점이다. 둘 다 빈 화면이지만 작업자가 취할 행동이 다르다 — 전자는 기간을 넓혀볼 이유가 있고, 후자는 할 일이 없다는 뜻이다.

## 8. 테스트

### 8.1 백엔드 (통합, `describeIfDb`)

- 미적치 잔량이 있는 라인만 나온다 / 전량 적치된 라인은 안 나온다
- **출발지가 비시스템 로케이션이면 안 나온다** — 개별입고로 `A-01-03` 에 직입고한 라인
- 부분 적치 후 줄어든 `pendingQty` 로 남는다
- 회송·취소분이 `pendingQty` 에서 빠진다
- `days` 필터가 경계에서 맞다
- 다른 창고의 라인은 안 나온다

이 스펙들은 `DATABASE_URL` 이 없으면 **조용히 초록이다.** 반드시 DB 를 주고 돌려야 한다.

### 8.2 프론트 (Vitest + Testing Library, 가짜 트랜스포트)

- 스캔 → 큐에 1건이면 시트가 열린다 / N건이면 후보 목록 / 0건이면 안내 문구
- 수량을 `pendingQty` 초과로 입력하면 적치 버튼이 잠긴다
- **대상지 목록에 출발지가 없다** (`originLocationId` 가 있을 때)
- **수량을 바꾸면 멱등키가 회전한다** — 되돌리면 실패하는 회귀 테스트로 고정
- 적치 성공 후 `putaway-pending` 이 무효화된다
- 창고 미설정이면 `WarehousePicker` 가 뜬다

네 번째는 "키가 바뀐다"를 직접 단언해야 한다. 화면 동작만 검증하면 통과하지만 키는 그대로인 구현이 존재하며, 그것이 Phase 2 브랜치 리뷰가 잡아낸 결함의 모양이다.

## 9. 범위 밖

의도적으로 제외한다. 필요하면 별도 티켓으로 다룬다.

- **홈 타일 "적치 N" 배지** — Phase 2 후속 티켓이 권장한 것. 홈에서 창고별 쿼리를 하나 더 돌려야 하고, 큐 화면 자체가 발견 문제를 이미 해결한다.
- **`putawayFromOrigin` 의 서버측 동일 로케이션 가드** — 실제 결함이지만, 이 앱은 §6.2-3 의 화면 가드로 막고 다른 소비자(admin-web)의 적치 경로는 현재 죽어 있다. 서버 가드는 admin-web 복구와 함께 다루는 편이 낫다.
- **admin-web 적치 경로 복구** — `receipt-detail-drawer` 의 죽은 캐스팅과 `InboundReceiptDto` 타입 불일치.
- **`inbound.service.ts` 의 `db.query.*` 규칙 위반 정리** (`:1115`, `:1124`).
- **`errorMessage` 의 `inbound` 문맥 오적용 정리.**
- **다중 라인 합산 적치** — 같은 SKU 의 여러 라인을 한 번에. 후보 목록으로 충분한지 현장에서 확인한 뒤 판단한다.
- **비시스템 로케이션 간 재배치** — 이동 화면의 몫이다.
- **인벤토리 엔드포인트 `ScopeGuard` 도입.**

## 10. 배포

순수 additive. 마이그레이션 0건, 신규 secret·플래그 0건.

**`core` 선배포 → 앱 배포.** 앱이 신규 엔드포인트에 의존한다. 역방향은 큐가 404 로 비어 보이며, 입고 직후 적치 흐름은 영향받지 않는다.

## 11. 관련 문서

- `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` — 전체 로드맵 (§11 Phase 구분)
- `docs/superpowers/specs/2026-07-25-warehouse-app-phase2-inbound-design.md` — 입고/검수, 적치 연속 흐름
- `docs/superpowers/specs/2026-07-25-warehouse-app-movement-design.md` — 이동 화면, 로케이션 검색 훅
- `docs/adr/0005-drizzle-migration-and-autodeploy.md` — 스키마 변경 규약 (이번엔 해당 없음)
