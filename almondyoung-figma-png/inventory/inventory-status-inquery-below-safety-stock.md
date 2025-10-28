# Inventory Status Inquiry - Below Safety Stock

## Page Title
**재고 현황 목록** (Inventory Status List)

## Overall Layout
Full-width application with left sidebar navigation and main content area displaying filtered inventory data.

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
- **재고현황 목록** (Inventory Status List) - Currently active (highlighted in purple)
- 재고 상품 등록 (Inventory Product Registration)

### Additional Sections:
- 발주 (Purchase Orders)
- 발주리스트 조회(국내) (Purchase List Inquiry - Domestic)
- 발주리스트 조회(해외) (Purchase List Inquiry - Foreign)
- 발주리스트 생성 (Purchase List Creation)
- 상품 입출고 (Product Inbound/Outbound)
- 입고리스트(한국) (Inbound List - Korea)
- 입고리스트(해외) (Inbound List - Foreign)
- 입고 정정표 (Inbound Correction)
- 개별 입출고 (Individual Inbound/Outbound)
- 바코드 관리 (Barcode Management)
- 상품 바코드 관리 (Product Barcode Management)
- 위치 바코드 관리 (Location Barcode Management)
- 창고 재고 관리 (Warehouse Stock Management)
- 재고조정(반품, 불량,손상,손실) (Stock Adjustment)
- 상품 위치 및 재고 조사 (Product Location and Stock Investigation)
- 실 재고 조사 (Actual Stock Investigation)
- 상품 위치 이동 (Product Location Movement)

## Filter Section

### Filter Row 1:
- **상품구분** (Product Category) - Dropdown: "상품 구분" (Product Category)
- **공급처** (Supplier) - Dropdown: "공급처 선택" (Select Supplier)

### Filter Row 2:
- **감색항목** (Search Item) - Dropdown: "통합 검색" (Integrated Search)

### Filter Row 3: Display Condition Buttons
Four filter buttons (toggle style):
- 안정매고 마건 상품만 표시 (Show only items below safety stock) - **CURRENTLY ACTIVE** (highlighted in orange)
- 재고값는 상품만 표시 (Show only items with stock value)
- 입벌없는 있는 상품만 표시 (Show only items without inbound)
- 미쁨없는 있는 상품만 표시 (Show only items without sales)

### Search Button
Large orange button labeled "검색" (Search)

## Results Section

### Result Summary and Actions
- Total count: "총 99967건" (Total 99,967 items)
- Tabs/Buttons:
  - 엑셀 다운로드 (Excel Download)
  - 선택 상품 (Selected Products)
  - 선택 상품상태변경 (Change Selected Product Status)
  - 일시휴지 (Temporary Pause)
  - Sort dropdown: "선택 상품 발주자기 리스트 추가" (Add selected products to purchase order list)

## Data Table

### Column Headers:
1. Checkbox (Select all)
2. **상품번 / 상품코릿** (Product Name / Product Code)
3. **No** (Number - with indicator)
4. **아이디** (ID/Image)
5. **옵션명** (Option Name)
6. **위치** (Location)
7. **제고** (Stock)
8. **안정제고** (Safety Stock)
9. **1개월 판매액 / 공급가(매출액) / 도배가** (1-month Sales / Supply Price (Revenue) / Margin)
10. **재고금액** (Stock Amount)
11. **공급처** (Supplier)
12. **바코드** (Barcode)
13. **기능** (Function)

### Table Data (Sample Rows - showing items below safety stock):

All rows show products with safety stock issues, indicated by pink/salmon row highlighting.

**Row 1:**
- Product image: Three black bottles
- Product: VIEW GEL 님질 오댐 탄반 대범 탑 젤 10ml (옵션2종(호핑지-슐핑대밤))
- Category: 사업
- Option: 버눅트 탑젤 (Priority)
- Location: J-07-36
- Stock: 0체
- Safety Stock: 2체
- 1-month info: 2체
- Sales: 앨아낌 (Link icon)
- Price details: 12,000 / 8,000 / 0 / 4,000
- Stock Amount: 0원
- Barcode: 123059498834
- Actions: 조정 (Adjust) | 입고 (Inbound) | 출고 (Outbound) | 안쇄 상품 (Safety Product) | PDF button | 발주리스드에 추가 (Add to Purchase List)

**Row 2:**
- Product image: Circular product
- Product: 필스필 버눅스페셀달 단담컵 드게 드 빅스제품 GST-237
- Category: 사업
- Option: 단댔물목 (Priority)
- Additional info: 인고예정일: [2025-07-29] / 인고예정주기: 1
- Location: J-07-36
- Stock: 0체
- Safety Stock: 4체
- 1-month info: 4체
- Sales: 버눅스페셀달 (Link icon)
- Price details: 12,000 / 8,000 / 0 / 4,000
- Stock Amount: 0원
- Barcode: 123059498834
- Actions: Similar button layout | 발주리스드에 추가 (Add to Purchase List)

**Row 3:**
- Product image: Bottle
- Product: 필스필 버눅스페셀달 단담컵 드게 드 빅스제품 GST-237 30ml
- Category: 사업
- Details: 버스시(아댐,물거)
- Additional info: 사업 선택 / 사업 탑는 - 노동드 소돌 에틀엽 83% / - 노동드 보인저 없피디 / - 노동드 아댐클 반반드
- Location: J-07-36
- Stock: 0체
- Safety Stock: 1체
- 1-month info: 1체
- Sales: 충욱 (Link icon)
- Price details: 0 / 0 / 0 / 4,000
- Stock Amount: 0원
- Barcode: 123059498834
- Actions: Similar button layout | 발주리스드에 추가 (Add to Purchase List)

Additional rows continue with similar structure, all showing inventory below safety stock levels.

## Right Panel - Information Section

### Title: **재고 현황 목록** (Inventory Status List)

### Section: 재고상품 조회 (재고현황 파악)
Detailed instructions and explanations about:

**자동 제고발생**
Information about automatic inventory generation

**판도**
Details about category management

**발급전**
Information about issuance management

**악중수별**
Details about quantity management

**발주button**
Information about purchase order button functionality

**사이button**
Details about details button functionality

**움저이먼 번도추기**
Information about movement tracking

**Important Notes (Red text):**
- 업거먼 제륙이 대먼 알정 대업대리스드틀 업어먼 업이긴 합업 디감 업먼고 업먼히 업먼다.

## Footer
페이지네이션 (Pagination for navigating through 99,967 items)

## Color Scheme
- **Warning/Below Safety Stock**: Light pink/salmon row backgrounds
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Active Filters**: Orange highlight
- **Text**: Dark gray/black
- **Links**: Blue with underline icon

## Visual Indicators
- Pink/salmon row highlighting for items below safety stock
- External link icons next to supplier names
- Expandable sections in some rows
- Action buttons on each row
- Status indicators for stock levels
- Safety stock comparison highlighting

## Key Features
- Filter by safety stock status
- Batch operations on selected items
- Export to Excel functionality
- Direct links to supplier information
- Quick access to adjust, inbound, outbound operations
- Add to purchase list functionality
- PDF generation for selected items
