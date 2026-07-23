# 물류 현장 앱 Phase 1 — 재고 상세·조정 & 실사 설계 스펙

- 날짜: 2026-07-23
- 대상: `native/warehouse-app` (프론트) + `apps/core` (읽기 엔드포인트 추가)
- 브랜치: `feat/warehouse-app-phase1-adjust-stocktaking`
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물, 구현 플랜은 후속
- 상위 문서:
  - `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` (마스터 설계) — §11 **Phase 1 = 재고 검색·조정·실사(핸드헬드), read + 낙관적 락 mutation**
  - `docs/superpowers/specs/2026-07-22-warehouse-app-page-structure-design.md` (IA/페이지 골격) — 본 문서는 그 스텁 중 Phase 1 해당분을 채운다

## 1. 배경 / 현재 상태

Phase 0(토대 + 하드웨어 스파이크) · Phase 1a(loopback OIDC 로그인) · 페이지 구조(IA)까지 끝났다. 지금 `native/warehouse-app`은:

- `/inventory` 재고조회만 실제 배선됨 — 서버 페이지네이션 DataTable + `GET /inventory/skus/search/advanced`
- `/inventory/$sku` 상세 = 스텁, `/stocktaking` 실사 = 스텁, `/movement` 이동 = 스텁
- `ScanProvider`/`useScanner`(HID 버퍼 파서)는 있으나 **어느 워크플로우 화면에도 연결돼 있지 않다**

즉 앱은 아직 "읽기 전용 조회기"다. Phase 1은 여기에 **첫 write 워크플로우 2종(조정·실사)** 을 얹어 데이터 레이어의 mutation 규약(멱등키·409·에러 매핑)을 실전 증명한다.

## 2. 범위

### 목표
1. `/inventory/$sku` **재고 상세** — 창고별 합계 + 위치별 분포
2. **재고 조정** — delta 기반, 로케이션 필수
3. **실사** — 세션 생성부터 원장 적용(완료)까지 핸드헬드 전 라이프사이클
4. **창고 컨텍스트** — 기기별 고정 창고 + 허브 상단 표시/변경
5. `/inventory` 재고조회에 **바코드 스캔 진입** 배선
6. 위 1~5를 위한 **백엔드 읽기 엔드포인트 추가**(전부 additive)

### 비목표 (후속)
- `/movement` **이동** — 마스터 설계 §11 Phase 1 정의에 없다. 별도 세션으로 미룬다 (routeTree의 "Phase 1에서 구현됩니다" note는 "후속 Phase"로 정정)
- 재고 이력 탭(`GET /inventory/stocks/history`), 다중 작업자 동시 실사 충돌 UI, 오프라인 큐
- `/settings`의 나머지 항목(백엔드 URL·프린터 IP·프로필 override) — 이번엔 **창고 선택만** 구현
- 컨텍스트 커맨드(허브 전역 스캔) — IA 설계 §4에서 이미 후속 이관

## 3. 백엔드 사전 조사 결과 (실측)

구현에 필요한 계약을 apps/core에서 전량 실측했다. 아래는 **있는 것**과 **없는 것**이다.

### 3.1 이미 있는 것

| 용도 | 엔드포인트 | 비고 |
|---|---|---|
| 조정 | `POST /inventory/stocks/adjust` | `{skuId, warehouseId, locationId?, delta, reason}`. delta>0 → `adjustUp`, <0 → `adjustDown`, 0 → 400 |
| SKU 상세 | `GET /inventory/skus/:id` | `SkuResponseDto` |
| SKU 창고별 재고 | `GET /inventory/skus/:id/stock-summary` | `SkuStockSummaryDto` — **창고 단위**(위치 없음) |
| 바코드 → SKU | `GET /inventory/skus?barcode=…` | `search/advanced`는 **name·code만** 검색하고 바코드를 안 본다 → 스캔 경로는 이쪽 |
| 창고 목록 | `GET /inventory/warehouses` | `findAll`, 페이지네이션 없음 |
| 로케이션 검색 | `GET /locations/warehouses/:warehouseId?search=…` | `LocationQueryDto.search` = "코드나 이름". 스캔한 로케이션 코드 → locationId 해석에 사용 |
| 실사 전 라이프사이클 | `POST /stocktaking/sessions` · `/sessions/:id/start` · `/scan-location` · `/scan-product` · `PUT /lines/:id/count` · `GET /sessions/:id/variances` · `/sessions/:id/generate-adjustments` · `/sessions/:id/complete` · `/cancel` | 워크플로우 전부 존재 |

