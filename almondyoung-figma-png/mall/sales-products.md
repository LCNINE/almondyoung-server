# Sales Products List (상품 목록)

## Overview
This is the main product listing page that displays all products in the e-commerce system. It features comprehensive search/filter capabilities, bulk action tools, and a detailed table view of products with their key attributes. A prominent alert banner indicates there are 150 products requiring attention (requiring approval).

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
- **상품 목록** (Product List) - Currently active in blue
- 상품 등록 (Product Registration)
- 분류/카테고리 (Classification/Category)
- 진열 (Display)
- 자사상품 관리 (Company Product Management)

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

### Alert Banner
Prominent pink/red banner across the top of the content area:
- Icon: ⚠️
- Text: **레저 대기 상품(승인가) 150개** (150 products pending approval)
- Color: Pink/red background with dark red text

## Search/Filter Panel

### Search Fields

**검지 (Search)** section:
- **상품선별동** (Product Selection) dropdown: (empty field)
- Radio buttons for time period:
  - ○ **전체** (All) - Selected
  - ○ 오늘 (Today)
  - ○ 어제 (Yesterday)
  - ○ 당월선택 (Current Month)
  - ○ 당월 (Current Month)
  - ○ 전월 (Previous Month)
  - ○ 3개월 (3 Months)
- **일정기간** (Specific Period):
  - Calendar icon 📅: 2025-06-30 ✕
  - "~" separator
  - Calendar icon 📅: 2025-06-30 ✕

**선택사항** (Selection Options):
- **분류 선택** (Category Selection) dropdown
- **판매가 선택** (Price Selection) dropdown: "전체 상품 다이어리치" (All Products Diary)

**분류 (Category)**:
- Buttons:
  - **판매대** (On Sale)
  - **판매대대** (Best Sellers)
  - **상품대** (Products)
  - **상품대대** (Product Category)

**매장 여부** (Store Availability):
- Radio buttons:
  - ○ **전체** (All) - Selected
  - "매장여부가 상품별 별다" (Store availability by product)
  - "매장별 상품별 별다" (Product by store)

**검색어명** (Search Term):
- Dropdown: "분류 선택" (Select Category)
- Text input: "1000003"

### Search Button
- **검색** (Search) - Orange button, centered below filters

## Results Section

### Action Bar
- Left side: "☰ 9967건" (9967 items)
- Right side buttons:
  - **제품 다운로드** (Product Download)
  - **선택 복사** (Copy Selected)
  - **선택 공원별별대대** (Selected Management)
  - **판매대대** (Sales Management) - Dropdown with arrow (▼)
- Far right: **상품 제품 마스터** (Product Master) button

### Product Table

**Column Headers**:
- Checkbox (for select all)
- **공린코드** (Product Code)
- **판매채널 / 상품 별다** (Sales Channel / Product Type)
- **이미지** (Image)
- **상품명<br/>분류<br/>보관된 번호** (Product Name<br/>Category<br/>Storage Number)
- **공식제목/공식수** (Official Title/Official Count)
- **판매자** (Seller)
- **판매가<br/>판매상가<br/>도매가** (Selling Price<br/>Sale Price<br/>Wholesale Price)
- **가능** (Availability)
- **동등외날<br/>수정날자<br/>삭제일날자** (Registration Date<br/>Edit Date<br/>Delete Date)

### Sample Product Entries

All entries share similar structure. Here are the first few rows:

**Row 1 (ID: 9967)**:
- Checkbox: ☐
- Code: 23908344
- Channel Badge: (lcnine logo indicator)
- Image: Two dark bottles (skincare products)
- Product Name: **디물 N 노이안트 미다로에 페라 밤별 14ml 2종** (blue hyperlink)
  - Subtitle: 카테고리 : 다칸 > 페로철
  - Badge: 다칸
- Official: 다칸 / 2
- Seller: 총국
- Price:
  - 12,000
  - 6,000 (in red)
  - 0
- Status: ⚡ 재판입 (Re-entry) with 재판되입 (teal text)
- Dates:
  - 2025-06-27 10:14
  - 2025-06-27 10:24

