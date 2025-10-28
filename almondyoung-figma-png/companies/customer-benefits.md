# Customer Benefits (회원정보조회) - Design Specification

This document describes the customer benefits/points management page showing a member's point balance, transaction history, and point adjustment features.

## Page Header

### Browser Tab
- **Title**: "회원정보조회 - Chrome"
- **Close Button**: X icon in top-right corner

### Modal Title Bar
- **Background**: Dark navy blue (#1F1B3D)
- **Title**: "회원정보조회" (Member Information Inquiry) - white text, center-aligned

## Left Sidebar - Customer Information

### Customer Header
**홍길동** (Hong Gildong)
- **Customer ID**: 44351968388@K
- **Status Indicator**: Green checkmark icon

**Member Type Badge**
- Yellow star icon with "멤버십 회원" (Membership Member)

**Location**: "반영구 · 서울 · 3년차" (Semi-permanent · Seoul · 3rd year)

**Registration Date**: "최근방문일 : 2025-09-12" (Last visit date)

### Social Media Links
Three icon buttons in a row:
- **Naver**: Green icon
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
- **홈** (Home)
- **회원 상세정보** (Member Details)
- **주문내역** (Order History)
- **문의내역** (Inquiry History)
- **적립금/쿠폰** (Points/Coupons) - **ACTIVE** - highlighted in light yellow/cream background
- **장바구니 정보** (Shopping Cart Info)
- **메시지 발송내역** (Message Sending History)

## Main Content Area

### Tab Navigation
Three horizontal tabs:
1. **적립금** (Points) - **ACTIVE** - blue underline
2. **예치금** (Deposit)
3. **쿠폰** (Coupons)

### Points Summary Section

**Section Title**: "430701028@n (김다정 / 삼&드메 회원) 님의 적립금 정보"
(Points information for 430701028@n (Kim Dajeong / Sam&Deme Member))

**Points Balance Table**
| Field | Value | Field | Value |
|-------|-------|-------|-------|
| 총 적립금 (Total Points) | 1,000 | 사용된 적립금 (Used Points) | 0 |
| 사용가능 적립금 (Available Points) | **1,000** (in blue) | 미가용 적립금 (Unavailable Points) | 0 |

### Action Links
Below the balance table, three links in a row:
- **적립내역 보기** (View Points History)
- **미가용 상품적립내역 보기** (View Unavailable Product Points History)
- **미가용 회원/쿠폰적립내역 보기** (View Unavailable Member/Coupon Points History)

### Points Management Section

**Action Buttons**
Three buttons in a row:
1. **적립내역** (Points History) - white with border
2. **환기** (Exchange/Refund) - white with border
3. **불시기** (Unexpected) - white with border

**Filter Button**
- **× 삭제** (Delete/Clear) - white button with X icon and red border

### Points History Table

**Table Headers**
| Column | Description |
|--------|-------------|
| Checkbox | Selection checkbox |
| 상세내용 (Details) | Transaction details |
| 적립금 유형 (Points Type) | Type of points transaction |
| 일자 (Date) | Transaction date and time |
| 적립(+) (Credit) | Points added |
| 차감(-) (Debit) | Points deducted |
| 잔액 (Balance) | Remaining balance |
| 관련주문 (Related Order) | Associated order reference |

**Sample Row**
| Field | Value |
|-------|-------|
| Checkbox | Unchecked |
| Details | 신규가입시 적립금 부여 (Points granted upon new registration) |
| Type | (empty) |
| Date | 2025-09-15<br>08:22:02 |
| Credit | **1,000** (in blue) |
| Debit | (empty) |
| Balance | 1,000 |
| Related Order | (empty) |

**Pagination**
- Previous button: < (gray)
- Current page: **1** (blue background)
- Next button: > (gray)

## Points Adjustment Section (적립내역 추가)

**Section Title**: "적립내역 추가" (Add Points History)

**Form Fields**

| Field | Type | Placeholder/Description |
|-------|------|------------------------|
| 증감여부 (Increase/Decrease) | Dropdown | "(+)적립금 증액" (Increase Points) - with down arrow |
| 적립금 (Points Amount) | Number Input | Empty, with info icon (?) |
| 내용 (Content/Description) | Text Input | Wide text field |
| 관련주문번선택 (Related Order Selection) | Text Field | Empty field with two buttons: "검색" (Search) and "비우기" (Clear) |

**Action Button**
- **추가** (Add) - centered button with blue outline

## Design Specifications

### Colors
- **Primary Blue**: #4A90E2 (active tab underline, credit amounts, pagination)
- **Background Navy**: #1F1B3D (modal header)
- **Success Green**: #00C853 (status indicator, social icons)
- **Warning Yellow/Cream**: #FFF8E1 (active menu item background)
- **Red**: #F44336 (delete button border)
- **Text**: Dark gray/black for primary, gray for secondary
- **Borders**: Light gray (#E0E0E0)

### Typography
- **Modal Title**: Bold, white, large
- **Customer Name**: Bold, large, dark text
- **Section Headers**: Bold, medium size
- **Table Headers**: Medium weight, dark text
- **Table Data**: Regular weight
- **Labels**: Regular weight, gray

### Status Indicators
- **Active Member**: Green checkmark icon
- **Membership**: Yellow star icon
- **Social Media**: Platform-specific colored icons

### Layout Structure
- **Two-column layout**: Left sidebar (fixed width ~220px), Main content (flexible)
- **Left sidebar**: Customer info card with navigation menu
- **Main content**: Full-width with tabs and scrollable content
- **Form sections**: Clear separation with spacing

### Interactive Elements
- **Tabs**: Underline indicator for active state
- **Buttons**: Variety of styles (filled, outlined, with icons)
- **Dropdown**: Down arrow indicator
- **Checkboxes**: Standard checkboxes in table
- **Pagination**: Number buttons with prev/next arrows
- **Info icon**: Question mark icon next to points field

### Table Design
- **Headers**: Light gray or white background, medium weight text
- **Rows**: White background with light gray borders
- **Hover State**: Likely light gray background (not shown)
- **Zebra Striping**: Not used, clean white rows
- **Credit Values**: Blue text color for positive amounts
- **Alignment**: Left for text, right for numbers

### Form Design
- **Input Fields**: White background with light gray borders
- **Dropdowns**: White with down arrow indicator
- **Buttons**: Consistent padding and border radius
- **Labels**: Above or beside input fields
- **Help Icons**: Info icons for additional context

### Spacing
- **Section Padding**: Consistent spacing between sections
- **Card Spacing**: Adequate padding inside customer info card
- **Table Row Height**: Comfortable height for readability
- **Button Spacing**: Even spacing between action buttons

### Responsive Considerations
- **Sidebar**: Fixed width, scrollable if content exceeds height
- **Main Content**: Flexible width, scrollable
- **Table**: Horizontal scroll if needed for many columns