실사 도메인 동작 중 설계에 영향을 준 사실:

- `generate-adjustments`는 **dry-run 미리보기**다(영속 없음). 실제 원장 적용은 `complete`가 원자적으로 수행 — `adjustUp`/`adjustDown`, `idempotencyKey = stocktaking:<sessionId>:<lineId>`, 감산 시 `bypassReservationGuard: true`("실사 = 물리적 사실, 실물 우선")
- `complete`는 `variance != 0 AND countedQuantity IS NOT NULL` 라인만 적용한다 → **미카운트(pending) 라인은 무시**되므로 부분 실사도 안전
- `scan-product`는 기존 라인 카운트를 **증가**시킨다(`newCount = 기존 + quantity`). 응답은 갱신 후 **절대값** `countedQuantity`를 준다
- `scan-product`의 `quantity` 파라미터 덕에 "바코드 1회 스캔 + 수량 N 입력"이 정확히 동작한다(신규 라인은 `0 + N = N`)
- `PUT /lines/:id/count`는 **절대값 세팅**이다(정정용)
- `stocktaking_lines`는 `unique(sessionId, skuId, locationId).nullsNotDistinct()` — `scan-location`의 `onConflictDoNothing`이 이 제약에 기댄다
- `stock_events.idempotencyKey`는 unique이고 `createEvent`가 `onConflictDoNothing` + 기존 이벤트 반환으로 dedupe한다 (§3.3에서 사용)

### 3.2 없는 것 (공백 3개)

1. **`GET /stocktaking/sessions/:id` 부재** — 세션 상세도, 라인 전체 목록도 없다. `variances`는 `variance != 0`만 반환. → 앱 재시작·교대 후 **실사 이어하기가 불가능**하고, `scan-product`가 증가 연산이라 **이중 카운트 위험**이 실재한다
2. **`scan-location` 응답에 `lineId`가 없다** — `expectedItems[]`는 `{skuId, skuName, skuCode, barcode, expectedQuantity}`뿐. `PUT /lines/:id/count`(수동 수량 입력)를 쓰려면 먼저 `scan-product`로 1개 스캔해 lineId를 받아야 하는 우회가 필요
3. **로케이션별 재고 조회 API가 없다** — `stock-summary`는 창고 단위, `/locations/*`는 메타데이터 전용, `GET /inventory/stocks`는 `{skuId?, warehouseId}` 필터에 `CurrentStockDto`(창고 단위) 반환. `stock_ledgers`는 locationId 그레인인데 읽을 길이 없다

### 3.3 조정의 멱등성 결손

`AdjustStockDto`에 `idempotencyKey` 필드가 없고, `InventoryController.adjustStockQuantity`가 `commandService.adjustUp/adjustDown`에 그것을 전달하지 않는다. 하위 `StockEventStore.createEvent`는 `idempotencyKey` unique + `onConflictDoNothing`으로 **이미 dedupe를 구현해 두었는데** 컨트롤러 경로에서만 그 능력이 끊겨 있다.

→ 현장에서 더블탭하거나 네트워크 타임아웃 후 재시도하면 **조정이 이중 적용**된다. HTTP 클라이언트의 409 1회 재시도는 명시적 409 응답을 받은 경우뿐이라 이 경로를 막지 못한다.

## 4. 백엔드 변경 (apps/core) — 전부 additive

