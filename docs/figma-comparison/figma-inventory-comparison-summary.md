# Figma Design vs Backend Implementation - Inventory Module Comparison

**Analysis Date**: 2025-10-13
**Analyzed Screens**: 17 inventory-related Figma designs
**Backend Codebase**: almondyoung-server WMS module

---

## Executive Summary

This document provides a comprehensive comparison between the Figma design requirements and the current backend implementation for the inventory management module. The analysis reveals **significant gaps** requiring approximately **8-12 weeks of development effort** across multiple feature areas.

### Overall Assessment

| Category | Design Coverage | Backend Coverage | Gap Severity |
|----------|----------------|------------------|--------------|
| **Inventory Status Inquiry** | 100% | ~40% | 🔴 HIGH |
| **SKU Management** | 100% | ~40% | 🔴 HIGH |
| **Inbound & Purchase** | 100% | ~70% | 🟡 MEDIUM |
| **Barcode Management** | 100% | ~20% | 🔴 HIGH |
| **Sales Product Creation** | 100% | ~60% | 🟡 MEDIUM |
| **Stocktaking** | 100% | ~0% | 🔴 CRITICAL |

**Overall Implementation Gap**: ~55% (missing over half of required features)

---

## Detailed Feature Comparison

### 1. Inventory Status Inquiry (재고현황 목록)

**Figma Requirements** (from 3 screenshots):
- Multi-field filtering (product type, supplier, date range, display mode)
- Safety stock alerts and warnings
- Multi-tier pricing display (4 price tiers)
- Supplier external links
- Barcode generation
- Bulk operations (adjust, inbound, outbound, PDF export)
- 1-month sales volume tracking
- Location tracking with codes
- Status badges and indicators
- Real-time stock updates

**Backend Implementation Status**:

✅ **Implemented (40%)**:
- Basic stock query API: `GET /wms/inventory/stocks`
- Stock summary API: `GET /wms/inventory/stocks/summary`
- Stock history: `GET /wms/inventory/stocks/history`
- Manual adjustments: `POST /wms/inventory/stocks/adjust`
- SKU search with basic filters

❌ **Missing (60%)**:
- Safety stock field in `skus` table (CRITICAL - shown as required in UI)
- Multi-tier pricing (retail, wholesale, special sale prices)
- 1-month sales volume aggregation endpoint
- Display mode filtering (below safety, with stock, etc.)
- Supplier external link management
- Location-based inventory tracking
- Bulk operations API endpoints
- PDF export functionality
- Safety stock warning system
- Advanced filtering (30+ filter combinations shown in UI)

**Files Reviewed**:
- `/apps/wms/src/inventory/controllers/inventory.controller.ts` - Has basic CRUD
- `/apps/wms/src/inventory/dto/inventory/get-stock-query.dto.ts` - Limited filters
- `/apps/wms/database/schemas/wms-schema.ts:286-300` - SKU schema missing fields

**Required Schema Changes**:
```typescript
// Add to skus table:
safetyStock: integer('safety_stock').default(0),
retailPrice: integer('retail_price'),
wholesalePrice: integer('wholesale_price'),
specialSalePrice: integer('special_sale_price'),
primaryLocationId: uuid('primary_location_id'),
secondaryLocationId: uuid('secondary_location_id'),
expiryDateManagement: boolean('expiry_date_management').default(false),
```

---

### 2. SKU Management (재고상품 등록/수정)

**Figma Requirements** (from 4 screenshots):
- Comprehensive SKU creation form with 50+ fields:
  - Physical properties (weight, dimensions, material)
  - Business info (Korean name, import declaration number)
  - Multi-tier pricing
  - Safety stock (REQUIRED)
  - Location assignments (primary + secondary)
  - Manager assignments (3 roles: designer, purchase, registration)
  - Main image URL
  - Variant grouping
- SKU option/variant management as separate entities
- Option matrix table with inline editing
- Barcode scanning for location moves
- Movement history tracking

**Backend Implementation Status**:

