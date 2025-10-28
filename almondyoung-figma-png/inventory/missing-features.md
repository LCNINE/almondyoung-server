# Missing PIM Features - Inventory Category

## Overview
This document identifies Product Information Management (PIM) features present in the Figma designs for the Inventory category that are currently missing or incomplete in the codebase.

The inventory category has significant overlap with WMS (Warehouse Management System) functionality. This document focuses specifically on PIM-related features such as SKU/product master data, product variants, and the bridge between sales products (PIM) and warehouse stock items (WMS).

---

## Current PIM Implementation Summary

### ✅ Implemented in PIM
- **Product Masters**: Base sales product information
- **Product Variants**: Variant management with option combinations
- **Product Option Groups/Values**: Option definitions
- **SKU Reference**: Variants can reference WMS SKU IDs

### ✅ Implemented in WMS
- **SKU Management**: Physical stock items with barcodes, locations
- **Stock Events**: Event-sourced inventory transactions
- **Stock Summary**: Current stock levels by SKU/location
- **Location Management**: Warehouse location hierarchy

### Gap: PIM ↔ WMS Integration
The bridge between PIM (sales products) and WMS (physical stock) needs strengthening.

---

## Missing Features by Design Page

### 1. SKU Registration Form (`sku-form.md`, `sku-edit-form.md`)

The SKU form in the designs represents **WMS-side SKU management**, but it has important **PIM integration points** that are missing.

#### ✅ Partially Implemented (WMS Side)
- Basic SKU creation in WMS
- Barcode management (up to 3 barcodes per SKU)
- Location assignment
- Stock quantity tracking

#### Missing PIM Integration Features

##### A. Product Master Linkage
- **Link SKU to PIM Product Variant**
  - UI to select which PIM product master this SKU belongs to
  - Option to select specific variant (if variant-based pricing)
  - Auto-fill product name from PIM when linked
  - Sync product images from PIM

**Current Gap**: WMS SKUs have `externalProductId` but no structured UI workflow to link to PIM

**Impact**: HIGH - Without this, SKUs and sales products remain disconnected

##### B. Supplier Management
- **Supply Price & Supplier Dropdown**
  - Supplier entity/table (may belong to Company/Organization service)
  - Supply price per SKU
  - Supplier selection dropdown with search
  - "New Registration" button for quick supplier creation

**Current Gap**: No supplier entity or pricing in WMS schema

**Impact**: HIGH - Critical for purchase orders and cost tracking

##### C. Product Classification
- **Product Category Assignment**
  - Dropdown to assign product to category (from PIM)
  - Category-based filtering and reporting

**Current Gap**: SKUs don't reference PIM categories directly

**Impact**: MEDIUM - Affects reporting and organization

##### D. Logistics Information (WMS Schema Extension Needed)
- **Product Weight** (grams)
  - Numeric field with unit
  - Checkbox: "Convenience store eligible" (lightweight products)

- **Product Dimensions** (cm)
  - Width × Height × Depth fields
  - Checkbox: "Maximum frequency coefficient" (for shipping calculations)

- **Product Material/Composition**
  - Text field for material description
  - Checkbox: "Labeling precautions"

**Current Gap**: WMS `skus` table lacks: `weight`, `dimensions`, `material`, `shippingMetadata`

**Impact**: HIGH - Essential for shipping, logistics, and customs

##### E. Stock Information (Partially in WMS)
- **Current Stock**: ✅ Exists in WMS (via stock_summary projection)
- **Safety Stock Level**: ❌ Missing in WMS
- **Valid Period (Expiration Date Tracking)**: ❌ Missing in WMS

**Current Gap**: WMS lacks `safetyStockLevel`, `expirationDate`, `expirationDays`

**Impact**: HIGH - Critical for reorder automation and perishable goods

##### F. Channel Integration Information
- **Sales Channel Linkage**
  - Checkbox: "Link to sales channels (PIM)"
  - Show which PIM sales channels this SKU serves
  - Show channel-specific product codes

**Current Gap**: No direct SKU → sales channel mapping

**Impact**: MEDIUM - Useful for cross-channel inventory visibility

##### G. Image Management for SKU
- **Representative Image Upload**
  - Image upload with size specifications (500x500 - 1000x1000 px)
  - SKU-level images (different from product master images)

**Current Gap**: WMS SKUs lack image support

