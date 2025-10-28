# CS Question Management Page (문의 관리)

## Overview
This is a customer service question/inquiry management interface for the LCNINE platform. The page provides functionality to create, filter, search, and manage customer inquiries with detailed tracking and response capabilities.

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

## Left Sidebar Navigation (Dark Blue/Navy Background)
**Section Header**: 이례상

**Sub-navigation Menu** with indent levels:
- **실시간 제대료** (Real-time Materials) - collapsible section
- **CS (세팅)** (CS Settings) - highlighted/active
  - **반품 & 교환 관리** (Return & Exchange Management)
  - **리뷰 관리** (Review Management)
  - **문의 관리** (Inquiry Management) - currently active (highlighted in blue)
  - **자사 상품 (온라인)** (Internal Products - Online) - in gray text

## Breadcrumb Navigation
- 홈 (Home) > 제고/상품 (Inventory/Product) > 받구 (Warehouse) > 받주위스드 조회 (Warehouse Query)

## Main Content Area

### Filter Section

**Primary Filters (Top Row):**
- **일자** (Date): Dropdown showing "받구 상태" (Warehouse Status)
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

**Secondary Filters (Middle Row):**
- **검색항목** (Search Items): Dropdown showing "등록 상태" (Registration Status)
- Empty text field for search input

**Tertiary Filters (Bottom Row):**
- **선택사항** (Selection Options): Two dropdowns
  - First: "받구 담당자 신청" (Warehouse Manager Application)
  - Second: "받주지 상태" (Warehouse Status)

**Search Button**: Large orange button labeled "검색" (Search)

### Results Section

**Result Summary**:
- "총 3개" (Total 3 items)
- Buttons:
  - "엑셀 다운로드" (Excel Download)
  - "신규 작성" (New Entry)
- "상품 작성 리스드" (Product Entry List) button (top-right)

### Inquiry Creation Modal (문의 조회)

**Badge**: "NEW" in blue pill shape

**Numbered Step Indicator**: Shows "1" in orange circle with "문의 주청" (Inquiry Request) label

**Form Fields:**

**분양일** (Assignment Date):
- Date range: 2021-09-01 to 2022-03-22
- Date pickers with calendar icons

**오드마크** (Order Mark):
- Two dropdowns:
  - Left: "도화 교겸" (Drawing Check)
  - Right: "도화가 이이다" (Drawing ID)

**최종 작용 선택** (Final Action Selection):
- Radio buttons:
  - 조회 (Search) [selected]
  - 도화 수습 (Drawing Training)
  - 도화 실의 (Drawing Review)

**선택** (Selection):
- Radio buttons:
  - 조회 (Search) [selected]
  - 도화 대기 (Drawing Wait)
  - 도화 완료 (Drawing Complete)

**Action Buttons**:
- Numbered indicator "2" in orange circle
- "완료" (Complete) - blue button
- "조기문" (Early Gate) - white/gray button

### Inquiry List Table

**Numbered Step Indicator**: Shows "3" in orange circle with "조석 작성" (Morning Entry) label

**Table Headers:**
- Checkbox column (for selection)
- **순번** (Order Number)
- **분양일** (Assignment Date) with timestamp
- **오스망** (OS Network)
- **오의명** (Inquiry Name)
- **제목** (Subject/Title)
- **내용** (Content)
- **첨부상명** (Attached File Name)
- **첨부물시** (Attachment View)
- **최종도망** (Final Network)
- **도화** (Drawing)

**Sample Data Rows (4 visible entries):**

**Row 1:**
- Number: 40
- Date: 2022-01-30, 18:25:13
- OS: 품명 (Product Name)
- Inquiry: firsttr
- Subject: -
- Content: 1개가격이 오빈제뷰도 없고 선도 옷도와 경개가 주도명 관련 없는 인상한 문장 (Long inquiry text about pricing and products)
- Attachments: 도화대기 (Drawing Wait)
- Status: 성공 (Success)
- Actions: Two buttons - "도화하기" (Draw) and "조회로그" (View Log)

**Row 2:**
- Number: 39
- Date: 2022-01-25, 21:42:17
- OS: 품명
- Inquiry: firsttr
- Subject: -
- Content: 물고 상영도 물그도내술 실호도마 다른 슈기를 도사 초도도스 (Long inquiry text)
- Attachments: 도화대기
- Status: 성공
- Actions: Two buttons

**Row 3:**
- Number: 38
- Date: 2022-01-24, 13:35:02
- OS: 품명
- Inquiry: firsttr
- Subject: -
- Content: 테스드를 온의 (Short test inquiry)
- Attachments: 도화대기
- Status: 성공
- Actions: Two buttons

**Row 4:**
- Number: 37
- Date: 2022-01-19, 10:55:16
- OS: 품명
- Inquiry: firsttr
- Subject: -
- Content: 킬거도도노드드가 실수오길 주영도 오도드노 노여오나선교오 (Long inquiry text)
- Attachments: 도화대기
- Status: 성공
- Actions: Two buttons

## Color Scheme
- **Left Sidebar**: Dark navy blue (#1a1f4d range) background
- **Active Menu Item**: Bright blue (#3a7fff range) highlight
- **Primary Action**: Orange (#ff9500 range) for buttons and numbered indicators
- **Secondary Action**: Blue (#3a7fff) for buttons
- **Background**: White for main content, light gray for alternating rows
- **Text**: Dark gray/black for primary text, lighter gray for secondary
- **Badges**: Blue for "NEW" indicator
- **Borders**: Light gray (#e0e0e0) for table cells and form fields

## Interaction Elements
- Radio button groups for filter selection
- Dropdown menus for category selection
- Date pickers with calendar icons and clear buttons (X)
- Checkboxes for row selection in table
- Action buttons for each row ("도화하기", "조회로그")
- Modal/dialog box for inquiry creation
- Collapsible sidebar navigation
- Excel download functionality
- New entry creation button

## Data Format Examples
- Dates: YYYY-MM-DD format (2022-01-30)
- Timestamps: HH:MM:SS format (18:25:13)
- Combined: YYYY-MM-DD, HH:MM:SS (2022-01-30, 18:25:13)
- Row numbers: Sequential integers (40, 39, 38, 37)

## Functional Workflow
The numbered circles (1, 2, 3) indicate a three-step workflow:
1. **Step 1**: Create inquiry request with date range and order mark selection
2. **Step 2**: Complete or cancel the action
3. **Step 3**: View and manage the inquiry list with filtering and action capabilities

## Responsive Elements
- The page appears to use a fixed sidebar with scrollable main content
- Table has horizontal scroll capability for many columns
- Modal overlays center on the page
- Form fields are organized in a structured grid layout
