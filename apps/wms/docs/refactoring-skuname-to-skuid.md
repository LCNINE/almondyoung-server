# WMS skuName 기반 코드 리팩토링 계획

## 📋 문제 발견 배경

### 발견 상황
- **시점**: `npm run build:wms` 실행 중 타입 에러 발생
- **에러 내용**: `_createSkuInternal` 메서드 호출 시 필수 파라미터 `masterId` 누락
- **발생 위치**:
  1. `product-matching.service.ts:401` - `createNewSkuForMatching` 메서드
  2. `stock-event.service.ts:57` - `createStockEntry` 메서드의 자동 SKU 생성 부분

### 근본 원인 조사
타입 에러를 추적하던 중, **더 심각한 아키텍처 문제**를 발견:
- **SKU 이름으로 재고 입고가 가능한 설계**
- **SKU가 없으면 자동으로 생성하는 위험한 로직**
- **데이터 무결성을 위협하는 패턴들**

## 🚨 문제점 분석

### 1. 가장 위험한 패턴: 자동 SKU 생성

**위치**: `apps/wms/src/inventory/services/stock-event.service.ts:47`

```typescript
// 현재 위험한 코드
let sku = await executor.query.skus.findFirst({
    where: eq(wmsTables.skus.name, skuName)  // ❌ SKU 이름으로 조회
});

if (!sku) {
    this.logger.warn(`SKU with name '${skuName}' not found. Auto-creating SKU.`);
    // ❌ 자동으로 SKU 생성!
    sku = await this.inventoryService._createSkuInternal({
        name: skuName,
        source: creationSource,
    }, executor);
}
```

**문제점**:
- SKU 이름은 유니크하지 않을 수 있음 (스키마에 유니크 제약 없음)
- 오타 입력 시 새로운 SKU가 무한정 생성됨
- 마스터 정보 없이 SKU 생성 시도 (현재 타입 에러의 원인)

### 2. DTO 설계 문제

**위치**: `apps/wms/src/inbound/dto/create-stock-entry.dto.ts:14`

```typescript
export class CreateStockEntryDto {
    @ApiProperty({ description: '생성할 SKU 이름' })  // ❌ SKU ID가 아닌 이름!
    @IsString()
    @IsNotEmpty()
    skuName: string;
    // ...
}
```

**문제점**:
- 재고 입고가 SKU ID가 아닌 이름 기반
- 동일한 이름의 SKU가 여러 개 있으면 임의로 첫 번째 선택
- 오타나 유사한 이름으로 인한 잘못된 SKU 매칭 가능성

### 3. PIM 연동 위험성

**위치**: `apps/wms/src/inventory/services/product-matching.service.ts:175`

```typescript
const newStock = await this.stockEventService.createStockEntry({
    variantId: variant.id,
    skuName: component.skuName,  // ❌ PIM에서 오는 SKU 이름으로 재고 입고
    inventoryManagement: true,
    // ...
});
```

**문제점**:
- PIM에서 잘못된 이름이 오면 잘못된 SKU 자동 생성
- 외부 시스템과의 연동이 이름 기반으로 불안정

### 4. 비효율적인 패턴

**위치**: `apps/wms/src/inventory/services/product-matching.service.ts:410`

```typescript
await this.stockEventService.createStockEntry({
    variantId,
    skuName: newSku.name,  // ❌ 방금 생성한 SKU인데도 이름으로 재조회
    inventoryManagement: true,
    // ...
});
```

**문제점**:
- SKU ID가 있는데도 이름으로 다시 조회하는 비효율성
- 불필요한 데이터베이스 쿼리

## 💡 해결 방안

### 핵심 원칙
1. **SKU ID 기반 재고 관리**: 모든 재고 작업은 SKU ID로만 수행
2. **엄격한 SKU 관리**: SKU 자동 생성 금지, 사전 정의된 SKU만 사용
3. **데이터 무결성 보장**: Master-SKU 관계 유지, 타입 안정성 확보

### 새로운 아키텍처

```typescript
// ✅ 새로운 안전한 DTO
export class CreateStockEntryBySkuIdDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;  // skuName 대신 skuId 사용

    @ApiProperty({ description: 'Product Matching의 Variant ID (참조용)', required: false })
    @IsUUID()
    @IsOptional()
    variantId?: string;

    @ApiProperty({ description: '창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: '실재고 수량' })
    @IsNumber()
    @IsNotEmpty()
    quantity: number;

    // 기타 필드들...
}

// ✅ 새로운 안전한 서비스 메서드
async createStockEntryBySkuId(dto: CreateStockEntryBySkuIdDto, tx?: DbTx) {
    return this.inTx(async (executor) => {
        // SKU ID로 직접 조회, 자동 생성 없음
        const sku = await executor.query.skus.findFirst({
            where: eq(wmsTables.skus.id, dto.skuId)
        });

        if (!sku) {
            throw new NotFoundException(`SKU not found: ${dto.skuId}`);
        }

        // 재고 이벤트 생성
        await this.commandService.receive({
            skuId: sku.id,
            toWarehouseId: dto.warehouseId,
            toLocationId: dto.locationId ?? null,
            quantity: dto.quantity,
            occurredAt: new Date(),
            reason: dto.reason || `stock_entry_${dto.variantId ? `for_variant_${dto.variantId}` : 'manual'}`,
        }, executor);

        return { skuId: sku.id, success: true };
    }, tx);
}
```

