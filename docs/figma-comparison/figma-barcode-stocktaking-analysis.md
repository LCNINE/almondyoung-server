# Figma Design Analysis: Barcode, Sales Products, and Stocktaking

This document provides a detailed analysis of the Figma design screenshots for barcode management, sales product creation, and stocktaking functionality. The analysis focuses on backend requirements, data models, and integration points.

---

## 1. Sales Product Barcode Management (상품 바코드 관리)

**File**: `almondyoung-figma-png/inventory/barcode-management.png`

### 1.1 Page Overview
- **Purpose**: Product barcode management interface for viewing and managing barcodes associated with sales products
- **Navigation Path**: 재고&상품 > 주입/출고 > 주입/출고 > 주입내역 목록 (visible in breadcrumb)
- **Current Selection**: 상품 바코드 관리 (Product Barcode Management)

### 1.2 UI Components

#### Search Section
- **Search Type Dropdown**: "검색항목" (Search Item)
- **Search Value Dropdown**: "통합 검색" (Integrated Search)
- **Search Input Field**: Free text input
- **Search Button**: "검색" (Search) - Orange/yellow button

#### Filter Options
- **Buttons for filtering**:
  - "재고 다운로드" (Stock Download)
  - "선택항목 인쇄하기 추가" (Add Selected Items to Print)
  - "인쇄하기 없음 10" (No Print 10)
  - "바코드만 취급생성" (Barcode Only Generate)

#### Data Grid Columns
1. **Checkbox**: Row selection
2. **바코드 번호** (Barcode Number): e.g., "123059493834"
3. **이미지** (Image): Product thumbnail display (shows 2 small bottles)
4. **상품명 버전S1,2** (Product Name Version S1,2):
   - Shows product title: "더블 M 논와이오 바이탈 에센 딥영 14ml 2종 (단양-Me와이오 탄영)"
   - Multiple badge tags: "바코드 1", "추항", "바코드 2", "추항", "변동 내역"
5. **위치** (Location): e.g., "J-07-36"
6. **발주처** (Supplier): "누누상"
7. **인쇄** (Print): Numeric input field (default "10")
8. **인쇄** (Print Action): Button labeled "인쇄" (Print)
9. **인쇄 대기** (Print Queue): Button labeled "인쇄 대기" (Print Queue)

#### Pagination
- "페이지/페이0" (Page/Page 0) - appears at bottom

### 1.3 Data Fields & Schema Requirements

#### Required Database Tables
- **Table**: Likely extends existing `sku_barcodes` and `skus` tables
- **New/Modified Fields**:
  - Barcode printing queue status
  - Print count tracking
  - Version tracking (S1, S2 badges)
  - Location reference (already exists in stock_summary)

#### Data Model Considerations
```typescript
// Existing schema is sufficient, but may need:
interface BarcodePrintJob {
  id: uuid;
  barcodeId: uuid;        // references sku_barcodes.id
  skuId: uuid;            // references skus.id
  printQuantity: integer;
  status: 'pending' | 'printing' | 'completed' | 'failed';
  createdAt: timestamp;
  printedAt: timestamp;
}
```

### 1.4 Backend Operations
1. **GET /api/wms/inventory/barcodes/list**
   - Search/filter barcodes by various criteria
   - Include product details, location, supplier
   - Pagination support

2. **POST /api/wms/inventory/barcodes/print**
   - Add barcodes to print queue
   - Specify print quantity

3. **GET /api/wms/inventory/barcodes/print-queue**
   - Retrieve pending print jobs

4. **POST /api/wms/inventory/barcodes/download-stock**
   - Export stock data for selected barcodes

### 1.5 Business Logic
- Barcode can have multiple tags/badges (version indicators)
- Print queue management system
- Location tracking per barcode/SKU
- Supplier association
- Batch print capability (select multiple, specify quantity)

### 1.6 Integration Points
- **Inventory Module**: Links to SKU and stock location data
- **Supplier Module**: Displays supplier information
- **Print Service**: Manages barcode printing queue
- **Location Module**: Shows current warehouse location

---

## 2. Location Barcode Management (위치 바코드 관리)

**File**: `almondyoung-figma-png/inventory/location-barcode-management.png`

### 2.1 Page Overview
- **Purpose**: Manage location-specific barcodes for warehouse locations
- **Navigation**: Same as above (재고&상품 > 주입/출고 > 주입내역 목록)
- **Current Selection**: 위치 바코드 관리 (Location Barcode Management)

### 2.2 UI Components

#### Search Section (Top)
- **Left Input**: "위치바코드 검색" (Location Barcode Search) with orange "검색" button
- **Right Input**: "위치바코드 입력" (Location Barcode Input) with orange "입력" button

