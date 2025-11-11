# PIM-WMS Variant 생성 이벤트 통합 구현 계획서

## 📋 목차

1. [개요](#1-개요)
2. [아키텍처 설계](#2-아키텍처-설계)
3. [상세 구현 계획](#3-상세-구현-계획)
4. [멱등성 및 동시성 처리](#4-멱등성-및-동시성-처리)
5. [구현 단계별 체크리스트](#5-구현-단계별-체크리스트)
6. [테스트 계획](#6-테스트-계획)
7. [배포 및 롤백 전략](#7-배포-및-롤백-전략)

---

## 1. 개요

### 1.1 목적

PIM에서 판매 상품(Product Master)의 Variant가 생성될 때, WMS에 자동으로 매칭대기(Matching-Pending) 상태를 생성하는 이벤트 기반 통합을 구축합니다.

### 1.2 현재 상황

- **PIM**: Variant 생성 시 이벤트를 발행하지 않음 (순수 DB 작업)
- **WMS**: `ProductMatchingService`에 매칭대기 생성 로직 존재하나 이벤트 통합 없음
- **Event Infrastructure**: Kafka 기반 이벤트 시스템 구축 완료 (`@app/events`, `@packages/event-contracts`)

### 1.3 핵심 과제

**동시성 문제**: Orchestrator가 PIM과 WMS를 순차 호출할 때, 다음 두 요청이 Race Condition을 발생시킴:
- PIM 이벤트 발행 → WMS 이벤트 핸들러 → 매칭 생성
- Orchestrator → WMS 직접 요청 → 매칭 생성

**해결 방안**: 멱등성 기반 중복 처리 허용
- WMS는 `variantId` 기준으로 이미 매칭이 존재하면 스킵
- DB에 `unique index on variantId` 추가
- 이벤트 핸들러와 Orchestrator 요청 모두 동일한 멱등성 로직 사용

---

## 2. 아키텍처 설계

### 2.1 이벤트 흐름도

```
┌─────────────────┐
│   Orchestrator  │
│  (신규 상품등록) │
└────────┬────────┘
         │
         │ 1. POST /products
         ▼
┌─────────────────┐                    ┌──────────────────┐
│      PIM        │  2. Kafka Event    │      Kafka       │
│  ProductMasters │ ─────────────────> │ products.events  │
│     Service     │  ProductVariant    │      .v1         │
└────────┬────────┘     Created        └────────┬─────────┘
         │                                      │
         │ 3. Response                          │ 4. Subscribe
         │    (즉시 반환)                       │
         ▼                                      ▼
┌─────────────────┐                    ┌──────────────────┐
│  Orchestrator   │  5. POST /matching │       WMS        │
│                 │ ─────────────────> │  ProductMatching │
└─────────────────┘   (이벤트 대기 X)  │     Service      │
                                        └──────────────────┘
                                                 │
                      ┌──────────────────────────┼──────────────┐
                      │                          │              │
                      ▼                          ▼              │
              Case 1: Event 먼저        Case 2: Orchestrator 먼저│
              매칭 생성 (created=1)     매칭 생성 (created=1)    │
                      │                          │              │
                      ▼                          ▼              │
              Orchestrator 도착         Event 도착              │
              이미 존재 → skip         이미 존재 → skip         │
                      │                          │              │
                      └──────────────────────────┴──────────────┘
                                       ▼
                              최종 결과: 매칭 1개 생성 ✅
```

### 2.2 컴포넌트 구성

| 컴포넌트 | 역할 | 파일 경로 |
|---------|------|----------|
| **Product Stream** | 이벤트 계약 정의 (Payload, Schema) | `/packages/event-contracts/streams/product.stream.ts` |
| **PIM Publisher** | Variant 생성 시 이벤트 발행 | `/apps/pim/src/services/product-masters.service.ts` |
| **WMS Consumer** | 이벤트 수신 및 매칭 생성 | `/apps/wms/src/inventory/handlers/product-event.consumer.ts` |
| **Matching Service** | 멱등성 기반 매칭 생성 로직 | `/apps/wms/src/inventory/services/product-matching.service.ts` |

### 2.3 이벤트 스키마

#### ProductVariantCreated

```typescript
{
  messageType: 'ProductVariantCreated',
  messageKind: 'event',
  correlationId: '01JX...',
  timestamp: '2025-11-10T10:30:00Z',
  occurredAt: '2025-11-10T10:30:00Z',
  source: {
    service: 'pim',
    aggregateType: 'Product',
    aggregateId: 'prod_abc123',  // productId
    aggregateVersion: 1
  },
  payload: {
    productId: 'prod_abc123',
    productName: '아몬드영 티셔츠',
    variantId: 'var_xyz789',
    variantName: 'Red × Large',
    isDefault: false,
    status: 'active',
    inventoryManagement: true,         // 🔑 재고관리 여부
    preStockSellable: false,           // 🔑 입고 전 판매 가능
    alwaysSellableZeroStock: false,    // 🔑 재고 0에도 판매 가능
    optionCombination: [
      { name: '색상', value: 'Red' },
      { name: '사이즈', value: 'Large' }
    ],
    createdAt: '2025-11-10T10:30:00Z'
  }
}
```

---

## 3. 상세 구현 계획

### 3.1 Phase 1: Event Contract 정의

#### 파일: `/packages/event-contracts/streams/product.stream.ts` (신규)

```typescript
/**
 * Product Domain Stream Configuration
 *
 * PIM 상품 도메인 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface ProductVariantCreatedPayload {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string | null;
  isDefault: boolean;
  status: 'active' | 'draft' | 'archived';

  // 🔑 WMS 매칭에 필요한 필드
  inventoryManagement: boolean;
  preStockSellable?: boolean;
  alwaysSellableZeroStock?: boolean;

  // 옵션 조합 정보 (디버깅용)
  optionCombination?: Array<{
    name: string;
    value: string;
  }>;

  createdAt: string; // ISO 8601
}

export interface ProductVariantUpdatedPayload {
  productId: string;
  variantId: string;
  variantName?: string | null;
  status?: 'active' | 'draft' | 'archived';
  updatedAt: string;
}

export interface ProductVariantDeletedPayload {
  productId: string;
  variantId: string;
  deletedAt: string;
}

export interface ProductInventoryManagementChangedPayload {
  productId: string;
  productName: string;
  inventoryManagement: boolean;
  affectedVariants: Array<{
    variantId: string;
    variantName: string | null;
  }>;
  changedAt: string;
}

// ===== Zod 스키마 정의 =====

const OptionCombinationItemSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

const ProductVariantCreatedSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(['active', 'draft', 'archived']),
  inventoryManagement: z.boolean(),
  preStockSellable: z.boolean().optional(),
  alwaysSellableZeroStock: z.boolean().optional(),
  optionCombination: z.array(OptionCombinationItemSchema).optional(),
  createdAt: z.string().datetime(),
});

const ProductVariantUpdatedSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  updatedAt: z.string().datetime(),
});

const ProductVariantDeletedSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

const ProductInventoryManagementChangedSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  inventoryManagement: z.boolean(),
  affectedVariants: z.array(
    z.object({
      variantId: z.string().min(1),
      variantName: z.string().nullable(),
    }),
  ),
  changedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const PRODUCT_STREAM = stream({
  topic: 'products.events.v1',
  partitions: 12, // productId 기준 파티셔닝
  aggregateType: 'Product',
  events: {
    ProductVariantCreated: event<'ProductVariantCreated', ProductVariantCreatedPayload>(
      'ProductVariantCreated',
      ProductVariantCreatedSchema,
    ),
    ProductVariantUpdated: event<'ProductVariantUpdated', ProductVariantUpdatedPayload>(
      'ProductVariantUpdated',
      ProductVariantUpdatedSchema,
    ),
    ProductVariantDeleted: event<'ProductVariantDeleted', ProductVariantDeletedPayload>(
      'ProductVariantDeleted',
      ProductVariantDeletedSchema,
    ),
    ProductInventoryManagementChanged: event<
      'ProductInventoryManagementChanged',
      ProductInventoryManagementChangedPayload
    >('ProductInventoryManagementChanged', ProductInventoryManagementChangedSchema),
  },
});

// ===== 타입 추론 =====

export type ProductEvents = typeof PRODUCT_STREAM.events;
```

#### 파일: `/packages/event-contracts/streams/index.ts` (수정)

```typescript
// 기존 exports...
export * from './user.stream';
export * from './cart.stream';
export * from './order.stream';
export * from './payment.stream';
export * from './adapter.stream';

// 🔑 추가
export * from './product.stream';
```

---

### 3.2 Phase 2: PIM Publisher 구현

#### 파일: `/apps/pim/src/services/product-masters.service.ts` (수정)

**변경 사항:**
1. `StreamPublisher` 주입
2. `_generateVariants()` 메서드에서 variant 생성 후 이벤트 발행
3. 기본 `inventoryManagement: true` 설정 (추후 확장 가능)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ProductEvents, PRODUCT_STREAM } from '@packages/event-contracts';
// ... 기존 imports

@Injectable()
export class ProductMastersService {
  private readonly logger = new Logger(ProductMastersService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly pricingStrategyFactory: PricingStrategyFactory,

    // 🔑 추가: StreamPublisher 주입
    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,
  ) {}

  // ... 기존 메서드들

  private async _generateVariants(
    masterId: string,
    master: ProductMaster, // 🔑 추가: 이벤트 발행에 필요
    optionGroups: any[],
    tx: DbTransaction,
  ): Promise<void> {
    // Case 1: 옵션 그룹 없음 → 기본 variant 생성
    if (!optionGroups || optionGroups.length === 0) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          masterId,
          variantName: null,
          isDefault: true,
          status: 'active',
        })
        .returning();

      // 🔑 이벤트 발행
      await this.publishVariantCreatedEvent(master, variant, null);

      return;
    }

    // Case 2: 옵션 조합으로 variants 생성
    const combinations = this.generateOptionCombinations(optionGroups);

    for (const combination of combinations) {
      const variantName = combination.map((v) => v.displayName).join(' × ');

      const [variant] = await tx
        .insert(productVariants)
        .values({
          masterId,
          variantName,
          isDefault: false,
          status: 'active',
        })
        .returning();

      // 옵션 값 연결
      for (const optionValue of combination) {
        await tx.insert(variantOptionValues).values({
          variantId: variant.id,
          optionValueId: optionValue.id,
        });
      }

      // 🔑 이벤트 발행 (옵션 조합 포함)
      await this.publishVariantCreatedEvent(
        master,
        variant,
        combination.map((opt) => ({
          name: opt.groupName,
          value: opt.displayName,
        })),
      );
    }
  }

  /**
   * ProductVariantCreated 이벤트 발행
   */
  private async publishVariantCreatedEvent(
    master: ProductMaster,
    variant: any,
    optionCombination: Array<{ name: string; value: string }> | null,
  ): Promise<void> {
    try {
      await this.productPublisher.publishEvent({
        eventType: 'ProductVariantCreated',
        aggregateId: master.id,
        payload: {
          productId: master.id,
          productName: master.name,
          variantId: variant.id,
          variantName: variant.variantName,
          isDefault: variant.isDefault ?? false,
          status: variant.status ?? 'active',

          // 🔑 재고 관리 설정 (현재는 기본값, 추후 master 테이블에 필드 추가)
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,

          optionCombination: optionCombination ?? undefined,
          createdAt: new Date().toISOString(),
        },
      });

      this.logger.log(
        `📤 Published ProductVariantCreated: ${variant.id} (${master.name})`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to publish ProductVariantCreated: ${variant.id}`,
        error.stack,
      );
      // 🔑 이벤트 발행 실패해도 트랜잭션은 커밋
      // Orchestrator가 WMS에 직접 요청하므로 복원력 보장
    }
  }

  // ... 기존 메서드들
}
```

**호출 경로 수정:**

`_generateVariants()` 호출 시 `master` 객체 전달 필요:

```typescript
// Line 135 근처
private async _processOptionsAsync(masterId: string, data: CreateMasterDto) {
  try {
    // master 조회 추가
    const master = await this.getMasterById(masterId);
    if (!master) return;

    await this.db.db.transaction(async (tx) => {
      // ... 옵션 그룹 생성
      await this._generateVariants(masterId, master, optionGroups, tx); // 🔑 master 추가
    });
  } catch (error) {
    console.error('옵션 처리 실패:', error.message);
  }
}
```

---

### 3.3 Phase 3: WMS Consumer 구현

#### 파일: `/apps/wms/src/inventory/handlers/product-event.consumer.ts` (신규)

```typescript
/**
 * Product Event Consumer
 *
 * PIM의 Product 도메인 이벤트를 구독하여 WMS 매칭 생성
 */

import { Controller, Logger } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import {
  ProductVariantCreatedPayload,
  ProductVariantDeletedPayload,
  ProductInventoryManagementChangedPayload,
} from '@packages/event-contracts';
import { ProductMatchingService } from '../services/product-matching.service';

@Controller()
export class ProductEventConsumer {
  private readonly logger = new Logger(ProductEventConsumer.name);

  constructor(
    private readonly productMatchingService: ProductMatchingService,
  ) {}

  /**
   * ProductVariantCreated 이벤트 핸들러
   *
   * PIM에서 variant가 생성되면 WMS에 매칭대기 상태 생성
   */
  @OnEvent('products.events.v1', 'ProductVariantCreated')
  async onProductVariantCreated(
    @EventPayload() payload: ProductVariantCreatedPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[Event] Received ProductVariantCreated: ${payload.variantId} (correlationId: ${envelope.correlationId})`,
    );

    try {
      // inventoryManagement 플래그에 따라 분기
      if (!payload.inventoryManagement) {
        // 재고 관리 안함 → 자동 무시 (void 전략)
        await this.productMatchingService.handleAutomaticMatchingRequest({
          productId: payload.productId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName,
              inventoryManagement: false,
              components: [],
            },
          ],
        });

        this.logger.log(
          `[Event] Created auto-ignored matching for ${payload.variantId}`,
        );
      } else {
        // 재고 관리함 → 매칭대기 생성
        const result = await this.productMatchingService.handleManualMatchingRequest({
          productId: payload.productId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName,
              inventoryManagement: true,
              preStockSellable: payload.preStockSellable ?? false,
              alwaysSellableZeroStock: payload.alwaysSellableZeroStock ?? false,
              components: [],
            },
          ],
        });

        if (result.skipped > 0) {
          this.logger.log(
            `[Event] Matching already exists for ${payload.variantId} (likely created by orchestrator)`,
          );
        } else {
          this.logger.log(
            `[Event] Created ${result.created} matching-pending record(s)`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `[Event] Failed to handle ProductVariantCreated: ${payload.variantId}`,
        error.stack,
      );
      // 에러를 다시 던져서 DLQ로 전송
      throw error;
    }
  }

  /**
   * ProductInventoryManagementChanged 이벤트 핸들러
   *
   * inventoryManagement 플래그 변경 시 매칭 전략 업데이트
   */
  @OnEvent('products.events.v1', 'ProductInventoryManagementChanged')
  async onInventoryManagementChanged(
    @EventPayload() payload: ProductInventoryManagementChangedPayload,
  ) {
    this.logger.log(
      `[Event] Received ProductInventoryManagementChanged: ${payload.productId}`,
    );

    try {
      const variants = payload.affectedVariants.map((v) => ({
        id: v.variantId,
        name: v.variantName,
        inventoryManagement: payload.inventoryManagement,
        components: [],
      }));

      if (payload.inventoryManagement) {
        // true로 변경 → 매칭대기 생성
        await this.productMatchingService.handleManualMatchingRequest({
          productId: payload.productId,
          name: payload.productName,
          variants,
        });
      } else {
        // false로 변경 → 자동 무시
        await this.productMatchingService.handleAutomaticMatchingRequest({
          productId: payload.productId,
          name: payload.productName,
          variants,
        });
      }

      this.logger.log(
        `[Event] Updated matching for ${variants.length} variant(s)`,
      );
    } catch (error) {
      this.logger.error(
        `[Event] Failed to handle ProductInventoryManagementChanged: ${payload.productId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * ProductVariantDeleted 이벤트 핸들러
   *
   * variant 삭제 시 매칭 상태 업데이트 (현재는 로깅만)
   */
  @OnEvent('products.events.v1', 'ProductVariantDeleted')
  async onProductVariantDeleted(
    @EventPayload() payload: ProductVariantDeletedPayload,
  ) {
    this.logger.log(
      `[Event] Received ProductVariantDeleted: ${payload.variantId}`,
    );

    try {
      // TODO: 향후 구현 - 매칭 삭제 또는 상태 변경
      this.logger.warn(
        `[Event] ProductVariantDeleted handler not implemented yet for ${payload.variantId}`,
      );
    } catch (error) {
      this.logger.error(
        `[Event] Failed to handle ProductVariantDeleted: ${payload.variantId}`,
        error.stack,
      );
      throw error;
    }
  }
}
```

---

### 3.4 Phase 4: WMS 멱등성 강화

#### 파일: `/apps/wms/src/inventory/services/product-matching.service.ts` (수정)

**변경 사항:**
1. `handleManualMatchingRequest()` 메서드에 중복 체크 로직 추가
2. 반환 타입을 `{ created: number; skipped: number }`로 변경

```typescript
async handleManualMatchingRequest(
  request: PimProductChangeRequest,
  tx?: DbTx,
): Promise<{ created: number; skipped: number }> {
  return this.inTx(async (trx) => {
    let created = 0;
    let skipped = 0;

    for (const variant of request.variants) {
      // 🔑 멱등성: 이미 존재하는지 확인
      const existing = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variant.id))
        .limit(1);

      if (existing.length > 0) {
        this.logger.log(
          `Matching already exists for variantId=${variant.id}, skipping`,
        );
        skipped++;
        continue;
      }

      // 새로 생성
      if (!variant.inventoryManagement) {
        // 재고 관리 안함 → void 전략
        await trx
          .insert(wmsTables.productMatchings)
          .values({
            variantId: variant.id,
            status: 'ignored',
            priority: 'low',
            strategy: 'void',
            isResolved: true,
            inventoryManagement: false,
            preStockSellable: variant.preStockSellable ?? false,
            alwaysSellableZeroStock: variant.alwaysSellableZeroStock ?? false,
          });
        created++;
      } else {
        // 재고 관리함 → pending 상태
        const [newMatching] = await trx
          .insert(wmsTables.productMatchings)
          .values({
            variantId: variant.id,
            status: 'pending',
            priority: 'high',
            strategy: null,
            isResolved: false,
            inventoryManagement: true,
            preStockSellable: variant.preStockSellable ?? false,
            alwaysSellableZeroStock: variant.alwaysSellableZeroStock ?? false,
          })
          .returning();

        this.logger.log(
          `Created matching-pending: ${newMatching.id} for variantId=${variant.id}`,
        );
        created++;
      }
    }

    return { created, skipped };
  }, tx);
}
```

#### DB Migration: Unique Index 추가

**파일**: `/apps/wms/database/migrations/YYYYMMDD_add_unique_variant_idx.sql` (신규)

```sql
-- variantId에 유니크 인덱스 추가
CREATE UNIQUE INDEX IF NOT EXISTS unique_variant_idx
ON product_matchings(variant_id);

-- 기존 중복 데이터가 있다면 먼저 정리 필요
-- DELETE FROM product_matchings
-- WHERE id NOT IN (
--   SELECT MIN(id)
--   FROM product_matchings
--   GROUP BY variant_id
-- );
```

---

### 3.5 Phase 5: Module 설정

#### 파일: `/apps/pim/src/app.module.ts` (수정)

```typescript
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
// ... 기존 imports

@Module({
  imports: [
    // ... 기존 imports

    // 🔑 추가: EventsModule Publisher 등록
    EventsModule.forRoot({
      streams: [PRODUCT_STREAM],
      serviceName: 'pim',
      enableDLQ: true,
    }),
  ],
  // ...
})
export class AppModule {}
```

#### 파일: `/apps/wms/src/inventory/inventory.module.ts` (수정)

```typescript
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { ProductEventConsumer } from './handlers/product-event.consumer';
// ... 기존 imports

@Module({
  imports: [
    // ... 기존 imports

    // 🔑 추가: EventsModule Consumer 등록
    EventsModule.forConsumerModule({
      streams: [PRODUCT_STREAM],
      groupId: 'wms-product-consumer',
      enableAutoDLQ: true,
    }),
  ],
  controllers: [
    // ... 기존 controllers
    ProductEventConsumer, // 🔑 추가
  ],
  providers: [
    // ... 기존 providers
  ],
})
export class InventoryModule {}
```

#### 파일: `/apps/wms/src/main.ts` (수정)

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 🔑 추가: Kafka Consumer 연결
  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM],
    groupId: 'wms-product-consumer',
  });

  app.connectMicroservice(consumerOptions);

  await app.startAllMicroservices();
  await app.listen(3001);
}

bootstrap();
```

---

## 4. 멱등성 및 동시성 처리

### 4.1 동시성 시나리오

| 시나리오 | Timeline | 결과 |
|---------|---------|------|
| **Case 1: Event 먼저** | T1: Event 수신 → 매칭 생성<br>T2: Orchestrator 요청 → 이미 존재 → skip | ✅ 매칭 1개 |
| **Case 2: Orchestrator 먼저** | T1: Orchestrator 요청 → 매칭 생성<br>T2: Event 수신 → 이미 존재 → skip | ✅ 매칭 1개 |
| **Case 3: 완전 동시** | T1: 두 요청 동시 도착<br>→ DB unique index가 하나만 허용 | ✅ 매칭 1개 (나머지는 DB 에러) |

### 4.2 멱등성 보장 메커니즘

```
┌─────────────────────────────────────────────────────┐
│  멱등성 보장 레이어                                     │
├─────────────────────────────────────────────────────┤
│  1. Application Level (ProductMatchingService)      │
│     - variantId로 SELECT 후 존재하면 skip           │
│     - 반환: { created: 0, skipped: 1 }              │
│                                                      │
│  2. Database Level (Unique Index)                   │
│     - unique_variant_idx on variant_id              │
│     - 동시 INSERT 시 하나만 성공, 나머지는 에러      │
│                                                      │
│  3. Event Level (Kafka Idempotent Producer)         │
│     - producer: { idempotent: true }                │
│     - 네트워크 재시도 시 중복 전송 방지              │
└─────────────────────────────────────────────────────┘
```

### 4.3 에러 처리 전략

| 에러 유형 | 처리 방법 | DLQ 전송 여부 |
|----------|----------|--------------|
| **중복 매칭 (Application)** | Skip 후 정상 반환 | ❌ |
| **중복 매칭 (DB Unique Constraint)** | Catch 후 정상 반환 | ❌ |
| **DB 연결 실패** | 에러 throw | ✅ |
| **스키마 검증 실패** | 에러 throw | ✅ |
| **비즈니스 로직 에러** | 에러 throw | ✅ |

---

## 5. 구현 단계별 체크리스트

### Phase 1: Event Contract 정의

- [ ] `/packages/event-contracts/streams/product.stream.ts` 생성
  - [ ] `ProductVariantCreatedPayload` 타입 정의
  - [ ] `ProductVariantCreatedSchema` Zod 스키마 정의
  - [ ] `PRODUCT_STREAM` 설정
- [ ] `/packages/event-contracts/streams/index.ts`에 export 추가
- [ ] 빌드 테스트: `npm run build`

### Phase 2: PIM Publisher 구현

- [ ] `/apps/pim/src/services/product-masters.service.ts` 수정
  - [ ] `StreamPublisher` 주입 (`@InjectStreamPublisher`)
  - [ ] `publishVariantCreatedEvent()` 메서드 추가
  - [ ] `_generateVariants()` 메서드에 이벤트 발행 추가
  - [ ] `_processOptionsAsync()` 메서드에 master 조회 추가
- [ ] `/apps/pim/src/app.module.ts`에 `EventsModule.forRoot()` 추가
- [ ] 단위 테스트: `publishVariantCreatedEvent()` 메서드
- [ ] 통합 테스트: variant 생성 시 이벤트 발행 확인

### Phase 3: WMS Consumer 구현

- [ ] `/apps/wms/src/inventory/handlers/product-event.consumer.ts` 생성
  - [ ] `@OnEvent` 데코레이터로 핸들러 구현
  - [ ] `ProductMatchingService` 호출
  - [ ] 에러 처리 (DLQ 연동)
- [ ] `/apps/wms/src/inventory/inventory.module.ts`에 Consumer 등록
  - [ ] `EventsModule.forConsumerModule()` 추가
  - [ ] `ProductEventConsumer` controller 등록
- [ ] `/apps/wms/src/main.ts`에 microservice 연결
- [ ] 단위 테스트: `onProductVariantCreated()` 핸들러

### Phase 4: WMS 멱등성 강화

- [ ] `/apps/wms/src/inventory/services/product-matching.service.ts` 수정
  - [ ] 중복 체크 로직 추가 (`SELECT ... WHERE variantId`)
  - [ ] 반환 타입 변경 (`{ created, skipped }`)
- [ ] DB Migration: `unique_variant_idx` 생성
  - [ ] 기존 중복 데이터 정리 (필요시)
  - [ ] `CREATE UNIQUE INDEX` 실행
- [ ] 단위 테스트: 중복 요청 시 skip 동작 확인

### Phase 5: 통합 테스트

- [ ] 로컬 Kafka 환경 구축 (Docker Compose)
- [ ] E2E 테스트: PIM variant 생성 → WMS 매칭 생성 확인
- [ ] Race Condition 테스트: 동시 요청 시 중복 방지 확인
- [ ] DLQ 테스트: 에러 발생 시 DLQ 전송 확인
- [ ] 성능 테스트: 대량 variant 생성 시 이벤트 처리 속도

### Phase 6: 문서화 및 배포

- [ ] API 문서 업데이트
- [ ] 운영 가이드 작성 (Kafka 모니터링, DLQ 처리)
- [ ] 환경 변수 문서화 (`KAFKA_BROKERS`, `KAFKA_API_KEY`, etc.)
- [ ] 스테이징 환경 배포
- [ ] 프로덕션 배포

---

## 6. 테스트 계획

### 6.1 단위 테스트

#### PIM Publisher Test

**파일**: `/apps/pim/src/services/product-masters.service.spec.ts`

```typescript
describe('ProductMastersService', () => {
  it('should publish ProductVariantCreated event when variant is created', async () => {
    // Given
    const mockPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };

    // When
    await service.createMaster({
      name: 'Test Product',
      optionGroups: [],
      // ...
    });

    // Then
    expect(mockPublisher.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ProductVariantCreated',
        aggregateId: expect.any(String),
        payload: expect.objectContaining({
          productId: expect.any(String),
          variantId: expect.any(String),
          inventoryManagement: true,
        }),
      }),
    );
  });
});
```

#### WMS Consumer Test

**파일**: `/apps/wms/src/inventory/handlers/product-event.consumer.spec.ts`

```typescript
describe('ProductEventConsumer', () => {
  it('should create matching-pending when ProductVariantCreated is received', async () => {
    // Given
    const mockService = {
      handleManualMatchingRequest: jest.fn().mockResolvedValue({
        created: 1,
        skipped: 0,
      }),
    };

    const payload: ProductVariantCreatedPayload = {
      productId: 'prod_123',
      productName: 'Test',
      variantId: 'var_456',
      variantName: 'Red × L',
      isDefault: false,
      status: 'active',
      inventoryManagement: true,
      createdAt: new Date().toISOString(),
    };

    // When
    await consumer.onProductVariantCreated(payload, { correlationId: 'xxx' });

    // Then
    expect(mockService.handleManualMatchingRequest).toHaveBeenCalledWith({
      productId: 'prod_123',
      name: 'Test',
      variants: [
        {
          id: 'var_456',
          name: 'Red × L',
          inventoryManagement: true,
          components: [],
        },
      ],
    });
  });

  it('should skip when matching already exists', async () => {
    // Given
    const mockService = {
      handleManualMatchingRequest: jest.fn().mockResolvedValue({
        created: 0,
        skipped: 1,
      }),
    };

    // When
    await consumer.onProductVariantCreated(payload, envelope);

    // Then
    expect(mockService.handleManualMatchingRequest).toHaveBeenCalled();
    // 로그에 "already exists" 메시지 확인
  });
});
```

### 6.2 통합 테스트

#### Kafka Integration Test

**파일**: `/apps/wms/test/integration/product-event.integration.spec.ts`

```typescript
describe('Product Event Integration', () => {
  let kafkaContainer: StartedTestContainer;
  let pimApp: INestApplication;
  let wmsApp: INestApplication;

  beforeAll(async () => {
    // Kafka TestContainer 시작
    kafkaContainer = await new KafkaContainer()
      .withExposedPorts(9093)
      .start();

    // PIM, WMS 앱 초기화 (Kafka 연결)
    // ...
  });

  it('should create WMS matching when PIM variant is created', async (done) => {
    // Given
    const productDto = {
      name: 'Integration Test Product',
      optionGroups: [],
    };

    // When: PIM에 상품 생성
    const response = await request(pimApp.getHttpServer())
      .post('/products')
      .send(productDto);

    const productId = response.body.id;
    const variantId = response.body.variants[0].id;

    // Then: WMS에서 매칭 생성 확인 (비동기, 최대 5초 대기)
    await waitFor(async () => {
      const matching = await wmsDb
        .select()
        .from(productMatchings)
        .where(eq(productMatchings.variantId, variantId));

      expect(matching).toHaveLength(1);
      expect(matching[0].status).toBe('pending');
    }, 5000);

    done();
  });

  it('should handle race condition correctly', async () => {
    // Given
    const productId = 'prod_race_test';
    const variantId = 'var_race_test';

    // When: PIM 이벤트와 Orchestrator 요청 동시 발생
    await Promise.all([
      // Event 발행
      kafkaProducer.send({
        topic: 'products.events.v1',
        messages: [
          {
            value: JSON.stringify({
              messageType: 'ProductVariantCreated',
              payload: { productId, variantId, ... },
            }),
          },
        ],
      }),
      // Orchestrator 요청
      request(wmsApp.getHttpServer())
        .post('/matchings')
        .send({ productId, variants: [{ id: variantId, ... }] }),
    ]);

    // Then: 매칭 1개만 생성됨
    const matchings = await wmsDb
      .select()
      .from(productMatchings)
      .where(eq(productMatchings.variantId, variantId));

    expect(matchings).toHaveLength(1);
  });
});
```

### 6.3 E2E 테스트

**파일**: `/test/e2e/product-workflow.e2e-spec.ts`

```typescript
describe('Product Creation Workflow (E2E)', () => {
  it('should complete full product creation flow', async () => {
    // 1. Orchestrator가 PIM에 상품 생성
    const pimResponse = await orchestrator.createProduct({
      name: 'E2E Test Product',
      optionGroups: [
        { name: '색상', values: ['Red', 'Blue'] },
        { name: '사이즈', values: ['S', 'M'] },
      ],
    });

    expect(pimResponse.variants).toHaveLength(4); // 2 × 2

    // 2. Orchestrator가 WMS에 매칭 생성 (이벤트 대기 안함)
    const wmsResponse = await orchestrator.createMatchings({
      productId: pimResponse.id,
      variants: pimResponse.variants,
    });

    expect(wmsResponse.created).toBeGreaterThan(0);

    // 3. 이벤트 처리 완료 대기
    await sleep(2000);

    // 4. WMS에서 최종 매칭 상태 확인
    const matchings = await wmsDb
      .select()
      .from(productMatchings)
      .where(eq(productMatchings.productId, pimResponse.id));

    expect(matchings).toHaveLength(4);
    expect(matchings.every((m) => m.status === 'pending')).toBe(true);
  });
});
```

---

## 7. 배포 및 롤백 전략

### 7.1 배포 순서

```
Stage 1: Event Contract 배포
  ↓
