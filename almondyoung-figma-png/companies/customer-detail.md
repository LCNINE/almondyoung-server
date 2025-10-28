# Customer Detail (회원정보조회) - Design Specification

This document describes the detailed customer information page showing comprehensive member profile data, contact information, store connections, marketing consent settings, and payment information.

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
- **회원 상세정보** (Member Details) - **ACTIVE** - highlighted in light yellow/cream background
- **주문내역** (Order History)
- **문의내역** (Inquiry History)
- **적립금/쿠폰** (Points/Coupons)
- **장바구니 정보** (Shopping Cart Info)
- **메시지 발송내역** (Message Sending History)

## Main Content Area

### Section 1: 기본정보 (Basic Information)

**Section Header**
- Person icon with "기본정보" label
- **수정** (Edit) button - white with border, right-aligned

**Information Grid - Left Column**

| Icon | Field | Value |
|------|-------|-------|
| ID icon | 아이디 (ID) | 44351968388@K |
| Profile icon | 이름 (Name) | 홍길동 |
| Phone icon | 비밀번호 (Password) | "임시 비밀번호 생성" button (Generate Temporary Password) |
| Phone icon | 비밀번호 변경일 (Password Change Date) | 010-0000-0000 |
| Phone icon | 휴대폰 (Mobile) | 010-0000-0000 |
| Phone icon | 일반전화 (Phone) | 010-0000-0000 |
| Email icon | Email | giangbangan@gmail.com |
| Location icon | 주소 (Address) | [11820] 경기 의정부시 동일로 747번길 61 (금오동) 2층 디업닙터 |

**Information Grid - Right Column**

| Icon | Field | Value |
|------|-------|-------|
| Badge icon | 회원등급 (Member Grade) | 멤버십 회원 |
| Money icon | 총 실결제 금액 (Total Payment Amount) | 456,000 |
| Money icon | 적립금 (Points) | 3,200 |

---

### Section 2: 삭정보 (Store Information)

**Section Header**
- Person icon with "삭정보" label
- **수정** (Edit) button - white with border, right-aligned

**Information Grid - Left Column**

| Icon | Field | Value |
|------|-------|-------|
| Profile icon | 삭이름 (Store Name) | 디업닙터 |
| Phone icon | 일반전화 (Phone) | 010-0000-0000 |
| Person icon | 인증 (Certification) | 사업자 인증 |
| Location icon | 주소 (Address) | [11820] 경기 의정부시 동일로 747번길 61 (금오동) 2층 디업닙터 |

**Information Grid - Right Column**

| Icon | Field | Value |
|------|-------|-------|
| Instagram icon | 인스타그램 (Instagram) | @dainbeauty |
| Blog icon | 블로그 (Blog) | 456,000 |

---

### Section 3: 맞춤정보 (Customized Information)

**Section Header**
- Person icon with "맞춤정보" label
- **수정** (Edit) button - white with border, right-aligned

**Information Grid - Left Column**

| Icon | Field | Value |
|------|-------|-------|
| Location icon | 분야 (Field) | 반영구 |
| Phone icon | 업력 (Experience) | 3년차 |
| User icon | 규모 (Scale) | 2-3인 소형 |

**Information Grid - Right Column**

| Icon | Field | Value |
|------|-------|-------|
| Instagram icon | 타겟고객 (Target Customer) | 여성 |
| Blog icon | 운영유형 (Operation Type) | 착정 |

---

### Section 4: 수신동의 및 개인정보 이용 동의 (Consent for Receiving Information and Personal Information Use)

**Section Header**
- Person icon with "수신동의 및 개인정보 이용 동의" label

**Consent Table**

| Consent Item | Status | Consent Date | Withdrawal Date |
|--------------|--------|--------------|-----------------|
| SMS 수신여부<br>(SMS Reception) | 동의<br>(Agreed) | 출근동의서<br>(Consent Form) | 동의 여태 없음<br>(No withdrawal) |
| 개인정보 수집 및 이용 동의(필수)<br>(Personal Information Collection and Use Consent - Required) | 동의<br>(Agreed) | | |
| 개인정보 수집 및 이용 동의 (선택)<br>(Personal Information Collection and Use Consent - Optional) | 동의<br>(Agreed) | | |
| 마케팅 목적의 개인정보 수집 및 이용 동의(선택)<br>(Personal Information Collection for Marketing Purposes - Optional) | 동의 어태 없음<br>(No consent) | | |
| 스폰몰 기록 제3자 정보제공 동의 여부<br>(Third-party Information Provision Consent) | 동의 어태 없음<br>(No consent) | | |