**Row 2 (ID: 9966)**:
- Code: 23908344
- Channel Badge: (logo indicator)
- Image: Two dark bottles
- Product Name: **디물 N 노이안트 미다로에 페라 밤별 14ml 2종** (blue hyperlink)
- Official: 다칸 / 2
- Seller: 한국
- Price: 12,000 / 6,000 (red) / 0
- Status: ⚡ 재고마대 (teal)
- Same dates

**Row 3 (ID: 9965)**:
- Code: 23908344
- Channel Badge: (logo)
- Image: Blue bottle product
- Product Name: **스칼로라 모칸 모어대대 클로대로 15ml** (blue hyperlink)
- Subtitle: 카테고리 : 페로철
- Badge: 다칸대전
- Official: 다칸대전
- Seller: 총국
- Price: 20,000 / 12,000 / 0
- Status: ⚡ 재판입 with 재판되입 (teal)
- Same date pattern

**Row 4 (ID: 9964)**:
- Image: Three red/pink nail polish bottles
- Product Name: **VIEW GEL 밤별 모별 밤별 모별 밤별 10ml** (blue hyperlink)
- Subtitle: 카테고리 : 페로철
- Badge: 다칸
- Official: 다칸 / 3
- Seller: 한국
- Price: 12,000 / 6,000 (red) / 0
- Status: ⚡ 재판입 with 재판되입 (teal)

**Row 5 (ID: 9963)**:
- Image: Two dark bottles
- Product Name: **디물 N 노이안트 미다로에 페라 밤별 14ml 2종**
- Official: 다칸 / 2
- Seller: 한국
- Price: 12,000 / 6,000 (red) / 0
- Status: ⚡ 재판입 with 재판되입 (teal)

**Row 6 (ID: 9962)**:
- Image: Product with mountain/landscape image
- Product Name: **NANU 나노 노열물 클로철 모칸다 밤대별 스밤별 70g 나노.대정대대** (blue hyperlink)
- Subtitle: 카테고리 : 모열철
- Badge: 다칸대전
- Official: 다칸대전
- Seller: 한국
- Price: 12,000 / 6,000 / 0
- Status: ⚡ 재고마대 (teal)

**Row 7 (ID: 9961)**:
- Image: Gray/silver clothing item
- Product Name: **카물 흘 페다스 모 밤열열** (blue hyperlink)
- Subtitle: 카테고리 : 페열철
- Badge: 레어칸
- Official: 레어칸
- Seller: 총국
- Price: 12,000 / 6,000 / 0
- Status: ⚡ 재판입 with 재판되입 (teal)

**Rows 8-11**: Similar pattern continues with products showing:
- Code: 23908344
- Various product images (bottles, items)
- Product names in blue hyperlinks
- Categories and badges
- Seller: 한국 or 총국
- Consistent pricing: 12,000 / 6,000 / 0
- Status: ⚡ 재판입 with 재판되입 (teal)
- Same date pattern

**Pagination**:
- Bottom center: "페이지번호" (Page number)

## Right Panel: Help/Info Sections

### 상품 목록 (Product List)

**상품 조회 및 수정** (Product Search and Edit)
등록된 상품 목록에서 직접 수정하시거나, 검색조건으로 상품명 입력 후 조회하여 수정합니다.
또한, 판매 중인 상품, 대기 중인 상품, 별피 중인 상품 등으로 상품을 조회할 수 있습니다.

**필터 select box** (Filter Select Box)
선별별에로 다별별 선택별 수별니다.

**상품 분류 select box** (Product Category Select Box)
카테고리 선별에서 직접 상품관별매리디름별에 대별를 선별할 수 있습니다.

**검색별별** (Search Condition)
개별 별별칸별에로 검새 선별별별별 설별에는는
상품별 별별칸별다 먹어 별별니다.

**선택상별 select box** (Selected Product Select Box)
text content describing selection box functionality

**선택 상별 일괄설정** (Batch Settings for Selected Products)
선택 상별별 별별로 별별 상별 디물 select box별의 별별별 상별별 일관별별 별별 수 있 습니다.