**Impact**: LOW-MEDIUM - Useful for warehouse operators

##### H. Product Description & MOQ
- **Product Description**: Text area for warehouse notes
- **MOQ (Minimum Order Quantity)**: Per-SKU MOQ
- **Additional Custom Fields**: Custom text fields for notes

**Current Gap**: WMS SKUs lack `description`, `moq`, `notes`

**Impact**: MEDIUM - Important for purchasing workflow

##### I. Product Environment/Management
- **Product Designer**: Dropdown to assign designer
- **Product Promoter**: Dropdown to assign promoter

**Current Gap**: No user role assignments at SKU level

**Impact**: LOW - Nice-to-have for attribution

---

### 2. SKU Option Form (`sku-option-form.md`, `sku-option-edit-form.md`)

This form appears to manage **option-level SKUs** or **variant-level SKUs** with deep PIM integration.

#### Missing Features

##### A. Business Product Name
- **Alternative Business Name**: Different name for internal use
- **Import Food Management Code**: For regulated products

**Current Gap**: No alternate naming fields

**Impact**: LOW-MEDIUM - Useful for compliance and internal operations

##### B. Channel Pricing Integration
- **Sales Price by Channel**: Table showing pricing per sales channel
- **Wholesale Price**: Channel-specific wholesale pricing
- **Margin Display**: Calculated margin per channel

**Current Gap**: Pricing lives in PIM, but SKU-level view is missing

**Impact**: MEDIUM - Visibility for purchasing decisions

##### C. Sales Distribution Information
- **Pricing and Distribution Table**: Shows how pricing is distributed across sales channels

**Current Gap**: No aggregated view from WMS side

**Impact**: LOW - Informational only

##### D. Registration/Audit Information
- **Registration Date**: With user attribution
- **Last Modified Date**: With user attribution

**Current Gap**: WMS tracks `createdAt`/`updatedAt` but no user attribution

**Impact**: MEDIUM - Important for audit trail

---

### 3. Create Sales Product Form (`create-sales-product-form-1.md`, `create-sales-product-form-2.md`)

This form is the **automatic SKU creation workflow** when a sales product is registered in PIM.

#### Core Workflow: PIM Product → Auto-Create WMS SKU

The designs describe a **3-tab modal** for creating inventory from sales products:

1. **Tab 1: Product Stock Assignment (자품 제고 배치)**
   - Automatically create SKUs when sales product is registered in PIM
   - Map PIM product variants to WMS SKUs

2. **Tab 2: Receive Stock Assignment (수품 제고 배치)**
   - Create SKUs for receiving/inbound stock

3. **Tab 3: Internal Inventory Input (재고내부 입력)**
   - Manual SKU entry

#### ❌ Completely Missing: Auto-SKU Creation

**Current Gap**: No automatic SKU creation when PIM products are created

**Impact**: CRITICAL - Manual SKU creation is error-prone and inefficient

#### Missing Features for Auto-Creation

##### A. Product Category Dropdown
- **Product Category Selection**: Choose which category this stock belongs to
- Link to PIM categories

##### B. Logistics Selection
- **Logistics Provider Dropdown**: Which warehouse/3PL handles this product

##### C. Supply Price & Supplier Linkage
- **Supplier Dropdown with Search**: Select supplier
- **New Registration**: Quick supplier creation
- Auto-fill supplier information

##### D. Import Management Selection
- **Import Management Dropdown**: For imported goods

##### E. Classification (Category)
- **Category Assignment**: Link to PIM category tree

##### F. Product Variant Table
- **Variant Selection Table**: Shows all variants from PIM
- **Checkbox Selection**: Which variants to create SKUs for
- **Quantity Input**: Initial stock quantity per variant
- **Price Input**: Supply price per variant
- Columns:
  - Number
  - Variant Name/Option Combination
  - Variant Code
  - Price (cost)

##### G. MOQ and Custom Fields
- **MOQ**: Minimum order quantity
- **Custom Fields**: Additional fields for notes

##### H. Import Food Certification
- **Checkbox**: "Import food settlement" for regulated products

##### I. Matching Settings
- **Product Matching Strategy**
  - Force match inventory to sales products
  - Set MOQ value (minimum 50)
  - Product composition search
  - Auto-match after creation

**Current Gap**: Entire auto-creation workflow missing

**Impact**: CRITICAL - Core integration between PIM and WMS

