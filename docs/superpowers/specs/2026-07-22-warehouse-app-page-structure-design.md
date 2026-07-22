# 물류 현장 앱 — 페이지 구조(스켈레톤) 설계 스펙

- 날짜: 2026-07-22
- 대상: `native/warehouse-app`
- 브랜치: `docs/warehouse-app-page-structure`
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 상위 문서: `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` (마스터 설계). 본 문서는 그 §11 Phase 1 진입을 위한 **정보 구조(IA)/페이지 골격**만 다룬다. 인증·하드웨어·배포 결정은 마스터를 따른다.

## 1. 목표 / 범위

Phase 0(토대 + 하드웨어 스파이크 + loopback OIDC 로그인)이 끝나 로그인·데이터 계층·라우팅 뼈대가 있다. 지금은 **실제 API 호출을 동반한 물류 앱으로 작동**하기 위한 다음 단계로, 앱 전체의 **페이지 구조(내비게이션 + 라우트 맵)**를 한 번에 깐다.

### 이번 세션 산출물 (breadth-first + 참조 1화면)
1. 두 프로필의 **허브 화면**(스테이션·핸드헬드)을 실제 타일 격자로.
2. 마스터 설계의 **모든 워크플로우 라우트**를 이동 가능한 **플레이스홀더 스텁**으로 등록.
3. **`/inventory` 재고조회 1개만 실제 백엔드 API로 배선** → 이후 모든 도메인 화면이 복붙할 **데이터훅 규약** 확립.
4. `createApiClient` 팩토리를 React에 주입하는 **`ApiClientProvider`** 신설(현재 미배선).

### 비목표 (이번 세션 외)
- 입고(P2)·피킹(P3)·패킹+운송장+ZPL(P4) **워크플로우 구현** — 스텁만.
- 전역 **컨텍스트 커맨드**(허브에서 아무 바코드나 스캔 → 종류 판별 → 액션 메뉴) — §4에서 후속 이관.
- 프로필별 URL 접두·프로필 라우트 가드 — 이번은 허브 링크로만 분기(§5).
- 오프라인 큐잉 등 마스터 설계의 기존 비목표 일체.

## 2. 내비게이션 모델 — 작업 허브(B) + 워크플로우 내부 스캔

브레인스토밍에서 3안(하단 탭 / 작업 허브 / 스캔 우선)을 비교해 **작업 허브(B)를 베이스**로 택했다. 근거: 물류 작업은 **작업 간 전환이 잦지 않아** 상시 하단 탭(A)의 이점이 희석되고, **한 번에 한 작업 전체화면**이 PDA 현장에 맞는다.

- **허브** = 큰 작업 타일 격자. 타일 탭 → 해당 워크플로우 **전체화면** 진입, 뒤로가기로 허브 복귀.
- **스캔은 워크플로우 내부에서** 일어난다. 각 화면은 자신이 기대하는 바코드 종류를 알고 있으므로(재고조회=상품, 실사=로케이션→상품, 이동=로케이션) **바코드 종류 판별 문제가 발생하지 않는다.** 이로써 스캔-투-액션 가치의 대부분(작업 내 스캔)을 지금 확보한다.

## 3. 조회는 공통, 작업은 프로필별

IA의 축: **read(조회) 기능은 양 프로필 공통**(재고조회는 스테이션에서도 편의상 필요), **write(작업) 워크플로우는 프로필별**. 허브는 자기 프로필 타일만 링크하지만, 조회 타일은 두 허브 모두에 들어간다.

## 4. 컨텍스트 커맨드 — 후속 이관 (전방호환)

허브에서 임의 바코드를 스캔해 종류(로케이션/상품/송장)를 판별하고 대상별 액션 시트를 띄우는 아이디어는 검토했으나 **초기 스켈레톤엔 과함**으로 판단해 미룬다.

- **판별 비용**: 로케이션 라벨은 우리가 생성하므로 `loc:` 접두 규칙으로 자체 판별 가능(`inventory/.../barcode-generation.controller` 존재). 그러나 **송장·상품 바코드는 외부(택배사·제조사) 소유라 형식을 통제 못 함** → 프론트 순차 조회 필요. 최악엔 판별 실패 → disambiguation UI.
- **후속 착수 조건**: 순차 조회 + disambiguation이 준비되면 허브에 전역 스캔 바 + 액션 시트를 얹는다. 액션 시트 초안(로케이션→조회/이동/실사, 상품→상세/조정/이동/실사, 송장→피킹/상태조회/단축)은 브레인스토밍 기록에 보존.
- **설계 노트**: 우리가 생성하는 **로케이션 라벨엔 `loc:` 접두 규칙**을 채택한다(향후 판별 단순화).

