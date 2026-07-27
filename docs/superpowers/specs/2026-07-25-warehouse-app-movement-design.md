# 물류 현장 앱 — 재고 이동(로케이션↔로케이션) 설계 스펙

- 날짜: 2026-07-25
- 대상: `native/warehouse-app` (프론트) + `apps/core` (읽기 엔드포인트 1개 추가)
- 브랜치: `feat/warehouse-app-movement`
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 상위 문서:
  - `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` (마스터 설계)
  - `docs/superpowers/specs/2026-07-22-warehouse-app-page-structure-design.md` (IA/페이지 골격) — `/movement` = "이동 (로케이션↔로케이션)", 스캔=로케이션
  - `docs/superpowers/specs/2026-07-23-warehouse-app-phase1-adjust-stocktaking-design.md` (Phase 1) — 이동을 명시적으로 이연("별도 세션으로 미룬다"). 본 문서가 그 후속
  - `docs/superpowers/specs/2026-07-10-inter-warehouse-movement-retirement-design.md` — **창고간** 이동은 은퇴됨. 본 문서는 **동일창고** 로케이션↔로케이션 이동

## 1. 배경 / 현재 상태

Phase 1(재고 상세·조정 & 실사)까지 끝나, `native/warehouse-app`은 재고조회·상세·조정·실사가 실 배선돼 있다. `/movement`만 아직 `PlaceholderScreen` 스텁("후속 Phase에서 구현됩니다")이다.

이동에는 두 개념이 있고 본 작업은 후자만 다룬다:

- **창고간 이동** — `inter-warehouse-movement-retirement` 스펙에서 **은퇴**(하드 삭제). 안전 경로는 `POST /inventory/transfers`(admin-web 전용). 현장 앱 범위 밖.
- **동일창고 로케이션↔로케이션 이동** — `POST /movement/move`(`MovementService.moveImmediately`)가 담당. admin-web `move-dialog`가 이미 라이브로 쓰는 정상 경로. **본 작업이 현장 앱에 얹는 대상.**

## 2. 범위

### 목표
1. `/movement` 스텁 → 실 워크플로우 화면으로 교체 (핸드헬드)
2. **로케이션 우선 흐름**: 출발지 스캔 → 내용물 조회 → 품목 선택 → 대상지 스캔 → 이동
3. **품목별 단건 이동** + **직전 도착지 재사용** 단축
4. 백엔드 **읽기 엔드포인트 1개 추가**: `GET /inventory/stocks/location/:locationId` (로케이션 내용물) — additive

### 비목표 (후속)
- **장바구니 일괄 이동**(라인별 도착지 카트, `MoveBatchDto.lines[]` N개) — 빈 통째 재배치 빈도 계측 후 승격. v1은 라인 1개 배치
- **상품 우선 진입**(SkuDetail의 per-location `[이동]` 버튼) — 로케이션 우선과 패러다임 혼재 회피. `/movement` 타일 단일 진입
- 이동 이력 탭(`GET /movement/history`), 다중 작업자 동시 이동 충돌 UI, 오프라인 큐
- DEFECTIVE 등 비-ON_HAND 상태 이동 (`moveImmediately`는 `ON_HAND→ON_HAND` 고정)

## 3. 백엔드 사전 조사 결과 (실측)

### 3.1 이미 있는 것 — 이동 엔드포인트 (무변경)

`POST /movement/move` (`MovementController.moveImmediately` → `MovementService.moveImmediately`), 요청 `MoveBatchDto`:

```jsonc
{
  "warehouseId": "…",                 // UUID, 필수
  "idempotencyKey": "…",              // 필수, non-empty, ≤90
  "occurredAt": "…",                  // ISO, optional
  "actorId": "…",                     // UUID, optional
  "memo": "…",                        // optional (배치 메모)
  "lines": [                          // 최소 1개
    { "skuId": "…", "fromLocationId": "…", "toLocationId": "…",
      "quantity": 12, "memo": "…" }   // quantity ≥ 1, memo optional
  ]
}
```

서버 측 검증(`movement.service.ts`)이 이미 하는 것:
- `lines` 필수, 각 라인 `from ≠ to`, 두 로케이션 모두 `warehouseId` 소속, SKU 존재, `quantity > 0`
- **출발지 ON_HAND 부족 → 400** (`insufficient quantity at from location`) — `stock_ledgers`의 `(sku, warehouse, fromLocation, ON_HAND)` 잔량 확인
- `stock_availability_lock`으로 동시성 직렬화, `movement.move:<idempotencyKey>:<i>` 라인 접미 멱등키 부여, 원장은 `ON_HAND→ON_HAND` `MOVE` 이벤트

응답 `MovementJobWithLinesDto`(job + lines). **이동 자체는 백엔드 무변경.**

