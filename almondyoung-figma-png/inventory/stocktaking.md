# Stocktaking (Inventory Audit) Page

## Page Title
**상품 위치 이동** (Product Location Movement)

## Overall Layout
Full-width application with left sidebar navigation and main content area showing a barcode scanning/search interface.

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
Dark navy blue background with hierarchical menu structure:

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

### Section Header (Light blue background)
**검색** (Search)

### Barcode Scanning Section

#### Row 1: Warehouse Selection
- **창고 선택** (Warehouse Selection)
  - Text field: "바코드 스캔" (Barcode Scan)
  - Button: Orange "검색" (Search) button (right-aligned)

#### Row 2: Barcode Input
- **위치바코드 입력** (Location Barcode Input)
  - Button: Orange "검색" (Search) button (right-aligned)

### Action Buttons Row
Four buttons displayed horizontally:
1. **전체선택** (Select All) - White button
2. **전체해제** (Deselect All) - White button
3. **심사/대업 영역대로 및 스챔** (Inspection/Location Area and Scan) - White button
4. **성념 상품 자동실귀** (Product Auto-registration) - Green button (right-aligned)

### Instructions Section

Below the action buttons, there is instructional text explaining:
- Detailed usage instructions with numbered steps
- Red numbered bullet points (1, 2, 3) explaining the workflow

#### Instruction Steps Visible:
Multiple columns of text providing guidance on:
- Barcode scanning process
- Location verification
- Stock taking procedures
- Product registration methods

### Data Table Section

#### Table Headers:
- **No** (Number)
- **스캔일시** (Scan Date/Time)
- **전정일시** (Confirmation Date/Time)
- **상품명** (Product Name)
- **웁션명** (Option Name)
- **바코드번호** (Barcode Number)
- **출고제재** (Outbound Status)
- **총고제재** (Total Status)
- **성석** (Status)

#### Empty State Message:
"검색 후 이용해 주세요." (Please use after searching)

The table is currently empty, waiting for scan data to be populated.

## Right Panel - Instructions (Partially Visible)

Shows a text panel with detailed instructions and guidelines for the stocktaking process.

## Footer
페이지네이션 (Pagination area)

## Color Scheme
- **Primary Action**: Orange buttons (Search)
- **Secondary Action**: White/gray buttons (Select All, Deselect All)
- **Success Action**: Green button (Auto-registration)
- **Section Headers**: Light blue background
- **Sidebar**: Dark navy blue (#2C2855)
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Text**: Dark gray/black
- **Active Menu Item**: Purple highlight

## Interactive Elements
- Text input fields for barcode scanning
- Search buttons for initiating scans
- Multiple action buttons for batch operations
- Checkbox functionality (implied by select all/deselect)
- Data table for displaying scanned items
- Pagination controls

## Key Features
- Barcode scanning interface
- Warehouse selection
- Location barcode input
- Real-time scanning capabilities
- Batch operations (select all, deselect all)
- Product auto-registration
- Scan timestamp tracking
- Stock status verification
- Empty state guidance
- Comprehensive instructions

## Workflow Support
1. Select warehouse
2. Scan location barcode
3. Scan product barcodes
4. Review scanned items in table
5. Verify stock status
6. Use batch operations as needed
7. Auto-register products
8. Confirm and complete stocktaking

## Visual Indicators
- Clear section separation with colored backgrounds
- Button grouping for related actions
- Empty state message
- Instructional text with numbered steps
- Table structure for organized data display

## Functionality
- Real-time barcode scanning
- Location verification
- Stock audit tracking
- Batch selection and processing
- Automatic product registration
- Timestamp recording for audits
- Status tracking per item
- Search and filter capabilities

## User Experience
- Simple, focused interface for scanning
- Clear action buttons
- Step-by-step instructions
- Empty state guidance
- Color-coded buttons for different actions
- Organized table layout for review
- Sidebar navigation for quick access to other functions
