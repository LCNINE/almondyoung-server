# Phase 4 Implementation Plan: Analytics & Monitoring

## Overview
Phase 4 focuses on implementing dashboard analytics and monitoring features for the PIM system. This phase provides metrics, insights, and visualization data for product management.

**Estimated Time**: 1 week  
**Dependencies**: Phase 1-3 completed

---

## Implementation Checklist

### 4.1 Dashboard Metrics Service

#### ✅ Step 4.1.1: Create Dashboard Service
**File**: `apps/pim/src/services/dashboard.service.ts`

**Objectives**:
- Implement product metrics aggregation
- Provide status breakdown statistics
- Calculate daily/weekly product creation trends
- Support approval workflow metrics
- Prepare structure for WMS integration (stock levels)
- Implement top products query
- Create sales trends data structure (placeholder for Order service integration)

**Implementation Details**:
```typescript
Key Methods:
- getMetrics(): Aggregate product statistics
  - Total products count
  - Products by status (active/inactive)
  - Products by approval status (draft/pending/approved/rejected)
  - Products created today
  - Out of stock count (placeholder)

- getTopProducts(limit): Query top performing products
  - Limit to active products only
  - Exclude soft-deleted products
  - Default limit: 5

- getSalesTrends(days): Sales data over time
  - Placeholder for Order service integration
  - Returns structure: { labels: [], data: [] }
```

**Key Considerations**:
- Use SQL aggregation functions for performance
- Always filter out soft-deleted products (`isNull(productMasters.deletedAt)`)
- Use proper type casting for count results (`sql<number>` → `Number()`)
- Prepare integration points for WMS and Order services

---

#### ✅ Step 4.1.2: Create Dashboard Controller
**File**: `apps/pim/src/controllers/dashboard.controller.ts`

**Objectives**:
- Expose dashboard metrics via REST API
- Provide query parameters for customization
- Support top products with configurable limits
- Enable sales trends with custom time ranges

**Endpoints**:
1. `GET /api/pim/dashboard/metrics`
   - Returns comprehensive product statistics
   - No parameters required

2. `GET /api/pim/dashboard/top-products`
   - Query param: `limit` (optional, default: 5)
   - Returns top N products

3. `GET /api/pim/dashboard/sales-trends`
   - Query param: `days` (optional, default: 30)
   - Returns sales trend data structure

**Swagger Documentation**:
- Add `@ApiTags('Dashboard')` decorator
- Document response DTOs
- Add example responses

---

#### ✅ Step 4.1.3: Create Response DTOs
**File**: `apps/pim/src/dto/dashboard.dto.ts` (NEW)

**Objectives**:
- Type-safe response structures
- Swagger documentation support
- Clear API contracts

**DTOs to Create**:
```typescript
1. DashboardMetricsResponseDto
   - totalProducts: number
   - createdToday: number
   - outOfStock: number
   - byStatus: StatusBreakdownDto[]
   - byApproval: ApprovalBreakdownDto[]

2. StatusBreakdownDto
   - status: string
   - count: number

3. ApprovalBreakdownDto
   - approvalStatus: string
   - count: number

4. TopProductResponseDto
   - Products with key fields only
   - Exclude soft-deleted

5. SalesTrendResponseDto
   - labels: string[] (dates)
   - data: number[] (sales amounts)
```

---

#### ✅ Step 4.1.4: Register Services in Module
**File**: `apps/pim/src/pim.module.ts`

**Changes**:
- Add `DashboardService` to providers array
- Add `DashboardController` to controllers array
- Ensure `DbService` is available for injection

---

### 4.2 Testing

#### ✅ Step 4.2.1: Unit Tests
**File**: `apps/pim/src/services/dashboard.service.spec.ts` (NEW)

**Test Cases**:
```typescript
describe('DashboardService', () => {
  describe('getMetrics', () => {
    - should return total products count
    - should exclude soft-deleted products
    - should group by status correctly
    - should group by approval status correctly
    - should calculate today's products correctly
  });

  describe('getTopProducts', () => {
    - should return limited number of products
    - should only include active products
    - should exclude soft-deleted products
    - should handle custom limits
  });

  describe('getSalesTrends', () => {
    - should return correct data structure
    - should accept custom day ranges
  });
});
```

#### ✅ Step 4.2.2: E2E Tests
**File**: `apps/pim/test/dashboard.e2e-spec.ts` (NEW)

**Test Cases**:
```typescript
describe('Dashboard API (e2e)', () => {
  - GET /api/pim/dashboard/metrics should return 200
  - GET /api/pim/dashboard/top-products should return 200
  - GET /api/pim/dashboard/top-products?limit=10 should respect limit
  - GET /api/pim/dashboard/sales-trends should return 200
  - GET /api/pim/dashboard/sales-trends?days=7 should respect days param
});
```

