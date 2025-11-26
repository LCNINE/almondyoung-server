# 채널 상품 ↔ PIM Variant 매핑 설계

**작성일**: 2025년 11월 25일  
**관련 문서**: [마스터 플랜](./order-system-improvement-plan.md), [이벤트 스트림 설계](./order-event-stream-design.md)

---

## 📋 개요

외부 판매채널(쿠팡, 네이버 등)의 상품 ID와 PIM의 ProductVariant를 연결하는 매핑 시스템을 정의합니다.

### 핵심 원칙

1. **Variant는 채널과 무관한 "제품의 정체성"**
2. **ChannelVariantListing은 "특정 채널에서의 등록 정보"**
3. **하나의 Variant가 여러 채널에 등록 가능** (N:1 관계 역전)
4. **모든 SO는 PIM Variant 기준으로 생성** (일관성 유지)

---

## 🏗️ 아키텍처

### 개념 다이어그램

```
                    ┌─────────────────┐
                    │  ProductVariant │
                    │  "블랙 M"       │
                    │  id: V001       │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Listing (쿠팡)  │ │ Listing (네이버)│ │ Listing (자체몰)│
│ itemId: 123     │ │ itemId: ABC     │ │ (기본 노출)     │
│ variant: V001   │ │ variant: V001   │ │ variant: V001   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              채널 상품 매핑 플로우                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [사전 준비]                                                                    │
│                                                                                 │
│  1. PIM에 상품/Variant 등록                                                     │
│     └── ProductMaster (블랙 티셔츠)                                            │
│             └── ProductVariant (S, M, L)                                       │
│                                                                                 │
│  2. 외부 채널에 상품 등록 (수동, PIM과 별개)                                    │
│     └── 쿠팡 셀러센터에서 "블랙 티셔츠" 등록                                   │
│             └── 쿠팡 상품 옵션: S(vendorItemId: 111), M(222), L(333)           │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  [주문 처리 시]                                                                 │
│                                                                                 │
│  쿠팡 주문 수신 (channelItemId: 222)                                           │
│           │                                                                     │
│           ▼                                                                     │
│  Channel Adapter: PIM API로 매핑 조회                                          │
│  GET /api/channel-listings?channel=coupang&itemId=222                          │
│           │                                                                     │
│           ├─── 매핑 존재 ───▶ variantId 반환 ───▶ OrderCreated 발행           │
│           │                                                                     │
│           └─── 매핑 없음 ───▶ 주문 계류 (pending_mapping)                      │
│                                      │                                          │
│                                      ▼                                          │
│                              관리자 UI에서 매핑                                 │
│                              "쿠팡 222 = PIM 블랙 M"                           │
│                                      │                                          │
│                                      ▼                                          │
│                              channel_variant_listings에 저장                    │
│                                      │                                          │
│                                      ▼                                          │
│                              계류된 주문 재처리                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 스키마 설계

### 1. `channel_variant_listings` 테이블 (PIM)

```typescript
// apps/pim/src/schema.ts에 추가

export const channelVariantListings = pgTable('channel_variant_listings', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  
  // 어떤 variant가
  variantId: uuid('variant_id')
    .notNull()
    .references(() => productVariants.id, { onDelete: 'cascade' }),
  
  // 어떤 채널에
  salesChannelId: uuid('sales_channel_id')
    .notNull()
    .references(() => salesChannels.id, { onDelete: 'cascade' }),
  
  // 어떤 ID로 등록되어 있는가
  channelItemId: varchar('channel_item_id', { length: 255 }).notNull(),
  
  // 채널에서의 부가 정보 (디스플레이용)
  channelItemName: varchar('channel_item_name', { length: 500 }),
  channelOptionName: varchar('channel_option_name', { length: 255 }), // "블랙 / M"
  channelPrice: bigint('channel_price', { mode: 'number' }),
  channelProductUrl: varchar('channel_product_url', { length: 1000 }),
  
  // 상태
  isActive: boolean('is_active').default(true).notNull(),
  
  // 메타
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  // 핵심 인덱스: 채널 + 채널아이템ID로 variant 조회 (매우 빈번)
  uniqueIndex('uq_channel_variant_listing').on(
    table.salesChannelId,
    table.channelItemId,
  ),
  // variant 기준 조회 (관리 UI용)
  index('idx_channel_listings_variant').on(table.variantId),
  // 채널 기준 조회 (동기화용)
  index('idx_channel_listings_channel').on(table.salesChannelId),
]);
```

### 2. Relations 정의

```typescript
export const channelVariantListingsRelations = relations(
  channelVariantListings,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [channelVariantListings.variantId],
      references: [productVariants.id],
    }),
    channel: one(salesChannels, {
      fields: [channelVariantListings.salesChannelId],
      references: [salesChannels.id],
    }),
  }),
);

