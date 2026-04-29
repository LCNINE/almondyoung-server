# WMS · PIM · 매칭 통합에 따른 admin-web 마이그레이션 계획

> 최종 갱신: 2026-04-27
> 대상: `apps/admin-web`

---

## 1. 배경

`almondyoung-server` 측에서 그동안 별도 마이크로서비스로 운영되던 **WMS**, **PIM**, **매칭(product-matching)** 기능이 메인 서버(`apps/almondyoung-server`)로 통합되었다. 통합 결과:

- 컨트롤러 라우트가 평탄해졌다. 더 이상 `/wms/...`, `/pim/...` 접두사를 갖지 않는다.
  - 예: `@Controller('inventory/skus')`, `@Controller('matchings')`, `@Controller('masters')`, `@Controller('variants')`, `@Controller('categories')`, `@Controller('fulfillment-orders')` 등.
- 통합 과정에서 새로 노출된 도메인이 있다.
  - 입출고/풀필먼트: `purchase-orders`, `inbound`, `movement`, `stocktaking`, `outbound-batches`, `picking`, `inspection`, `direct-ship`, `invoices`, `consolidation`, `location-optimization`, `fulfillment-orders`
  - 재고 코어: `inventory/sku-groups`, `inventory/transfers`, `inventory/reservations`, `inventory/location-movements`, `inventory/returns`, `locations`, `holders`, `suppliers`
  - 카탈로그 운영: `masters/bulk`, `products/csv`, `products/audit`, `versions/:id/pricing`, `tags`, `banners`, `banner-groups`, `channel-listings`, `channels/categories`

반면 `admin-web`은 여전히 통합 이전 구조를 사용 중이다.

- `const/api-const.ts`에 `WMS_BASE_URL`(`:3010` / `/proxy/wms`), `PIM_BASE_URL`(`:3020` / `/proxy/pim`)이 분리되어 있다.
- Next 프록시 라우트 `app/api/proxy/wms/[...path]`, `app/api/proxy/pim/[...path]`가 각자 다른 호스트로 포워딩한다.
- API 클라이언트는 `${WMS_BASE_URL}/wms/inventory/...`, `${WMS_BASE_URL}/wms/matchings/...` 형태로 구 prefix 경로를 호출한다.
- 재고 현황 페이지(`/inventory/status`)는 `<ComingSoon />` 플레이스홀더, 매칭 관리 전용 페이지는 부재.

따라서 **(A) 호출 경로 통합**, **(B) 신 패턴(Container/Header + DataTable) 정착**, **(C) 새 도메인의 UI 신설**의 세 축이 동시에 필요하다.

---

## 2. 핵심 코드베이스

### 2.1 통합 서버 측 (참고)

```
apps/almondyoung-server/src/modules/
├── inventory/        # WMS 코어 + 입고/이동/실사
│   ├── core/controllers/        inventory, inventory/skus, inventory/sku-groups,
│   │                            inventory/transfers, inventory/reservations,
│   │                            inventory/location-movements, inventory/returns,
│   │                            locations, holders
│   ├── inbound/controllers/     purchase-orders, inbound
│   ├── movement/controllers/    movement
│   ├── stocktaking/controllers/ stocktaking
│   ├── suppliers/controllers/   suppliers
│   └── shared/controllers/      barcode-generation, metrics, inventory/health
├── catalog/          # PIM
│   ├── core/                    masters, variants, categories, channels,
│   │                            channel-products, channel-listings,
│   │                            channels/categories, tags, banners, banner-groups,
│   │                            versions, versions/:versionId/pricing,
│   │                            masters/:masterId/pricing, masters/:masterId/versions
│   └── operations/              masters/bulk, products/csv, products/audit
├── product-matching/ # 매칭 (variant ↔ SKU)
│   └── controllers/             matchings (product-matching, product-sku-mapping)
├── fulfillment/      # 출고/피킹/검수/송장
│   └── controllers/             fulfillment-orders, picking, inspection,
│                                outbound-batches, invoices, direct-ship,
│                                consolidation, location-optimization
└── sales-order/      # 주문
```

`admin-web`은 이 평탄해진 경로들을 **단일 base URL** 아래에서 호출하도록 바뀌어야 한다.

### 2.2 admin-web 측 (현재)

```
apps/admin-web/src/
├── const/api-const.ts                  # base URL 상수. WMS_BASE_URL, PIM_BASE_URL 등
├── app/api/proxy/                      # Next.js 프록시 라우트
│   ├── _lib/forward.ts                 # 공통 forward 헬퍼
│   ├── wms/[...path]/route.ts          # → WMS_SERVICE_URL
│   ├── pim/[...path]/route.ts          # → PIM_SERVICE_URL
│   └── …                               # users, wallet, membership, channel, file, ugc, medusa, notification
├── lib/
│   ├── api/
│   │   ├── client.ts                   # 공통 axios 인스턴스
│   │   ├── customError.ts
│   │   └── domains/
│   │       ├── inventory/              # skus, stocks, warehouses, matching
│   │       ├── products/               # masters, variants, categories, channels, channel-products
│   │       ├── orders/                 # sales-orders, fulfillment-order
│   │       └── …                       # auth, customer, blacklists, events, medusa, membership, qna, roles, users, wallet
│   ├── services/                       # React Query 래퍼 (queries / mutations / query-keys / transformers)
│   │   ├── inventory/  products/  orders/  …
│   └── types/dto, types/ui             # DTO 및 UI 타입
├── features/                           # 페이지 단위 모듈
│   ├── users/  customers/  blacklists/  medusa-customers/  categories/
│   ├── membership/members/  cs/qna/  payments/  order/{history,matching,sales-channel}
└── app/(admin)/                        # 라우트
    ├── account/  cs/  events/  inventory/  mall/  membership/
    ├── order/  payments/  users/  company/
```

