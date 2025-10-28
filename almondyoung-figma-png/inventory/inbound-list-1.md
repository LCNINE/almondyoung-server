# Inbound List Page - View 1

## Page Title
**입고리스트** (Inbound List)

## Overall Layout
Full-width application interface with left sidebar navigation, main content area with filters and data table, and a right-side information panel.

## Top Navigation Bar
Horizontal menu with items:
- 회사/조직 (Company/Organization)
- 거래처관리 (Client Management)
- 주문/출고관리 (Order/Outbound Management)
- 재고상품 관리 (Inventory Product Management)
- CS
- 번째 / 통계 (Statistics)
- 자사몰 관리 (Own Mall Management)
- 멤버십 관리 (Membership Management)

## Left Sidebar Navigation
Dark navy blue background with hierarchical menu structure:

### Current Section: 재고상품 (Inventory Products)
- 재고현황 목록 (Inventory Status List)
- 재고 상품 등록 (Inventory Product Registration)

### Other Sections:
- **발주** (Purchase Orders)
  - 발주리스트 조회(국내) (Purchase List Inquiry - Domestic)
  - 발주리스트 조회(해외) (Purchase List Inquiry - Foreign)
  - 발주리스트 생성 (Purchase List Creation)

- **상품 입출고** (Product Inbound/Outbound) - Currently selected
  - **입고리스트(한국)** (Inbound List - Korea) - Active page
  - 입고리스트(해외) (Inbound List - Foreign)
  - 입고 정정표 (Inbound Correction)
  - 개별 입출고 (Individual Inbound/Outbound)

- **바코드 관리** (Barcode Management)
- **창고 재고 관리** (Warehouse Stock Management)
- **재고조정(반품, 불량,손상,손실)** (Stock Adjustment)
- **상품 위치 및 재고 조사** (Product Location and Stock Investigation)
- **실 재고 조사** (Actual Stock Investigation)
- **상품 위치 이동** (Product Location Movement)

## Filter Section

### Filter Controls (Horizontal Layout)

#### Row 1:
- **입가** (Price) - Dropdown: "발주일" (Order Date)
- **오류** (Error) - Dropdown showing "오류" (Error)
- **입불** - Checkboxes: "오류일" (Error Date) | "일불" (Daily)
- **입불** - Radio buttons: "전불" (All) | "오불" | "3불불" (3 Days)
- **일불가라** (Daily Period) - Date range picker:
  - Start date: 2025-08-20
  - End date: 2025-08-20
- **알고 입불업 대고 배최** (Stock Import Setting) - Checkbox: "다큼 수불 입체" (Apply Daily Import)

#### Row 2:
- **간래항목** (Item Category) - Dropdown: "통합 검색" (Integrated Search)
- **선택 시품** (Selected Product) - Dropdown: "발주 입체" (Purchase Entity)
- **발주 입업** (Purchase Business) - Dropdowns: "발주 입체업" | "립고 입업" (Multiple selection fields)

### Search Button
Large orange button labeled "검색" (Search)

## Results Section

### Action Bar
- Total count: "총 5개" (Total 5 items)
- Tabs:
  - 엑셀 다운로드 (Excel Download)
  - 선택된 바코드 인쇄자기 추가 (Add Selected Barcode to Print Queue)
  - 엑셀로 일괄입력 일정도: (Excel Batch Input Schedule:)
  - 인쇄자기 목록 10 (Print Queue List 10)
  - 바코드재발 환경설정 (Barcode Reissue Settings)

### Data Table

#### Column Headers:
1. Checkbox (Select all)
2. **No.** (Number)
3. **바코드 번호** (Barcode Number)
4. **아이디** (ID/Image)
5. **상품명 / 바코드1,2** (Product Name / Barcode 1,2)
6. **발주처** (Supplier)
7. **발주 일체 / 입고예정일 / 알고일실시** (Order Date / Expected Inbound Date / Actual Inbound Date)
8. **입채일** (Inbound Date)
9. **분가** (Price)
10. **알고제수** (Stock Quantity)
11. **립고 수불제수사 / 제수사** (Inbound Quantity / Quantity)
12. **발주주가/리 / 립고 입업가리** (Purchase Price / Inbound Price)
13. **간채업** (Channel Business)
14. **기넙** (Remarks)