## 5. 전체 화면 지도 (라우트 & 프로필 IA)

```
RootLayout (앱 셸 · 세션 부트스트랩)
├─ /login                         [익명 전용]            (있음)
└─ AuthedLayout                   [requireAuth + warehouse 역할]
   ├─ /                ProfileHome → 허브 (Win=스테이션 · Android=핸드헬드)  (허브 채움)
   │
   ├─ 🔍 조회 (공통 · 양 프로필)
   │   ├─ /inventory          재고조회 (검색/스캔 → 위치·수량)   ⭐ 실제 배선
   │   ├─ /inventory/$sku      상품 재고 상세 → 조정 액션          스텁
   │   └─ /shipments          출고/송장 조회                       스텁(후속)
   │
   ├─ 📦 작업 · 핸드헬드 (Android)
   │   ├─ /stocktaking        실사 (세션→로케이션→상품 카운트)    스텁
   │   ├─ /movement           이동 (로케이션↔로케이션)            스텁
   │   ├─ /inbound            입고/검수 (PO→적치) · P2             스텁(후속)
   │   └─ /picking            피킹 (리스트→집품→단축) · P3         스텁(후속)
   │
   ├─ 🖨️ 작업 · 스테이션 (Windows)
   │   └─ /packing            패킹 + 운송장 + ZPL 라벨 · P4        스텁(후속)
   │
   └─ ⚙️ 공통 유틸
       ├─ /settings           런타임 설정(백엔드 URL·프린터 IP·프로필 override)  스텁
       └─ /diagnostics        하드웨어 진단                        (있음)
```

- **라우트는 플랫**(`/inventory`, `/stocktaking`…). 프로필 구분은 URL이 아니라 물리 디렉터리(`profiles/station`·`profiles/handheld`) + 허브가 자기 것만 링크. 프로필 라우트 가드는 이번 비목표.
- **스텁**은 이동 가능한 플레이스홀더로 지금 등록한다(허브 링크가 죽지 않게, 후속 Phase 진입점 확보).

## 6. 참조 배선 화면 — `/inventory` 재고조회

이 화면 하나만 실제 백엔드에 붙여 **데이터훅 규약의 복붙 원본**으로 삼는다.

- **검색**: `GET /inventory/skus/search/advanced` — 키워드/바코드 → SKU 목록. (단순 목록 `GET /inventory/skus`은 파라미터 확인 후 필요 시 대체.)
- **상세**(스텁 `/inventory/$sku`가 후속에 사용): `GET /inventory/skus/:id/stock-summary` — 위치·수량 요약. (`stock-projection.controller`. 보조: `GET /inventory/stocks/summary`, `GET /inventory/stocks/sku/:skuId/total`.)
- 이번 세션은 **검색 → 목록 렌더**까지를 실제 배선한다. 상세는 규약이 서면 후속에서 같은 패턴으로 확장.

## 7. 데이터 계층 패턴 (규약)

```
화면(재고조회) → useSkuSearch(q)               // domains/inventory
                    └ TanStack Query (queryClient, 이미 있음)
                        └ useApiClient()          // 신규 ApiClientProvider
                            └ apiClient.request<T>()   // core/data/httpClient (있음)
                                └ plugin-http fetch + auth 헤더 + 409 1회 재시도
```

- **신규 `core/data/ApiClientProvider`**: `createApiClient({ baseUrl: apiBaseUrl, getToken: <session 토큰 게터>, authMode })`를 생성해 컨텍스트로 노출(`useApiClient()`). `main.tsx`의 `QueryClientProvider` ⊃ `SessionProvider` 안쪽에 배치(토큰·baseUrl 접근). — `createApiClient` 팩토리·409 재시도·`authHeader`는 이미 구현됨. 배선만 신설.
- **토큰 수용(§13.1) — 라이브 실측으로 확정(2026-07-22)**: `apiAuthMode` 기본은 **`bearer`**. 최초엔 'cookie'로 뒀으나 라이브에서 401 — 원인은 네이티브 `plugin-http`(Fetch 모방)가 `Cookie`를 **Fetch 금지 요청 헤더**로 스킵("Skipping cookie header … forbidden header per fetch spec")해 자격증명이 core에 도달하지 못한 것. core JWT strategy(`libs/authorization/.../jwt-access.strategy.ts`)는 `Authorization: Bearer`(첫 extractor)와 cookie 둘 다 받으므로 Bearer로 전환하면 통과. 즉 **네이티브 클라이언트는 cookie 모드 구조적 불가 → Bearer 고정**(커밋 d87a5e594).
- **도메인 계층(신규 `domains/inventory/`)**: `useSkuSearch.ts`, `useSkuStockSummary.ts`, `types.ts`. 도메인은 프로필 무지·비즈니스 담당.
- **에러 매핑**: `core/data/errorMessage(e)` 헬퍼 — 404/400/409(`ConflictError`)/500을 현장 친화 한글 메시지로. 화면은 이 메시지만 표시.
- **타입**: 백엔드 OpenAPI 있으면 코드젠, 없으면 `types.ts` 손 선언(마스터 §6·§13-3). 이번은 손 선언으로 시작.

