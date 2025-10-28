# FO List By Region (Fulfillment Order List by Region)

## Overview
This interface displays a list of fulfillment orders (FO) organized by region, allowing users to view and manage orders grouped geographically for efficient delivery routing and logistics planning.

## Layout Structure

### Left Sidebar (Dark Navy Background)
**Header**
- Logo: "LCNINE"
- Badge: "2 건수팀" indicator

**Navigation Menu**
- **주문/출고** (Orders/Outbound) section - Active
  - 입고 제품수: 567
  - 주문수집
  - 매장 제고
  - 주문입력
  - 주문 입력(수동/자동팀)
  - 주문 입력(수동/요청팀)
  - **주문내역 목록** (highlighted/active)
  - 출고
  - [단말기] 개인별 출고
  - 주문별 출고 출력
  - 종입/출고 / 출고 관리팀 조회
  - 파티선수
  - 검수 할당
  - 할당요청 제고

### Top Navigation Bar
Horizontal tabs with icons:
- 회사/조직 (Company/Organization)
- 기본정보 (Basic Info)
- 주문/출고관리 (Order/Outbound Management) - Active
- 제조/생산 관리 (Manufacturing/Production Management)
- CS
- 판매 / 통계 (Sales / Statistics)
- 지시서 관리 (Instruction Management)
- 매입/입 관리 (Purchase/Inbound Management)

### Breadcrumb Navigation
홈 > 주문/출고 > 제고요청 > 지역별 출고

## Filter Section

### Filter Controls (Organized in Grid Layout)

**Row 1: Three Columns**
- **지간호** (Region): Dropdown showing "경기도"
- **시/군/구** (City/District): Dropdown showing "부천시"
- **도로명** (Street Name): Dropdown showing "광범위"

**Row 2: Date and Additional Filters**
- **조회가간** (Search Period): Dropdown showing "출고예정일"
- Date Range: 2025-09-09 to 2025-09-09 with X clear buttons
- **선불 수** (Prepaid): Dropdown with no selection (showing empty)

### Action Buttons
- Orange **검색** (Search) button
- White **초기화** (Reset) button

### Results Header
- Text: "총 40건의 출고회의 입니다" (Total 40 outbound orders)
- Pagination: 1 / 2 with 40건의 입가 (40 items) and sorting dropdown

## Data Table

### Table Headers
| 출고건요지부 | 청보소 지록 | 오건위도 | 판매처 | 다량내역 | 출고내역용 | 수량 | 전택인주 | 수도 | 우편번호 | 오건일자 |
|------------|-----------|---------|--------|---------|----------|------|---------|------|---------|---------|
| FO Batch No. | Product Info | Order Number | Sales Channel | Product Details | FO Details | Qty | Phone | Address | Postal Code | Order Date |

### Table Rows (6 identical entries shown)

Each row contains:
- **출고건요지부**: 2025-07-01, 11:44
- **청보소 지록**: 김영배
- **오건위도**: O20293090-1003954885 with [icon] logo
- **판매처**: 출고건임
- **다량내역**: Multiple products listed:
  - 일품백 텀어야치 50개
  - 다결 노자어스 60제광 관련 일품 14ml 2건 (6건구 M 노자이치 텀임)
  - 아로도영 제칭해링 (먼) 건양내에도수
  - OYUL CARTRIDGE 탄 카로치서 나움
  - 과이제도 32제공
- **수량**: 1 for each product line
- **전택인주**: 010-2222-2222
- **수도**: 경기도 부천시 부천건임원길 22 (텀례 83-1 텀 출어나제 제권리움
- **우편번호**: 14640
- **오건일자**: 20230912-2304958

## Bottom Action Bar

### Left Section
- Button: "제금 대이젤목" (Export Selected) with icon

### Right Section (Series of Action Buttons)
- **부지선수** (Assign Picker) - white button with icon
- **일수 일자가** (Schedule Date) - white button with icon
- **제금송장 입력** (Print Label) - white button with icon
- **부선내수** (Assign Packer) - white button with icon
- **출고내수** (Outbound Assignment) - white button with icon
- **송일입력** (Delivery Input) - white button with icon
- **출고거임** (Outbound Completion) - orange button with icon
- **일수 출고입력** (Schedule Outbound) - orange button with icon

### Footer
"페이지네이션" (Pagination) centered at bottom

## Right Panel (Help/Documentation)

### Title
"지역별 출고 건 체크" (Regional Outbound Order Check)

### Content Sections

**1. 일부지역 지체배송을 위한 지역별 출고 기지 기능**
Description: Explains the regional outbound feature for specific regional delivery management
- Detailed text explaining batch processing by region

**2. 판매처** (Sales Channel)
- Lists sales channels: 네이버, 스마트스토어, 쿠팡 등 날짜별, 지역순 등

**3. 조회가간** (Search Period)
- Explains search period functionality for order status viewing

**4. 다량내역** (Product Details)
- Description of product detail view capabilities

**5. 발주자단** (Orderer Field)
- Information about filtering by specific user/orderer

**6. 출고지역** (Outbound Region)
- Explanation of sorting by outbound region

**7. 발주관리** (Order Management)
- Description: 발주 다각도 주택 청보를 받아서와 관여 내용에서 기능들

**8. 출고지역** (Outbound Region)
- Detailed text about regional grouping

**9. 출고일자** (Outbound Date)
- Information about date filtering and management

**10. 중요 노티스** (Important Notice)
Highlighted in red:
- Warning text about order status management and batch assignment procedures
- Details about validation and processing rules

## Color Scheme
- **Primary Navigation**: Dark navy (#1a1f3a)
- **Active Elements**: Orange/amber for action buttons
- **Table**: White background with light gray borders
- **Headers**: Light gray background
- **Text**: Dark gray/black for content
- **Links**: Blue hyperlinks
- **Buttons**:
  - Primary actions: Orange (#f5a842)
  - Secondary actions: White with gray borders

## Key Features
- Regional grouping of fulfillment orders
- Multi-level location filtering (region > city > street)
- Date range selection for order searching
- Detailed product information per order
- Batch processing capabilities
- Multiple action buttons for workflow management
- Phone numbers and addresses visible for delivery
- Pagination for large datasets
- Export functionality for selected items
- Comprehensive help documentation
