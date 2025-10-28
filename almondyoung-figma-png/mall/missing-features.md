# Missing PIM Features - Mall Category

## Overview
This document identifies Product Information Management (PIM) features present in the Figma designs for the Mall category that are currently missing or incomplete in the codebase.

Based on analysis of the mall Figma designs and the current PIM implementation (`apps/pim/`), this document catalogs gaps between the design specifications and the existing codebase.

## Current PIM Implementation Summary

### ✅ Implemented Features
The PIM service (`apps/pim/`) currently includes:
- **Product Categories**: Hierarchical category management with parent-child relationships
- **Product Masters**: Base product information (name, description, brand, images, SEO)
- **Product Variants**: Variant management with options
- **Product Option Groups**: Option group and value management
- **Sales Channels**: Channel definition and management
- **Channel Products**: Channel-specific product mappings
- **File Upload**: Image upload service
- **Pricing Strategies**: Option-based and variant-based pricing

### Database Schema
- `product_categories`: Category hierarchy with slug, path, level
- `product_masters`: Sales product masters with pricing strategy
- `product_master_categories`: Many-to-many category assignments
- `product_option_groups` / `product_option_values`: Option management
- `product_variants`: Product variants with SKU mapping
- `sales_channels`: External sales channel definitions
- `channel_products`: Channel-specific product configurations

---

## Missing Features by Design Page

### 1. Dashboard (`dashboard.md`)

#### Missing Analytics/Statistics Features
- **Sales Metrics Dashboard**
  - Today's status cards (products in preparation, shipping preparation, in delivery, out of stock, etc.)
  - Net sales calculations and display
  - Payment method distribution analytics
  - Daily sales trends visualization
  - Period-based sales reporting (7-day avg, 30-day avg, totals)
  - Top 5 products by region/performance

**PIM Gap**: No analytics, statistics, or dashboard aggregation capabilities

**Impact**: HIGH - Critical for business intelligence and operational monitoring

---

### 2. Product Category Management (`sales-product-category.md`)

#### ✅ Partially Implemented
- Basic hierarchical category structure exists
- Category CRUD operations available

#### Missing Category Features
- **Display Configuration**
  - Category visibility toggle (display/hide)
  - Main category display settings
  - Platform-specific display (PC & Mobile vs Mobile-only)
  - Product display order settings (ascending/descending)
  - Default sorting configuration per category

- **Category Templates**
  - Rich text template editor for category pages
  - Template assignment per category
  - HTML/rich content support for category descriptions

- **SEO Management Per Category**
  - Browser title customization
  - Meta tag 1 (Author)
  - Meta tag 2 (Description)
  - Meta tag 3 (Keywords with comma/space separation)
  - Search engine visibility toggle

- **Category URL Management**
  - Custom category URL display
  - URL slug editing

- **Menu Position Configuration**
  - Left side menu positioning
  - Top menu positioning
  - Footer menu positioning
  - Platform-specific menu display settings

**PIM Gap**: Current `productCategories` table lacks: `displaySettings`, `templateConfig`, `seoConfig`, `menuPositions`, `visibility`

**Impact**: HIGH - Essential for frontend display and SEO

---

### 3. Product Registration Form (`sales-product-form.md`)

#### ✅ Partially Implemented
- Product master creation
- Basic information (name, description)
- Image management
- Category assignment (many-to-many)
- Option groups and values
- Variant management

#### Missing Product Form Features
- **Product Type Toggle**
  - Limited Edition vs Regular Sale distinction
  - Type-specific business rules

- **Multi-Category Assignment UI**
  - Visual breadcrumb-style category selection
  - Primary category designation (exists in DB but not in UI flow)

- **Product Information Fields**
  - Product code with auto-generation option
  - Alternative name display field
  - Material/composition field

- **Sales Classification**
  - Sales classification taxonomy
  - Purchase classification taxonomy

- **Shipping Configuration**
  - Shipping method dropdown per product

- **Pricing Configuration**
  - Market price (시판가)
  - Supply price with supplier dropdown
  - Wholesale price
  - Membership price (exists in schema but UI missing)
  - Multiple pricing tiers

- **Sales Conditions**
  - Age restriction settings
  - Purchase quantity restrictions
  - Stock availability rules
  - Sales period configuration

- **Product Variant/Option Configuration**
  - Visual variant table editor
  - Bulk variant creation
  - Variant-specific pricing
  - Variant-specific stock assignment
  - Variant images per option combination

- **Additional Product Information**
  - Product tags (exists in schema)
  - Custom attributes (exists as JSONB but no structured UI)

- **Display Settings**
  - 6+ image upload slots with dimension specifications
  - Image order management
  - Platform-specific image variants

**PIM Gap**: Many UI features missing, schema fields underutilized

**Impact**: HIGH - Core product management workflow

---

### 4. Product List (`sales-products.md`)

#### ✅ Partially Implemented
- Basic product listing
- Product search/filtering

#### Missing Product List Features
- **Alert System**
  - Pending approval count banner
  - Status-based alerts (150 products pending approval)

