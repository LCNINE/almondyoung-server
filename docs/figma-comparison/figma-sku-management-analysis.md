# Figma Design Analysis: SKU Management Functionality

**Analysis Date:** 2025-10-13
**Analyzed Files:**
- almondyoung-figma-png/inventory/sku-form.png
- almondyoung-figma-png/inventory/sku-edit-form.png
- almondyoung-figma-png/inventory/sku-option-form.png
- almondyoung-figma-png/inventory/sku-option-edit-form.png
- almondyoung-figma-png/inventory/move-sku.png

---

## Executive Summary

This document provides a comprehensive analysis of the SKU management functionality based on Figma design screenshots. The analysis identifies:

- **5 distinct UI screens** for SKU creation, editing, option/variant management, and location moves
- **50+ form fields** across different screens requiring backend support
- **15+ missing database fields** in the current schema
- **10+ new API endpoints** needed for full feature parity
- **3 new database tables** required for complete functionality

### Current Implementation Gap

**Existing Coverage:** ~40%
- ✅ Basic SKU CRUD operations
- ✅ Barcode management
- ✅ Stock tracking
- ✅ Master product relationships

**Missing:** ~60%
- ❌ Extended SKU metadata (dimensions, weight, materials)
- ❌ Variant/option management as separate entities
- ❌ Multi-tier pricing (retail, wholesale, special)
- ❌ Location tracking in SKU
- ❌ Manager/personnel assignments
- ❌ Image management
- ❌ Barcode scanning operations

---

## Table of Contents

