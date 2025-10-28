# CS Return Management Page (반품 관리)

## Overview
This is a customer service return management interface for the LCNINE platform. The page provides comprehensive functionality to track, manage, and process product returns with detailed status tracking and workflow management.

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

### Filter Section

**Primary Filters (Top Row):**
- **발송일자** (Shipping Date): Label with radio button "오늘" (Today) [selected]
- **Status Radio Buttons**:
  - 오늘 (Today) [selected]
  - 어제 (Yesterday)
  - 일주일 (Week)
  - 당월 (This Month)
  - 전월 (Last Month)
  - 3개월 (3 Months)
  - 입력기간 (Custom Period)
- **Date Range Pickers**:
  - Start: 2025-06-20 (with X to clear)
  - End: 2025-06-20 (with X to clear)

**Secondary Filters (Bottom Row):**
- **판매처 선택** (Sales Channel Selection): Dropdown (empty)
- **물품명매** (Product Name): Dropdown showing "물품명매" label

**Search Button**: Orange button labeled "검색" (Search)

### Results Summary
- **총 2건** (Total 2 items) - displayed prominently

### Return List Table

**Table Headers:**
- Checkbox column (for selection)
- **CS유형** (CS Type)
- **접수일자** (Receipt Date)
- **판매처** (Sales Channel)
- **주문번호** (Order Number)
- **수령자** (Recipient)
- **상품명** (Product Name)
- **연락처** (Contact)
- **주소(물품번지)** (Address - Product Location)
- **환불운송장번호** (Refund Tracking Number)
- **발송일자** (Shipping Date)
- **신청일자** (Application Date)
- **환입여부** (Return Status)
- **택배건수** (Courier Count)
- **신청담당** (Person in Charge)

**Sample Data Rows (2 visible entries):**

**Row 1:**
- CS Type: 반품(수수료) (Return with Fee)
- Receipt Date: 2025-07-08, 오전 3:59:05
- Sales Channel: 자사몰 (Own Mall)
- Order Number: 20250707-0000202
- Recipient: 강예은 (Kang Ye-eun)
- Product Name: 레저플랜 블링 레저 #시크 레저플랜 블링 레저 시크한 상품번호 (주얀-데모, 강가-이오사)
- Contact: 010-5210-5522
- Address: 부산 서구 백 석면로 196 1동 상단
- Tracking: (52062190998525)
- Shipping Date: 2025-07-15, 7월 밤일
- Application Date: 상세 (Detail)
- Return Status: 확입예정 (Expected Return) - blue button
- Courier Count: 반퇴신청 (Return Application)
- Person in Charge: 상품도서 (Product Book)

**Row 2:**
- CS Type: 반품(수수료) (Return with Fee)
- Receipt Date: 2025-07-08, 오전 3:59:05
- Sales Channel: 자사몰
- Order Number: 20250707-0000178
- Recipient: 김사연 (Kim Sa-yeon)
- Product Name: 레저플랜 블링 레저 #시크 레저플랜 블링 레저 시크한 상품번호 (주얀-데모, 강가-이오사) [44152)]
- Contact: 010-5000-3245
- Address: 사울 강북구 테원로13길 28-11 조이필트조드 메이커아트퍼러바
- Tracking: (52062190998525)
- Shipping Date: 2025-07-15, 7월 밤일
- Application Date: 상세 (Detail)
- Return Status: 모도건 (Return)
- Courier Count: 반퇴신청 (Return Application)
- Person in Charge: 상품도서

### Pagination
- "페이지내이션" (Pagination) label visible at bottom center

## Right Side Panel (CS - 반품 관리)

**Section Title**: CS - 반품 관리 (CS - Return Management)

**Main Heading**: 반품 접수 확인 및 반품 업로 작업을 하는 페이지
(Page for confirming return receipts and uploading return work)

**Description Text:**
모든 판매채널에서 반품 접수 시 반품 접수가 수집되어야합니다.
관리자가 반품 내 조스플랜으로 연동되도 수기 모지를 해야합니다.
(All sales channels must collect return receipts when receiving returns. Administrators need to manually link to the internal plan.)

