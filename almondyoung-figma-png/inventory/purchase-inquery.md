# Purchase Inquiry Page

## Page Title
**재고상품** (Inventory Products)

## Overall Layout
Full-width application interface with left sidebar navigation and main content area displaying purchase inquiry data table.

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
Dark navy blue background with hierarchical structure:

### Current Section: 재고상품 (Inventory Products)
- 재고현황 목록 (Inventory Status List)
- 재고 상품 등록 (Inventory Product Registration)

### Other Major Sections:
- **발주** (Purchase Orders) - Section header
  - **발주리스트 조회(국내)** (Purchase List Inquiry - Domestic) - Currently active (highlighted in purple)
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
- **재고조정(반품, 불량,손상,손실)** (Stock Adjustment)
- **상품 위치 및 재고 조사** (Product Location and Stock Investigation)
- **실 재고 조사** (Actual Stock Investigation)
- **상품 위치 이동** (Product Location Movement)

## Filter Section

### Filter Controls (Two Rows)

#### Row 1:
- **상품구분** (Product Category) - Dropdown: "사품 구분" (Product Category)
- **공급저** (Supplier) - Dropdown: "공급저 선택" (Select Supplier)

#### Row 2:
- **감색항목** (Search Item) - Dropdown: "통합 검색" (Integrated Search)
- **표기 방식** (Display Method) - Four toggle buttons:
  - 안정재고 미건 상품만 표시 (Show only items below safety stock)
  - 입벌먼는 있는 상품만 표시 (Show only items with inbound schedule)
  - 미쁨먼는 있는 상품만 표시 (Show only items without sales)
  - 미쁨없는 있는 상품만 표시 (Show only items without purchase)

### Search Button
Large orange button labeled "검색" (Search)

## Results Section

### Action Bar
- Total count: "총 99067건" (Total 99,067 items)
- Action buttons:
  - 엑셀 다운로드 (Excel Download)
  - 선택 상품 (Selected Products)
  - 선택 상품상태변경 (Change Selected Product Status)
  - 일시휴지 (Temporary Pause)
  - Dropdown: "선택 상품 발주자기 리스트 추가" (Add selected products to purchase order list)

### Pagination Control
Right-aligned: "상품 상품 리스드" (Product List)

## Data Table

### Column Headers:
1. Checkbox (Select all)
2. **상품번 / 상품코릿** (Product Name / Product Code)
3. **No** (with indicator)
4. **아이디** (ID/Image)
5. **옵션명** (Option Name)
6. **위치** (Location)
7. **제고** (Stock)
8. **안정제고** (Safety Stock)
9. **1개월 판배액 / 공급가(매출액) / 도배가** (1-month Sales / Supply Price (Revenue) / Margin)
10. **재고금액** (Stock Amount)
11. **공급처** (Supplier)
12. **바코드** (Barcode)
13. **기능** (Function)

### Table Data (Multiple rows showing diverse inventory):

**Row 1:**
- Image: Three black bottles
- Product: 별랄 M 노와이프 미러젤 매트 탑젤 14ml 2종 (타겟2-M노와이프 탑젤)
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: 야와제야MC (with link icon)
- Price breakdown: 12,000 / 8,000 / 0체 / 0원
- Barcode: 123059498834
- Actions: 조정 (Adjust) | 입고 (Inbound) | 출고 (Outbound) | 안쇄 상품 (Safety Stock Product) | PDF | 발주리스드에 추가 (Add to Purchase List)

