# Location Barcode Management Page

## Page Title
**재고상품** (Inventory Products)

## Overall Layout
Full-width application with left sidebar navigation and main content area displaying location barcode management interface.

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

### Other Sections:
- **발주** (Purchase Orders)
  - 발주리스트 조회(국내) (Purchase List Inquiry - Domestic)
  - 발주리스트 조회(해외) (Purchase List Inquiry - Foreign)
  - 발주리스트 생성 (Purchase List Creation)

- **상품 입출고** (Product Inbound/Outbound)
  - 입고리스트(한국) (Inbound List - Korea)
  - 입고리스트(해외) (Inbound List - Foreign)
  - 입고 정정표 (Inbound Correction)
  - 개별 입출고 (Individual Inbound/Outbound)

- **바코드 관리** (Barcode Management) - Section header
  - 상품 바코드 관리 (Product Barcode Management)
  - **위치 바코드 관리** (Location Barcode Management) - Currently active (highlighted in purple)

- **창고 재고 관리** (Warehouse Stock Management)
- **재고조정(반품, 불량,손상,손실)** (Stock Adjustment)
- **상품 위치 및 재고 조사** (Product Location and Stock Investigation)
- **실 재고 조사** (Actual Stock Investigation)
- **상품 위치 이동** (Product Location Movement)

## Main Content Area

### Section: Barcode Usage Instructions (Light Blue Background)

#### Title: 바코드 사용방법 (Barcode Usage Instructions)

#### Left Column: 바코드 사용방법 (Standard Barcode Usage)
Numbered list with 5 items explaining barcode usage:

1. 변경하고자 하는 위치에 위치바코드를 입시완충해냅니다.
   - 관리를 위해랜 시 설정 대칭으로 대칭정을 관리로는 설정저 하여야합니다.

2. 작전 설정을 지한 일회용 시간 으로 기술해 후저서 관지 시간 입으로 기술해 완충제 있습니다.
   - 수전 채고 재치 업체 들이판치가 배치관치는 제작사 관측제 시간 입습니다.

3. 출수위치바코드는 - 업채바코드 업제 -multi - 바코드를 출과에어 스켓 출수시입습니다.

4. 출수위치바코드는 - 업채바코드 업제 sumnutti - 바코드를 출과에어 스켓 출수시입습니다.

5. 바코드위치 업데이드는 - 제전이는 제고 후 저생사, 바코드의 위치자 기능에 도래에이드는 스완업 업채바코드는 변경합니다.
   - Firefox, Chrome 브라우저는 지원합니다.

Additional note:
업형 바코드는 감색 조전제 제대로수는 업도 해결에어에 시를 가능합니다.

#### Right Column: 변형 바코드 사용방법 (Modified Barcode Usage)

Numbered list with 3 items:

1. 변경해 위치바코드를 입시업 합니다.
2. 변경해 하신여 생청바코드를 입시업 합니다.
   - [주의] 업형 바코드
   - 2-1 생청업 기능위치업 완도 경우 - 위치자 동래니다.
   - 2-2 생청업 기능위치업 변청해 위치자 관도경우 - 위치자 동지니다.
3. 변청해서 하는 위치자 같은 다칩 상품 바코드를 전설하고, 다른 경우 다칩 위치 바코드는 스래합니다.

**Important Warning Icons:**
- 변경(change) - 상품바코드의 위치를 변경 합니다.
- 복수등(plurality) - 상품바코드의 위치를 중대업 구호취한 추가 합니다.

#### Warning Section (Red Background)
업수설온바(ID) 브라우저에 막해, 변경하기 탈업든 하여 입항 경우 업츠오로 변경하실맨따 어체 소츠하랜 반업코입니다.

## Form Section

### Search/Input Area

#### Left Side: 업체 개자 (Entity Search)
- Dropdown: Empty field
- Button: Orange "업진" (Search)

#### Right Side: 명형 바코드 입력 (Barcode Input)
- Dropdown: Empty field
- Button: Orange "업진" (Search)

### Result Table Section

#### Filter/Action Bar
- Checkbox: "관련맨업 엄셜수철"
- Text: "제수위치시업 / 생청바코드 업치 얼지대이드드 - 위치 업데이드"
- Dropdown: "한그진맨" (Selection dropdown)
- Buttons: "위치 바코드맨도" | "관련업 바코드프드" | "업체개 위치맨도 하입"

#### Table Area
Three column headers:
1. **바코드번호** (Barcode Number)
2. **상품명 / 발주업체** (Product Name / Purchase Entity)
3. **공급자** (Supplier)
4. **변형 업 위치** (Modified Location)
5. **변형 후 위치** (Location After Modification)

**Empty State Message:**
검색 후 이용해 주세요. (Please use after searching)

## Right Panel - Instructions (Partially Visible)

Shows a partial view of the instruction panel with text explaining the location barcode management system functionality.

## Footer
페이지네이션 표시 (Pagination area)

## Color Scheme
- **Primary Action**: Orange buttons
- **Sidebar**: Dark navy blue (#2C2855)
- **Instructions Background**: Light blue
- **Warning Section**: Red/pink background
- **Background**: White/light gray
- **Table Headers**: Light gray
- **Text**: Dark gray/black
- **Active Menu Item**: Purple highlight

## Visual Elements
- Two-column instructional layout
- Numbered lists for procedures
- Warning icons and indicators
- Form inputs with action buttons
- Empty state placeholder in table
- Hierarchical information structure
- Clear separation between instruction and functional areas

## Key Features
- Dual barcode management (standard and modified)
- Search functionality for entities and barcodes
- Batch operations support
- Location update capabilities
- Firefox and Chrome browser support
- Warning system for important operations
- Comprehensive usage instructions
- Multi-step workflow guidance

## Interactive Components
- Dropdown selectors
- Search buttons
- Checkbox for auto-settings
- Action buttons for:
  - Location barcode management
  - Related barcode processing
  - Entity location management
- Table for displaying results
- Filter controls