신 패턴의 화면은 **`features/<domain>/`** 모듈이 `<Container>` + `<Header>` + `<DataTable>` 골격으로 구성되고, 라우트(`app/(admin)/...`)는 얇은 진입점만 둔다(`<RouteGuard>` 안에서 `<XxxTemplate />` 렌더).

핵심 공용 컴포넌트:
- `components/admin-ui-experimental/common/container` — 카드 외곽
- `components/admin-ui-experimental/common/header` — 카드 헤더(title/subtitle)
- `components/data-table` — TanStack Table 기반 DataTable (`data-table-root`, `data-table-filter`, `data-table-search`, `data-table-order-by`, `data-table-query`)
- `hooks/use-data-table.ts` + `hooks/table/{columns,filters,query}` — 컬럼/필터/쿼리 훅 분리

---

## 3. admin-web 작업 시 지켜야 할 스타일

### 3.1 라우트 ↔ 페이지 ↔ 템플릿 분리

```tsx
// app/(admin)/<area>/<page>/page.tsx
import RouteGuard from '@/components/layout/route-guard';
import XxxTemplate from '@/features/<area>/<page>/template';

export default function Page() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <XxxTemplate />
      </div>
    </RouteGuard>
  );
}
```

```tsx
// features/<area>/<page>/template/index.tsx
'use client';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { XxxTable } from '../components/table';

export default function XxxListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="..." />
      <XxxTable />
    </Container>
  );
}
```

상세 페이지의 좌/우 구분이 필요한 경우 `two-column-page` 컴포넌트, 카드를 여러 개 쌓는 경우 `Container`를 여러 개 사용한다(`/users/[id]`, `/payments/[id]` 사례).

### 3.2 features 모듈 내부 구조

```
features/<area>/<page>/
├── template/index.tsx
├── components/
│   ├── table/index.tsx          # DataTable 호출부
│   ├── filter-box/index.tsx     # 필요 시
│   └── <action>-modal/…         # 다이얼로그/모달
├── contexts/                    # 필요 시 (필터 컨텍스트 등)
└── hooks/                       # 필요 시
```

### 3.3 데이터 레이어

- API 클라이언트: `lib/api/domains/<domain>/<resource>.client.ts`. 함수형으로 export.
- React Query 래퍼: `lib/services/<domain>/{queries,mutations,query-keys,transformers}.ts`.
- DTO 타입: `lib/types/dto/<domain>.ts`. UI 타입: `lib/types/ui/<domain>.ts` (도메인 모델과 화면 모델이 다를 때).
- base URL은 **반드시** `const/api-const.ts`에서 import (`ALMONDYOUNG_API_BASE_URL` 사용).
- 컨트롤러가 throw한 에러는 `customError.ts`로 정규화.

### 3.4 DataTable 사용 규칙

- 컬럼/필터/쿼리는 훅으로 분리: `hooks/table/columns/use-xxx-table-columns.ts`, `hooks/table/filters/use-xxx-table-filters.ts`, `hooks/table/query/use-xxx-table-query.ts`.
- 표 자체는 `useDataTable({ data, columns, count, pageSize, getRowId, enableRowSelection })` 패턴.
- 행 선택 후 일괄 작업은 표 상단 영역에 액션 버튼을 띄우는 방식(예: `features/users/components/table/index.tsx`).
- 페이지 사이즈는 페이지별 상수(`const PAGE_SIZE = 20`)로 두고 매직넘버 금지.

### 3.5 디자인/UI

- shadcn/ui (`new-york`) + Tailwind v4. 색상은 `neutral` baseColor + CSS variables.
- 아이콘은 `lucide-react`.
- 폼은 `components/common/form` (FormField, FormSelect, FormInput, FormDateRangePicker, FilterLayout, FormSection 등)을 우선 사용.
- 임의 색상/폰트/간격 하드코딩 금지. Tailwind 토큰만 사용.
- 네이티브 `<button>` 대신 `components/common/button` 또는 `components/ui/button` 사용.

### 3.6 기타 코드 규칙

- 컴포넌트는 `'use client'`를 필요한 곳에만 (템플릿 또는 인터랙션이 있는 컴포넌트).
- `any`/`as` 캐스팅 지양 (서버 측 규칙과 동일).
- 페이지 진입 권한은 `<RouteGuard requireRole={[...]}>`로 표현. `RouteGuard`를 주석 처리한 채 머지하지 말 것 (현 `/order/matching` 사례 참고).
- 한국어 라벨/타이틀 사용. 사용자 향 메시지는 한국어, 코드 내 식별자는 영어.

---

## 4. Phase별 상세 계획

### 합의된 결정사항

