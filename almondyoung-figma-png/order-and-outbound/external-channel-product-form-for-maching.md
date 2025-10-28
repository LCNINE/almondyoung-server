# External Channel Product Form for Matching

## Overview
This is a modal dialog form for registering external sales channel products for matching with internal products. The interface allows mapping external channel product codes to internal product options.

## Modal Structure

### Header
- **Title**: "매칭용 상품등록" (Product Registration for Matching)
- **Background**: Dark navy blue header bar
- **Close button**: X icon in top-right corner

### Form Fields

#### Basic Information Section

**1. 판매처** (Sales Channel)
- Label with red bullet indicator
- Display value: "네이버 스마트스토어 - 아몬드영"
- Read-only field

**2. 판매처 상품코드** (Sales Channel Product Code)
- Label with red bullet indicator
- Display value: "12312345611"
- Read-only field

**3. 판매 상품명** (Product Name)
- Label with red bullet indicator
- Long text field displaying:
  "플루아이어 만지브리이망키가는우리용 아어이익인보명정고 스마트팀 신체반호 스지시용먼더리 stem (단명유선)"
- Character count: [0/250]
- Checkbox: "주문명과 동일" (Same as order name) - checked with blue checkmark
- Read-only appearance

**4. 판매가** (Sale Price)
- Label with red bullet indicator
- Display value: "13,000"
- Read-only field

#### 옵션정보 (Option Information) Section

**Data Table**
Headers:
| # | (Option Name) | (Operation) | (Quantity) | (Unit) | (Action) |
|---|---------------|-------------|------------|--------|----------|

**Row 1:**
- #: 1
- Option Name: "J/0.07/5mm" (text input field)
- Operation: Dropdown showing "추가" (Add) with +/- spinners
- Quantity: "0" with "원" (unit) suffix
- Unit: Dropdown showing "판매"
- Action: Button "제고연결" (Link Stock) with settings gear icon

**Row 2:**
- #: 2
- Option Name: "J/0.07/5mm" (text input field)
- Operation: Dropdown showing "추가" (Add) with +/- spinners
- Quantity: "0" with "원" (unit) suffix
- Unit: Dropdown showing "판매"
- Action: Button "제고연결" (Link Stock) with settings gear icon

### Action Button
- **상품등록** (Register Product) button
- Orange/peach color
- Positioned at bottom-right of form

## Right Panel (Help/Information Section)

### Title
"외부채널 매칭용 상품등록" (External Channel Product Registration for Matching)

### Content Sections

**1. 상품정보가 없는 외부판매채널 주문 매칭**
Subtitle explaining the matching process for external channel orders without product information
- Explanatory text: "외부 판매채널에서 들어온 주문을 매칭하기 위해 상품 정보를 생성하고 제고를 연결합니다."

**2. 제고연결**
Subtitle explaining stock linking
- Explanatory text: "옵션들목에 제고상품을 연결해 제고매칭까지 등록할 수 있습니다."

**3. 중요 노티스** (Important Notice)
Header in red text
- Bullet point in red: "나머지 상품등록시 필요한 필수 항목들에 대한 정보를 받아오거나 자동등록하여 등록되어 야합니다."
  (Translation: "Information for remaining required fields during product registration must be retrieved or automatically registered.")

## Design Elements

### Colors
- **Header**: Dark navy blue (#2c3654)
- **Primary Button**: Orange/peach (#f5c98f)
- **Labels**: Black text with red bullet indicators for required fields
- **Checkbox**: Blue when checked
- **Background**: Light gray (#f5f5f5)
- **Form Background**: White
- **Text**: Dark gray/black for content

### Typography
- Modal title: Large, bold, white text
- Section labels: Bold with red bullet markers
- Field values: Regular weight
- Help text: Regular weight, smaller size

### Layout
- Two-column layout: Form on left (wider), help panel on right (narrower)
- Form fields stacked vertically with consistent spacing
- Table layout for option information
- Responsive button placement

## Interaction Elements
- **Text Input Fields**: For option names (editable)
- **Dropdowns**: For operation type and unit selection
- **Spinners**: +/- buttons for operation dropdown
- **Number Inputs**: For quantity values
- **Checkbox**: For name synchronization
- **Action Buttons**: Individual "제고연결" buttons per row
- **Submit Button**: Main "상품등록" button at bottom
- **Close Button**: X icon in header

## Key Features
- External channel product code mapping
- Option-level inventory linking
- Character limit for product names (250 characters)
- Name synchronization with order name
- Multiple option rows support
- Individual stock linking per option
- Read-only display of channel and code information
