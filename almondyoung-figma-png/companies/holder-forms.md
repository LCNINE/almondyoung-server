# Holder Forms (발주처 등록) - Design Specification

This document describes the order holder/supplier registration form with comprehensive business information collection and a detailed information panel on the right side.

## Page Header

### Browser Chrome
- **Tabs**: Two "Google Chrome" tabs
- **URL Bar**: "https://www.google.com/chrome/"
- **Browser Controls**: Navigation and profile icons

### Application Header
**LCNINE** logo/brand on the left

### Top Navigation Bar
Horizontal menu with icons:
1. 회사/조직 (Company/Organization) - user icon
2. 가맹처관리 (Channel Management) - store icon
3. 주문/출고관리 (Order/Outbound Management) - clipboard icon
4. 재고/출고 관리 (Inventory/Stock Management) - box icon
5. CIS - search icon
6. 판매 / 통계 (Sales / Statistics) - chart icon
7. 자사몰 관리 (Own Mall Management) - edit icon
8. 명예의 전당 (Hall of Fame) - trophy icon

### Breadcrumb Navigation
홈 > 가맹처 관리 > 발주처 등록

## Left Sidebar Navigation

### User Section
- **아진영** (user name)
- **로그아웃** button

### Menu
**가맹처 관리** (Channel Management)
- 판매처 관리(마켓관리) (Sales Channel Management)
- **발주처관리** (Order Management) - **ACTIVE** - blue background
- 고객관리 (Customer Management)
- 회원 조회 (Member Inquiry)
- 단골리스트 (Regular Customer List)
- 블랙리스트 (Blacklist)

## Main Form Area

### Form Title
**발주처 가입정보** (Order Holder Registration Information)
- Section marked with red square indicator

### Section 1: 발주처 가입정보 (Order Holder Registration)

| Field Label | Input Type | Additional Info | Required |
|-------------|-----------|-----------------|----------|
| 발주자명 (Order Holder Name) | Text Input | - | Yes (red indicator) |
| 주소 (Address) | Text Input | Wide field | - |
| 연락처 (Contact) | Multiple Inputs | Three fields with "-" separators | - |
| 팩스 (Fax) | Multiple Inputs | Three fields with "-" separators | - |
| 핵스코드 (Fax Code) | Multiple Inputs | Three fields with "-" separators | - |
| 종목 (Category) | Dropdown | Placeholder: "종목 선택" | - |
| 사업자등록번호 (Business Registration Number) | Text Input | - | - |
| 사업자등록증 첨부 (Business Registration Attachment) | File Upload | "파일첨부" button | - |
| 이메일 (Email) | Text Input | - | - |
| 대표자명 (Representative Name) | Text Input | - | - |
| 계좌 가능여부 (Account Availability) | Radio Buttons | ⚪ 지원가능 (Available) ⚪ 불가 (Not Available) | - |
| 주문 마감시간 (Order Deadline) | Text Input | - | - |

### Section 2: 결제정보 (Payment Information)

**Section Header**: "결제정보" with section indicator

| Field Label | Input Type |
|-------------|-----------|
| 은행명 (Bank Name) | Text Input |
| 계좌번호 (Account Number) | Text Input |
| 예금주명 (Account Holder Name) | Text Input |
| 결제방식 (Payment Method) | Text Input |

### Section 3: 기타 (Other)

**Section Header**: "기타" with section indicator

| Field Label | Input Type |
|-------------|-----------|
| 설명 (Description) | Text Input (single line) |
| 발주자메모 (Order Holder Memo) | Text Area | Large multi-line field |

### Section 4: 상품 담당자 (Product Manager)

**Section Header**: "상품 담당자" with section indicator

| Field Label | Input Type |
|-------------|-----------|
| 발주담당자 (Order Manager) | Dropdown | Placeholder: "미지정" (Not assigned) |

## Footer Action Buttons

Two buttons centered at bottom:
1. **취소** (Cancel) - white with gray border
2. **등록** (Register) - orange with white text

## Right Sidebar Information Panel

### Panel Title
**발주처 등록** (Order Holder Registration)