- **Advanced Search/Filter Panel**
  - Date range filtering with presets (Today, Yesterday, Week, Month, etc.)
  - Calendar date picker integration
  - Category selection dropdown
  - Price range selection
  - Store availability filtering
  - Sales channel filtering
  - Status filtering (on sale, draft, pending, out of stock)
  - Keyword search by multiple criteria (product code, name, category)

- **Bulk Operations**
  - Multi-select with checkboxes
  - Bulk product download/export
  - Bulk product copy/duplicate
  - Bulk management operations
  - Bulk status changes
  - Bulk pricing updates

- **Product Table Enhancements**
  - Sales channel badge display
  - Product code display
  - Official title/count display
  - Seller information
  - Multiple price display (selling/sale/wholesale)
  - Availability status with icons
  - Registration/edit/delete date tracking
  - Color-coded status indicators
  - Re-entry status badges
  - Stock status badges

- **Matching Wait List Panel**
  - Products not linked to inventory system
  - Integration status tracking
  - Matching queue management

- **Pagination**
  - Page number display and navigation

**PIM Gap**: Limited querying, no bulk operations, minimal table metadata

**Impact**: HIGH - Critical for product operations at scale

---

### 5. CSV Product Upload (`sales-product-upload.md`)

#### ❌ Not Implemented
- **CSV Bulk Import**
  - CSV template download
  - CSV file upload interface
  - Bulk product creation from CSV
  - Required field validation
  - Import error reporting

- **Individual vs CSV Tabs**
  - Tab switching between individual and bulk upload
  - Different workflows per upload method

**PIM Gap**: No bulk import capability exists

**Impact**: MEDIUM - Important for initial catalog setup and bulk updates

---

### 6. Deleted Products Management (`sales-product-trash-can.md`)

#### ❌ Not Implemented
- **Soft Delete System**
  - Soft delete flag on products
  - Deleted products list view
  - Deletion date tracking
  - Deleted by user tracking

- **Product Recovery**
  - Restore deleted products
  - Restore selected products in bulk

- **Deleted Product Search/Filter**
  - Date range filtering for deletion date
  - Category filtering of deleted products
  - Keyword search in deleted products

- **Audit Trail**
  - Registration date preservation
  - Edit date preservation
  - Deletion date recording
  - User attribution for all actions

**PIM Gap**: Hard delete only, no soft delete or recovery

**Impact**: MEDIUM - Important for data safety and audit compliance

---

### 7. Marketing Banner Management (`marketing-banner.md`, `marketing-banner-groups.md`)

#### ❌ Not Implemented
Marketing/banner management is outside core PIM scope, but may need integration points.

#### Missing Banner Features (if PIM-integrated)
- **Banner Group Management**
  - Banner group creation
  - Banner group code assignment
  - Banner group title and description
  - Platform-specific banner sizes (Mobile, PC)

- **Banner Image Management**
  - Multiple banners per group
  - Banner ordering with drag-and-drop
  - Image upload per banner
  - Link URL configuration
  - Display period settings (always vs date range)
  - HTML code support per banner
  - iFrame support

- **Banner List View**
  - Thumbnail previews
  - Image count badges
  - Enable/disable toggles per group
  - Platform-specific notes (PC-only, Mobile-only)

**PIM Gap**: No banner management exists (may be intentional - separate service)

**Impact**: LOW for PIM - Likely separate marketing service, but product-banner associations may be needed

---

## Summary of Missing Features

### Critical (HIGH Impact)
1. **Category Display & SEO Configuration** - Required for frontend rendering
2. **Advanced Product Form Features** - Core product management workflow
3. **Product List Search/Filter/Bulk Operations** - Essential for managing large catalogs
4. **Sales Metrics & Analytics Dashboard** - Business intelligence and monitoring

### Important (MEDIUM Impact)
5. **CSV Bulk Import** - Efficiency for large-scale operations
6. **Soft Delete & Product Recovery** - Data safety and compliance
7. **Product Type Differentiation** - Limited Edition vs Regular Sale

### Low Priority
8. **Banner Management** - Likely separate service

---

## Data Model Gaps

### Missing Database Fields/Tables

#### `product_categories` needs:
- `displaySettings` (JSONB): PC/Mobile visibility, menu positions
- `visibility` (boolean): Overall display toggle
- `templateConfig` (JSONB): Rich text template content
- `seoConfig` (JSONB): Browser title, meta tags, keywords
- `productDisplayOrder` (VARCHAR): Ascending/descending default
- `defaultSortField` (VARCHAR): Default sorting field