---

### 4.3 Integration Points (Future Enhancements)

#### WMS Integration (Out of Stock Metrics)
**Objective**: Real-time stock availability data

**Approach**:
1. Create `@app/wms-client` library for inter-service communication
2. Inject WMS client into `DashboardService`
3. Query WMS inventory service for stock levels
4. Aggregate products with zero quantity
5. Cache results for performance (Redis)

**Example**:
```typescript
async getOutOfStockCount(): Promise<number> {
  const stockData = await this.wmsClient.getStockLevels();
  return stockData.filter(item => item.quantity === 0).length;
}
```

---

#### Order Service Integration (Sales Trends)
**Objective**: Historical sales data and trends

**Approach**:
1. Create `@app/order-client` library
2. Query order service for sales data
3. Group by date ranges
4. Calculate totals and trends
5. Cache frequently accessed data

**Example**:
```typescript
async getSalesTrends(days: number): Promise<SalesTrendResponseDto> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const salesData = await this.orderClient.getSalesByDateRange({
    startDate,
    endDate,
  });

  return {
    labels: salesData.map(d => d.date),
    data: salesData.map(d => d.totalAmount),
  };
}
```

---

## Implementation Steps (Ordered)

### Day 1: Core Dashboard Service
- [ ] Create `apps/pim/src/dto/dashboard.dto.ts`
- [ ] Implement all response DTOs with Swagger decorators
- [ ] Create `apps/pim/src/services/dashboard.service.ts`
- [ ] Implement `getMetrics()` method
- [ ] Implement `getTopProducts()` method
- [ ] Implement `getSalesTrends()` stub method

### Day 2: Controller & API
- [ ] Create `apps/pim/src/controllers/dashboard.controller.ts`
- [ ] Implement all three endpoints
- [ ] Add Swagger documentation
- [ ] Register service and controller in `pim.module.ts`
- [ ] Manual API testing with Postman/Insomnia

### Day 3: Unit Tests
- [ ] Create `apps/pim/src/services/dashboard.service.spec.ts`
- [ ] Write tests for `getMetrics()`
- [ ] Write tests for `getTopProducts()`
- [ ] Write tests for `getSalesTrends()`
- [ ] Achieve >80% code coverage
- [ ] Run: `npm run test:pim`

### Day 4: E2E Tests
- [ ] Create `apps/pim/test/dashboard.e2e-spec.ts`
- [ ] Write endpoint tests
- [ ] Test query parameter handling
- [ ] Test error scenarios
- [ ] Run: `npm run test:e2e:pim`

### Day 5: Documentation & Polish
- [ ] Add inline code documentation
- [ ] Update API documentation
- [ ] Create usage examples
- [ ] Performance testing with sample data
- [ ] Code review and refinements

---

## File Structure

```
apps/pim/src/
├── controllers/
│   ├── dashboard.controller.ts       [NEW]
│   └── ...
├── services/
│   ├── dashboard.service.ts          [NEW]
│   ├── dashboard.service.spec.ts     [NEW]
│   └── ...
├── dto/
│   ├── dashboard.dto.ts              [NEW]
│   └── ...
└── pim.module.ts                     [MODIFY]

apps/pim/test/
└── dashboard.e2e-spec.ts             [NEW]
```

---

## Testing Strategy

### Unit Tests
**Command**: `npm run test:pim -- dashboard.service.spec.ts`

**Coverage Goals**:
- Methods: 100%
- Branches: >80%
- Lines: >90%

### E2E Tests
**Command**: `npm run test:e2e:pim -- dashboard.e2e-spec.ts`

**Test Data**:
- Use test database with seed data
- Minimum 50 products with various statuses
- Include soft-deleted products to verify filters

### Manual Testing
**Endpoints to Test**:
```bash
# Get metrics
curl http://localhost:3001/api/pim/dashboard/metrics

# Get top 10 products
curl http://localhost:3001/api/pim/dashboard/top-products?limit=10

# Get 7-day sales trends
curl http://localhost:3001/api/pim/dashboard/sales-trends?days=7
```

---

## Performance Considerations

### Database Optimization
1. **Indexes** (already exist from Phase 1):
   - `idx_masters_deleted_at` on `product_masters.deletedAt`
   - `idx_masters_status` on `product_masters.status`
   - `idx_masters_approval_status` on `product_masters.approvalStatus`

2. **Query Optimization**:
   - Use COUNT(*) aggregations
   - Minimize JOIN operations
   - Filter early with WHERE clauses

