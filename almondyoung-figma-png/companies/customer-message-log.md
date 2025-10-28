# Customer Message Log (메시지 발송내역) - Design Specification

This document describes the message sending history page for customers, showing a log of KakaoTalk messages sent to a specific member.

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
- **회원 상세정보** (Member Details)
- **주문내역** (Order History)
- **문의내역** (Inquiry History)
- **적립금/쿠폰** (Points/Coupons)
- **장바구니 정보** (Shopping Cart Info)
- **메시지 발송내역** (Message Sending History) - **ACTIVE** - highlighted in light yellow/cream background

## Main Content Area

### Page Title
**메시지 발송내역** (Message Sending History)

### Tab Navigation
Two horizontal tabs:
1. **SMS** - inactive, gray text
2. **카카오톡 메시지** (KakaoTalk Message) - **ACTIVE** - blue text with blue underline

### Information Banner
Gray text information message:
"- 카카오알림톡은 완료에 최대 30일까지의 발송내역만 확인할 수 있습니다."
(KakaoTalk notification talk history can only be viewed for up to 30 days after completion)

### Search/Filter Section

**검색기간** (Search Period)

Filter controls in a horizontal row:
1. **Period Quick Select Buttons**:
   - **오늘** (Today) - white with blue border (selected)
   - **3일** (3 days) - white with gray border
   - **7일** (7 days) - white with gray border
   - **30일** (30 days) - white with gray border

2. **Date Range Pickers**:
   - **Start Date**: "2025-09-15" with calendar icon
   - **Separator**: "~" (tilde)
   - **End Date**: "2025-09-15" with calendar icon

3. **Search Button**:
   - **검색** (Search) - dark button with white text

### Results Section

**Section Title**: "메시지 발송결과" (Message Sending Results)

**Results Count**: "검색결과 1건" (Search results: 1 item)

### Results Table

**Table Headers**
| Column | Description |
|--------|-------------|
| 발송타입 (Sending Type) | Type of message sent |
| 발송일시 (Sending Date/Time) | Timestamp of message |
| 메시지 (Message) | Message content |
| 발송결과 (Sending Result) | Delivery status |

**Sample Row**
| Field | Value |
|-------|-------|
| Sending Type | 자동발송 (Automatic Sending) |
| Sending Date/Time | 2025-09-15 08:22:03 |
| Message | "회원 관련 메시지 회원 기입" (Member-related message member entry) - displayed as a link in blue |
| Sending Result | 발송성공 (Sent Successfully) |

**Pagination**
- Current page: **1** (blue background, white text)
- Centered below the table

## Design Specifications

### Colors
- **Primary Blue**: #4A90E2 (active tab, selected button, links, pagination)
- **Background Navy**: #1F1B3D (modal header)
- **Active Yellow/Cream**: #FFF8E1 (active menu item)
- **Success Green**: #00C853 (status indicator)
- **Text Primary**: Dark gray/black (#333333)
- **Text Secondary**: Gray (#666666)
- **Borders**: Light gray (#E0E0E0)
- **Background**: White for content areas
- **Button Dark**: Dark gray/black for search button

### Typography
- **Modal Title**: Bold, white, large (18-20px)
- **Page Title**: Bold, dark text, large (22-24px)
- **Tab Text**: Medium weight, active tabs in blue (16px)
- **Section Headers**: Bold, medium (16-18px)
- **Table Headers**: Medium weight, dark text (14px)
- **Table Data**: Regular weight (14px)
- **Info Text**: Regular, gray (13px)
- **Links**: Blue, underlined on hover

### Layout Structure
- **Two-column layout**: Fixed left sidebar (~220px), flexible main content
- **Left Sidebar**: Customer summary with navigation
- **Main Content**: Full-width with tabs and results
- **White Background**: Clean content area

### Tab Design
- **Active Tab**: Blue text with blue bottom border (2-3px)
- **Inactive Tab**: Gray text, no border
- **Tab Container**: White background with bottom border
- **Spacing**: Even spacing between tabs

### Filter Section
- **Background**: White
- **Padding**: 16px around filter controls
- **Layout**: Horizontal flex layout
- **Spacing**: 8px gap between buttons
- **Alignment**: All controls aligned horizontally

### Button Styles

**Quick Select Buttons**
- **Selected**: White background with blue border (2px)
- **Unselected**: White background with light gray border (1px)
- **Hover**: Blue border
- **Border Radius**: 4px
- **Padding**: 8px 16px

**Search Button**
- **Background**: Dark gray/black (#2D2D2D)
- **Text**: White
- **Border Radius**: 4px
- **Padding**: 8px 24px
- **Hover**: Slightly lighter background

### Date Picker
- **Style**: Input field with calendar icon
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 8px 12px
- **Icon**: Calendar icon on the right
- **Format**: YYYY-MM-DD

### Table Design
- **Headers**: Light gray background (#F8F8F8)
- **Header Text**: Bold, dark gray
- **Rows**: White background with light gray bottom border
- **Row Hover**: Light gray background (#F9F9F9)
- **Cell Padding**: 12px
- **Text Alignment**: Left for all columns
- **Links in Table**: Blue text, underlined on hover

### Results Display
- **Results Count**: Bold text showing number of items
- **Empty State**: Would show "검색결과가 없습니다" (No search results)
- **Loading State**: Would show loading spinner

### Pagination
- **Current Page**: Blue background with white text
- **Other Pages**: White background with gray text
- **Button Size**: 32px x 32px
- **Border Radius**: 4px
- **Spacing**: Centered with margin top

### Status Indicators
- **발송성공 (Sent Successfully)**: Green text or with checkmark
- **발송실패 (Send Failed)**: Would be red text with X icon
- **대기중 (Waiting)**: Would be yellow text with clock icon

### Information Banner
- **Background**: Light gray (#F5F5F5) or transparent
- **Text Color**: Gray (#666666)
- **Font Size**: 13px
- **Padding**: 8px 0
- **Icon**: "-" bullet point

### Message Content Display
- **Type**: Clickable link
- **Color**: Blue (#4A90E2)
- **Hover**: Underline appears
- **Action**: Opens message detail modal/panel

### Spacing
- **Section Spacing**: 24px between major sections
- **Filter Elements**: 8px gap between buttons and inputs
- **Table Row Height**: 48px minimum
- **Content Padding**: 24px inside main content area
- **Sidebar Padding**: 16px internal padding

### Responsive Considerations
- **Sidebar**: Fixed width, scrollable if needed
- **Main Content**: Flexible width
- **Filter Row**: May stack on smaller screens
- **Table**: Horizontal scroll on mobile
- **Date Pickers**: Full width on mobile

### Interactive Elements
- **Tab Click**: Switches between SMS and KakaoTalk views
- **Period Buttons**: Quick select for common date ranges
- **Date Pickers**: Calendar popup for date selection
- **Message Link**: Opens detailed message view
- **Search Button**: Triggers search with selected filters
- **Pagination**: Navigate between pages of results

### Data Display
- **Date Format**: YYYY-MM-DD HH:mm:ss
- **Time Display**: 24-hour format
- **Status Text**: Clear Korean labels
- **Message Preview**: Truncated with link to full message

### Empty States
- **No Results**: "검색결과가 없습니다" message centered
- **No Data**: "발송내역이 없습니다" when no messages exist
- **Error State**: Error message with retry option

### Loading States
- **Search Loading**: Spinner or skeleton screen
- **Initial Load**: Loading indicator for table
- **Lazy Loading**: Progressive loading for large result sets