1. **단일 base URL 명명**: `ALMONDYOUNG_API_URL`(env) / `ALMONDYOUNG_API_BASE_URL`(상수) / `/proxy/api`(클라이언트 경로). 기존 `XXX_SERVICE_URL` + `/proxy/<service>` 컨벤션과 일치.
2. **매칭 관리 페이지 위치**: `/matching/` 하위 (PIM/WMS 어느 쪽에도 단독으로 속하지 않음).
3. **Phase 4 우선순위**: 모든 항목 필요. 순서는 임의.

### Phase 0 — 인프라 통합

#### PR #0-1 — 통합 API base URL/프록시 도입
- `const/api-const.ts`에 `ALMONDYOUNG_API_BASE_URL` 추가.
  - server: `process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000'`
  - client: `'/proxy/api'`
- `app/api/proxy/api/[...path]/route.ts` 신설 (`_lib/forward.ts` 재사용).
- 기존 `WMS_BASE_URL`, `PIM_BASE_URL`은 deprecated 주석을 달아 alias로 유지(같은 값을 가리키도록 변경하지는 않는다 — 점진 이관 PR이 한 도메인씩 갈아치움).
- `.env.example`에 `ALMONDYOUNG_API_URL` 추가. `WMS_SERVICE_URL`/`PIM_SERVICE_URL`은 Phase 5에서 제거.
- 검증: 신 라우트로 헬스 호출 1건만 추가해 통신 OK 확인.

**완료 조건**: 신 base URL을 import하는 코드가 1곳 이상 존재하고, 빌드/런타임 정상.

---

### Phase 1 — API 클라이언트/타입 마이그레이션

각 PR은 도메인 독립이라 병렬 진행 가능. PR 단위는 "클라이언트 + services 래퍼 + DTO" 한 묶음.

#### PR #1-1 — inventory API 통합 서버 이전
- 변경 파일:
  - `lib/api/domains/inventory/{skus,stocks,warehouses}.client.ts`
  - `lib/services/inventory/*`
  - `lib/types/dto/inventory.ts`
- 경로: `${WMS_BASE_URL}/wms/inventory/...` → `${ALMONDYOUNG_API_BASE_URL}/inventory/...`
- 통합 서버 컨트롤러와 응답 DTO 1:1 검토 후 차이 반영.
- 회귀 대상: 현재 inventory API를 사용하는 화면이 없으므로 단위 테스트 위주.

#### PR #1-2 — matching API 통합 서버 이전
- 변경 파일: `lib/api/domains/inventory/matching.client.ts`
  - 단, **위치를 `lib/api/domains/matching/`으로 이전**(PIM/WMS 어느 쪽도 아님 결정 반영).
- 경로: `${WMS_BASE_URL}/wms/matchings/...` → `${ALMONDYOUNG_API_BASE_URL}/matchings/...`
- import 영향: `features/order/matching/*`. 회귀 확인 필수.

#### PR #1-3 — catalog(PIM) API 통합 서버 이전
- 변경 파일:
  - `lib/api/domains/products/{masters,variants,categories,channels,channel-products}.client.ts`
  - `lib/services/products/*`
  - `lib/types/dto/products.ts`(존재 시) / `lib/types/ui/products.ts`
- 경로: `${PIM_BASE_URL}/...` → `${ALMONDYOUNG_API_BASE_URL}/...` (평탄 경로).
- 회귀 대상: `/mall/products-list`, `/mall/product-registration`, `/mall/categories`.

#### PR #1-4 — orders/fulfillment API 정리
- 신규 클라이언트 추가: `lib/api/domains/fulfillment/{fulfillment-orders,picking,inspection,outbound-batches,invoices,direct-ship,consolidation}.client.ts`.
- 기존 `lib/api/domains/orders/*`에서 mock/임시 경로가 있으면 통합 서버 경로로 정정.
- 회귀 대상: `/order/history`, `/order/inspection`, `/order/picking-list`, `/order/print-invoices-by-order`, `/order/matching`(필요 시).

**Phase 1 완료 조건**: WMS/PIM 직호출이 0건. 모든 도메인이 `ALMONDYOUNG_API_BASE_URL`을 통해 호출됨.

---

### Phase 2 — 레거시 페이지 신 패턴 리팩토링

API 변경(Phase 1)과 분리해 진행. 각 PR은 페이지 단위.

#### PR #2-1 — `/mall/products-list` 신 패턴 적용
- 현재: `app/(admin)/mall/products-list/(components)/product-list.client.tsx` 단일 파일.
- 작업: `features/products/list/`(또는 `features/mall/products/`) 신설 → `template/`, `components/{table,filter-box,...}`, `hooks/table/...` 분리. `Container + Header + DataTable` 골격 적용. 페이지(`page.tsx`)는 `<RouteGuard>` 진입점만 남김.

#### PR #2-2 — `/order/history` 신 패턴 적용
- 현재: `features/order/history/template`, 자체 hooks 사용. `Container/Header` 미적용.
- 작업: 외곽만 신 패턴으로 교체, 내부 로직 유지.

#### PR #2-3 — `/order/matching` 신 패턴 적용
- 현재: `features/order/matching/template/Matching.tsx`, `Container/Header` 미적용. `<RouteGuard>`가 주석 처리되어 있음 → 이 PR에서 함께 복구.
- 작업: 외곽 교체 + `<RouteGuard>` 활성화.

