# SKU Edit Form

## Modal Title (Dark purple header)
**웁선 정보 수정** (Option Information Modification)

## Modal Layout
Large modal dialog with multiple sections organized vertically, with action buttons at top right.

## Action Buttons (Top Right)
- **취소** (Cancel) - White button
- **저장** (Save) - Orange button

## Form Sections

### Section 1: 기본정보 (Basic Information)

#### Fields:
1. **상품명** (Product Name)
   - Value: "다젤 M 노와이프 미러젤 매트 탑젤 14ml 2종"
   - Read-only display field

2. **사업 상품명** (Business Product Name)
   - Empty text field

3. **수입식간관도** (Import Food Relation)
   - Empty text field

4. **물류차** (Logistics)
   - Dropdown: "부천공고" (Bucheon)
   - Buttons: "검색" (Search) | "신규 등록" (New Registration)

5. **분도** (Category)
   - Text field: Empty

6. **재고수량** (Stock Quantity)
   - Dropdown: "볼리나드" (Selected option)

### Section 2: 바코드 (Barcode)

#### Fields:
1. **바코드번호(별수)** (Barcode Number - Variable)
   - Text field: Empty (placeholder text: "바텐카 시 자동일력")

2. **바코드번호2** (Barcode Number 2)
   - Empty text field

3. **바코드번호3** (Barcode Number 3)
   - Empty text field

### Section 3: 재고정보 (Stock Information)

#### Fields:
1. **상품 위치** (Product Location)
   - Text field: "J-10-10"

2. **보폴재고 위치** (Safety Stock Location)
   - Text field: "T-13-10"

3. **현재 제고** (Current Stock)
   - Display field: "4"
   - Red circle indicator: "6"

4. **안정 제고** (Safety Stock)
   - Empty numeric field

5. **분가** (Price)
   - Display field: "1,300" with "한" (unit)

6. **유종기간** (Valid Period)
   - Two numeric fields: "0" and "하고" (days)

### Section 4: 물류정보 (Logistics Information)

#### Fields:
1. **상품 무게** (Product Weight)
   - Numeric field: "20"
   - Unit: "g"
   - Checkbox: "수입식 설곤제자물" (Import food settlement material)

2. **상품 규격** (Product Dimensions)
   - Four numeric fields: "4" * "15" * "3" cm
   - Checkbox: "수입식 설곤제자물"

3. **상품 소재** (Product Material)
   - Empty text field
   - Checkbox: "수입식 설곤제자물"

4. **펀한먼치** (Convenience Fee)
   - Text: "다젤 제품의 편의점 담당"
   - Checkbox: "수입식 설곤제자물"

5. **회대 편도계수** (Maximum Frequency)
   - Numeric field: "20"

6. **표장 주의사항** (Labeling Precautions)
   - Empty text field

### Section 5: 이미지 정보 (Image Information)

#### Field:
**은사이디지** (Company Image)
- Drag and drop area with text: "파견관련 건자사이즈 500x500px ~ 1000x1000px"
- Upload area with image icon
- Two product images displayed (black bottles)

### Section 6: 상품설명 (Product Description)

#### Fields:
1. **상품설명** (Product Description)
   - Empty large text area

2. **MOQ** (Minimum Order Quantity)
   - Text field with value: "브랜드: 제품 50개"
   - Checkbox: "수입식 설곤제자물" (checked)

3. **패2오** (Field 2)
   - Empty text field

4. **패2오3** (Field 3)
   - Empty text field

### Section 7: 단제 정보(연동정보) (Channel Information - Integration Info)

#### Sales Channel Section:
**훈폴상품 코드** (Product Code)
- Display: "5574"
- Product name: "다젤 M 노와이프 미러젤 매트 탑젤 14ml 2종"

#### Price Information:
- **판매가** (Sales Price): "12,000"
- **엄먼상가** (Wholesale Price): "8,000"
- **도배가** (Margin): "0"

Additional rows showing:
1. "2412" | "다젤 발 발음업" | (Empty pricing fields)
2. (Empty rows follow)

### Section 8: 판배 정보(연동정보) (Sales Information - Integration Info)

#### Note Text:
"물사 정보 (사내 시 상품조회 통한 / 올선 상품을 연등먼 선택 및제 최형)"

#### Sales Information Section:
**연사 물료가** (Company Distribution Price)
- Table displaying sales channel information
- 2 rows with pricing data

### Section 9: 상품 환경자 (Product Environment)

#### Fields:
1. **상품디자이너** (Product Designer)
   - Dropdown: "아이아태" (Selected)

2. **상품홍보처** (Product Promoter)
   - Dropdown: "아이아태" (Selected)

3. Additional text: "픔솔를 시업이 아이드앤 시품 해성"

### Section 10: Timestamps

#### Fields:
1. **등록일자** (Registration Date)
   - Display: "2025-07-17 오전 8:55:08 (창업자)"

2. **최종수정일자** (Last Modified Date)
   - Display: "2025-07-30 오전 8:55:08 (창업자)"

## Bottom Action Buttons
- **취소** (Cancel) - White button (left)
- **저장** (Save) - Orange button (right)

## Color Scheme
- **Modal Header**: Dark purple/navy blue
- **Primary Action**: Orange (Save button)
- **Secondary Action**: White/gray (Cancel button)
- **Background**: White
- **Form Sections**: Light gray backgrounds for organization
- **Text**: Dark gray/black
- **Checkboxes**: Blue when checked
- **Input Fields**: White with light gray borders

## Visual Organization
- Clear section headers with dividing lines
- Grouped related fields together
- Consistent spacing between sections
- Form fields aligned in logical groups
- Image upload area with visual placeholder
- Tables for channel and sales information
- Inline help text and placeholders
- Checkbox options for special handling

## Interactive Elements
- Text input fields (various sizes)
- Numeric input fields
- Dropdown selectors
- Date/time displays
- Checkboxes for options
- Search buttons for lookups
- Registration buttons for new entries
- Drag and drop image upload area
- Image previews
- Data tables with multiple columns
- Action buttons (Save/Cancel)

## Key Features
- Comprehensive product option editing
- Barcode management (multiple barcodes supported)
- Stock information tracking
- Location management
- Safety stock configuration
- Product dimensions and weight
- MOQ settings
- Image management
- Sales channel integration
- Pricing information per channel
- Audit trail (created/modified timestamps)
- Multi-checkbox support for special handling