### 3.2 없는 것 (공백 1개)

**로케이션 내용물 조회 엔드포인트 부재.** `stock-projection.controller`에는 SKU 우선 조회만 있다:
- `GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId` — SKU를 고정하고 위치별 분포 반환 (역방향)

"주어진 로케이션에 어떤 SKU가 몇 개 있나"의 엔드포인트가 없어 **로케이션 우선 흐름을 지원할 수 없다.** → §4에서 추가.

### 3.3 로케이션 코드→id 해석 (기존 재사용)

- `GET /locations/warehouses/:warehouseId?search=<코드|이름>` (`LocationQueryDto.search`) — Phase 1 조정 화면이 대상지 해석에 이미 쓴다. 이동의 출발지·대상지 양쪽에 재사용.

## 4. 백엔드 변경 (apps/core) — additive 1개

**스키마 변경 0 · 마이그레이션 0 · 기존 응답 필드 제거 0.**

### 4.1 `GET /inventory/stocks/location/:locationId` (신규)

`StockProjectionController` + `StockProjectionService.getLocationContents()` + `StockProjectionReader.getLocationContents()`. 기존 `getBySkuAndWarehouse`(reader.ts:163)의 `select().innerJoin()...orderBy()` 패턴 복제.

```jsonc
{
  "locationId": "…",
  "locationCode": "A-01-02",
  "warehouseId": "…",
  "items": [
    { "skuId": "…", "skuCode": "SKU-1", "skuName": "…", "stockState": "ON_HAND",   "quantity": 12 },
    { "skuId": "…", "skuCode": "SKU-2", "skuName": "…", "stockState": "ON_HAND",   "quantity": 3  },
    { "skuId": "…", "skuCode": "SKU-3", "skuName": "…", "stockState": "DEFECTIVE", "quantity": 1  }
  ]
}
```

- 쿼리: `stock_ledgers ⨝ skus(innerJoin) ⨝ locations(innerJoin)`, `where stock_ledgers.location_id = :locationId`
- 정렬: `skus.code ASC, stock_ledgers.stock_state ASC`
- 로케이션 없으면 `NotFoundError` → 404 (locations 조회로 먼저 확인해 `locationCode`·`warehouseId`를 얻고, 없으면 404)
- **필터 안 함**(Phase 1 §4.2 컨벤션 — 서버가 행 집합을 줄이지 않는다): `quantity = 0` 제외와 "ON_HAND만 이동 가능" 판정은 프론트가. 응답은 `stockState`를 정직하게 포함
- `stock_ledgers.location_id`는 NOT NULL·복합 PK 일부 → 위치 없는 재고 행은 존재 불가. innerJoin이 안전
- 소비자 0개 신규 read — 확장 위험 없음. 이동 외 재고 실측·입고 적치 등에서 재사용 여지

### 4.2 코드 규약

CLAUDE.md inventory 규칙 준수: `trx.select().from().innerJoin().where().orderBy()`(Drizzle 연산자), `db.query.*`·`with` 관계·`any`/`as` 금지, `@InjectTypedDb<typeof inventorySchema>()`, `dbService.run(fn, tx)` 단일 러너, 중첩 DTO는 별도 클래스. 서비스는 `@app/shared`의 `NotFoundError`를 던지고 컨트롤러는 try/catch하지 않는다. 응답 DTO는 `LocationContentsDto` + 중첩 `LocationContentItemDto`로 정의(`@ApiProperty({ type: 'object' })` 금지).

## 5. 창고 컨텍스트

이동은 `warehouseId`가 필수다. Phase 1의 기기별 고정 창고(`useWarehouse()`)를 그대로 쓴다.

- 로케이션 검색(`useLocationSearch`)이 `warehouseId` 스코프이므로 출발·대상지 해석이 자동으로 현재 창고로 한정됨
- **미설정 가드**: `/movement` 진입 시 창고 미설정이면 화면 대신 "창고를 먼저 선택하세요" 인라인 카드 + `WarehousePicker` (조정 화면 §5와 동일 처리, 라우터 리디렉트 아님)

## 6. 화면 설계 — `MovementScreen` (`/movement`)

`/movement` 스텁 → `MovementRoute`(`AdjustStockRoute` 형태 래퍼) → `MovementScreen`. 플랫 라우트 1개(서브라우트 없음 — "워크플로우 내부 스캔" IA 원칙). 화면 내 **상태기계**로 모드 전환(SessionCountScreen 형태).

### (a) 출발지 대기 모드
- 큰 프롬프트 "출발 로케이션을 스캔하세요" + 수동 코드 입력 폴백
- `useScanner`/입력 → `term` → `useLocationSearch(warehouseId, term)`로 코드→id 해석
  - 코드 완전일치 1건 → 자동 선택 → (b)
  - 여러 건 → 목록에서 탭 → (b)
  - 0건 → "로케이션을 찾을 수 없습니다" (`errorMessage`)
