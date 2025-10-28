# FO List in FO Round (Fulfillment Order List in Picking Round)

## Overview
This is a modal dialog displaying the list of fulfillment orders (FO) within a specific picking round. It shows detailed order information for batch picking operations, allowing workers to see all orders assigned to their current picking round.

## Modal Structure

### Header
- **Title**: "피킹라운드별 출고건 내역" (FO List by Picking Round)
- **Background**: Dark navy blue header bar
- **Close button**: X icon in top-right corner

## Filter Section

### Filter Controls (Multi-row Layout)

**Row 1: Basic Filters**
- **판매처 분류** (Sales Channel Category): Dropdown showing "클라이언"
- **판매처 인력** (Sales Channel): Dropdown showing "판매처 인력"
- **조회가간** (Search Period): Dropdown showing "출고예정일"
- Date Range: 2025-06-09 to 2025-08-09 with X clear buttons
- **출고방식** (Outbound Method): Dropdown showing "배송"
- **출고전가** (Outbound Status): Dropdown showing "1차차"

**Row 2: Order Status Filters**
- **조건대역** (Condition Range): Dropdown showing "전체"

**Row 3: Search Options**
- **알뷰폼 어급** (Form Level): Radio button group
  - Options visible: "알뷰폼 어급"
- **상품 지정 입력** (Product Designation Input): Radio button group
  - Selected: "판뷰도건" (Sales order number)
  - Option: "포함" (Include)
- Search input field with magnifying glass icon

### Action Buttons
- Orange **검색** (Search) button
- White **초기화** (Reset) button

## Results Summary
- Text: "총 20건의 출고건일 입니다" (Total 20 outbound orders)
- **출고제수** (Outbound count) button
- Pagination: 1 / 1 with 20건의 입가 (20 items) and sorting dropdown

## Data Table

### Table Headers
| # | 출고건일자부 | 발도부 어급 | 판매처 | 다량내역 | 선불공도 | 출고내역용 | 수량 | 피킹라운드번호 | 배송지 | 출입관도 | 출고방식 | 주문번호 |
|---|------------|-----------|--------|---------|---------|----------|------|-------------|--------|---------|---------|---------|
|   | FO Date/Time | Picker Assignment | Sales Channel | Product Details | Payment Code | FO Details | Qty | Picking Round No. | Delivery Address | Access Code | Outbound Method | Order No. |

### Table Rows (10 entries visible)

All rows follow similar pattern with date: **2025-07-01, 11:44**
Status indicator: **1일 전임** (1 day ago) in red text

**Example Row 1:**
- **발도부 어급**: 아0건임
- **판매처**: [Logo icon] ----
- **다량내역**:
  - 3216353213
  - 6646546552
  - 6646545248
  - 8465498012
  - 6565321568
- **선불공도**:
  - 일품백 텀어야치 50개
  - 다결 노자어스 60제광 관련 일품 14ml 2건 (6건구 M 노자이치 텀임)
  - 아로도영 제칭해링 (먼) 건양내에도수
  - OYUL CARTRIDGE 탄 카로치서 나움
  - 과이제도 32제공
- **수량**: 1 for each line item
- **피킹라운드번호**: 1차차
- **배송지**: 대한빈도
- **출입관도**: 100303910-2004583 with blue download icon button
- **출고방식**: 배송
- **주문번호**: 20230912-2304958

**Status Variations in Rows:**
- Some rows show green circle with "스마트도채움" (Smart auto-fill) status
- Some rows show green circle with checkmark

**Row Pattern:**
Each row contains:
- Timestamp: 2025-07-01, 11:44
- Status: 1일 전임 (red)
- Picker: 아0건임
- Sales channel logo icon
- Payment: 출고건임
- Multiple product codes (5 items per order)
- Product names in Korean
- Quantities: all showing "1"
- Delivery info: 1차차, 대한빈도
- Round number: 100303910-2004583
- Blue download icon button
- Method: 배송
- Order number: 20230912-2304958

### Footer
"페이지네이션" (Pagination) centered at bottom

## Key Visual Elements

### Status Indicators
- **Red text**: "1일 전임" (1 day ago) - urgency indicator
- **Green circle with text**: "스마트도채움" - smart auto-fill status
- **Green circle with checkmark**: Completion or verification status

### Action Icons
- **Blue download icon button**: Appears in the 출입관도 (Access Code) column for each order
- Likely for downloading shipping labels or documents

### Product Code Display
Multiple product codes displayed vertically per order:
- 3216353213
- 6646546552
- 6646545248
- 8465498012
- 6565321568

### Product Names (Repeating Pattern)
- 일품백 텀어야치 50개
- 다결 노자어스 60제광 관련 일품 14ml 2건 (6건구 M 노자이치 텀임)
- 아로도영 제칭해링 (먼) 건양내에도수
- OYUL CARTRIDGE 탄 카로치서 나움
- 과이제도 32제공

## Color Scheme
- **Header**: Dark navy blue (#2c3654)
- **Primary Button**: Orange (#f5a842)
- **Secondary Button**: White with gray border
- **Status Text**: Red for urgent items
- **Status Icons**: Green for completed/verified items
- **Action Icons**: Blue for download/action buttons
- **Background**: Light gray (#f5f5f5)
- **Table**: White background with light gray borders
- **Table Headers**: Light gray background

## Typography
- Modal title: Large, bold, white text
- Table headers: Bold, dark text
- Data cells: Regular weight
- Status text: Bold red for urgent items
- Product codes: Regular weight, smaller size

## Interaction Elements
- **Dropdowns**: Multiple filter dropdowns for search criteria
- **Radio Buttons**: For search type selection
- **Date Pickers**: For date range selection
- **Search Input**: Text field with search icon
- **Action Buttons**: Search and reset buttons
- **Download Buttons**: Individual blue icon buttons per row
- **Close Button**: X icon in header
- **Pagination Controls**: At bottom of table

## Layout Characteristics
- Full-screen modal dialog
- Comprehensive filter section at top
- Scrollable table content area
- Fixed header and filter sections
- Multiple orders per picking round displayed
- Consistent row height despite varying content
- Clear visual separation between orders

## Key Features
- Picking round-specific order list
- Multi-criteria filtering system
- Date range selection
- Picker assignment visibility
- Product code and name details
- Quantity tracking per product
- Delivery address information
- Order status indicators
- Batch processing capabilities
- Document download functionality
- Real-time status updates with time indicators
