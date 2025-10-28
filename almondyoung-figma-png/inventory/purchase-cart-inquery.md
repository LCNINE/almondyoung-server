# Purchase Cart Inquiry Page

## Page Title
**재고상품** (Inventory Products)

## Overall Layout
Full-width application with left sidebar navigation and main content area displaying purchase cart management interface.

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
Dark navy blue background with hierarchical menu:

### Current Section: 재고상품 (Inventory Products)
- 재고현황 목록 (Inventory Status List)
- 재고 상품 등록 (Inventory Product Registration)

### Other Major Sections:
- **발주** (Purchase Orders) - Section header
  - 발주리스트 조회(국내) (Purchase List Inquiry - Domestic)
  - 발주리스트 조회(해외) (Purchase List Inquiry - Foreign)
  - **발주리스트 생성** (Purchase List Creation) - Currently active (highlighted in purple)

- **상품 입출고** (Product Inbound/Outbound)
  - 입고리스트(한국) (Inbound List - Korea)
  - 입고리스트(해외) (Inbound List - Foreign)
  - 입고 정정표 (Inbound Correction)
  - 개별 입출고 (Individual Inbound/Outbound)

- **바코드 관리** (Barcode Management)
  - 상품 바코드 관리 (Product Barcode Management)
  - 위치 바코드 관리 (Location Barcode Management)

- **창고 재고 관리** (Warehouse Stock Management)
- **재고조정(반품, 불량,손상,손실)** (Stock Adjustment)
- **상품 위치 및 재고 조사** (Product Location and Stock Investigation)
- **실 재고 조사** (Actual Stock Investigation)
- **상품 위치 이동** (Product Location Movement)

## Main Content Area

### Top Notice Banner (Red background)
**안정재고 미만 상품 50개** (50 items below safety stock)

### Filter Section

#### Filter Row 1:
- **감색항목** (Search Item) - Dropdown: "통합 검색" (Integrated Search)
- **간배연** (Batch Connection) - Dropdown: Empty

### Filter Row 2: Status Filter Buttons (Toggle style)
- 안정재고 미건 상품만 표시 (Show only items below safety stock) - **ACTIVE** (highlighted in orange)
- 재고값는 상품만 표시 (Show only items with stock)
- 입벌없는 있는 상품만 표시 (Show only items without inbound)
- 미쁨없는 있는 상품만 표시 (Show only items without sales)

### Search Button
Large orange button labeled "검색" (Search)

## Results Section

### Action Bar
- Total count: "총 발주 수량 3개" (Total purchase quantity 3 items)
- Additional text: "감색 상품 (Search products)" | "선택 상품 일정 (Selected product schedule)"
- Action buttons:
  - 제거 (Remove)
  - 입고 (Inbound)
  - 생성자 (Creator)

## Data Table

### Column Headers:
1. Checkbox (Select all)
2. **No** (Number with indicator)
3. **바코드** (Barcode)
4. **아이디** (ID/Image)
5. **상품명 / 제고주식** (Product Name / Stock Status)
6. **발주처** (Supplier)
7. **제고** (Stock)
8. **안정제고** (Safety Stock)
9. **1개월 판매액** (1-month Sales)
10. **공급처** (Supplier Company)
11. **생불 7개 / 주문일지** (7 items ordered / Order History)
12. **기넙** (Remarks)

### Table Data (3 rows showing items below safety stock):

**Row 1:**
- No: 1
- Barcode: 11463020000
- Image: Product bottle (powder/granules)
- Product: 노동드 버럴리 색괄 700g
  - MOQ: 수불 ~ 버공 수블 MOQ (2)
  - Text: 노동드 버럴리 색괄 700g
- Supplier: JDK
- Stock: 0체
- Safety Stock: 2개체
- 1-month Sales: Empty
- Supplier: 2,200원
- Quantity field: Input "10" with button
- MOQ badge and buttons
- Actions: 수불 (Quantity) | 업저업 (Update) | 수업 절 (Complete)

**Row 2:**
- No: 2
- Barcode: 11404020003
- Image: Product bottle (vertical)
- Product: 코디라먼 매머대고 마이어믹녀 튼블 3좋 (세일드라만조)
  - MOQ: 수불 ~ 버공 수블 MOQ (2)
  - Text: 코디라먼 매머대고 마이어믹녀 튼블 3좋 (세일드라만조)
- Supplier: JDK
- Stock: 0체
- Safety Stock: 2개체
- 1-month Sales: Empty
- Supplier: 990원
- Quantity field: Input "1" with button
- MOQ badge and buttons
- Actions: Similar button layout

**Row 3:**
- No: 3
- Barcode: 11463020000
- Image: Product bottle
- Product: 버럭스 튼블 54-SA
  - Text: 버럭스 튼블 54-SA
  - Details: K-12~25 [기출공고 합격 절업]
- Supplier: 밀라드노마이아
- Stock: 0체
- Safety Stock: 2개체
- 1-month Sales: Empty
- Supplier: 2,200원
- Quantity field: Input "10" with button
- 앙채업 status indicator
- Actions: Similar button layout

## Right Panel - Information Section

### Title: **발주리스트 생성** (Purchase List Creation)

### Section Content:

#### 입고리스트를 이관된 발주리스트 확인 및 간단한 수정
Instructions for checking and modifying purchase orders transferred to inbound list.

**신청** (Application)
Details about the application process and management.

**발주주가** (Purchase Order Price)
Information about purchase order pricing.

**입코수불** (Inbound Quantity)
Details about inbound quantity management and tracking.

**Important Notes Section (Red text):**
- Warning: -
  (Empty bullet point with placeholder for important information)

## Footer
페이지네이션 (Pagination display)

## Color Scheme
- **Warning Banner**: Red background for items below safety stock
- **Primary Action**: Orange buttons
- **Active Filter**: Orange highlight
- **Sidebar**: Dark navy blue (#2C2855)
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Row Highlighting**: Light pink/salmon for items below safety stock
- **Text**: Dark gray/black
- **Badges**: Various colors for MOQ and status indicators

## Interactive Elements
- Toggle filter buttons for display options
- Search input with dropdown selector
- Checkboxes for row selection
- Quantity input fields with action buttons
- MOQ indicator badges
- Action buttons per row:
  - 수불 (Quantity adjustment)
  - 업저업 (Update)
  - 수업 절 (Complete purchase)
- Remove and create batch action buttons
- Excel export functionality

## Key Features
- Safety stock warning system (50 items below safety stock)
- Purchase cart management
- MOQ (Minimum Order Quantity) tracking
- Multi-criteria filtering
- Individual item quantity adjustment
- Batch operations support
- Status indicators for completion
- 1-month sales tracking
- Supplier information display
- Stock level monitoring

## Visual Indicators
- Red warning banner for low stock
- Product thumbnail images
- MOQ badges on items
- Status completion indicators
- Color-coded rows for items below safety stock
- Clear column organization
- Hierarchical information display

## Workflow Support
- Add items to purchase cart
- Review items below safety stock
- Adjust order quantities
- Apply MOQ requirements
- Create batch purchase orders
- Track order completion status