#### Tab Navigation
- **총 위치 바코드 수 1건** (Total Location Barcodes: 1)
- **Tab 1**: "선택된 항목 인쇄" (Print Selected Items)
- **Tab 2**: "선택된 항목 삭제" (Delete Selected Items)

#### Data Grid Columns
1. **Checkbox**: Row selection
2. **번호** (Number): Sequential number (1)
3. **바코드 번호** (Barcode Number): "123059493834"
4. **위치 바코드번호** (Location Barcode Number): "A-01-02"
5. **등록일시** (Registration Date): "2021-04-08 오후 2:33:41"
6. **삭제** (Delete): Button labeled "삭제" (Delete)

#### Pagination
- "페이지/페이0" (Page/Page 0)

### 2.3 Data Fields & Schema Requirements

#### Required Database Table
```typescript
// New table: location_barcodes
interface LocationBarcode {
  id: uuid;
  locationId: uuid;           // references locations.id
  barcode: string;            // unique barcode for location
  locationCode: string;       // A-01-02 format
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

#### Existing Table Usage
- Uses `locations` table from WMS schema
- Location code format: `{Column}-{Rack}-{Bin}` (e.g., A-01-02)

### 2.4 Backend Operations
1. **GET /api/wms/locations/barcodes**
   - List all location barcodes
   - Search by barcode or location code
   - Pagination

2. **POST /api/wms/locations/barcodes**
   - Create location barcode
   - Generate barcode for location
   - Validate location exists

3. **DELETE /api/wms/locations/barcodes/:id**
   - Remove location barcode
   - Validate no active stock movements

4. **POST /api/wms/locations/barcodes/print**
   - Print selected location barcodes
   - Batch printing support

### 2.5 Business Logic
- Each warehouse location can have a dedicated barcode
- Location barcode enables quick scanning during:
  - Putaway operations
  - Stock movements
  - Picking operations
  - Stocktaking
- Format: Column-Rack-Bin (A-01-02)
- Immutable once created (delete and recreate if needed)

### 2.6 Integration Points
- **Location Module**: Core dependency on `locations` table
- **Inbound Module**: Used during putaway scanning
- **Outbound Module**: Used during picking location verification
- **Movement Module**: Used for inter/intra-warehouse transfers
- **Stocktaking Module**: Location verification during counting

---

## 3. Create Sales Product Form (Part 1)

**File**: `almondyoung-figma-png/inventory/create-sales-product-form-1.png`

### 3.1 Page Overview
- **Purpose**: Create new sales product (재고 생성) with comprehensive form fields
- **Form Type**: Multi-step form with tabs at top
- **Right Panel**: Contains detailed guidelines and help text

### 3.2 UI Components & Form Fields

#### Tab Navigation (Top)
- **기존 재고 버튼** (Existing Stock Button)
- **수동 재고 버튼** (Manual Stock Button)
- **재고상품 입력** (Stock Product Input) - Orange button (active)

#### Left Panel - Main Form

##### Section 1: Basic Information (상품 구매)
- **상품 구매** (Product Purchase): Dropdown
- **사업자명칭** (Business Name): Text input with "관리" (manage) and "신규 등록" (new registration) buttons
- **공급자(발주처)** (Supplier/Purchase Order): Dropdown "공급자 선택" (select supplier)
- **상품정보** (Product Information): Empty text box with "+ 사업자 추가" (add business) button

##### Section 2: Option Management (판가)
- **판가** (Selling Price): Numeric input with up/down arrows
- **Label**: "+ 사업자 추가" (Add Business)
- **옵션 그룹** (Option Group): Text input
- **반품** (Return): Text input with checkboxes for "사업자 허용" (business allowed)

##### Section 3: Product Matrix (반가)
Table with columns:
1. **번호** (Number)
2. **옵션1/사용** (Option 1/Usage): Shows "JOI377/5mm"
3. **옵션2/성별명** (Option 2/Gender): Empty
4. **출고담당자** (Shipping Manager): Image icon
5. **판가** (Selling Price): Numeric input "0" with "원" (won)
6. **재고** (Stock)

Rows 1-4 all show "JOI377/5mm" in Option 1 column

##### Section 4: Stock Information (상품성명)
- **MOQ** (Minimum Order Quantity): Text input
- **매입2** (Purchase 2): Text input
- **매입3** (Purchase 3): Text input
- **매입4** (Purchase 4): Text input

#### Bottom Button
- **기본 재고 생성** (Create Basic Stock) - Orange button

### 3.3 Right Panel - Guidelines

#### 재고 생성(자동) - Stock Creation (Automatic)
Explains the automatic stock creation process linked to sales product creation.

#### 재고명로 판매 등록 후 자동으로 재고 생성 (Automatic Stock Creation after Sales Registration)
Instructions on how stock is auto-created based on sales product info.

**Key Points**:
- Product info must be entered first
- Automatic linking to sales channels
- At least 1 option required; if no options, single quantity stock is created

#### 수동/자동관리 (Manual/Automatic Management)
- Manual management: direct stock entry
- Automatic: synced with sales product row count
- Cannot switch from row mode to quantity mode once set

#### 상품명 selected box (Product Name Select Box)
- List format: name / code / image
- Shows external system product names

#### 판가 (Selling Price)
- Enter base price excluding options
- Can enter 0 if option-based pricing

#### 옵션 그룹명/옵션 명 (Option Group Name/Option Name)
- Each product can have multiple option groups
- Examples: size, color, capacity
- Must click autocomplete or manually enter option

#### 중요 노트 (Important Notes)
- **Red warning**: Once option structure is created, cannot edit option groups. Must delete and recreate.

### 3.4 Data Fields & Schema Requirements

#### PIM Integration
This form directly creates/updates:
- `product_masters` (PIM)
- `product_option_groups` (PIM)
- `product_option_values` (PIM)
- `product_variants` (PIM)

#### WMS Integration
Creates corresponding WMS entities:
- `inventory_product_masters`
- `skus`
- `sku_barcodes` (optional/generated)

#### Business Entity Fields
```typescript
interface CreateSalesProductDto {
  // Basic Info
  businessName: string;
  supplierId: uuid;
  productInfo: string;

