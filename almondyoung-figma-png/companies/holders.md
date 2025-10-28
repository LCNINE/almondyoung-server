# Holders (발주처 관리) - Design Specification

This document describes the order holder/supplier management page with filtering capabilities and a comprehensive table showing supplier information.

## Page Header

### Browser Chrome
- **Tabs**: Two "Google Chrome" tabs
- **URL Bar**: "https://www.google.com/chrome/"
- **Browser Controls**: Navigation, bookmark, profile icons

### Application Header
**LCNINE** logo/brand on the left

### Top Navigation Bar
Horizontal menu with icons:
1. 회사/조직 (Company/Organization) - user icon
2. **가맹처관리** (Channel Management) - store icon - **ACTIVE** - blue
3. 주문/출고관리 (Order/Outbound Management) - clipboard icon
4. 재고/출고 관리 (Inventory/Stock Management) - box icon
5. CIS - search icon
6. 판매 / 통계 (Sales / Statistics) - chart icon
7. 자사몰 관리 (Own Mall Management) - edit icon
8. 명예의 전당 (Hall of Fame) - trophy icon

### Breadcrumb Navigation
홈 > 가맹처 관리 > 발주처 관리

## Left Sidebar Navigation

### User Section
- **아진영** (user name)
- **로그아웃** button - white outline

### Menu Section
**가맹처 관리** (Channel Management)

Menu items:
- 지출 일자 관리 (Expense Date Management)
- **발주처관리** (Order Holder Management) - **ACTIVE** - blue background
- 고객관리 (Customer Management)
- 회원 조회 (Member Inquiry)
- 단골리스트 (Regular Customer List)
- 블랙리스트 (Blacklist)

## Filter Section

White card with filtering options:

### Filter Row 1
| Field | Type | Placeholder |
|-------|------|-------------|
| 분류 (Category) | Dropdown | "종목 선택" (Select category) |
| (Second dropdown) | Dropdown | "발주 담당자 선택" (Select order manager) |

### Filter Row 2
| Field | Type | Placeholder |
|-------|------|-------------|
| 통합검색 (Integrated Search) | Dropdown | "통합검색" (Integrated search) |
| (Search field) | Text Input | Empty search field |

### Search Button
- **Text**: "검색" (Search)
- **Style**: Orange background, white text
- **Position**: Centered below filters

## Action Buttons Row

Three buttons above the table:
1. **엑셀 다운로드** (Excel Download) - white with border
2. **선택 삭제** (Delete Selected) - white with border
3. **발주처 선행등록** (Pre-register Order Holder) - orange background

## Data Table

### Table Title
**"발주처 / 생명 및 메모"** (Order Holder / Description & Memo)

### Table Column Headers
| Column | Description | Width |
|--------|-------------|-------|
| ☐ | Checkbox (select all) | Fixed |
| 발주처명 (Order Holder Name) | Company name with sub-info | Medium |
| 팩스 (Fax) | Fax number with external link icon | Medium |
| 종목 (Category) | Business category | Small |
| 연락처 (Contact) | Phone number | Medium |
| 등록 상품수 (Registered Products) | Product count | Small |
| 발주담당자 (Order Manager) | Manager name | Medium |
| 수정 (Edit) | Edit button | Fixed |
| 등록일 (Registration Date) | Date (two rows) | Medium |

### Sample Table Rows

**Row 1 - 영티샵**
- ☐ Checkbox
- **영티샵**<br>- / -
- 비료가기 🔗
- 종목
- 연락처
- 등록 상품수
- 발주담당자
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 2 - 영티샵** (Partial data at top)
- Similar structure
- Shows limited data in header area

**Row 3 - 디웰**
- ☐ Checkbox
- **디웰** (in blue - clickable link)<br>- / -
- 비료가기 🔗
- 속눈썹
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 4 - 에이제**
- ☐ Checkbox
- **에이제**<br>- / -
- 비료가기 🔗
- 종합
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 5 - 착한한의**
- ☐ Checkbox
- **착한한의**<br>- / -
- (empty)
- 종합
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 6 - 종주**
- ☐ Checkbox
- **종주**<br>- / -
- 비료가기 🔗
- 종합
- 010-0000-0000
- 1449
- 이예은
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 7 - 하이팔프드**
- ☐ Checkbox
- **하이팔프드**<br>- / -
- 비료가기 🔗
- 반영구
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 8 - 중국 박막 회장**
- ☐ Checkbox
- **중국 박막 회장**<br>- / -
- 비료가기 🔗
- 종합
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 9 - 매이비요술향**
- ☐ Checkbox
- **매이비요술향**<br>팥칼 지매리 / -
- 비료가기 🔗
- 반영구
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 10 - 누누샵**
- ☐ Checkbox
- **누누샵**<br>- / -
- 비료가기 🔗
- 속눈썹
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 11 - 3PL**
- ☐ Checkbox
- **3PL**<br>- / -
- 비료가기 🔗
- 속눈썹
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