✅ **Implemented (40%)**:
- Basic SKU CRUD: `POST/GET/PUT/DELETE /wms/inventory/skus`
- Barcode management: `POST /wms/inventory/skus/:id/barcodes`
- Master product relationships
- Option key storage (jsonb field)
- Stock type enum
- Sales volume fields (1m, 3m)

❌ **Missing (60%)**:
- Extended SKU metadata (15+ fields):
  - `productWeight`, `dimensionWidth/Height/Depth`
  - `productMaterial`, `businessProductName`
  - `importDeclarationNumber`, `koreanName`
  - `mainImageUrl`, `discount`, `moq`
  - `memo2`, `memo3`, `logisticsPartnerId`
- **Safety stock field (CRITICAL - UI shows as REQUIRED)**
- Multi-tier pricing fields
- Location tracking (primary/secondary)
- Manager assignments
- Variant/option management as first-class entities
- Option-specific inventory tracking
- Location movement APIs with barcode scanning
- Image management
- Variant group code linkage

**Files Reviewed**:
- `/apps/wms/src/inventory/dto/sku/create-sku.dto.ts` - Only 10 fields
- `/apps/wms/database/schemas/wms-schema.ts:286` - Basic SKU schema

**Required New Tables**:
```typescript
// 1. Multi-tier pricing
export const skuVariantPricing = pgTable('sku_variant_pricing', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    retailPrice: integer('retail_price'),
    wholesalePrice: integer('wholesale_price'),
    specialSalePrice: integer('special_sale_price'),
    effectiveFrom: timestamp('effective_from'),
});

// 2. Manager assignments
export const skuManagers = pgTable('sku_managers', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    designManagerId: uuid('design_manager_id'),
    purchaseManagerId: uuid('purchase_manager_id'),
    registrationManagerId: uuid('registration_manager_id'),
});

// 3. Location movement history
export const skuLocationMovements = pgTable('sku_location_movements', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    fromLocationId: uuid('from_location_id'),
    toLocationId: uuid('to_location_id').notNull(),
    quantity: integer('quantity').notNull(),
    movedBy: uuid('moved_by'),
    movedAt: timestamp('moved_at').defaultNow(),
    barcode: varchar('barcode', { length: 64 }),
});
```

**Required API Endpoints** (20+ new endpoints):
```
POST   /wms/inventory/skus/:id/options          - Add option
GET    /wms/inventory/skus/:id/options          - List options
PUT    /wms/inventory/skus/:id/options/:optionId - Update option
DELETE /wms/inventory/skus/:id/options/:optionId - Delete option
POST   /wms/inventory/skus/move-location        - Move SKU location
POST   /wms/inventory/skus/bulk-move-location   - Bulk move
GET    /wms/inventory/skus/:id/location-history - Movement history
PUT    /wms/inventory/skus/:id/pricing          - Update pricing
PUT    /wms/inventory/skus/:id/managers         - Update managers
POST   /wms/inventory/skus/:id/generate-barcode - Auto-generate barcode
```

---

### 3. Inbound & Purchase Management

**Figma Requirements** (from 4 screenshots):
- Purchase cart management ✅ (IMPLEMENTED)
- Purchase order creation from cart ✅ (IMPLEMENTED)
- Inbound list management with status workflow
- Barcode printing queue system
- Immediate receive operations
- Apply inbound workflow
- Audit workflow (draft → pending_audit → approved)
- MOQ validation
- Safety stock warnings in cart

**Backend Implementation Status**:

✅ **Implemented (70%)**:
- Cart CRUD: `POST/GET/PUT/DELETE /wms/purchase-orders/cart` ✅
- Create PO from cart: `POST /wms/purchase-orders/from-cart` ✅
- Reorder suggestions: `GET /wms/purchase-orders/suggestions/reorder` ✅
- Purchase order schema with proper relationships ✅
- Inbound receipt creation ✅
- Stock event integration ✅

❌ **Missing (30%)**:
- **Inbound Lists Controller** (HIGH PRIORITY)
- Status enum extensions:
  - `inboundStatusEnum` needs: 'applied', 'receiving'
  - New `poAuditStatusEnum`: 'draft', 'pending_audit', 'approved', 'rejected'