**스키마 변경 0 · 마이그레이션 0 · 기존 응답 필드 제거 0.** ADR-0005의 expand/contract 규율상 destructive 변경이 아니므로 코드와 같은 PR에 묶을 수 있다.

### 4.1 `GET /stocktaking/sessions/:id` (신규)

`StocktakingController` + `StocktakingService.getSession(sessionId)`.

```jsonc
{
  "id": "…", "warehouseId": "…", "sessionName": "…",
  "status": "in_progress",            // draft | in_progress | completed | cancelled
  "notes": null,
  "createdAt": "…", "startedAt": "…", "completedAt": null,
  "progress": { "total": 42, "counted": 17 },   // counted = countedQuantity IS NOT NULL
  "lines": [
    {
      "lineId": "…", "skuId": "…", "skuCode": "…", "skuName": "…",
      "locationId": "…", "locationCode": "A-01-02",   // 둘 다 nullable
      "expectedQuantity": 5, "countedQuantity": 5, "variance": 0,
      "scannedBarcode": "880…", "status": "counted", "notes": null
    }
  ]
}
```

- 세션 없으면 `NotFoundError` → 404
- `lines`는 `stocktaking_lines ⨝ skus ⟕ locations` (locations는 leftJoin — locationId nullable)
- 정렬: `locationCode ASC, skuCode ASC` (현장 동선 = 위치 순회)
- 라인 수가 매우 커질 수 있으나 **v1은 페이지네이션 없이 전량 반환**한다. 실사 세션은 보통 한 창고의 일부 로케이션 범위이고, 프론트가 진행률·위치별 그룹핑을 로컬에서 하려면 전량이 필요하다. 계측 후 필요하면 후속에서 페이지네이션 추가

### 4.2 `GET /inventory/stocks/by-location?skuId&warehouseId` (신규)

`StockProjectionController`(`@Controller('inventory')`) + 대응 서비스. 두 쿼리 파라미터 모두 **필수 UUID**.

```jsonc
[
  { "locationId": "…", "locationCode": "A-01-02", "stockState": "ON_HAND",    "qty": 12 },
  { "locationId": "…", "locationCode": "A-01-02", "stockState": "DEFECTIVE",  "qty": 1  },
  { "locationId": null, "locationCode": null,     "stockState": "ON_HAND",    "qty": 3  }
]
```

- `stock_ledgers ⟕ locations` where `skuId & warehouseId & qty != 0`, 정렬 `locationCode ASC NULLS LAST, stockState ASC`
- `locationId`가 null인 원장 행이 존재할 수 있다 → UI는 "위치 미지정"으로 표기
- 라우트 충돌 없음: 기존 `/stocks`, `/stocks/summary`, `/stocks/sku/:skuId/...`, `/stocks/history`와 리터럴이 겹치지 않는다

### 4.3 `POST /stocktaking/scan-location` 응답 확장

`expectedItems[]` 각 항목에 **`lineId` · `countedQuantity` · `status`** 를 추가한다.

구현: 현행처럼 `onConflictDoNothing`으로 라인을 upsert한 뒤, **`sessionId + locationId`로 라인을 다시 select**해서 응답을 만든다(insert 결과가 아니라 재조회).

⚠️ **의미 변화 (의도된 것)**: 재조회 결과는 현행 `expectedItems`의 **상위집합**이다. 이전에 `scan-product`로 그 위치에 만들어진 **미기대 항목**(`expectedQuantity = 0`)도 함께 돌아온다. 이게 실사 이어하기의 핵심이다 — 재스캔 시 이미 센 것이 전부 보여야 이중 카운트를 피한다.

기존 소비자(admin-web `session-detail-drawer`)는 **필드 추가 + 행 추가**만 겪으므로 깨지지 않는다. 다만 리뷰 시 확인 대상으로 명시한다.

### 4.4 `AdjustStockDto.idempotencyKey` (신규 optional)

```ts
@ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 재시도는 같은 값 재사용', required: false })
@IsString() @IsOptional() @MaxLength(90)
idempotencyKey?: string;
```

