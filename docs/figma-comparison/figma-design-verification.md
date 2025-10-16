# Figma Design UI Requirements Analysis

This document provides a comprehensive analysis of the UI requirements extracted from Figma design screenshots for the Almondyoung inventory management system.

## Table of Contents
1. [Screen 1: Create Sales Product Form (Part 1)](#screen-1-create-sales-product-form-part-1)
2. [Screen 2: Create Sales Product Form (Part 2)](#screen-2-create-sales-product-form-part-2)
3. [Screen 3: Purchase Inquiry (Wholesale List)](#screen-3-purchase-inquiry-wholesale-list)
4. [Screen 4: Purchase Cart Inquiry](#screen-4-purchase-cart-inquiry)
5. [API Endpoints Summary](#api-endpoints-summary)
6. [Database Schema Alignment](#database-schema-alignment)

---

## Screen 1: Create Sales Product Form (Part 1)

**File:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/create-sales-product-form-1.png`

### Screen Purpose
Create a new sales product (판매상품 생성) with comprehensive product information including basic details, options, and pricing strategies.

### Form Fields

#### Basic Product Information Section

| Field Name (Korean) | Field Name (English) | Type | Required | Validation Rules | Notes |
|---------------------|----------------------|------|----------|------------------|-------|
| 상품 구분 | Product Type | Dropdown/Select | Yes | - | Options: 상품 구분 |
| 사업자명칭 | Business Name | Text | No | - | Placeholder: 사업자명칭 선택 |
| 공급사(업체주체) | Supplier | Dropdown | Yes | - | Multiple options |
| 수입신고필 | Import Declaration | Dropdown | No | - | Placeholder: 의뢰인 |
| 수입신고번호 | Import Declaration Number | Text | No | - | - |
| 분류 | Category | Text | No | - | With search/filter functionality |

#### Option Management Section (옵션)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| 번호 | Number | Auto | Row number (1-4 shown) |
| 옵션상세명칭 | Text | Yes | Format: "JXJ3775mm" placeholder |
| 옵션상세이미지 | Image | No | Image upload button |
| 판가 | Number | Yes | Selling price in KRW |

**Option Controls:**
- Add option row button (+ button)
- Delete option row button (trash icon)
- Default 4 rows shown
- Support for dynamic row addition

#### Production Information Section (상품설명)

| Field Name | Type | Required | Max Length | Notes |
|------------|------|----------|------------|-------|
| MOQ | Number | No | - | Minimum Order Quantity |
| 제조1 | Text | No | - | Manufacturing info 1 |
| 제조2 | Text | No | - | Manufacturing info 2 |
| 제조3 | Text | No | - | Manufacturing info 3 |

#### Action Buttons
- **자동 생성 버튼** (Auto Generate Button) - Primary action button in orange/yellow
- Cancel/Back navigation available

### Multi-Step Form Flow
This appears to be **Step 1 of 2** in the product creation process.

### Right Panel - Process Guidelines

The right panel shows three main sections:

1. **제고 생성(자동)** (Inventory Creation - Auto)
   - Description of automated inventory creation
   - Lists sub-processes

2. **상품 매칭** (Product Matching)
   - Product matching criteria
   - Matching strategies

3. **수발주구분 select box** (Purchase/Order Classification)
   - Lists selection options (상품/거래/거래처적정)
   - Links to supplier management

4. **출처** (Source)
   - Source verification information

5. **수입신고필/분조** (Import Declaration)
   - Import declaration requirements

---

## Screen 2: Create Sales Product Form (Part 2)

**File:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/create-sales-product-form-2.png`

### Screen Purpose
Second step of product creation showing template options and pricing strategy configuration.

### Template Selection Section (판매 생성 템플릿 선택)

Shows multiple template selection cards with information:

#### Template Information Display
Each template card contains:
- **Title**: Template name
- **Description**: Brief description
- **Details**: 2-3 lines of specifications
- **Action Button**: "적용하기" (Apply) button

### Pricing Strategy Section (제고생성)

Shows two options with radio selection:

#### Option 1: 특송
- **Option type**: Radio button
- **Display format**: Grid/list of variants
- **Sub-options**:
  - "노랑: 현장 결제 선택시 새롭 (Size M & Others)"
  - Multiple entries with pricing

#### Option 2: 옵션 없이 판매시세
- Simplified option without variants
- Single product without option differentiation

### Product Detail Section (제고상장)

Preview table showing:

| Column | Type | Notes |
|--------|------|-------|
| 품목 | Text | Product name |
| 제고명분 | Text | Inventory name |
| 공급처 | Text | Supplier |

### Bottom Section - Template Examples

Shows multiple template configuration examples:
- Template cards with specifications
- Configuration details
- Apply buttons for each template

### Action Buttons
- **제고 생성 버튼** (Create Inventory) - Primary action
- **이전 단계로** (Previous Step) - Navigation
- **제조시장 단계** (Manufacturing Stage) - Navigation

---

## Screen 3: Purchase Inquiry (Wholesale List)

**File:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/purchase-inquery.png`

### Screen Purpose
View and search wholesale products (발주리스트 조회) with filtering capabilities.

### Navigation & Breadcrumb
- **Path**: 홈 > 제고/상품 > 발주 > 발주리스트 조회
- **Title**: 재고&상품 (Inventory & Products)

### Search & Filter Section

#### Filter Fields

| Field Name (Korean) | Field Name (English) | Type | Options | Notes |
|---------------------|----------------------|------|---------|-------|
| 발자 | Requester | Dropdown | 발주 번호 options | Search by requester |
| 검색항목 | Search Category | Dropdown | 품목 명칭 options | Category dropdown |
| 신청시점 | Application Time | Dropdown | 발주 일자와 신매 options | Time range |
| | Start Date | Date Picker | - | 2025-06-20 format |
| | End Date | Date Picker | - | 2025-06-20 format |

**Quick Filter Tabs:**
- 오늘 (Today)
- 어제 (Yesterday)
- 일주일 (Week)
- 전월 (Last Month)
- 3개월 (3 Months)
- 접수기간 (Reception Period)

**Action Buttons:**
- **검색** (Search) - Primary button (orange)
- Bulk action buttons
- Export options

### Product List Table

#### Table Columns

| Column Name (Korean) | Column Name (English) | Type | Sortable | Notes |
|---------------------|----------------------|------|----------|-------|
| 제조 | Checkbox | Checkbox | No | Multi-select |
| 배조드 번호 | Barcode Number | Text | Yes | Product barcode |
| | Image | Image | No | Product thumbnail |
| 이미지 | Product Name | Link | Yes | Clickable name |
| 상품명 | | | | |
| 발주처 | Supplier | Text | Yes | Supplier name |
| 발주 날짜 | Order Date | Date | Yes | Format: 2025-07-29 |
| 알고리즘일 | Algorithm Date | Date | Yes | Format: 2025-07-30 |
| 판가 | Selling Price | Number | Yes | Format: 2,200원 |
| 발주 수량 | Order Quantity | Number | Yes | Integer |
| 발주상태명 | Status | Badge | Yes | Status: 미발주/진행중/완료 |
| 입고검수명 | Inspection Status | Badge | Yes | Status indicator |
| 기능 | Actions | Button Group | No | 사본/발주수정/입고검 buttons |

#### Row Actions
Each row has three action buttons:
- **사본** (Copy) - Copy row data
- **발주 수정** (Edit Order) - Edit order
- **입고 검** (Inspection) - Inspection action

#### Pagination
- Display: "레이지생이다" (Pagination indicator)
- Shows total count

### Right Panel - Process Information

Shows the verification checklist with sections:

1. **발주리스트 확인** (Purchase List Confirmation)
   - Confirmation workflow details
   - Step-by-step process

2. **일고리스트 아래 발주리스트 확인 및 가능여 수강** (Order List Verification)
   - List verification procedures
   - Quality check process

---

## Screen 4: Purchase Cart Inquiry

**File:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/purchase-cart-inquery.png`

### Screen Purpose
Manage purchase cart items (발주대기리스트 생성) - items staged for purchase order creation.

### Navigation
- **Path**: 홈 > 제고/상품 > 발주 > 발주리스트 생성
- **Title**: 재고&상품 (Inventory & Products)

### Alert/Notice Banner
**Red background warning banner:**
- Text: "안정재고 미만 상품 50개" (50 items below safety stock)
- Prominent display at top

### Filter Section

| Field | Type | Options | Notes |
|-------|------|---------|-------|
| 검색항목 | Dropdown | 검색 종류 | Search category |
| 신청시점 | Dropdown | 발주 일자 | Application time |

**Action Buttons:**
- Primary search button (orange)
- "+ 발주 상품 추가" (Add Purchase Product) - Secondary action button

### Cart Items Table

#### Table Structure

| Column Name (Korean) | Column Name (English) | Type | Editable | Notes |
|---------------------|----------------------|------|----------|-------|
| 제조 | Checkbox | Checkbox | No | Multi-select |
| 배조드 번호 | Barcode Number | Text | No | Product identifier |
| | Image | Image | No | Product thumbnail |
| 이미지 | Product Name | Link | No | Product details |
| 상품명 | | | | |
| 상품명 | Category | Text | No | - |
| 재고/공급처계 | Inventory Status | Number | No | Current stock/supply |
| 제조 | Supplier | Text | No | - |
| 신청수량 | Requested Quantity | Text | Yes | Dropdown/Input |
| 발주계획 | Order Plan | Date | Yes | Date picker |
| 인고예상일 | Expected Arrival | Date | No | Calculated date |
| 기능 | Actions | Button Group | No | Action buttons |

#### Special Features

1. **Editable Quantity Field**
   - Type: Dropdown with manual input
   - Shows current value
   - Allows adjustment before order creation

2. **Date Picker Integration**
   - Order plan date selection
   - Expected arrival auto-calculation

3. **Row Actions**
Each row has action buttons:
- **발주** (Order) - Create purchase order
- **수정** (Edit) - Edit cart item
- **삭제** (Delete) - Remove from cart

### Bottom Modal - Bulk Add Items

**Modal title:** "발주 상품 추가" (Add Purchase Products)

#### Modal Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| 상품구분 | Dropdown | Yes | Product category (내품 / 판매) |
| 공급처 | Dropdown | Yes | Supplier selection (공급업 선택) |
| 검색항목 | Dropdown | No | Search filter (품목 인건) |

#### Modal Results Table

| Column | Type | Notes |
|--------|------|-------|
| 제조드 | Checkbox | Multi-select |
| 이미지 | Image | Product thumbnail |
| 상품명 | Text | Product name |
| 상품명 | Text | Category |
| 재고 | Number | Current stock |
| 신청수량 | Input | Quantity input |
| 입고예상일 | Date | Expected arrival |

**Modal Actions:**
- **담기** (Add to Cart) - Primary button (orange)
- Close modal (X button)

### Pagination
- Text: "상품정보 총 1개" (Total 1 product)
- Navigation controls

---

## API Endpoints Summary

Based on the UI requirements and existing codebase structure, the following API endpoints are needed:

### Product Masters (PIM Service)

#### Existing Endpoints (Already Implemented)
```
POST   /masters                          # Create product master
GET    /masters                          # List product masters with filters
GET    /masters/:id                      # Get master detail
PUT    /masters/:id                      # Update master
DELETE /masters/:id                      # Delete master
GET    /masters/:id/price-preview       # Preview pricing
PUT    /masters/:id/pricing              # Change pricing strategy
```

### Purchase Orders (WMS Service)

#### Existing Endpoints (Already Implemented)
```
POST   /wms/purchase-orders                    # Create purchase order
POST   /wms/purchase-orders/from-cart         # Create PO from cart items
GET    /wms/purchase-orders                    # List purchase orders
GET    /wms/purchase-orders/:id                # Get PO detail
PUT    /wms/purchase-orders/:id/status         # Update PO status
```

#### Cart Management (Already Implemented)
```
POST   /wms/purchase-orders/cart               # Add item to cart
GET    /wms/purchase-orders/cart               # Get cart items
PUT    /wms/purchase-orders/cart/:itemId       # Update cart item
DELETE /wms/purchase-orders/cart/:itemId       # Remove cart item
DELETE /wms/purchase-orders/cart               # Clear cart
```

#### Stock Suggestions (Already Implemented)
```
GET    /wms/purchase-orders/suggestions/reorder  # Get reorder suggestions
```

### Additional Endpoints Needed

#### Template Management (New - PIM Service)
```
GET    /masters/templates                      # Get product creation templates
POST   /masters/from-template                  # Create product from template
GET    /masters/templates/:id                  # Get template details
```

#### Enhanced Filtering (Enhancement - WMS Service)
```
GET    /wms/purchase-orders?
       status=<status>&
       type=<type>&
       supplierId=<uuid>&
       startDate=<date>&
       endDate=<date>&
       search=<query>&
       limit=<number>&
       offset=<number>
```

#### Bulk Operations (New - WMS Service)
```
POST   /wms/purchase-orders/bulk/create        # Bulk create POs
PUT    /wms/purchase-orders/bulk/status        # Bulk update PO status
POST   /wms/purchase-orders/cart/bulk/add      # Bulk add to cart
```

#### Supplier Management (Enhancement - WMS Service)
```
GET    /wms/suppliers                          # List suppliers
GET    /wms/suppliers/:id                      # Get supplier details
GET    /wms/suppliers/:id/products             # Get supplier products
```

---

## Database Schema Alignment

### PIM Schema (Product Masters)

#### Current Schema Support

The existing `product_masters` table supports most UI requirements:

**Supported Fields:**
- ✅ `name` - Product name
- ✅ `description` - Product description
- ✅ `brand` - Brand information
- ✅ `thumbnail` - Thumbnail image
- ✅ `base_price` - Base price
- ✅ `pricing_strategy` - Pricing strategy (option_based, variant_based)
- ✅ `tags` - Marketing tags
- ✅ `images` (JSONB) - Product images
- ✅ `attributes` (JSONB) - Custom attributes
- ✅ `status` - Product status
- ✅ `is_wholesale_only` - Wholesale member only flag
- ✅ `is_membership_only` - Membership only flag
- ✅ `membership_price` - Membership price
- ✅ `wholesale_price` - Wholesale price

**Related Tables:**
- ✅ `product_option_groups` - Option groups
- ✅ `product_option_values` - Option values
- ✅ `product_variants` - Product variants
- ✅ `variant_option_values` - Variant-option mapping
- ✅ `option_value_prices` - Option-based pricing
- ✅ `variant_prices` - Variant-based pricing

**Missing Support:**
- ❌ Import declaration fields (import_declaration_number, customs_clearance_status)
- ❌ MOQ (Minimum Order Quantity) - could use attributes JSONB
- ❌ Manufacturing information fields (제조1, 제조2, 제조3) - could use attributes JSONB
- ❌ Template system - new table needed

### WMS Schema (Purchase Orders)

#### Current Schema Support

**Purchase Orders Table Structure (Inferred from DTOs):**

```typescript
// From purchase-order.dto.ts
interface PurchaseOrder {
  id: string;
  type: 'domestic' | 'foreign';
  supplierId: string | null;
  expectedArrival: Date | null;
  status: 'created' | 'confirmed' | 'received';
  destinationWarehouseId: string;
  createdAt: Date;
  updatedAt: Date;
  lines: PurchaseOrderLine[];
}

interface PurchaseOrderLine {
  skuId: string;
  quantity: number;
  unitPrice: number | null;
}

interface CartItem {
  id: string;
  skuId: string;
  quantity: number;
  type: 'domestic' | 'foreign';
  supplierInfo: any;
  createdAt: Date;
  updatedAt: Date;
}
```

**Supported Features:**
- ✅ Purchase order creation
- ✅ Order status tracking
- ✅ Order lines with SKU and quantity
- ✅ Supplier association
- ✅ Expected arrival date
- ✅ Cart/staging functionality
- ✅ Domestic/Foreign type distinction

**Missing Features:**
- ❌ Search/filter metadata (needs indexes)
- ❌ Bulk operation support
- ❌ Algorithm date field (알고리즘일)
- ❌ Inspection status tracking
- ❌ Safety stock warning threshold

### Recommended Schema Additions

#### 1. Product Template Table (PIM)

```sql
CREATE TABLE product_templates (
  id UUID PRIMARY KEY DEFAULT uuid_v7(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_config JSONB NOT NULL,  -- Template configuration
  category_id UUID REFERENCES product_categories(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. Enhanced Product Masters (PIM)

Add to `product_masters` table or use `attributes` JSONB:

```sql
ALTER TABLE product_masters
ADD COLUMN moq INTEGER,  -- Minimum Order Quantity
ADD COLUMN import_declaration VARCHAR(100),  -- Import declaration number
ADD COLUMN manufacturing_info JSONB;  -- Manufacturing details
```

#### 3. Purchase Order Enhancements (WMS)

Verify existence of these fields:

```sql
-- Add to purchase_orders if missing
ALTER TABLE purchase_orders
ADD COLUMN search_text TEXT,  -- For full-text search
ADD COLUMN algorithm_date DATE,  -- 알고리즘일
ADD COLUMN inspection_status VARCHAR(50),  -- Inspection status
ADD COLUMN notes TEXT;  -- Additional notes

-- Add indexes for filtering
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_type ON purchase_orders(type);
CREATE INDEX idx_po_dates ON purchase_orders(created_at, expected_arrival);
CREATE INDEX idx_po_search ON purchase_orders USING gin(to_tsvector('korean', search_text));
```

#### 4. Cart Enhancements (WMS)

```sql
-- Ensure cart table has these fields
ALTER TABLE purchase_cart_items
ADD COLUMN expected_arrival DATE,  -- Expected arrival calculation
ADD COLUMN order_plan_date DATE,  -- Planned order date
ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';  -- Priority flag
```

---

## Data Relationships and Workflows

### Workflow 1: Create Sales Product (Screen 1 & 2)

**Steps:**
1. User fills basic product information (Screen 1)
   - Product type, supplier, category
   - Option details with images and prices
   - Production information (MOQ, manufacturing)

2. User selects template or pricing strategy (Screen 2)
   - Choose template (if available)
   - Select pricing strategy (option-based or variant-based)
   - Configure option pricing

3. System creates:
   - Product master record
   - Option groups and values
   - Product variants (based on option combinations)
   - Option/variant prices (based on strategy)
   - Product images linkage

**API Call Sequence:**
```
POST /masters
  {
    name: "Product Name",
    basePrice: 10000,
    pricingStrategy: "option_based",
    optionGroups: [
      {
        name: "size",
        displayName: "사이즈",
        values: [
          { value: "S", displayName: "Small", price: 0 },
          { value: "M", displayName: "Medium", price: 1000 }
        ]
      }
    ]
  }
```

### Workflow 2: Browse Purchase Orders (Screen 3)

**Steps:**
1. User applies filters
   - Date range (today, yesterday, week, etc.)
   - Supplier
   - Search term
   - Status

2. System queries purchase orders with filters
3. Display paginated results with:
   - Product thumbnail
   - Supplier info
   - Order dates
   - Status badges
   - Action buttons

**API Call:**
```
GET /wms/purchase-orders?
  status=created&
  startDate=2025-06-20&
  endDate=2025-06-20&
  supplierId=<uuid>&
  limit=50&
  offset=0
```

### Workflow 3: Manage Purchase Cart (Screen 4)

**Steps:**
1. View cart items with safety stock warnings
2. Add items to cart:
   - Search products by category/supplier
   - Select products
   - Set quantity
   - Add to cart staging area

3. Edit cart items:
   - Adjust quantity
   - Set order plan date
   - Update expected arrival

4. Create purchase orders from cart:
   - Select cart items
   - Group by supplier
   - Create PO with lines

**API Call Sequence:**
```
# Get safety stock warnings
GET /wms/purchase-orders/suggestions/reorder

# Add to cart
POST /wms/purchase-orders/cart
  {
    skuId: "uuid",
    quantity: 10,
    type: "domestic",
    supplierInfo: {...}
  }

# Get cart items
GET /wms/purchase-orders/cart?type=domestic

# Create PO from cart
POST /wms/purchase-orders/from-cart
  {
    cartItemIds: ["uuid1", "uuid2"],
    supplierId: "uuid",
    expectedArrival: "2025-07-30",
    destinationWarehouseId: "uuid"
  }
```

---

## Field Mapping Reference

### Screen 1 Field Mappings

| UI Field (Korean) | Database Field | Table | Type | Notes |
|------------------|----------------|-------|------|-------|
| 상품 구분 | attributes.product_type | product_masters | JSONB | Custom attribute |
| 사업자명칭 | attributes.business_name | product_masters | JSONB | Custom attribute |
| 공급사 | supplier_id | skus (via sku_suppliers) | UUID | Foreign key |
| 수입신고필 | attributes.import_declaration | product_masters | JSONB | Custom attribute |
| 수입신고번호 | attributes.import_declaration_number | product_masters | JSONB | New field |
| 분류 | category_id | product_master_categories | UUID | Many-to-many |
| 옵션상세명칭 | value / display_name | product_option_values | VARCHAR | - |
| 옵션상세이미지 | images | product_variants | JSONB | Variant images |
| 판가 | price | option_value_prices / variant_prices | BIGINT | Based on strategy |
| MOQ | attributes.moq | product_masters | JSONB | Or dedicated column |
| 제조1-3 | attributes.manufacturing_info | product_masters | JSONB | Array structure |

### Screen 3 Field Mappings

| UI Field (Korean) | Database Field | Table | Type | Notes |
|------------------|----------------|-------|------|-------|
| 배조드 번호 | barcode / default_barcode | skus / sku_barcodes | VARCHAR | - |
| 이미지 | thumbnail | product_masters | TEXT | Image URL |
| 상품명 | name | product_masters (via SKU) | VARCHAR | - |
| 발주처 | name | suppliers | VARCHAR | Via supplier_id |
| 발주 날짜 | created_at | purchase_orders | TIMESTAMP | - |
| 알고리즘일 | algorithm_date | purchase_orders | DATE | New field |
| 판가 | unit_price | purchase_order_lines | BIGINT | Line item price |
| 발주 수량 | quantity | purchase_order_lines | INTEGER | - |
| 발주상태명 | status | purchase_orders | ENUM | created/confirmed/received |
| 입고검수명 | inspection_status | purchase_orders | VARCHAR | New field |

### Screen 4 Field Mappings

| UI Field (Korean) | Database Field | Table | Type | Notes |
|------------------|----------------|-------|------|-------|
| 배조드 번호 | default_barcode | skus | VARCHAR | - |
| 이미지 | thumbnail | product_masters | TEXT | Via master_id |
| 상품명 | name | skus | VARCHAR | - |
| 재고/공급처계 | - | Calculated | NUMBER | From stock_summary |
| 제조 | name | suppliers | VARCHAR | Via sku_suppliers |
| 신청수량 | quantity | purchase_cart_items | INTEGER | Editable |
| 발주계획 | order_plan_date | purchase_cart_items | DATE | User input |
| 인고예상일 | expected_arrival | purchase_cart_items | DATE | Calculated |

---

## Validation Rules

### Product Creation Validation

1. **Required Fields:**
   - Product name (name)
   - Base price (base_price)
   - Pricing strategy (pricing_strategy)
   - At least one option group (if option_based strategy)

2. **Option Validation:**
   - Option group name must be unique per master
   - Option values must be unique within group
   - Option prices must be non-negative
   - At least one option value per group

3. **Price Validation:**
   - Base price > 0
   - Membership price < base price (if set)
   - Wholesale price < membership price (if set)
   - Option adjustment prices can be negative

### Purchase Order Validation

1. **Required Fields:**
   - Order type (domestic/foreign)
   - Supplier ID
   - Destination warehouse ID
   - At least one line item

2. **Line Item Validation:**
   - SKU ID must exist
   - Quantity > 0
   - Unit price >= 0 (can be null)

3. **Cart Validation:**
   - SKU must not already be in cart (or allow quantity update)
   - Quantity must respect MOQ if set
   - Expected arrival must be >= today + lead time

---

## UI Component Requirements

### Reusable Components Needed

1. **Product Search/Filter Component**
   - Multi-field search
   - Date range picker with presets
   - Category/supplier dropdowns
   - Quick filter buttons

2. **Data Table Component**
   - Sortable columns
   - Checkbox multi-select
   - Inline editing (for quantities)
   - Action button groups per row
   - Pagination controls
   - Bulk action toolbar

3. **Option Matrix Builder**
   - Dynamic row addition/deletion
   - Image upload per option
   - Price input per option
   - Drag-and-drop reordering

4. **Template Selector**
   - Card-based template display
   - Preview functionality
   - Apply button per template

5. **Status Badge Component**
   - Color-coded status indicators
   - Korean/English label support
   - Icon support

6. **Modal Components**
   - Product search modal
   - Bulk add modal
   - Confirmation dialogs

---

## State Management

### Frontend State Requirements

1. **Product Creation Form State**
   ```typescript
   {
     basicInfo: {
       name: string;
       supplier: string;
       category: string;
       // ...
     },
     options: Array<{
       id: string;
       name: string;
       image: File | null;
       price: number;
     }>,
     productionInfo: {
       moq: number;
       manufacturing: string[];
     },
     step: 1 | 2;
   }
   ```

2. **Purchase Order List State**
   ```typescript
   {
     filters: {
       dateRange: { start: Date; end: Date };
       status: string[];
       supplier: string | null;
       searchTerm: string;
     },
     orders: PurchaseOrder[];
     pagination: {
       page: number;
       limit: number;
       total: number;
     },
     selectedIds: string[];
   }
   ```

3. **Cart State**
   ```typescript
   {
     items: CartItem[];
     safetyStockWarnings: Array<{
       skuId: string;
       currentStock: number;
       safetyStock: number;
       shortfall: number;
     }>;
     bulkAddModal: {
       isOpen: boolean;
       searchResults: Product[];
       selectedProducts: string[];
     };
   }
   ```

---

## Error Handling

### Expected Error Scenarios

1. **Product Creation Errors**
   - Duplicate product name
   - Invalid option combination
   - Missing required fields
   - Image upload failure
   - Price validation failure

2. **Purchase Order Errors**
   - SKU not found
   - Insufficient permissions
   - Invalid supplier
   - Warehouse not active
   - Quantity exceeds available stock (for certain scenarios)

3. **Cart Errors**
   - Item already in cart
   - SKU no longer available
   - Supplier constraint violation
   - Date validation errors

### Error Response Format

```typescript
{
  success: false,
  error: {
    code: string;  // ERROR_CODE
    message: string;  // User-friendly message
    field?: string;  // Field that caused error
    details?: any;  // Additional context
  }
}
```

---

## Performance Considerations

### Optimization Strategies

1. **Product List Loading**
   - Implement pagination (default 50 items)
   - Use lazy loading for images
   - Cache frequently accessed data
   - Index search fields

2. **Option Matrix**
   - Limit max options per group (e.g., 50)
   - Debounce price calculations
   - Validate on blur, not on every keystroke

3. **Cart Operations**
   - Batch cart additions
   - Optimistic UI updates
   - Background sync

4. **Search Performance**
   - Full-text search indexes
   - Debounced search input
   - Search result caching

---

## Accessibility & Localization

### Accessibility Requirements

1. **Keyboard Navigation**
   - Tab order through form fields
   - Enter to submit forms
   - Escape to close modals

2. **Screen Reader Support**
   - ARIA labels for all inputs
   - Status announcements
   - Error announcements

3. **Visual Accessibility**
   - Sufficient color contrast
   - Focus indicators
   - Error states clearly visible

### Localization

Currently supports:
- Korean (primary)
- English (secondary)

Fields requiring translation:
- All UI labels
- Error messages
- Status indicators
- Help text
- Validation messages

---

## Testing Checklist

### UI Testing

- [ ] Product creation form validation
- [ ] Multi-step form navigation
- [ ] Option matrix dynamic rows
- [ ] Image upload functionality
- [ ] Price calculation accuracy
- [ ] Template selection and application
- [ ] Date picker with presets
- [ ] Search and filter combinations
- [ ] Table sorting and pagination
- [ ] Cart CRUD operations
- [ ] Bulk operations
- [ ] Modal interactions
- [ ] Status badge rendering
- [ ] Error message display
- [ ] Loading states

### API Testing

- [ ] Create product master with options
- [ ] Update product master
- [ ] Delete product master
- [ ] List products with filters
- [ ] Get product detail
- [ ] Create purchase order
- [ ] Update PO status
- [ ] Add to cart
- [ ] Remove from cart
- [ ] Create PO from cart
- [ ] Get reorder suggestions
- [ ] Bulk operations

### Integration Testing

- [ ] End-to-end product creation flow
- [ ] End-to-end purchase order flow
- [ ] Cart to PO conversion
- [ ] Product-SKU relationship
- [ ] SKU-supplier relationship
- [ ] Price calculation with options
- [ ] Stock level updates
- [ ] Date validation and calculations

---

## Implementation Priority

### Phase 1: Core Functionality (High Priority)

1. Product creation form (Screen 1)
   - Basic info fields
   - Option matrix
   - Form validation

2. Purchase order list (Screen 3)
   - List view with filters
   - Basic search
   - Status display

3. Cart management (Screen 4)
   - Add to cart
   - View cart
   - Create PO from cart

### Phase 2: Enhanced Features (Medium Priority)

1. Template system (Screen 2)
   - Template creation
   - Template selection
   - Template application

2. Advanced filtering
   - Date range presets
   - Multi-field search
   - Saved filters

3. Bulk operations
   - Bulk cart additions
   - Bulk PO creation
   - Bulk status updates

### Phase 3: Polish & Optimization (Low Priority)

1. Image optimization
2. Advanced validation
3. Performance tuning
4. Accessibility improvements
5. Enhanced error messages
6. Analytics and logging

---

## Summary

This analysis covers four main screens for the Almondyoung inventory management system:

1. **Create Sales Product Form (Part 1)**: Basic product information, option matrix, production details
2. **Create Sales Product Form (Part 2)**: Template selection, pricing strategy configuration
3. **Purchase Inquiry List**: Searchable, filterable list of purchase orders
4. **Purchase Cart Management**: Staging area for purchase order creation with bulk operations

The existing PIM and WMS schemas support most required functionality, with minor additions needed for:
- Template system
- Enhanced search/filter metadata
- Additional tracking fields (algorithm date, inspection status)
- Safety stock warnings

All identified API endpoints align with existing NestJS controller patterns, with most already implemented and a few enhancements needed for bulk operations and templates.

---

*Last updated: 2025-10-13*
*Analysis based on Figma screenshots from: `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/`*

---
---

# Inbound and Purchase Functionality Analysis (2025-10-13)

This section provides detailed findings from analyzing the inbound and purchase workflow screenshots, comparing UI requirements with backend implementation.

## Table of Contents
1. [Inbound List Screen 1](#inbound-list-screen-1)
2. [Inbound List Screen 2](#inbound-list-screen-2)
3. [Purchase Inquiry Screen](#purchase-inquiry-screen)
4. [Purchase Cart Inquiry Screen](#purchase-cart-inquiry-screen)
5. [Data Relationship Analysis](#data-relationship-analysis)
6. [Gap Analysis: UI vs Backend](#gap-analysis-ui-vs-backend)
7. [Implementation Recommendations](#implementation-recommendations)

---

## Inbound List Screen 1

**File**: `almondyoung-figma-png/inventory/inbound-list-1.png`

### Screen Purpose
**Feature Name**: 입고리스트 (Inbound List)
**Description**: Main inventory inbound management screen for viewing and managing inbound operations with comprehensive filtering and detail viewing capabilities.

### Data Table Columns

| Column Name (Korean) | English | Data Type | Backend Mapping |
|---------------------|---------|-----------|-----------------|
| 바코드 번호 | Barcode Number | String | `inboundLists.barcode` or `skuBarcodes.barcode` |
| 아이템 | Product Name + Image | Text + Image | `skus.name` via `inboundLists.skuId` |
| 상품 | Supplier | Text | `suppliers.name` via `skus` → `skuSuppliers` |
| 발주 날짜 | Order Date | Date | `purchaseOrders.expectedArrival` |
| 입고예정일 | Expected Inbound Date | Date | `inboundPlans.expectedDate` |
| 입고수량 | Inbound Quantity | Integer | `inboundPlanItems.expectedQty` |
| 단가 | Unit Price | Currency | `purchaseOrderLines.unitPrice` |
| 입고예정수량/입고 수량 | Planned/Received Qty | Status Text | `inboundPlanItems.expectedQty` / `receivedQty` |
| 발주상태 | Order Status | Badge | `inboundLists.status` |
| 업고상태 | Destination Status | Badge | Transfer status indicator |
| 기타 | Actions | Button Group | Various action buttons |

### Status Values Identified

#### Inbound List Status (발주상태)
- **입고 대기** (Pending) - Maps to `inboundStatusEnum: 'pending'` ✓
- **입고 완료** (Completed) - Maps to `inboundStatusEnum: 'confirmed'` ✓
- **입고신청** (Applied) - **NOT in backend enum** ⚠️

**Backend Enum:**
```typescript
// Current: apps/wms/database/schemas/wms-schema.ts
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'confirmed']);
```

**Recommendation**: Extend enum or map UI labels:
```typescript
// Option 1: Extend enum
export const inboundStatusEnum = pgEnum('inbound_status', [
    'pending',      // 입고 대기
    'applied',      // 입고신청
    'confirmed',    // 입고 완료
    'receiving'     // 입고 중
]);
```

### Filters and Search Capabilities

#### Primary Filter Bar
- **일자** (Date): Radio buttons - 오늘 (Today), 어제 (Yesterday), 당월 (This month), 전체 (All)
- **검색 범위** (Date Range): Date range picker (YYYY-MM-DD format)
- **빈 칸 검색만 표시 제외**: Checkbox to exclude empty searches
- **아이템 수별 표시**: Checkbox for item count display

#### Secondary Filter Bar
- **검색범위** (Search Scope): Multiple dropdowns for category, status, type filtering
- **발주 유형** (PO Type): Dropdown showing domestic/overseas options
- **입고 상태** (Inbound Status): Dropdown with status options

#### Quick Filter Buttons
- 오늘 (Today)
- 예정 리스트 (Planned list)
- 관련품목 입고하기 중 (Related items in progress)
- 예정 입고수량 잔량인 (Remaining planned qty)
- 인바운드 제품 중 (Products in inbound)
- 예측구매금 증감상황 (Estimated purchase change)

### Actions and Operations

#### Row-Level Actions
1. **바코드 출력하기** (Print Barcode) - Orange button
2. **지금 바로 입고하기** (Immediate Inbound) - White button  
3. **입고신청** (Apply Inbound) - White button
4. **입고 대기** (Pending Status) - Status indicator

#### Bulk Actions
- 엑셀 다운로드 (Excel download)
- Multi-select with checkboxes

### Workflow Steps Visible

```
1. Purchase Order Created
   └── purchaseOrders.status = 'created'
   
2. Inbound List Entry
   └── inboundLists.status = 'pending'
   
3. User Actions:
   a) Apply Inbound (입고신청)
      └── inboundLists.status → 'applied' (NEW STATUS)
      
   b) Print Barcode (바코드 출력)
      └── Generate barcode for scanning
      
   c) Immediate Receive (지금 바로 입고)
      └── Create inboundReceipt + stockEvents
      
4. Inbound Completed
   └── inboundLists.status = 'confirmed'
   └── Stock updated in stock_summary
```

### Backend Requirements

**Current Support:**
- ✅ `inboundLists` table exists
- ✅ `purchaseOrders` and `purchaseOrderLines` implemented
- ✅ `inboundPlans` and `inboundPlanItems` implemented
- ✅ `inboundReceipts` and `inboundReceiptLines` implemented

**Missing Implementation:**
- ❌ Controller for `/wms/inbound/lists` endpoints
- ❌ Service methods for inbound list management
- ❌ API endpoint for "Apply Inbound" action
- ❌ API endpoint for "Immediate Receive" action
- ❌ Barcode generation API

**Required New Endpoints:**
```typescript
GET    /wms/inbound/lists              // List with comprehensive filtering
GET    /wms/inbound/lists/:id          // Detail view
POST   /wms/inbound/lists/:id/apply    // Apply for inbound
POST   /wms/inbound/lists/:id/receive  // Execute immediate receipt
GET    /wms/inbound/lists/:id/barcode  // Generate barcode
```

---

## Inbound List Screen 2

**File**: `almondyoung-figma-png/inventory/inbound-list-2.png`

### Additional UI Elements

#### Barcode Print Modal (바코드 인쇄 대기중)
**Purpose**: Manage barcode printing workflow

**Fields:**
- **인쇄 예정할 상태**: Print status dropdown
- **인쇄사용 설비**: Printer selection dropdown
- **입력하기**: Input button
- **출력선택**: Output selection button

**Detail Information:**
- Item barcode number: 1146350000
- Product name: 노르는 바이런 제곡 700g
- Quantity: 2개
- Manufacturing date: 26
- Production date: 26

#### Bottom Detail Panel (호손 내역)
**Purpose**: Detailed inventory history

**Table Columns:**
- **일자** (Date): Transaction date
- **구분** (Type): Transaction type
- **예정수량** (Planned Qty): Expected quantity
- **확정수량** (Confirmed Qty): Confirmed quantity
- **입고내역** (Inbound History): Receipt history
- **불출고재고** (Unreleased Stock): Stock status
- **출고예약** (Shipment Reserve): Reserved quantity
- **업체코드** (Supplier Code): Supplier reference

### Data Relationships Visible

```
purchaseOrders (Header)
    ├── purchaseOrderLines (SKU + Quantity + Price)
    │   └── SKU Details
    │       ├── name
    │       ├── defaultBarcode
    │       └── supplier info
    │
    └── inboundLists (Pending Items)
            ├── status tracking
            ├── barcode assignment
            └── receipt linkage
                └── inboundReceipts (Actual)
                    └── inboundReceiptLines
                        └── stockEvents (Ledger)
```

### Backend Enhancement Needed

**Barcode Print Queue System:**
```typescript
// New table needed
export const barcodePrintJobs = pgTable('barcode_print_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    inboundListId: uuid('inbound_list_id')
        .references(() => inboundLists.id)
        .notNull(),
    status: printJobStatusEnum('status').default('pending'),
    printedAt: timestamp('printed_at'),
    printedBy: uuid('printed_by'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const printJobStatusEnum = pgEnum('print_job_status', [
    'pending',
    'printing',
    'completed',
    'failed'
]);
```

---

## Purchase Inquiry Screen

**File**: `almondyoung-figma-png/inventory/purchase-inquery.png`

### Screen Purpose
**Feature Name**: 발주리스트 확인 (Purchase Order List Confirmation)
**Description**: Review and confirm purchase orders with comprehensive search and filtering before finalizing.

### Data Table Columns

| Column (Korean) | English | Data Type | Backend Mapping |
|----------------|---------|-----------|-----------------|
| 체크 | Checkbox | Boolean | UI selection state |
| 바코드 번호 | Barcode Number | String | `skus.defaultBarcode` |
| 아이템 | Product Name + Image | Text + Image | `skus.name` |
| 상품명/메모 | Supplier/Notes | Text | `suppliers.name` + notes |
| 발주처 | Supplier Type | Text | Warehouse/supplier type |
| 발주 날짜 | Order Date | Date | `purchaseOrders.expectedArrival` |
| 입고예정일 | Expected Inbound | Date | `inboundPlans.expectedDate` |
| 단가 | Unit Price | Currency | `purchaseOrderLines.unitPrice` |
| 입가 | Quantity | Integer | `purchaseOrderLines.quantity` |
| 발주 수량 | PO Quantity | Text | Various status indicators |
| 발주상태 | PO Status | Badge | `purchaseOrders.status` |
| 입고상태 | Inbound Status | Badge | `inboundPlans.status` |
| 기타 | Actions | Button Group | Action buttons |

### Status Values - Gap Analysis

#### Purchase Order Status (발주상태)
**UI Shows:**
- **이전저** (Previous/Early)
- **감사전** (Pre-audit)

**Backend Has:**
```typescript
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received']);
```

**Problem**: UI status values don't map to backend enum ⚠️

**Recommendation**: Add audit workflow status
```typescript
// Option 1: Add new audit workflow enum
export const poAuditStatusEnum = pgEnum('po_audit_status', [
    'draft',          // 작성 중
    'pending_audit',  // 감사전
    'approved',       // 승인됨
    'rejected'        // 반려
]);

// Option 2: Extend existing enum
export const poStatusEnum = pgEnum('po_status', [
    'draft',          // 작성 중
    'pending_audit',  // 감사전 (이전저)
    'approved',       // 승인됨
    'created',        // 생성됨
    'confirmed',      // 확정됨
    'received'        // 입고됨
]);
```

### Filters and Search

**Filter Fields:**
- **일자** (Date): Radio group - 오늘, 어제, 당월, 전체
- **검색범위** (Date Range): From/to date pickers
- **검색범위** (Search Scope): Category dropdown
- **신뢰 사유** (Trust Reason): Multiple dropdowns

**Quick Filters:**
- 오늘 (Today)
- 예정 리스트중인 (In planned list)
- 신뢰 사유 (Trust reason)

### Actions and Operations

**Row-Level Actions:**
- **사회** (Society/Social) button
- **발주 수정** (Edit PO) button
- **업고 정검** (Quality Inspection) button

**Top Actions:**
- **검색** (Search) - Orange primary button
- **상품 제품 리스트** (Product list) button

### Backend Requirements

**Current Implementation:**
```typescript
// Already exists: apps/wms/src/inbound/controllers/purchase-order.controller.ts
@Get()
async getPurchaseOrders(
    @Query('status') status?: PurchaseOrderStatus,
    @Query('type') type?: PurchaseOrderType,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
): Promise<PurchaseOrderResponse[]>
```

**Enhancements Needed:**
1. Add audit workflow status tracking
2. Extend filtering capabilities:
   ```typescript
   @Query('supplierId') supplierId?: string,
   @Query('startDate') startDate?: string,
   @Query('endDate') endDate?: string,
   @Query('search') search?: string,
   @Query('auditStatus') auditStatus?: string
   ```
3. Add audit workflow endpoints:
   ```typescript
   @Put(':id/submit-for-audit')
   @Put(':id/approve')
   @Put(':id/reject')
   ```

---

## Purchase Cart Inquiry Screen

**File**: `almondyoung-figma-png/inventory/purchase-cart-inquery.png`

### Screen Purpose
**Feature Name**: 발주리스트 생성 (Purchase Order List Creation)
**Description**: Cart-based purchase order creation with item selection, quantity management, and MOQ validation.

### Warning Banner
**Critical Alert**: "안정재고 미만 상품 50개" (50 items below safety stock)
- Red background warning banner
- Indicates minimum order quantity enforcement
- Business rule: Safety stock threshold validation

### Data Table Columns

| Column (Korean) | English | Data Type | Editable | Backend Mapping |
|----------------|---------|-----------|----------|-----------------|
| 체크 | Checkbox | Boolean | No | Selection state |
| 바코드 번호 | Barcode | String | No | `skus.defaultBarcode` |
| 아이템 | Product + Image | Text + Image | No | `skus.name` |
| 상품명/메모 | Name/Notes | Text | No | `purchaseOrderCart.supplierInfo` |
| 발주처 MOQ | Supplier + MOQ | Text | No | Supplier constraints |
| 예고, 진행구분 | Status | Status Badge | No | Cart item status |
| 신뢰부과료 | Shipping Fee | Enum | No | Shipping terms |
| 입가 | Unit Price | Currency | Yes (inline) | Editable price |
| 발주 수량 | Quantity | Integer | Yes (stepper) | `purchaseOrderCart.quantity` |
| 발주상태 | PO Status | Badge | No | Preview status |
| 입고상태 | Inbound Status | Badge | No | Preview status |
| 기타 | Actions | Button Group | No | Edit/Remove |

### Cart Management Features

**Inline Editing:**
- Quantity adjustment with number stepper (+/- buttons)
- Unit price editing capability
- Real-time total calculation

**Row Actions:**
- **발주** (Order) - Create purchase order from item
- **수정** (Edit) - Edit cart item details
- **삭제** (Delete) - Remove from cart

**Bulk Actions:**
- **검색** (Search) button
- **발주 선택 추가** (Add selected to PO) with dropdown for domestic/overseas

### Add Items Modal (발주 상품 추가)

**Modal Fields:**
- **상품구분** (Product Classification): Dropdown
- **공급처** (Supplier): Dropdown with supplier selection
- **검색** (Search) button

**Results Table:**
| Column | Type | Notes |
|--------|------|-------|
| 체크 | Checkbox | Multi-select |
| 이미지 | Image | Product thumbnail |
| 상품명 | Text | Product name |
| 재고 | Number | Current stock |
| 신청수량 | Input | Quantity input field |
| 입고예상일 | Date | Expected arrival |

### Workflow and Business Rules

```
Cart Workflow:
1. Browse Products
   └── Filter by category, supplier, stock level
   
2. Add to Cart (POST /wms/purchase-orders/cart)
   ├── Validate MOQ
   ├── Check safety stock
   └── Calculate expected arrival
   
3. Review Cart (GET /wms/purchase-orders/cart)
   ├── Show safety stock warnings
   ├── Allow quantity adjustments
   └── Allow item removal
   
4. Create PO from Cart (POST /wms/purchase-orders/from-cart)
   ├── Select cart items by IDs
   ├── Group by supplier
   ├── Validate total order
   └── Create purchaseOrders + purchaseOrderLines
   
5. Clear Cart (DELETE /wms/purchase-orders/cart)
```

### Business Rules Identified

1. **Minimum Order Quantity (MOQ)**
   - UI warning: "안정재고 미만 상품 50개"
   - Enforced at cart addition and PO creation
   - Per-supplier MOQ rules

2. **Safety Stock Validation**
   - Red banner alert when below threshold
   - Calculate suggested order quantity
   - Prevent orders that would deplete safety stock

3. **Supplier Grouping**
   - Cart items grouped by supplier for PO creation
   - Separate POs for domestic vs overseas

4. **Expected Arrival Calculation**
   - Based on supplier lead time
   - Warehouse processing time
   - Domestic vs overseas logistics

### Backend Support Analysis

**Current Implementation:** ✅ Well-supported

```typescript
// Already implemented: apps/wms/src/inbound/controllers/purchase-order.controller.ts

// Cart Management
POST   /wms/purchase-orders/cart           // Add to cart ✓
GET    /wms/purchase-orders/cart           // Get cart items ✓
PUT    /wms/purchase-orders/cart/:itemId   // Update item ✓
DELETE /wms/purchase-orders/cart/:itemId   // Remove item ✓
DELETE /wms/purchase-orders/cart           // Clear cart ✓

// PO Creation
POST   /wms/purchase-orders/from-cart      // Create from cart ✓

// Stock Suggestions
GET    /wms/purchase-orders/suggestions/reorder  // Reorder suggestions ✓
```

**Schema Support:**
```typescript
// Already exists: apps/wms/database/schemas/wms-schema.ts
export const purchaseOrderCart = pgTable('purchase_order_cart', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id),
    quantity: integer('quantity').notNull(),
    type: poTypeEnum('type').notNull(),
    supplierInfo: json('supplier_info'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Enhancements Needed:**

1. **Add MOQ Rules to Suppliers Table:**
```typescript
// Extend suppliers table
export const suppliers = pgTable('suppliers', {
    // ... existing fields
    moq: integer('moq'),                    // Minimum order quantity
    leadTimeDays: integer('lead_time_days'), // Delivery lead time
    moqRules: json('moq_rules'),            // Complex MOQ logic
});
```

2. **Add Safety Stock Validation:**
```typescript
// New service method
async validateSafetyStock(skuId: string, quantity: number) {
    const stockSummary = await getStockSummary(skuId);
    const safetyStock = stockSummary.safetyStock ?? 0;
    const afterOrder = stockSummary.onHand + quantity;
    
    if (afterOrder < safetyStock) {
        throw new BadRequestException(
            `Order would result in ${afterOrder} units, below safety stock of ${safetyStock}`
        );
    }
}
```

3. **Add MOQ Validation Endpoint:**
```typescript
@Get('suppliers/:id/moq-rules')
async getSupplierMOQRules(@Param('id') id: string) {
    return this.supplierService.getMOQRules(id);
}
```

---

## Data Relationship Analysis

### Complete End-to-End Workflow

```
┌─────────────────────────────────────────────────────────┐
│                    Product Inquiry                      │
│  - Browse products by category, supplier, stock         │
│  - Check availability and pricing                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ Add to cart
┌─────────────────────────────────────────────────────────┐
│                  Purchase Cart (Stage)                  │
│  - purchaseOrderCart table                              │
│  - Review items, adjust quantities                      │
│  - Validate MOQ rules                                   │
│  - Show safety stock warnings                           │
│  - Group by supplier                                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ Create PO
┌─────────────────────────────────────────────────────────┐
│                 Purchase Order (PO)                     │
│  - purchaseOrders table                                 │
│  - Status: created → confirmed → received               │
│  - Links to supplier, warehouse                         │
│  - Expected arrival date                                │
│  └─── purchaseOrderLines (SKU, quantity, price)         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ Automatically creates
┌─────────────────────────────────────────────────────────┐
│                   Inbound List                          │
│  - inboundLists table                                   │
│  - Status: pending → applied → confirmed                │
│  - Links PO to expected receipts                        │
│  - Barcode assignment                                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ Optional: Create plan
┌─────────────────────────────────────────────────────────┐
│                  Inbound Plan (Optional)                │
│  - inboundPlans table                                   │
│  - expectedDate, warehouse                              │
│  └─── inboundPlanItems (SKU, expectedQty, receivedQty)  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ User actions:
                     │ 1. Apply Inbound (입고신청)
                     │ 2. Print Barcode (바코드 출력)
                     │ 3. Immediate Receive (지금 바로 입고)
                     │
                     ↓ Execute receipt
┌─────────────────────────────────────────────────────────┐
│                  Inbound Receipt                        │
│  - inboundReceipts table                                │
│  - method: individual, simple, planned                  │
│  - occurredAt, warehouseId, locationId                  │
│  └─── inboundReceiptLines (SKU, quantity, location)     │
│       └─── stockEvents (ledger entries)                 │
│            └─── Updates stock_summary                   │
└─────────────────────────────────────────────────────────┘
```

### Schema Relationships

```typescript
// Purchase Flow
purchaseOrderCart (temporary staging)
    ↓ (convert via createPurchaseOrderFromCart)
purchaseOrders
    ├── type: 'domestic' | 'foreign'
    ├── supplierId → suppliers
    ├── sourceWarehouseId → warehouses (direct inbound location)
    ├── destinationWarehouseId → warehouses (final destination)
    ├── status: 'created' | 'confirmed' | 'received'
    └── purchaseOrderLines
        ├── skuId → skus
        ├── quantity: integer
        └── unitPrice: integer

    ↓ (creates entries)
inboundLists
    ├── poId → purchaseOrders
    ├── skuId → skus
    ├── quantity: integer
    ├── barcode: varchar
    └── status: 'pending' | 'confirmed'

    ↓ (optional planning)
inboundPlans
    ├── expectedDate: date
    ├── warehouseId → warehouses
    ├── destinationWarehouseId → warehouses
    ├── requiresTransfer: boolean
    ├── linkedPurchaseOrderId → purchaseOrders
    └── inboundPlanItems
        ├── skuId → skus
        ├── expectedQty: integer
        ├── receivedQty: integer
        └── status: 'pending' | 'confirmed'

    ↓ (actual execution)
inboundReceipts
    ├── method: 'individual' | 'simple' | 'planned'
    ├── warehouseId → warehouses
    ├── locationId → locations
    ├── occurredAt: timestamp
    ├── journalId → stockJournals
    └── inboundReceiptLines
        ├── skuId → skus
        ├── quantity: integer
        ├── planItemId → inboundPlanItems (optional)
        ├── eventId → stockEvents
        └── memo: varchar

    ↓ (creates ledger)
stockEvents
    ├── transitionType: 'RECEIVE'
    ├── toState: 'ON_HAND'
    ├── toWarehouseId → warehouses
    ├── toLocationId → locations
    └── quantity: integer (positive)

    ↓ (updates projection)
stock_summary (materialized view)
    ├── skuId
    ├── warehouseId
    ├── locationId
    ├── on_hand: sum(quantity where toState='ON_HAND')
    ├── defective: sum(quantity where toState='DEFECTIVE')
    └── in_transfer: sum(quantity where toState='IN_TRANSFER')
```

---

## Gap Analysis: UI vs Backend

### Status Enum Mismatches

#### Issue 1: Inbound Status Enum

**UI Requirements:**
- 입고 대기 (Pending)
- 입고신청 (Applied)
- 입고 중 (Receiving)
- 입고 완료 (Confirmed)
- 입고 수용 (Accepted)
- 업고 정검 (Quality Inspection)

**Current Backend:**
```typescript
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'confirmed']);
```

**Recommendation:** ⚠️ Extend enum
```typescript
export const inboundStatusEnum = pgEnum('inbound_status', [
    'pending',      // 입고 대기
    'applied',      // 입고신청
    'receiving',    // 입고 중
    'confirmed',    // 입고 완료
    'inspection'    // 업고 정검 (optional)
]);
```

#### Issue 2: Purchase Order Audit Status

**UI Requirements:**
- 이전저 (Previous/Draft)
- 감사전 (Pending Audit)
- 승인됨 (Approved)

**Current Backend:**
```typescript
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received']);
```

**Recommendation:** ⚠️ Add separate audit workflow
```typescript
// Add new enum for audit workflow
export const poAuditStatusEnum = pgEnum('po_audit_status', [
    'draft',          // 이전저
    'pending_audit',  // 감사전
    'approved',       // 승인됨
    'rejected'        // 반려
]);

// Add to purchaseOrders table
ALTER TABLE purchase_orders
ADD COLUMN audit_status VARCHAR(20) DEFAULT 'draft',
ADD COLUMN submitted_for_audit_at TIMESTAMP,
ADD COLUMN approved_by UUID REFERENCES users(id),
ADD COLUMN approved_at TIMESTAMP,
ADD COLUMN rejection_reason VARCHAR(500);
```

### Missing API Endpoints

| Feature | UI Requirement | Backend Status | Priority | Effort |
|---------|----------------|----------------|----------|--------|
| **Inbound Lists Management** |
| List inbound items | GET /wms/inbound/lists | ⚠️ MISSING | HIGH | 2-3 days |
| Get detail | GET /wms/inbound/lists/:id | ⚠️ MISSING | HIGH | 1 day |
| Apply inbound | POST /wms/inbound/lists/:id/apply | ⚠️ MISSING | HIGH | 1-2 days |
| Immediate receive | POST /wms/inbound/lists/:id/receive | ⚠️ MISSING | HIGH | 2-3 days |
| Generate barcode | GET /wms/inbound/lists/:id/barcode | ⚠️ MISSING | MEDIUM | 1-2 days |
| **Purchase Order Audit** |
| Submit for audit | PUT /wms/purchase-orders/:id/submit | ⚠️ MISSING | MEDIUM | 1 day |
| Approve PO | PUT /wms/purchase-orders/:id/approve | ⚠️ MISSING | MEDIUM | 1 day |
| Reject PO | PUT /wms/purchase-orders/:id/reject | ⚠️ MISSING | MEDIUM | 1 day |
| **Supplier Management** |
| Get MOQ rules | GET /wms/suppliers/:id/moq-rules | ⚠️ MISSING | MEDIUM | 1 day |
| **Already Implemented** |
| Cart management | POST/GET/PUT/DELETE /wms/purchase-orders/cart | ✅ EXISTS | - | - |
| Create PO from cart | POST /wms/purchase-orders/from-cart | ✅ EXISTS | - | - |
| Reorder suggestions | GET /wms/purchase-orders/suggestions/reorder | ✅ EXISTS | - | - |

**Total Effort Estimate**: 10-15 days for missing endpoints

### Missing Backend Features

#### 1. Inbound Lists Management (HIGH Priority)

**Current State:**
- `inboundLists` table exists in schema
- No controller or service implementation
- No DTOs defined

**Required Implementation:**

**Controller**: `apps/wms/src/inbound/controllers/inbound-list.controller.ts`
```typescript
@Controller('wms/inbound/lists')
export class InboundListController {
    constructor(private readonly inboundListService: InboundListService) {}

    @Get()
    async listInboundLists(@Query() filters: InboundListFiltersDto) {
        return this.inboundListService.listInboundLists(filters);
    }

    @Get(':id')
    async getInboundListDetail(@Param('id') id: string) {
        return this.inboundListService.getInboundListDetail(id);
    }

    @Post(':id/apply')
    async applyInbound(@Param('id') id: string, @Body() dto: ApplyInboundDto) {
        return this.inboundListService.applyInbound(id, dto);
    }

    @Post(':id/receive')
    async immediateReceive(@Param('id') id: string, @Body() dto: ImmediateReceiveDto) {
        return this.inboundListService.immediateReceive(id, dto);
    }

    @Get(':id/barcode')
    async generateBarcode(@Param('id') id: string) {
        return this.inboundListService.generateBarcode(id);
    }
}
```

**Service**: `apps/wms/src/inbound/services/inbound-list.service.ts`
```typescript
@Injectable()
export class InboundListService {
    constructor(@Inject('DB') private db: DbTx) {}

    async listInboundLists(filters: InboundListFiltersDto) {
        const query = this.db
            .select({
                id: inboundLists.id,
                poId: inboundLists.poId,
                skuId: inboundLists.skuId,
                quantity: inboundLists.quantity,
                barcode: inboundLists.barcode,
                status: inboundLists.status,
                purchaseOrder: {
                    id: purchaseOrders.id,
                    type: purchaseOrders.type,
                    expectedArrival: purchaseOrders.expectedArrival,
                },
                sku: {
                    id: skus.id,
                    name: skus.name,
                    code: skus.code,
                    defaultBarcode: skus.defaultBarcode,
                },
            })
            .from(inboundLists)
            .innerJoin(purchaseOrders, eq(inboundLists.poId, purchaseOrders.id))
            .innerJoin(skus, eq(inboundLists.skuId, skus.id));

        // Apply filters
        if (filters.status) {
            query.where(eq(inboundLists.status, filters.status));
        }
        // ... more filters

        return query.limit(filters.limit ?? 50).offset(filters.offset ?? 0);
    }

    async applyInbound(id: string, dto: ApplyInboundDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            // Update status to 'applied'
            await tx
                .update(inboundLists)
                .set({ status: 'applied', updatedAt: new Date() })
                .where(eq(inboundLists.id, id));

            // Create inbound plan if needed
            // ... business logic

            return { id, status: 'applied', message: '입고신청이 완료되었습니다.' };
        }, tx);
    }

    async immediateReceive(id: string, dto: ImmediateReceiveDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            // Get inbound list item
            const item = await tx
                .select()
                .from(inboundLists)
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!item[0]) throw new NotFoundException('Inbound list item not found');

            // Create inbound receipt
            const receipt = await this.inboundService.simpleInbound({
                warehouseId: dto.warehouseId,
                locationId: dto.locationId,
                items: [{
                    skuId: item[0].skuId,
                    quantity: dto.actualQuantity ?? item[0].quantity,
                }],
            }, tx);

            // Update inbound list status
            await tx
                .update(inboundLists)
                .set({ status: 'confirmed', updatedAt: new Date() })
                .where(eq(inboundLists.id, id));

            return {
                id,
                receiptId: receipt.id,
                status: 'confirmed',
                message: '입고가 완료되었습니다.',
            };
        }, tx);
    }

    async generateBarcode(id: string) {
        // Get item details
        const item = await this.db
            .select()
            .from(inboundLists)
            .innerJoin(skus, eq(inboundLists.skuId, skus.id))
            .where(eq(inboundLists.id, id))
            .limit(1);

        if (!item[0]) throw new NotFoundException('Inbound list item not found');

        // Generate barcode (CODE128 or QR)
        const barcodeValue = item[0].skus.defaultBarcode ?? item[0].inbound_lists.barcode;
        const barcodeImage = await this.barcodeService.generateBarcodeImage(barcodeValue);

        return {
            barcodeValue,
            barcodeImage, // Base64 encoded
            format: 'CODE128',
        };
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}
```

#### 2. Barcode Print Queue System (MEDIUM Priority)

**Schema Addition:**
```typescript
export const printJobStatusEnum = pgEnum('print_job_status', [
    'pending',
    'printing',
    'completed',
    'failed'
]);

export const barcodePrintJobs = pgTable('barcode_print_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    inboundListId: uuid('inbound_list_id')
        .references(() => inboundLists.id)
        .notNull(),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull(),
    status: printJobStatusEnum('status').notNull().default('pending'),
    printerName: varchar('printer_name', { length: 100 }),
    copies: integer('copies').notNull().default(1),
    printedAt: timestamp('printed_at'),
    printedBy: uuid('printed_by'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Service**: `apps/wms/src/common/services/barcode-print.service.ts`
```typescript
@Injectable()
export class BarcodePrintService {
    async createPrintJob(inboundListId: string, copies: number = 1) {
        // Create print job in database
        // Return job ID for tracking
    }

    async getPrintQueue(status?: string) {
        // List print jobs with optional status filter
    }

    async markAsPrinted(jobId: string, userId: string) {
        // Update job status to 'completed'
    }

    async generateBarcodeImage(value: string, format: 'CODE128' | 'QR' = 'CODE128') {
        // Use library like 'bwip-js' to generate barcode image
        // Return base64 encoded image
    }
}
```

#### 3. Purchase Order Audit Workflow (MEDIUM Priority)

**Schema Addition:**
```typescript
export const poAuditStatusEnum = pgEnum('po_audit_status', [
    'draft',
    'pending_audit',
    'approved',
    'rejected'
]);

// Add to purchaseOrders table
ALTER TABLE purchase_orders
ADD COLUMN audit_status VARCHAR(20) DEFAULT 'draft',
ADD COLUMN submitted_for_audit_at TIMESTAMP,
ADD COLUMN approved_by UUID,
ADD COLUMN approved_at TIMESTAMP,
ADD COLUMN rejection_reason VARCHAR(500);
```

**Controller Extension:**
```typescript
// Add to apps/wms/src/inbound/controllers/purchase-order.controller.ts

@Put(':id/submit-for-audit')
async submitForAudit(@Param('id') id: string) {
    return this.purchaseOrderService.submitForAudit(id);
}

@Put(':id/approve')
async approvePurchaseOrder(
    @Param('id') id: string,
    @Body() dto: ApprovePODto,
    @Req() req: any
) {
    return this.purchaseOrderService.approvePurchaseOrder(id, req.user.id, dto);
}

@Put(':id/reject')
async rejectPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: RejectPODto,
    @Req() req: any
) {
    return this.purchaseOrderService.rejectPurchaseOrder(id, req.user.id, dto);
}
```

#### 4. MOQ Validation System (MEDIUM Priority)

**Schema Addition:**
```typescript
// Add to suppliers table
ALTER TABLE suppliers
ADD COLUMN moq INTEGER,
ADD COLUMN lead_time_days INTEGER,
ADD COLUMN shipping_fee_threshold INTEGER;

// Or create separate MOQ rules table
export const supplierMoqRules = pgTable('supplier_moq_rules', {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
        .references(() => suppliers.id)
        .notNull(),
    minimumQuantity: integer('minimum_quantity').notNull(),
    minimumAmount: integer('minimum_amount'),
    shippingFeeThreshold: integer('shipping_fee_threshold'),
    leadTimeDays: integer('lead_time_days').notNull().default(7),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Validation Service:**
```typescript
@Injectable()
export class SupplierValidationService {
    async validateMOQ(supplierId: string, quantity: number) {
        const supplier = await this.getSupplier(supplierId);
        
        if (supplier.moq && quantity < supplier.moq) {
            throw new BadRequestException(
                `주문 수량 ${quantity}개가 최소 주문 수량 ${supplier.moq}개보다 적습니다.`
            );
        }
    }

    async calculateExpectedArrival(supplierId: string, orderDate: Date): Promise<Date> {
        const supplier = await this.getSupplier(supplierId);
        const leadTime = supplier.leadTimeDays ?? 7;
        
        const arrival = new Date(orderDate);
        arrival.setDate(arrival.getDate() + leadTime);
        
        return arrival;
    }

    async getSafetyStockWarnings(warehouseId?: string) {
        // Query stock_summary for items below safety stock
        // Return list of SKUs needing reorder
    }
}
```

---

## Implementation Recommendations

### Priority 1: Critical Path (Week 1-2)

#### 1. Implement Inbound Lists Controller and Service
**Effort**: 3-4 days
**Files to Create/Modify:**
- `/apps/wms/src/inbound/controllers/inbound-list.controller.ts` (NEW)
- `/apps/wms/src/inbound/services/inbound-list.service.ts` (NEW)
- `/apps/wms/src/inbound/dto/inbound-list.dto.ts` (NEW)
- `/apps/wms/src/inbound/inbound.module.ts` (MODIFY - add new providers)

**Key Endpoints:**
```
GET    /wms/inbound/lists
GET    /wms/inbound/lists/:id
POST   /wms/inbound/lists/:id/apply
POST   /wms/inbound/lists/:id/receive
```

#### 2. Extend Status Enums
**Effort**: 1 day
**Files to Modify:**
- `/apps/wms/database/schemas/wms-schema.ts`

**Changes:**
```typescript
// Update enum
export const inboundStatusEnum = pgEnum('inbound_status', [
    'pending',
    'applied',
    'confirmed',
    'receiving'
]);

// Add new enum
export const poAuditStatusEnum = pgEnum('po_audit_status', [
    'draft',
    'pending_audit',
    'approved',
    'rejected'
]);
```

**Migration:**
```sql
-- Run drizzle migration
npm run db:generate.wms
npm run db:push.wms
```

#### 3. Add Comprehensive Filtering
**Effort**: 2 days
**Files to Modify:**
- `/apps/wms/src/inbound/services/inbound-list.service.ts`

**Filter Support:**
- Date range (startDate, endDate)
- Status filter (multi-select)
- Supplier filter
- Warehouse filter
- Barcode/SKU search
- Pagination (limit, offset)

### Priority 2: Enhanced Features (Week 3)

#### 1. Barcode Management System
**Effort**: 2-3 days

**Tasks:**
- Create `barcodePrintJobs` table
- Implement `BarcodePrintService`
- Add barcode generation endpoint
- Integrate barcode library (bwip-js)

#### 2. Purchase Order Audit Workflow
**Effort**: 2 days

**Tasks:**
- Add audit columns to `purchase_orders`
- Implement audit endpoints (submit, approve, reject)
- Add audit history tracking
- Update status transitions

#### 3. MOQ Validation
**Effort**: 1-2 days

**Tasks:**
- Add MOQ fields to suppliers
- Implement validation in cart service
- Add safety stock warning endpoint
- Calculate expected arrival dates

### Priority 3: Testing and Documentation (Week 4)

#### 1. Unit Tests
**Effort**: 2 days
- Test all new service methods
- Test enum validations
- Test business logic

#### 2. Integration Tests
**Effort**: 2 days
- Test complete workflows
- Test transaction integrity
- Test error handling

#### 3. API Documentation
**Effort**: 1 day
- Update Swagger/OpenAPI specs
- Document new endpoints
- Provide usage examples

### Total Implementation Timeline

| Phase | Tasks | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Week 1** | Inbound Lists API + Status Enums | 4-5 days | Schema changes |
| **Week 2** | Filtering + Basic Testing | 3-4 days | Week 1 complete |
| **Week 3** | Barcode + Audit + MOQ | 5-6 days | Week 1 complete |
| **Week 4** | Testing + Documentation | 3-4 days | All features complete |

**Total Effort**: 15-19 days (~3-4 weeks)

---

## API Specifications - New Endpoints

### Inbound Lists API

#### GET /wms/inbound/lists
**Description**: List inbound items with comprehensive filtering

**Query Parameters:**
```typescript
{
    status?: 'pending' | 'applied' | 'confirmed' | 'receiving';
    supplierId?: string;              // UUID
    warehouseId?: string;             // UUID
    purchaseOrderId?: string;         // UUID
    startDate?: string;               // YYYY-MM-DD
    endDate?: string;                 // YYYY-MM-DD
    barcodeSearch?: string;           // Partial match
    skuSearch?: string;               // Partial match on SKU name/code
    limit?: number;                   // Default: 50
    offset?: number;                  // Default: 0
}
```

**Response:**
```typescript
{
    items: Array<{
        id: string;
        poId: string;
        purchaseOrder: {
            id: string;
            type: 'domestic' | 'foreign';
            expectedArrival: string | null;
            supplier: {
                id: string;
                name: string;
            };
        };
        sku: {
            id: string;
            name: string;
            code: string;
            defaultBarcode: string | null;
        };
        quantity: number;
        barcode: string | null;
        status: 'pending' | 'applied' | 'confirmed';
        createdAt: string;
        updatedAt: string;
    }>;
    total: number;
    limit: number;
    offset: number;
}
```

#### POST /wms/inbound/lists/:id/apply
**Description**: Apply for inbound (status: pending → applied)

**Request Body:**
```typescript
{
    notes?: string;
    expectedDate?: string; // YYYY-MM-DD (optional override)
}
```

**Response:**
```typescript
{
    id: string;
    status: 'applied';
    appliedAt: string;
    message: '입고신청이 완료되었습니다.';
}
```

#### POST /wms/inbound/lists/:id/receive
**Description**: Execute immediate inbound receipt

**Request Body:**
```typescript
{
    warehouseId: string;              // Required
    locationId?: string;              // Optional location
    actualQuantity?: number;          // Optional (use expected if not provided)
    notes?: string;
}
```

**Response:**
```typescript
{
    id: string;
    receiptId: string;                // Created inbound receipt ID
    lineId: string;                   // Receipt line ID
    stockEventId: string;             // Stock event ID
    status: 'confirmed';
    message: '입고가 완료되었습니다.';
}
```

#### GET /wms/inbound/lists/:id/barcode
**Description**: Generate barcode for inbound item

**Response:**
```typescript
{
    barcodeValue: string;             // Barcode text value
    barcodeImage: string;             // Base64 encoded PNG
    format: 'CODE128' | 'QR';         // Barcode format
    printJobId?: string;              // Print job ID if created
}
```

### Barcode Print API

#### POST /wms/barcode/print-jobs
**Description**: Create barcode print job

**Request Body:**
```typescript
{
    inboundListIds: string[];         // Array of inbound list IDs
    printerName?: string;             // Optional printer selection
    copies?: number;                  // Default: 1
}
```

**Response:**
```typescript
{
    jobIds: string[];                 // Created print job IDs
    totalJobs: number;
    message: '바코드 인쇄 작업이 생성되었습니다.';
}
```

#### GET /wms/barcode/print-jobs
**Description**: List print jobs

**Query Parameters:**
```typescript
{
    status?: 'pending' | 'printing' | 'completed' | 'failed';
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
}
```

### Purchase Order Audit API

#### PUT /wms/purchase-orders/:id/submit-for-audit
**Description**: Submit purchase order for approval

**Response:**
```typescript
{
    id: string;
    auditStatus: 'pending_audit';
    submittedAt: string;
    message: '발주가 승인 대기 상태로 변경되었습니다.';
}
```

#### PUT /wms/purchase-orders/:id/approve
**Description**: Approve purchase order

**Request Body:**
```typescript
{
    notes?: string;                   // Optional approval notes
}
```

**Response:**
```typescript
{
    id: string;
    auditStatus: 'approved';
    approvedBy: string;               // User ID
    approvedAt: string;
    message: '발주가 승인되었습니다.';
}
```

#### PUT /wms/purchase-orders/:id/reject
**Description**: Reject purchase order

**Request Body:**
```typescript
{
    reason: string;                   // Required rejection reason
}
```

**Response:**
```typescript
{
    id: string;
    auditStatus: 'rejected';
    rejectionReason: string;
    rejectedBy: string;               // User ID
    rejectedAt: string;
    message: '발주가 반려되었습니다.';
}
```

### Supplier MOQ API

#### GET /wms/suppliers/:id/moq-rules
**Description**: Get supplier MOQ rules and constraints

**Response:**
```typescript
{
    supplierId: string;
    moq: number | null;               // Minimum order quantity
    leadTimeDays: number;             // Delivery lead time
    shippingFeeThreshold: number | null;  // Free shipping threshold
    constraints: {
        minimumAmount: number | null;     // Minimum order value
        requiresApproval: boolean;
        notes: string | null;
    };
}
```

---

## Testing Requirements

### Unit Tests

**Inbound List Service Tests:**
```typescript
describe('InboundListService', () => {
    it('should list inbound lists with filters', async () => {
        const result = await service.listInboundLists({
            status: 'pending',
            limit: 10,
        });
        expect(result.items).toHaveLength(10);
    });

    it('should apply inbound and change status', async () => {
        const result = await service.applyInbound('list-id', {});
        expect(result.status).toBe('applied');
    });

    it('should execute immediate receive and create stock event', async () => {
        const result = await service.immediateReceive('list-id', {
            warehouseId: 'wh-id',
            actualQuantity: 100,
        });
        expect(result.receiptId).toBeDefined();
        expect(result.stockEventId).toBeDefined();
    });

    it('should validate status transitions', async () => {
        await expect(
            service.applyInbound('confirmed-item-id', {})
        ).rejects.toThrow('Invalid status transition');
    });
});
```

**Purchase Order Audit Tests:**
```typescript
describe('PurchaseOrderService - Audit', () => {
    it('should submit PO for audit', async () => {
        const result = await service.submitForAudit('po-id');
        expect(result.auditStatus).toBe('pending_audit');
    });

    it('should approve PO', async () => {
        const result = await service.approvePurchaseOrder('po-id', 'user-id', {});
        expect(result.auditStatus).toBe('approved');
        expect(result.approvedBy).toBe('user-id');
    });

    it('should reject PO with reason', async () => {
        const result = await service.rejectPurchaseOrder('po-id', 'user-id', {
            reason: '가격이 너무 높음',
        });
        expect(result.auditStatus).toBe('rejected');
        expect(result.rejectionReason).toBe('가격이 너무 높음');
    });
});
```

### Integration Tests

**Complete Workflow Test:**
```typescript
describe('Inbound Workflow E2E', () => {
    it('should complete full inbound flow', async () => {
        // 1. Create PO
        const po = await createPurchaseOrder({
            type: 'domestic',
            supplierId: 'supplier-id',
            lines: [{ skuId: 'sku-id', quantity: 100 }],
        });

        // 2. Check inbound list created
        const lists = await listInboundLists({ purchaseOrderId: po.id });
        expect(lists.items).toHaveLength(1);

        // 3. Apply inbound
        const applied = await applyInbound(lists.items[0].id, {});
        expect(applied.status).toBe('applied');

        // 4. Generate barcode
        const barcode = await generateBarcode(lists.items[0].id);
        expect(barcode.barcodeValue).toBeDefined();

        // 5. Execute receipt
        const receipt = await immediateReceive(lists.items[0].id, {
            warehouseId: 'wh-id',
        });
        expect(receipt.receiptId).toBeDefined();

        // 6. Verify stock updated
        const stock = await getStockSummary('sku-id', 'wh-id');
        expect(stock.onHand).toBe(100);
    });
});
```

---

## Migration Script

```sql
-- Migration: Add Inbound and Audit Features
-- Date: 2025-10-13

-- 1. Extend inbound status enum
ALTER TYPE inbound_status ADD VALUE IF NOT EXISTS 'applied';
ALTER TYPE inbound_status ADD VALUE IF NOT EXISTS 'receiving';

-- 2. Add audit status enum
CREATE TYPE po_audit_status AS ENUM (
    'draft',
    'pending_audit',
    'approved',
    'rejected'
);

-- 3. Add audit columns to purchase_orders
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS audit_status po_audit_status DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS submitted_for_audit_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS approved_by UUID,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500);

-- 4. Create barcode print jobs table
CREATE TABLE IF NOT EXISTS barcode_print_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inbound_list_id UUID NOT NULL REFERENCES inbound_lists(id) ON DELETE CASCADE,
    barcode_value VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    printer_name VARCHAR(100),
    copies INTEGER NOT NULL DEFAULT 1,
    printed_at TIMESTAMP,
    printed_by UUID,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 5. Add MOQ fields to suppliers
ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS moq INTEGER,
ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS shipping_fee_threshold INTEGER;

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_inbound_lists_status ON inbound_lists(status);
CREATE INDEX IF NOT EXISTS idx_inbound_lists_po ON inbound_lists(po_id);
CREATE INDEX IF NOT EXISTS idx_po_audit_status ON purchase_orders(audit_status);
CREATE INDEX IF NOT EXISTS idx_barcode_jobs_status ON barcode_print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_barcode_jobs_list ON barcode_print_jobs(inbound_list_id);

-- 7. Add comments for documentation
COMMENT ON COLUMN purchase_orders.audit_status IS 'Approval workflow status';
COMMENT ON COLUMN suppliers.moq IS 'Minimum order quantity';
COMMENT ON TABLE barcode_print_jobs IS 'Queue for barcode printing operations';
```

---

## Summary and Next Steps

### Key Findings

1. **Backend Foundation**: Solid schema design with proper separation of concerns
   - ✅ Purchase order management
   - ✅ Cart functionality
   - ✅ Inbound receipts and stock events
   - ⚠️ Missing: Inbound list management, audit workflow, barcode system

2. **Status Alignment Issues**: UI shows status values not in backend enums
   - Need to extend `inboundStatusEnum` to include 'applied' and 'receiving'
   - Need to add `poAuditStatusEnum` for purchase approval workflow

3. **Missing Features**: Several UI features require backend implementation
   - Inbound list CRUD and workflow APIs (HIGH priority)
   - Barcode generation and print queue (MEDIUM priority)
   - Purchase order audit workflow (MEDIUM priority)
   - MOQ validation system (MEDIUM priority)

### Implementation Roadmap

**Week 1-2: Critical Path**
- Implement Inbound Lists API
- Extend status enums
- Add comprehensive filtering
- **Deliverable**: Functional inbound list management

**Week 3: Enhanced Features**
- Barcode management system
- Purchase order audit workflow
- MOQ validation
- **Deliverable**: Complete workflow support

**Week 4: Quality Assurance**
- Unit and integration tests
- API documentation
- Performance optimization
- **Deliverable**: Production-ready system

### Effort Estimate
- **Backend Development**: 15-19 days
- **Testing**: 3-4 days
- **Documentation**: 1-2 days
- **Total**: ~4-5 weeks

### Success Metrics
- All UI screens functional with backend support
- Status values properly mapped
- Complete workflows tested end-to-end
- API documentation updated
- Performance benchmarks met

---

**Analysis Completed**: 2025-10-13
**Analyzed Files**:
- `almondyoung-figma-png/inventory/inbound-list-1.png`
- `almondyoung-figma-png/inventory/inbound-list-2.png`
- `almondyoung-figma-png/inventory/purchase-inquery.png`
- `almondyoung-figma-png/inventory/purchase-cart-inquery.png`

**Backend References**:
- `/apps/wms/database/schemas/wms-schema.ts`
- `/apps/wms/src/inbound/controllers/inbound.controller.ts`
- `/apps/wms/src/inbound/controllers/purchase-order.controller.ts`
- `/apps/wms/src/inbound/services/inbound.service.ts`
- `/apps/wms/src/inbound/services/purchase-order.service.ts`

