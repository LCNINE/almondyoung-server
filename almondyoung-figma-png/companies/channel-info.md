# Channel Info - Design Specification

This document describes the channel information management page (가맹처 관리 - 일수처/채널) showing a comprehensive view of sales channels with filtering and management capabilities.

## Page Header

### Top Navigation Bar
- **Left Section**: Browser tabs showing "Google Chrome"
- **Center**: URL bar displaying "https://www.google.com/chrome/"
- **Right Section**: Browser controls (bookmark, profile icon, menu)

### Company/Account Info Bar
- **Left**:
  - "일수처" label
  - Green status indicator with "사용중" (In Use) badge
- **Center-Left**: "아몬드영"
- **Center**: "50706"
- **Center-Right**: Password dots (••••••••)
- **Right**:
  - "API 인증키 수정" (Edit API Key) button - white with border
  - "수정" (Edit) button - white with border

## Main Navigation

### Application Header
**LCNINE** logo/brand on the left

### Top Navigation Tabs
Horizontal menu with icons and labels:
1. 회사/조직 (Company/Organization) - user icon
2. 가맹처관리 (Channel Management) - store icon (active/selected - blue)
3. 주문/출고관리 (Order/Outbound Management) - clipboard icon
4. 재고/출고 관리 (Inventory/Stock Management) - box icon
5. CIS - search icon
6. 판매 / 통계 (Sales / Statistics) - chart icon
7. 자사몰 관리 (Own Mall Management) - edit icon
8. 명예의 전당 (Hall of Fame) - trophy icon

### Secondary Navigation
Located below main tabs:
- Dark purple sidebar indicator showing "가맹처관리" is active
- Home icon and breadcrumb: 홈 > 가맹처 관리 > 일수 일자 관리

## Left Sidebar Navigation

**가맹처 관리** (Channel Management) section with menu items:
- **지출 일자 관리** (Expense Date Management) - white background (active)
- **일수처관리** (Daily Channel Management)
- **고객관리** (Customer Management)
- **회원 조회** (Member Inquiry)
- **단골리스트** (Regular Customer List)
- **환매리스트** (Buyback List)

## Main Content Area

### Filter Section
Three dropdown filters in a row:
1. **판매처 분류 선택** (Select Channel Category) - dropdown
2. **판매처 이름 선택** (Select Channel Name) - dropdown
3. **판매처 분류 검색** (Search Channel Category) - search field with "검색 및 선택 검색" button (orange)

### Data Table

#### Table Headers (Light blue background)
| Column | Description |
|--------|-------------|
| 판매처 분류 (Channel Category) | Category classification |
| 판매처 이름 (Channel Name) | Channel name with status indicator |
| 판매채널 (Sales Channel) | Channel identifier |
| 로그인 아이디 (Shop ID) | Login credentials |
| 비밀번호 / OPT 정보번호 (Password / OTP Info) | Security information |
| API 인증키 (API Key) | API authentication |
| 기능 (Function) | Action buttons |

#### Table Rows (Sample Data)

**Row 1**
- Category: 일수처
- Name: (icon placeholder with "------")
- Channel: 아몬드영
- Login ID: -
- Password: -
- API: -
- Action: 수정 (Edit) button

**Row 2**
- Category: 일수처
- Name: Green indicator "사용중" (In Use)
- Channel: 아몬드영(와이하임)
- Login ID: ncp_hgprew_01
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 3**
- Category: 일수처
- Name: Green indicator "사용중" (In Use)
- Channel: 아웃몰
- Login ID: ncp_hldsk_01
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 4**
- Category: 일수처
- Name: Red indicator "미연동" (Not Connected) with Shopee logo
- Channel: 아몬드영(쇼핑)
- Login ID: bc098
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Rows 5-8** (Auction/경매 channels)
- Category: 일수처
- Name: Auction icon with "미연동" (Not Connected)
- Channels:
  - ★터프원
  - ★아이템
  - ★CG
  - ★정주년
- All showing "-" for credentials
- Action: 수정 (Edit) button

**Rows 9-14** (Star/별 marked channels)
- Category: 일수처
- Name: Yellow star icon with "별" (Star)
- Channels:
  - *자은도업*
  - *제품공유*
  - *제우공구*
  - *주문관리공구*
  - *블링*
  - *시러스공구*
