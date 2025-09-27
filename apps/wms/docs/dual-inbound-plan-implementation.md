# 이중 입고 계획 구현 가이드

## 📋 개요

### 문제 정의
현재 해외 발주 시스템에서 **중국 창고 입고 완료 후 부천 창고의 입고예정 추적이 끊기는 문제**를 해결하기 위한 구현 계획입니다.

```
현재 문제:
발주(foreign) → 중국 입고 완료 → ❌ 부천 입고예정리스트에서 사라짐 → 창고간 이동 → 부천 입고

해결 방안:
발주(foreign) → 중국 입고 완료 → ✅ 부천 입고예정리스트에 계속 표시 → 창고간 이동 → 부천 입고
```

### 비즈니스 컨텍스트
- **AlmondYoung**: 미용재료 판매업체, 2개 창고(중국, 부천) 운영
- **물류 흐름**: 해외 공급업체 → 중국 창고 → 부천 창고 → 고객
- **핵심 요구사항**: 부천 창고 담당자가 "언제 무엇이 들어올지" 명확히 알아야 함

## 🎯 핵심 아이디어: 이중 입고 계획

### 개념
**물리적으로 2번 입고되므로 → 논리적으로도 2개의 입고 계획으로 분리 관리**

```
기존: 발주 1건 → 입고 계획 1개 (중국 위치, 부천 목적지)
개선: 발주 1건 → 입고 계획 2개 (중국 계획 + 부천 계획)
```

### 연관관계
```
PurchaseOrder (foreign)
├─ InboundPlan #1 (source): 중국 창고 입고 계획
└─ InboundPlan #2 (destination): 부천 창고 입고 계획 (parentPlanId → #1)
```

## 📊 데이터 모델 변경

### 1. inboundPlans 테이블 확장

```typescript
// 기존 구조
inboundPlans {
  id, warehouseId, expectedDate, status,
  destinationWarehouseId,  // ❌ 제거 대상
  requiresTransfer         // ❌ 제거 대상
}

// 신규 구조
inboundPlans {
  id, warehouseId, expectedDate, status,

  // 신규 필드
  planType: 'source' | 'destination',     // 중간 vs 최종 입고
  parentPlanId?: uuid,                    // destination → source 참조
  linkedPurchaseOrderId: uuid,            // 원본 발주 추적

  createdAt, updatedAt
}
```

### 2. 마이그레이션 전략

```sql
-- 1단계: 새 컬럼 추가
ALTER TABLE inbound_plans ADD COLUMN plan_type VARCHAR(20);
ALTER TABLE inbound_plans ADD COLUMN parent_plan_id UUID REFERENCES inbound_plans(id);
ALTER TABLE inbound_plans ADD COLUMN linked_purchase_order_id UUID REFERENCES purchase_orders(id);

-- 2단계: 기존 데이터 업데이트
UPDATE inbound_plans SET
  plan_type = CASE
    WHEN requires_transfer = true THEN 'source'
    ELSE 'destination'
  END,
  linked_purchase_order_id = (
    SELECT id FROM purchase_orders po
    WHERE po.source_warehouse_id = inbound_plans.warehouse_id
    AND po.expected_arrival = inbound_plans.expected_date
    LIMIT 1
  );

-- 3단계: 제약조건 추가
ALTER TABLE inbound_plans ALTER COLUMN plan_type SET NOT NULL;
ALTER TABLE inbound_plans ALTER COLUMN linked_purchase_order_id SET NOT NULL;

-- 4단계: 기존 컬럼 제거 (점진적)
-- ALTER TABLE inbound_plans DROP COLUMN destination_warehouse_id;
-- ALTER TABLE inbound_plans DROP COLUMN requires_transfer;
```

## 🔧 구현 계획

### 1단계: 스키마 업데이트 (1-2일)

#### 파일 수정 목록
- `apps/wms/database/schemas/wms-schema.ts`
  - `inboundPlans` 테이블 정의 수정
  - `planTypeEnum` 추가
  - 관계 정의 업데이트