---

### 4. Barcode Management (`barcode-management.md`, `location-barcode-management.md`)

These pages manage **barcode printing and scanning** workflows.

#### ✅ Partially Implemented (WMS Side)
- SKUs have barcode fields
- Locations have barcode fields

#### Missing Features

##### A. Barcode Printing Queue
- **Print Queue Management**
  - Select SKUs to print barcodes for
  - Quantity input per SKU
  - Batch printing
  - Print queue status

##### B. Product Search with Barcode Integration
- **Search by Barcode**: Find products by scanning barcode
- **Product Image Display**: Show product image after scan
- **Location Display**: Show where product is located

##### C. Location Barcode Management
- **Location Search**: Search locations by barcode
- **Barcode Input Field**: Manual or scan input
- **Instructions Panel**: Workflow instructions for warehouse staff

**Current Gap**: No barcode printing queue, no scan-to-find workflow

**Impact**: MEDIUM - Important for warehouse operations

---

### 5. Inventory Status Inquiry (`inventory-status-inquery.md`, `inventory-status-inquery-below-safety-stock.md`, `inventory-status-desc.md`)

These pages show **real-time inventory status** with deep PIM integration.

#### ✅ Partially Implemented (WMS Side)
- Stock summary projections exist
- Query by SKU

#### Missing PIM Integration Features

##### A. Safety Stock Alerts
- **Below Safety Stock Filter**: Show only SKUs below safety stock threshold
- **Row Highlighting**: Pink/salmon highlighting for low stock items
- **Count Badge**: "99,967 items" with filtered count

**Current Gap**: No safety stock field in WMS, no alert system

**Impact**: HIGH - Critical for reorder automation

##### B. Sales Data Integration
- **1-Month Sales Column**: Show sales velocity from order data
- Calculate suggested reorder quantities based on sales

**Current Gap**: No cross-service analytics between PIM/WMS/Orders

**Impact**: MEDIUM - Useful for purchasing decisions

##### C. Comprehensive Product Display
- **Product Image**: Thumbnail from PIM
- **Product Name**: From PIM product master
- **Barcode**: From WMS SKU
- **Location**: From WMS stock_summary
- **Current Stock**: From WMS stock_summary
- **Safety Stock**: ❌ Missing field
- **1-Month Sales**: ❌ Missing cross-service data
- **Supply Price**: ❌ Missing in WMS
- **Selling Price**: From PIM product variants
- **Supplier Link**: ❌ Missing supplier entity

**Current Gap**: Many fields scattered or missing

**Impact**: HIGH - Essential for operational visibility

##### D. Action Buttons Per Row
- **Adjust**: Quick stock adjustment
- **Inbound**: Create inbound order
- **Outbound**: Create outbound task
- **PDF Export**: Export inventory report

**Current Gap**: No quick action workflows

**Impact**: MEDIUM - Efficiency for warehouse staff

---

### 6. Purchase Inquiry & Purchase Cart (`purchase-inquery.md`, `purchase-cart-inquery.md`)

These pages manage **purchase order suggestions and cart** based on inventory levels.

#### ❌ Not Implemented

**Note**: This may belong to a separate Purchase Order service, but needs PIM data.

#### Missing Features

##### A. Purchase Suggestion Engine
- **Below Safety Stock Alert**: "50 items below safety stock" banner
- **Auto-Generate Purchase Suggestions**: Based on safety stock thresholds
- **MOQ Tracking**: Show MOQ badges per item
- **Filter by Safety Stock Status**: Buttons to filter

**Current Gap**: No purchase order suggestion system

**Impact**: HIGH - Critical for inventory replenishment automation

##### B. Purchase Cart Management
- **Add to Cart**: Select items to purchase
- **Quantity Adjustment**: Per-item quantity fields
- **MOQ Validation**: Ensure quantities meet MOQ
- **Supplier Grouping**: Group cart items by supplier

**Current Gap**: No purchase cart entity

**Impact**: HIGH - Essential for purchasing workflow

##### C. Purchase Inquiry View
- **Filter by Product Category**: Dropdown
- **Filter by Supplier**: Dropdown
- **Display Method**: Grid vs list view toggle
- **Product Data Table**:
  - Product image and name (from PIM)
  - Barcode (from WMS)
  - Current stock (from WMS)
  - Safety stock (missing field)
  - Sales price (from PIM)
  - Supply price (missing field)
  - Margin calculation
  - Action buttons (adjust, inbound, outbound)

