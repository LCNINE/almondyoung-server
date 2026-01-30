# 재고 동기화 가이드 (셀메이트 → WMS → Medusa)

## 📋 개요

이 문서는 셀메이트에서 다운로드한 재고 엑셀 파일을 업로드하여 WMS를 통해 Medusa 재고를 업데이트하는 프로세스를 설명합니다.

## 🔄 재고 동기화 흐름

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│              │      │              │      │              │      │              │
│  셀메이트     │─────▶│ 스토어프론트  │─────▶│     WMS      │─────▶│   Medusa     │
│   (엑셀)     │      │  (업로드)     │      │  (재고조정)   │      │  (재고반영)   │
│              │      │              │      │              │      │              │
└──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
   자체상품코드           자체상품코드          WMS SKU ID           Medusa Variant
   현재재고               현재재고              Delta 계산           재고 업데이트
```

### 단계별 설명

1. **셀메이트 엑셀 다운로드**: "개발팀 양식(모든 필드)"로 재고 현황 다운로드
2. **스토어프론트 업로드**: 관리자 페이지에서 엑셀 파일 업로드
3. **WMS 재고 조정**: 
   - 자체상품코드로 WMS SKU 조회
   - 현재 재고와 비교하여 Delta 계산
   - `/wms/inventory/stocks/adjust` API 호출
4. **Medusa 재고 반영**: 
   - WMS가 재고 변동 이벤트 발행 (Kafka)
   - Medusa가 이벤트 수신하여 재고 업데이트

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

**파일**: `apps/medusa/src/modules/events/service.ts`

**이벤트 구독**: `inventory.events.v1` 토픽
- `StockReceived` (입고)
- `StockShipped` (출고)
- `StockAdjusted` (조정)

**처리 로직**:
1. Kafka에서 재고 이벤트 수신
2. SKU로 Medusa Variant 조회
3. Inventory Item ID 조회
4. Stock Location 조회
5. Inventory Level 업데이트

## ⚠️ 현재 문제점

### 🔴 WMS → Medusa 이벤트 발행 미구현

**문제**: WMS의 `inventory` 모듈이 재고 조정 시 Kafka 이벤트를 발행하지 않음

**증상**:
- WMS에서 재고 조정 성공
- Stock Event는 생성됨
- Outbox에 이벤트가 추가되지 않음
- Medusa 재고가 업데이트되지 않음

**원인**:
- `inventory-command.service.ts`에서 `adjustUp`/`adjustDown` 호출 시
- Outbox Service를 호출하지 않음
- Event Publishing 로직 누락

**해결 방법** (서버 수정 필요):

```typescript
// apps/wms/src/inventory/services/inventory-command.service.ts

import { OutboxService } from '../../order/shared/services/outbox.service';

@Injectable()
export class InventoryCommandService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    private readonly outboxService: OutboxService,  // ✅ 추가
  ) {}

  async adjustUp(input: { ... }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. Stock Event 생성
      const event = await this.eventStore.createEvent({
        skuId: input.skuId,
        toWarehouseId: input.warehouseId,
        toLocationId: input.locationId ?? null,
        toState: 'ON_HAND',
        transitionType: 'ADJUST_UP',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }, trx);

      // 2. Outbox에 이벤트 추가 ✅
      await this.outboxService.enqueue({
        eventType: 'StockAdjusted',
        aggregateType: 'Stock',
        aggregateId: event.id,
        partitionKey: input.skuId,
        payload: {
          skuCode: input.skuId,  // TODO: SKU name 조회
          quantity: input.quantity,
          deltaQuantity: input.quantity,
          afterQuantity: input.quantity,  // TODO: 실제 재고 조회
          warehouseId: input.warehouseId,
          reason: input.reason,
        },
      }, trx);

      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async adjustDown(input: { ... }, tx?: DbTx) {
    // adjustUp과 동일한 패턴으로 수정
    // ...
  }
}
```

**추가 작업**:
1. `InventoryCommandService`에 `OutboxService` 주입
2. `adjustUp`, `adjustDown`, `receive`, `ship` 메서드에 Outbox 추가
3. SKU ID → SKU name 조회 로직 추가
4. 현재 재고 조회 로직 추가

## ✅ 테스트 방법

### 1. 스토어프론트에서 엑셀 업로드

1. 관리자 계정으로 로그인
2. `/[countryCode]/mypage/admin/inventory` 페이지 접속
3. 셀메이트 엑셀 파일 업로드
4. 결과 확인

### 2. WMS 재고 확인

```bash
# WMS API로 재고 조회
GET http://localhost:3001/wms/inventory/stocks/summary?skuId={skuId}
```

### 3. Medusa 재고 확인

```bash
# Medusa Admin API로 재고 조회
GET http://localhost:9000/admin/inventory-items/{inventoryItemId}
```

### 4. Kafka 이벤트 확인

```bash
# Kafka 토픽 확인
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic inventory.events.v1 \
  --from-beginning
```

## 📝 로그 확인

### WMS 로그
```bash
# 재고 조정 이벤트 생성 확인
[InventoryCommandService] Created ADJUST_UP ev#123 sku=abc-123 qty=10

# Outbox 이벤트 추가 확인 (수정 후)
[OutboxService] Enqueued StockAdjusted event for sku=abc-123
```

### Medusa 로그
```bash
# Kafka 이벤트 수신 확인
📦 Received inventory event: StockAdjusted { skuCode: 'abc-123', deltaQuantity: 10 }

# 재고 업데이트 확인
Inventory updated: SKU=abc-123, qty=110
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

### WMS
- `apps/wms/src/inventory/controllers/inventory.controller.ts`
- `apps/wms/src/inventory/services/inventory-command.service.ts`
- `apps/wms/src/inventory/repositories/stock-event.store.ts`

### Medusa
- `apps/medusa/src/modules/events/service.ts` - Kafka 이벤트 구독

## 📞 문의

재고 동기화 관련 문의는 개발팀에 연락하세요.