- Audit workflow endpoints (submit, approve, reject)
- Barcode print queue system
- MOQ validation in supplier schema
- Safety stock validation service

**Files Reviewed**:
- `/apps/wms/src/inbound/controllers/purchase-order.controller.ts` ✅
- `/apps/wms/database/schemas/wms-schema.ts:99-101` - Enum extensions needed

**Required Endpoints** (HIGH PRIORITY):
```
GET    /wms/inbound/lists              - List with filtering
GET    /wms/inbound/lists/:id          - Detail view
POST   /wms/inbound/lists/:id/apply    - Apply inbound
POST   /wms/inbound/lists/:id/receive  - Immediate receive
GET    /wms/inbound/lists/:id/barcode  - Generate barcode

PUT    /wms/purchase-orders/:id/submit-for-audit
PUT    /wms/purchase-orders/:id/approve
PUT    /wms/purchase-orders/:id/reject
GET    /wms/suppliers/:id/moq-rules
```

**Effort Estimate**: 10-15 developer days

---

### 4. Barcode Management

**Figma Requirements** (from 2 screenshots):
- Product barcode listing with search/filter
- Print queue management
- Location barcode creation (format: A-01-02)
- Batch printing capabilities
- Print job tracking (pending, printing, completed, failed)
- Barcode generation (CODE128, QR codes)

**Backend Implementation Status**:

✅ **Implemented (20%)**:
- SKU barcode add/remove: `POST/DELETE /wms/inventory/skus/:id/barcodes`
- `skuBarcodes` table exists in schema

❌ **Missing (80%)**:
- Barcode print queue table
- Print job management
- Location barcode system (NEW TABLE NEEDED)
- Barcode generation service (CODE128/QR)
- Print queue APIs
- Barcode scanning operations

**Required New Tables**:
```typescript
// 1. Location barcodes
export const locationBarcodes = pgTable('location_barcodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').references(() => locations.id).notNull(),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull().unique(),
    format: varchar('format', { length: 20 }).default('CODE128'),
    generatedAt: timestamp('generated_at').defaultNow(),
    generatedBy: uuid('generated_by'),
});

// 2. Print jobs
export const barcodePrintJobs = pgTable('barcode_print_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    inboundListId: uuid('inbound_list_id').references(() => inboundLists.id),
    skuId: uuid('sku_id').references(() => skus.id),
    locationId: uuid('location_id').references(() => locations.id),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull(),
    status: printJobStatusEnum('status').default('pending'),
    printerName: varchar('printer_name', { length: 100 }),
    copies: integer('copies').default(1),
    printedAt: timestamp('printed_at'),
    printedBy: uuid('printed_by'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const printJobStatusEnum = pgEnum('print_job_status', [
    'pending', 'printing', 'completed', 'failed'
]);
```

**Required APIs**:
```
POST   /wms/barcode/print-jobs           - Create print job
GET    /wms/barcode/print-jobs           - List queue
PUT    /wms/barcode/print-jobs/:id       - Update status
POST   /wms/barcode/generate             - Generate barcode image
POST   /wms/locations/:id/generate-barcode - Generate location barcode
```

**Effort Estimate**: 5-7 developer days

---

### 5. Sales Product Creation (재고상품 입력)

**Figma Requirements** (from 2 screenshots):
- Multi-step product creation wizard
- Automatic variant generation from option matrix
- Product-SKU matching workflow
- Multi-channel sales configuration
- Return policy management (domestic vs overseas)
- Unit/packaging information
- MOQ tracking per variant
- Immutable option structure (cannot edit after creation)

**Backend Implementation Status**:

✅ **Implemented (60%)**:
- PIM schema support (product masters, variants, options)
- Product matching system
- SKU creation from matching
- Sales channel enum

❌ **Missing (40%)**:
- Option matrix UI → variant generation logic
- Multi-channel sales configuration per SKU
- Return policy fields (domestic/overseas rules)
- Packaging/unit information fields
- MOQ per variant tracking
- Product-SKU matching wizard API
- Sales channel mapping enhancements