## 📋 리팩토링 실행 계획

### Phase 1: 새 인터페이스 구축 (1-2시간)

**1.1 새 DTO 생성**
- `apps/wms/src/inbound/dto/create-stock-entry-by-skuid.dto.ts` 생성
- SKU ID 기반 인터페이스 정의

**1.2 새 서비스 메서드 추가**
- `StockEventService.createStockEntryBySkuId()` 구현
- 자동 SKU 생성 로직 완전 제거
- 단위 테스트 작성

### Phase 2: ProductMatching 개선 (2-3시간)

**2.1 `createNewSkuForMatching` 메서드 수정**
```typescript
// 변경 전
const newSku = await this.inventoryService._createSkuInternal({
    name: skuData.name,
    source: SkuCreationSource.MANUAL_MATCHING,
}, trx);

await this.stockEventService.createStockEntry({
    skuName: newSku.name,  // ❌ 이름으로 재조회
    // ...
}, trx);

// 변경 후
const productMatching = await trx.query.productMatchings.findFirst({
    where: eq(wmsTables.productMatchings.variantId, variantId)
});

if (!productMatching?.masterId) {
    throw new Error(`No master found for variant: ${variantId}`);
}

const newSku = await this.inventoryService._createSkuInternal({
    name: skuData.name,
    source: SkuCreationSource.MANUAL_MATCHING,
    masterId: productMatching.masterId,  // ✅ masterId 추가
}, trx);

await this.stockEventService.createStockEntryBySkuId({
    skuId: newSku.id,  // ✅ ID로 직접 사용
    variantId,
    // ...
}, trx);
```

**2.2 PIM 인터페이스 개선**
```typescript
// PIM 인터페이스 변경
interface PimSkuComponent {
    skuId: string;     // skuName → skuId 변경
    skuName?: string;  // 표시용으로만 유지 (옵셔널)
}
```

### Phase 3: 현재 타입 에러 해결 (30분)

**3.1 stock-event.service.ts 수정**
```typescript
// variantId가 있는 경우: productMatching에서 masterId 조회
// variantId가 없는 경우: 기본 마스터 생성
let masterId: string;
if (variantId) {
    const productMatching = await executor.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId)
    });
    if (!productMatching?.masterId) {
        throw new Error(`No master found for variant: ${variantId}`);
    }
    masterId = productMatching.masterId;
} else {
    // 기본 마스터 생성 (기존 createSku 로직과 동일)
    const masterCode = `M-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const [createdMaster] = await executor.insert(wmsTables.inventoryProductMasters).values({
        name: skuName,
        masterCode,
        status: 'active' as any,
    }).returning();
    masterId = createdMaster.id;
}

sku = await this.inventoryService._createSkuInternal({
    name: skuName,
    source: creationSource,
    masterId, // ✅ masterId 추가
}, executor);
```

### Phase 4: 점진적 마이그레이션 (2-3시간)

**4.1 Backward Compatibility 유지**
```typescript
/** @deprecated Use createStockEntryBySkuId instead */
async createStockEntry(dto: CreateStockEntryDto, tx?: DbTx) {
    // 기존 로직 유지하되 안전하게 수정
    // 또는 skuName → skuId 변환 로직 추가
}
```

**4.2 단계적 호출처 변경**
1. `ProductMatchingService.createNewSkuForMatching` → 새 메서드 사용
2. `ProductMatchingService.resolveVoidMatching` → 새 메서드 사용
3. PIM 이벤트 핸들러 → 새 메서드 사용

### Phase 5: 정리 및 최적화 (1시간)

**5.1 레거시 코드 제거**
- `CreateStockEntryDto` 제거
- `createStockEntry` 메서드 제거
- 자동 SKU 생성 로직 완전 제거

**5.2 보안 강화**
- SKU 생성 권한 분리
- 재고 입고 권한 분리
- 감사 로그 강화

## ⚠️ 위험 요소 및 대응책

### Breaking Changes
- **위험**: PIM 시스템과의 호환성
- **대응**: 점진적 마이그레이션, backward compatibility 유지

### 데이터 일관성
- **위험**: 마이그레이션 중 데이터 불일치
- **대응**: 트랜잭션 사용, 롤백 계획 수립

### 운영 중단
- **위험**: 서비스 중단
- **대응**: Blue-Green 배포, Feature Flag 사용

## 🎯 성공 기준

1. ✅ **빌드 성공**: 모든 타입 에러 해결
2. ✅ **테스트 통과**: 기존 기능 동작 보장
3. ✅ **보안 강화**: 자동 SKU 생성 제거
4. ✅ **성능 개선**: 불필요한 이름 기반 조회 제거
5. ✅ **코드 품질**: 타입 안정성 확보

## 📊 영향 범위 요약

### 변경 대상 파일
- `apps/wms/src/inventory/services/stock-event.service.ts` (핵심)
- `apps/wms/src/inventory/services/product-matching.service.ts` (2곳)
- `apps/wms/src/inbound/dto/create-stock-entry.dto.ts` (새 DTO 추가)

### 테스트 대상
- 재고 입고 기능
- PIM 연동 기능
- SKU 생성 기능
- 제품 매칭 기능

### 문서 업데이트
- API 문서
- 아키텍처 가이드
- 개발자 가이드

---

**작성일**: 2025-09-28
**작성자**: Claude Code
**우선순위**: High (타입 에러 및 보안 이슈)
**예상 소요 시간**: 6-8시간