// productVariantsRelations에 추가
export const productVariantsRelations = relations(
  productVariants,
  ({ many }) => ({
    // 기존 relations...
    channelListings: many(channelVariantListings),
  }),
);
```

### 3. `sales_channels` 테이블 확장 (필요시)

```typescript
// 기존 salesChannels 테이블에 외부 채널 타입 구분이 필요하다면:
// channelType: varchar('channel_type', { length: 50 }), // 'internal' | 'external'
// 
// 또는 기존에 'coupang', 'naver' 등이 이미 등록되어 있다면 그대로 사용
```

---

## 🔌 API 설계

### 1. 매핑 조회 API (Channel Adapter → PIM)

```typescript
// GET /api/channel-listings/lookup
// Query: { salesChannelId: string, channelItemId: string }
// Response: { variantId: string } | null

interface LookupChannelListingRequest {
  salesChannelId: string;  // 또는 channelCode: 'coupang' | 'naver'
  channelItemId: string;
}

interface LookupChannelListingResponse {
  variantId: string;
  variantCode: string;
  variantName: string;
  isActive: boolean;
}
```

### 2. 매핑 생성 API (관리자 UI)

```typescript
// POST /api/channel-listings
// Body: { variantId, salesChannelId, channelItemId, ... }

interface CreateChannelListingRequest {
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}
```

### 3. Variant별 채널 등록 현황 조회 (관리자 UI)

```typescript
// GET /api/variants/:variantId/channel-listings
// Response: ChannelListingDto[]

interface ChannelListingDto {
  id: string;
  channelName: string;  // "쿠팡", "네이버 스마트스토어"
  channelItemId: string;
  channelItemName: string;
  channelOptionName: string;
  isActive: boolean;
  createdAt: string;
}
```

### 4. 미매핑 주문 조회 API (Channel Adapter 내부)

```typescript
// GET /api/pending-orders?status=pending_mapping
// 관리자가 매핑 대기 중인 주문 목록 조회

interface PendingMappingOrderDto {
  orderId: string;
  channel: string;
  channelItemId: string;
  channelItemName: string;  // 채널에서 제공한 상품명
  channelOptionName: string;
  quantity: number;
  orderDate: string;
}
```

---

## 🔄 Channel Adapter 변경 사항

### 1. 주문 처리 플로우 변경

```typescript
// apps/channel-adapter/src/services/order-event.publisher.ts

@Injectable()
export class OrderEventPublisher {
  constructor(
    @InjectStreamPublisher('orders.events.v1')
    private readonly ordersPublisher: StreamPublisher<OrderEvents>,
    private readonly channelListingClient: ChannelListingClient, // PIM API 클라이언트
    private readonly pendingOrderRepository: PendingOrderRepository,
  ) {}

