# Dashboard (대시보드)

## Overview
The dashboard page provides a comprehensive overview of store operations, sales metrics, and analytics. It features a dark blue left sidebar navigation with multiple data visualization panels in the main content area.

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
Dark blue background with white text, currently showing "자사몰 관리" (Company Mall Management) section:

**Main Menu Items**:
- 이전원 (with home icon) - appears to be user/account section
- 관리구역 (Management Area) label

**자사몰 관리 Submenu** (highlighted):
- 상품 관리 (Product Management)
- **대시보드** (Dashboard) - Currently active in blue
- 상품 목록 (Product List)
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
홈 > 자사몰 관리 > 상품관리 > 대시보드

## Main Content Panels

### 1. 오늘의 현황 (Today's Status)
Grid of status cards showing key metrics:

- **상품 준비중** (Products in Preparation): 0
- **배송 준비중** (Shipping Preparation): 65
- **배송중** (In Delivery): 265
- **품절** (Out of Stock): 1 (highlighted in pink/red)
- **미마곤문** (Unanswered): 5
- **취소신청** (Cancellation Request): 1 (highlighted in pink)
- **교환신청** (Exchange Request): 1 (highlighted in pink)
- **반품신청** (Return Request): 1 (highlighted in pink)
- **문의** (Inquiry): 5

### 2. 오늘의 순매출 현황 (Today's Net Sales Status)
Large number display showing: **764,190**

Details:
- **공제금액** (Deduction Amount): 764,190
- **환불금액** (Refund Amount): 0

### 3. 결제수단 (Payment Methods)
Vertical bar chart showing payment distribution:
- **일반결제** (General Payment): ~400
- **다윌결제** (?) : ~500 (black bar - highest)
- **지도결제** (?) : ~550 (blue bar - highest)
- **적립금** (Points): ~350 (green bar)

Y-axis scale: 0 to 600
X-axis labels show payment method names

### 4. 일별 매출 현황 (Daily Sales Status)
Bar chart showing sales over time:
- X-axis: Dates (09-01 through 09-01, showing a week's worth of data)
- Y-axis: Scale from 0 to 30K
- Bars show varying heights with peaks around 30K on certain dates

### 5. 기간별 매출 (Sales by Period)
Table showing sales data with three columns:
- **주문** (Orders) - marked with blue dot
- **결제** (Payment) - marked with pink dot
- **환불** (Refund) - marked with purple dot

Data rows:
- **09월 07일**: 4,641,710원 (39건) | 2,782,010원 (37건) | 214,100원 (2건)
- **09월 08일**: 6,725,760원 (56건) | 4,991,080원 (59건) | 85,350원 (5건)
- **09월 09일** (marked with blue "오늘" today badge): 1,059,170원 (9건) | 764,190원 (9건) | 0원 (0건)
- **최근 7일 평균** (Recent 7 days average): 6,129,621원 (52건) | 4,351,190원 (52건) | 148,714원 (3건)
- **최근 7일 합계** (Recent 7 days total): 42,907,350원 (363건) | 30,458,330원 (361건) | 1,041,000원 (20건)
- **최근 30일 평균** (Recent 30 days average): 5,310,951원 (47건) | 3,810,767원 (46건) | 148,152원 (3건)
- **최근 30일 합계** (Recent 30 days total): 159,328,530원 (1,396건) | 114,323,000원 (1,384건) | 4,444,550원 (92건)

### 6. 상위 TOP 5 상품 (Top 5 Products)
Donut chart showing geographical distribution:
- **United States**: 52.1% (black segment - largest)
- **Canada**: 22.8% (gray segment)
- **Mexico**: 13.9% (light blue segment)
- **Other**: 11.2% (green/light segments)

The chart uses a color scheme of black, gray, blue, light blue, and green.

## Color Scheme
- **Primary**: Dark navy blue (#1E1B4B or similar) for sidebar
- **Active state**: Bright blue for selected menu items
- **Alert/Warning**: Pink/red for items requiring attention (out of stock, requests)
- **Neutral**: Light gray backgrounds for content panels
- **Data visualization**: Blue, black, green, pink for charts and graphs

## Data Display Patterns
- Large numbers for key metrics
- Small cards with labels and values
- Bar charts for comparative data
- Donut chart for proportional data
- Tables with multiple columns for detailed time-series data
- Color-coded indicators for different data types (orders, payments, refunds)