1. [Screen Analysis](#screen-analysis)
   - [SKU Creation Form](#1-sku-creation-form)
   - [SKU Edit Form](#2-sku-edit-form)
   - [SKU Option Form](#3-sku-option-form)
   - [SKU Option Edit Form](#4-sku-option-edit-form)
   - [Move SKU](#5-move-sku)
2. [Backend Requirements](#backend-requirements)
   - [Database Schema Enhancements](#database-schema-enhancements)
   - [DTO Enhancements](#dto-enhancements)
   - [API Endpoints](#api-endpoints-needed)
   - [Service Layer](#service-layer-enhancements)
3. [Integration Requirements](#integration-requirements)
4. [Implementation Plan](#implementation-plan)

---

## Screen Analysis

### 1. SKU Creation Form

**File:** `sku-form.png`
**Page Name:** "재고상품 등록" (SKU Registration/Creation)

#### Form Sections

##### A. Basic Information (기본정보)

| Field (Korean) | Field (English) | Type | Required | Current Schema | Notes |
|----------------|-----------------|------|----------|----------------|-------|
| 상품명 | Product Name | Dropdown/Select | ✅ Yes | ✅ `name` | Links to master products |
| 상품 구분 | Product Type | Dropdown | ❌ No | ❌ Missing | Product classification |
| 공급처(배송지) | Supplier/Delivery | Dropdown | ✅ Yes | ✅ `skuSuppliers` | M:N relationship exists |
| 물류처 | Logistics Partner | Dropdown | ✅ Yes | ❌ Missing | New field needed |
| 사업 상품명 | Business Product Name | Text | ❌ No | ❌ Missing | Alias name for business |
| 수입신고번호 | Import Declaration Number | Text | ❌ No | ❌ Missing | Customs/import tracking |
| 할인 | Discount | Text | ❌ No | ❌ Missing | Discount information |
| 제조스타 | Manufacturer Star | Dropdown | ❌ No | ❌ Missing | Rating/quality indicator |

##### B. Barcode (바코드)

| Field | Type | Required | Current Schema | Notes |
|-------|------|----------|----------------|-------|
| 바코드번호(필수) | Text | ✅ Yes | ✅ `defaultBarcode` | Primary barcode |
| 바코드번호2 | Text | ❌ No | ✅ `skuBarcodes` | Additional barcode |
| 바코드번호3 | Text | ❌ No | ✅ `skuBarcodes` | Additional barcode |

**Business Rule:** Auto-generation feature available (바코드 자동생성)

##### C. Product Information (품목정보)

| Field (Korean) | Field (English) | Type | Unit | Current Schema | Gap |
|----------------|-----------------|------|------|----------------|-----|
| 상품 무게 | Product Weight | Number | g | ❌ Missing | Need `productWeight` |
| 상품 규격 | Product Dimensions | Composite (W×H×D) | cm | ❌ Missing | Need `dimensionWidth`, `dimensionHeight`, `dimensionDepth` |
| 상품 소재 | Product Material | Text | - | ❌ Missing | Need `productMaterial` |
| 한글명자 | Korean Name | Text | - | ❌ Missing | Need `koreanName` |
| 최대 할인게수 | Max Discount Quantity | Number | - | ❌ Missing | Need `maxDiscountQuantity` |
| 포장 수입사명 | Packaging Importer Name | Text | - | ❌ Missing | Need `packagingImporterName` |

**Validation:**
- Weight: Positive integer (grams)
- Dimensions: 3 separate positive integers (cm)
- Max length constraints on text fields

##### D. Product Status (제고정보)

| Field (Korean) | Field (English) | Type | Required | Current Schema | Gap |
|----------------|-----------------|------|----------|----------------|-----|
| 상품 위치 | Product Location | Text/Dropdown | ✅ Yes | ❌ Missing | Need `primaryLocationId` |
| 보관측방 위치 | Storage Location | Text | ❌ No | ❌ Missing | Need `secondaryLocationId` |
| 판매 재고 | Sales Inventory | Number | ❌ No | ❌ Missing | Calculated/cached `currentStock` |
| 안전 재고 | Safety Stock | Number | ✅ Yes | ❌ Missing | **Required field** `safetyStock` |
| 판가 | Selling Price | Number | ❌ No | ❌ Missing | Need pricing table |
| 할 | Discount Amount | Number | ❌ No | ❌ Missing | Discount tracking |

**Checkboxes/Options:**
- ☑️ 유통기간 관리여부 (Expiry Date Management) → Need `expiryDateManagement` boolean
- ☑️ 관리 안함 (No Management)
- ☑️ 제조일관리부 (Manufacturing Date Management) → Need `manufacturingDateManagement`
- ☑️ 일반재고 (General Inventory) → Need `isGeneralInventory`
- ☑️ 유통기간 (Expiry Period) → Need `expiryStartDate`, `expiryEndDate`

##### E. Variant(옵션)상품 Section

**Collapsible section with checkbox:**
- Text: "옵션 정보 (미제 시 단품으로 등록 / 품설 상품은 옵션별로 상세를 저작)"
- Translation: "Option info (if unchecked, registered as single item / option products require details per option)"
- **Current Support:** ✅ `optionKey` (jsonb) exists but limited
- **Gap:** Need full variant management with separate tracking

##### F. Image Information (이미지 정보)

| Field | Type | Required | Validation | Current Schema | Gap |
|-------|------|----------|------------|----------------|-----|
| 대표이미지 | File Upload | ✅ Yes | 500×500px ~ 1000×1000px | ❌ Missing | Need `mainImageUrl` |

##### G. Sales Information (상품정보)

| Field | Type | Current Schema | Gap |
|-------|------|----------------|-----|
| 상품설명 | Text Area | ❌ Missing | Need `productDescription` |
| MOQ | Text/Number | ❌ Missing | Need `moq` (Minimum Order Quantity) |
| 메모2 | Text | ❌ Missing | Need `memo2` |
| 메모3 | Text | ❌ Missing | Need `memo3` |

##### H. Sales Manager (상품 담당자)

| Field (Korean) | Field (English) | Type | Current Schema | Gap |
|----------------|-----------------|------|----------------|-----|
| 상품디자이너 | Product Designer | Dropdown | ❌ Missing | Need `sku_managers` table with `designerId` |
| 발주담당자 | Purchase Manager | Dropdown | ❌ Missing | Need `purchaseManagerId` in `sku_managers` |
| 상품등록자 | Registration Manager | Dropdown | ❌ Missing | Need `registrationManagerId` in `sku_managers` |

**Default:** 미지정 (Unspecified) for all manager fields

#### Actions/Operations

| Button | Action | API Endpoint |
|--------|--------|--------------|
| 취소 | Cancel | Close form |
| 저장 | Save/Create | `POST /wms/inventory/skus` |

#### Business Rules Identified

1. ✅ **Product Name (상품명) is mandatory** - must link to master product
2. ✅ **Supplier and Logistics Partner are required**
3. ✅ **Barcode required but can be auto-generated**
4. ❌ **Safety Stock (안전 재고) is REQUIRED** - missing in current schema
5. ✅ **Multiple barcodes supported** (up to 3+ via `skuBarcodes` table)
6. ❌ **Dimensions require 3 separate numeric inputs** - not in schema
7. ❌ **Option/Variant management is optional** - needs enhancement
8. ❌ **Image upload with size validation** - no image field in schema

---

### 2. SKU Edit Form

**File:** `sku-edit-form.png`
**Page Name:** "재고 상품 정보 수정" (SKU Information Edit)

#### Key Differences from Create Form

##### A. Read-Only/Pre-filled Fields

| Field | Display | Status | Notes |
|-------|---------|--------|-------|
| 상품명 | Shows full product name | Read-only | "다를 M 드아이파 미러별..." (truncated) |
| Product Type | 사업 (Business) | Read-only | |
| Supplier | 다들 | Read-only | |
| Logistics | 부산반고 | Read-only | |

**Date Range Display:**
- Shows validity period: "2026-09-10 ~ 2028-12-23"
- **Gap:** No validity date fields in current schema
- **Need:** `validityStartDate`, `validityEndDate` fields

##### B. Enhanced Product Status Section

**Populated Data:**
| Field | Sample Value | Checkbox Feature |
|-------|--------------|------------------|
| 상품 무게 | 20 g | ☑️ 수입시 실시진메별별 (Update on import) |
| 상품 규격 | 4 × 15 × 3 cm | ☑️ Per dimension |
| 상품 소재 | (empty) | ☑️ |
| 포장 수입사명 | (empty) | ☑️ |

**Business Rule:** Checkboxes indicate "update this field when importing/syncing"

##### C. Image Information - With Previews

**Shows actual uploaded images:**
- Product images visible (nail polish bottles in screenshot)
- Image preview functionality
- **Gap:** No image storage/management in current schema

##### D. Variant(옵션)상품 Management - EXPANDED

**Table Features:**

**Header Row:**
| Column | Type | Purpose |
|--------|------|---------|
| Checkbox | Selection | Multi-select for batch operations |
| 품실상매별별 | Text | Option/Variant specification (e.g., "φ0.07/5mm") |
| 판가 | Number | Price |
| 단메재고 | Number | Current Stock |
| 민메재고 | Number | Min/Safety Stock |
| 바코드 | Text | Barcode |
| 상품위치 | Text | Location code (e.g., "♀-10-10 / 1-13-10") |
| 이미지 | Image | Preview thumbnail |
| 사별 | Button | Detail/Edit action |

**Sample Data Row:**
```
φ0.07/5mm | 1,300 원 | 4 | 4 | 1173972D003 | ♀-10-10 / 1-13-10 | [Image] | 사별
```

**Action Buttons:**
- **+ 품실번경 (Add Option)** - Add new variant/option
- **신규 사항 (New Item)** - Create new option
- **선메물품 검가 수정 (Edit Selected)** - Bulk edit

**Search/Filter:**
- Search box: "품별로 검색수정" (Search by option)
- Price counter: Shows "0" (number of selected items)

**Business Rule:** Each option has independent tracking of stock, location, barcode, and price

##### E. Variant Management Section (변메 정보)

**New Section Not in Create Form:**

| Field | Sample Value | Purpose |
|-------|--------------|---------|
| 변메조를 코드 | SS74 | Variant Group Code |
| 판메가 | 12,000 | Retail Price |
| 별매시가 | 8,000 | Special Sale Price |
| 도매가 | 0 | Wholesale Price |

**Gap Analysis:**
- ❌ No `variantGroupCode` field in `skus` table
- ❌ No pricing tiers table (`sku_variant_pricing`)
- ❌ Current schema only has basic fields, not multi-tier pricing

##### F. Audit Timestamps

**Displayed at bottom:**
- 등록일자: 2025-07-17 오전 8:55:08 (Registration date)
- 최종수정일자: 2025-07-30 오전 8:55:08 (Last modified date)

**Current Schema:** ✅ `createdAt`, `updatedAt` exist

#### Business Rules Identified

1. ✅ **SKU editing preserves master product relationship** - read-only display
2. ❌ **Validity date range supported** - not in schema
3. ❌ **Variant table with individual stock tracking** per option - needs enhancement
4. ❌ **Variant group code links related options** - missing field
5. ❌ **Multi-tier pricing (retail, special, wholesale)** - no pricing table
6. ❌ **Audit trail with timestamps** - exists but enhanced display needed
7. ❌ **Bulk option editing capability** - API support needed
8. ❌ **Location tracking per option** - current schema tracks at SKU level only

---

### 3. SKU Option Form

**File:** `sku-option-form.png`
**Page Name:** "단메(옵션)상품" (Variant/Option Management Section)

#### Empty State

**Table Display:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ Checkbox │ 품실상매별별 │ 판가 │ 단메재고 │ 민메재고 │ 바코드 │ 상품위치 │ 이미지 │ 사별 │
├──────────────────────────────────────────────────────────────────────┤
│                    (데이터가 존재하지 않습니다.)                      │
│                         "No data exists"                              │
└──────────────────────────────────────────────────────────────────────┘
```

**Action Buttons:**
- **사별정보 (Add New)** - Create first variant
- **품실 추가 (Add Option)** - Add option to list

#### Populated State - Batch Entry

**Shows multiple rows with same specification:**
```
Row 1: φ0.07/5mm | [Price] | [Stock] | [Min] | [Barcode] | [Location] | [Image] | 사별
Row 2: φ0.07/5mm | [Price] | [Stock] | [Min] | [Barcode] | [Location] | [Image] | 사별
Row 3: φ0.07/5mm | [Price] | [Stock] | [Min] | [Barcode] | [Location] | [Image] | 사별
...
Row 7+: φ0.07/5mm | [Price] | [Stock] | [Min] | [Barcode] | [Location] | [Image] | 사별
```

**Pattern Analysis:**
- Same variant specification repeated (φ0.07/5mm)
- Suggests **bulk variant creation** capability
- Each row independently editable

#### Business Rules Identified

1. ❌ **Variants can be created in batch mode** - API support needed
2. ❌ **Empty state clearly indicated** - frontend pattern
3. ❌ **Each variant independently tracked** with own inventory - schema needs option table
4. ❌ **Variant specification format** (e.g., φ0.07/5mm) - likely size/dimension standard
5. **Implication:** Need `sku_options` or similar table with foreign key to parent SKU

---

### 4. SKU Option Edit Form

**File:** `sku-option-edit-form.png`
**Page Name:** "옵션 정보 수정" (Option Information Edit) - Modal/Popup

#### Modal Structure

**Form Type:** Popup modal overlaying main screen
**Trigger:** Clicking "사별" button on option row in parent form

#### Form Sections (Mirrors Main SKU Form)

##### A. Basic Information (기본정보)

| Field | Value | Editable | Notes |
|-------|-------|----------|-------|
| 상품명 | "다를 M 드아이파..." | ❌ Read-only | Inherited from parent SKU |
| 사업 상품명 | (empty) | ✅ Yes | Option-specific business name |
| 수입신고번호 | (empty) | ✅ Yes | Option-specific import number |
| 물류처 | 부산반고 | ✅ Yes | Dropdown |

##### B. Barcode Section

| Field | Required | Notes |
|-------|----------|-------|
| 바코드번호(필수) | ✅ Yes | Option-specific barcode (REQUIRED) |
| 바코드번호2 | ❌ No | Additional barcode for option |
| 바코드번호3 | ❌ No | Additional barcode for option |

**Business Rule:** Each option must have unique barcode

##### C. Product Status (제고정보)

| Field (Korean) | Sample Value | Type | Notes |
|----------------|--------------|------|-------|
| 상품 위치 | J-10-10 | Text | Location code format |
| 보관측방 위치 | T-13-10 | Text | Secondary storage |
| 판매 재고 | 0 | Number | Current stock |
| 안전 재고 | 0 | Number | Safety stock threshold |
| 판가 | 1,300 원 | Number | Selling price |

**Checkboxes (Same as main form):**
- ☑️ 유통기간 관리여부
- ☑️ 관리 안함
- ☑️ 제조일관리부
- ☑️ 일반재고
- ☑️ 유통기간

##### D. Product Information

| Field | Value | Unit | Checkbox |
|-------|-------|------|----------|
| 상품 무게 | 20 | g | ☑️ 수입시 실시진메별별 |
| 상품 규격 (W) | 4 | cm | ☑️ |
| 상품 규격 (H) | 15 | cm | ☑️ |
| 상품 규격 (D) | 3 | cm | ☑️ |
| 상품 소재 | (empty) | - | ☑️ |
| 포장 수입사명 | (empty) | - | ☑️ |

##### E. Image Upload

**Features:**
- File selection button: "파일선택"
- Size guideline: 500×500px ~ 1000×1000px
- **Shows uploaded images** in preview

##### F. Sales Information

| Field | Sample Value |
|-------|--------------|
| 상품설명 | 브랜드 제품 50개 |
| MOQ | 브랜드 제품 50개 (with checkbox) |
| 메모2 | (empty) |
| 메모3 | (empty) |

##### G. Variant Pricing (변메 정보)

| Field | Value | Type |
|-------|-------|------|
| 변메조를 코드 | SS74 | Text (Group identifier) |
| Product Display | "다를 M 드아이파..." | Read-only |
| 판메가 (Retail) | 12,000 | Number |
| 별매시가 (Special) | 8,000 | Number |
| 도매가 (Wholesale) | 0 | Number |

##### H. Timestamps

- 등록일자: 2025-07-17 오전 8:55:08
- 최종수정일자: 2025-07-30 오전 8:55:08

#### Actions

| Button | Action |
|--------|--------|
| 취소 | Cancel/Close modal without saving |
| 저장 | Save option changes |

#### Business Rules Identified

1. ❌ **Individual option editing via modal** - needs dedicated endpoint
2. ❌ **Option inherits parent SKU product name** - read-only display
3. ❌ **Option can have separate business name** - optional override
4. ❌ **Each option requires unique barcode** - validation rule
5. ❌ **Option-specific location tracking** - separate from parent SKU
6. ❌ **Option-specific inventory levels** - independent stock
7. ❌ **Variant group code shared across related options** - grouping mechanism
8. ❌ **Multi-tier pricing per option** - pricing table needed
9. ❌ **Checkboxes indicate bulk update preferences** - for import operations

**Data Model Implication:**
```typescript
// Pseudo-schema
sku_options {
  id: UUID
  parentSkuId: UUID (FK to skus)
  optionSpecification: VARCHAR  // e.g., "φ0.07/5mm"
  businessProductName: VARCHAR (nullable)
  importDeclarationNumber: VARCHAR (nullable)
  logisticsPartnerId: UUID (nullable)
  barcode: VARCHAR (unique, required)
  additionalBarcodes: JSONB
  primaryLocationId: UUID (FK to locations)
  secondaryLocationId: UUID (FK to locations)
  currentStock: INTEGER
  safetyStock: INTEGER
  sellingPrice: INTEGER
  weight: INTEGER
  dimensions: JSONB {width, height, depth}
  material: TEXT
  // ... other fields mirroring parent SKU
  variantGroupCode: VARCHAR
  retailPrice: INTEGER
  specialSalePrice: INTEGER
  wholesalePrice: INTEGER
  createdAt: TIMESTAMP
  updatedAt: TIMESTAMP
}
```

---

### 5. Move SKU

**File:** `move-sku.png`
**Page Name:** "상품 위치 이동" (Product Location Move)

#### Layout Structure

**Two-Panel Layout:**
- **Left Panel:** Instructions and guidelines
- **Right Panel:** Movement interface and table

#### Left Panel - Instructions

##### Panel 1: Barcode Usage Method (바코드 사용방법)

**Instructions:**
1. 반품코드는 위치와 위치별코드를 입/scan수입니다.
   - *Barcode location and location-specific code input/scan*
2. 위치별 반품코드는 상품의 바코드로 입/scan수입니다.
   - *Location-specific return code uses product barcode for scan*
3. 복수의별바코드는 - 입력별 코드는 -multi - 바코드를 등록여여 스캔 품을시입니다.
   - *For multi-barcode products, use -multi suffix code for scanning*
4. 복수의별바코드가 없는 상품은 코드는 별만 -unimulti - 바코드를 등록여여 스캔 품을시입니다.
   - *For single-barcode products, use -unimulti code*
5. 바코드를위치 입력여여는 - 별코드는 게고 추 저장되, 바코드의 위치가 기준별 또메여여도는 스캔별 입력여여코드를 반정합니다.
   - *Barcode location input and validation logic*
6. 예시: Chrome 브라우저는 지원합니다.
   - *Example: Chrome browser is supported*

##### Panel 2: Location Barcode Search Conditions

**Instructions about search and filtering:**
- 명명 바코드는 검색 조건별 별코드는 또는 별품여여이 서를 가능합니다.
- *Location barcode search conditions and filtering capabilities*

##### Warning Banner (Red)

**Critical Warning:**
- 복스톰은(바대) 바대별 예랄, 입정별가 별대별 저인 및등 입고물 예입므로 번문별시이세 이때 스캔으로 번정합니다.
- *Warning about scanning procedures, restrictions, and proper usage*

#### Right Panel - Movement Interface

##### Search and Filter Section

| Element | Type | Options/Values | Purpose |
|---------|------|----------------|---------|
| 검색 조건 | Dropdown | 한코드텐 | Search condition selector |
| 관련정보 입장수정 | Checkbox | - | Related info edit toggle |
| 복수위치별시를 | Checkbox | - | Multiple location toggle |
| 상품도트입 위치 입력여여또 | Text Input | - | Product location input field |
| Status Filter | Dropdown | 한코드텐 | Status filter |
| Search Scope | Text | "위치 • 상품 바코드또는 생정" | Search by location or barcode |
| Yellow Button | Button | "관정별 위치물도입수입니다" | Validate/Check location |
| Blue Button | Button | "위치" | Execute move |

##### Movement Table

**Table Headers:**
| Column (Korean) | Column (English) | Type | Purpose |
|-----------------|------------------|------|---------|
| 바코드번호 | Barcode Number | Text | Product identifier |
| 상품명 / 품실명 | Product Name / Variant Name | Text | Product identification |
| 공급처 | Supplier | Text | Supplier name |
| 번명 전 위치 | Before Move Location | Text | Source location code |
| 번명 후 위치 | After Move Location | Text/Input | Destination location (editable) |

**Empty State:**
```
┌──────────────────────────────────────────────────────┐
│           (데이터가 존재하지 않습니다.)               │
│                 "No data exists"                      │
└──────────────────────────────────────────────────────┘
```

**Sample Row Format (from bottom section):**
```
φ0.07/5mm | 0 원 | 0 | [Empty] | [Empty] | [Empty] | [Image] | 사별
```

#### Business Rules Identified

1. ❌ **Barcode scanning is primary input method** - needs scanning API
2. ❌ **Chrome browser recommended** - hardware/software constraint
3. ❌ **Multi-barcode products use -multi suffix** - special handling needed
4. ❌ **Single-barcode products use -unimulti code** - naming convention
5. ❌ **Location codes follow specific format** (e.g., "J-10-10", "T-13-10")
6. ❌ **Before/after location tracking** - movement history needed
7. ❌ **Batch movement support** - multiple items at once
8. ❌ **Real-time location validation** - prevent invalid moves
9. ❌ **Supplier info maintained during moves** - read-only reference
10. ❌ **Warning system for restricted operations** - business logic validation

#### Data Model Requirements

**Movement Log Table Needed:**
```typescript
sku_location_movements {
  id: UUID
  skuId: UUID (FK to skus)
  barcode: VARCHAR
  fromLocationId: UUID (FK to locations)
  toLocationId: UUID (FK to locations)
  quantity: INTEGER (nullable, for partial moves)
  movedBy: UUID (FK to users)
  movementTimestamp: TIMESTAMP
  reason: TEXT (nullable)
  status: ENUM ['pending', 'completed', 'cancelled']
  createdAt: TIMESTAMP
}
```

**Location Validation Requirements:**
- Check if `toLocationId` exists and is active
- Check if `toLocationId` has capacity
- Check if movement is allowed (warehouse transfer rules)
- Track history for audit purposes

---

## Backend Requirements

### Database Schema Enhancements

#### 1. Missing Fields in `skus` Table

**File:** `/apps/wms/database/schemas/wms-schema.ts`

**Current Fields (Existing):**
- ✅ `id`, `holderId`, `masterId`, `name`, `code`
- ✅ `optionKey` (jsonb)
- ✅ `defaultBarcode`, `stockType`, `deliveryProfileId`
- ✅ `sale1m`, `sale3m`
- ✅ `createdAt`, `updatedAt`

**Add These Fields:**
```typescript
// Basic information enhancements
businessProductName: varchar('business_product_name', { length: 255 }),
importDeclarationNumber: varchar('import_declaration_number', { length: 100 }),
logisticsPartnerId: uuid('logistics_partner_id').references(() => suppliers.id),

// Dimensions and physical properties
productWeight: integer('product_weight'), // in grams
dimensionWidth: integer('dimension_width'), // in cm
dimensionHeight: integer('dimension_height'),
dimensionDepth: integer('dimension_depth'),
productMaterial: text('product_material'),

// Additional metadata
koreanName: varchar('korean_name', { length: 255 }),
maxDiscountQuantity: integer('max_discount_quantity'),
packagingImporterName: varchar('packaging_importer_name', { length: 255 }),
discount: varchar('discount', { length: 100 }),
manufacturerStar: varchar('manufacturer_star', { length: 100 }),

// Sales information
productDescription: text('product_description'),
moq: integer('moq'), // Minimum Order Quantity
memo2: text('memo2'),
memo3: text('memo3'),

// Image management
mainImageUrl: varchar('main_image_url', { length: 512 }),

// Inventory management
safetyStock: integer('safety_stock').notNull().default(0), // REQUIRED field
currentStock: integer('current_stock').default(0), // Calculated/cached

// Expiry and date management
expiryDateManagement: boolean('expiry_date_management').default(false),
expiryStartDate: timestamp('expiry_start_date', { withTimezone: true }),
expiryEndDate: timestamp('expiry_end_date', { withTimezone: true }),
manufacturingDateManagement: boolean('manufacturing_date_management').default(false),
isGeneralInventory: boolean('is_general_inventory').default(true),

// Validity period (for edit form)
validityStartDate: timestamp('validity_start_date', { withTimezone: true }),
validityEndDate: timestamp('validity_end_date', { withTimezone: true }),

// Location tracking
primaryLocationId: uuid('primary_location_id').references(() => locations.id),
secondaryLocationId: uuid('secondary_location_id').references(() => locations.id),

// Variant grouping
variantGroupCode: varchar('variant_group_code', { length: 64 }),
```

#### 2. New Table: `sku_variant_pricing`

**Purpose:** Multi-tier pricing per SKU/option

```typescript
export const skuVariantPricing = pgTable('sku_variant_pricing', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    // Three-tier pricing
    retailPrice: integer('retail_price'), // 판메가 (in cents)
    specialSalePrice: integer('special_sale_price'), // 별매시가
    wholesalePrice: integer('wholesale_price'), // 도매가
    sellingPrice: integer('selling_price'), // 판가 (current selling price)

    // Pricing metadata
    priceEffectiveDate: timestamp('price_effective_date', { withTimezone: true }),
    priceExpiryDate: timestamp('price_expiry_date', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    uniqueSkuPricing: unique().on(t.skuId), // One pricing record per SKU
}));

export const skuVariantPricingRelations = relations(skuVariantPricing, ({ one }) => ({
    sku: one(skus, {
        fields: [skuVariantPricing.skuId],
        references: [skus.id],
    }),
}));
```

#### 3. New Table: `sku_managers`

**Purpose:** Track personnel assignments

```typescript
export const skuManagers = pgTable('sku_managers', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    // Manager roles (all nullable)
    designerId: uuid('designer_id'), // 상품디자이너 (FK to users if available)
    purchaseManagerId: uuid('purchase_manager_id'), // 발주담당자
    registrationManagerId: uuid('registration_manager_id'), // 상품등록자

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    uniqueSkuManager: unique().on(t.skuId), // One manager record per SKU
}));

export const skuManagersRelations = relations(skuManagers, ({ one }) => ({
    sku: one(skus, {
        fields: [skuManagers.skuId],
        references: [skus.id],
    }),
    // TODO: Add user relations when user management is implemented
}));
```

#### 4. New Table: `sku_location_movements`

**Purpose:** Track location movement history

```typescript
export const skuLocationMovements = pgTable('sku_location_movements', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    barcode: varchar('barcode', { length: 64 }).notNull(),

    // Location tracking
    fromLocationId: uuid('from_location_id')
        .references(() => locations.id, { onDelete: 'restrict' })
        .notNull(),
    toLocationId: uuid('to_location_id')
        .references(() => locations.id, { onDelete: 'restrict' })
        .notNull(),

    // Movement details
    quantity: integer('quantity'), // Nullable for full SKU moves
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('completed'), // 'pending', 'completed', 'cancelled'

    // Audit
    movedBy: uuid('moved_by'), // FK to users (if available)
    movementTimestamp: timestamp('movement_timestamp', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    idxMovementSku: index('idx_movement_sku').on(t.skuId),
    idxMovementBarcode: index('idx_movement_barcode').on(t.barcode),
    idxMovementTimestamp: index('idx_movement_timestamp').on(t.movementTimestamp),
}));

export const skuLocationMovementsRelations = relations(skuLocationMovements, ({ one }) => ({
    sku: one(skus, {
        fields: [skuLocationMovements.skuId],
        references: [skus.id],
    }),
    fromLocation: one(locations, {
        fields: [skuLocationMovements.fromLocationId],
        references: [locations.id],
    }),
    toLocation: one(locations, {
        fields: [skuLocationMovements.toLocationId],
        references: [locations.id],
    }),
}));
```

#### 5. Indexes for Performance

```typescript
// Add to existing indexes
export const skusIndexes = {
    idxSkusSafetyStock: index('idx_skus_safety_stock').on(skus.safetyStock),
    idxSkusVariantGroup: index('idx_skus_variant_group').on(skus.variantGroupCode),
    idxSkusPrimaryLocation: index('idx_skus_primary_location').on(skus.primaryLocationId),
    idxSkusWeight: index('idx_skus_weight').on(skus.productWeight),
    idxSkusMoq: index('idx_skus_moq').on(skus.moq),
};
```

### DTO Enhancements

#### 1. Enhanced `CreateSkuDto`

**File:** `/apps/wms/src/inventory/dto/sku/create-sku.dto.ts`

**Add these properties:**
```typescript
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsBoolean, IsEnum, IsArray, IsUrl, IsInt, Min, Max, IsDate } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateSkuDto {
    // ... existing fields ...

    // Basic Information Enhancements
    @ApiProperty({ description: '사업 상품명 (Business product name)', required: false })
    @IsString()
    @IsOptional()
    businessProductName?: string;

    @ApiProperty({ description: '수입신고번호 (Import declaration number)', required: false })
    @IsString()
    @IsOptional()
    importDeclarationNumber?: string;

    @ApiProperty({ description: '물류처 ID (Logistics partner ID)', required: false })
    @IsUUID()
    @IsOptional()
    logisticsPartnerId?: string;

    @ApiProperty({ description: '할인 정보 (Discount info)', required: false })
    @IsString()
    @IsOptional()
    discount?: string;

    @ApiProperty({ description: '제조스타 (Manufacturer star/rating)', required: false })
    @IsString()
    @IsOptional()
    manufacturerStar?: string;

    // Physical Properties
    @ApiProperty({ description: '상품 무게 (g)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    productWeight?: number;

    @ApiProperty({ description: '가로 (Width in cm)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionWidth?: number;

    @ApiProperty({ description: '세로 (Height in cm)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionHeight?: number;

    @ApiProperty({ description: '높이 (Depth in cm)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionDepth?: number;

    @ApiProperty({ description: '상품 소재 (Product material)', required: false })
    @IsString()
    @IsOptional()
    productMaterial?: string;

    // Additional Metadata
    @ApiProperty({ description: '한글명 (Korean name)', required: false })
    @IsString()
    @IsOptional()
    koreanName?: string;

    @ApiProperty({ description: '최대 할인개수 (Max discount quantity)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    maxDiscountQuantity?: number;

    @ApiProperty({ description: '포장 수입사명 (Packaging importer name)', required: false })
    @IsString()
    @IsOptional()
    packagingImporterName?: string;

    // Sales Information
    @ApiProperty({ description: '상품설명 (Product description)', required: false })
    @IsString()
    @IsOptional()
    productDescription?: string;

    @ApiProperty({ description: 'MOQ (Minimum Order Quantity)', required: false, minimum: 1 })
    @IsInt()
    @Min(1)
    @IsOptional()
    moq?: number;

    @ApiProperty({ description: 'Memo 2', required: false })
    @IsString()
    @IsOptional()
    memo2?: string;

    @ApiProperty({ description: 'Memo 3', required: false })
    @IsString()
    @IsOptional()
    memo3?: string;

    // Image Management
    @ApiProperty({ description: '대표이미지 URL (Main image URL)', required: false })
    @IsUrl()
    @IsOptional()
    mainImageUrl?: string;

    // Inventory Management
    @ApiProperty({ description: '안전 재고 (Safety stock) - REQUIRED', required: true, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsNotEmpty()
    safetyStock: number;

    @ApiProperty({ description: '판매 재고 (Current stock)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    currentStock?: number;

    // Expiry Management
    @ApiProperty({ description: '유통기간 관리여부 (Expiry date management)', required: false })
    @IsBoolean()
    @IsOptional()
    expiryDateManagement?: boolean;

    @ApiProperty({ description: '유통기간 시작일 (Expiry start date)', required: false })
    @Type(() => Date)
    @IsDate()
    @IsOptional()
    expiryStartDate?: Date;

    @ApiProperty({ description: '유통기간 종료일 (Expiry end date)', required: false })
    @Type(() => Date)
    @IsDate()
    @IsOptional()
    expiryEndDate?: Date;

    @ApiProperty({ description: '제조일관리 (Manufacturing date management)', required: false })
    @IsBoolean()
    @IsOptional()
    manufacturingDateManagement?: boolean;

    @ApiProperty({ description: '일반재고 여부 (Is general inventory)', required: false })
    @IsBoolean()
    @IsOptional()
    isGeneralInventory?: boolean;

    // Validity Period
    @ApiProperty({ description: '유효기간 시작일 (Validity start date)', required: false })
    @Type(() => Date)
    @IsDate()
    @IsOptional()
    validityStartDate?: Date;

    @ApiProperty({ description: '유효기간 종료일 (Validity end date)', required: false })
    @Type(() => Date)
    @IsDate()
    @IsOptional()
    validityEndDate?: Date;

    // Location Tracking
    @ApiProperty({ description: '주 위치 ID (Primary location ID)', required: false })
    @IsUUID()
    @IsOptional()
    primaryLocationId?: string;

    @ApiProperty({ description: '보관 위치 ID (Secondary location ID)', required: false })
    @IsUUID()
    @IsOptional()
    secondaryLocationId?: string;

    // Variant Grouping
    @ApiProperty({ description: '변메조를 코드 (Variant group code)', required: false })
    @IsString()
    @IsOptional()
    variantGroupCode?: string;

    // Pricing (nested DTO)
    @ApiProperty({ description: '판메가 (Retail price in cents)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    retailPrice?: number;

    @ApiProperty({ description: '별매시가 (Special sale price in cents)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    specialSalePrice?: number;

    @ApiProperty({ description: '도매가 (Wholesale price in cents)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    wholesalePrice?: number;

    @ApiProperty({ description: '판가 (Selling price in cents)', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    sellingPrice?: number;

    // Manager Assignment
    @ApiProperty({ description: '상품디자이너 ID (Designer ID)', required: false })
    @IsUUID()
    @IsOptional()
    designerId?: string;

    @ApiProperty({ description: '발주담당자 ID (Purchase manager ID)', required: false })
    @IsUUID()
    @IsOptional()
    purchaseManagerId?: string;

    @ApiProperty({ description: '상품등록자 ID (Registration manager ID)', required: false })
    @IsUUID()
    @IsOptional()
    registrationManagerId?: string;
}
```

#### 2. New DTO: `CreateSkuOptionDto`

**File:** `/apps/wms/src/inventory/dto/sku/create-sku-option.dto.ts` (NEW)

```typescript
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsBoolean, IsUrl, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for creating SKU options/variants
 * Used when a SKU has multiple variants (e.g., different sizes, colors)
 */
export class CreateSkuOptionDto {
    @ApiProperty({ description: 'Parent SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    parentSkuId: string;

    @ApiProperty({ description: '옵션 상세명칭 (Option specification)', example: 'φ0.07/5mm' })
    @IsString()
    @IsNotEmpty()
    optionSpecification: string;

    @ApiProperty({ description: '사업 상품명 (Business product name)', required: false })
    @IsString()
    @IsOptional()
    businessProductName?: string;

    @ApiProperty({ description: '바코드 (Barcode) - REQUIRED for options', required: true })
    @IsString()
    @IsNotEmpty()
    barcode: string;

    @ApiProperty({ description: '추가 바코드 (Additional barcodes)', type: [String], required: false })
    @IsOptional()
    additionalBarcodes?: string[];

    @ApiProperty({ description: '판가 (Selling price)', required: true })
    @IsInt()
    @Min(0)
    @IsNotEmpty()
    sellingPrice: number;

    @ApiProperty({ description: '판매 재고 (Current stock)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    currentStock?: number;

    @ApiProperty({ description: '안전 재고 (Safety stock)', required: true })
    @IsInt()
    @Min(0)
    @IsNotEmpty()
    safetyStock: number;

    @ApiProperty({ description: '상품 위치 ID (Primary location ID)', required: false })
    @IsUUID()
    @IsOptional()
    primaryLocationId?: string;

    @ApiProperty({ description: '보관 위치 ID (Secondary location ID)', required: false })
    @IsUUID()
    @IsOptional()
    secondaryLocationId?: string;

    @ApiProperty({ description: '이미지 URL (Image URL)', required: false })
    @IsUrl()
    @IsOptional()
    imageUrl?: string;

    // Inherit dimensions from parent or specify separately
    @ApiProperty({ description: '무게 (Weight in g)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    weight?: number;

    @ApiProperty({ description: '가로 (Width in cm)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionWidth?: number;

    @ApiProperty({ description: '세로 (Height in cm)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionHeight?: number;

    @ApiProperty({ description: '높이 (Depth in cm)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    dimensionDepth?: number;

    // Pricing tiers
    @ApiProperty({ description: '판메가 (Retail price)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    retailPrice?: number;

    @ApiProperty({ description: '별매시가 (Special sale price)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    specialSalePrice?: number;

    @ApiProperty({ description: '도매가 (Wholesale price)', required: false })
    @IsInt()
    @Min(0)
    @IsOptional()
    wholesalePrice?: number;
}
```

#### 3. New DTO: `UpdateSkuOptionDto`

**File:** `/apps/wms/src/inventory/dto/sku/update-sku-option.dto.ts` (NEW)

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateSkuOptionDto } from './create-sku-option.dto';

export class UpdateSkuOptionDto extends PartialType(CreateSkuOptionDto) {}
```

#### 4. New DTO: `MoveSkuLocationDto`

**File:** `/apps/wms/src/inventory/dto/sku/move-sku-location.dto.ts` (NEW)

```typescript
import { IsString, IsNotEmpty, IsUUID, IsOptional, IsInt, Min, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MoveSkuLocationDto {
    @ApiProperty({ description: 'SKU ID or Barcode for identification' })
    @IsString()
    @IsNotEmpty()
    skuIdentifier: string; // Can be UUID or barcode

    @ApiProperty({ description: '현재 위치 ID (From location ID)' })
    @IsUUID()
    @IsNotEmpty()
    fromLocationId: string;

    @ApiProperty({ description: '이동 위치 ID (To location ID)' })
    @IsUUID()
    @IsNotEmpty()
    toLocationId: string;

    @ApiProperty({ description: '이동 수량 (Quantity to move)', required: false })
    @IsInt()
    @Min(1)
    @IsOptional()
    quantity?: number; // Nullable for full SKU moves

    @ApiProperty({ description: '이동 사유 (Reason for move)', required: false })
    @IsString()
    @IsOptional()
    reason?: string;
}

export class BulkMoveSkuLocationDto {
    @ApiProperty({
        description: 'Array of SKU move operations',
        type: [MoveSkuLocationDto]
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MoveSkuLocationDto)
    @IsNotEmpty()
    moves: MoveSkuLocationDto[];
}
```

#### 5. Enhanced `SkuResponseDto`

**File:** `/apps/wms/src/inventory/dto/sku/sku-response.dto.ts`

**Add these properties:**
```typescript
export class SkuResponseDto {
    // ... existing fields ...

    @ApiProperty({ required: false })
    businessProductName?: string;

    @ApiProperty({ required: false })
    importDeclarationNumber?: string;

    @ApiProperty({ required: false })
    logisticsPartnerId?: string;

    @ApiProperty({ required: false })
    productWeight?: number;

    @ApiProperty({ required: false })
    dimensionWidth?: number;

    @ApiProperty({ required: false })
    dimensionHeight?: number;

    @ApiProperty({ required: false })
    dimensionDepth?: number;

    @ApiProperty({ required: false })
    productMaterial?: string;

    @ApiProperty({ required: false })
    koreanName?: string;

    @ApiProperty({ required: false })
    maxDiscountQuantity?: number;

    @ApiProperty({ required: false })
    packagingImporterName?: string;

    @ApiProperty({ required: false })
    discount?: string;

    @ApiProperty({ required: false })
    manufacturerStar?: string;

    @ApiProperty({ required: false })
    productDescription?: string;

    @ApiProperty({ required: false })
    moq?: number;

    @ApiProperty({ required: false })
    memo2?: string;

    @ApiProperty({ required: false })
    memo3?: string;

    @ApiProperty({ required: false })
    mainImageUrl?: string;

    @ApiProperty()
    safetyStock: number; // Required field

    @ApiProperty({ required: false })
    currentStock?: number;

    @ApiProperty({ required: false })
    expiryDateManagement?: boolean;

    @ApiProperty({ required: false })
    expiryStartDate?: Date;

    @ApiProperty({ required: false })
    expiryEndDate?: Date;

    @ApiProperty({ required: false })
    manufacturingDateManagement?: boolean;

    @ApiProperty({ required: false })
    isGeneralInventory?: boolean;

    @ApiProperty({ required: false })
    validityStartDate?: Date;

    @ApiProperty({ required: false })
    validityEndDate?: Date;

    @ApiProperty({ required: false })
    primaryLocationId?: string;

    @ApiProperty({ required: false })
    secondaryLocationId?: string;

    @ApiProperty({ required: false })
    variantGroupCode?: string;

    // Nested pricing object
    @ApiProperty({ required: false, type: Object })
    pricing?: {
        retailPrice?: number;
        specialSalePrice?: number;
        wholesalePrice?: number;
        sellingPrice?: number;
    };

    // Nested managers object
    @ApiProperty({ required: false, type: Object })
    managers?: {
        designerId?: string;
        purchaseManagerId?: string;
        registrationManagerId?: string;
    };

    // Nested location objects
    @ApiProperty({ required: false, type: Object })
    primaryLocation?: {
        id: string;
        code: string;
        displayName: string;
    };

    @ApiProperty({ required: false, type: Object })
    secondaryLocation?: {
        id: string;
        code: string;
        displayName: string;
    };
}
```

### API Endpoints Needed

**File:** `/apps/wms/src/inventory/controllers/inventory.controller.ts`

**Current Endpoints:**
- ✅ `POST /wms/inventory/skus`
- ✅ `GET /wms/inventory/skus`
- ✅ `GET /wms/inventory/skus/:id`
- ✅ `PUT /wms/inventory/skus/:id`
- ✅ `DELETE /wms/inventory/skus/:id`
- ✅ `POST /wms/inventory/skus/:id/barcodes`
- ✅ `DELETE /wms/inventory/skus/:id/barcodes/:barcodeId`
- ✅ `GET /wms/inventory/skus/:id/stock-summary`

**Add These Endpoints:**

```typescript
// ═══════════════════════════════════════════════════════════════
// SKU Option/Variant Management
// ═══════════════════════════════════════════════════════════════

@Post('/skus/:id/options')
@ApiOperation({ summary: 'SKU에 옵션/변형 추가 (Add option/variant to SKU)' })
@ApiResponse({ status: 201, description: '옵션이 성공적으로 추가되었습니다.', type: SkuResponseDto })
@ApiResponse({ status: 400, description: '잘못된 요청 (중복 바코드 등)' })
@ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
async addSkuOption(
    @Param('id') skuId: string,
    @Body() createOptionDto: CreateSkuOptionDto
): Promise<SkuResponseDto> {
    return this.inventoryService.addSkuOption(skuId, createOptionDto);
}

@Get('/skus/:id/options')
@ApiOperation({ summary: 'SKU의 모든 옵션/변형 조회 (Get all options for SKU)' })
@ApiResponse({ status: 200, description: '옵션 목록', type: [SkuResponseDto] })
async getSkuOptions(@Param('id') skuId: string): Promise<SkuResponseDto[]> {
    return this.inventoryService.getSkuOptions(skuId);
}

@Get('/skus/:id/options/:optionId')
@ApiOperation({ summary: 'SKU 옵션 상세 조회 (Get option detail)' })
@ApiResponse({ status: 200, description: '옵션 상세 정보', type: SkuResponseDto })
@ApiResponse({ status: 404, description: '옵션을 찾을 수 없습니다.' })
async getSkuOptionById(
    @Param('id') skuId: string,
    @Param('optionId') optionId: string
): Promise<SkuResponseDto> {
    return this.inventoryService.getSkuOptionById(skuId, optionId);
}

@Put('/skus/:id/options/:optionId')
@ApiOperation({ summary: 'SKU 옵션 수정 (Update SKU option)' })
@ApiResponse({ status: 200, description: '옵션이 성공적으로 수정되었습니다.', type: SkuResponseDto })
@ApiResponse({ status: 404, description: '옵션을 찾을 수 없습니다.' })
async updateSkuOption(
    @Param('id') skuId: string,
    @Param('optionId') optionId: string,
    @Body() updateOptionDto: UpdateSkuOptionDto
): Promise<SkuResponseDto> {
    return this.inventoryService.updateSkuOption(skuId, optionId, updateOptionDto);
}

@Delete('/skus/:id/options/:optionId')
@HttpCode(HttpStatus.NO_CONTENT)
@ApiOperation({ summary: 'SKU 옵션 삭제 (Delete SKU option)' })
@ApiResponse({ status: 204, description: '옵션이 성공적으로 삭제되었습니다.' })
@ApiResponse({ status: 404, description: '옵션을 찾을 수 없습니다.' })
@ApiResponse({ status: 409, description: '재고가 있는 옵션은 삭제할 수 없습니다.' })
async deleteSkuOption(
    @Param('id') skuId: string,
    @Param('optionId') optionId: string
): Promise<void> {
    return this.inventoryService.deleteSkuOption(skuId, optionId);
}

// ═══════════════════════════════════════════════════════════════
// SKU Location Management
// ═══════════════════════════════════════════════════════════════

@Post('/skus/move-location')
@ApiOperation({ summary: 'SKU 위치 이동 (Move SKU to different location)' })
@ApiResponse({ status: 200, description: '위치 이동이 성공적으로 완료되었습니다.' })
@ApiResponse({ status: 400, description: '잘못된 요청 (유효하지 않은 위치 등)' })
@ApiResponse({ status: 404, description: 'SKU 또는 위치를 찾을 수 없습니다.' })
async moveSkuLocation(
    @Body() moveDto: MoveSkuLocationDto
): Promise<{ success: boolean; movementId: string }> {
    return this.inventoryService.moveSkuLocation(moveDto);
}

@Post('/skus/bulk-move-location')
@ApiOperation({ summary: '다중 SKU 위치 이동 (Bulk move multiple SKUs)' })
@ApiResponse({
    status: 200,
    description: '일괄 이동이 완료되었습니다.',
    schema: {
        type: 'object',
        properties: {
            success: { type: 'boolean' },
            totalMoves: { type: 'number' },
            successfulMoves: { type: 'number' },
            failedMoves: { type: 'number' },
            results: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        skuIdentifier: { type: 'string' },
                        success: { type: 'boolean' },
                        movementId: { type: 'string' },
                        error: { type: 'string' }
                    }
                }
            }
        }
    }
})
async bulkMoveSkuLocation(
    @Body() bulkMoveDto: BulkMoveSkuLocationDto
): Promise<{
    success: boolean;
    totalMoves: number;
    successfulMoves: number;
    failedMoves: number;
    results: any[]
}> {
    return this.inventoryService.bulkMoveSkuLocation(bulkMoveDto);
}

@Get('/skus/:id/location-history')
@ApiOperation({ summary: 'SKU 위치 이동 이력 조회 (Get location movement history)' })
@ApiQuery({ name: 'limit', required: false, description: '조회할 이력 수' })
@ApiQuery({ name: 'offset', required: false, description: '페이지 오프셋' })
@ApiResponse({
    status: 200,
    description: '위치 이동 이력',
    schema: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                fromLocation: { type: 'object' },
                toLocation: { type: 'object' },
                quantity: { type: 'number' },
                reason: { type: 'string' },
                movementTimestamp: { type: 'string' },
                movedBy: { type: 'string' }
            }
        }
    }
})
async getSkuLocationHistory(
    @Param('id') skuId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
): Promise<any[]> {
    return this.inventoryService.getSkuLocationHistory(skuId, limit, offset);
}

// ═══════════════════════════════════════════════════════════════
// SKU Barcode Operations
// ═══════════════════════════════════════════════════════════════

@Get('/skus/by-barcode/:barcode')
@ApiOperation({ summary: '바코드로 SKU 찾기 (Find SKU by barcode for scanning)' })
@ApiResponse({ status: 200, description: 'SKU 정보', type: SkuResponseDto })
@ApiResponse({ status: 404, description: '바코드를 찾을 수 없습니다.' })
async findSkuByBarcode(
    @Param('barcode') barcode: string
): Promise<SkuResponseDto> {
    return this.inventoryService.findSkuByBarcode(barcode);
}

@Post('/skus/:id/generate-barcode')
@ApiOperation({ summary: 'SKU 바코드 자동 생성 (Auto-generate SKU barcode)' })
@ApiResponse({
    status: 200,
    description: '바코드가 생성되었습니다.',
    schema: {
        type: 'object',
        properties: {
            barcode: { type: 'string' },
            barcodeType: { type: 'string' }
        }
    }
})
async generateBarcode(
    @Param('id') skuId: string
): Promise<{ barcode: string; barcodeType: string }> {
    return this.inventoryService.generateBarcode(skuId);
}

// ═══════════════════════════════════════════════════════════════
// SKU Variant Group Management
// ═══════════════════════════════════════════════════════════════

@Get('/skus/variant-group/:groupCode')
@ApiOperation({ summary: '변형 그룹 코드로 SKU 조회 (Get SKUs by variant group code)' })
@ApiResponse({ status: 200, description: 'SKU 목록', type: [SkuResponseDto] })
async getSkusByVariantGroup(
    @Param('groupCode') groupCode: string
): Promise<SkuResponseDto[]> {
    return this.inventoryService.getSkusByVariantGroup(groupCode);
}

@Post('/skus/:id/assign-variant-group')
@HttpCode(HttpStatus.NO_CONTENT)
@ApiOperation({ summary: 'SKU에 변형 그룹 코드 할당 (Assign variant group code to SKU)' })
@ApiResponse({ status: 204, description: '변형 그룹이 할당되었습니다.' })
async assignVariantGroup(
    @Param('id') skuId: string,
    @Body('variantGroupCode') variantGroupCode: string
): Promise<void> {
    return this.inventoryService.assignVariantGroup(skuId, variantGroupCode);
}

// ═══════════════════════════════════════════════════════════════
// SKU Pricing Management
// ═══════════════════════════════════════════════════════════════

@Put('/skus/:id/pricing')
@ApiOperation({ summary: 'SKU 가격 정보 수정 (Update SKU pricing tiers)' })
@ApiResponse({ status: 200, description: '가격이 수정되었습니다.', type: SkuResponseDto })
@ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
async updateSkuPricing(
    @Param('id') skuId: string,
    @Body() pricingDto: {
        retailPrice?: number;
        specialSalePrice?: number;
        wholesalePrice?: number;
        sellingPrice?: number;
    }
): Promise<SkuResponseDto> {
    return this.inventoryService.updateSkuPricing(skuId, pricingDto);
}

@Get('/skus/:id/pricing')
@ApiOperation({ summary: 'SKU 가격 정보 조회 (Get SKU pricing tiers)' })
@ApiResponse({
    status: 200,
    description: '가격 정보',
    schema: {
        type: 'object',
        properties: {
            retailPrice: { type: 'number' },
            specialSalePrice: { type: 'number' },
            wholesalePrice: { type: 'number' },
            sellingPrice: { type: 'number' }
        }
    }
})
async getSkuPricing(@Param('id') skuId: string): Promise<any> {
    return this.inventoryService.getSkuPricing(skuId);
}

// ═══════════════════════════════════════════════════════════════
// SKU Manager Assignment
// ═══════════════════════════════════════════════════════════════

@Put('/skus/:id/managers')
@ApiOperation({ summary: 'SKU 담당자 정보 수정 (Update SKU managers)' })
@ApiResponse({ status: 200, description: '담당자 정보가 수정되었습니다.', type: SkuResponseDto })
async updateSkuManagers(
    @Param('id') skuId: string,
    @Body() managersDto: {
        designerId?: string;
        purchaseManagerId?: string;
        registrationManagerId?: string;
    }
): Promise<SkuResponseDto> {
    return this.inventoryService.updateSkuManagers(skuId, managersDto);
}

@Get('/skus/:id/managers')
@ApiOperation({ summary: 'SKU 담당자 정보 조회 (Get SKU managers)' })
@ApiResponse({
    status: 200,
    description: '담당자 정보',
    schema: {
        type: 'object',
        properties: {
            designerId: { type: 'string' },
            purchaseManagerId: { type: 'string' },
            registrationManagerId: { type: 'string' }
        }
    }
})
async getSkuManagers(@Param('id') skuId: string): Promise<any> {
    return this.inventoryService.getSkuManagers(skuId);
}
```

### Service Layer Enhancements

**File:** `/apps/wms/src/inventory/services/inventory.service.ts`

**Add these methods (signatures only, implementation TBD):**

```typescript
import { DbTx } from '../database/schemas/wms-schema';

export class InventoryService {
    // ... existing methods ...

    // ═══════════════════════════════════════════════════════════════
    // Option/Variant Management
    // ═══════════════════════════════════════════════════════════════

    async addSkuOption(skuId: string, createOptionDto: CreateSkuOptionDto, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
        // 1. Validate parent SKU exists
        // 2. Validate barcode uniqueness
        // 3. Create option record (if separate table) or SKU with parent reference
        // 4. Link option to parent via variantGroupCode or parent_sku_id
        // 5. Create barcode records
        // 6. Create pricing records
        // 7. Return created option as SkuResponseDto
    }

    async getSkuOptions(skuId: string, tx?: DbTx): Promise<SkuResponseDto[]> {
        // Implementation needed
        // Query all SKUs with matching variantGroupCode or parent_sku_id
    }

    async getSkuOptionById(skuId: string, optionId: string, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
    }

    async updateSkuOption(skuId: string, optionId: string, updateOptionDto: UpdateSkuOptionDto, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
        // Similar to updateSku but for option record
    }

    async deleteSkuOption(skuId: string, optionId: string, tx?: DbTx): Promise<void> {
        // Implementation needed
        // 1. Check if option has stock (prevent deletion)
        // 2. Delete option record
        // 3. Cascade delete barcodes, pricing
    }

    // ═══════════════════════════════════════════════════════════════
    // Location Management
    // ═══════════════════════════════════════════════════════════════

    async moveSkuLocation(moveDto: MoveSkuLocationDto, tx?: DbTx): Promise<{ success: boolean; movementId: string }> {
        // Implementation needed
        // 1. Resolve skuIdentifier (UUID or barcode)
        // 2. Validate fromLocation and toLocation exist
        // 3. Check if SKU is currently at fromLocation (via stock_ledgers or primaryLocationId)
        // 4. Create movement record in sku_location_movements
        // 5. Update primaryLocationId in skus table
        // 6. Generate stock event if needed (MOVE event)
        // 7. Return movement ID
    }

    async bulkMoveSkuLocation(bulkMoveDto: BulkMoveSkuLocationDto, tx?: DbTx): Promise<{
        success: boolean;
        totalMoves: number;
        successfulMoves: number;
        failedMoves: number;
        results: any[]
    }> {
        // Implementation needed
        // Iterate over bulkMoveDto.moves and call moveSkuLocation for each
        // Collect results and return summary
    }

    async getSkuLocationHistory(skuId: string, limit?: number, offset?: number, tx?: DbTx): Promise<any[]> {
        // Implementation needed
        // Query sku_location_movements table filtered by skuId
        // Order by movementTimestamp DESC
        // Apply pagination
    }

    // ═══════════════════════════════════════════════════════════════
    // Barcode Operations
    // ═══════════════════════════════════════════════════════════════

    async findSkuByBarcode(barcode: string, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
        // 1. Query skus table by defaultBarcode
        // 2. If not found, query sku_barcodes table
        // 3. Return SKU data
    }

    async generateBarcode(skuId: string, tx?: DbTx): Promise<{ barcode: string; barcodeType: string }> {
        // Implementation needed
        // 1. Generate unique barcode (algorithm TBD - could be UUID-based or EAN-13)
        // 2. Insert into sku_barcodes table
        // 3. Update skus.defaultBarcode if null
        // 4. Return generated barcode
    }

    // ═══════════════════════════════════════════════════════════════
    // Variant Group Operations
    // ═══════════════════════════════════════════════════════════════

    async getSkusByVariantGroup(groupCode: string, tx?: DbTx): Promise<SkuResponseDto[]> {
        // Implementation needed
        // Query skus table WHERE variantGroupCode = groupCode
    }

    async assignVariantGroup(skuId: string, groupCode: string, tx?: DbTx): Promise<void> {
        // Implementation needed
        // Update skus SET variantGroupCode = groupCode WHERE id = skuId
    }

    // ═══════════════════════════════════════════════════════════════
    // Pricing Operations
    // ═══════════════════════════════════════════════════════════════

    async updateSkuPricing(skuId: string, pricingDto: any, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
        // 1. Upsert sku_variant_pricing record
        // 2. Return updated SKU with pricing info
    }

    async getSkuPricing(skuId: string, tx?: DbTx): Promise<any> {
        // Implementation needed
        // Query sku_variant_pricing table by skuId
    }

    // ═══════════════════════════════════════════════════════════════
    // Manager Assignment
    // ═══════════════════════════════════════════════════════════════

    async updateSkuManagers(skuId: string, managersDto: any, tx?: DbTx): Promise<SkuResponseDto> {
        // Implementation needed
        // 1. Upsert sku_managers record
        // 2. Return updated SKU with manager info
    }

    async getSkuManagers(skuId: string, tx?: DbTx): Promise<any> {
        // Implementation needed
        // Query sku_managers table by skuId
    }
}
```

---

## Integration Requirements

### 1. PIM Integration

**Objective:** Sync SKU data with PIM product variants

**Key Integration Points:**

| PIM Table | WMS Table | Relationship | Sync Direction |
|-----------|-----------|--------------|----------------|
| `product_masters` | `inventoryProductMasters` | 1:N | PIM → WMS |
| `product_variants` | `skus` | 1:1 | PIM → WMS |
| `product_option_groups` | `skus.optionKey` (jsonb) | N:N | PIM → WMS |
| `product_option_values` | `skus.optionKey` (jsonb) | N:N | PIM → WMS |
| `variant_prices` | `sku_variant_pricing` | 1:1 | PIM → WMS |
| `option_value_prices` | `sku_variant_pricing` | 1:N | PIM → WMS |

**Sync Operations Needed:**

```typescript
// Service method signatures
async createSkuFromPimVariant(variantId: string, additionalData?: Partial<CreateSkuDto>): Promise<SkuResponseDto> {
    // 1. Fetch variant data from PIM service
    // 2. Map PIM variant to WMS SKU fields
    // 3. Create SKU record
    // 4. Create pricing records from variant_prices
    // 5. Link to inventory master via masterId
}

async syncSkuOptionKeyFromPimVariant(skuId: string, variantId: string): Promise<void> {
    // 1. Fetch variant option values from PIM
    // 2. Build optionKey jsonb object
    // 3. Update skus.optionKey
}

async syncPricingFromPim(skuId: string, variantId: string): Promise<void> {
    // 1. Fetch pricing from PIM (variant_prices or option_value_prices)
    // 2. Update sku_variant_pricing table
}
```

### 2. Location Integration

**Use existing `locations` table:**
- ✅ `locations.id` → `skus.primaryLocationId`
- ✅ `locations.id` → `skus.secondaryLocationId`
- ✅ `location_racks` for physical storage details

**Integration Points:**
- Location selection dropdowns in UI must fetch from `GET /wms/inventory/locations`
- Location validation before moves via `locations.isActive` check

### 3. Stock Event Integration

**Movement operations generate stock events:**

```typescript
// When moveSkuLocation is called:
async moveSkuLocation(moveDto: MoveSkuLocationDto, tx?: DbTx) {
    // ... validation ...

    // Create stock event
    await this.stockEventService.createEvent({
        eventType: 'MOVE',
        skuId: resolvedSkuId,
        warehouseId: resolvedWarehouseId,
        locationId: moveDto.toLocationId,
        deltaQuantity: 0, // No quantity change, just location
        reason: `Location move from ${fromLocationCode} to ${toLocationCode}`,
        orderId: null,
        userId: currentUserId, // From auth context
    }, tx);

    // Create movement log
    const movementId = await this.db.insert(skuLocationMovements)
        .values({
            skuId: resolvedSkuId,
            barcode: resolvedBarcode,
            fromLocationId: moveDto.fromLocationId,
            toLocationId: moveDto.toLocationId,
            quantity: moveDto.quantity,
            reason: moveDto.reason,
            status: 'completed',
        })
        .returning({ id: skuLocationMovements.id });

    return { success: true, movementId: movementId[0].id };
}
```

---

## Implementation Plan

### Phase 1: Database Schema (Week 1)

**Priority:** CRITICAL
**Effort:** 2-3 days

**Tasks:**
1. ✅ Create migration file for new fields in `skus` table
2. ✅ Create `sku_variant_pricing` table and relations
3. ✅ Create `sku_managers` table and relations
4. ✅ Create `sku_location_movements` table and relations
5. ✅ Add indexes for performance
6. ✅ Run migrations on dev environment
7. ✅ Verify schema changes

**Deliverable:** Updated database schema with all missing fields and tables

### Phase 2: DTO Layer (Week 1)

**Priority:** HIGH
**Effort:** 1-2 days

**Tasks:**
1. ✅ Enhance `CreateSkuDto` with new fields
2. ✅ Update `UpdateSkuDto` (auto-generated from CreateSkuDto)
3. ✅ Create `CreateSkuOptionDto`
4. ✅ Create `UpdateSkuOptionDto`
5. ✅ Create `MoveSkuLocationDto` and `BulkMoveSkuLocationDto`
6. ✅ Enhance `SkuResponseDto` with new fields
7. ✅ Add validation decorators
8. ✅ Update API documentation

**Deliverable:** Complete DTO layer for all new features

### Phase 3: Service Layer - Core (Week 2-3)

**Priority:** HIGH
**Effort:** 5-7 days

**Tasks:**
1. ⬜ Update `createSku` to handle new fields and pricing/manager tables
2. ⬜ Update `updateSku` to handle new fields
3. ⬜ Update `getSkuById` to include pricing and manager joins
4. ⬜ Update `searchSkus` to filter by new fields
5. ⬜ Implement `findSkuByBarcode` method
6. ⬜ Implement `generateBarcode` method
7. ⬜ Implement `updateSkuPricing` and `getSkuPricing`
8. ⬜ Implement `updateSkuManagers` and `getSkuManagers`

**Deliverable:** Enhanced core SKU CRUD operations

### Phase 4: Service Layer - Options (Week 3-4)

**Priority:** MEDIUM-HIGH
**Effort:** 4-5 days

**Tasks:**
1. ⬜ Implement `addSkuOption` method
2. ⬜ Implement `getSkuOptions` method
3. ⬜ Implement `getSkuOptionById` method
4. ⬜ Implement `updateSkuOption` method
5. ⬜ Implement `deleteSkuOption` method (with validation)
6. ⬜ Implement `getSkusByVariantGroup` method
7. ⬜ Implement `assignVariantGroup` method

**Deliverable:** Full option/variant management capability

### Phase 5: Service Layer - Location (Week 4-5)

**Priority:** MEDIUM
**Effort:** 3-4 days

**Tasks:**
1. ⬜ Implement `moveSkuLocation` method
2. ⬜ Implement `bulkMoveSkuLocation` method
3. ⬜ Implement `getSkuLocationHistory` method
4. ⬜ Integrate with stock event system (create MOVE events)
5. ⬜ Add location validation logic

**Deliverable:** SKU location movement functionality

### Phase 6: Controller Layer (Week 5)

**Priority:** HIGH
**Effort:** 2-3 days

**Tasks:**
1. ⬜ Add new controller methods for options
2. ⬜ Add new controller methods for location moves
3. ⬜ Add new controller methods for pricing
4. ⬜ Add new controller methods for managers
5. ⬜ Add new controller methods for barcode operations
6. ⬜ Add new controller methods for variant groups
7. ⬜ Update Swagger documentation
8. ⬜ Test all endpoints with Postman/curl

**Deliverable:** Complete API endpoints for SKU management

### Phase 7: Testing (Week 6)

**Priority:** HIGH
**Effort:** 4-5 days

**Tasks:**
1. ⬜ Unit tests for service methods
2. ⬜ Integration tests for API endpoints
3. ⬜ Test transaction propagation
4. ⬜ Test validation rules
5. ⬜ Test error scenarios
6. ⬜ Test barcode generation and lookup
7. ⬜ Test location move validations
8. ⬜ Test option CRUD operations
9. ⬜ Test pricing updates
10. ⬜ Load testing for bulk operations

**Deliverable:** Comprehensive test coverage

### Phase 8: Frontend Integration (Week 7-8)

**Priority:** MEDIUM
**Effort:** 6-8 days (Frontend team)

**Tasks:**
1. ⬜ Implement SKU creation form with new fields
2. ⬜ Implement SKU edit form
3. ⬜ Implement option management table
4. ⬜ Implement option edit modal
5. ⬜ Implement location move interface
6. ⬜ Implement barcode scanning UI
7. ⬜ Integrate with image upload service
8. ⬜ Test end-to-end workflows

**Deliverable:** UI matching Figma designs

### Phase 9: PIM Integration (Week 9)

**Priority:** LOW-MEDIUM
**Effort:** 3-4 days

**Tasks:**
1. ⬜ Implement `createSkuFromPimVariant` sync method
2. ⬜ Implement `syncSkuOptionKeyFromPimVariant` method
3. ⬜ Implement `syncPricingFromPim` method
4. ⬜ Add PIM webhook listeners (if available)
5. ⬜ Test bidirectional sync

**Deliverable:** Seamless PIM-WMS integration

### Phase 10: Documentation & Deployment (Week 10)

**Priority:** MEDIUM
**Effort:** 2-3 days

**Tasks:**
1. ⬜ Update API documentation
2. ⬜ Update README with new features
3. ⬜ Create migration guide
4. ⬜ Create user manual for new features
5. ⬜ Deploy to staging
6. ⬜ QA testing
7. ⬜ Deploy to production

**Deliverable:** Production-ready SKU management system

---

## Summary Statistics

### Coverage Analysis

**Total Screens Analyzed:** 5

**Total Form Fields Identified:** ~80 fields across all screens

**Current Schema Coverage:**
- ✅ Existing fields: ~25 (31%)
- ❌ Missing fields: ~55 (69%)

**New Tables Required:** 3
- `sku_variant_pricing`
- `sku_managers`
- `sku_location_movements`

**New API Endpoints Required:** ~20 endpoints

**Estimated Implementation Effort:**
- Database: 2-3 days
- Backend: 15-20 days
- Testing: 4-5 days
- Frontend: 6-8 days (separate team)
- **Total: ~30-36 developer days**

### Risk Assessment

**HIGH RISK:**
- ❌ Large number of schema changes - migration complexity
- ❌ Potential data loss if existing SKUs have data in removed fields
- ❌ Breaking changes to existing API responses

**MEDIUM RISK:**
- ⚠️ PIM integration may require PIM schema changes
- ⚠️ Barcode generation algorithm not yet defined
- ⚠️ Location validation logic complex

**LOW RISK:**
- ✅ Most endpoints follow existing patterns
- ✅ Transaction management already in place
- ✅ Event sourcing system already functional

### Recommendations

1. **Incremental Rollout:** Implement in phases, deploying core features first
2. **Feature Flags:** Use feature flags to enable new fields gradually
3. **Data Migration:** Create scripts to populate new fields from existing data
4. **Backward Compatibility:** Maintain old API responses with deprecation warnings
5. **Documentation:** Keep comprehensive changelog for frontend team

---

**End of Analysis**

**Document Version:** 1.0
**Last Updated:** 2025-10-13
**Author:** Claude Code Analysis
**Review Status:** Pending stakeholder review