Stage 2: WMS Consumer 배포 (이벤트 수신 대기)
  ↓
Stage 3: PIM Publisher 배포 (이벤트 발행 시작)
  ↓
Stage 4: 모니터링 및 검증
```

**중요**: WMS Consumer를 먼저 배포하여 이벤트 유실 방지

### 7.2 Feature Flag

초기에는 Feature Flag로 이벤트 발행을 제어:

```typescript
// .env
ENABLE_PRODUCT_EVENTS=false  // 초기 배포 시 false

// product-masters.service.ts
private async publishVariantCreatedEvent(...) {
  if (process.env.ENABLE_PRODUCT_EVENTS !== 'true') {
    this.logger.warn('Product events disabled by feature flag');
    return;
  }

  await this.productPublisher.publishEvent(...);
}
```

**활성화 단계:**
1. Stage 1-2 배포 후 `ENABLE_PRODUCT_EVENTS=false` 유지
2. WMS Consumer 정상 동작 확인
3. `ENABLE_PRODUCT_EVENTS=true`로 변경 (PIM 재시작 불필요하도록 런타임 체크)

### 7.3 롤백 전략

| 단계 | 롤백 방법 |
|------|----------|
| **Phase 3 배포 중 (WMS Consumer)** | WMS 이전 버전으로 롤백 (이벤트 무시) |
| **Phase 4 배포 중 (PIM Publisher)** | `ENABLE_PRODUCT_EVENTS=false` 설정 |
| **프로덕션 이슈 발생** | 1. Feature Flag OFF<br>2. WMS Consumer 제거<br>3. PIM 롤백 |

### 7.4 모니터링 지표

**Kafka Metrics:**
- `products.events.v1` 토픽 lag
- Consumer group `wms-product-consumer` offset
- DLQ (`products.events.v1.dlq`) 메시지 수

**Application Metrics:**
- PIM: 이벤트 발행 성공률
- WMS: 이벤트 처리 성공률
- WMS: 매칭 중복 skip 비율 (`skipped / (created + skipped)`)

**Alerts:**
- Kafka lag > 1000 메시지
- DLQ에 메시지 1개 이상 존재
- WMS 매칭 생성 실패율 > 5%

---

## 8. 환경 변수 설정

### PIM Service

```bash
# Kafka 연결
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=pim
SERVICE_NAME=pim

