# ship 광고 정리 + 데드 액션 3건 은퇴 설계 (P2-11)

> 출처: `docs/logistics-backend-hardening-2026-07.md` P2-11(`computeAdminAvailableActions` 가 은퇴한 `POST /fulfillments/:id/ship` 를 광고 → admin-web 렌더 시 404) · WS-B 작업 7.
> 승인: 2026-07-10 (브레인스토밍 세션).

## 1. 문제

`computeAdminAvailableActions`(`apps/core/src/modules/fulfillment/services/fulfillments.service.ts:1053-1087`)가 FO status ∈ `{invoiced, labeled, picked, inspecting, inspected}` 에서 액션 `ship` 을 광고한다(`:1075-1076`). 그러나 명령형 `POST /fulfillments/:id/ship` 라우트는 은퇴해 존재하지 않는다(`fulfillments.controller.ts` 전 라우트에 부재). 실제 출고는 shipment 검수 스캔 경로(`shipment.controller.ts`: `scan` → `inspect-scan` → 전 라인 완료 시 `consumeShipment` 자동 발사)로 일어난다.

admin-web 은 이 광고를 믿고 ship 버튼을 **두 곳**에서 렌더한다:

1. 상세 헤더 "출고" 버튼 — `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx:165-171` → `handleShip(:127-134)` → `useShipFulfillment()(:97)`.
2. shipment-tab 섹션 C — `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx:207-239` → `handleShip(:80-87)`.

둘 다 클릭 시 부재 라우트 `POST /fulfillments/:id/ship` 를 호출해 **404**(`fulfillments.client.ts:86-89`).

### 부수 데드 액션 2건 (같은 계약 불일치 클래스, 반대 방향)

서버 `computeAdminAvailableActions` 는 `assignShipment`·`split` 을 **절대 광고하지 않는다**(함수 전체 확인). 그런데 admin-web 은 이 두 액션의 UI 를 갖고 있어 영구 데드다:

- `assignShipment` — `shipment-tab.tsx:48` `canAssign` 이 항상 false → "운송장 등록" 폼(`:147-205`)의 등록 버튼이 영구 비활성. 서버 라우트 `POST /fulfillments/:id/assign-shipment` 부재.
- `split` — `split-tab.tsx:62` `blocked` 이 항상 true → 분할 폼·결과 패널이 렌더 안 되고 차단 Alert(`:134-142`) 하나만 노출되는 **데드 탭**. 서버 라우트 `POST /fulfillments/:id/split` 부재. 합배송/송장분할(W5)은 스키마 M:N 만 열린 Non-Goal.

즉 셋 다 **존재하지 않는 엔드포인트를 때리는 데드 액션**이며, ship 만 서버가 광고해서 "활성 404", 나머지 둘은 서버 미광고라 "영구 비활성/차단"이다.

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 3건 처분 | **전량 제거** (서버 광고 + admin-web UI/훅/client) | 사용자 결정(2026-07-10). 같은 FE↔BE 계약 불일치 클러스터를 한 PR 로 정합. split 은 W5 착수 시 재스캐폴딩 |
| ship UI 제거 범위 | **2곳** — shipment-tab 섹션 C + 상세 헤더 버튼 | ship 호출자가 헤더에도 있음(탐색 발견). 한쪽만 지우면 나머지가 잔존 404 |
| shipment-tab 처분 | **탭 존치, 섹션만 제거** | 섹션 A(송장/배송 정보 표시)·D(deliver 액션)가 실질 콘텐츠로 남음 |
| split-tab 처분 | **파일 삭제 + 탭 등록 제거** | blocked 고정으로 차단 Alert 만 뜨는 완전 데드 탭. 조회 등 유용 콘텐츠 없음 |
| 서버 `ship()` 메서드 | **불가침** | `fulfillments.service.ts:858` 은 HTTP 미노출이나 `direct-ship.service.ts:330` 내부 호출 라이브. 제거 대상은 **광고(computeAdminAvailableActions)** 뿐, 메서드 아님 |
| 데드 부모 파일 | **파일째 삭제** | `detail/index.tsx`(라우트는 `components/detail` 사용, importer 0) 가 삭제 대상 `split-tab` 을 import → dangling. 0-importer 데드라 통째 삭제가 가장 깔끔 |
| 서버 split/assignShipment dead code | **없음** (제거 대상 아님) | core 에 split/assignShipment 서비스·DTO·라우트 전무 확인. 정리는 admin-web 클라이언트 측만 |

## 3. Part 1 — 서버 (apps/core)

### 3-1. 광고 제거

`fulfillments.service.ts:1075-1076` 의 ship push 블록 삭제:

```ts
if (['invoiced', 'labeled', 'picked', 'inspecting', 'inspected'].includes(fo.status)) {
  actions.push('ship');
}
```

이후 `computeAdminAvailableActions` 는 `reserve`/`unreserve`/`transferReservation`/`cancel`/`deliver`/`forwardDropShip`/`completeDropShip` 만 반환 — **전부 실존 라우트**. `ship()` 서비스 메서드(`:858`)는 손대지 않는다.

### 3-2. spec 갱신

`fulfillments.service.spec.ts` 3개 단언(파일 내 2개 클러스터):

| 위치 | 현재 | 변경 |
|---|---|---|
| `:1411-1414` (getOne 상세) | `arrayContaining(['reserve','cancel','ship'])` | `'ship'` 제거 → `['reserve','cancel']`. `.not.toContain('split')` 존치(여전히 참) |
| `:1480-1481` (inspected 케이스) | `toContain('ship')` | `not.toContain('ship')` 로 반전 — ship 은 이제 어떤 상태에서도 미광고 |
| `:1487` (ready 케이스) | `not.toContain('ship')` | **유지** (여전히 참) |