  // Pricing
  basePrice: number;

  // Options
  optionGroups: Array<{
    name: string;
    displayName: string;
    values: Array<{
      value: string;
      displayName: string;
    }>;
  }>;

  // Variants (from matrix)
  variants: Array<{
    optionCombination: Record<string, string>; // { color: 'red', size: 'M' }
    price: number;
    sku?: string; // optional manual SKU
  }>;

  // Stock settings
  moq?: number;
  purchasePrice2?: number;
  purchasePrice3?: number;
  purchasePrice4?: number;
}
```

### 3.5 Backend Operations
1. **POST /api/pim/products/create**
   - Create product master with options
   - Auto-generate variants based on option matrix
   - Create WMS SKUs in parallel

2. **GET /api/pim/businesses**
   - List registered businesses for dropdown

3. **GET /api/pim/suppliers**
   - List suppliers for selection

4. **POST /api/pim/products/validate-options**
   - Validate option structure before save

### 3.6 Business Logic
- **Immutable Option Structure**: Once options are created, they cannot be modified (must delete and recreate)
- **Variant Generation**: System auto-generates all possible variant combinations from option matrix
- **SKU Auto-creation**: Each variant creates a corresponding WMS SKU
- **Pricing Strategy**: Base price + variant adjustments
- **MOQ Tracking**: Minimum order quantity for purchasing

### 3.7 Integration Points
- **PIM Service**: Primary service for product master creation
- **WMS Inventory Service**: Creates inventory masters and SKUs
- **Supplier Module**: Links to supplier data
- **Business Registration**: Manages business entity relationships

---

## 4. Create Sales Product Form (Part 2)

**File**: `almondyoung-figma-png/inventory/create-sales-product-form-2.png`

### 4.1 Page Overview
This appears to show additional sections and workflow states of the sales product creation form, including quality control, pricing tiers, and packaging information.

### 4.2 UI Components & Additional Sections

#### Tab Navigation (Same as Part 1)
- 기존 재고 버튼 (Existing Stock)
- 수동 재고 버튼 (Manual Stock)
- 재고상품 입력 (Stock Product Input) - Orange/active

#### Additional Form Sections Visible

##### Product Matrix (Continued from Part 1)
Extended table showing more columns and functionality

##### 중요 공지 (Important Notice) - Red Warning Box
Text indicates important rules about option management and limitations.

##### 단위 정보 (Unit Information) Section
Shows packaging and unit details

##### 제고생품 선택 (Stock Product Selection)
Dropdown or selection interface

##### 반품 공지 (Return Notice) - Red Warning Box (Bottom Left)
Contains return policy warnings about domestic returns vs overseas returns

#### Bottom Section - Three Workflow Panels

##### Left Panel: 단위 선택 (Unit Selection)
- Shows numbered list (1-2) with expandable items
- **노동: 유모등 식기 사세트 예쁘 유리** (Product description)
  - Tag: **자동식분류** (Auto classification)
- Another product with **→** expand icon
- Checkboxes for selection
- **재고생품 생성** (Create Stock Product) button at bottom

##### Middle Panel: 재고생품 선택 (Stock Product Selection)
Contains selection list numbered 1-2 with:
- **노동: 유모등 식기 사세트 예쁘 유리**
- Expandable dropdown arrows
- Multiple selection options with orange "선택" (Select) buttons
- **재고생품 선택 완료** (Stock Product Selection Complete) button

##### Right Panel: 완제 발행 (Invoice Issue)
Shows table with columns:
- **분류** (Classification)
- **제고생품 명** (Stock Product Name)
- **공급자** (Supplier)

Rows show:
1. **발생처** | **노동: 유모등 식기 사세트...** | **지정내역**
2. Empty row with selection button

**재고생품 선택 불** (Stock Product Selection) section below
Shows product listing with image

Bottom buttons in sequence:
- **제고생품 수정 버튼** (Edit Stock Product)
- **제고생품 선택 완료** (Complete Stock Product Selection)
- **제고생품 등록** (Register Stock Product) - Orange

### 4.3 Right Panel Guidelines (Continued)

#### 재고 생성(상품별) - Stock Creation (Per Product)
Explains per-product stock creation methodology

#### 재고생품을 검색하여 판매상품에 매칭 (Search and Match Stock Products to Sales Products)
Step-by-step matching process between inventory and sales products

**Workflow**:
1. Select sales channel
2. Search for inventory products
3. Complete matching
4. Can create new stock products if none exist

#### 중요 노트시스 (Important Notes)
Red warning about option-based pricing and returns:
- Option-based pricing rules cannot be modified after creation
- Different rules apply based on shipping origin (domestic vs overseas)

#### 재고 생성안내 (Stock Creation Guide)
Explains stock generation rules:
- Auto-generated based on row count for automatic management
- Manual mode: direct numeric input
- Once set, cannot switch between modes

#### 반품 공지 (Return Notice)
Important policies regarding returns:
- Domestic returns: subject to standard return policy
- Overseas/direct shipping: stricter return conditions
- Specify return address for each supplier

### 4.4 Data Fields & Schema Requirements

#### Additional Fields Identified

##### Packaging/Unit Information
```typescript
interface ProductUnitInfo {
  unitType: 'single' | 'bundle' | 'case';
  unitsPerBundle?: number;
  bundlesPerCase?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'cm' | 'mm';
  };
  weight?: {
    value: number;
    unit: 'kg' | 'g';
  };
}
```

##### Return Policy
```typescript
interface ReturnPolicy {
  allowReturns: boolean;
  returnWindowDays: number;
  returnAddress?: string;
  restrictions?: string;
  domesticReturnAllowed: boolean;
  overseasReturnAllowed: boolean;
}
```

##### Sales Channel Matching
```typescript
interface ProductSalesChannelMapping {
  id: uuid;
  productMasterId: uuid;
  salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
  channelProductId?: string;
  isActive: boolean;
  channelSpecificSettings?: Record<string, any>;
}
```

### 4.5 Backend Operations

1. **POST /api/pim/products/match-inventory**
   - Match sales product to inventory SKU
   - Create product_variant_sku_links

2. **GET /api/pim/products/search-inventory**
   - Search existing inventory products for matching
   - Filter by name, code, supplier

3. **POST /api/pim/products/unit-info**
   - Save packaging and unit information
   - Update product master metadata

4. **POST /api/pim/products/return-policy**
   - Configure return policy settings
   - Validate based on supplier type (domestic/overseas)

5. **POST /api/pim/products/sales-channels**
   - Link product to sales channels
   - Configure channel-specific settings

### 4.6 Business Logic

#### Product-SKU Matching Workflow
1. Select sales channel
2. Search for existing inventory products
3. Map sales product variants to inventory SKUs
4. If no match found, create new SKU
5. Configure channel-specific settings

#### Immutability Rules
- Option structure cannot be modified after creation
- Pricing strategy cannot be switched after first save
- Return policy restrictions based on supplier location

#### Multi-channel Support
- Same product master can be mapped to multiple channels
- Channel-specific pricing and availability
- Channel-specific product names/descriptions

### 4.7 Integration Points
- **PIM Product Service**: Core product management
- **WMS Inventory Service**: SKU matching and creation
- **Sales Channel Module**: Multi-channel product syndication
- **Supplier Module**: Return policy based on supplier type
- **Fulfillment Module**: Determines fulfillment mode (in-house/3PL/drop-ship)

---

## 5. Stocktaking (재고 이력 / Inventory Count)

**File**: `almondyoung-figma-png/inventory/stocktaking.png`

### 5.1 Page Overview
- **Purpose**: Conduct physical inventory counts and reconcile with system records
- **Navigation**: 재고&상품 > 주입/출고 > 주입내역 목록
- **Feature**: 상품 위치 이력 (Product Location History) - highlighted in left menu

### 5.2 UI Components

#### Top Section - Search/Selection
- **검색** (Search) tab - Blue highlight
- **전체 선택** (Select All)
- **바코드 스캔** (Barcode Scan) - Yellow input field with red border (indicates scan mode)
- **Button Row**:
  - "위치바코드 스캔 시 자동차생성대기" (Auto-generate on location scan)
  - Red button on right: "상품 대기 초기화" (Reset Product Queue)

#### Middle Section - Scan Mode
- **파란 스캔** (Blue Scan) button - Indicates active scanning mode

#### Filter Tabs
- **인쇄 위치코드** (Print Location Code)
- **납품 재고 수** (Delivery Stock Count)
- **선별일자** (Selection Date)

#### Data Grid Section
Headers visible (empty grid shown):
- **No** (Number)
- **스캔위치** (Scan Location)
- **선정위치** (Selected Location)
- **상품명** (Product Name)
- **물선명** (Logistics Name)
- **바코드번호** (Barcode Number)
- **선정재고** (Selected Stock)
- **실재고** (Actual Stock)
- **순정출하지점의 차 추입출 상품 송** (Difference)
- **상태** (Status)

Message shown: "검색 후 이용해 주세요." (Please search to use)

#### Right Panel - Help Guide
Green box titled: **상품 상태 저장준비** (Product Status Save Preparation)

Contains step-by-step instructions showing the stocktaking workflow

### 5.3 Data Fields & Schema Requirements

#### New Table: Stocktaking Sessions
```typescript
interface StocktakingSession {
  id: uuid;
  warehouseId: uuid;
  sessionName: string;
  status: 'created' | 'in_progress' | 'completed' | 'cancelled';
  startedAt: timestamp;
  completedAt?: timestamp;
  createdBy: uuid;
  notes?: string;
}
```

#### New Table: Stocktaking Lines
```typescript
interface StocktakingLine {
  id: uuid;
  sessionId: uuid;            // references stocktaking_sessions.id
  locationId: uuid;           // references locations.id
  skuId: uuid;               // references skus.id
  expectedQuantity: number;  // System quantity before count
  countedQuantity?: number;  // Actual counted quantity
  discrepancy?: number;      // Calculated difference
  status: 'pending' | 'counted' | 'verified' | 'adjusted';
  countedAt?: timestamp;
  countedBy?: uuid;
  notes?: string;
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

#### New Table: Stocktaking Adjustments
```typescript
interface StocktakingAdjustment {
  id: uuid;
  stocktakingLineId: uuid;
  journalId: uuid;           // references stock_journals.id
  eventId: uuid;             // references stock_events.id
  adjustmentType: 'ADJUST_UP' | 'ADJUST_DOWN';
  quantity: number;
  reason: string;
  appliedAt: timestamp;
  appliedBy: uuid;
}
```

### 5.4 Backend Operations

1. **POST /api/wms/stocktaking/sessions**
   - Create new stocktaking session
   - Initialize with warehouse and date range

2. **GET /api/wms/stocktaking/sessions/:id**
   - Get session details and progress
   - Include count statistics

3. **POST /api/wms/stocktaking/scan-location**
   - Scan location barcode
   - Load expected inventory for location
   - Create pending stocktaking lines

4. **POST /api/wms/stocktaking/scan-product**
   - Scan product barcode during counting
   - Increment counted quantity
   - Update stocktaking line

5. **POST /api/wms/stocktaking/lines/:id/count**
   - Manually enter count for specific line
   - Update counted quantity

6. **GET /api/wms/stocktaking/lines/discrepancies**
   - List all lines with discrepancies (expected != counted)
   - Filter by location, SKU, discrepancy threshold

7. **POST /api/wms/stocktaking/adjust**
   - Create stock adjustment events for discrepancies
   - Generate stock_events with transition_type = 'ADJUST_UP' or 'ADJUST_DOWN'
   - Update stock_summary via event sourcing

8. **POST /api/wms/stocktaking/sessions/:id/complete**
   - Finalize stocktaking session
   - Lock session from further edits
   - Generate summary report

9. **POST /api/wms/stocktaking/reset**
   - Clear current scan queue
   - Reset pending counts

### 5.5 Business Logic

#### Stocktaking Workflow
1. **Initialize Session**: Create stocktaking session for warehouse
2. **Scan Location**: Scan location barcode to load expected inventory
3. **Count Products**:
   - Scan product barcodes or manually enter counts
   - System tracks counted quantity per SKU per location
4. **Review Discrepancies**:
   - Compare expected vs counted quantities
   - Highlight discrepancies for review
5. **Adjust Inventory**:
   - Create stock adjustment events (ADJUST_UP/ADJUST_DOWN)
   - Post to stock_events table
   - Update stock_summary projections
6. **Complete Session**: Finalize and generate audit report

#### Barcode Scanning Logic
- **Location Scan**: Triggers loading of all SKUs at that location
- **Product Scan**: Increments count for scanned SKU
- **Auto-generation**: Automatically creates stocktaking lines on first scan

#### Adjustment Rules
- Only create adjustments after count verification
- Require reason for adjustments above threshold (e.g., >5% variance)
- Generate stock_events with proper journaling
- Maintain audit trail of who/when/why

#### Concurrent Counting
- Multiple users can count different locations simultaneously
- Lock locations during active counting
- Prevent double-counting same location

### 5.6 Integration Points

#### Stock Event System (Event Sourcing)
- Adjustments create proper `stock_events` records
- Events have `transitionType` = 'ADJUST_UP' or 'ADJUST_DOWN'
- Events trigger `stock_summary` projection updates
- Maintains complete audit trail

#### Location Module
- Uses `locations` table for location hierarchy
- Supports scanning location barcodes
- Filters by warehouse

#### Inventory Module
- Reads expected quantities from `stock_summary`
- Compares with counted quantities
- Updates stock via event sourcing pattern

#### Audit System
- All adjustments logged to `audit_logs`
- Track user actions (who counted, who adjusted)
- Timestamp all activities
- Store discrepancy reasons

### 5.7 UI/UX Flow
1. User clicks "상품 위치 이력" (Product Location History)
2. Enters search criteria or scans location barcode
3. System displays expected inventory for location
4. User scans products or manually enters counts
5. System highlights discrepancies in real-time
6. User reviews and confirms counts
7. System generates adjustment events for discrepancies
8. User completes session and generates report

### 5.8 Reporting Requirements
- **Discrepancy Report**: List all variances with reasons
- **Adjustment Summary**: Total adjustments by SKU, location, warehouse
- **Count Progress**: Percentage of locations completed
- **User Activity**: Who counted which locations and when
- **Historical Comparison**: Compare stocktaking results over time

---

## 6. Cross-Cutting Concerns

### 6.1 Barcode System Architecture

#### Barcode Types
Current system uses `barcode_type` enum with value 'standard'. May need to expand:
```typescript
export const barcodeTypeEnum = pgEnum('barcode_type', [
  'standard',      // Regular product barcode (EAN-13, etc.)
  'location',      // Location/bin barcode
  'container',     // Pallet/box barcode
  'internal'       // Internal WMS-generated barcode
]);
```

#### Barcode Generation Service
Should support:
- SKU barcode generation
- Location barcode generation
- Print queue management
- Batch printing
- Label templates (different sizes, formats)

### 6.2 Sales Product Lifecycle

```
1. Create Product Master (PIM)
   ├─ Define option schema
   ├─ Generate variants (all combinations)
   └─ Set base pricing

2. Create Inventory Masters & SKUs (WMS)
   ├─ One inventory_product_master per product_master
   ├─ One SKU per variant
   └─ Generate/assign barcodes

3. Match to Sales Channels (PIM)
   ├─ Enable on Medusa, Naver, Coupang, etc.
   ├─ Set channel-specific pricing/names
   └─ Configure fulfillment mode

4. Receive Inventory (WMS)
   ├─ Create inbound receipt
   ├─ Scan barcodes during receiving
   └─ Post stock_events (transition_type = 'RECEIVE')

5. Store in Locations (WMS)
   ├─ Putaway process
   ├─ Scan location + product barcodes
   └─ Update stock_summary with location

6. Count/Adjust (Stocktaking)
   ├─ Periodic physical counts
   ├─ Identify discrepancies
   └─ Create adjustment events
```

### 6.3 Data Consistency Rules

#### PIM ↔ WMS Synchronization
- Product Master creation MUST trigger Inventory Master creation
- Variant creation MUST trigger SKU creation
- Option structure changes require SKU regeneration (destructive)
- Maintain bidirectional references:
  - `inventory_product_masters.pim_master_id` → `product_masters.id`
  - `skus.pim_variant_id` → `product_variants.id`

#### Immutability Constraints
- **Option Structure**: Cannot modify after variant generation (must delete and recreate)
- **Stock Events**: Immutable audit trail (use reversal events for corrections)
- **Barcode Assignment**: Cannot change SKU's default barcode once assigned
- **Location Barcodes**: Immutable once created

### 6.4 Performance Considerations

#### Indexing Strategy
Ensure proper indexes on:
- `sku_barcodes.barcode` (already unique)
- `location_barcodes.barcode` (if implemented)
- `stocktaking_lines.session_id` + `status`
- `stock_summary.sku_id` + `warehouse_id` + `location_id`

#### Caching Strategy
- Cache frequently scanned barcodes → SKU mapping
- Cache location hierarchy for quick lookup
- Cache active stocktaking sessions

#### Batch Operations
- Bulk barcode generation
- Batch printing jobs
- Bulk adjustment posting (for large stocktaking sessions)

---

## 7. Implementation Priorities

### 7.1 Phase 1: Core Barcode Infrastructure
1. ✅ Implement `sku_barcodes` table (already exists)
2. ❌ Create `location_barcodes` table and module
3. ❌ Build barcode generation service
4. ❌ Implement print queue system
5. ❌ Create barcode scanning endpoints

### 7.2 Phase 2: Sales Product Creation
1. ✅ PIM schema for products/options/variants (already exists)
2. ❌ Build sales product creation API (POST /api/pim/products/create)
3. ❌ Implement automatic SKU generation from variants
4. ❌ Create product-SKU matching service
5. ❌ Add sales channel mapping functionality

### 7.3 Phase 3: Stocktaking Module
1. ❌ Create stocktaking schema (sessions, lines, adjustments)
2. ❌ Build stocktaking session management
3. ❌ Implement barcode scanning for counting
4. ❌ Create discrepancy detection and reporting
5. ❌ Build stock adjustment event generation
6. ❌ Add stocktaking reports and analytics

### 7.4 Phase 4: Advanced Features
1. ❌ Cycle counting (continuous partial stocktaking)
2. ❌ Predictive adjustments based on historical data
3. ❌ Mobile app for stocktaking
4. ❌ Real-time stocktaking dashboards
5. ❌ Integration with barcode printers via API

---

## 8. API Specifications

### 8.1 Barcode Management APIs

```typescript
// List sales product barcodes
GET /api/wms/inventory/barcodes/list
Query: {
  search?: string;
  skuId?: uuid;
  locationId?: uuid;
  supplierId?: uuid;
  page?: number;
  limit?: number;
}
Response: {
  items: Array<{
    barcodeId: uuid;
    barcode: string;
    skuId: uuid;
    skuName: string;
    skuCode: string;
    masterName: string;
    image?: string;
    location?: string;
    supplierName?: string;
    version?: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

// Add to print queue
POST /api/wms/inventory/barcodes/print
Body: {
  barcodeIds: uuid[];
  quantity: number;
}
Response: {
  jobId: uuid;
  itemsQueued: number;
}

// List location barcodes
GET /api/wms/locations/barcodes
Query: {
  search?: string;
  warehouseId?: uuid;
  page?: number;
  limit?: number;
}
Response: {
  items: Array<{
    id: uuid;
    locationId: uuid;
    barcode: string;
    locationCode: string;
    createdAt: timestamp;
  }>;
  total: number;
}

// Create location barcode
POST /api/wms/locations/barcodes
Body: {
  locationId: uuid;
  barcode?: string; // optional, auto-generate if not provided
}
Response: {
  id: uuid;
  locationId: uuid;
  barcode: string;
  locationCode: string;
}
```

### 8.2 Sales Product APIs

```typescript
// Create sales product (integrated PIM + WMS)
POST /api/pim/products/create
Body: {
  name: string;
  businessName: string;
  supplierId: uuid;
  basePrice: number;
  optionGroups: Array<{
    name: string;
    displayName: string;
    values: Array<{
      value: string;
      displayName: string;
    }>;
  }>;
  moq?: number;
  returnPolicy?: {
    allowReturns: boolean;
    returnWindowDays: number;
  };
}
Response: {
  productMasterId: uuid;
  inventoryMasterId: uuid;
  variantsCreated: number;
  skusCreated: number;
  variants: Array<{
    variantId: uuid;
    skuId: uuid;
    optionCombination: Record<string, string>;
  }>;
}

// Match product to existing inventory
POST /api/pim/products/match-inventory
Body: {
  productMasterId: uuid;
  variantSkuMappings: Array<{
    variantId: uuid;
    skuId: uuid;
  }>;
}
Response: {
  success: boolean;
  mappingsCreated: number;
}
```

### 8.3 Stocktaking APIs

```typescript
// Create stocktaking session
POST /api/wms/stocktaking/sessions
Body: {
  warehouseId: uuid;
  sessionName: string;
  notes?: string;
}
Response: {
  sessionId: uuid;
  status: 'created';
  startedAt: timestamp;
}

// Scan location barcode
POST /api/wms/stocktaking/scan-location
Body: {
  sessionId: uuid;
  locationBarcode: string;
}
Response: {
  locationId: uuid;
  locationCode: string;
  expectedItems: Array<{
    skuId: uuid;
    skuName: string;
    skuCode: string;
    barcode: string;
    expectedQuantity: number;
  }>;
}

// Scan product during counting
POST /api/wms/stocktaking/scan-product
Body: {
  sessionId: uuid;
  locationId: uuid;
  productBarcode: string;
  quantity?: number; // default 1
}
Response: {
  lineId: uuid;
  skuId: uuid;
  countedQuantity: number;
  expectedQuantity: number;
  discrepancy: number;
}

// Get discrepancies
GET /api/wms/stocktaking/sessions/:id/discrepancies
Response: {
  items: Array<{
    lineId: uuid;
    locationCode: string;
    skuName: string;
    skuCode: string;
    expectedQuantity: number;
    countedQuantity: number;
    discrepancy: number;
    discrepancyPercent: number;
  }>;
  total: number;
}

// Apply adjustments
POST /api/wms/stocktaking/sessions/:id/adjust
Body: {
  adjustments: Array<{
    lineId: uuid;
    reason: string;
  }>;
}
Response: {
  adjustmentsCreated: number;
  eventsPosted: number;
  journalId: uuid;
}

// Complete session
POST /api/wms/stocktaking/sessions/:id/complete
Response: {
  sessionId: uuid;
  status: 'completed';
  completedAt: timestamp;
  summary: {
    totalLines: number;
    discrepanciesFound: number;
    adjustmentsApplied: number;
    totalAdjustmentValue: number;
  };
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests
- Barcode generation logic
- SKU-variant mapping rules
- Stocktaking discrepancy calculations
- Event sourcing projections for adjustments

### 9.2 Integration Tests
- PIM → WMS SKU creation flow
- Barcode scanning → inventory lookup
- Stocktaking adjustment → stock_events → stock_summary
- Print queue job processing

### 9.3 E2E Tests
- Complete sales product creation workflow
- Full stocktaking session (create → scan → count → adjust → complete)
- Barcode printing workflow
- Location barcode creation and usage

### 9.4 Performance Tests
- Barcode lookup under high scan volume
- Batch SKU creation (1000+ variants)
- Concurrent stocktaking (multiple users/locations)
- Event sourcing projection rebuild

---

## 10. Open Questions & Decisions Needed

### 10.1 Barcode Generation
- **Q**: Should we use external barcode generation service or build in-house?
- **Q**: What barcode symbology to use? (EAN-13, Code128, QR codes?)
- **Q**: How to handle barcode conflicts/duplicates?

### 10.2 Sales Product Creation
- **Q**: Can we support editing option structure, or always destructive?
- **Q**: Should variant generation be synchronous or async (for large option matrices)?
- **Q**: How to handle partial failures (product created but SKU creation fails)?

### 10.3 Stocktaking
- **Q**: Support blind counts (hide expected quantity from counter)?
- **Q**: Cycle counting schedule/automation strategy?
- **Q**: Auto-adjustment threshold (e.g., auto-adjust if variance < 5%)?
- **Q**: Multi-user session support (collaborative counting)?

### 10.4 Location Barcodes
- **Q**: Should location barcodes be auto-generated or manually assigned?
- **Q**: Format/structure for location barcodes?
- **Q**: How to handle location barcode reprints (same code or new code)?

---

## Summary

This analysis covers five main functional areas visible in the Figma designs:

1. **Sales Product Barcode Management**: Viewing, searching, and printing product barcodes with location and supplier info
2. **Location Barcode Management**: Creating and managing unique barcodes for warehouse locations
3. **Sales Product Creation (Part 1)**: Core product setup with options, variants, and pricing
4. **Sales Product Creation (Part 2)**: Advanced features including SKU matching, packaging, return policies, and channel mapping
5. **Stocktaking**: Physical inventory counting with barcode scanning, discrepancy detection, and automatic adjustment posting

### Key Backend Requirements
- **New Tables**: `location_barcodes`, `stocktaking_sessions`, `stocktaking_lines`, `stocktaking_adjustments`, `barcode_print_jobs`
- **New Services**: Barcode generation, print queue management, stocktaking session management
- **New APIs**: 20+ endpoints across barcode, product, and stocktaking domains
- **Integration Points**: Deep integration between PIM and WMS, event sourcing for adjustments, audit logging

### Implementation Complexity
- **High Priority**: Location barcode system, stocktaking module (critical for operations)
- **Medium Priority**: Sales product creation enhancements, barcode printing
- **Low Priority**: Advanced features (cycle counting, mobile apps, predictive analytics)

### Next Steps
1. Review and validate schema designs with team
2. Create detailed API specifications for each endpoint
3. Design barcode generation strategy and symbology
4. Build MVP for stocktaking module (most operationally critical)
5. Implement location barcode system
6. Enhance sales product creation with all identified features
