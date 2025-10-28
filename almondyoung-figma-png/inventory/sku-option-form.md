# SKU Option Form (Option Creation)

## Modal Title (Dark purple header)
**재고 상품 정보 수정** (Inventory Product Information Modification)

## Modal Layout
Large scrollable modal dialog for creating or modifying product options with comprehensive form sections.

## Action Buttons (Top Right)
- **취소** (Cancel) - White button
- **저장** (Save) - Orange button

## Form Sections

### Section 1: 기본정보 (Basic Information)

#### Fields:
1. **상품명** (Product Name)
   - Text field displaying: "다젤 M 노와이프 미러젤 매트 탑젤 14ml 2종 (타겟2-M노와이프 탑젤)"

2. **사업 상품명** (Business Product Name)
   - Empty text field

3. **수입식간관도** (Import Food Management)
   - Empty text field

4. **물류차** (Logistics)
   - Dropdown: "부천공고" (Bucheon)
   - Buttons: "검색" (Search) | "신규 등록" (New Registration)

5. **분도** (Category)
   - Empty text field

6. **재고수량** (Stock Quantity)
   - Dropdown: "볼리나드" (Selected)

### Section 2: 바코드 (Barcode)

#### Fields:
1. **바코드번호(별수)** (Barcode Number - Variable)
   - Text field: Empty
   - Placeholder: "(바텐카 시 자동일력)" (Auto-fill on scan)

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
   - Numeric display: "4"

4. **안정 제고** (Safety Stock)
   - Numeric field: Empty

5. **분가** (Price)
   - Numeric field: "1,300" with unit "한"
   - Badge: "0" in red circle
   - Text: "하고" (Unit)

6. **유종기간** (Valid Period)
   - Two numeric fields: "0" and additional field
   - Red circle badge with "6"

### Section 4: 물류정보 (Logistics Information)

#### Fields:
1. **상품 무게** (Product Weight)
   - Numeric field: "20"
   - Unit: "g"
   - Checkbox: "펀한먼치" (Convenience) with text "다젤 제품의 편의점 담당"

2. **상품 규격** (Product Dimensions)
   - Four input fields: "4" * "15" * "3" "cm"
   - Checkbox: "회대 편도계수" (Maximum frequency) with value "20"

3. **상품 소재** (Product Material)
   - Empty text field
   - Checkbox: "표장 주의사항" (Labeling precautions)

### Section 5: 이미지 정보 (Image Information)

#### Field:
**대표이미지** (Representative Image)
- File upload area
- Text: "파견관련" and "건자사이즈 500x500px ~ 1000x1000px"
- Two product images displayed (black bottles with labels)

### Section 6: 상품설명 (Product Description)

#### Fields:
1. **상품설명** (Product Description)
   - Large text area (empty)

2. **MOQ** (Minimum Order Quantity)
   - Text field: "브랜드: 제품 50개"
   - Checkbox: "수입식 설곤제자물" (Import food settlement) - Checked

3. **패2오** (Field 2)
   - Empty text field

4. **패2오3** (Field 3)
   - Empty text field

### Section 7: 단제 정보(연동정보) (Channel Information - Integration)

#### Checkbox:
"올선 정보 (사내 시 상품조회 통한 / 올선 상품을 연등먼 선택 및제 최형)"
(Option information - Product search through internal system / Select and link option products)

#### Sales Channel Code Section:
**훈폴상품 코드** (Product Code)
Display showing:
- Code: "5574"
- Product name: "다젤 M 노와이프 미러젤 매트 탑젤 14ml 2종"

#### Pricing Table:
Table with columns:
- **판매가** (Sales Price): "12,000"
- **엄먼상가** (Wholesale Price): "8,000"
- **도배가** (Margin): "0"

Additional row:
- Code: "2412"
- Product: "다젤 발 발음업"
- Empty pricing fields

### Section 8: 판배 정보(연동정보) (Sales Information - Integration)

#### Note:
"물사 정보 (사내 시 상품조회 통한 / 올선 상품을 연등먼 선택 및제 최형)"

#### Sales Distribution Table:
Shows pricing and distribution information across sales channels

### Section 9: 상품 환경자 (Product Management)

#### Fields:
1. **상품디자이너** (Product Designer)
   - Dropdown: "아이아태" (Selected)

2. **상품홍보처** (Product Promoter)
   - Dropdown: "아이아태" (Selected)

3. Note: "픔솔를 시업이 아이드앤 시품 해성"

### Section 10: 등록 정보(연동정보) (Registration Information)

#### Subsection: 단제(승낙)정보 (Channel Approval Information)

Checkbox with text explaining channel linkage

#### Table for Channel Codes:
Table displaying integration information with multiple rows

### Section 11: Timestamps

#### Fields:
1. **등록일자** (Registration Date)
   - Display: "2025-07-17 오전 8:55:08 (창업자)"
   - Format: Date, time, and user

2. **최종수정일자** (Last Modified Date)
   - Display: "2025-07-30 오전 8:55:08 (창업자)"
   - Format: Date, time, and user

## Bottom Action Buttons
- **취소** (Cancel) - White/gray button (left)
- **저장** (Save) - Orange button (right)

## Color Scheme
- **Modal Header**: Dark purple (#3D2C5C)
- **Primary Action**: Orange (Save button)
- **Secondary Action**: White/gray (Cancel button)
- **Background**: White
- **Section Backgrounds**: Light gray for organization
- **Text**: Dark gray/black
- **Input Fields**: White with light gray borders
- **Checkboxes**: Blue when checked
- **Badges**: Red circles for validation indicators
- **Table Headers**: Light gray

## Visual Organization
- Clear section headers with consistent styling
- Logical grouping of related fields
- Hierarchical form structure
- Consistent spacing and alignment
- Form fields with appropriate input types
- Inline action buttons for search/registration
- Image upload area with visual preview
- Tables for pricing and channel data
- Timestamp displays for audit trail

## Interactive Elements
- Text input fields (various widths)
- Numeric input fields with units
- Dropdown selectors
- Checkboxes with descriptive labels
- Search buttons for entity lookup
- Registration buttons for new entries
- File upload with drag-and-drop support
- Image preview display
- Data tables with editable cells
- Save/Cancel action buttons

## Key Features
- Comprehensive option management
- Multiple barcode support (up to 3)
- Stock location tracking (primary and safety stock)
- Product dimensions and weight capture
- Image management with size requirements
- MOQ configuration
- Sales channel integration
- Pricing by channel
- Designer/promoter assignment
- Audit trail with timestamps
- Auto-fill capabilities for certain fields
- Validation indicators (red badges with counts)

## Form Validation
- Required field indicators
- Numeric validation for quantities and prices
- Image size requirements specified
- Placeholder text for guidance
- Checkbox validation for special handling
- Unit labels for measurements
- Format guidance for barcodes

## Data Integration
- Links to sales channels
- Product code management
- Pricing synchronization across channels
- Stock location mapping
- Designer/promoter assignment
- Audit information tracking

## Workflow
1. Enter or confirm basic product information
2. Configure barcode information
3. Set stock location and safety levels
4. Define logistics details (weight, dimensions)
5. Upload product images
6. Add product description and MOQ
7. Configure sales channel integration
8. Set pricing for each channel
9. Assign designer and promoter
10. Review and save changes