**Current Gap**: No unified purchase inquiry view

**Impact**: HIGH - Core purchasing workflow

---

### 7. Move SKU (`move-sku.md`)

This page shows **stock movement tracking**.

#### ✅ Partially Implemented (WMS Side)
- Movement tracking via stock events

#### Missing Features

##### A. Purchase Order Confirmation List
- **Expected Inbound Date**: Planned arrival date
- **Quantity**: Expected quantity
- **Location Codes**: Destination locations
- **Supplier Information**: Supplier name
- **Status Indicators**: Completion status

**Current Gap**: No purchase order entity linking to movements

**Impact**: MEDIUM - Useful for inbound planning

---

### 8. Stocktaking (`stocktaking.md`)

This page manages **physical inventory audits** via barcode scanning.

#### ✅ Partially Implemented (WMS Side)
- Stock events support adjustments

#### Missing Features

##### A. Barcode Scanning Interface
- **Warehouse Selection Dropdown**: Choose which warehouse to audit
- **Location Barcode Input**: Scan or enter location barcode
- **Product Scanning Table**: Scanned items appear in table
- **Auto-Registration**: Automatically register scanned items

##### B. Batch Actions
- **Select All**: Select all scanned items
- **Deselect All**: Clear selections
- **Auto-Registration Button** (Green): Confirm all scanned items

##### C. Workflow Instructions
- **Numbered Steps**: Clear workflow for warehouse staff
- **Browser Compatibility Notes**: Firefox, Chrome

**Current Gap**: No scan-based stocktaking UI

**Impact**: HIGH - Core warehouse operation

---

### 9. Inbound Lists (`inbound-list-1.md`, `inbound-list-2.md`)

These pages manage **inbound receiving operations**.

#### ✅ Partially Implemented (WMS Side)
- Inbound module exists with receiving tasks

#### Missing PIM Integration

##### A. Product Display in Inbound List
- **Product Image**: From PIM
- **Product Name**: From PIM
- **Supplier Information**: ❌ Missing supplier entity
- **Expected Date**: Inbound schedule
- **Quantity Inputs**: Planned vs actual quantities

##### B. Batch Import Dialog
- **CSV/Excel Import**: Bulk inbound registration
- **Item Detail Popup**: Show barcode and transaction history

**Current Gap**: Supplier linkage missing, no bulk import

**Impact**: MEDIUM - Efficiency improvements

---

## Summary of Missing PIM Features in Inventory

### Critical (HIGH Impact)
1. **Auto-SKU Creation Workflow**: Automatically create WMS SKUs when PIM products/variants are created
2. **Safety Stock Management**: Safety stock thresholds and alerts
3. **Supplier Entity & Supply Pricing**: Supplier management and cost tracking
4. **Purchase Suggestion Engine**: Automated reorder suggestions based on safety stock
5. **Logistics Information**: Weight, dimensions, material for SKUs
6. **Comprehensive Inventory Status View**: Unified view combining PIM, WMS, and sales data

### Important (MEDIUM Impact)
7. **Product Matching System**: Force-match PIM variants to WMS SKUs
8. **Channel Pricing Visibility**: Show PIM pricing from WMS context
9. **Barcode Printing Queue**: Print barcodes for SKUs
10. **Purchase Cart Management**: Cart for creating purchase orders
11. **Audit Trail with User Attribution**: Track who created/modified SKUs
12. **Stocktaking Scan Interface**: Barcode-based physical inventory audit

### Low Priority
13. **Designer/Promoter Attribution**: Role assignments at SKU level
14. **SKU Images**: Warehouse-facing images separate from sales images

---

## Data Model Gaps

### WMS Schema Extensions Needed

#### `skus` table needs:
- `externalProductVariantId` (UUID): Link to PIM product variant (more specific than `externalProductId`)
- `supplierId` (UUID): Link to supplier entity
- `supplyPrice` (BIGINT): Cost price from supplier
- `weight` (INTEGER): Weight in grams
- `widthCm` (DECIMAL): Width in cm
- `heightCm` (DECIMAL): Height in cm
- `depthCm` (DECIMAL): Depth in cm
- `material` (TEXT): Material/composition description
- `shippingMetadata` (JSONB): Convenience store eligible, max frequency, etc.
- `safetyStockLevel` (INTEGER): Minimum stock threshold
- `moq` (INTEGER): Minimum order quantity
- `expirationDays` (INTEGER): Days until expiration (for perishable goods)
- `description` (TEXT): Warehouse notes
- `notes` (TEXT): Additional notes
- `imageUrl` (TEXT): SKU-specific image
- `designerId` (UUID): Designer attribution
- `promoterId` (UUID): Promoter attribution
- `createdBy` (UUID): User who created
- `updatedBy` (UUID): User who last updated