#### PR #2-4 — `/account/sales-channel` 신 패턴 적용
- 현재: `features/order/sales-channel/SalesChannelTable.tsx` 단일 파일.
- 작업: `features/sales-channel/`로 이전, 표준 구조로 재배치.

**Phase 2 완료 조건**: DataTable을 가진 모든 목록 페이지가 `Container + Header` 골격을 사용.

---

### Phase 3 — 신규 페이지 (재고 / 매칭)

#### PR #3-1 — `/inventory/status` 재고 현황
- 현재 `<ComingSoon />` 제거.
- 기능: SKU 검색/필터, SKU별 총재고, 창고/위치별 재고 분포, 이력 조회. 재고 조정/이동/예약 해제 액션(다이얼로그).
- 클라이언트: `lib/api/domains/inventory/{skus,stocks,warehouses}.client.ts` 사용 + 부족분 신설.
- 레이아웃: `Container + Header + FilterBox + DataTable + Drawer/Dialog`.

#### PR #3-2 — `/inventory/skus` SKU 마스터 관리
- 기능: SKU CRUD, 바코드 추가/제거, SKU 그룹 관리.
- 사이드바 네비 항목 추가 (메뉴 구조 변경 영향 검토).

#### PR #3-3 — `/matching/variants` 매칭 관리
- 기능: variant ↔ SKU 매핑, 우선순위(`priority`), 전략(`strategy`), `stock-policy` 편집, SKU 룩업.
- 클라이언트는 PR #1-2에서 이전된 `lib/api/domains/matching/*` 사용.
- `/order/matching`(주문 라인 미매칭 해소)과는 **별도 화면**.

#### PR #3-4 — `/inventory/transfers`, `/inventory/reservations`
- 이동·예약 관리.
- 운영팀 요구도에 따라 한 PR에 묶거나 분리.

**Phase 3 완료 조건**: 재고/매칭 관리에 필요한 일상 운영 화면이 모두 노출됨.

---

### Phase 4 — 통합 서버에서 새로 노출된 도메인

> **갱신 (2026-04-27)**: 원래의 #4-1~#4-5 구획을 실행 순서 기준으로 **Wave A~E**로 재배열·재분할했다.
> 이유: #4-2(출고/풀필먼트)만 72 라우트/9 컨트롤러 규모이며, 일부는 기존 화면의 회귀 위험을 수반하는 재작성이므로 한 번에 진행 불가.
> 의존성 순서: suppliers → purchase-orders/inbound, locations → inbound/movement.
> Wave D(출고)는 패턴이 굳은 뒤, Wave C(카탈로그)는 Wave D와 병렬 진행 가능.

| Wave | 경로 | 규모 | 상태 |
|------|------|------|------|
| **A1** | `/inventory/stocktaking` | 8 라우트 | ✅ 완료 |
| **A2** | `/inventory/suppliers`, `/inventory/supplier-categories` | ~10 라우트 | ✅ 완료 |
| **A3** | `/inventory/locations`, `/inventory/holders` | ~10 라우트 | ✅ 완료 |
| **B1a** | `/inventory/purchase-orders` | ~15 라우트 | ✅ 완료 |
| **B1b** | `/inventory/inbound` | ~17 라우트 | ✅ 완료 |
| **C1** | `/mall/banner-groups`, `/mall/banner-groups/[id]`, `/mall/tags` | ~20 라우트 | ✅ 완료 |
| **C2** | `/mall/bulk`, `/mall/csv`, `/mall/audit` | ~15 라우트 | 미착수 |
| **C3** | `/mall/pricing` (versions/:id/pricing, masters pricing) | ~8 라우트 | ✅ 완료 |
| **D1** | fulfillment-orders + picking + inspection + invoices | ~30 라우트 | ✅ 완료 |
| **D2** | outbound-batches + direct-ship + consolidation + location-optimization | ~30 라우트 | ✅ 완료 |
| **E1** | `inventory/returns`, `channel-listings`, `channels/categories`, `inventory/movement` | ~20 라우트 | 미착수 |

#### Wave A1 — `/inventory/stocktaking` ✅
- 실사 세션 생성/시작, 위치·상품 스캔, 수동 카운트 입력, 차이 조회, 조정 일괄 생성, 세션 완료.
- ⚠️ `GET /stocktaking/sessions` 목록 조회 엔드포인트가 서버에 미구현 → 현재 목록 빈 배열 표시. 서버 측 추가 후 연동.

#### Wave A2 — `/inventory/suppliers`, `/inventory/supplier-categories` ✅
- suppliers CRUD, supplier-categories 관리.
- B1(발주/입고)이 supplier를 참조하므로 선행 필요.

#### Wave A3 — `/inventory/locations`, `/inventory/holders` ✅
- 창고/로케이션 마스터, 재고소유주(holder) 관리.
- B1 입고 흐름도 location을 참조.
- ⚠️ 기존 `inventory/index.ts`의 `holderApi.search`가 존재하지 않는 `GET /holders/search` 경로를 호출하고 있었음 → `holdersClient.list({ search })` 위임으로 수정 완료.
- ⚠️ locations는 모든 API가 `warehouseId` 스코프를 요구하므로, 페이지 진입 시 창고가 선택되어 있지 않으면 테이블을 렌더하지 않는다. URL `?warehouseId=`로 상태를 동기화하며 첫 진입 시 첫 번째 창고가 자동 선택된다.