### Caching Strategy (Future)
```typescript
@Injectable()
export class DashboardService {
  constructor(
    private db: DbService,
    @Inject('REDIS') private redis: Redis, // Future
  ) {}

  async getMetrics() {
    const cacheKey = 'dashboard:metrics';
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const metrics = await this.calculateMetrics();
    await this.redis.setex(cacheKey, 300, JSON.stringify(metrics)); // 5 min cache
    
    return metrics;
  }
}
```

---

## API Response Examples

### GET /api/pim/dashboard/metrics
```json
{
  "totalProducts": 1250,
  "createdToday": 15,
  "outOfStock": 0,
  "byStatus": [
    { "status": "active", "count": 980 },
    { "status": "inactive", "count": 270 }
  ],
  "byApproval": [
    { "approvalStatus": "approved", "count": 1100 },
    { "approvalStatus": "pending", "count": 50 },
    { "approvalStatus": "draft", "count": 80 },
    { "approvalStatus": "rejected", "count": 20 }
  ]
}
```

### GET /api/pim/dashboard/top-products?limit=3
```json
[
  {
    "id": "01JCQX...",
    "name": "Premium T-Shirt",
    "brand": "BrandX",
    "basePrice": 29900,
    "status": "active"
  },
  {
    "id": "01JCQY...",
    "name": "Classic Jeans",
    "brand": "BrandY",
    "basePrice": 79900,
    "status": "active"
  },
  {
    "id": "01JCQZ...",
    "name": "Sport Shoes",
    "brand": "BrandZ",
    "basePrice": 129900,
    "status": "active"
  }
]
```

### GET /api/pim/dashboard/sales-trends?days=7
```json
{
  "labels": [],
  "data": []
}
```
*Note: Placeholder until Order service integration*

---

## Success Criteria

- [ ] All dashboard endpoints return 200 OK
- [ ] Metrics accurately reflect database state
- [ ] Soft-deleted products are excluded from all counts
- [ ] Query parameters work correctly
- [ ] Unit test coverage >80%
- [ ] E2E tests pass 100%
- [ ] Swagger documentation is complete
- [ ] Response times <200ms for metrics endpoint
- [ ] No N+1 query issues
- [ ] TypeScript compilation has no errors

---

## Known Limitations & Future Work

### Current Limitations
1. **Out of Stock Count**: Hardcoded to 0 (requires WMS integration)
2. **Sales Trends**: Returns empty structure (requires Order service integration)
3. **Top Products**: Based on status only, not actual sales data

### Future Enhancements
1. **Real-time Updates**: WebSocket support for live metrics
2. **Custom Date Ranges**: Advanced filtering for metrics
3. **Product Performance**: Sales velocity, conversion rates
4. **Category Analytics**: Metrics per category
5. **Comparative Analytics**: Month-over-month, year-over-year trends
6. **Export Functionality**: Download metrics as PDF/Excel
7. **Alerts**: Threshold-based notifications (low stock, approval delays)

---

## Rollback Plan

If Phase 4 needs to be rolled back:

1. **Remove New Files**:
   ```bash
   rm apps/pim/src/services/dashboard.service.ts
   rm apps/pim/src/services/dashboard.service.spec.ts
   rm apps/pim/src/controllers/dashboard.controller.ts
   rm apps/pim/src/dto/dashboard.dto.ts
   rm apps/pim/test/dashboard.e2e-spec.ts
   ```

2. **Revert Module Changes**:
   - Remove `DashboardService` from providers
   - Remove `DashboardController` from controllers
   - Restore `pim.module.ts` to previous commit

3. **No Database Changes**: Phase 4 requires no schema changes

---

## Questions & Considerations

### Before Starting Implementation
- [ ] Should metrics include archived/deleted products as a separate count?
- [ ] Do we need real-time metrics, or is 5-minute caching acceptable?
- [ ] Should top products be based on creation date, price, or placeholder for future sales data?
- [ ] Do we need role-based access control for dashboard endpoints?
- [ ] Should we implement rate limiting for dashboard API calls?

### During Implementation
- Monitor query performance with EXPLAIN ANALYZE
- Consider pagination for top products if list grows large
- Validate date range inputs to prevent performance issues

---

## Next Phase Planning

After Phase 4 completion, consider:

1. **Authentication & Authorization**
   - JWT token validation
   - Role-based access control (RBAC)
   - API key management

2. **Service Integration**
   - WMS client library
   - Order service client library
   - Event-driven architecture (Kafka/RabbitMQ)

3. **Frontend Dashboard**
   - React/Vue components
   - Chart.js/D3.js visualizations
   - Real-time updates

---

## Contact & Support

- **Phase Owner**: PIM Team
- **Estimated Completion**: End of Week 5
- **Blockers**: None (no dependencies on other services for basic implementation)

---

**Last Updated**: 2025-10-28  
**Status**: Ready for Implementation

