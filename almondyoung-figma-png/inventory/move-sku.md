# Move SKU (Product Location Movement) Page

## Page Title
**발주리스트 확인** (Purchase Order List Confirmation)

## Overall Layout
Full-width application with left sidebar navigation and main content area displaying SKU movement management interface.

## Top Navigation Bar
Horizontal menu items:
- 회사/조직 (Company/Organization)
- 거래처관리 (Client Management)
- 주문/출고관리 (Order/Outbound Management)
- 재고상품 관리 (Inventory Product Management) - Currently active
- CS
- 번째 / 통계 (Statistics)
- 자사몰 관리 (Own Mall Management)
- 멤버십 관리 (Membership Management)

## Left Sidebar Navigation
Dark navy blue background with white text:

### Current Section: 재고상품 (Inventory Products)
- 재고현황 목록 (Inventory Status List)
- 재고 상품 등록 (Inventory Product Registration)

### Other Major Sections:
- **발주** (Purchase Orders)
  - 발주리스트 조회(국내) (Purchase List Inquiry - Domestic)
  - 발주리스트 조회(해외) (Purchase List Inquiry - Foreign)
  - 발주리스트 생성 (Purchase List Creation)

- **상품 입출고** (Product Inbound/Outbound)
  - 입고리스트(한국) (Inbound List - Korea)
  - 입고리스트(해외) (Inbound List - Foreign)
  - 입고 정정표 (Inbound Correction)
  - 개별 입출고 (Individual Inbound/Outbound)

- **바코드 관리** (Barcode Management)
  - 상품 바코드 관리 (Product Barcode Management)
  - 위치 바코드 관리 (Location Barcode Management)

- **창고 재고 관리** (Warehouse Stock Management)

- **재고조정(반품, 불량,손상,손실)** (Stock Adjustment - Returns, Defects, Damage, Loss)

- **상품 위치 및 재고 조사** (Product Location and Stock Investigation)

- **실 재고 조사** (Actual Stock Investigation)

- **상품 위치 이동** (Product Location Movement) - Currently active (highlighted in purple)

## Main Content Area

### Filter Section

#### Filter Controls Row:
- **입가** (Price) - Radio buttons with options:
  - 오류 (Error) - Selected
  - 아태 (Asia)
  - 입불 (Daily)
  - 전불 (All)
  - 오불 (5 Days)
  - 3불불 (3 Days)
  - 일불가라 (Date range)

- **일불가라** (Date Range) - Date pickers:
  - Start date: 2025-08-20
  - End date: 2025-08-20

- **Checkbox**: 알고 입불업 대고 배최 (Automatic stock update setting)

### Search Button
Orange button labeled "검색" (Search)

## Results Section

### Action Bar
- Total count: "총 3개" (Total 3 items)
- Action buttons:
  - 엑셀 다운로드 (Excel Download)
  - 선택 사품 (Selected Products)

## Data Table

### Column Headers:
1. Checkbox (Select all)
2. **No** (Number)
3. **바코드 번호** (Barcode Number)
4. **아이디** (ID/Image)
5. **상품명 / 바코드1,2** (Product Name / Barcode 1,2)
6. **발주처** (Supplier)
7. **발주 일체 / 입고예정일** (Order Date / Expected Inbound Date)
8. **입채일** (Inbound Date)
9. **발주 수불** (Order Quantity)
10. **입고예정일** (Expected Inbound Date)
11. **발주주가/리 / 입고예정가리** (Order Price / Expected Inbound Price)
12. **기넙** (Remarks)

### Table Data (3 rows):

**Row 1:**
- No: 1
- Barcode: 11463020000
- Image: Product bottle (powder/granules)
- Product: 버럭스 튼블 54-SA
  - Manufacturer: 2종
  - K-12~25 [기출공고 합격 절업]
  - 엽고업제: 2025-07-29 ~ 2025-07-30
- Supplier: 밀라드노마이아
- Order Date: 2025-07-28
- Expected Date: 2025-07-30
- Inbound Date: 20 체하 | 수정
- Quantity: 2,200원
- Quantity fields: Input "10" with button
- Actions:
  - 서색 (Search)
  - 발주 수정 (Order Modification)
  - 입고 절업 (Inbound Completion)

**Row 2:**
- No: 2
- Barcode: 11463020000
- Image: Product bottle
- Product: 노동드 버럴리 색괄 700g
  - Manufacturer: 2종
  - Codes: [2] 하님 발업 일업
- Supplier: JDK
- Order Date: 2025-07-28
- Expected Date: 2025-07-30
- Inbound Date: 0 체하 | 수정
- Quantity: 2,200원
- Quantity fields: Input "10" with button
- Status: 앙채업 (Completed status)
- Actions: Similar button layout

**Row 3:**
- No: 3
- Barcode: 11404020003
- Image: Product bottle (vertical)
- Product: 코디라먼 매머대고 마이어믹녀 튼블 3좋 (세일드라만조)
  - Manufacturer: 2종
  - L-00~11 [기출공고 합격 절업]
  - 기출/기업 번최
- Supplier: JDK
- Order Date: 2025-07-28
- Expected Date: 2025-07-30
- Inbound Date: 0 체하 | 수정
- Quantity: 990원
- Quantity fields: Input "1" with button
- Actions: Similar button layout

## Right Panel - Information Section

### Title: **발주리스트 확인** (Purchase Order List Confirmation)

### Section Content:

#### 입고리스트를 이관된 발주리스트 확인 및 간단한 수정
Instructions explaining how to check and modify purchase orders transferred to the inbound list.

**신청** (Application)
Details about application process for inbound lists.

**발주주가** (Purchase Order Price)
Information about purchase order pricing management.

**립고수불** (Inbound Quantity)
Details about inbound quantity tracking and management.

**공급기업** (Supplier Company)
Information about supplier company registration through product registration.

**유정기간** (Valid Period)
Details about validity period management for dated products.

**Important Notes Section (Red text):**
- 업수 노디스:
- 디킴지 제륵이 합업 리업대리스드틀 밀어먼 대리긴 합업 디감 업먼고 업먼다.
- 립고 수무거 외입제노마 업고수무거 기래업 부먼어 할업이 합니다.

## Footer
페이지네이션 (Pagination display)

## Color Scheme
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue (#2C2855)
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Text**: Dark gray/black
- **Active Menu Item**: Purple highlight
- **Status Indicators**: Various colors for different statuses

## Interactive Elements
- Radio button filters for date ranges
- Date range pickers
- Checkbox for automatic settings
- Search button
- Dropdown selectors
- Input fields for quantities
- Action buttons on each row:
  - 서색 (Search)
  - 발주 수정 (Modify Order)
  - 입고 절업 (Inbound Completion)
- Excel export functionality
- Batch selection with checkboxes

## Key Features
- Purchase order list confirmation
- Date range filtering
- Individual row editing
- Quantity adjustment
- Status tracking
- Supplier management
- Expected vs actual inbound date comparison
- Price tracking
- Batch operations support
- Excel export capability

## Visual Indicators
- Product thumbnail images
- Status badges
- Input fields with action buttons
- Clear column organization
- Color-coded action buttons
- Hierarchical information display