#### Wave B1a — `/inventory/purchase-orders` 🔄
- 발주 목록·필터·페이지네이션, 심사 워크플로(draft→pending_audit→approved, 반려 시 draft 복귀).
- 발주 카트 Drawer + 내부 Tabs([카트 / 재발주 추천]), 카트로 발주 생성.
- 직접 발주 생성 다이얼로그 (supplier/type/창고/라인), 라인 수정 다이얼로그.
- ⚠️ `orders/dto`에 레거시 `PurchaseOrderDto`·`PurchaseOrderStatus` 정의가 있어 `LegacyPurchaseOrderDto` 등으로 rename 완료. 관련 orders 서비스 훅도 `useLegacyPurchaseOrders`로 rename.
- B1b(입고) 계획 생성 시 `auditStatus='approved'` 발주만 선택 가능.

#### Wave B1b — `/inventory/inbound` ✅
- 단일 라우트 + Tabs([입고 대기 / 계획 등록 / 입고 이력]) 구조. `?tab=` URL 동기화.
- 계획 등록: PO autocomplete → warehouse → expectedDate, 외화 PO는 "분리(이중) 입고" 체크박스.
- 입고 처리: Simple / Full-scan(바코드 누적) / Individual 모드 전환 (ReceiveDialog).
- 이력 탭: 입고 receipt 로그, detail drawer에서 work-logs + 라인 액션(putaway/return/cancel/memo).
- ⚠️ **PO 자격 서버 가드 미적용**: `GET /inbound/plans/items` pending 조회 응답에 `planItemId`(DB row id)가 없어 UI에서 `GET /inbound/plans/items`를 별도 조회해 매핑. 서버 pending 응답에 `planItemId` 포함 요청 필요.
- ⚠️ **백엔드 audit 가드 누락**: `updatePurchaseOrderStatus`가 `auditStatus`를 검사하지 않아 미승인 PO도 `status=confirmed` 전이 가능. admin-web은 UI 필터(`auditStatus=approved`)로만 강제. 서버 가드 추가는 별도 PR 필요.
- ⚠️ **`<BarcodeScanInput>` 미추출**: Full-scan 바코드 입력 패턴이 stocktaking과 inbound 두 곳에 중복. 추후 `components/common/barcode-scan-input/`로 추출 권장.
- ⚠️ **`InboundController` JWT 가드 미적용**: 서버측 inbound 컨트롤러에 JwtAuthGuard 없음. 인프라 PR로 일괄 처리 필요.

#### Wave C1 — `/mall/banner-groups`, `/mall/banner-groups/[id]`, `/mall/tags` ✅
- 배너 그룹 목록 + 그룹 상세(소속 배너 인라인 CRUD) + 태그 그룹/값 마스터-디테일.
- API 도메인: `lib/api/domains/products/{banner-groups,banners,tags}.client.ts` (기존 `products/` 확장).
- 서비스: `lib/services/products/{queries,mutations,query-keys}.ts`에 banner/tag 훅 추가.
- 메뉴: `marketing > 배너 그룹 (/mall/banner-groups)`, `products > 태그 (/mall/tags)` 추가.
- ⚠️ **JWT 가드 미적용**: `BannersController`, `BannerGroupsController`, `TagsController` 모두 서버 측 `@UseGuards` 없음. admin-web의 `<RouteGuard requireRole={['admin','master']}>`로만 강제. `InboundController`와 동일 이슈 — 인프라 PR로 일괄 처리 필요.
- ⚠️ **태그 값 목록 API 부재**: `GET /tags/groups/:id` 응답에 `values` 배열이 없음(`valueCount`만 반영). `ValueList` 컴포넌트는 `group.values`가 있으면 렌더하고 없으면 빈 상태 표시. 서버에 `GET /tags/groups/:id/values` 또는 `:id` 응답에 values 포함 요청 필요.
- ⚠️ **소프트 삭제 컨벤션 비대칭**: banners/banner-groups는 `?deletedBy=` 쿼리 필요 + soft delete + `{message}` 응답; tags는 hard delete + 204. 클라이언트에서 도메인별로 분기.
- ⚠️ **`linked_product_master_ids` 무결성 없음**: jsonb soft link라 product master 삭제 시 정합성 보장 안 됨. banner 편집 폼에서는 파일 ID 직접 입력 방식으로 단순 처리 (추후 파일 업로드 컴포넌트 및 상품 마스터 멀티 셀렉트 연동으로 개선 권장).
- ⚠️ **배너 이미지 업로드 미연동**: `pcImageFileId` / `mobileImageFileId`는 현재 텍스트 입력(파일 ID 직접 입력). 파일 서비스(`file-service`) 업로드 컴포넌트와 통합은 Wave C2 이후 또는 별도 PR 권장.

#### Wave C2 — `/mall/bulk`, `/mall/csv`, `/mall/audit`
- `masters/bulk`, `products/csv`, `products/audit`, approval UI.