### Section 1: 신규 발주처 등록 (New Order Holder Registration)
Text: "신규 발주처등록"

### Section 2: 종목 분류 (Category Classification)
**Header**: "종목 분류"
**Categories List**:
- 헤어 / 네일 / 반영구 / 속눈썹 / 메이크업 / 피부 / 타투 / 종합

### Section 3: 설명 (Description)
**Header**: "설명"
**Text**: "발주에 필요한 정보"

### Section 4: 발주처 메모 (Order Holder Memo)
**Header**: "발주처 메모"
**Text**: "추가 전달사항 메모"

### Section 5: 발주 담당자 (Order Manager)
**Header**: "발주 담당자"
**Text**: "발주 담당자 지정"

### Alert Box
**Background**: Light pink/red
**Text Color**: Red
**Content**: "중요 노티스"
- 업체 배송기간 통상에 발주처 주 의는 사이트보다는 적확성을 이유

## Design Specifications

### Colors
- **Primary Orange**: #FF8C00 (register button, active indicators)
- **Primary Blue**: #4A90E2 (active menu item)
- **Background Navy**: #2C2E4A (left sidebar)
- **Alert Red**: #FF4757 (required indicators, alert box)
- **Text Primary**: Black (#333333)
- **Text Secondary**: Gray (#666666)
- **Borders**: Light gray (#E0E0E0)
- **Background**: White (#FFFFFF)
- **Panel Background**: Light gray (#F8F8F8)

### Typography
- **Page Title**: Bold, 18px
- **Section Headers**: Bold, 16px with square indicator
- **Field Labels**: Regular, 13px
- **Input Text**: Regular, 14px
- **Button Text**: Medium weight, 14px
- **Info Panel Headers**: Bold, 14px
- **Info Panel Text**: Regular, 13px

### Layout Structure
- **Fixed Left Sidebar**: 220px width, dark background
- **Main Content**: Flexible width, white background
- **Right Info Panel**: ~300px width, light gray background
- **Form Width**: Max-width with centered layout
- **Three-column Layout**: Sidebar | Form | Info Panel

### Form Design

**Form Container**
- **Background**: White
- **Padding**: 40px
- **Max Width**: 800px
- **Border Radius**: 8px
- **Box Shadow**: Subtle shadow

**Section Spacing**
- **Between Sections**: 32px
- **Between Fields**: 16px
- **Label to Input**: 8px
- **Section Indicator**: Red square (8px)

### Input Field Styles

**Text Inputs**
- **Background**: White
- **Border**: Light gray (1px solid)
- **Border Radius**: 4px
- **Padding**: 10px 12px
- **Font Size**: 14px
- **Focus**: Blue border (#4A90E2)
- **Placeholder**: Light gray (#AAAAAA)

**Multi-part Inputs** (Phone, Fax)
- **Three Fields**: Connected with "-" separator
- **Field Widths**: Equal or proportional
- **Spacing**: 8px gap with separator text

**Dropdown Menus**
- **Style**: Same as text input
- **Down Arrow**: Right side
- **Selected**: Dark text
- **Hover**: Light gray background

**Text Area**
- **Min Height**: 120px for memo field
- **Resize**: Vertical resize allowed
- **Scrollbar**: When content exceeds height

**File Upload**
- **Button Style**: Gray background, white text
- **Button Text**: "파일첨부" (Attach File)
- **Padding**: 8px 16px
- **Border Radius**: 4px

**Radio Buttons**
- **Size**: 16px
- **Selected**: Filled circle
- **Unselected**: Empty circle outline
- **Label Spacing**: 8px to right of button
- **Option Spacing**: 16px between options

### Required Field Indicators
- **Red Square**: ■ symbol before field label
- **Color**: Red (#FF4757)
- **Size**: 8px x 8px

### Section Headers
- **Style**: Bold, dark text
- **Indicator**: Black square ■ before text
- **Spacing**: 24px top margin, 16px bottom margin
- **Border**: Optional bottom border

### Button Styles

**Primary Button (등록)**
- **Background**: Orange (#FF8C00)
- **Text**: White, medium weight
- **Border**: None
- **Border Radius**: 4px
- **Padding**: 12px 48px
- **Shadow**: Subtle shadow
- **Hover**: Darker orange

**Secondary Button (취소)**
- **Background**: White
- **Text**: Dark gray
- **Border**: Light gray (1px)
- **Border Radius**: 4px
- **Padding**: 12px 48px
- **Hover**: Light gray background

**Button Layout**
- **Alignment**: Centered
- **Spacing**: 16px gap between buttons
- **Position**: Bottom of form with 40px margin

### Right Info Panel

**Panel Container**
- **Background**: Light gray (#F8F8F8) or white
- **Border Left**: Light gray (1px)
- **Padding**: 24px
- **Fixed Width**: ~300px
- **Height**: Full height of viewport

**Panel Sections**
- **Spacing**: 24px between sections
- **Header Style**: Bold, 14px
- **Text Style**: Regular, 13px, gray
- **Category List**: Forward slash separators

**Alert Box**
- **Background**: Light pink (#FFF0F0)
- **Border**: Red (1px) or no border
- **Border Radius**: 4px
- **Padding**: 12px
- **Text Color**: Red (#FF4757)
- **Font Size**: 12px
- **Position**: At bottom of panel

### Form Field Widths

**Full Width Fields**
- Address (주소)
- Email (이메일)
- Order Deadline (주문 마감시간)
- Account Number (계좌번호)
- Description (설명)
- Memo (발주자메모)

**Medium Width Fields**
- Order Holder Name (발주자명)
- Business Registration Number (사업자등록번호)
- Representative Name (대표자명)
- Bank Name (은행명)
- Account Holder Name (예금주명)
- Payment Method (결제방식)

**Multi-part Fields**
- Contact (연락처) - 3 fields
- Fax (팩스) - 3 fields
- Fax Code (핵스코드) - 3 fields

**Dropdown Width**
- Category (종목) - Medium width
- Order Manager (발주담당자) - Medium width

### Spacing & Padding

**Form Padding**
- **Top**: 40px
- **Right**: 40px
- **Bottom**: 40px
- **Left**: 40px

**Field Spacing**
- **Vertical Gap**: 16px between fields
- **Section Gap**: 32px between sections
- **Label to Input**: 8px

**Panel Spacing**
- **Section Spacing**: 24px
- **Header to Content**: 12px
- **Padding**: 24px all around

### Responsive Behavior
- **Desktop**: Three-column layout (sidebar | form | info panel)
- **Tablet**: Two-column (sidebar collapses, info panel below form)
- **Mobile**: Single column, all elements stack vertically
- **Info Panel**: Becomes collapsible on mobile

### Validation States

**Valid Input**
- **Border**: Light gray (default)
- **Background**: White

**Invalid Input**
- **Border**: Red (2px)
- **Background**: Light pink (#FFF0F0)
- **Error Message**: Red text below field

**Focus State**
- **Border**: Blue (#4A90E2, 2px)
- **Shadow**: Subtle blue glow

### Interactive Behavior

**Form Submission**
- **Validation**: Check required fields
- **Loading**: Spinner on register button
- **Success**: Redirect or success message
- **Error**: Show error messages inline

**File Upload**
- **Click**: Opens file picker
- **Selected**: Shows file name
- **Remove**: X button to clear

**Cancel Button**
- **Action**: Confirms before discarding changes
- **Navigation**: Returns to previous page

### Accessibility
- **Labels**: Associated with inputs
- **Tab Order**: Logical flow through form
- **Focus Indicators**: Visible outline
- **Error Messages**: Screen reader accessible
- **Required Fields**: Marked clearly

### Data Validation
- **Required Fields**: Check for non-empty
- **Phone Format**: Validate format XXX-XXXX-XXXX
- **Email Format**: Validate email pattern
- **Business Number**: Validate format
- **Account Number**: Validate numeric

### Loading States
- **Form Load**: Skeleton or spinner
- **Submit**: Spinner on button, disabled state
- **File Upload**: Progress indicator

### Empty States
- **New Form**: All fields empty with placeholders
- **File Upload**: "파일첨부" button with no file
- **Dropdown**: "선택" or "미지정" placeholder