`InventoryController.adjustStockQuantity`가 이를 `commandService.adjustUp/adjustDown`의 `idempotencyKey`로 전달한다. 하위 dedupe는 이미 있으므로 컨트롤러 4줄 변경이 전부다. optional이라 admin-web 등 기존 호출자는 무영향.

### 4.5 코드 규약

CLAUDE.md의 inventory 규칙을 따른다: `trx.select().from().innerJoin().where().orderBy()` (Drizzle 연산자), `db.query.*`·`with` 관계·`any`/`as` 금지, `@InjectTypedDb<typeof inventorySchema>()`, `dbService.run(fn, tx)` 단일 러너, 중첩 DTO는 별도 클래스. 서비스는 `@app/shared`의 `NotFoundError`/`BadRequestError`를 던지고 컨트롤러는 try/catch하지 않는다.

## 5. 창고 컨텍스트

조정·실사·위치조회 전부 `warehouseId`가 필수인데 백엔드에 **사용자↔창고 바인딩 개념이 없다**(`GET /inventory/warehouses` 전체 목록뿐). 현장 PDA는 한 창고에 고정되므로 **기기별 고정**을 택한다.

- `src/app/warehouse-context.tsx` — `useWarehouse() → { warehouseId, warehouseName, setWarehouse, isSet }`
- 저장: `localStorage`("almondwms.warehouse"). 토큰과 달리 **민감정보가 아니므로** stronghold를 쓰지 않는다. Windows·Android 웹뷰 공통 동작
- 얇은 `devicePrefs` 인터페이스(`get/set`)로 감싸 테스트에서 주입 가능하게 한다
- `AuthedLayout`에 슬림 상단 바 추가 — 좌측 앱명, 우측 **창고명 칩**(탭 → `/settings`). 기존 화면들의 "← 홈" 버튼은 그대로 둔다(이번 범위 밖 리팩터 회피)
- **미설정 가드**: `/stocktaking`·`/inventory/$sku/adjust` 진입 시 창고가 없으면 화면 대신 "창고를 먼저 선택하세요" 인라인 카드 + 선택 UI를 보여준다. 라우터 `beforeLoad` 리디렉트가 아니라 화면 내 처리 — 뒤로가기 루프를 만들지 않기 위해

## 6. 화면 설계

### 6.1 `/inventory` — 재고조회 (기존 화면에 스캔 배선)

`useScanner`를 연결한다. 스캔 이벤트 수신 → `GET /inventory/skus?barcode=<scanned>`:

- 정확히 1건 → `/inventory/$sku`로 **즉시 이동**
- 0건 → "등록되지 않은 바코드입니다: `<code>`" 토스트, 화면 유지
- 2건 이상 → 결과를 목록에 표시하고 사용자가 선택

기존 텍스트 검색(`search/advanced` + DataTable + 서버 페이지네이션)은 그대로 둔다.

### 6.2 `/inventory/$sku` — SkuDetailScreen (신규)

3개 쿼리를 조합:
- `GET /inventory/skus/:id` — 코드·이름·옵션
- `GET /inventory/skus/:id/stock-summary` — 창고별 실재고/예약/가용 + 합계
- `GET /inventory/stocks/by-location?skuId&warehouseId=<현재 창고>` — 위치별 분포 (§4.2)

레이아웃: 헤더(코드·이름) → 합계 카드(총 실재고 / 예약 / 가용) → **위치별 표**(로케이션코드 · 상태 · 수량 · 행마다 `[조정]`) → 하단 `[조정]`(위치 미선택 진입).

창고 미설정이면 위치별 표 자리에 창고 선택 안내를 렌더한다(합계는 창고 무관하므로 그대로 표시).

### 6.3 `/inventory/$sku/adjust` — AdjustStockScreen (신규)

**delta 전용 · 로케이션 필수.** 절대 카운트는 실사의 몫이라는 도메인 분담을 지킨다.