#### `product_masters` needs:
- `productType` (VARCHAR): 'limited_edition' vs 'regular_sale'
- `alternativeName` (VARCHAR): Alternative display name
- `productCode` (VARCHAR): Auto-generated or manual code
- `material` (VARCHAR): Product material/composition
- `salesClassification` (VARCHAR): Sales taxonomy
- `purchaseClassification` (VARCHAR): Purchase taxonomy
- `shippingMethod` (VARCHAR): Shipping method ID/reference
- `marketPrice` (BIGINT): Market reference price
- `supplyPrice` (BIGINT): Supply/cost price
- `supplierId` (UUID): Supplier reference
- `ageRestriction` (INTEGER): Minimum age requirement
- `minQuantity` (INTEGER): Minimum purchase quantity
- `maxQuantity` (INTEGER): Maximum purchase quantity
- `salesStartDate` (TIMESTAMP): Sales period start
- `salesEndDate` (TIMESTAMP): Sales period end
- `approvalStatus` (VARCHAR): 'pending', 'approved', 'rejected'
- `approvedAt` (TIMESTAMP): Approval timestamp
- `approvedBy` (UUID): Approver user ID
- `deletedAt` (TIMESTAMP): Soft delete timestamp
- `deletedBy` (UUID): Deleter user ID
- `seller` (VARCHAR): Seller/source attribution
- `registrationDate` (TIMESTAMP): Original registration date
- `lastEditDate` (TIMESTAMP): Last edit timestamp

#### `product_variants` needs:
- `variantImages` (JSONB): Variant-specific images
- `variantCode` (VARCHAR): Unique variant code

#### New Table Needed: `product_approval_history`
- `id` (UUID)
- `productId` (UUID)
- `status` (VARCHAR): 'pending', 'approved', 'rejected'
- `comment` (TEXT)
- `approvedBy` (UUID)
- `approvedAt` (TIMESTAMP)

#### New Table Needed: `product_audit_log`
- `id` (UUID)
- `productId` (UUID)
- `action` (VARCHAR): 'created', 'updated', 'deleted', 'restored'
- `changes` (JSONB): Field-level changes
- `userId` (UUID)
- `timestamp` (TIMESTAMP)

---

## API Endpoints Needed

### Category Management
- `PATCH /api/pim/categories/:id/display-settings` - Update display configuration
- `PATCH /api/pim/categories/:id/seo` - Update SEO settings
- `PATCH /api/pim/categories/:id/template` - Update category template

### Product Management
- `GET /api/pim/products/pending-approval` - Get products awaiting approval
- `POST /api/pim/products/bulk-import` - CSV bulk import
- `POST /api/pim/products/bulk-update` - Bulk update operation
- `POST /api/pim/products/bulk-delete` - Bulk soft delete
- `GET /api/pim/products/deleted` - List soft-deleted products
- `POST /api/pim/products/:id/restore` - Restore deleted product
- `GET /api/pim/products/export` - Export products to CSV
- `GET /api/pim/products/matching-queue` - Get unmatched products

### Product Approval Workflow
- `POST /api/pim/products/:id/submit-approval` - Submit for approval
- `POST /api/pim/products/:id/approve` - Approve product
- `POST /api/pim/products/:id/reject` - Reject product

### Analytics & Dashboard
- `GET /api/pim/dashboard/metrics` - Get dashboard metrics
- `GET /api/pim/analytics/sales` - Sales analytics
- `GET /api/pim/analytics/top-products` - Top performing products

---

## Frontend Requirements

### New UI Components Needed
1. **Advanced Filter Panel** - Multi-criteria search with date pickers
2. **Bulk Operation Toolbar** - Checkbox selection with bulk actions
3. **Status Badge System** - Color-coded status indicators
4. **Category Tree Editor** - Hierarchical category management
5. **Variant Table Editor** - Dynamic variant creation/management
6. **Image Upload Grid** - Multiple image slots with drag-and-drop
7. **Rich Text Template Editor** - WYSIWYG editor for category templates
8. **CSV Import Wizard** - Step-by-step bulk import flow
9. **Approval Workflow UI** - Submit/approve/reject interface
10. **Analytics Dashboard** - Charts and metrics display

---

## Recommended Implementation Priority

### Phase 1: Core Product Management (Weeks 1-2)
1. Add missing product fields to schema
2. Implement soft delete with `deletedAt`
3. Add product approval workflow
4. Enhance product list filtering and search
5. Implement bulk operations (delete, update, export)

### Phase 2: Category Enhancement (Week 3)
1. Add display settings to categories
2. Implement SEO configuration per category
3. Add category template support
4. Implement visibility and menu position controls

### Phase 3: Advanced Features (Week 4)
1. CSV bulk import/export
2. Product audit logging
3. Deleted product recovery
4. Matching queue management

### Phase 4: Analytics & Monitoring (Week 5)
1. Dashboard metrics aggregation
2. Sales analytics endpoints
3. Top products reporting
4. Alert system for pending approvals

---

## Integration Points with Other Services

### WMS Integration
- Product variants must map to SKUs in WMS
- Stock availability affects product display status
- Matching queue bridges PIM and WMS

### Order/Outbound Integration
- Product pricing feeds order management
- Product availability rules enforcement
- Sales channel specific product visibility

### Customer/Company Integration
- Wholesale-only product filtering by customer type
- Membership-only product access control
- Age restriction enforcement

---

## Notes
- Current schema has `isWholesaleOnly`, `isMembershipOnly`, `membershipPrice`, `wholesalePrice` but UI doesn't expose these
- `attributes` JSONB field exists but lacks structured usage
- `tags` array exists but no tag management UI
- Many design features assume frontend state management (filters, selections, bulk operations)
