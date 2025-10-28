# Customers List (고객 조회) - Design Specification

This document describes the customer list/inquiry page with advanced filtering capabilities and a comprehensive data table showing customer information.

## Page Header

### Browser Chrome
- **Tabs**: Two "Google Chrome" tabs visible
- **URL Bar**: "https://www.google.com/chrome/"
- **Browser Controls**: Back, forward, refresh buttons, bookmark icon, profile icon, menu

### Application Header
**LCNINE** logo/brand on the left

### Top Navigation Bar
Horizontal menu with icons and labels:
1. 회사/조직 (Company/Organization) - user icon
2. 가맹처관리 (Channel Management) - store icon
3. 주문/출고관리 (Order/Outbound Management) - clipboard icon
4. 재고/출고 관리 (Inventory/Stock Management) - box icon (active/selected - blue)
5. CIS - search icon
6. 판매 / 통계 (Sales / Statistics) - chart icon
7. 자사몰 관리 (Own Mall Management) - edit icon
8. 명예의 전당 (Hall of Fame) - trophy icon

### Secondary Navigation
- Home icon with breadcrumb: 홈 > 가맹처 관리 > 발주처 관리

## Left Sidebar Navigation

### User Account Section
- **아진영** (user name)
- **로그아웃** button - white outline

### Menu Section
**가맹처 관리** (Channel Management)

Menu items:
- 지출 일자 관리 (Expense Date Management)
- 발주처관리 (Order Management)
- 고객관리 (Customer Management)
- **고객 조회** (Customer Inquiry) - **ACTIVE** - blue background
- 단골리스트 (Regular Customer List)
- 블랙리스트 (Blacklist)

## Summary Statistics Bar

Four metric cards displayed horizontally:

| Metric | Value | Subtext |
|--------|-------|---------|
| 대시보드 (Dashboard) | 12 | 03 gak |
| - | 12 (60%) | 03 buhh 08 |
| - | 8 (00%) | China blank 08 |
| - | 120,000₩ | Dusun fhu |

**Below metrics**:
- Text: "고객 수: 409,394명"

## Filter Section

Large white card with comprehensive filtering options organized in two columns:

### Left Column Filters

**개인정보** (Personal Information)
- **Dropdown**: "아이디" (ID) - with down arrow

**회원등급** (Member Grade)
- **Dropdown**: "선택" (Select) - with down arrow

**구매금액** (Purchase Amount)
- **From**: Input field with "원 ~" label
- **To**: Input field with "원" label

**주문일** (Order Date)
- **Date Range**:
  - Start: "2025-06-20" with calendar icon and X (clear)
  - Separator: "~"
  - End: "2025-06-20" with calendar icon and X (clear)

**주문상황** (Order Status)
- **Text Input**: Empty field

**검색검색** (Search)
- **Button**: "검색검색" (gray button)

### Right Column Filters

**판매처** (Sales Channel)
- **Dropdown**: "판매처 선택" (Select sales channel)

**회원 유형** (Member Type)
- **Radio Options**:
  - ⚫ 전체 (All) - selected
  - ⚪ 단골고객 (Regular Customer)
  - ⚪ 블랙리스트 고객 (Blacklist Customer)

**업력** (Experience)
- **From**: Dropdown with "년 ~" label
- **To**: Dropdown with "년" label

**분야** (Field)
- **Dropdown**: "전체" (All)

**구매 건수** (Purchase Count)
- **From**: Input with "건 ~" label
- **To**: Input with "건" label

### Search Button
Large orange button centered at bottom:
- **Text**: "검색" (Search)

## Action Buttons Row

Above the table, a row of action buttons:
- **비팔 다운로드** (Excel Download) - white with border
- **선택 삭제** (Delete Selected) - white with border
- **블랙리스트 설정** (Blacklist Settings) - white with red/pink indicator
- **단골리스트 설정** (Regular Customer List Settings) - white with yellow crown indicator

## Data Table

### Table Header
**"총 고객수 16506명 / 검색결과 16506 건"** (Total customers 16506 / Search results 16506 items)

