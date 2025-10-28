# Customer Home (회원정보조회 - 홈) - Design Specification

This document describes the customer home/overview page showing basic information, order history, and quick access to customer management features.

## Page Header

### Browser Tab
- **Title**: "회원정보조회 - Chrome"
- **Close Button**: X icon in top-right corner

### Modal Title Bar
- **Background**: Dark navy blue (#1F1B3D)
- **Title**: "회원정보조회" (Member Information Inquiry) - white text, center-aligned

## Left Sidebar - Customer Summary

### Customer Header
**홍길동** (Hong Gildong)
- **Customer ID**: 44351968388@K
- **Status Indicator**: Green checkmark icon

**Member Type Badge**
- Yellow star icon with "멤버십 회원" (Membership Member)

**Location**: "반영구 · 서울 · 3년차" (Semi-permanent · Seoul · 3rd year)

**Registration Date**: "최근방문일 : 2025-09-12" (Last visit date)

### Social Media Links
Four icon buttons in a row:
- **Naver**: Green icon
- **Facebook**: Blue icon
- **Instagram**: Pink/purple gradient icon
- **Naver Line**: Green icon

### Action Button
- **"디업닙터"** button - gray background, full width

### Contact Information
| Icon | Label | Value |
|------|-------|-------|
| Phone icon | 휴대폰 (Mobile) | 010-0000-0000 |
| Email icon | Email | giangbangan... (truncated) |

### Navigation Menu
Vertical menu with items:
- **홈** (Home) - **ACTIVE** - highlighted in light yellow/cream background
- **회원 상세정보** (Member Details)
- **주문내역** (Order History)
- **문의내역** (Inquiry History)
- **적립금/쿠폰** (Points/Coupons)
- **장바구니 정보** (Shopping Cart Info)
- **메시지 발송내역** (Message Sending History)

## Main Content Area - Top Section

### Action Buttons (Top Right)
Two buttons aligned to the right:
1. **블랙리스트 설정** (Blacklist Settings) - white with red/pink icon
2. **단골리스트 설정** (Regular Customer List Settings) - white with yellow crown icon

### Section 1: 기본정보 (Basic Information)

**Section Header**
- Person icon with "기본정보" label

**Information Grid - Left Column**

| Icon | Field | Value |
|------|-------|-------|
| ID icon | 아이디 (ID) | 44351968388@K |
| Profile icon | 이름 (Name) | 홍길동 |
| Phone icon | 휴대폰 (Mobile) | 010-0000-0000 |
| Phone icon | 일반전화 (Phone) | 010-0000-0000 |
| Email icon | Email | giangbangangh@gmail.com |
| Location icon | 주소 (Address) | [11820] 경기 의정부시 동일로 747번길 61 (금오동) 2층 디업닙터 |

**Information Grid - Right Column**

| Icon | Field | Value |
|------|-------|-------|
| Badge icon | 회원등급 (Member Grade) | 멤버십 회원 |
| Money icon | 총 실결제 금액 (Total Payment Amount) | 456,000 |
| Money icon | 적립금 (Points) | 3,200 |
| Badge icon | 인증 (Certification) | 사업자 인증 |

### Memo Section (Right Side)

**메모** (Memo)
- **Header**: "메모" with underline
- **Content Area**:
  - Text: "내용 없음" (No content)
  - Large white text box for memo entry
  - Multiple lines available

## Main Content Area - Order History Section

### Section 2: 주문정보 (Order Information)

**Section Header**
- "주문정보" label (bold)

**Table Headers**
| Column | Description | Sort |
|--------|-------------|------|
| 주문일 (Order Date) | Date of order | - |
| 주문번호 (Order Number) | Order ID | - |
| 실결제금액 (Actual Payment Amount) | Final payment amount | ⬍ (sortable) |
| 결제수단 (Payment Method) | Payment type | ⬍ (sortable) |
| 배송 (Delivery) | Delivery status | ⬍ (sortable) |
| 취소 (Cancel) | Cancellation status | ⬍ (sortable) |
| 교환 (Exchange) | Exchange status | ⬍ (sortable) |
| 반품 (Return) | Return status | ⬍ (sortable) |

**Sample Data Rows (5 rows shown)**

| Order Date | Order Number | Payment Amount | Payment Method | Delivery | Cancel | Exchange | Return |
|------------|--------------|----------------|----------------|----------|--------|----------|--------|
| 2025-08-20 | 20250820-2323498 | 25,490 | 카드 (Card) | 배송중 (In Delivery) | 없음 (None) | 없음 (None) | 없음 (None) |
| 2025-08-20 | 20250820-2323498 | 25,490 | 카드<br>적립금 (Card + Points) | 배송중 (In Delivery) | 없음 (None) | 없음 (None) | 없음 (None) |
| 2025-08-20 | 20250820-2323498 | 25,490 | 카드 (Card) | 배송중 (In Delivery) | 없음 (None) | 없음 (None) | 없음 (None) |
| 2025-08-20 | 20250820-2323498 | 25,490 | 카드 (Card) | 배송중 (In Delivery) | 없음 (None) | 없음 (None) | 없음 (None) |
| 2025-08-20 | 20250820-2323498 | 25,490 | 카드 (Card) | 배송중 (In Delivery) | 없음 (None) | 없음 (None) | 없음 (None) |

**Pagination**
Navigation controls at bottom:
- **|<** (First page)
- **<** (Previous page)
- **1** (Current page - blue highlight)
- **2** (Next page - gray)
- **>** (Next page)
- **>|** (Last page)

## Design Specifications

### Colors
- **Primary Navy**: #1F1B3D (modal header)
- **Primary Blue**: #4A90E2 (current pagination page)
- **Active Yellow/Cream**: #FFF8E1 (active menu item)
- **Success Green**: #00C853 (status indicator, social icons)
- **Red/Pink**: #FF4757 (blacklist icon)
- **Yellow/Gold**: #FFC107 (regular customer crown icon)
- **Text Primary**: Dark gray/black (#333333)
- **Text Secondary**: Gray (#666666)
- **Borders**: Light gray (#E0E0E0)
- **Background**: White for sections

### Typography
- **Modal Title**: Bold, white, large (18-20px)
- **Customer Name**: Bold, large (20-22px)
- **Section Headers**: Bold, medium (16-18px)
- **Table Headers**: Medium weight, dark text (13-14px)
- **Table Data**: Regular weight (13-14px)
- **Field Labels**: Regular weight, gray (13px)
- **Field Values**: Regular weight, dark text (14px)

### Layout Structure
- **Two-column layout**: Fixed left sidebar (~220px), flexible main content
- **Left Sidebar**: Customer summary with navigation
- **Main Content**: Two-column layout (basic info + memo on right)
- **Order Table**: Full-width below basic info section

### Section Cards
- **Background**: White (#FFFFFF)
- **Border**: Light gray border (1px)
- **Border Radius**: 8px
- **Padding**: 20px
- **Margin Bottom**: 16px between sections
- **Shadow**: Subtle box shadow for depth

### Button Styles

**Action Buttons (Top Right)**
- **Background**: White
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 8px 16px
- **Icon**: Colored icon on the left
- **Text**: Dark gray
- **Hover**: Light gray background

### Information Display
- **Two-column Grid**: Even spacing between columns
- **Icon Size**: 16-18px
- **Icon Color**: Gray
- **Icon Spacing**: 8px gap between icon and text
- **Field Labels**: Gray, smaller text
- **Field Values**: Dark text, slightly larger
- **Address**: Full-width field

### Memo Section
- **Position**: Right side, aligned with basic info
- **Width**: ~300px
- **Background**: White
- **Border**: Light gray (1px)
- **Min Height**: Matches basic info section height
- **Padding**: 16px
- **Text Area**: Multi-line, full width

### Table Design
- **Headers**: Light background with sort indicators
- **Sort Icons**: ⬍ symbol for sortable columns
- **Rows**: White background with light gray bottom border
- **Row Height**: 48px minimum
- **Cell Padding**: 12px
- **Text Alignment**: Left for text, right for numbers
- **Hover State**: Light gray background

### Status Display
- **배송중 (In Delivery)**: Normal text
- **없음 (None)**: Gray text
- **Would vary**: Different statuses would have different colors
  - Completed: Green
  - Cancelled: Red
  - Processing: Blue

### Pagination Controls
- **Layout**: Centered below table
- **Button Size**: 32px x 32px
- **Current Page**: Blue background with white text
- **Other Pages**: White background with gray text
- **Disabled State**: Light gray, not clickable
- **Spacing**: 4px gap between buttons

### Social Media Icons
- **Size**: 32px x 32px
- **Style**: Platform-specific colors
- **Layout**: Horizontal row with 8px gap
- **Hover**: Slight scale increase

### Navigation Menu
- **Item Height**: 40px
- **Padding**: 12px 16px
- **Active State**: Yellow/cream background
- **Hover State**: Light gray background
- **Text Color**: Dark gray, bold for active

### Data Formatting
- **Currency**: Comma-separated (25,490)
- **Dates**: YYYY-MM-DD format
- **Phone**: Hyphenated (010-0000-0000)
- **Order Numbers**: Hyphenated format
- **Postal Code**: Bracketed [11820]

### Spacing
- **Section Spacing**: 20px between sections
- **Column Gap**: 40px between left and right columns
- **Row Spacing**: 12px between information rows
- **Table Row Height**: 48px
- **Padding**: 20px inside section cards

### Interactive Elements
- **Clickable Order Numbers**: Likely links to order detail
- **Sort Headers**: Click to sort column
- **Pagination**: Click to navigate pages
- **Social Icons**: Click to open social profiles
- **Action Buttons**: Click to manage settings

### Visual Hierarchy
1. Customer name and ID (most prominent)
2. Section headers (bold, clear separation)
3. Action buttons (visible but secondary)
4. Field labels (gray, smaller)
5. Field values (dark, readable)
6. Table data (organized, scannable)
7. Status indicators (color-coded)

### Responsive Considerations
- **Sidebar**: Fixed width, scrollable
- **Main Content**: Flexible width
- **Basic Info Grid**: May stack on smaller screens
- **Memo Section**: May move below basic info on mobile
- **Table**: Horizontal scroll on smaller screens
- **Pagination**: Compact on mobile

### Empty States
- **No Orders**: Would show "주문내역이 없습니다" message
- **No Memo**: Shows "내용 없음" placeholder
- **No Address**: Would show empty field

### Loading States
- **Initial Load**: Skeleton screens for content
- **Table Loading**: Spinner or skeleton rows
- **Action Button**: Loading spinner when processing