- **로케이션**: 스캔(`useScanner`) 또는 검색(`GET /locations/warehouses/:wid?search=`). 쿼리스트링 `?locationId=`로 상세에서 프리필 가능. **필수** — 생략하면 백엔드가 시스템 '입고기본존'으로 밀어넣어 실물과 원장이 어긋난다
- 선택된 로케이션의 **현재 ON_HAND**를 by-location 결과에서 찾아 표시
- **delta**: `[−] [숫자] [+]` + 숫자패드. **0 금지**(백엔드 400과 별개로 프론트에서 먼저 막는다)
- **사유**: 프리셋 칩(파손 · 분실 · 발견 · 오출고 정정 · 기타) — 기타 선택 시 자유 입력. **필수**(백엔드 `@IsNotEmpty`)
- 확인 다이얼로그("A-01-02 의 <상품> 을 −2 조정합니다") → `POST /inventory/stocks/adjust`
- **멱등키**: 화면 진입 시 UUID 1회 생성해 상태로 보관, 재시도 시 동일 값 재사용. 성공 후 화면을 떠날 때 폐기(§4.4)
- 성공 → 상세로 복귀 + `by-location`/`stock-summary` 쿼리 무효화

### 6.4 `/stocktaking` — SessionListScreen (신규)

- `GET /stocktaking/sessions?warehouseId=<현재 창고>` — 상태별 섹션 또는 필터 칩(진행중 / 대기 / 완료)
- `[+ 새 실사]` → 세션명 입력(기본값 `YYYY-MM-DD 실사`) → `POST /sessions` → `POST /sessions/:id/start` → `/stocktaking/$id` 이동
- `draft` 탭 → start 후 진입 / `in_progress` 탭 → 바로 진입 / `completed`·`cancelled` 탭 → 읽기 전용으로 차이 화면 진입
- 진행중 세션에서 `[취소]`(`POST /sessions/:id/cancel`) — 확인 다이얼로그

### 6.5 `/stocktaking/$sessionId` — SessionCountScreen (신규, 핵심)

`GET /stocktaking/sessions/:id`(§4.1)로 세션·라인·진행률을 로드한다. 화면은 두 모드를 오간다.

**(a) 로케이션 대기 모드**
- 큰 스캔 프롬프트 "로케이션 바코드를 스캔하세요" + 수동 코드 입력 폴백
- 하단에 진행률(`counted / total`)과 이미 방문한 로케이션 목록(라인에서 파생) — 탭하면 그 위치로 재진입
- `[차이 확인 →]` 버튼

**(b) 위치 카운트 모드** — 로케이션 스캔 성공 후
- `POST /scan-location` → 확장된 `expectedItems`(lineId·countedQuantity 포함, §4.3)로 라인 목록 렌더
- 각 라인: 상품명/코드 · `예상 N` · `카운트 M`(미카운트는 `—`) · 차이 배지
- **상품 스캔**: `POST /scan-product`(`quantity: 1`) → 응답의 **절대** `countedQuantity`로 해당 라인을 갱신. 낙관적 갱신을 쓰지 않는다 — 서버가 증가 연산의 진실이므로 응답값이 항상 옳다
- **수량 직접 입력**: 라인 탭 → 숫자패드 → `PUT /lines/:id/count`(절대 세팅). 박스 단위 카운트를 스캔 N회로 대체
- **바코드 다중 스캔**: 같은 바코드 연속 스캔은 +1씩 누적(백엔드 증가 연산 그대로)
- 미등록 바코드 → 404 → "등록되지 않은 바코드입니다" 토스트. (해당 SKU가 이 위치에 없던 경우는 404가 아니라 미기대 라인 자동 생성이므로 정상 흐름)
- `[다른 로케이션]` → (a)로 복귀

**이어하기**가 이 화면의 설계 동기다. 재진입 시 서버가 준 `countedQuantity`를 그대로 보여주므로 "이미 센 것"이 항상 보인다.

### 6.6 `/stocktaking/$sessionId/variances` — VarianceReviewScreen (신규)

