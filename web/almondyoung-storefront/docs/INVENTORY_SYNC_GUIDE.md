# 재고 동기화 가이드 (셀메이트 → Core/WMS)

## 📋 개요

이 문서는 셀메이트에서 다운로드한 재고 엑셀 파일을 업로드하여 운영자 도구에서 Core/WMS 재고를 조정하는 프로세스를 설명합니다.

> Checkout 경로 예외 아님: 이 문서의 WMS 호출은 스토어프론트 관리자 재고 조정 도구에서만 사용한다. 일반 상품 조회, cart, checkout, order creation 경로는 Core/WMS availability API를 직접 호출하지 않고 Medusa inventory에 반영된 Product Sellable Quantity projection을 사용한다.

## 🔄 재고 동기화 흐름

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│              │      │              │      │              │      │              │
│  셀메이트     │─────▶│ 스토어프론트  │─────▶│   Core/WMS   │─────▶│channel-adapter│
│   (엑셀)     │      │  (운영자 업로드)│      │  (재고조정)   │      │  (projection) │
│              │      │              │      │              │      │              │
└──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
   자체상품코드           자체상품코드          WMS SKU ID           Medusa inventory
   현재재고               현재재고              Delta 계산           sellable projection
```

### 단계별 설명

1. **셀메이트 엑셀 다운로드**: "개발팀 양식(모든 필드)"로 재고 현황 다운로드
2. **스토어프론트 업로드**: 관리자 페이지에서 엑셀 파일 업로드
3. **WMS 재고 조정**: 
   - 자체상품코드로 WMS SKU 조회
   - 현재 재고와 비교하여 Delta 계산
   - `/wms/inventory/stocks/adjust` API 호출
4. **Medusa 재고 반영**:
   - Core가 Product Sellable Quantity 변경 이벤트 발행
   - channel-adapter가 이벤트를 수신해 Medusa inventory projection 업데이트

## 📁 셀메이트 엑셀 양식

### 필수 컬럼

| 컬럼명 | 설명 | 예시 |
|--------|------|------|
| `자체상품코드` | WMS SKU와 매칭되는 코드 | `1-2600920000` |
| `현재재고` | 셀메이트 현재 재고 수량 | `2` |
| `상품명` | 상품명 (로그용) | `라벨영 이너라 세럼크림` |
| `옵션명` | 옵션명 (로그용) | `단일상품` |

### 예시 데이터

```
자체상품코드      상품명                    옵션명      현재재고
1-2600920000    라벨영 이너라 세럼크림      단일상품      2
1-2590020001    JAE LEE SPA 페이스        5ml세트       0
1-2587420001    황금마스크팩 400ml        세트상품      0
```

## 🔧 구현 상세

### 1. 프론트엔드 (스토어프론트)

**파일**: `src/lib/api/admin/inventory.ts`

```typescript
// 셀메이트 엑셀 파싱 및 WMS API 호출
export async function processInventoryExcel(formData: FormData): Promise<ProcessResult>
```

**주요 기능**:
- 셀메이트 엑셀 파일 파싱 (xlsx)
- 자체상품코드 → WMS SKU ID 변환
- 현재 재고 조회 및 Delta 계산
- WMS 재고 조정 API 호출 (병렬 처리)

**환경 변수**:
```bash
NEXT_PUBLIC_WMS_URL=http://localhost:3001  # WMS 서버 URL
```

### 2. WMS (재고 조정)

**엔드포인트**: `POST /wms/inventory/stocks/adjust`

**요청 Body**:
```json
{
  "skuId": "uuid",
  "warehouseId": "uuid",
  "delta": 10,              // 양수: 증가, 음수: 감소
  "reason": "셀메이트 재고 동기화"
}
```

**처리 로직**:
1. `delta > 0` → `adjustUp` (ADJUST_UP 이벤트)
2. `delta < 0` → `adjustDown` (ADJUST_DOWN 이벤트)
3. Stock Event 생성 및 Ledger 업데이트

### 3. Medusa (재고 반영)

Medusa는 Core SKU 그래프를 직접 복제하지 않는다. channel-adapter가 Core의 `ProductSellableQuantityChanged` projection 이벤트를 받아 Medusa variant의 inventory item/level에 현재 sellable quantity를 반영한다.

## Commerce 경계

스토어프론트의 고객 구매 경로는 이 관리자 도구를 호출하지 않는다. 고객용 상품 상세, 장바구니, checkout, 주문 생성은 Medusa Store API만 호출하고, Medusa는 자기 local inventory projection으로 재고를 판단한다.

Core/WMS 직접 호출은 아래 운영자 재고 조정 경로에만 허용한다.

| 호출 위치 | 대상 | 허용 이유 |
| --- | --- | --- |
| `src/lib/api/admin/inventory.ts` | Core/WMS `/wms/*` | 셀메이트 엑셀 기준으로 물리 재고를 조정하는 운영자 전용 도구. checkout availability 판단이 아니다. |

Core에서 재고 변경이 확정되면 Core가 최종 Product Sellable Quantity를 계산하고, channel-adapter가 해당 projection을 Medusa inventory item/level에 반영한다. channel-adapter나 Medusa는 Core SKU 매칭 그래프를 재구현하지 않는다.

## ✅ 테스트 방법

### 1. 스토어프론트에서 엑셀 업로드

1. 관리자 계정으로 로그인
2. `/[countryCode]/mypage/admin/inventory` 페이지 접속
3. 셀메이트 엑셀 파일 업로드
4. 결과 확인

### 2. WMS 재고 확인

```bash
# Core/WMS API로 재고 조회
GET http://localhost:3001/wms/inventory/stocks/summary?skuId={skuId}
```

### 3. Medusa 재고 확인

```bash
# Medusa Admin API로 재고 조회
GET http://localhost:9000/admin/inventory-items/{inventoryItemId}
```

### 4. Projection 반영 확인

channel-adapter 로그에서 `ProductSellableQuantityChanged` 처리와 Medusa inventory level 업데이트 성공 여부를 확인한다.

## 📝 로그 확인

### Core/WMS 로그
```bash
# 재고 조정 이벤트 생성 확인
[InventoryCommandService] Created ADJUST_UP ev#123 sku=abc-123 qty=10
```

### channel-adapter 로그
```bash
ProductSellableQuantityChanged handled variantId=...
Medusa inventory level updated inventoryItemId=... sellableQuantity=...
```

## 🚀 향후 개선 사항

1. **Delta = 0 최적화**: 재고 변동이 없으면 API 호출 생략
2. **에러 복구**: 실패한 항목 재시도 기능
3. **대량 처리**: 수천 개 SKU 처리 최적화
4. **재고 히스토리**: 업데이트 히스토리 UI 제공
5. **알림**: 재고 업데이트 완료 알림 (푸시/이메일)

## 🔗 관련 파일

### 스토어프론트
- `src/lib/api/admin/inventory.ts` - 재고 업로드 API
- `src/app/[countryCode]/(mypage)/mypage/admin/inventory/page.tsx` - 관리자 페이지

### Core/WMS
- `apps/core/src/modules/inventory` - 재고 조정 및 재고 이벤트
- `apps/core/src/modules/product-matching` - 판매상품 ↔ 재고상품 매칭

### channel-adapter / Medusa
- `apps/channel-adapter` - Product Sellable Quantity projection → Medusa inventory 반영
- `apps/medusa/src/scripts/backfill-sellable-inventory-projections.ts` - 기존 Medusa variant inventory projection link 보강

## 📞 문의

재고 동기화 관련 문의는 개발팀에 연락하세요.