## 4. Part 2 — admin-web

**핵심 불변식**: 제거 완결의 증명은 `tsc --noEmit` GREEN — dangling import/미사용 심볼이 0이어야 컴파일된다.

| 파일 | 작업 |
|---|---|
| `detail/shipment-tab.tsx` | 섹션 B(assignShipment 폼 `:147-205`) + 섹션 C(ship `:207-239`) + 전용 핸들러(`handleAssignShipment`·`handleShip`)·게이트(`canAssign`·`canShip`)·state(`trackingNo`/`carrier`/`eta`)·`CARRIER_LABELS`·훅 import(`useAssignFulfillmentShipment`·`useShipFulfillment`)·타입 import(`AssignShipmentRequest`)·아이콘/폼 import(`Input`/`Label`/`Select…`/`Truck`) 제거. **섹션 A·D 및 deliver 공유 심볼(`AlertTriangle`/`PackageCheck`/`useDeliverFulfillment` 등) 존치.** `useState` 가 잔존 사용처 없으면 import 제거 — tsc 로 확정 |
| `components/detail/index.tsx` (활성 부모) | 헤더 "출고" 버튼(`:165-171`) + `handleShip`(`:127-134`) + `shipMutation`/`useShipFulfillment`(`:97`, import `:24`) 제거. split 탭 등록(TabsTrigger `:288` / TabsContent `:298-300` / import `:30`) 제거. **shipment 탭 등록(`:289,:301-303,:31`) 존치** |
| `detail/split-tab.tsx` | 파일 삭제 |
| `detail/index.tsx` (데드 부모) | 파일 삭제 (구현 시 importer 0 재확인 후) |
| `lib/services/orders/mutations.ts` | 훅 3종(`useShipFulfillment` `:874` / `useAssignFulfillmentShipment` `:863` / `useSplitFulfillmentOrder` `:810`) + dangling type import(`SplitFulfillmentOrderRequest` `:34` / `AssignShipmentRequest` `:38`) 제거 |
| `lib/services/orders/index.ts` (배럴) | 재수출 3줄(`:78,:96,:101`) 제거 |
| `lib/api/domains/orders/fulfillments.client.ts` | 메서드 3종(`ship` `:86-89` / `assignShipment` `:81-84` / `split` `:46-49`) + dangling type import(`SplitFulfillmentOrderRequest` `:15` / `AssignShipmentRequest` `:20`) 제거 |
| `lib/types/dto/fulfillment.ts` | 미사용화되는 인터페이스 `SplitFulfillmentOrderRequest`(`:140`)·`AssignShipmentRequest`(`:177`) 제거 |

## 5. Part 3 — 테스트

**전량 dev DB 불요** — 스키마 무변경이라 작업 8과 달리 ⏸ 없음.

- **core 단위**: `fulfillments.service.spec.ts` 갱신 후 fulfillment 단위 suite GREEN. arch 경계(`inventory-write-boundary.arch.spec.ts`) 회귀 PASS.
- **admin-web**: `tsc --noEmit` GREEN — dangling import 0 = 제거 완결성의 컴파일 증명. lint 변경 파일 신규 error 0.
- **기능 무손실 논증**: ship 버튼은 제거 전에도 클릭 시 404(동작 부재)였다 → 제거는 **깨진 버튼 철거**일 뿐 기능 상실 아님. 실제 출고 경로(스캔→inspect-scan→consumeShipment)는 이 작업과 무관하게 불변. assignShipment/split 은 이미 비활성/차단이라 사용자 관측 동작 변화 없음(데드 탭 사라짐).

## 6. Part 4 — 문서화

`logistics-backend-hardening-2026-07.md`:
- P2-11 → 🟩, 완료 근거 링크.
- §5 WS-B "작업 7" 완료 블록 추가(작업 5·6 형식).
- 부수 발견 기록: (1) ship 호출자가 헤더에도 존재(2곳), (2) 데드 부모 파일 `detail/index.tsx`(0 importer) 동반 삭제.

## 7. 검증 게이트

- `nest build core`(tsc/webpack) exit 0.
- eslint — 변경 파일 **신규** error 0 (repo 전역 lint debt 무관).
- admin-web `tsc --noEmit` GREEN.
- `inventory-write-boundary.arch.spec.ts` PASS.
- 삭제 심볼(`useShipFulfillment`·`useAssignFulfillmentShipment`·`useSplitFulfillmentOrder`·client `ship`/`assignShipment`/`split`·`split-tab` 컴포넌트) 저장소 전역 참조 0.
- `computeAdminAvailableActions` 가 `ship`/`split`/`assignShipment` 미반환(spec 단언).
- 스키마 무변경 → dev DB 의존 마이그레이션 ⏸ 없음.

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| 데드 부모 `detail/index.tsx` 가 실은 어딘가 import | 구현 시 grep 재확인 후 삭제(탐색 0건 확인). 불확실 시 삭제 대신 split/ship 참조만 제거로 폴백 |
| shipment-tab 섹션 제거로 tsc 깨짐(deliver 공유 import 오삭제) | `AlertTriangle`/`PackageCheck`/`useDeliverFulfillment`/`extractErrorMessage`/`queryClient` 등 존치, tsc 로 확정 |
| 서버 `ship()` 메서드 오삭제 | 결정표 불가침 명기. 제거 대상은 광고 블록 한정, `direct-ship.service.ts:330` 호출 유지 |
| DTO 인터페이스 제거가 타 도메인에서 참조 | grep 로 사용처 0 확인 후 제거. 남으면 정리 스킵(무해) |