  async publishOrderCreated(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
  ): Promise<{ published: boolean; pendingReason?: string }> {
    
    // 1. 모든 주문 라인에 대해 매핑 조회
    const itemsWithMapping = await Promise.all(
      orderEvent.items.map(async (item) => {
        const listing = await this.channelListingClient.lookup({
          channelCode: channel,
          channelItemId: item.channelItemId,
        });
        return { ...item, variantId: listing?.variantId };
      }),
    );

    // 2. 매핑되지 않은 항목 확인
    const unmappedItems = itemsWithMapping.filter(item => !item.variantId);

    if (unmappedItems.length > 0) {
      // 3. 계류 처리
      await this.pendingOrderRepository.save({
        channel,
        externalOrderId: orderEvent.externalOrderId,
        status: 'pending_mapping',
        unmappedItems: unmappedItems.map(i => ({
          channelItemId: i.channelItemId,
          channelItemName: i.productName,
          channelOptionName: i.optionName,
        })),
        rawOrderEvent: orderEvent,
        createdAt: new Date(),
      });

      this.logger.warn(
        `⏸️ Order ${orderEvent.externalOrderId} pending: ${unmappedItems.length} unmapped items`,
      );

      return { published: false, pendingReason: 'unmapped_items' };
    }

    // 4. 모든 항목이 매핑됨 → 이벤트 발행
    const payload: OrderCreatedPayload = {
      orderId: uuidv4(),
      externalOrderId: orderEvent.externalOrderId,
      salesChannel: this.mapChannelToSalesChannel(channel),
      // ... 기존 필드들
      items: itemsWithMapping.map(item => ({
        orderItemId: item.channelItemId,
        variantId: item.variantId!, // 여기서는 반드시 존재
        skuId: item.variantId!, // 스냅샷에서 SKU로 변환됨
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    };

    await this.ordersPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: orderEvent.externalOrderId,
      payload,
    });

    return { published: true };
  }
}
```

### 2. 계류 주문 재처리 서비스

```typescript
// apps/channel-adapter/src/services/pending-order.service.ts

@Injectable()
export class PendingOrderService {
  constructor(
    private readonly pendingOrderRepository: PendingOrderRepository,
    private readonly orderEventPublisher: OrderEventPublisher,
  ) {}

  /**
   * 매핑이 완료된 후 호출되어 계류된 주문을 재처리
   */
  async retryPendingOrders(channelItemId: string): Promise<number> {
    // 해당 channelItemId를 포함한 계류 주문 조회
    const pendingOrders = await this.pendingOrderRepository.findByUnmappedItem(channelItemId);

    let processedCount = 0;
    for (const order of pendingOrders) {
      const result = await this.orderEventPublisher.publishOrderCreated(
        order.channel,
        order.rawOrderEvent,
      );

      if (result.published) {
        await this.pendingOrderRepository.markAsProcessed(order.id);
        processedCount++;
      }
    }

    return processedCount;
  }

