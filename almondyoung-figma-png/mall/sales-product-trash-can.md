# Sales Product Trash Can (삭제상품 관리)

## Overview
This page displays deleted products in a "trash can" or recycle bin. It allows users to view, search, and manage products that have been deleted from the system. Users can filter deleted products by various criteria and potentially restore or permanently delete them.

## Layout Structure

### Top Navigation Bar
- **Left side**: LCNINE logo
- **Right side horizontal menu**:
  - 회사/조직 (Company/Organization)
  - 기획/관리 (Planning/Management)
  - 주문/출고관리 (Order/Shipping Management)
  - 제고&상품 관리 (Inventory & Product Management)
  - CS
  - 판매/통계 (Sales/Statistics)
  - 자사몰 관리 (Company Mall Management) - Currently active
  - 멀버십 관리 (Membership Management)

### Left Sidebar Navigation
Dark blue background:

**Main Menu Items**:
- 이전원 (User/Account section)
- 관리구역 (Management Area) label

**자사몰 관리 Submenu**:
- 상품 관리 (Product Management)
- 대시보드 (Dashboard)
- 상품 목록 (Product List)
- 상품 등록 (Product Registration)
- 분류/카테고리 (Classification/Category)
- 진열 (Display)
- **삭제상품 관리** (Deleted Products Management) - Currently active in blue

**Other Sections**:
- 마케팅 (Marketing)
- 매서치 관리 (Message Management)
- 배너 관리 (Banner Management)
- 판정옵 / 공지사항 관리 (Notice Management)
- 적립금 (Points)
- 쿠폰 (Coupons)
- 프로모션 (온라인) (Promotion - Online)
- 이벤트 (온라인) (Event - Online)
- 탭핑 (온라인) (Tapping - Online)

### Breadcrumb Navigation
홈 > 자사몰 관리 > 자료&조회 > 주문별매 목록

## Main Content

### Search/Filter Panel

**검지 (Search)** section:
- **상품기간별** (Product Period) dropdown: (empty)
- Radio buttons:
  - ○ **전체** (All) - Selected
  - ○ 오늘 (Today)
  - ○ 어제 (Yesterday)
  - ○ 일주일 (Week)
  - ○ 당월 (Current Month)
  - ○ 전월 (Previous Month)
  - ○ 3개월 (3 Months)
- **일정기간** (Specific Period):
  - Calendar icon (📅) with date field: 2025-06-20 ✕
  - "~" separator
  - Calendar icon (📅) with date field: 2025-06-20 ✕

**선택사항** (Options):
- Dropdown: "분류 선택" (Select Category)
- Dropdown: "판매시 선택" (Select Sales)
- Dropdown: "전체 상품 다이아라이" (All Products Diary)

**검색어명** (Search Term):
- Dropdown: "분류 검색" (Category Search)
- Text input field (empty)

**Search Button**:
- **검색** (Search) - Orange button, centered below filters

### Results Section

**Result Count and Actions**:
- Left side: "☰ 9967건" (9967 items)
- Right side buttons:
  - **제품 다운로드** (Product Download)
  - **선택 상품 복구** (Restore Selected Products)
  - **상품 상세 마스터** (Product Detail Master) button on far right

### Product Table

**Column Headers**:
- Checkbox (for select all)
- **공린코드** (Product Code)
- **판매채널** (Sales Channel)
- **이미지** (Image)
- **상품명<br/>분류<br/>보관된 번호** (Product Name<br/>Category<br/>Stored Number)
- **공식제목/공식수** (Official Title/Count)
- **판매자** (Seller)
- **판매가<br/>판매상가<br/>도매가** (Selling Price<br/>Sale Price<br/>Wholesale Price)
- **가능** (Availability)
- **동등외날<br/>수정날자<br/>삭제일날자** (Registration Date<br/>Edit Date<br/>Delete Date)

**Sample Product Entry**:
- Checkbox: ☐
- Product Code: 19967
- Code: 23908344
- Sales Channel Badge: (logo/badge indicator showing "lcnine : multi")
- Image: Product photo showing two dark bottles
- Product Name: **디물 N; 노이안트 미다로에 페라 밤별 14ml 2종** (in blue hyperlink)
  - Subtitle: "상품코드 : 다칸 > 페로철"
  - Badge: "다칸"
- Official Title/Count: "다칸 / 2"
- Seller: "총국"
- Selling Price:
  - 12,000
  - 6,002 (in red, struck through)
  - 0
- Availability: "⚡ 재판입" (Re-entry) with "재판되입" (Re-entered) in teal
- Dates:
  - 2025-06-27 10:14
  - 2025-06-27 10:24
  - 2025-06-27 10:24

**Pagination**:
- Text at bottom center: "페이지번호" (Page number)

### Right Panel: Help Section

**삭제상품 관리** (Deleted Products Management)

**삭제치리한 상품 조회 및 관리** (View and Manage Deleted Products)
삭제처리된 관리상품들 조회할 수 있고 복구 시킬 수 있습니다.
삭제기간별 또는 타이어 별로 있습니다. (유기정)

**중요 노티스** (Important Notice)
Text in red/orange:
- (Bullet point or important note text - partially visible)

## Features and Interactions

### Search and Filter Capabilities
- **Time period filtering**: Multiple preset options (today, yesterday, week, month, etc.)
- **Custom date range**: Calendar picker with start and end dates
- **Category filtering**: Dropdown selection
- **Sales channel filtering**: Filter by sales platform
- **Search by keyword**: Text search with category context
- **Product download**: Export functionality

### Product Management Actions
- **Bulk selection**: Checkboxes for multiple items
- **Restore selected**: Recover deleted products
- **Product detail master**: Access detailed product information
- **Individual product links**: Click product name for details

### Table Features
- **Comprehensive columns**: Code, channel, image, name, pricing, dates
- **Visual indicators**: Badges for sales channels and categories
- **Price display**: Shows multiple price types with strikethrough for discounts
- **Status indicators**: Lightning bolt icon for re-entry status
- **Date tracking**: Registration, edit, and deletion timestamps
- **Image thumbnails**: Visual product identification

## Color Scheme
- **Primary**: Dark navy blue for sidebar
- **Active state**: Bright blue for selected menu items and hyperlinks
- **Action buttons**: Orange for primary actions (Search, buttons)
- **Status badges**: Various colors for channels and categories
- **Price highlights**: Red for discounted/sale prices
- **Status colors**: Teal for re-entry status
- **Background**: White/light gray for content areas
- **Table**: Alternating row colors for readability

## Data Display Patterns
- **Structured table**: Multi-column layout with sortable headers
- **Inline images**: Product thumbnails in table
- **Badge indicators**: Visual tags for categories and channels
- **Multi-line cells**: Product name with category and code
- **Date formatting**: YYYY-MM-DD HH:MM format
- **Price formatting**: Comma-separated thousands with currency symbol
- **Status icons**: Visual indicators for product state
- **Pagination**: Navigate through large result sets
- **Bulk actions**: Select and operate on multiple items
- **Filter persistence**: Maintain search criteria across sessions

## Use Cases
1. **Recovery**: Restore accidentally deleted products
2. **Audit**: Review what products were deleted and when
3. **Cleanup**: Permanently delete old products
4. **Analysis**: Understand deletion patterns
5. **Export**: Download deleted product data for reporting