#### New Table: `suppliers`
- `id` (UUID)
- `name` (VARCHAR)
- `code` (VARCHAR): Unique supplier code
- `contactName` (VARCHAR)
- `contactEmail` (VARCHAR)
- `contactPhone` (VARCHAR)
- `address` (TEXT)
- `paymentTerms` (VARCHAR)
- `leadTimeDays` (INTEGER)
- `notes` (TEXT)
- `isActive` (BOOLEAN)
- `createdAt` (TIMESTAMP)
- `updatedAt` (TIMESTAMP)
- `createdBy` (UUID)
- `updatedBy` (UUID)

#### New Table: `purchase_orders`
- `id` (UUID)
- `orderNumber` (VARCHAR): Unique PO number
- `supplierId` (UUID): Reference to suppliers
- `status` (VARCHAR): 'draft', 'submitted', 'confirmed', 'partially_received', 'received', 'cancelled'
- `orderDate` (DATE)
- `expectedDate` (DATE)
- `receivedDate` (DATE)
- `totalAmount` (BIGINT)
- `notes` (TEXT)
- `createdBy` (UUID)
- `approvedBy` (UUID)
- `createdAt` (TIMESTAMP)
- `updatedAt` (TIMESTAMP)

#### New Table: `purchase_order_items`
- `id` (UUID)
- `purchaseOrderId` (UUID): Reference to purchase_orders
- `skuId` (UUID): Reference to skus
- `quantity` (INTEGER)
- `unitPrice` (BIGINT): Price per unit
- `totalPrice` (BIGINT): quantity × unitPrice
- `receivedQuantity` (INTEGER)
- `notes` (TEXT)

#### New Table: `purchase_cart`
- `id` (UUID)
- `userId` (UUID)
- `skuId` (UUID)
- `quantity` (INTEGER)
- `createdAt` (TIMESTAMP)
- `updatedAt` (TIMESTAMP)

#### New Table: `sku_matching_queue`
- `id` (UUID)
- `pimProductVariantId` (UUID): PIM variant waiting to be matched
- `suggestedSkuId` (UUID): Auto-suggested WMS SKU
- `status` (VARCHAR): 'pending', 'matched', 'rejected'
- `matchedAt` (TIMESTAMP)
- `matchedBy` (UUID)

#### New Table: `barcode_print_queue`
- `id` (UUID)
- `skuId` (UUID)
- `quantity` (INTEGER)
- `status` (VARCHAR): 'pending', 'printing', 'printed'
- `printedAt` (TIMESTAMP)
- `printedBy` (UUID)

---

## API Endpoints Needed

### SKU Management
- `POST /api/wms/skus/create-from-pim-variant` - Auto-create SKU from PIM variant
- `POST /api/wms/skus/batch-create-from-pim` - Bulk create SKUs from PIM products
- `GET /api/wms/skus/:id/pim-details` - Get PIM product details for a SKU
- `PATCH /api/wms/skus/:id/logistics` - Update weight, dimensions, material
- `PATCH /api/wms/skus/:id/safety-stock` - Update safety stock level
- `PATCH /api/wms/skus/:id/supplier` - Update supplier information

### Supplier Management
- `GET /api/wms/suppliers` - List all suppliers
- `POST /api/wms/suppliers` - Create new supplier
- `GET /api/wms/suppliers/:id` - Get supplier details
- `PATCH /api/wms/suppliers/:id` - Update supplier
- `DELETE /api/wms/suppliers/:id` - Soft delete supplier

### Purchase Orders
- `GET /api/wms/purchase-orders` - List purchase orders
- `POST /api/wms/purchase-orders` - Create new PO
- `GET /api/wms/purchase-orders/:id` - Get PO details
- `PATCH /api/wms/purchase-orders/:id` - Update PO
- `POST /api/wms/purchase-orders/:id/submit` - Submit for approval
- `POST /api/wms/purchase-orders/:id/approve` - Approve PO
- `POST /api/wms/purchase-orders/:id/receive` - Mark as received