```typescript
// planTypeEnum 추가
export const planTypeEnum = pgEnum('plan_type', ['source', 'destination']);

// inboundPlans 수정
export const inboundPlans = pgTable('inbound_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  planType: planTypeEnum('plan_type').notNull(),
  parentPlanId: uuid('parent_plan_id').references(() => inboundPlans.id),
  linkedPurchaseOrderId: uuid('linked_purchase_order_id').references(() => purchaseOrders.id).notNull(),
  expectedDate: timestamp('expected_date', { mode: 'date' }),
  status: inboundStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

#### 마이그레이션 파일 생성
```bash
npm run db:generate.wms
# 생성된 마이그레이션 파일 검토 후
npm run db:push.wms
```

### 2단계: PurchaseOrderService 수정 (2-3일)

#### 핵심 메서드 수정: `createInboundPlanFromPO()`

```typescript
// apps/wms/src/inbound/services/purchase-order.service.ts
private async createInboundPlanFromPO(tx: any, poId: string): Promise<void> {
  const purchaseOrder = await tx.query.purchaseOrders.findFirst({
    where: eq(wmsTables.purchaseOrders.id, poId),
    with: { lines: { with: { sku: true } } }
  });

  if (!purchaseOrder) {
    throw new NotFoundException(`Purchase order ${poId} not found`);
  }

  const sourceWarehouseId = purchaseOrder.sourceWarehouseId;
  const destinationWarehouseId = purchaseOrder.destinationWarehouseId;
  const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

  if (requiresTransfer) {
    // 🔥 핵심: 이중 계획 생성

    // 1. Source Plan 생성 (중국 창고)
    const [sourcePlan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({
        warehouseId: sourceWarehouseId,
        planType: 'source',
        linkedPurchaseOrderId: poId,
        expectedDate: purchaseOrder.expectedArrival,
        status: 'pending',
      })
      .returning();

    // 2. Destination Plan 생성 (부천 창고)
    const [destinationPlan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({
        warehouseId: destinationWarehouseId,
        planType: 'destination',
        parentPlanId: sourcePlan.id,
        linkedPurchaseOrderId: poId,
        expectedDate: null, // 이동 완료 후 설정
        status: 'pending',
      })
      .returning();

    // 3. 동일한 아이템을 양쪽 계획에 추가
    const sourceItems = purchaseOrder.lines.map(line => ({
      planId: sourcePlan.id,
      skuId: line.skuId,
      expectedQty: line.quantity,
      receivedQty: 0,
      status: 'pending' as const,
    }));

    const destinationItems = purchaseOrder.lines.map(line => ({
      planId: destinationPlan.id,
      skuId: line.skuId,
      expectedQty: line.quantity,
      receivedQty: 0,
      status: 'pending' as const,
    }));

    await tx.insert(wmsTables.inboundPlanItems).values([
      ...sourceItems,
      ...destinationItems
    ]);

    this.logger.log(`Created dual inbound plans: source=${sourcePlan.id}, destination=${destinationPlan.id} for PO ${poId}`);

  } else {
    // 국내 발주는 기존 로직 유지 (destination plan만 생성)
    const [plan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({
        warehouseId: destinationWarehouseId,
        planType: 'destination',
        linkedPurchaseOrderId: poId,
        expectedDate: purchaseOrder.expectedArrival,
        status: 'pending',
      })
      .returning();

    // 기존 아이템 생성 로직...
  }
}
```

### 3단계: InboundService 연동 (1-2일)

#### 입고예정리스트 조회 개선

```typescript
// apps/wms/src/inbound/services/inbound.service.ts
async getInboundPending(warehouseId?: string): Promise<InboundPendingResponse[]> {
  // 🔥 개선: planType 필터링 없이 warehouse 기준으로만 조회
  const plans = await this.db.query.inboundPlans.findMany({
    where: and(
      eq(wmsTables.inboundPlans.status, 'pending'),
      warehouseId ? eq(wmsTables.inboundPlans.warehouseId, warehouseId) : undefined
    ),
    with: {
      items: {
        where: eq(wmsTables.inboundPlanItems.status, 'pending'),
        with: { sku: true }
      },
      linkedPurchaseOrder: {
        with: { supplier: true }
      },
      parentPlan: true // source plan 정보 포함
    }
  });

  return plans.map(plan => ({
    planId: plan.id,
    planType: plan.planType,
    warehouseId: plan.warehouseId,
    expectedDate: plan.expectedDate,
    isLinkedPlan: !!plan.parentPlanId, // destination plan 여부
    sourcePlanStatus: plan.parentPlan?.status, // 중국 plan 상태
    purchaseOrder: {
      id: plan.linkedPurchaseOrder.id,
      type: plan.linkedPurchaseOrder.type,
      supplier: plan.linkedPurchaseOrder.supplier
    },
    items: plan.items.map(item => ({
      skuId: item.skuId,
      skuName: item.sku.name,
      expectedQty: item.expectedQty,
      receivedQty: item.receivedQty,
      pendingQty: item.expectedQty - item.receivedQty
    }))
  }));
}
```

### 4단계: 창고간 이동 연동 (1일)

#### 이동 완료 시 destination plan 활성화

```typescript
// apps/wms/src/movement/services/movement.service.ts
async completeInterWarehouseMovement(movementJobId: string): Promise<void> {
  return this.db.transaction(async (tx) => {
    const job = await tx.query.movementJobs.findFirst({
      where: eq(wmsTables.movementJobs.id, movementJobId),
      with: { lines: true }
    });

    // 기존 이동 완료 로직...

    // 🔥 추가: destination plan 활성화
    const affectedSkus = job.lines.map(line => line.skuId);

    // 해당 SKU의 destination plan들 찾기
    const destinationPlans = await tx.query.inboundPlans.findMany({
      where: and(
        eq(wmsTables.inboundPlans.planType, 'destination'),
        eq(wmsTables.inboundPlans.warehouseId, job.toWarehouseId),
        eq(wmsTables.inboundPlans.status, 'pending')
      ),
      with: {
        items: {
          where: inArray(wmsTables.inboundPlanItems.skuId, affectedSkus)
        }
      }
    });

    // destination plan의 예상 입고일 설정
    for (const plan of destinationPlans) {
      await tx
        .update(wmsTables.inboundPlans)
        .set({
          expectedDate: new Date(), // 즉시 입고 가능
          updatedAt: new Date()
        })
        .where(eq(wmsTables.inboundPlans.id, plan.id));
    }

    this.logger.log(`Activated ${destinationPlans.length} destination plans after movement completion`);
  });
}
```

### 5단계: API 응답 개선 (1일)

#### DTO 타입 추가

```typescript
// apps/wms/src/inbound/dto/inbound-pending.dto.ts
export interface InboundPendingResponse {
  planId: string;
  planType: 'source' | 'destination';
  warehouseId: string;
  expectedDate: Date | null;

  // 연관 정보
  isLinkedPlan: boolean;           // destination plan 여부
  sourcePlanStatus?: string;       // 중국 plan 상태 (destination plan인 경우)

  // 발주 정보
  purchaseOrder: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: {
      name: string;
      contactInfo: string;
    };
  };

  // 아이템 목록
  items: Array<{
    skuId: string;
    skuName: string;
    expectedQty: number;
    receivedQty: number;
    pendingQty: number;
  }>;
}
```

## 🧪 테스트 시나리오

### 테스트 1: 해외 발주 전체 플로우

```typescript
describe('Dual Inbound Plan - Foreign Purchase Order', () => {
  it('should create dual plans and track through completion', async () => {
    // 1. 해외 발주 생성
    const po = await purchaseOrderService.createPurchaseOrder({
      type: 'foreign',
      supplierId: 'supplier-1',
      lines: [{ skuId: 'sku-x', quantity: 100 }]
    });

    // 2. 발주 확정 → 이중 계획 생성 확인
    await purchaseOrderService.updatePurchaseOrderStatus(po.id, {
      status: 'confirmed'
    });

    const chinaPlans = await inboundService.getInboundPending(CHINA_WAREHOUSE_ID);
    const buchuePlans = await inboundService.getInboundPending(BUCHUN_WAREHOUSE_ID);

    expect(chinaPlans).toHaveLength(1);
    expect(chinaPlans[0].planType).toBe('source');
    expect(buchuePlans).toHaveLength(1);
    expect(buchuePlans[0].planType).toBe('destination');
    expect(buchuePlans[0].isLinkedPlan).toBe(true);

    // 3. 중국 입고 처리
    await inboundService.receiveFromPlan({
      planItemId: chinaPlans[0].items[0].id,
      quantity: 100
    });

    // 4. 부천 입고예정리스트에 여전히 표시되는지 확인
    const buchuePlansAfterChina = await inboundService.getInboundPending(BUCHUN_WAREHOUSE_ID);
    expect(buchuePlansAfterChina).toHaveLength(1);
    expect(buchuePlansAfterChina[0].sourcePlanStatus).toBe('confirmed');

    // 5. 창고간 이동
    await movementService.moveImmediately({
      warehouseId: CHINA_WAREHOUSE_ID,
      lines: [{
        skuId: 'sku-x',
        quantity: 100,
        fromLocationId: 'china-inbound',
        toLocationId: 'buchun-inbound'
      }]
    });

    // 6. 부천 입고 처리
    await inboundService.receiveFromPlan({
      planItemId: buchuePlansAfterChina[0].items[0].id,
      quantity: 100
    });

    // 7. 최종 완료 확인
    const finalBuchuePlans = await inboundService.getInboundPending(BUCHUN_WAREHOUSE_ID);
    expect(finalBuchuePlans).toHaveLength(0);

    const stockSummary = await inventoryService.getStockSummary('sku-x', BUCHUN_WAREHOUSE_ID);
    expect(stockSummary.onHandQty).toBe(100);
  });
});
```

### 테스트 2: 국내 발주 (기존 방식 유지)

```typescript
describe('Single Inbound Plan - Domestic Purchase Order', () => {
  it('should create single destination plan for domestic orders', async () => {
    const po = await purchaseOrderService.createPurchaseOrder({
      type: 'domestic',
      supplierId: 'domestic-supplier',
      lines: [{ skuId: 'sku-y', quantity: 50 }]
    });

    await purchaseOrderService.updatePurchaseOrderStatus(po.id, {
      status: 'confirmed'
    });

    const buchuePlans = await inboundService.getInboundPending(BUCHUN_WAREHOUSE_ID);
    expect(buchuePlans).toHaveLength(1);
    expect(buchuePlans[0].planType).toBe('destination');
    expect(buchuePlans[0].isLinkedPlan).toBe(false);
  });
});
```

## 📈 성능 고려사항

### 인덱스 추가
```sql
-- 조회 성능 최적화
CREATE INDEX idx_inbound_plans_warehouse_type_status
ON inbound_plans(warehouse_id, plan_type, status);

CREATE INDEX idx_inbound_plans_parent_plan
ON inbound_plans(parent_plan_id) WHERE parent_plan_id IS NOT NULL;

CREATE INDEX idx_inbound_plans_purchase_order
ON inbound_plans(linked_purchase_order_id);
```

### 쿼리 최적화
- `getInboundPending()` 호출 시 N+1 쿼리 방지를 위한 eager loading
- 대용량 데이터 대비 페이징 구현 고려

## 🚀 배포 계획

### 단계적 배포
1. **스키마 변경**: 새 컬럼 추가 (호환성 유지)
2. **코드 배포**: 이중 계획 생성 로직 활성화
3. **기존 데이터 마이그레이션**: 점진적 변환
4. **구 컬럼 제거**: 충분한 검증 후

### 롤백 계획
- 기존 컬럼 유지로 인한 빠른 롤백 가능
- feature flag를 통한 점진적 활성화 고려

## 📋 체크리스트

### 구현 완료 기준
- [ ] 스키마 변경 및 마이그레이션 완료
- [ ] `createInboundPlanFromPO()` 이중 계획 생성 구현
- [ ] `getInboundPending()` 응답 개선
- [ ] 창고간 이동 연동 구현
- [ ] 단위 테스트 및 통합 테스트 통과
- [ ] 성능 테스트 통과 (기존 대비 5% 이내 성능 저하)
- [ ] 문서 업데이트

### 검증 기준
- [ ] 해외 발주 → 중국 입고 → 부천 입고예정 지속 표시
- [ ] 국내 발주는 기존과 동일하게 작동
- [ ] stockSummary 정확성 유지
- [ ] API 응답 시간 300ms 이내 유지

---

이 문서는 **해외 발주의 pending 상태 추적 단절 문제**를 **이중 입고 계획**으로 해결하는 완전한 구현 가이드입니다. 물리적 현실(2번 입고)을 데이터 모델에 정확히 반영하여 직관적이고 확장 가능한 솔루션을 제공합니다.