#### Wave C3 — `/mall/pricing` ✅
- `versions/:versionId/pricing`, `masters/:masterId/pricing` 가격 관리.
- 진입: `/mall/products-list` 행의 "가격 관리" 버튼 → `/mall/pricing/[masterId]`.
- 화면 구성: 버전 셀렉터 + 새 draft 생성 다이얼로그 + 룰 에디터(기준가/멤버십가/수량별 Tabs) + 가격 시뮬레이션 + 옵션별 가격 현황.
- API 도메인: `lib/api/domains/products/{pricing,versions}.client.ts` 신설.
- 서비스: `lib/services/products/{queries,mutations,query-keys,transformers}.ts`에 pricing/version 훅 추가.
- ⚠️ **JWT 가드 미적용**: `VersionPricingController`, `MasterPricingController` 모두 서버 측 `@UseGuards` 없음. C1·B1b와 동일 이슈 — 인프라 PR로 일괄 처리 필요.
- ⚠️ **scale operationValue ×1000 fixed-point**: 서버가 scale 연산값을 1000배 정수로 받음(예: 0.9 → 900). UI에서 소수로 입력받아 PUT 직전 `toServerScale` 헬퍼로 환산. 혼동 방지를 위해 `transformers.ts`에 `toServerScale`/`fromServerScale` 헬퍼 포함.
- ⚠️ **draft 자동 생성 선행 요건**: `POST masters/:masterId/versions`는 active 버전이 없으면 400 반환. active 버전이 전혀 없는 신규 마스터는 가격 편집 불가. 서버 측에서 빈 상태 draft 직접 생성 지원 or 최초 버전 생성 플로우 별도 구현 필요.
- ⚠️ **price-set N+1**: 옵션별 가격 현황 테이블이 variant 수만큼 개별 GET 요청. 서버에 `GET versions/:id/pricing/price-set?variantIds=` 다중 조회 추가 권장. 현재는 `useQueries` 병렬 호출로 완화.
- ⚠️ **`ProductMasterVersionsController` JWT 가드 일부 적용**: `POST/PUT/PATCH :versionId/publish`에는 `@UseGuards(JwtAuthGuard)` 적용되어 있으나 `GET` 계열에는 없음. admin-web의 `<RouteGuard>`로 보호.

#### Wave D1 — 출고/풀필먼트 (picking·inspection·invoices) ✅
- 기존 `/order/picking-list`, `/order/inspection`, `/order/print-invoices-by-order`를 통합 서버 컨트롤러 기반으로 **재작성** 완료.
- 신규 API 클라이언트: `lib/api/domains/orders/{picking,inspection,invoices}.client.ts`
- 신규 DTO: `lib/types/dto/fulfillment.ts`
- React Query 훅: `lib/services/orders/{queries,mutations}.ts`의 placeholder 훅 실제 구현으로 교체.
- 공용 컴포넌트: `components/common/barcode-scan-input/index.tsx` 추출 (B1b/stocktaking 중복 해소).

**QA 시나리오 (검증 필수):**
1. picking: FO ID 입력 → 피킹 시작 → 바코드 스캔 → 피킹 완료.
2. inspection: FO ID + 검사자 ID → 세션 시작 → 검수 입력(승인/반려) → 강제출고 → 일괄승인 → 세션 완료.
3. invoice: goodsflow 발행 → 출력 URI 오픈 → 배송 처리. direct/self 방식은 배송 처리 비활성 확인.

⚠️ **JWT 가드 전무** — `FulfillmentOrderController`, `PickingController`, `InspectionController`, `InvoiceController` 모두 `@UseGuards(JwtAuthGuard)` 미적용. C1·C3·B1b와 동일 이슈 — 인프라 PR로 일괄 처리 필요. admin-web은 `<RouteGuard requireRole={['admin','master']}>`로만 강제.
⚠️ **`GET /picking/fulfillment-orders/:foId/session` side-effect** — 내부적으로 `startIndividualPicking`을 호출(`picking.controller.ts:80`)하여 멱등성 위반. `usePickingSession` 훅은 `enabled: false`로 설정, 명시적 "피킹 시작" 버튼(`POST /start`)에서만 호출하도록 강제.
⚠️ **invoice `direct`/`self` 발행 시 ship 처리 경로 부재** — `markAsShipped`는 `printed` 상태만 허용(`invoice.service.ts:230`). `printInvoices`는 goodsflow invoice가 0개면 BadRequest → `direct`/`self`는 shipped로 전이 불가. UI에서 배송 처리 버튼 비활성화 + 안내 문구 표시. 서버 보강 필요.
⚠️ **`getInvoiceDetail` 응답의 `items: []`** — 라인아이템이 빈 배열로 반환됨(`invoice.service.ts:331`). 현재 UI는 라인아이템 표시 없이 상태/버튼만 노출. 서버에서 items 채우기 필요.
⚠️ **`recipientName/Address/Phone` DTO 비대칭** — 발행 schema는 요구하지만 상세 응답(`getInvoiceDetail`)에 recipient 필드 없음. UI는 발행 시 입력한 값을 로컬 state에 유지.
⚠️ **`PickIndividualItemSchema`의 `pickerUserId` 누락** — 개별 피킹은 batch pick과 달리 `pickerUserId` 전달 불가. 작업자 추적 불가. 서버 schema 보강 요청.
⚠️ **`InspectionController.resetInspection`의 `throw new Error`** — Nest 표준 예외 미사용 → 500으로 노출. `inspection.controller.ts:96`. 서버 수정 필요.
⚠️ **outbound-batch 의존성** — `POST /fulfillment-orders/:id/allocate`가 outbound-batch 존재를 강제. D1 picking-list에서는 FO 단위 개별 피킹만 제공. batch 할당 UI는 D2에서 구현.
⚠️ **이벤트 publish 미연결 의심** — `FulfillmentReady`/`FulfillmentLabeled` enum 정의는 있으나 실제 publish 코드 미확인. 다운스트림(notification 등) 영향 별도 점검 필요.
⚠️ **PDF/라벨 자체 생성 없음** — Goodsflow print URI 의존. `direct`/`self` 방식은 서버측 출력 URI 없음. 클라이언트 react-print 또는 별도 서버 엔드포인트 필요(미구현).
⚠️ **`<BarcodeScanInput>` 추출 완료** — B1b의 TODO 처리: `components/common/barcode-scan-input/index.tsx` 신설, `inbound/fullscan-mode.tsx`를 신 컴포넌트로 교체. stocktaking의 인라인 패턴은 별도 PR에서 교체 권장.

