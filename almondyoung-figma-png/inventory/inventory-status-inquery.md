# Inventory Status Inquiry Page

## Page Title
**재고 현황 목록** (Inventory Status List)

## Overall Layout
Full-width application interface with left sidebar navigation, main content area with comprehensive data table, and right-side information panel.

## Top Navigation Bar
Horizontal menu:
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

### Current Section: 재고상품 (Inventory Products) - Active
- **재고현황 목록** (Inventory Status List) - Currently selected (purple highlight)
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
  - 안정매고 마건 상품만 표시 (Show only below safety stock)
  - 재고값는 상품만 표시 (Show only with stock value)
  - 입벌없는 있는 상품만 표시 (Show only without inbound)
  - 미쁨없는 있는 상품만 표시 (Show only without sales)

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

## Data Table

### Column Headers (Left to Right):
1. Checkbox (Select all)
2. **상품번 / 상품코릿** (Product Name / Product Code)
3. **No** (with indicator)
4. **아이디** (ID/Image)
5. **옵션명** (Option Name)
6. **위치** (Location)
7. **제고** (Stock)
8. **안정제고** (Safety Stock)
9. **1개월 판매액 / 공급가(매출액) / 도배가** (1-month Sales / Supply Price / Margin)
10. **재고금액** (Stock Value)
11. **공급처** (Supplier)
12. **바코드** (Barcode)
13. **기능** (Function)

### Sample Table Data (Showing diverse inventory items):

**Row 1:**
- Image: Three black bottles
- Product: 별랄 M 노와이프 미러젤 매트 탑젤 14ml 2종 (타겟2-M노와이프 탑젤)
- Category: 사업
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: 야와제야MC (with link)
- Price: 12,000 / 8,000 / 0체 / 0원
- Barcode: 123059498834
- Actions: 조정 | 입고 | 출고 | 안쇄 상품 | PDF | 발주리스드에 추가

**Row 2:**
- Image: Bottle product
- Product: 벌랄 탑젤
- Category: 사업
- Option: [주정]
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 0체
- Supplier: [주정]
- Price: 12,000 / 8,000 / 0체 / 0원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 3:**
- Image: Bottle
- Product: 30ml
- Location: J-07-36
- Stock: 0체
- Safety Stock: 0체
- 1-month: 2체
- Supplier: 워라티먼MC (with link)
- Price: 12,000 / 8,000 / 0체 / 0원
- Barcode: 123059498834
- Actions: Similar button layout

**Row 4:**
- Image: Bottle
- Product: 10ml
- Details: 번경이마매 자고드 선정에 업네웹닷컴
- Location: J-07-36
- Stock: 0체
- Safety Stock: 1체
- 1-month: 1체
- Supplier: 충욱 (with link)
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
- Supplier: 업아낌 (with link)
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
- Supplier: 업아낌 (with link)
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
- Supplier: 89,900 / 86,000 / 0 / 60,000원
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
- Supplier: JPA (with link)
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

Additional rows continue with similar patterns...

## Right Panel - Information Section

### Title: **재고 현황 목록** (Inventory Status List)

### Section: 재고상품 조회 (재고현황 파악)

**재고상품조회 (재고현황 파악)**
Comprehensive explanation section with multiple subsections:

#### Key Information Points:
- **초록**: Details about basic inventory overview
- **판도**: Information about sales channels
- **발급전**: Purchase management information
- **악중수별**: Quantity tracking details
- **발주button**: Purchase order button functionality
- **사이button**: Details button information
- **움저이먼 번도추기**: Movement tracking capabilities

**Important Note (Red text):**
- 업거먼 제륙이 대먼 알정 대업대리스드틀 업어먼 업이긴 합업 디감 업먼고 업먼히 업먼다.

## Footer
페이지네이션 (Pagination to navigate through 99,067 records)

## Color Scheme
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue (#2C2855 approximately)
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Row Alternating**: Subtle gray/white
- **Text**: Dark gray/black
- **Links**: Blue with external link icon
- **Active Menu**: Purple highlight

## Interactive Elements
- Dropdown filters for category and supplier
- Toggle buttons for display filters
- Checkboxes for row selection
- Action buttons on each row (조정, 입고, 출고)
- PDF download option per row
- Add to purchase list functionality
- Excel export for entire dataset
- External links to supplier information
- Expandable sections in some rows with additional product details

## Key Features
- Comprehensive inventory overview
- Multi-criteria filtering
- Batch operations support
- Individual item actions
- Safety stock monitoring
- Sales tracking (1-month)
- Price and margin information
- Direct supplier links
- Export capabilities
- Purchase list management integration
