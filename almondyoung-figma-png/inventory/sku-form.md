# SKU Form (Product Registration/Creation)

## Page Title
**재고 상품 등록** (Inventory Product Registration)

## Overall Layout
Full-width application with left sidebar navigation and main content area containing a comprehensive product registration form.

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
- **재고 상품 등록** (Inventory Product Registration) - Currently active (highlighted in purple)

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

## Action Buttons (Top Right)
- **취소** (Cancel) - White button
- **저장** (Save) - Orange button

## Main Form Content

### Section 1: 기본정보 (Basic Information)

#### Fields:
1. **상품명** (Product Name)
   - Empty text field

2. **상품 구분** (Product Category)
   - Dropdown: "상품 구분" (Product Category)

3. **공급가(발주주가)** (Supply Price/Purchase Price)
   - Dropdown: "공급가 업체" (Supply Price Company)
   - Buttons: "검색" (Search) | "신규 등록" (New Registration)

4. **물류차** (Logistics)
   - Dropdown: Empty

5. **분도** (Category)
   - Text field: Empty

6. **재고수량** (Stock Quantity)
   - Dropdown: Empty

### Section 2: 바코드 (Barcode)

#### Fields:
1. **바코드번호(별수)** (Barcode Number - Variable)
   - Text field: Empty (with placeholder: "(바텐카 시 자동일력)")

2. **바코드번호2** (Barcode Number 2)
   - Empty text field

3. **바코드번호3** (Barcode Number 3)
   - Empty text field

### Section 3: 물류정보 (Logistics Information)

#### Fields:
1. **상품 무게** (Product Weight)
   - Numeric input field: Empty
   - Unit: "g"
   - Checkbox: "펀한먼치" (Convenience Fee) with text "다젤 제품의 편의점 담당"

2. **상품 규격** (Product Dimensions)
   - Four input fields with format: "___ * ___ * ___ cm"
   - Checkbox: "회대 편도계수" (Maximum Frequency) with value "20"

3. **상품 소재** (Product Material)
   - Empty text field
   - Checkbox: "표장 주의사항" (Labeling Precautions)

### Section 4: 재고정보 (Stock Information)

#### Fields:
1. **상품 위치** (Product Location)
   - Text field: Empty (placeholder: "(번고 시 자동위)")
   - Checkbox: "보폴재고 위치" (Safety Stock Location) - selected with "관뮤" badge

2. **현재 제고** (Current Stock)
   - Numeric field: "0"
   - Checkbox: "수입식 설곤제자물" (Import food settlement)

3. **안정 제고** (Safety Stock)
   - Numeric field: Empty

4. **분가** (Price)
   - Numeric field: Empty
   - Red circle indicator: "6"

5. **유종기간** (Valid Period)
   - Numeric field: Empty

### Section 5: 단제(승낙)정보 (Channel Approval Information)
Checkbox: "올선 정보 (사내 시 상품조회 통한 / 올선 상품을 연등먼 선택 및제 최형)"

### Section 6: 이미지 정보 (Image Information)

#### Field:
**대표이미지** (Representative Image)
- Drag and drop area
- Text: "파견관련 건자사이즈 500x500px ~ 1000x1000px"
- Large upload box with placeholder image icon

### Section 7: 상품설명 (Product Description)

#### Fields:
1. **상품설명** (Product Description)
   - Large text area (empty)

2. **MOQ** (Minimum Order Quantity)
   - Empty text field

3. **패2오** (Field 2)
   - Empty text field

4. **패2오3** (Field 3)
   - Empty text field

### Section 8: 상품 환경자 (Product Environment)

#### Fields:
1. **상품디자이너** (Product Designer)
   - Dropdown: "아이아태" (Selected)

2. **상품홍보처** (Product Promoter)
   - Dropdown: "아이아태" (Selected)

3. Note text: "픔솔를 시업이 아이드앤 시품 해성"

## Bottom Action Buttons
- **취소** (Cancel) - White button (left)
- **저장** (Save) - Orange button (right)

## Color Scheme
- **Primary Action**: Orange (Save button)
- **Secondary Action**: White/gray (Cancel button)
- **Sidebar**: Dark navy blue (#2C2855)
- **Background**: White
- **Form Sections**: Light backgrounds for organization
- **Text**: Dark gray/black
- **Input Fields**: White with light gray borders
- **Checkboxes**: Blue when selected
- **Badges**: Various colors for status indicators

## Visual Organization
- Clear section headers with dividing lines
- Hierarchical form structure
- Grouped related fields together
- Consistent spacing and alignment
- Form fields with appropriate input types
- Inline buttons for search and registration
- Drag and drop upload area with visual cues
- Checkbox options for additional settings

## Interactive Elements
- Text input fields (various widths)
- Numeric input fields with units
- Dropdown selectors
- Checkboxes with labels
- Search buttons
- Registration buttons
- Drag and drop image upload area
- Large text area for descriptions
- Action buttons (Save/Cancel)

## Key Features
- Comprehensive product registration
- Multiple barcode support (up to 3)
- Product categorization
- Supplier/price management
- Logistics information capture
- Stock location management
- Safety stock configuration
- Product dimensions and weight
- Image upload with size specifications
- MOQ settings
- Product description field
- Designer and promoter assignment
- Auto-generated fields (location, barcode)
- Validation indicators
- Channel integration preparation

## Form Validation
- Required field indicators (red circles with numbers)
- Placeholder text for guidance
- Auto-fill options for certain fields
- Checkbox validation for special handling
- Unit labels for measurements

## Workflow
1. Enter basic product information
2. Configure barcodes (auto or manual)
3. Set logistics details (weight, dimensions)
4. Define stock information and location
5. Upload representative image
6. Add product description and MOQ
7. Assign designer and promoter
8. Save or cancel the registration
