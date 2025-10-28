# CS Order Management Page (주문 관리 페이지)

## Overview
This is a comprehensive customer service order management interface for the LCNINE e-commerce platform. The page displays order information with detailed filtering, viewing, and management capabilities.

## Page Header
- **Application Name**: LCNINE (top-left corner)
- **Navigation Bar** (horizontal menu):
  - 회사/조직 (Company/Organization)
  - 거래처관리 (Client Management)
  - 주문/물고관리 (Order/Goods Management)
  - 재고&상품 관리 (Inventory & Product Management)
  - CS (Customer Service) - highlighted/active
  - 반입 / 물계 (Receiving / Logistics)
  - 자사물 관리 (Internal Goods Management)
  - 멤버십 관리 (Membership Management)

## Main Content Area

### Filter Section (Top Section)
**Row 1 - Order Information Filters:**
- **주문번호** (Order Number): Dropdown with radio buttons
  - Options: 오늘 (Today) [selected], 어제 (Yesterday), 일주일 (Week), 당월 (This Month), 전월 (Last Month), 3개월 (3 Months), 입력기간 (Custom Period)
- **Date Range Picker**: 2025-06-20 to 2025-06-20 with X buttons to clear
- **검색 버튼** (Search button): Blue toggle switch with "CS 세팅" label
- **Order ID Search**: Text field showing "민재수님:0426 202507219801343.1"

**Row 2 - Additional Filters:**
- **판매처 선택** (Sales Channel Selection): Dropdown (empty)
- **품목명** (Product Name): Dropdown (empty)

### Order List Table
**Table Headers:**
- Checkbox column (for selection)
- **주문일자** (Order Date)
- **판매처** (Sales Channel)
- **CS** (CS Status)
- **주문자/수령자** (Orderer/Recipient)
- **연락처** (Contact)
- **주소** (Address)
- **주문 수** (Order Count)
- **묶음수** (Bundle Count)
- **합계금액** (Total Amount)
- **송장번호** (Invoice Number)
- **택배사** (Courier)
- **배송완료** (Delivery Complete)
- **반송완료** (Return Complete)

**Sample Data Rows (4 visible entries):**

**Row 1:**
- Order Date: 2025-07-21
- Seller: 자사몰 (Own Mall)
- CS: 1
- Orderer: 강북모 (with red indicator: 결제교 / 결제조)
- Contact: 010-8595-3917, 010-8595-3917
- Address: 김평동앤리더 호텔 강변로 호텔 4층 (외 피채맨이)
- Order Count: 7
- Bundle Count: 157
- Total: 193,700원
- Invoice: [52062190996520] with 배송조회 button (blue text: 안내 추가)
- Courier: 대한통운
- Delivery Status: 신청 배송완료 (2025-07-21 오후 4:39)
- Additional note: 마행량

**Row 2-4:** Similar structure with variations in data

### Right Side Panel (CS 주문 관리 페이지)
**Section Title**: CS 주문 관리 페이지

**Description Text:**
주문을 조회하고 해당 주문에 대한 CS 내용을 처리할 수 있는 페이지

Detailed explanation of system functionality including:
- CS inquiry and response management
- Status indicators for various types of issues
- Workflow descriptions

**Key Functions Listed:**
1. **기본 주문정보** (Basic Order Information)
2. **새모조 받기** (Receive Memo)
3. **상황판단** (Status Assessment)
4. **종결처리** (Case Closure)
5. **문의 노트스** (Inquiry Notes)

**중요 노트스** (Important Notes) section with red text warning about specific actions

### Bottom Section (Order Details Expansion)

**Filter Buttons:**
- 배모조 받기 (Receive Memo)
- 모음조회 (View Summary)
- 반송 추측스 (Return Tracking)
- 고객 (Customer)
- 모스 (Notes)
- 배송로그 (Delivery Log)

**Detailed Order Information Table:**
Shows expanded view with columns:
- **판매처** (Sales Channel)
- **CS** (CS Status)
- **주문번호** (Order Number)
- **상품** (Product) - including product images
- **이용자** (User)
- **수량** (Quantity)
- **금액** (Amount)
- **민행량** (Status)

**Two Sample Products Displayed:**
1. Product from 2025060900000382 with colorful product image and price 50,600원
2. Second item with different product details and checkboxes for multiple status options (예약접수, 송장입력, 상품발송)

**Action Buttons at Bottom:**
- 선택전개 (Expand Selected)
- 선층스기 (Level Action)
- 품목위드스 (Product Width)
- 발송 위드스 (Send Width)

### Additional UI Elements

**Chat/Message Section** (right side):
- Message thread showing CS communications
- User icons with timestamps
- Blue highlighted messages indicating system or user responses
- Date stamps (2025-06-22)

**Status Dropdown Menu** (visible in overlay):
Multiple status options including:
- 건초조 (Investigation)
- 건조건 (Condition)
- 이의접수 완료 (Appeal Received)
- 이의조 (Appeal Status)
- Various other status codes

## Color Scheme
- **Primary Action Color**: Orange/Yellow (#FFA500 range) for main action buttons
- **Secondary Color**: Blue for links and secondary actions
- **Alert Color**: Red for warnings and important notices
- **Background**: Light gray (#F5F5F5) for sections
- **Table Headers**: Light background with dark text
- **Status Indicators**: Various colors (red, blue, yellow) for different statuses

## Interaction Elements
- Checkboxes for row selection
- Dropdown menus for filters
- Date pickers with clear functionality
- Expandable row details
- Toggle switches
- Modal/popup panels for detailed information
- Clickable invoice numbers with tracking links
- Status badges with different colors
- Action buttons throughout the interface

## Data Format Examples
- Dates: YYYY-MM-DD format (2025-07-21)
- Phone Numbers: 010-XXXX-XXXX format
- Order IDs: Alphanumeric codes with prefixes (52062190996520)
- Amounts: Korean Won with 원 symbol
- Timestamps: YYYY-MM-DD 오전/오후 HH:MM format