**Required Enhancements**:
```typescript
// Add to skus table:
returnPolicyDomestic: json('return_policy_domestic'),
returnPolicyOverseas: json('return_policy_overseas'),
unitInfo: json('unit_info'), // packaging, box size, etc.
moq: integer('moq'), // per-variant MOQ

// New table for sales channel config
export const skuSalesChannels = pgTable('sku_sales_channels', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    channel: salesChannelEnum('channel').notNull(),
    isActive: boolean('is_active').default(true),
    channelSkuId: varchar('channel_sku_id', { length: 100 }),
    channelProductUrl: varchar('channel_product_url', { length: 500 }),
});
```

**Effort Estimate**: 3-4 developer days

---

### 6. Stocktaking (상품 위치 이력)

**Figma Requirements** (from 1 screenshot):
- Physical inventory counting interface
- Barcode scanning for location and products
- Discrepancy detection (expected vs actual)
- Automatic adjustment generation via event sourcing
- Stocktaking session management
- Count line tracking
- Variance reporting

**Backend Implementation Status**:

✅ **Implemented (0%)**:
- None - completely missing feature

❌ **Missing (100%)**:
- Stocktaking session management
- Count line recording
- Discrepancy calculation
- Auto-adjustment generation
- Barcode scanning integration
- Variance reports
- All related tables and APIs

**Required New Tables**:
```typescript
export const stocktakingStatusEnum = pgEnum('stocktaking_status', [
    'draft', 'in_progress', 'completed', 'cancelled'
]);

export const stocktakingSessions = pgTable('stocktaking_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
    status: stocktakingStatusEnum('status').default('draft'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    startedBy: uuid('started_by'),
    notes: text('notes'),
});

export const stocktakingLines = pgTable('stocktaking_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => stocktakingSessions.id).notNull(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    locationId: uuid('location_id').references(() => locations.id),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    variance: integer('variance'),
    scannedBarcode: varchar('scanned_barcode', { length: 64 }),
    countedAt: timestamp('counted_at'),
    countedBy: uuid('counted_by'),
});

export const stocktakingAdjustments = pgTable('stocktaking_adjustments', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => stocktakingSessions.id).notNull(),
    lineId: uuid('line_id').references(() => stocktakingLines.id).notNull(),
    stockEventId: uuid('stock_event_id').references(() => stockEvents.id),
    adjustmentQuantity: integer('adjustment_quantity').notNull(),
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
});
```

**Required APIs** (Complete module):
```
POST   /wms/stocktaking/sessions          - Create session
GET    /wms/stocktaking/sessions          - List sessions
GET    /wms/stocktaking/sessions/:id      - Get session detail
PUT    /wms/stocktaking/sessions/:id/start - Start counting
PUT    /wms/stocktaking/sessions/:id/complete - Complete session

POST   /wms/stocktaking/sessions/:id/lines - Add count line
PUT    /wms/stocktaking/lines/:id         - Update count
POST   /wms/stocktaking/lines/:id/scan    - Barcode scan

GET    /wms/stocktaking/sessions/:id/variances - Variance report
POST   /wms/stocktaking/sessions/:id/generate-adjustments - Auto-generate
```

**Effort Estimate**: 7-9 developer days (CRITICAL FEATURE)

---

## Implementation Priority Matrix

### Critical Path (Phase 1): Weeks 1-3
**Total Effort**: 15-20 days

1. **Safety Stock Implementation** (2 days) 🔴
   - Add `safetyStock` field to `skus` table
   - Update CreateSkuDto and UpdateSkuDto
   - Add validation and default values
   - Migration script

2. **Inbound Lists Management** (4-5 days) 🔴
   - Create InboundListController
   - Implement service methods
   - Status enum extensions
   - Apply/receive workflows

3. **Stocktaking Module** (7-9 days) 🔴
   - Create 3 new tables
   - Implement full CRUD
   - Barcode scanning integration
   - Variance detection and auto-adjustments

### High Priority (Phase 2): Weeks 4-6
**Total Effort**: 18-22 days

4. **SKU Extended Metadata** (5-6 days) 🟡
   - Add 30+ missing fields to schema
   - Update DTOs
   - Migration with default values
   - Update service layer