#### Wave D2 — 출고/풀필먼트 (outbound-batches·direct-ship·consolidation·location-optimization) ✅
- 신규 라우트: `/order/outbound-batches`, `/order/direct-ship`, `/order/consolidation`, `/order/location-optimization`
- 신규 API 클라이언트: `lib/api/domains/orders/{outbound-batches,direct-ship,consolidation,location-optimization}.client.ts`
- 신규 DTO: `lib/types/dto/fulfillment.ts`에 D2 타입 추가 (OutboundBatch, DirectShip, Consolidation, LocationOptimization)
- React Query 훅: `lib/services/orders/{queries,mutations,query-keys}.ts` 확장
- 메뉴: `order-shipment > shipment` 그룹에 4개 항목 추가 (`lib/utils/menu.ts`)
- consolidation/location-optimization은 **어드바이저리/플레이스홀더** — 실 운영 데이터 아님

**QA 시나리오 (검증 필수):**
1. outbound-batches: 배치 생성 → 가능 FO 추가(`available/fulfillment-orders`) → start-picking → (D1) 피킹리스트 화면에서 진행 → complete → 검수 화면으로 흐름 확인.
2. direct-ship: 드롭십 FO forward(공급사 지정) → CSV export → complete → shippedAt/shippedQty 반영 확인.
3. consolidation: candidates/live/savings 호출 확인. analyze 결과 advisory로 노출. auto-consolidate 버튼 stub 경고 확인.
4. location-optimization: zones/configuration 카드만 표시. 개발 예정 안내 배너 노출.

⚠️ **JWT 가드 전무** — `OutboundBatchController`, `DirectShipController`, `ConsolidationController`, `LocationOptimizationController` 모두 `@UseGuards(JwtAuthGuard)` 미적용. C1·C3·B1b·D1과 동일 이슈 — 인프라 PR로 일괄 처리 필요. admin-web은 `<RouteGuard requireRole={['admin','master']}>`로만 강제.
⚠️ **`outbound-batches GET /available/fulfillment-orders` warehouseId 누락 시 500** — `throw new Error('warehouseId is required')`가 raw Error로 노출. `BadRequestException` 변환 필요. UI에서 `warehouseId`를 필수 파라미터로 강제.
⚠️ **outbound-batches 우선순위 정렬 결함** — `desc(priority)` 적용 시 enum 알파벳 순(`urgent > normal > high`) 동작. 의도한 긴급도 순과 다름. 클라이언트에서 `PRIORITY_ORDER` 상수로 재정렬하여 완화.
⚠️ **outbound-batches `PickingListItem.locationCode` 항상 undefined** — DTO 필드 예약됨. 서버에서 위치 조회 추가 전까지 UI에 노출하지 않음.
⚠️ **outbound-batches `pickingMethod='total_picking'` 동작 미확인** — picking 컨트롤러에서 분기 없는 것으로 보임. UI는 토글만 노출, MVP는 individual과 동일.
⚠️ **direct-ship 상태 매핑 손실** — `mapFOStatusToDirectShipStatus`가 `allocated ≡ forwarded`, `completed ≡ shipped`로 합침. 원본 FO 상태 구분 불가. UI에 미반영.
⚠️ **direct-ship `fo.ownerId` 오버로드** — 드롭십 vendor명이 `fo.ownerId` 컬럼에 저장됨. 기존 소유주 정보와 혼용 — 별도 컬럼 분리 권장.
⚠️ **direct-ship xlsx export 미구현** — `BadRequestException` 반환. UI에서 CSV 옵션만 노출 (`format: 'csv'` 고정).
⚠️ **direct-ship CSV 따옴표 이스케이프 부재** — 상품명에 `"` 포함 시 CSV 깨짐. BOM(`﻿`) 부착으로 Excel 호환.
⚠️ **direct-ship POST/PUT 비대칭** — `forward`는 POST, `complete`는 PUT. 클라이언트 wrapper에서 의도적으로 분기.
⚠️ **direct-ship `forward` 시 기존 ownerId 덮어쓰기** — 이전 소유주 정보 손실 가능. UI에 별도 안내 없음.
⚠️ **direct-ship 응답 `supplierCode` / `items[].supplierSku` / `customerInfo` 항상 undefined** — DTO 예약 필드. UI에서 표시하지 않음.
⚠️ **consolidation 후보·그룹·리포트 데이터가 `Math.random()` 기반 mock** — 호출마다 결과 다름. advisory 배너 표시 필수. `groupId`를 여러 요청 간 재사용 불가.
⚠️ **consolidation `autoConsolidate` stub** — 실제 FO 머지 안 함. 클릭 시 stub 경고 toast 표시.
⚠️ **consolidation `getConsolidationReport` 하드코딩 mock** — UI에서 노출 안 함.
⚠️ **consolidation `getConsolidationRules` shape 비대칭** — service `defaultRules.actions`가 컨트롤러 응답에서 평탄화/누락. UI는 컨트롤러 shape에 맞춤.
⚠️ **consolidation `savings/projection?days=` 문자열 전달 이슈** — 서버가 string으로 받음. 클라이언트에서 `String(days)` 명시적 직렬화로 완화.
⚠️ **location-optimization 전체 stub** — `routes/optimize`, `routes/batches/:id`, `statistics/warehouses/:id` 모두 `pending_development`. `zones/configuration`만 실데이터 반환. 나머지 기능은 개발 예정 배너로 처리.
⚠️ **outbound-batches와 consolidation이 동일 FO 풀 경쟁** — 두 화면 모두 `pending && batchId IS NULL && in_house` FO를 조회. 합포장 분석 후 배치 생성으로 이어지는 플로우는 advisory 화면 단계를 먼저 거치도록 UI 안내.