# Confluent Cloud (프로덕션)
KAFKA_API_KEY=your_api_key
KAFKA_API_SECRET=your_api_secret

# Feature Flag
ENABLE_PRODUCT_EVENTS=true
```

### WMS Service

```bash
# Kafka 연결
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=wms
SERVICE_NAME=wms

# Confluent Cloud (프로덕션)
KAFKA_API_KEY=your_api_key
KAFKA_API_SECRET=your_api_secret

# Consumer Group
WMS_CONSUMER_GROUP_ID=wms-product-consumer
```

---

## 9. 추가 고려 사항

### 9.1 inventoryManagement 플래그 추가

현재 PIM `product_masters` 테이블에 `inventoryManagement` 필드가 없습니다.

**Option 1: 기본값 사용 (현재 계획)**
- 모든 variant는 `inventoryManagement: true`로 가정
- 간단하지만 유연성 부족

**Option 2: PIM 스키마 확장 (추후)**
```sql
ALTER TABLE product_masters
ADD COLUMN inventory_management BOOLEAN DEFAULT TRUE;

ALTER TABLE product_variants
ADD COLUMN inventory_management BOOLEAN DEFAULT NULL; -- NULL이면 master 설정 상속
```

### 9.2 대량 Variant 생성 최적화

옵션 조합이 많은 경우 (예: 3개 옵션 × 10개 값 = 1000개 variant):
- 현재: 1000번 이벤트 발행 → Kafka 부하
- 개선: 배치 이벤트 도입

```typescript
export interface ProductVariantsBatchCreatedPayload {
  productId: string;
  productName: string;
  variants: Array<{
    variantId: string;
    variantName: string | null;
    // ...
  }>;
  createdAt: string;
}
```

### 9.3 Saga 패턴 (향후 확장)

복잡한 보상 트랜잭션 필요 시:
- PIM → WMS → Fulfillment Service 체인
- 중간 실패 시 롤백 이벤트 발행

---

## 10. 참고 자료

- **Kafka Idempotent Producer**: https://kafka.apache.org/documentation/#producerconfigs_enable.idempotence
- **NestJS Microservices**: https://docs.nestjs.com/microservices/kafka
- **Zod Schema Validation**: https://zod.dev/
- **Event Sourcing Patterns**: https://microservices.io/patterns/data/event-sourcing.html

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 2025-11-10 | 1.0 | 초안 작성 | Claude |

---

## 승인

| 역할 | 이름 | 서명 | 날짜 |
|------|------|------|------|
| 아키텍트 |  |  |  |
| 백엔드 리드 |  |  |  |
| DevOps |  |  |  |