- (조정 화면의 로케이션 해석과 동형)

### (b) 내용물 모드 (출발지 확정)
- 상단: 출발 로케이션 칩 `[A-01-02]` + `[변경]`→(a)
- `useLocationContents(fromLocationId)` → **ON_HAND & quantity > 0** 행만 이동 대상으로 렌더 (`SKU X · 12ea [이동]`)
- 비-ON_HAND(DEFECTIVE 등)는 이번 범위 밖 — 렌더 제외
- 비어 있으면 "이 로케이션에는 이동할 재고가 없습니다"
- 품목 `[이동]` 탭 → (c)

### (c) 품목 이동 시트 (한 품목 선택)
- 헤더: 상품명·코드 · `출발 A-01-02` · `현재 ON_HAND 12`
- **수량**: `NumberPad`, 기본값 = 전량(해당 품목 ON_HAND), 범위 `1..onHand`. `0` 및 `onHand 초과`는 프론트가 먼저 차단(백엔드 400과 별개)
- **대상지**:
  - `[직전 대상지 A-05-03 사용]` 칩 — 직전 성공 이동이 있으면 노출(스캔 생략)
  - 또는 스캔/검색 (`useLocationSearch`, 조정과 동일). **대상지 = 출발지 선택 차단**(같은 로케이션 필터·경고)
- **사유(memo)**: 선택 입력. 접이식 프리셋 칩(`재배치 · 통합 · 분산 · 기타`, 기타 시 자유 입력). 미선택 시 memo 없이 전송. (이동은 물리 재배치라 조정과 달리 사유 비필수 — 백엔드 `memo` optional)
- `[이동하기]` → `ConfirmDialog`("A-01-02 → A-05-03, `<상품>` 12개 이동") → `POST /movement/move`(라인 1개)
  - 성공: 직전 대상지 `{destId, destCode}` 기억, 시트 닫고 (b) 내용물 재조회(옮긴 품목 감소/소멸 반영)
  - 실패: 시트 유지, `errorMessage` 표시

**직전 도착지 재사용**: 성공한 이동의 대상지를 화면 상태로 보관. 다음 (c)에서 칩으로 재선택(스캔 없이). 출발지를 바꿔도 유지(같은 목적지로 여러 빈 정리), 화면 이탈 시 소멸.

## 7. 프론트 구조

```
src/domains/movement/
  types.ts                 # LocationContents, LocationContentItem, MoveInput
  useLocationContents.ts   # GET /inventory/stocks/location/:locationId
  useMoveStock.ts          # POST /movement/move (라인 1개 배치)
  MovementScreen.tsx       # (a)(b)(c) 상태기계
  (+ 각 *.test.tsx)
src/app/routes/
  MovementRoute.tsx        # <MovementScreen /> 래퍼
src/app/routeTree.tsx      # /movement 스텁 → MovementRoute 교체
```

**재사용(신규 훅 없음)**: `useLocationSearch`(warehouse) — 출발지 해석 + 대상지 선택 양쪽. `useScanner`, `NumberPad`, `ConfirmDialog`, `ScreenHeader`, `Button`, `WarehousePicker`, `errorMessage`, `useWarehouse`.

**훅 규약**(Phase 1 그대로 — react-query key = 파라미터 튜플, `api.request<T>`, URL 상태 없이 로컬 `useState`):

```ts
// useLocationContents.ts
export function useLocationContents(locationId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['location-contents', locationId],
    queryFn: () => api.request<LocationContents>({ path: `/inventory/stocks/location/${locationId}` }),
    enabled: Boolean(locationId),
  });
}

// useMoveStock.ts — MoveInput을 라인 1개 MoveBatchDto로 조립
export function useMoveStock() {
  const api = useApiClient(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveInput) =>
      api.request<unknown>({
        method: 'POST', path: '/movement/move',
        body: {
          warehouseId: input.warehouseId,
          idempotencyKey: input.idempotencyKey,
          lines: [{ skuId: input.skuId, fromLocationId: input.fromLocationId,
                    toLocationId: input.toLocationId, quantity: input.quantity,
                    memo: input.reason }],
        },
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['location-contents'] });   // 출발·대상 양쪽
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
```

- `MoveInput` = `{warehouseId, skuId, fromLocationId, toLocationId, quantity, reason?, idempotencyKey}`
- `location-contents` 전체 무효화 → 출발지(감소)·대상지(증가) 다음 조회 시 갱신. 낙관적 갱신 안 씀(서버가 진실)

## 8. 에러 처리 · 멱등성