---

### Section 5: 결제 정보 (Payment Information)

**Section Header**
- Person icon with "결제 정보" label
- **수정** (Edit) button - white with border, right-aligned

**Information Grid - Left Column**

| Icon | Field | Value |
|------|-------|-------|
| Card icon | 카드 (Card) | 현대카드(2939) |
| Phone icon | 계좌 (Account) | 우리은행 |

**Information Grid - Right Column**

| Icon | Field | Value |
|------|-------|-------|
| Instagram icon | 나중결제 출금일 (Later Payment Withdrawal Date) | 여성 |
| Badge icon | 정기결제일 (Regular Payment Date) | 2-3인 소형 |

## Design Specifications

### Colors
- **Primary Navy**: #1F1B3D (modal header)
- **Active Yellow/Cream**: #FFF8E1 (active menu item)
- **Success Green**: #00C853 (status indicator)
- **Text Primary**: Dark gray/black
- **Text Secondary**: Gray (#666666)
- **Borders**: Light gray (#E0E0E0)
- **Background**: White for sections, light gray for overall page
- **Button Outline**: Light gray with hover state

### Typography
- **Modal Title**: Bold, white, large (18-20px)
- **Customer Name**: Bold, large (20-22px)
- **Section Headers**: Bold, medium (16-18px)
- **Field Labels**: Regular weight, gray (13-14px)
- **Field Values**: Regular weight, dark text (14-15px)
- **Customer ID**: Medium weight, gray

### Layout Structure
- **Two-column layout**: Fixed left sidebar (~220px), flexible main content
- **Left Sidebar**: Customer summary card with navigation
- **Main Content**: Full-width scrollable sections
- **Section Cards**: White background with shadow, rounded corners
- **Grid Layout**: Two-column grid for information fields within sections

### Section Cards
- **Background**: White (#FFFFFF)
- **Border Radius**: 8px
- **Box Shadow**: Subtle shadow for depth
- **Padding**: 24px
- **Margin Bottom**: 16px between sections
- **Header**: Section title on left, edit button on right

### Icons
- **Style**: Line icons or outlined icons
- **Size**: 16-20px
- **Color**: Gray or matching the field context
- **Spacing**: 8px gap between icon and text

### Interactive Elements
- **Edit Buttons (수정)**: White with gray border, hover effect
- **Generate Password Button**: White with border
- **Navigation Menu Items**: Hover background change, active state with yellow background
- **Social Media Icons**: Colored platform icons, clickable

### Information Display
- **Field Labels**: Icon + Label in gray
- **Field Values**: Dark text, clear hierarchy
- **Two-column Grid**: Even spacing, aligned fields
- **Address Fields**: Full-width for longer content
- **Phone Numbers**: Consistent format (010-0000-0000)

### Consent Table
- **Headers**: Light gray background
- **Rows**: White background with borders
- **Status Indicators**: "동의" (Agreed) or "동의 어태 없음" (No consent)
- **Columns**: Even width distribution
- **Text Alignment**: Left for text, center for status

### Status Badges
- **Member Type**: Yellow star icon with text
- **Certification**: Badge icon with status text
- **Active Status**: Green checkmark icon

### Spacing
- **Section Spacing**: 16px between sections
- **Field Spacing**: 12px between fields within a section
- **Grid Gap**: 24px horizontal gap between columns
- **Padding**: 24px inside section cards
- **Sidebar Padding**: 16px internal padding

### Responsive Considerations
- **Sidebar**: Fixed width, scrollable if needed
- **Main Content**: Flexible width, scrollable vertically
- **Grid Columns**: Stack vertically on smaller screens
- **Table**: Horizontal scroll on smaller screens

### Data Formatting
- **Currency**: Formatted with commas (456,000)
- **Dates**: YYYY-MM-DD format (2025-09-12)
- **Phone**: Hyphenated format (010-0000-0000)
- **Postal Code**: Bracketed format [11820]
- **Card Number**: Partial display (2939)

### Visual Hierarchy
1. Customer name and ID (largest, most prominent)
2. Section headers (bold, clear separation)
3. Field labels (gray, smaller)
4. Field values (dark, readable)
5. Helper text (smallest, lightest gray)