- `GET /sessions/:id/variances` — 위치 · 상품 · 예상 · 카운트 · 차이(부호 색상)
- `[조정 미리보기]` → `POST /sessions/:id/generate-adjustments`(dry-run) → `preview[]` 렌더: 현재 ON_HAND · delta · INCREASE/DECREASE
- **미리보기를 성공적으로 받은 뒤에만** `[실사 완료 · 원장 적용]`을 활성화한다 (승인된 안전장치)
- 완료 확인 다이얼로그: "N건의 조정이 원장에 적용됩니다. 되돌릴 수 없습니다." → `POST /sessions/:id/complete`
- 성공 → 세션 목록으로 복귀 + 토스트. 완료된 세션은 읽기 전용으로 이 화면을 다시 볼 수 있다
- 차이가 0건이면 미리보기 없이 바로 완료 허용(적용할 게 없음을 명시)

### 6.7 `/settings` — 최소 구현

`GET /inventory/warehouses` 목록에서 창고 선택 + 현재 프로필(station/handheld) 표시. 백엔드 URL·프린터 IP·프로필 override는 계속 "후속 Phase" note로 남긴다.

## 7. 프론트 구조

```
src/app/
  warehouse-context.tsx          # useWarehouse() + devicePrefs 주입
  routes/                        # routeTree에 신규 라우트 등록
src/core/
  data/devicePrefs.ts            # localStorage 얇은 래퍼(테스트 주입점)
  design/ScreenHeader.tsx        # 뒤로 + 제목 + 우측 슬롯
  design/NumberPad.tsx           # 현장용 큰 숫자패드
  design/ConfirmDialog.tsx       # 파괴적 액션 확인
src/domains/inventory/
  useSkuDetail.ts  useSkuByBarcode.ts  useStockByLocation.ts  useAdjustStock.ts
  SkuDetailScreen.tsx  AdjustStockScreen.tsx
  (기존) types.ts  useSkuSearch.ts  StockCell.tsx  InventoryLookupScreen.tsx
src/domains/stocktaking/
  types.ts
  useSessions.ts  useSession.ts  useCreateSession.ts  useStartSession.ts
  useScanLocation.ts  useScanProduct.ts  useUpdateCount.ts
  useVariances.ts  useGenerateAdjustments.ts  useCompleteSession.ts  useCancelSession.ts
  SessionListScreen.tsx  SessionCountScreen.tsx  VarianceReviewScreen.tsx
src/domains/warehouse/
  useWarehouses.ts  useLocationSearch.ts
```

**라우트 추가** (`src/app/routeTree.tsx`): `/inventory/$sku`(스텁 교체) · `/inventory/$sku/adjust` · `/stocktaking`(스텁 교체) · `/stocktaking/$sessionId` · `/stocktaking/$sessionId/variances` · `/settings`(스텁 교체). `/movement` 스텁의 note는 "후속 Phase에서 구현됩니다"로 정정.

**데이터훅 규약**은 기존 `useSkuSearch`를 그대로 복제한다 — react-query key = 파라미터 튜플, `api.request<T>({ path })`, URL 상태 없이 로컬 `useState`. mutation은 `useMutation` + 성공 시 관련 key 무효화.

## 8. 에러 처리 · 멱등성

- `core/data/errorMessage.ts` 확장 (현장 친화 한국어):
  - 404 — "등록되지 않은 바코드입니다" / "로케이션을 찾을 수 없습니다" (호출 지점이 문맥 제공)
  - 400 — 실사 상태 위반 시 "실사가 진행 중이 아닙니다"
  - 409 — "다른 사람이 먼저 변경했습니다. 새로고침 후 다시 시도하세요"
- `createApiClient`의 **409 1회 재시도**는 그대로 둔다(낙관적 락 대응). 조정은 §4.4 멱등키로, 실사 완료는 백엔드가 라인별 `stocktaking:<session>:<line>` 키를 이미 쓰므로 재시도가 안전하다
- 모든 write 버튼은 mutation `isPending` 동안 비활성 — 더블탭 1차 방어