**공린코드** (Product Code)
공린코드 별별 = 별별칸별별별로 별별별 설별별가 코드+상 파리코드 조별별까로 코별니다
별 코별코드를 수별별 수 있습니다.

**상품별** (Products)
별 상품별별 별별별 / 상별별 / 상별별별
제별별 다상별별별리 상별 별별별별에서 수정 가능별 상별별 / 스크 가별별로 일별별별별 별별 상별로 별별별별로 별별별 별별로 일별 수 있습니다.

### 매칭대기 리스트 (Matching Wait List)

**제고상품별과 연동이 안된 상품 리스트** (List of Products Not Linked to Inventory System)

상품별 상별매대별 다이 별코별별어매별대다 같은 상품 리스트를 별별대로 별별다는 별별다
앞니다. 주별코대를 별별을 수 있으며 다 별별별별 매별대별까로는 주별별 별별가로 가로한 시별로 별별대
만약니다. 연대 상물 상별 상 다 일별별별로 시 가별 별별 별별별 수별별로 별로 다 별별별별가를 별
할니 상품별별 상품니다.

**예외** (Exception)
앞별 상별별별다 일별별니다 (상별)

**가능 별고 매별** (Possible Inventory Match)
재별 수별별코를 별별다 별코 매별다별 별별별 별별로 설별별니다.

**중요 노티스** (Important Notice)
Text in red/orange:
- (Important note content - partially visible)

## Features and Interactions

### Search and Filter Capabilities
- **Time period filtering**: Various date range options
- **Custom date range**: Calendar pickers
- **Category filtering**: Multiple dropdown selections
- **Keyword search**: By product code, name, etc.
- **Status filtering**: On sale, waiting, etc.
- **Store availability**: Filter by store presence
- **Quick filter buttons**: Pre-configured filter sets

### Bulk Actions
- **Multi-select**: Checkboxes for each product
- **Bulk download**: Export selected products
- **Bulk copy**: Duplicate products
- **Bulk management**: Batch operations dropdown
- **Sales management**: Bulk pricing/status changes

### Table Features
- **Sortable columns**: Click headers to sort
- **Product images**: Visual thumbnails
- **Clickable names**: Link to product detail page
- **Status indicators**: Icons and badges
- **Price display**: Multiple price types with strikethrough
- **Date tracking**: Registration, edit dates
- **Seller information**: Source attribution
- **Category breadcrumbs**: Hierarchical category display

### Product Status Indicators
- **Re-entry status** (⚡ 재판입): Lightning bolt icon
- **Stock status** (재판되입/재고마대): Teal text badges
- **Price highlights**: Red text for sale prices
- **Category badges**: Colored tags for product types

## Color Scheme
- **Primary**: Dark navy blue for sidebar
- **Active state**: Bright blue for selected items and hyperlinks
- **Alert**: Pink/red banner for urgent notifications
- **Action buttons**: Orange for primary actions
- **Status badges**: Teal for stock status
- **Price highlights**: Red for discounted prices
- **Category badges**: Various colors for different categories
- **Background**: White/light gray for content, light pink for alternating rows
- **Icons**: Lightning bolt for re-entry status

## Data Display Patterns
- **Structured table**: Multi-column layout with fixed headers
- **Inline images**: Product thumbnails in table
- **Badge system**: Visual tags for categories, status, and features
- **Multi-line cells**: Product name with category and code
- **Date formatting**: YYYY-MM-DD HH:MM
- **Price formatting**: Comma-separated thousands
- **Status icons**: Visual indicators for product state
- **Pagination controls**: Navigate large result sets
- **Bulk selection**: Checkboxes for multi-select
- **Hierarchical categories**: Breadcrumb-style category paths

## Use Cases
1. **Product management**: View and edit all products
2. **Inventory check**: Monitor stock levels and status
3. **Bulk operations**: Update multiple products at once
4. **Search and filter**: Find specific products quickly
5. **Approval workflow**: Handle pending products (150 waiting)
6. **Sales monitoring**: Track pricing and availability
7. **Data export**: Download product lists for analysis
8. **Category management**: View products by category
9. **Seller tracking**: Monitor products by seller/source