#### Wave E1 — 잔여
- `inventory/returns`, `channel-listings`, `channels/categories`, `inventory/movement`.

---

### Phase 5 — 정리

#### PR #5-1 — 구 PIM/WMS 프록시·env·alias 제거
- 삭제: `app/api/proxy/wms/`, `app/api/proxy/pim/`.
- `const/api-const.ts`에서 `WMS_BASE_URL`, `PIM_BASE_URL` 제거.
- `.env.example`에서 `WMS_SERVICE_URL`, `PIM_SERVICE_URL` 제거.
- SST/배포 스크립트, README의 환경변수 안내 갱신.
- 머지 전 조건: 전체 코드베이스에 `WMS_BASE_URL`/`PIM_BASE_URL` 직접 참조가 0건임을 grep으로 확인.

#### PR #5-2 — 죽은 코드/타입 제거
- 통합 과정에서 더 이상 안 쓰는 DTO, mock, 어댑터, transformer 정리.
- `lib/mock/`, `lib/api/adapters/`에 잔재가 있을 수 있으므로 점검.

---

## 5. 의존 그래프

```
#0-1 ─┬─ #1-1 ─┐
      ├─ #1-2 ─┤
      ├─ #1-3 ─┼── Phase 2 (#2-1..#2-4 병렬) ──┐
      └─ #1-4 ─┘                                ├── Phase 3 (#3-1..#3-4)
                                                ├── Phase 4 (Wave A~E, 아래 참고)
                                                └── Phase 5 (#5-1, #5-2)

Phase 4 Wave 의존 관계:
  A1(stocktaking) ── 독립
  A2(suppliers)   ── 독립
  A3(locations/holders) ── 독립
  B1a(purchase-orders) ── A2 선행 필요
  B1b(inbound)         ── B1a 선행 필요
  C1/C2/C3 (카탈로그 운영) ── 독립, 병렬 가능
  D1(picking/inspection/invoices) ── 독립, 회귀 위험 높음
  D2(outbound-batches 등) ── D1 이후 권장
  E1(잔여) ── 독립
```

- Phase 1 내부 4개 PR은 도메인 독립이라 동시 진행 가능.
- Phase 2 각 PR은 같은 도메인의 Phase 1 PR이 머지된 후 시작.
- Phase 5는 모든 호출처가 신 base URL로 이전된 뒤에만 머지.

---

## 6. 체크리스트 (PR 생성 시 공통)

- [ ] 신 base URL(`ALMONDYOUNG_API_BASE_URL`)을 사용한다.
- [ ] 라우트 파일은 `<RouteGuard>` + 템플릿만 렌더한다(인라인 로직 금지).
- [ ] 템플릿은 `Container + Header` 골격을 사용한다.
- [ ] DataTable은 `useDataTable` + `hooks/table/{columns,filters,query}` 분리 패턴을 따른다.
- [ ] 폼은 `components/common/form` 컴포넌트를 우선 사용한다.
- [ ] `any`/`as`/하드코딩된 색상·간격 토큰을 사용하지 않는다.
- [ ] 한국어 라벨/타이틀, 영어 식별자.
- [ ] 통합 서버 컨트롤러/DTO와 1:1 비교 후 타입을 갱신했다.
- [ ] 회귀 대상 페이지를 직접 띄워 동작을 확인했다(또는 확인할 수 없다면 그 사실을 PR 본문에 명시).