#### Table Data (5 rows shown):

**Row 1:**
- No: 1
- Barcode: 11463020000
- Image: Product bottle image
- Product: 노동드 버럴리 색괄 700g
  - Manufacturer: 2종
  - Codes: L-13~15 [기출공고 합격 절업]
  - Attribute: 기출/기업 번최
- Supplier: JDK
- Dates: 2025-07-28 | 2025-07-30 | 0 체하 | 수정
- Price: 2,200원
- Quantity fields with inputs and buttons
- Actions: Orange "수업 합격" button, "수업고분도" button, "립고 절업" button

**Row 2:**
- No: 2
- Barcode: 11404020003
- Image: Product bottle image (vertical container)
- Product: 코디라먼 매머대고 마이어믹녀 튼블 3좋 (세일드라만조)
  - Manufacturer: 2종
  - Codes: L-00~11 [기출공고 합격 절업]
  - Attribute: 기출/기업 번최
- Supplier: JDK
- Dates: 2025-07-28 | 2025-07-30 | 14체하 | 수정
- Price: 990원
- Quantity: 1
- Actions: Similar button layout

**Row 3:**
- No: 3
- Barcode: 11463020000
- Image: Product bottle image
- Product: 버럭스 튼블 54-SA
  - Manufacturer: 2종
  - K-12~25 [기출공고 합격 절업]
  - Attribute: 립고업제 2-3종 수월 수-일
- Supplier: 밀라드노마이아
- Dates: 2025-07-28 | 2025-07-30 | 20 체하 | 수정
- Price: 2,200원
- Quantity: 10
- Actions: Button with warning indicator (red icon)

**Row 4:**
- No: 4
- Barcode: 11463020000
- Image: Product bottle image (powder/granules)
- Product: 노동드 버럴리 색괄 700g
  - Manufacturer: 2종
  - L-13~15 [기출공고 합격 절업]
  - Attribute: 기출/기업: 2025-08-18 ~ 2025-15-25
- Supplier: JDK
- Dates: 2025-07-28 | 2025-07-30 | 0 체하 | 수정
- Price: 2,200원
- Quantity: 10
- Actions: Similar button layout

**Row 5:**
- No: 5
- Barcode: 11463020000
- Image: Product bottle image
- Product: 노동드 버럴리 색괄 700g
  - Manufacturer: 2종
  - L-13~15 [기출공고 합격 절업]
  - Attribute: 기출/기업: 2025-08-18 ~ 2025-15-25
- Supplier: JDK
- Dates: 2025-07-28 | 2025-07-30 | 0 체하 | 수정
- Price: 2,200원
- Quantity: 10
- Actions: Similar button layout

## Right Panel - Information Section

### Title: **입고리스트** (Inbound List)

### Section 1: 발주리먼 제륵의 입고리스트
Instructions about purchase order inbound list management

### Section 2: 인쇄자기 하업
Details about print queue functionality

### Section 3: 인쇄자기 목록
Information about print queue list viewing

### Section 4: 립고수불
Instructions for inbound quantity management

### Section 5: 내역 / 수불
Details about history and quantity tracking

### Section 6: 립고 절업랑
Information about inbound completion status

### Section 7: 일괄 처리
Batch processing instructions

### Section 8: 유정기간
Expiration date management information

**Important Notes (Red text):**
- 디킴지 제륵이 입기 합정 기출고리스드를 밀어먼 대리긴 한채 디감 재불고 밀수먼다.
- 립고 수무기 외입제노마 업고수무거 기래업 부먼어 할업이 합니다.

## Footer
페이지네이션 (Pagination)

## Color Scheme
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Warning Indicators**: Red icons
- **Text**: Dark gray/black
- **Active Items**: Purple highlight in sidebar

## Interactive Elements
- Multiple dropdown filters
- Date range pickers
- Checkboxes for selection
- Radio buttons for options
- Input fields for quantities
- Action buttons on each row
- Expandable information panels