**Row 12 - 최수도도실**
- ☐ Checkbox
- **최수도도실** (in blue - clickable link)<br>- / -
- 비료가기 🔗
- 내일
- 010-0000-0000
- 15
- 홍길동
- 수정 button
- 2025-08-09<br>2025-08-09

## Footer
Centered text:
- **"페이지하단입니다"** (This is the bottom of the page)

## Right Sidebar Information Panel

### Panel Title
**발주처 관리** (Order Holder Management)

### Section 1: 엽씨나리의 상품을 구매하는 발주처 목록 (List of Order Holders Purchasing Company Products)
Text: "엽씨나리의 상품을 구매하는 발주처 목록"
Subtext: "발주처를 관리할 목록"

### Section 2: 종목 분류 (Category Classification)
**Header**: "종목 분류"
**Categories List**:
- 헤어 / 네일 / 반영구 / 속눈썹 / 메이크업 / 피부 / 타투 / 종합

### Section 3: 발주 담당자 (Order Manager)
**Header**: "발주 담당자"
**Text**: "발주 담당자 지정"

### Alert Box
**Background**: Light pink/red
**Text Color**: Red
**Header**: "중요 노티스"
**Content**: "업체 배송기간 통상에 발주처 주 의는 사이트보다는 적확성을 이유"

## Design Specifications

### Colors
- **Primary Blue**: #4A90E2 (active nav, links)
- **Primary Orange**: #FF8C00 (search button, action buttons)
- **Background Navy**: #2C2E4A (left sidebar)
- **Alert Red**: #FF4757 (alert box)
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
- **Company Names**: Medium weight, 14px (blue when clickable)
- **Filter Labels**: Regular, 13px

### Layout Structure
- **Fixed Left Sidebar**: 220px width, dark background
- **Main Content**: Flexible width, white background
- **Right Info Panel**: ~300px width, light background
- **Three-column Layout**: Sidebar | Content | Info Panel
- **Top Navigation**: Full width, fixed height

### Filter Card
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 8px
- **Padding**: 24px
- **Box Shadow**: Subtle shadow
- **Layout**: Two rows of filters
- **Spacing**: 16px between rows

### Button Styles