- All showing "-" for credentials
- Action: 수정 (Edit) button

**Row 15**
- Category: 고객
- Name: Green indicator "사용중" (In Use)
- Channel: 플렉싱크(와이하임)
- Login ID: ncp_bdwdk_01
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 16**
- Category: 고객
- Name: Green indicator "사용중" (In Use)
- Channel: 허명용(신드라이브001)
- Login ID: ncp_hdbddk_01
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 17**
- Category: 고객
- Name: Red indicator "미연동" (Not Connected) with Shopee logo
- Channel: 플렉싱크(쇼핑)
- Login ID: biulixbrrea
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 18**
- Category: 고객
- Name: Red indicator "미연동" (Not Connected) with Shopee logo
- Channel: 허명용 신드라이브)
- Login ID: weier_u_day
- Password: ••••••••
- API: "API 인증키 수정" button
- Action: 수정 (Edit) button

**Row 19**
- Category: 고객
- Name: Yellow star icon with "별" (Star)
- Channel: 오일그래버라카(리라)
- Login ID: -
- Password: -
- API: -
- Action: 수정 (Edit) button

## Right Sidebar Panel - 채널정보 관리 (Channel Information Management)

### Header
**채널정보 관리** with close button (X) in top-right

### Information Section
**상품을 재널별로 판매등록 하는 페이지**
(Page for registering products for sale by channel)

Text in gray:
판매처별 회원 및 일출별

### Details (Red warning text box with white background)

**판매처 분류**
- Label: 일수처 / 3개

**판매처 이름례**
- Text: "상품몰, 거래, 판매채널을 통 직접이 없이서는 일출 경영"

**판매처 정보 관리**
- Text: "판매처정보를 관리 (주시, 사업자정보 는 눔은 편입니다."

### 중요 노트스 (Important Notes) - Pink background alert box
- 판매처별로 가종별 반영 중 주의사항
- 판매처별로 설백별도 정보 성격 판매처 계약서에 대해 설명할 사실은 가능합니다.
- 가종 판매처정보를 수정할 수 이삽니다.
- 반영노력 때는 공개여부로 모여 주 경쟁 통 공개여로 추 이삽니다.

**판매처 분류번호** button (white/gray background)
**추가** button (blue background) below

### Distribution Section
**분류명** | **판매처 등록수** | **연계**

**디자인 이슈링** with pencil icon | 0개 | 연계 button (red border)
**패드 디자이너** with pencil icon | 0개 | 연계 button (red border)

## Design Specifications

### Colors
- **Primary Action**: Orange (#FF8C00)
- **Secondary Action**: Blue (#4A90E2)
- **Success/Active**: Green (#00C853)
- **Warning/Inactive**: Red (#F44336)
- **Neutral**: Yellow/Gold star icons
- **Background**: White, Light Blue (table headers), Light Gray (sidebar)
- **Text**: Dark gray/black for primary, gray for secondary

### Status Indicators
- **사용중 (In Use)**: Green circle with checkmark
- **미연동 (Not Connected)**: Red circle with platform logo
- **별 (Star)**: Yellow star icon
- **미연동 auction**: Red icon with auction logo

### Typography
- **Page Title**: Bold, large
- **Table Headers**: Medium weight, uppercase
- **Table Data**: Regular weight
- **Buttons**: Medium weight
- **Sidebar Text**: Regular with gray for descriptions

### Interactive Elements
- **Edit Buttons (수정)**: White with gray border
- **API Key Buttons**: White with gray border
- **Search Button**: Orange with white text
- **Connection Buttons (연계)**: White with red border
- **Add Button (추가)**: Blue with white text
- **Dropdown menus**: White with down arrow indicator

### Layout
- **Fixed Left Sidebar**: Dark purple background with white text
- **Main Content**: White background with table
- **Right Sidebar**: White with close button, collapsible panel
- **Table**: Full-width with horizontal scroll if needed
- **Responsive grid**: Filters in horizontal row

### Icons & Visual Elements
- Platform logos (Shopee, Auction)
- Status indicators (colored circles)
- Star icons for special designations
- Pencil icons for edit actions
- Lock/security icons for password fields

### Password Display
- Masked with dots (••••••••)
- Consistent masking across all rows
