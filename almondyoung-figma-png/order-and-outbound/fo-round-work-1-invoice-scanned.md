# FO Round Work 1 - Invoice Scanned

## Overview
This is the first step in the picking round workflow where the invoice/order barcode has been scanned. The interface displays order details and the list of products to be picked, showing a successful scan state with order information populated.

## Page Title
"모바일" (Mobile) - displayed at the very top center

## Layout Structure

### Left Sidebar (Dark Navy Background)
**Header**
- Logo: "LCNINE"
- User section: "이0점임" with badge "클라이언 3"

**Navigation Menu**
- **주문/출고** (Orders/Outbound) section - Active/highlighted
  - 입고 제품수: 567
  - 주문수집
  - 매장 제고
  - 주문입력
  - 주문 입력(수동/자동팀)
  - 주문 입력(수동/서울팀)

  - 주문내역 목록

  - 출고
  - (선택배송) 지역별 출고
  - 주문별 승장 출력
  - 승입/출고 / 출고 관리팀 조회

### Top Navigation Bar
Horizontal tabs with icons:
- 회사/조직 (Company/Organization)
- 기본정보 (Basic Info)
- **주문/출고관리** (Order/Outbound Management) - Active (blue highlight)
- 제조&생산 관리 (Manufacturing & Production Management)
- CS
- 판매 / 통계 (Sales / Statistics)
- 지시서 관리 (Instruction Management)
- 매입/입 관리 (Purchase/Inbound Management)

### Breadcrumb Navigation
홈 > 주문/출고 > 주문수집 > 검수 발송

## Main Content Area

### Left Panel - Barcode / Scan Section

**Title**: "바코드 / 승정 스캔" (Barcode / Order Scan)

**Scan Input Field**
- Large yellow/cream colored input box with search icon button on right
- Appears to be for barcode scanning or manual entry

**Scan Results Display**

**1. 승정번호 (Order Number)**
- Display: **510478100243**
- Large, bold black text

**2. 상태 (Status)**
- Display: **준비** (Ready) - shown as blue hyperlink
- Indicates order is ready for picking

**3. 피킹라운드 관련 (Picking Round Info)**
- Label: "피킹 라운드 1회차 - 7"
- Shows this is round 1, item 7 in the picking sequence

**4. 주문정보 (Order Information)**
- **Customer Name**: 강은혜 ( 금액 : 63700 원)
- **Address**:
  - 주소:서울특별시 강진구 독살로54길 10-6 (자양동) 1동 더시브로우 (자양동 636-20)
  - Phone: hp:010-4187-6544
  - Tel: tel:010-4187-6544

### Right Panel - Product List

**Header**: "대기 목록" (Waiting List)
- Counter: "총 주문 수 : 3442건 / 총 스캔수 : 02건" (Total orders: 3442 / Total scanned: 02)

**Data Table**

Table Headers:
| 순번 | 이미지 | 상품명 | 제고 | 상품위치 | 바코드 | 주문 | 스캔 |
|-----|--------|--------|------|---------|--------|------|------|
| No. | Image | Product Name | Stock | Location | Barcode | Order | Scan |

**Row 1:**
- 순번: 1
- 이미지: [Black barcode/product icon]
- 상품명: 노모드 아이래저(출고가능)
  - Blue text link "(출고가능)" indicates available for outbound
- 제고: 28697
- 상품위치: J-02-06
- 바코드: 1113722000
- 주문: **300** (displayed in red, indicating quantity to pick)
- 스캔: **0** (displayed in blue)

**Row 2:**
- 순번: 2
- 이미지: [Black barcode/product icon]
- 상품명: 니지반 SG12 테이퍼(출고가능)
  - Blue text link "(출고가능)"
  - Red asterisk warning: "★예약/권표장 일수" (Reserved/label days)
- 제고: 836
- 상품위치: I-02-07
- 바코드: 10418920000
- 주문: **24** (displayed in red)
- 스캔: **0** (displayed in blue)

### Bottom Action Buttons

**Right-aligned buttons:**
- **검색출고** (Search Outbound) - Red/orange button with icon
- **출고내수** (Outbound Assignment) - White button with icon

## Color Scheme
- **Primary Navigation**: Dark navy (#1a1f3a)
- **Active Tab**: Blue highlight
- **User Badge**: Purple/blue pill shape
- **Scan Input**: Light yellow/cream background
- **Status Link**: Blue
- **Order Quantity**: Red text (emphasizes picking quantity)
- **Scan Count**: Blue text
- **Primary Action Button**: Red/orange (#e74c3c)
- **Secondary Button**: White with border
- **Background**: Light gray/white

## Typography
- Page title: Large, bold
- Order number: Very large, bold (510478100243)
- Section labels: Bold
- Data values: Regular weight
- Links: Blue, underlined
- Warnings: Red with asterisk

## Key Visual Indicators

### Status Indicators
- **준비** (Ready) - Blue link, indicates order is ready for picking
- **(출고가능)** - Blue text, indicates product available for outbound
- **Red asterisk (★)** - Warning indicator for special conditions

### Color Coding
- **Red numbers**: Order quantities to be picked (300, 24)
- **Blue numbers**: Current scan count (0, 0)
- **Green numbers**: Stock quantities (28697, 836)
- **Green barcode numbers**: Location barcodes

## Workflow State
This screen shows **Step 1** of the picking process:
1. Invoice/order barcode has been scanned successfully
2. Order details are displayed
3. Product list is shown with quantities needed
4. Products have NOT been scanned yet (scan count = 0)
5. Worker can now proceed to scan individual products

## Interaction Elements
- **Barcode scan input**: Large input field with search button
- **Status link**: Clickable "준비" status
- **Product name links**: Clickable "(출고가능)" availability status
- **Action buttons**: Two buttons at bottom for completing or managing the outbound process

## Data Insights
- Total system has 3442 orders in queue
- Currently 2 items scanned/processed
- Order #510478100243 contains 2 product lines
- Product 1 needs 300 units from stock of 28697
- Product 2 needs 24 units from stock of 836
- Both products are in stock and available
- Product 2 has a reservation/label warning

## Key Features
- Real-time barcode scanning
- Order information display
- Product picking list with images
- Stock quantity verification
- Location information (bin/shelf codes)
- Quantity tracking (ordered vs scanned)
- Warning indicators for special conditions
- Progress tracking (total orders and scans)
- Mobile-optimized interface for warehouse workers