### Table Column Headers
| Column | Description | Width |
|--------|-------------|-------|
| ☐ | Checkbox (select all) | Fixed |
| 판매처 (Sales Channel) | Channel with icon | Medium |
| 주문자 이름 (Orderer Name) | Customer name (link) | Medium |
| 휴대전화 (Mobile Phone) | Phone number | Medium |
| 구매건수 (Purchase Count) | Number of purchases | Small |
| 구매수량 (Purchase Quantity) | Quantity purchased | Small |
| 구매금액 (Purchase Amount) | Total amount | Small |
| 주문 완수 (Completed Orders) | Order completion count | Small |
| 분야 (Field) | Business category | Medium |
| 메일/sms/알림 (Mail/SMS/Alert) | Communication preferences | Medium |
| 아이디 (ID) | User ID | Medium |
| 등급 (Grade) | Member grade | Small |
| 등록일 (Registration Date) | Sign-up date | Medium |

### Table Rows (Sample Data - 16 visible rows)

**Row Pattern (typical row)**:
- ☐ Checkbox
- Channel icon (various)
- 최윤정 (name, blue link)
- 010-0000-0000
- 323,900
- 400
- 59
- 30
- 반영구 (Semi-permanent)
- 메일/sms/알림
- 44351968388@k
- 일반회원 (Regular member)
- 20205-09-03

**Special Row Types**:

**Row 4** (with red indicator):
- Has small red square indicator next to ID
- 44351968388@k ⬛

**Row 9** (with green status):
- Green circle with "사용중임에요" (In use) status icon

**Row 10** (with red status):
- Red circle with "미연동" (Not connected) status and platform icon

**Row 11** (with yellow indicator):
- Yellow square indicator next to ID
- 44351968388@k 🟨

**Rows 9-10** (partial data):
- Show only first columns populated
- Later columns show "-" for no data

## Footer
Centered text:
- **"페이지하단입니다"** (This is the bottom of the page)

## Design Specifications