  /**
   * 관리자가 수동으로 특정 주문 재처리
   */
  async retryOrder(orderId: string): Promise<boolean> {
    const order = await this.pendingOrderRepository.findById(orderId);
    if (!order) return false;

    const result = await this.orderEventPublisher.publishOrderCreated(
      order.channel,
      order.rawOrderEvent,
    );

    if (result.published) {
      await this.pendingOrderRepository.markAsProcessed(order.id);
    }

    return result.published;
  }
}
```

### 3. 계류 주문 테이블 (Channel Adapter)

```typescript
// apps/channel-adapter/src/schema.ts에 추가

export const pendingOrders = pgTable('pending_orders', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  
  // 채널 정보
  channel: varchar('channel', { length: 50 }).notNull(), // 'coupang', 'naver'
  externalOrderId: varchar('external_order_id', { length: 255 }).notNull(),
  
  // 상태
  status: varchar('status', { length: 50 }).notNull().default('pending_mapping'),
  // 'pending_mapping' | 'processing' | 'completed' | 'failed'
  
  // 미매핑 항목 정보 (관리자 UI 표시용)
  unmappedItems: jsonb('unmapped_items').$type<{
    channelItemId: string;
    channelItemName: string;
    channelOptionName?: string;
  }[]>().notNull(),
  
  // 원본 주문 데이터 (재처리용)
  rawOrderEvent: jsonb('raw_order_event').notNull(),
  
  // 처리 정보
  retryCount: integer('retry_count').default(0),
  lastRetryAt: timestamp('last_retry_at'),
  processedAt: timestamp('processed_at'),
  errorMessage: text('error_message'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_pending_orders_status').on(table.status),
  index('idx_pending_orders_channel').on(table.channel),
  uniqueIndex('uq_pending_orders_external').on(
    table.channel,
    table.externalOrderId,
  ),
]);
```

---

## 🖥️ 관리자 UI 기능

### 1. 미매핑 주문 목록 화면

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  미매핑 주문 관리                                              [새로고침]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚠️ 매핑 대기 중인 주문: 3건                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 쿠팡 │ 주문번호: 12345678 │ 2025-11-25 14:30                       │   │
│  │                                                                     │   │
│  │ 미매핑 상품:                                                        │   │
│  │  • vendorItemId: 222 - "블랙 티셔츠 M" [매핑하기]                  │   │
│  │  • vendorItemId: 333 - "블랙 티셔츠 L" [매핑하기]                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 네이버 │ 주문번호: ABC-2025-001 │ 2025-11-25 15:00                 │   │
│  │                                                                     │   │
│  │ 미매핑 상품:                                                        │   │
│  │  • productOrderId: NAVERPROD123 - "화이트 셔츠 S" [매핑하기]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. 매핑 다이얼로그

```
┌─────────────────────────────────────────────────────────────────┐
│  채널 상품 매핑                                            [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  채널 상품 정보:                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 채널: 쿠팡                                               │   │
│  │ 상품ID: 222                                              │   │
│  │ 상품명: 블랙 티셔츠 M                                    │   │
│  │ 옵션: 블랙 / M                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  PIM Variant 선택:                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔍 검색: [블랙 티셔츠                              ]    │   │
│  │                                                         │   │
│  │ ○ V001 - 블랙 티셔츠 S (SKU: SKU-BLK-S)               │   │
│  │ ● V002 - 블랙 티셔츠 M (SKU: SKU-BLK-M) ✓             │   │
│  │ ○ V003 - 블랙 티셔츠 L (SKU: SKU-BLK-L)               │   │
│  │                                                         │   │
│  │ [+ 새 Variant 생성]                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              [취소]  [매핑 저장]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Variant 상세 화면의 채널 등록 현황

```
┌─────────────────────────────────────────────────────────────────┐
│  Variant: 블랙 티셔츠 M (V002)                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  기본 정보:                                                     │
│  • 코드: SKU-BLK-M                                              │
│  • 상태: Active                                                 │
│  • 가격: ₩29,000                                                │
│                                                                 │
│  채널 등록 현황:                                    [+ 매핑 추가]│
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 채널         │ 채널 상품ID  │ 옵션명    │ 상태   │     │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 쿠팡         │ 222          │ 블랙/M    │ 활성   │ [X] │   │
│  │ 네이버       │ PROD-M-001   │ M사이즈   │ 활성   │ [X] │   │
│  │ 자체몰       │ (기본 노출)  │ -         │ 활성   │     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 PIM 서비스 구현

### 1. ChannelListingService

```typescript
// apps/pim/src/core/channels/channel-listing.service.ts

@Injectable()
export class ChannelListingService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 채널 상품 ID로 Variant 조회 (Channel Adapter에서 호출)
   */
  async lookupVariant(
    salesChannelId: string,
    channelItemId: string,
  ): Promise<{ variantId: string; variantCode: string } | null> {
    const result = await this.db
      .select({
        variantId: channelVariantListings.variantId,
        variantCode: productVariants.variantCode,
      })
      .from(channelVariantListings)
      .innerJoin(
        productVariants,
        eq(channelVariantListings.variantId, productVariants.id),
      )
      .where(
        and(
          eq(channelVariantListings.salesChannelId, salesChannelId),
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * 새 채널 매핑 생성
   */
  async createListing(dto: CreateChannelListingDto): Promise<ChannelVariantListing> {
    const [listing] = await this.db
      .insert(channelVariantListings)
      .values({
        variantId: dto.variantId,
        salesChannelId: dto.salesChannelId,
        channelItemId: dto.channelItemId,
        channelItemName: dto.channelItemName,
        channelOptionName: dto.channelOptionName,
        channelPrice: dto.channelPrice,
        channelProductUrl: dto.channelProductUrl,
      })
      .returning();

    return listing;
  }

  /**
   * Variant의 모든 채널 등록 현황 조회
   */
  async getListingsByVariant(variantId: string): Promise<ChannelListingWithChannel[]> {
    return this.db
      .select({
        id: channelVariantListings.id,
        channelItemId: channelVariantListings.channelItemId,
        channelItemName: channelVariantListings.channelItemName,
        channelOptionName: channelVariantListings.channelOptionName,
        channelPrice: channelVariantListings.channelPrice,
        isActive: channelVariantListings.isActive,
        createdAt: channelVariantListings.createdAt,
        channel: {
          id: salesChannels.id,
          name: salesChannels.name,
          code: salesChannels.code,
        },
      })
      .from(channelVariantListings)
      .innerJoin(salesChannels, eq(channelVariantListings.salesChannelId, salesChannels.id))
      .where(eq(channelVariantListings.variantId, variantId));
  }

  /**
   * 매핑 삭제 (비활성화)
   */
  async deactivateListing(listingId: string): Promise<void> {
    await this.db
      .update(channelVariantListings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(channelVariantListings.id, listingId));
  }
}
```

### 2. ChannelListingController

```typescript
// apps/pim/src/core/channels/channel-listing.controller.ts

@Controller('channel-listings')
@ApiTags('Channel Listings')
export class ChannelListingController {
  constructor(private readonly channelListingService: ChannelListingService) {}

  @Get('lookup')
  @ApiOperation({ summary: '채널 상품 ID로 Variant 조회' })
  async lookup(
    @Query('salesChannelId') salesChannelId: string,
    @Query('channelItemId') channelItemId: string,
  ): Promise<LookupChannelListingResponse | null> {
    return this.channelListingService.lookupVariant(salesChannelId, channelItemId);
  }

  @Post()
  @ApiOperation({ summary: '채널 매핑 생성' })
  async create(@Body() dto: CreateChannelListingDto): Promise<ChannelListingDto> {
    return this.channelListingService.createListing(dto);
  }

  @Get('by-variant/:variantId')
  @ApiOperation({ summary: 'Variant의 채널 등록 현황 조회' })
  async getByVariant(
    @Param('variantId') variantId: string,
  ): Promise<ChannelListingWithChannelDto[]> {
    return this.channelListingService.getListingsByVariant(variantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '채널 매핑 비활성화' })
  async deactivate(@Param('id') id: string): Promise<void> {
    return this.channelListingService.deactivateListing(id);
  }
}
```

---

## ❓ FAQ

### Q1: 자체몰에서는 판매하지 않고 외부 채널에서만 판매하는 상품은?

**A**: ProductMasterVersion의 상태를 `inactive`로 설정하면 됩니다.
- Medusa 자체몰에서는 노출되지 않음
- PIM에는 Variant가 존재하므로 채널 매핑 가능
- WMS에서 재고 관리 가능

### Q2: 같은 실물 상품이 쿠팡과 네이버에 모두 등록된 경우?

**A**: 같은 ProductVariant에 두 개의 ChannelVariantListing을 생성합니다.
```
ProductVariant (블랙 M)
    ├── ChannelListing (쿠팡, itemId: 222)
    └── ChannelListing (네이버, itemId: ABC-M)
```

### Q3: 번들/세트 상품은 어떻게 처리?

**A**: 현재 설계에서는 1:1 매핑만 지원합니다. 번들은 별도 검토 필요.
- 옵션 1: 번들용 별도 Variant 생성
- 옵션 2: 매핑 테이블 확장 (1:N 지원)

### Q4: 매핑 후 계류 주문은 자동으로 처리되나?

**A**: 두 가지 방식 지원:
1. **자동**: 매핑 생성 시 webhook으로 `PendingOrderService.retryPendingOrders()` 호출
2. **수동**: 관리자가 UI에서 "재처리" 버튼 클릭

---

## 📝 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내역 |
|------|------|--------|-----------|
| 1.0.0 | 2025-11-25 | AI Agent | 초기 작성 |