## 8. 디렉터리 / 컴포넌트

기존 컨벤션(`app/routes/*Route.tsx` 컴포넌트 + `app/routeTree.tsx` 등록, `profiles/*/…Home.tsx` 허브 본문) 유지.

- **라우트 등록**: `app/routeTree.tsx`에 신규 라우트를 `authedRoute` 자식으로 추가.
- **라우트 컴포넌트**: `app/routes/InventoryLookupRoute.tsx`(실제), `SettingsRoute.tsx`·`StocktakingRoute.tsx`·`MovementRoute.tsx`·`InboundRoute.tsx`·`PickingRoute.tsx`·`PackingRoute.tsx`·`ShipmentsRoute.tsx`(스텁).
- **허브**: `profiles/station/StationHome.tsx`·`profiles/handheld/HandheldHome.tsx` 스텁을 실제 타일 격자로 교체.
- **공유 디자인 컴포넌트(`core/design/`)**: `TileGrid` / `HubTile`(허브 타일), `PlaceholderScreen`(스텁 통일 — title·profile·phase·뒤로가기).
- **도메인(`domains/inventory/`)**: 훅 + 타입(위 §7).

## 9. 테스트 / 검증

Option 1(실제 계약 + 목 트랜스포트, 비차단)로 검증한다. (warehouse-app은 이미 OIDC 클라이언트로 등록돼 **라이브 로그인이 동작 중** → 라이브 스모크는 옵션.)

- **Vitest 컴포넌트**: `useSkuSearch` + 재고조회 화면을 **fake plugin-http 트랜스포트**(`createApiClient`의 `doFetch` 주입)로. 로딩/성공/에러(404·500) 경로.
- **허브**: `resolveProfile` 분기별로 스테이션/핸드헬드 타일이 올바르게 렌더되는지.
- **라우터**: 신규 스텁 라우트가 해결되고 `requireAuth` 가드가 유지되는지(기존 `router.test.tsx`·`guards.test.ts` 확장).
- 회귀: `npm run` 유닛 전량 그린 + oxlint 신규 error 0(변경 파일 스코프).

## 10. 작업 순서 (플랜 예고)

1. 공유 디자인 컴포넌트: `TileGrid`/`HubTile`/`PlaceholderScreen` (+테스트).
2. 전 라우트 등록(스텁) + 두 허브 타일 배선 (+라우터/허브 테스트).
3. `ApiClientProvider` + `useApiClient` + `main.tsx` 배선.
4. `domains/inventory` 훅 + `/inventory` 재고조회 실제 화면 + `errorMessage` (+컴포넌트 테스트).

## 11. 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| 이번 범위 | 전체 골격 + 참조 1화면 배선 | "페이지 구조를 잡아둔다"에 부합, 이후 Phase가 채움 |
| 내비게이션 | 작업 허브(B) + 워크플로우 내부 스캔 | 작업 전환 드묾, 전체화면 집중, 종류 판별 회피 |
| 컨텍스트 커맨드 | 후속 이관(전방호환) | 외부 바코드 형식 통제 불가 → 판별/disambiguation 비용 |
| 조회 vs 작업 | 조회=공통, 작업=프로필별 | 조회는 스테이션에서도 유용 |
| 라우트 구조 | 플랫 URL, 프로필=디렉터리+허브링크 | 단순, 가드는 후속 |
| 참조 화면 | `/inventory` 재고조회(검색) | read-only, 데이터훅 규약 증명에 최적 |
| 검증 | 실제 계약 + 목 트랜스포트(비차단) | 스켈레톤이 라이브에 안 막힘, 라이브 로그인은 이미 동작 |
