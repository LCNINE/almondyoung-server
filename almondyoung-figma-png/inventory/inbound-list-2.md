# Inbound List Page - View 2

## Overall Layout
This view shows the inbound list page with an expanded modal overlay for batch import and a detailed item view popup.

## Main Page (Background)
Same structure as inbound-list-1.md with the data table visible in the background.

## Center Modal - Batch Import Dialog

### Modal Title (Dark purple header bar)
**바코드 입체 대기자룸** (Barcode Import Queue Management)

### Modal Sections

#### Tab Navigation
Two tabs visible:
- **인쇄자기 업행** (Print Queue Management)
- 입체자체 하업 (Import Entity Management)

#### Filter Controls
- **입체 량정영 선배** - Dropdown: "비계진역 하업업" (Non-settlement Management)
- **인체자업 하업** - Input field with search functionality

#### Action Buttons Row
- 선택업체 (Select Entity)
- 전체선택 (Select All)

#### Data Table
Headers:
- Checkbox column
- **바코드번호** (Barcode Number)
- **상품명 / 발주업체** (Product Name / Purchase Entity)
- **제고** (Stock)
- **입체재수** (Import Quantity)
- **입체재수** (Import Quantity 2)
- **판채재고** (Sales Stock)

**Row Data:**
- Barcode: 11463020000
- Product: 노동드 버럴리 색괄 700g
- Location: L-13~15
- Date info: 리넥도넘업 [2025-07-29]
- Quantities and status fields

### Bottom Section
Displays:
- 래업리도저엠 (Entity Settlement)

## Right Side Modal - Item Detail Popup

### Popup Title (Dark purple header bar)
**품신 내역** (Product Details)

### Popup Content Sections

#### Basic Information
- **바코드 번호**: 11463343342
- **제고상품명**: 버럴고 린블코믿 통신 니롯
- **하업**: L-15-04
- **내고**: 버럴고

#### Quantity Information
- **분가**: 450

#### Detailed Information Grid
- **업체 제고**: 26
- **판채 제고**: 26

#### Transaction History Table

**Column Headers:**
- **일자** (Date)
- **구분** (Type)
- **엑셀구분** (Excel Type)
- **립고수불** (Inbound Quantity)
- **립고제제** (Inbound Total)
- **출고수불** (Outbound Quantity)
- **출고제제** (Outbound Total)
- **입채재고** (Import Stock)

**Sample Rows:**
1. Date: 2023-07-30 | Type: 입고 | Excel: 업체대불교로 | Values: 0체 | 0체 | 2체 | 924체 | 24체
2. Date: 2023-07-23 | Type: 출고 | Excel: 업체대불교로 | Values: 0체 | 0체 | 2체 | 924체 | 24체
3. Date: 2023-07-20 | Type: 입고 | Excel: 입고 | Values: 24체 | 924체 | 0체 | 0체 | 24체

### Bottom Section of Popup
Additional rows showing transaction history

## Background Table (Partially Visible)
Shows the main inbound list with columns:
- Barcode numbers
- Product images
- Product details
- Supplier information
- Dates
- Quantities
- Action buttons in orange

## Right Panel - Instructions (Partially Visible)
Information panel visible on the far right with text sections explaining:
- Inbound list functionality
- Print queue management
- Quantity management
- Important notes in red text

## Color Scheme
- **Modal Headers**: Dark purple/navy blue
- **Primary Actions**: Orange buttons
- **Background**: Semi-transparent overlay
- **Popup Background**: White
- **Table Headers**: Light gray
- **Text**: Dark gray/black
- **Selected Rows**: Highlighted

## Interactive Elements
- Modal overlays with close buttons
- Tabs for navigation
- Dropdown filters
- Input fields
- Checkboxes for row selection
- Action buttons
- Scrollable content areas
- Data tables with sorting capabilities

## Layout Hierarchy
1. Main page (background layer)
2. Semi-transparent overlay
3. Center modal dialog (batch import)
4. Right-side detail popup (item details)
5. Instructions panel (far right)

## Visual Patterns
- Consistent use of purple for headers
- Orange for primary actions
- Multi-layered modal dialogs
- Clear separation between sections
- Tabular data display
- Filter controls at top of each section
