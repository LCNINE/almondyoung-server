# 앱 간 통신

## 원칙

- 앱 간 통신은 **Kafka 이벤트를 통한 비동기 통신만** 사용한다. 동기 API 호출 없음.
- 각 앱은 필요한 데이터를 이벤트로 받아 자체 DB에 projection을 유지한다.

---

## 이벤트 흐름

### 1. PIM → order-matching

PIM에서 variant 관련 변경이 발생하면 이벤트를 발행하고, order-matching이 소비한다.

| 이벤트 | 트리거 | order-matching의 처리 |
|--------|--------|----------------------|
| `ProductVariantCreated` | variant 생성 | 내부 variant 목록에 추가 (미매칭 현황 계산용) |
| `ProductVariantDeleted` | variant 삭제 | 해당 variant의 매칭 레코드 정리 |
| `ProductVersionActivated` | active version 변경 | 해당 master의 variant 세트 갱신 |

order-matching은 이 이벤트들을 소비하여 "현재 PIM에 존재하는 variant 목록"의 projection을 유지한다. 이 projection과 매칭 레코드를 비교하면 미매칭 현황을 자체적으로 계산할 수 있다.

> **이벤트가 유실되면?** projection이 뒤처질 수 있지만, 주기적 reconciliation(PIM API 또는 전체 동기화 이벤트)으로 복구 가능하다. 기존 "매칭대기" 설계와 달리, 미매칭 판단의 SoT는 "레코드 부재"가 아니라 "diff 계산"이므로 이벤트 유실이 치명적이지 않다.

### 2. order-matching → WMS

매칭 변경이나 주문 변환 시 이벤트를 발행한다.

| 이벤트 | 트리거 | WMS의 처리 |
|--------|--------|-----------|
| `MatchingCreated` | 매칭 생성 | 매칭 projection 반영 (재고 할당 등에 활용) |
| `MatchingUpdated` | 매칭 수정 | 매칭 projection 갱신 |
| `MatchingDeleted` | 매칭 삭제 | 매칭 projection 제거 |
| `InventoryOrderCreated` | 주문 변환 완료 | 재고주문 생성, 이행 프로세스 시작 |

WMS는 매칭 이벤트를 소비하여 자체 projection을 유지한다. 주문 이행 시 매칭 앱에 동기 호출하지 않고 자체 DB에서 조회한다.

### 3. 판매채널 → order-matching

판매주문이 발생하면 order-matching이 소비한다.

| 이벤트 | 트리거 | order-matching의 처리 |
|--------|--------|----------------------|
| `SalesOrderCreated` | 판매주문 접수 | 매칭 규칙 적용, 재고주문으로 변환하여 이벤트 발행 |

### 4. WMS → order-matching (필요 시)

| 이벤트 | 트리거 | order-matching의 처리 |
|--------|--------|----------------------|
| `SkuDeactivated` | SKU 비활성화/삭제 | 해당 SKU를 참조하는 매칭에 경고/무효화 |

---

## 미매칭 현황 조회 (Pull 모델)

기존 설계에서는 "매칭대기(pending)" 레코드를 push로 생성했다. 새 설계에서는 미매칭을 **쿼리 시점에 계산**한다.

```
관리자 대시보드:
  "매칭이 필요한 상품 목록 보여줘"

order-matching 앱:
  1. 자체 DB에서 PIM variant projection 조회 (현재 활성 variant 목록)
  2. 자체 DB에서 매칭 레코드 조회
  3. diff = variant 목록 - 매칭된 variant 목록
  4. diff가 미매칭 목록
```

이 방식은 이벤트 유실이 있어도 reconciliation으로 projection을 복구하면 정확한 미매칭 목록을 계산할 수 있다.

---

## 전체 흐름 요약

```
[PIM]                   [order-matching]                [WMS]
  │                           │                           │
  ├─ VariantCreated ────────► │                           │
  ├─ VariantDeleted ────────► │                           │
  ├─ VersionActivated ──────► │                           │
  │                           │                           │
  │           관리자: 매칭 등록/수정                        │
  │                           │                           │
  │                           ├─ MatchingCreated ────────►│
  │                           ├─ MatchingUpdated ────────►│
  │                           ├─ MatchingDeleted ────────►│
  │                           │                           │
  │                           │◄── SkuDeactivated ────────┤
  │                           │                           │
[채널]                        │                           │
  │                           │                           │
  ├─ SalesOrderCreated ─────► │                           │
  │                           ├─ InventoryOrderCreated ──►│
  │                           │                    재고주문 생성
  │                           │                    출고/배송 이행
```

---

## WMS 없이 운영하는 경우

order-matching 앱이 없거나 WMS가 없는 환경에서는:
- PIM은 정상 동작 (variant 관리에 매칭은 불필요)
- 판매주문은 접수되지만 재고주문으로 변환되지 않음
- 이는 의도된 동작이며, 매칭/물류 기능이 필요 없는 운영 환경을 지원