### Colors
- **Primary Blue**: #4A90E2 (active menu, links)
- **Primary Orange**: #FF8C00 (search button)
- **Background Navy**: #2C2E4A (left sidebar)
- **Success Green**: #00C853 (active status)
- **Warning Red**: #F44336 (inactive/error status)
- **Warning Yellow**: #FFC107 (special indicator)
- **Text Primary**: Black (#333333)
- **Text Secondary**: Gray (#666666)
- **Borders**: Light gray (#E0E0E0)
- **Background**: White (#FFFFFF)
- **Table Header**: Light gray (#F8F8F8)

### Typography
- **Page Title**: Bold, 18px
- **Navigation**: Medium weight, 14px
- **Table Headers**: Bold, 13px
- **Table Data**: Regular, 13px
- **Filter Labels**: Regular, 13px
- **Statistics**: Bold, 24-32px for numbers

### Layout Structure
- **Fixed Left Sidebar**: 220px width, dark background
- **Main Content**: Flexible width, white background
- **Top Navigation**: Full width, fixed height
- **Filter Card**: Centered, max-width with padding
- **Table**: Full width of content area

### Filter Card
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 8px
- **Padding**: 24px
- **Box Shadow**: Subtle shadow
- **Two-column Layout**: 50/50 split
- **Vertical Spacing**: 16px between filter rows

### Button Styles

**Primary Search Button**
- **Background**: Orange gradient
- **Text**: White, bold
- **Border Radius**: 4px
- **Padding**: 12px 48px
- **Shadow**: Subtle shadow
- **Hover**: Darker orange

**Secondary Action Buttons**
- **Background**: White
- **Border**: Light gray (1px)
- **Text**: Dark gray
- **Border Radius**: 4px
- **Padding**: 8px 16px
- **Icons**: Colored indicators
- **Hover**: Light gray background

**Logout Button**
- **Background**: Transparent
- **Border**: White (1px)
- **Text**: White
- **Border Radius**: 4px
- **Padding**: 6px 12px

### Input Fields
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 8px 12px
- **Focus**: Blue border
- **Placeholder**: Light gray text

### Dropdown Menus
- **Style**: Same as input fields
- **Down Arrow**: Right side
- **Hover**: Light gray background
- **Selected**: Dark text

### Date Pickers
- **Calendar Icon**: Right side
- **Clear Button**: X icon on right
- **Format**: YYYY-MM-DD
- **Popup**: Calendar overlay

### Radio Buttons
- **Selected**: Filled blue circle
- **Unselected**: Empty circle outline
- **Spacing**: 8px gap between options
- **Label**: Regular text on right

### Table Design

**Table Structure**
- **Fixed Header**: Stays visible on scroll
- **Zebra Striping**: Alternating row colors (optional)
- **Row Height**: 48px minimum
- **Cell Padding**: 12px
- **Border**: Light gray bottom border on rows

**Header Cells**
- **Background**: Light gray (#F8F8F8)
- **Text**: Bold, dark gray
- **Alignment**: Left (except numbers - right aligned)
- **Sort Icons**: Would appear on hover

**Data Cells**
- **Background**: White
- **Text**: Regular weight
- **Links**: Blue, underlined on hover
- **Numbers**: Right-aligned
- **Text**: Left-aligned

**Row States**
- **Hover**: Light blue background (#F0F7FF)
- **Selected**: Checkbox checked, light blue background
- **Clickable**: Cursor pointer on name cells

### Status Indicators

**Channel Icons**
- **Size**: 24px x 24px
- **Style**: Platform logos or generic icons
- **Position**: Left side of cell

**Member Status**
- **Active (사용중)**: Green circle icon
- **Inactive (미연동)**: Red circle with X
- **Special**: Yellow square indicator

**Blacklist/Regular**
- **Blacklist**: Red square ⬛
- **Regular**: Yellow square 🟨

### Checkboxes
- **Unchecked**: Empty square outline
- **Checked**: Blue square with white checkmark
- **Header Checkbox**: Selects/deselects all
- **Indeterminate**: Partial selection indicator

### Statistics Cards
- **Background**: White or light background
- **Border**: Light gray (1px)
- **Padding**: 16px
- **Number**: Large, bold
- **Label**: Small, gray
- **Layout**: Horizontal flex

### Pagination
(Not visible in this screenshot but would typically include):
- Page numbers
- Previous/Next buttons
- Items per page selector
- Positioned at bottom of table

### Sidebar Navigation
- **Background**: Dark navy (#2C2E4A)
- **Text**: White
- **Active Item**: Blue background (#4A90E2)
- **Hover**: Lighter background
- **Icons**: 16px, white color
- **Padding**: 12px per item

### Spacing

**Page Spacing**
- **Content Padding**: 24px
- **Section Spacing**: 24px between major sections
- **Filter Row Spacing**: 16px between rows
- **Table Cell Padding**: 12px

**Filter Grid**
- **Column Gap**: 24px
- **Row Gap**: 16px
- **Label-to-Input**: 8px

### Responsive Behavior
- **Sidebar**: Collapsible on mobile
- **Filter Columns**: Stack vertically on tablet
- **Table**: Horizontal scroll on mobile
- **Statistics Cards**: Stack vertically on mobile
- **Action Buttons**: Wrap on smaller screens

### Interactive Elements

**Clickable Elements**
- Customer names (open detail modal)
- Checkboxes (select rows)
- Action buttons (perform bulk actions)
- Dropdown filters (select options)
- Date pickers (choose dates)
- Sort headers (sort columns)

### Data Formatting
- **Phone Numbers**: 010-0000-0000 format
- **Currency**: Comma-separated (323,900)
- **Dates**: YYYY-MM-DD format
- **Percentages**: XX% format
- **IDs**: Alphanumeric with @ symbol

### Loading States
- **Initial Load**: Skeleton screens
- **Search**: Loading spinner on search button
- **Table**: Progress bar or skeleton rows

### Empty States
- **No Results**: "검색결과가 없습니다" message
- **No Filters**: Show all customers
- **No Selection**: Action buttons disabled

### Error States
- **Filter Error**: Red border on invalid input
- **Load Error**: Error message with retry button
- **Network Error**: Toast notification

### Accessibility
- **Keyboard Navigation**: Tab through filters
- **Screen Reader**: Labels on all inputs
- **Focus Indicators**: Blue outline on focused elements
- **Color Contrast**: WCAG AA compliant