## 9. 테스트 전략

**프론트 (vitest + Testing Library, 가짜 트랜스포트)** — 기존 77개 패턴을 잇는다.
- 순수 유닛: delta 검증(0 금지·부호), 창고 미설정 가드, 숫자패드 입력 누적, 바코드 조회 분기(0/1/다건)
- 훅: 각 도메인 훅을 스텁 `ApiClient`로 — 쿼리 키·경로·바디·무효화 대상
- 화면: SessionCountScreen의 두 모드 전환, scan-product 응답으로 라인 갱신, 미리보기 전 완료 버튼 비활성

**백엔드 (통합 스펙)** — `apps/core/src/modules/inventory/stocktaking/services/stocktaking-*.integration.spec.ts` 패턴을 따른다.
- `getSession` — 라인 조인·정렬·progress 계산, 없는 세션 404
- `by-location` — 위치별 그룹, null location 행, qty=0 제외
- `scan-location` 확장 — 재스캔 시 lineId·countedQuantity 반환, 미기대 라인 포함
- `adjust` 멱등 — 같은 `idempotencyKey`로 2회 호출 시 원장이 1회만 변한다

**기기 수동 스모크** — HID 리더기로 로케이션/상품 스캔, 실사 1회전(생성→카운트→차이→완료) 후 admin-web에서 원장 반영 확인.

## 10. 리스크 / 주의

| 리스크 | 대응 |
|---|---|
| `scan-location` 응답 의미 변화가 admin-web을 깬다 | 필드/행 **추가**만이라 무해. 리뷰 시 `session-detail-drawer` 소비 코드 확인을 체크리스트에 명시 |
| 실사 완료가 예약가드를 bypass하고 되돌릴 수 없다 | 미리보기 강제 + 확인 다이얼로그에 "되돌릴 수 없습니다" 명시 |
| 다중 작업자가 같은 세션을 동시 카운트 | v1 비목표. `scan-product`가 증가 연산이라 동시 카운트는 합산돼 **과대 계상**될 수 있다 — 운영 규칙(세션당 1인)으로 커버하고, 화면에 세션 담당 표기는 후속 |
| 세션 라인 전량 반환의 응답 크기 | v1은 페이지네이션 없음(§4.1). 실사 세션 규모가 커지면 후속에서 위치별 lazy 로딩 |
| 창고를 잘못 고른 채 조정 | 상단 바에 창고명 상시 노출 + 조정 확인 다이얼로그에 로케이션 코드 명시 |

## 11. 주요 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| Phase 1 범위 | 상세+조정 & 실사 (이동 제외) | 마스터 설계 §11 정의 그대로. 이동은 별도 세션 |
| 백엔드 손대기 | 읽기 2개 + `scan-location` 응답 확장 (+ 멱등키) | 전부 additive·마이그레이션 0. 실사 이중 카운트가 프론트 우회로 못 막히는 진짜 공백 |
| 창고 컨텍스트 | 기기별 고정 + 허브 상단 칩 | 백엔드에 사용자↔창고 바인딩 없음. 현장 PDA는 한 창고 고정이 자연스러움 |
| 실사 라이프사이클 | 핸드헬드가 전 구간 + 완료 전 미리보기 강제 | 마스터 설계의 "물류팀 전용 standalone" 정신. 안전은 dry-run 게이트로 |
| 조정 입력 | delta 전용 + 로케이션 필수 | 절대 카운트는 실사의 몫(역할 분담 선명). 로케이션 생략 시 시스템 기본존 오적재 방지 |
| 조정 멱등성 | `AdjustStockDto`에 optional 키 추가 | 하위 dedupe가 이미 있는데 컨트롤러에서만 끊겨 있었음. 4줄로 이중 적용 차단 |
| 창고 설정 저장소 | localStorage (stronghold 아님) | 민감정보 아님. 양 플랫폼 웹뷰 공통 |