5. **Multi-tier Pricing** (3-4 days) 🟡
   - Create pricing table
   - Implement pricing APIs
   - Integration with inventory status query

6. **Location Management Enhancement** (3-4 days) 🟡
   - Primary/secondary location fields
   - Movement tracking table
   - Location move APIs
   - History endpoints

7. **Barcode System** (5-7 days) 🟡
   - Print queue implementation
   - Location barcode table
   - Generation service (CODE128/QR)
   - Print job tracking

### Medium Priority (Phase 3): Weeks 7-9
**Total Effort**: 12-15 days

8. **Option/Variant Management** (4-5 days) 🟢
   - Option CRUD as first-class entities
   - Variant group linkage
   - Option-specific inventory

9. **Purchase Audit Workflow** (3-4 days) 🟢
   - Audit status enum
   - Submit/approve/reject endpoints
   - Audit history tracking

10. **Manager Assignments** (2-3 days) 🟢
    - Manager table
    - Assignment APIs
    - Role-based logic

11. **Sales Product Enhancements** (3-4 days) 🟢
    - Multi-channel config
    - Return policy fields
    - MOQ tracking

### Low Priority (Phase 4): Weeks 10-12
**Total Effort**: 8-10 days

12. **Advanced Filtering** (3-4 days) 🟢
    - 30+ filter combinations
    - Performance optimization
    - Indexed queries

13. **Reporting & Export** (3-4 days) 🟢
    - PDF generation
    - Excel export
    - Custom reports

14. **Testing & Polish** (2-3 days) 🟢
    - Unit tests
    - Integration tests
    - Documentation

---

## Database Migration Summary

### Schema Changes Required

**Tables to Modify** (3):
1. `skus` - Add 35+ fields
2. `suppliers` - Add MOQ/lead time fields
3. `purchase_orders` - Add audit workflow columns

**New Tables to Create** (8):
1. `sku_variant_pricing` - Multi-tier pricing
2. `sku_managers` - Personnel assignments
3. `sku_location_movements` - Movement history
4. `location_barcodes` - Location barcode management
5. `barcode_print_jobs` - Print queue
6. `stocktaking_sessions` - Stocktaking header
7. `stocktaking_lines` - Count lines
8. `stocktaking_adjustments` - Auto-adjustments

**Enums to Add/Extend** (5):
1. `inbound_status` - Add 'applied', 'receiving'
2. `po_audit_status` - NEW: draft, pending_audit, approved, rejected
3. `print_job_status` - NEW: pending, printing, completed, failed
4. `stocktaking_status` - NEW: draft, in_progress, completed, cancelled
5. `sku_sales_channels` - Extend for channel mapping

---

## API Endpoint Summary

**Total New Endpoints Required**: ~60

### By Category:
- **Inventory Status**: 8 new endpoints
- **SKU Management**: 20+ new endpoints (options, pricing, managers, location)
- **Inbound Lists**: 5 critical endpoints
- **Barcode Management**: 6 new endpoints
- **Stocktaking**: 10+ new endpoints (complete module)
- **Purchase Audit**: 3 new endpoints
- **Sales Product**: 4 enhancement endpoints
- **Reporting**: 4 export endpoints

---

## Risk Assessment

### High Risk Areas 🔴

1. **Safety Stock Missing**: UI treats as REQUIRED but field doesn't exist
   - **Impact**: Data integrity issues, UI errors
   - **Mitigation**: Add field with default value, update all DTOs

2. **Stocktaking Completely Missing**: Critical operational feature
   - **Impact**: Cannot perform physical inventory counts
   - **Mitigation**: Prioritize in Phase 1, allocate senior dev

3. **Status Enum Mismatches**: UI shows statuses not in backend
   - **Impact**: Status transitions will fail
   - **Mitigation**: Extend enums carefully with migrations

### Medium Risk Areas 🟡

4. **Breaking Changes**: Adding 35+ fields to SKU schema
   - **Impact**: Existing APIs may break
   - **Mitigation**: Careful migration, backward compatibility

5. **Performance**: 30+ filter combinations on large datasets
   - **Impact**: Slow queries, poor UX
   - **Mitigation**: Proper indexing, pagination, caching