**Row 2:**
- Image: Bottle
- Product: 벌랄 탑젤
- Category: 사업
- Option: [주정]
- Additional text: 업거업업 불후업도체 [수정]
- Location: J-07-36
- Stock: 0체
- Safety Stock: 2체
- 1-month: 2체
- Supplier: 단댔물목 (with link icon)
- Price: 12,000 / 8,000 / 0 / 4,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 3:**
- Image: Bottle
- Product: 30ml
- Category: 사업
- Additional info: 인고예정일: [2025-07-29] / 인고예정주기: 1
- Location: J-07-36
- Stock: 0체
- Safety Stock: 1체
- 1-month: 1체
- Supplier: 버눅스페셀달 (with link icon)
- Price: 12,000 / 8,000 / 0 / 4,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 4:**
- Image: Bottle
- Product: 10ml
- Category: 사업
- Details: 번경이마매 자고드 선정에 업네웹닷컴
- Additional info: 자업 선택 / 사업 탑는 - 노동드 소돌 에틀엽 83% / - 노동드 보인저 없피디 / - 노동드 아댐클 반반드
- Location: J-07-36
- Stock: 0체
- Safety Stock: 1체
- 1-month: 1체
- Supplier: 충욱 (with link icon)
- Price: 0 / 0 / 0 / 4,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 5:**
- Image: Orange bottle
- Product: 파백릭 탑젤
- Category: 사업
- Details: 마챨초-2체
- Location: J-07-36
- Stock: 0체
- Safety Stock: 2체
- 1-month: 2체
- Supplier: 업아낌 (with link icon)
- Price: 12,000 / 8,000 / 0 / 4,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 6:**
- Image: Box product
- Product: 수항
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: 업아낌 (with link icon)
- Price: 62,400 / 52,000 / 0 / 20,800원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 7:**
- Image: Product package
- Product: 비먼디 흠드 신업기술 사댐
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: (Link icon)
- Price: 89,900 / 86,000 / 0 / 60,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 8:**
- Image: Box product
- Product: 아댐
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: JPA (with link icon)
- Price: 89,900 / 86,000 / 0 / 60,000원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 9:**
- Image: Product item
- Product: 인기산업 열어가는 부댐댐출려짐 [인]
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: [in]
- Price: 12,000 / 8,000 / 0 / 4,000원
- Barcode: 123059498834
- Actions: Similar button layout

Additional rows continue...

## Right Panel - Information Section

### Title: **재고 현황 목록** (Inventory Status List)

### Section: 재고상품조회 (재고현황 파악)

**Detailed documentation section explaining:**

#### Key Information Areas:
- **초록**: Basic query information
- **판도**: Sales channel information
- **발급전**: Issuance management
- **악중수별**: Quantity tracking
- **발주button**: Purchase order button functionality
- **사이button**: Details button usage
- **움저이먼 번도추기**: Movement tracking capabilities

**Important Note (Red text):**
- 업수 노디스:
- 업거먼 제륵이 대먼 알정 대업대리스드틀 업어먼 업이긴 합업 디감 업먼고 업먼히 업먼다.

## Footer
페이지네이션 (Pagination controls for navigating 99,067 records)

## Color Scheme
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue (#2C2855)
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Text**: Dark gray/black
- **Links**: Blue with external link icon
- **Active Menu**: Purple highlight in sidebar

## Interactive Elements
- Dropdown filters for category and supplier
- Toggle buttons for display filters
- Search input field
- Checkboxes for row selection
- Action buttons on each row:
  - 조정 (Adjust stock)
  - 입고 (Inbound)
  - 출고 (Outbound)
  - 안쇄 상품 (Safety stock product)
  - PDF download
  - 발주리스드에 추가 (Add to purchase list)
- Batch operation buttons
- Excel export functionality
- External supplier links

## Key Features
- Comprehensive purchase inquiry system
- Multi-criteria filtering
- Stock level monitoring
- Safety stock tracking
- 1-month sales tracking
- Price and margin analysis
- Direct supplier information links
- Individual item actions
- Batch operations support
- Expected inbound date tracking
- Purchase order list integration
- Export capabilities

## Visual Indicators
- Product thumbnail images
- External link icons
- Expandable detail sections
- Status indicators
- Color-coded information
- Clear column organization
- Hierarchical data display