**CS유형** (CS Type):
Lists different types of returns:
- 반품 모치 (Return Collection)
- 교환 모정 (Exchange Schedule)
- 반품물수정 (Return Item Correction)
- 반품결수증 (Return Receipt)
- 교환문증 (Exchange Certificate)
- 교환문 등이 있습니다 (Exchange documents exist)

**신청정보** (Application Information):
반품/교환 내용을 물으 있습니다.
(Return/exchange details are available)

**확인여부** (Confirmation Status):
고스물제장터 "반품처리" 버튼을 눌러때 설정되어있는 상담처번 엘렙니다.
이번 고수제가 미실행가 직접으로 반송되도로 설정되어있습니다.
(When clicking the "Return Processing" button in the customer marketplace, it is set to the designated counselor. This is set to be automatically returned if the customer does not execute.)

**상태변경** (Status Change):
반품상태가 도도요소 상품 확인 후 재고 처러로 확반되어있습니다.
반품 처리가 완료되도로 후 제고에서 도와 반송정로 처리됩니다. 상태변로 반품관리로 합니다.
(The return status is updated to inventory processing after product confirmation. After the return processing is completed, it is processed as inventory and return management. Status change is done through return management.)

### Status Dropdown Menu (Visible Overlay)

**Dropdown showing multiple status options:**
- 전체 (All)
- 건초 (Investigation) - currently highlighted/selected
- 조정단계 (Adjustment Stage)
- 교환건상 (Exchange Investigation)
- 명고교로단 (Name Exchange Stage)
- 명고교로스정 (Name Exchange Schedule)
- 명정로단 (Name Stage)
- 반품단상 (Return Stage)
- 반품로스수정 (Return Schedule Correction)
- 반품로스수정확 (Return Schedule Correction Confirmation)
- 교환도로스 (Exchange Roads)
- 조정료상 (Adjustment Fee)
- 교환로로스수 (Exchange Road Number)
- 명로상 (Name Top)
- 반품결로 (Return Result)

**중요 노트스** (Important Notes) section with red warning text:
선택 시에 사례 처리 교환/반품 및 등물처별서 처리를 잘 하도록 합니다.
(When selecting, please handle case processing exchanges/returns and item processing carefully)

### Additional UI Elements

**Right-side Action Buttons** (visible at bottom):
- Multiple date stamps showing "01071353"
- Status indicators in different formats
- Labels showing "5가 재요 몸이" (5 cases need body)
- Various action codes and reference numbers

## Color Scheme
- **Primary Action Color**: Orange (#ff9500 range) for search buttons
- **Secondary Color**: Blue (#3a7fff) for status buttons and links
- **Alert/Warning Color**: Red text for important notices
- **Background**: White for main content, light gray for table rows
- **Table Headers**: Light background (#f5f5f5) with dark text
- **Status Indicators**: Blue pills for return status
- **Borders**: Light gray (#e0e0e0) for separating sections

## Interaction Elements
- Radio button groups for date filter selection
- Dropdown menus for sales channel and product name
- Date pickers with clear buttons (X)
- Checkboxes for row selection
- Clickable tracking numbers with parentheses
- Status dropdown with multiple options
- Action buttons for detailed views
- Modal/panel for additional information on the right side

## Data Format Examples
- Dates: YYYY-MM-DD format (2025-07-08)
- Timestamps: YYYY-MM-DD, 오전/오후 HH:MM:SS (2025-07-08, 오전 3:59:05)
- Shipping Dates: Month and day format (7월 밤일 - July night)
- Phone Numbers: 010-XXXX-XXXX format
- Order Numbers: YYYYMMDD-NNNNNNN format (20250707-0000202)
- Tracking Numbers: Enclosed in parentheses (52062190998525)

## Functional Features
1. **Date-based filtering** with preset ranges and custom periods
2. **Multi-criteria search** by sales channel and product name
3. **Status tracking** with detailed workflow states
4. **Return processing workflow** from receipt to completion
5. **Courier integration** with tracking number display
6. **Contact information** management for customers
7. **Address verification** for return shipments
8. **Bulk selection** via checkboxes for batch operations
9. **Detailed view** panels for individual return cases
10. **Status change management** with dropdown selection

## Workflow Indicators
The page supports a complete return management workflow:
- Receipt confirmation
- Return upload and documentation
- Status tracking through multiple stages
- Courier assignment and tracking
- Inventory processing upon return
- Final resolution and completion