### Low Risk Areas 🟢

6. **Optional Enhancements**: Reporting, exports, advanced features
   - **Impact**: Nice-to-have features
   - **Mitigation**: Implement in later phases

---

## Testing Requirements

### Unit Tests (Est. 3-4 days)
- All new service methods
- Enum validation logic
- Business rule enforcement
- ~150 new test cases

### Integration Tests (Est. 2-3 days)
- Complete workflows (cart → PO → inbound → receipt)
- Status transition validation
- Event sourcing integrity
- Transaction rollback scenarios
- ~40 test scenarios

### E2E Tests (Est. 2 days)
- UI-critical paths
- Barcode scanning workflows
- Stocktaking complete cycle
- ~20 test flows

---

## Effort Summary

| Phase | Features | Developer Days | Weeks |
|-------|----------|----------------|-------|
| **Phase 1 (Critical)** | Safety stock, Inbound lists, Stocktaking | 15-20 days | 3 weeks |
| **Phase 2 (High)** | SKU metadata, Pricing, Location, Barcode | 18-22 days | 3-4 weeks |
| **Phase 3 (Medium)** | Options, Audit, Managers, Sales | 12-15 days | 2-3 weeks |
| **Phase 4 (Low)** | Filtering, Reports, Testing | 8-10 days | 2 weeks |
| **TOTAL** | All features | **53-67 days** | **10-12 weeks** |

**Assumptions**:
- 1 senior backend developer full-time
- Assumes no major blockers or scope changes
- Testing time included in each phase
- Documentation ongoing throughout

---

## Recommendations

### Immediate Actions (This Week)

1. ✅ **Add Safety Stock Field**
   ```sql
   ALTER TABLE skus ADD COLUMN safety_stock INTEGER DEFAULT 0 NOT NULL;
   ```

2. ✅ **Create Stocktaking Tables**
   - Run migration for 3 new tables
   - Set up basic CRUD operations

3. ✅ **Implement Inbound Lists Controller**
   - Create controller file
   - Add 5 critical endpoints
   - Extend status enums

### Short-Term (Next 2 Weeks)

4. **Extend SKU Schema**
   - Add 30+ missing fields with migrations
   - Update all DTOs
   - Add validation logic

5. **Barcode System**
   - Implement print queue
   - Add location barcode table
   - Create generation service

### Medium-Term (Weeks 3-6)

6. **Option/Variant Management**
   - First-class option entities
   - Variant grouping
   - Option-specific inventory

7. **Multi-tier Pricing**
   - Pricing table
   - Price history
   - Integration with inventory query

### Long-Term (Weeks 7-12)

8. **Advanced Features**
   - Complex filtering
   - Reporting & exports
   - Audit workflows
   - Performance optimization

---

## Conclusion

The Figma design reveals a comprehensive inventory management system with **~55% implementation gap**. The most critical missing pieces are:

1. **Safety Stock** (REQUIRED in UI, missing in backend)
2. **Stocktaking Module** (100% missing, operationally critical)
3. **Inbound Lists Management** (UI complete, no backend)
4. **Extended SKU Metadata** (35+ fields missing)

The estimated effort of **10-12 weeks** assumes a dedicated senior developer and follows the phased approach outlined above. Early focus on critical path items (safety stock, stocktaking, inbound lists) will unblock the frontend team and enable core business operations.

---

**Document References**:
- Detailed analysis files created during this review:
  - `/docs/figma-design-verification.md` - Inventory status & inbound analysis
  - Additional agent reports (SKU management, barcode, stocktaking)

**Backend Source Files Reviewed**:
- `/apps/wms/database/schemas/wms-schema.ts` - Schema definitions
- `/apps/wms/src/inventory/controllers/inventory.controller.ts` - Current APIs
- `/apps/wms/src/inventory/dto/sku/create-sku.dto.ts` - DTO limitations
- `/apps/wms/src/inbound/controllers/purchase-order.controller.ts` - Purchase APIs

**Figma Screenshots Analyzed**: 17 files in `/almondyoung-figma-png/inventory/`