**Primary Action Button (검색, 발주처 선행등록)**
- **Background**: Orange (#FF8C00)
- **Text**: White, medium weight
- **Border Radius**: 4px
- **Padding**: 10px 32px
- **Hover**: Darker orange
- **Shadow**: Subtle shadow

**Secondary Action Buttons (엑셀 다운로드, 선택 삭제)**
- **Background**: White
- **Text**: Dark gray
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 8px 16px
- **Hover**: Light gray background

**Edit Button (수정)**
- **Background**: White
- **Text**: Dark gray
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 6px 16px
- **Size**: Small, compact

### Input & Dropdown Styles
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 10px 12px
- **Font Size**: 14px
- **Placeholder**: Light gray (#AAAAAA)
- **Focus**: Blue border (#4A90E2)
- **Dropdown Arrow**: Right side

### Table Design

**Table Container**
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 8px
- **Box Shadow**: Subtle shadow

**Table Headers**
- **Background**: Light gray (#F8F8F8)
- **Text**: Bold, dark gray
- **Padding**: 12px
- **Border Bottom**: Light gray (1px)
- **Alignment**: Center for most, left for names

**Table Rows**
- **Background**: White
- **Border Bottom**: Light gray (1px)
- **Padding**: 12px
- **Row Height**: 60px (to accommodate two-line dates)
- **Hover**: Light blue background (#F0F7FF)

**Table Cells**
- **Padding**: 12px
- **Vertical Align**: Middle
- **Text Align**: Left for text, center for numbers
- **Company Names**: Bold or medium weight
- **Sub-info**: Gray, smaller text below name

### Special Cell Styles

**Company Name Cell**
- **Primary Text**: Bold, larger (14px)
- **Secondary Text**: Gray, smaller (12px)
- **Format**: Name on first line, "- / -" on second line
- **Clickable Names**: Blue color (#4A90E2)

**Fax Cell**
- **Text**: "비료가기" (Visit)
- **Icon**: External link icon 🔗
- **Style**: Link style
- **Color**: Blue when hovering

**Date Cell**
- **Format**: Two lines
- **Line 1**: 2025-08-09
- **Line 2**: 2025-08-09
- **Alignment**: Center
- **Size**: 12px

### Checkbox Styling
- **Unchecked**: Empty square outline
- **Checked**: Blue square with white checkmark
- **Size**: 16px x 16px
- **Position**: Vertically centered in cell
- **Hover**: Light blue background

### External Link Icon
- **Icon**: 🔗 or arrow-out icon
- **Size**: 14px
- **Color**: Blue or gray
- **Position**: After "비료가기" text
- **Hover**: Darker color

### Action Buttons Layout
- **Position**: Above table, below filters
- **Alignment**: Left-aligned
- **Spacing**: 12px gap between buttons
- **Margin**: 16px bottom margin

### Right Info Panel

**Panel Container**
- **Background**: Light gray (#F8F8F8) or white
- **Border Left**: Light gray (1px)
- **Padding**: 24px
- **Width**: ~300px fixed
- **Height**: Full viewport height
- **Scroll**: Vertical scroll if needed

**Panel Sections**
- **Spacing**: 24px between sections
- **Header**: Bold, 14px, dark text
- **Body Text**: Regular, 13px, gray
- **Category List**: Forward slash separators

**Alert Box**
- **Background**: Light pink (#FFF0F0)
- **Border**: Red (1px) or none
- **Border Radius**: 4px
- **Padding**: 12px
- **Text Color**: Red (#FF4757)
- **Font Size**: 12px
- **Margin Top**: Auto (bottom of panel)

### Sidebar Navigation
- **Background**: Dark navy (#2C2E4A)
- **Text**: White
- **Active Item**: Blue background (#4A90E2)
- **Hover**: Lighter navy background
- **Padding**: 12px per item
- **Border Radius**: 4px for active item

### Spacing

**Page Layout**
- **Content Padding**: 24px
- **Section Spacing**: 24px between major sections
- **Filter Spacing**: 16px between filter rows
- **Button Row Spacing**: 12px between buttons

**Table Spacing**
- **Cell Padding**: 12px
- **Row Height**: 60px minimum
- **Header Height**: 48px
- **Column Gap**: Auto-distributed

**Panel Spacing**
- **Section Gap**: 24px
- **Header to Content**: 12px
- **Internal Padding**: 24px

### Responsive Behavior
- **Desktop**: Three-column layout (sidebar | table | info panel)
- **Tablet**: Two-column (collapsible sidebar, info panel below table)
- **Mobile**: Single column, all elements stack
- **Table**: Horizontal scroll on smaller screens
- **Filters**: Stack vertically on mobile

### Interactive Elements

**Clickable Elements**
- Company names (blue links - open detail)
- "비료가기" links (external link to fax)
- Edit buttons (수정 - open edit form)
- Checkboxes (select rows for bulk actions)
- Action buttons (perform operations)
- Filters (select and search)

### Data Formatting
- **Phone Numbers**: 010-0000-0000 format
- **Dates**: YYYY-MM-DD format
- **Numbers**: Plain integers (no formatting)
- **Sub-info**: "- / -" format for empty values

### Empty States
- **No Results**: "검색결과가 없습니다" message
- **No Data**: Empty table with message
- **No Selection**: Action buttons disabled

### Loading States
- **Initial Load**: Skeleton rows in table
- **Search**: Spinner on search button
- **Action**: Loading indicator on action buttons

### Pagination
(Not visible but would typically include):
- **Position**: Bottom center of table
- **Controls**: Page numbers, prev/next
- **Style**: Blue for current page

### Validation & Errors
- **Search Error**: Toast notification
- **Delete Confirmation**: Modal dialog
- **Network Error**: Error message with retry