### Purchase Cart
- `GET /api/wms/purchase-cart` - Get current user's cart
- `POST /api/wms/purchase-cart/items` - Add item to cart
- `PATCH /api/wms/purchase-cart/items/:id` - Update cart item quantity
- `DELETE /api/wms/purchase-cart/items/:id` - Remove from cart
- `POST /api/wms/purchase-cart/create-po` - Convert cart to purchase order

### Inventory Inquiry
- `GET /api/wms/inventory/status` - Comprehensive inventory status with PIM data
- `GET /api/wms/inventory/below-safety-stock` - Items below safety stock
- `GET /api/wms/inventory/purchase-suggestions` - Auto-generated purchase suggestions
- `POST /api/wms/inventory/quick-adjust` - Quick stock adjustment
- `POST /api/wms/inventory/export` - Export inventory report

### Product Matching
- `GET /api/wms/matching-queue` - Get unmatched PIM variants
- `POST /api/wms/matching-queue/:id/match` - Match PIM variant to SKU
- `POST /api/wms/matching-queue/:id/create-sku` - Create new SKU from variant

### Barcode Management
- `GET /api/wms/barcodes/print-queue` - Get barcode print queue
- `POST /api/wms/barcodes/print-queue` - Add SKUs to print queue
- `POST /api/wms/barcodes/print/:id` - Mark as printed

### Stocktaking
- `POST /api/wms/stocktaking/sessions` - Start stocktaking session
- `POST /api/wms/stocktaking/sessions/:id/scan` - Record barcode scan
- `POST /api/wms/stocktaking/sessions/:id/complete` - Complete stocktaking

---

## Integration Architecture

### PIM → WMS Flow
1. **Product Created in PIM** → Trigger auto-create SKU workflow
2. **Variant Added to PIM Product** → Option to create corresponding SKU
3. **Product Updated in PIM** → Sync name, images, pricing to linked SKUs
4. **Product Deleted in PIM** → Mark linked SKUs as "orphaned" (require review)

### WMS → PIM Flow
1. **SKU Created Manually** → Option to link to existing PIM variant
2. **Stock Level Changes** → Trigger inventory status updates
3. **Below Safety Stock** → Generate purchase suggestions (may trigger PIM analytics)

### Cross-Service Analytics
- **Inventory Status View** needs: PIM product data + WMS stock data + Order sales data
- **Purchase Suggestions** needs: WMS stock levels + PIM pricing + Order sales velocity

### Event-Driven Integration
- Use message queue (e.g., RabbitMQ, Kafka) for async communication
- Events:
  - `pim.product.created`
  - `pim.product.updated`
  - `pim.variant.created`
  - `wms.stock.below-safety-stock`
  - `wms.sku.created`
  - `orders.sales-velocity.updated`

---

## Recommended Implementation Priority

### Phase 1: Core SKU-PIM Bridge (Weeks 1-2)
1. Add `suppliers` table and API
2. Add supplier, supply price, safety stock, logistics fields to `skus`
3. Implement `POST /api/wms/skus/create-from-pim-variant`
4. Implement SKU matching queue

### Phase 2: Purchase Management (Weeks 3-4)
1. Add `purchase_orders` and `purchase_order_items` tables
2. Add `purchase_cart` table
3. Implement purchase cart API
4. Implement purchase order workflow
5. Implement purchase suggestions based on safety stock

### Phase 3: Inventory Inquiry Enhancement (Week 5)
1. Implement comprehensive inventory status API
2. Add below-safety-stock filtering
3. Add quick actions (adjust, inbound, outbound)
4. Add export functionality

### Phase 4: Barcode & Stocktaking (Week 6)
1. Implement barcode print queue
2. Implement stocktaking session management
3. Implement scan-based workflows

---

## Notes
- Many features require a **Supplier Management service** - this may be part of Company/Organization service or a standalone microservice
- **Purchase Order management** is a substantial feature set that may warrant its own microservice
- The "auto-create SKU" workflow is **critical** and should be prioritized
- Safety stock thresholds are essential for automation but currently missing
- Cross-service data aggregation (PIM + WMS + Orders) requires careful API design and caching strategies