**에러 매핑**(`errorMessage`, 호출 지점이 문맥 제공):
- 400 출발지 부족 → "출발지 재고가 부족합니다" (프론트가 `수량 ≤ ON_HAND`로 먼저 막지만, 조회~이동 사이 타 작업자가 뺐을 때의 백엔드 방어)
- 404 로케이션 없음 → "로케이션을 찾을 수 없습니다" (출발지 해석·대상지 선택 공통)
- 400 동일 로케이션 → 프론트가 대상지=출발지 선택 차단(발생 방지) + 방어 "출발지와 대상지가 같습니다"
- 409 → "다른 사람이 먼저 변경했습니다" + `createApiClient` 409 1회 재시도 유지

**멱등성**(조정 화면 규율 이식):
- (c) 시트 진입 시 `crypto.randomUUID()` 1회 → 상태 보관
- payload(`skuId·fromLocationId·toLocationId·quantity`) 변경 시 키 회전 — "요청 커밋됐는데 응답만 유실" 후 값 수정 재제출 시 옛 payload replay 차단
- **성공 시에만** 키 회전(실패 후 재시도는 같은 키 재사용). `movement.move:<key>:0` 라인 접미는 백엔드 부여
- 모든 이동 버튼 `isPending` 동안 비활성 — 더블탭 1차 방어

## 9. 테스트 전략

**프론트 (vitest + Testing Library, 가짜 트랜스포트)** — 기존 패턴 계승:
- 훅 유닛: `useLocationContents`(키·경로·`enabled` 게이트), `useMoveStock`(라인 1개 조립·`memo` 전달·무효화 3종)
- 순수 유닛: 수량 경계(`0` 금지·`ON_HAND 초과` 차단·기본값=전량), 출발지 해석 분기(0/1/다건), 직전 대상지 재사용 칩, 창고 미설정 가드, 대상지=출발지 차단
- 화면: (a)→(b)→(c) 전환, 이동 성공 후 시트 닫힘 + 내용물 재조회, 성공 후 직전 대상지 칩 노출, ON_HAND만 이동 대상 노출

**백엔드 (통합 스펙)** — `stock-projection-by-location.integration.spec.ts` 패턴:
- `getLocationContents` — `skus`·`locations` 조인, `skuCode` 정렬, ON_HAND/DEFECTIVE 혼재 시 전 행 반환, 없는 로케이션 404, 빈 로케이션 `items: []`

**기기 수동 스모크** — HID 리더로 출발지→품목→대상지 스캔 1회전, admin-web에서 원장 반영(출발 −N/대상 +N, 총량 불변) 확인.

**검증 게이트**: `nest build core` exit 0 · oxlint 신규 error 0(변경 파일 스코프) · vitest 전량 green · 신규 통합 스펙 green(dev DB 복구 시 ⏸).

## 10. 리스크 / 주의

| 리스크 | 대응 |
|---|---|
| 조회~이동 사이 타 작업자가 출발지 재고를 뺌 | 백엔드가 이동 시 ON_HAND 재확인 → 400. 프론트는 그 메시지 표시 + 내용물 무효화로 재조회 |
| 직전 대상지 칩이 다른 창고/무효 로케이션을 가리킴 | 창고 고정이라 창고간 오지정 불가. 화면 이탈 시 소멸. 이동 시 백엔드가 창고 소속 재검증 |
| 라인 1개 배치의 오버헤드 | `moveImmediately`는 배치 API지만 라인 1개도 정상. 멱등키가 job 단위 dedupe |
| 내용물 조회가 큰 로케이션에서 무거움 | v1 페이지네이션 없음(로케이션 단위라 행 수 제한적). 계측 후 필요 시 후속 |
| 잘못된 창고 고정 상태로 이동 | 상단 바 창고명 상시 노출 + 이동 확인 다이얼로그에 로케이션 코드 명시 |

## 11. 주요 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| 진입 흐름 | 로케이션 우선 | IA "이동=로케이션" 부합. 스캔 종류 일관, 빈 재배치 동선 자연스러움 |
| 이동 단위 | 품목별 단건 + 직전 대상지 재사용 | 다중 도착지를 기본 지원(각 이동이 자기 도착지), 원자·멱등 경계 명확, 조정 화면과 동형. 카트는 계측 후 승격 |
| 백엔드 손대기 | 로케이션 내용물 read 1개 (additive) | 이동 자체는 기존 `POST /movement/move` 재사용. 공백은 로케이션 우선 조회뿐 |
| 사유(memo) | 선택 입력 | 백엔드 `memo` optional. 스캔 핫패스에 매 이동 사유 강제는 과함. 이동은 물리 재배치 |
| 진입점 | `/movement` 타일 단일 | SkuDetail의 `[이동]`(상품 우선)은 패러다임 혼재 → 이연 |
| 창고 컨텍스트 | Phase 1 기기별 고정 재사용 | 신규 개념 불필요 |
