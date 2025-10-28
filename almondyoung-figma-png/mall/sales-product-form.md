# Sales Product Form (상품 등록)

## Overview
This is a comprehensive product registration form for creating new products in the e-commerce system. It features extensive configuration options including basic information, pricing, inventory, shipping, display options, SEO settings, and image management. The form is organized into collapsible sections with a help panel on the right.

## Layout Structure

### Top Navigation Bar
- **Left side**: LCNINE logo
- **Right side horizontal menu**:
  - 회사/조직 (Company/Organization)
  - 기획/관리 (Planning/Management)
  - 주문/출고관리 (Order/Shipping Management)
  - 제고&상품 관리 (Inventory & Product Management)
  - CS
  - 판매/통계 (Sales/Statistics)
  - 자사몰 관리 (Company Mall Management) - Currently active
  - 멀버십 관리 (Membership Management)

### Left Sidebar Navigation
Dark blue background:

**Main Menu Items**:
- 이전원 (User/Account)
- 관리구역 (Management Area) label

**자사몰 관리 Submenu**:
- 상품 관리 (Product Management)
- 대시보드 (Dashboard)
- **상품 목록** (Product List) - Currently active in blue
- 상품 등록 (Product Registration)
- 분류/카테고리 (Classification/Category)
- 진열 (Display)
- 자사상품 관리 (Company Product Management)

**Other Sections**:
- 마케팅 (Marketing)
- 매서치 관리 (Message Management)
- 배너 관리 (Banner Management)
- 판정옵 / 공지사항 관리 (Notice Management)
- 적립금 (Points)
- 쿠폰 (Coupons)

### Top Tab Navigation
- **자사몰상품 등록** (Company Mall Product Registration) - Currently active with blue underline
- **CSV 상품등록** (CSV Product Registration)
- **스마트스토어 상품 등록** (Smart Store Product Registration)

### Breadcrumb Navigation
홈 > 자사몰 관리 > 상품 > 상품 등록

## Form Sections

### Top Action Bar
- **취소** (Cancel) - Left side button
- **저장** (Save) - Right side orange button

### Section 1: 판매정보 (Sales Information)

**Product Type Toggle**:
- ● **한정판** (Limited Edition) with "NEW" badge - Selected
- ○ **판매판** (Regular Sale) with "NEW" badge

**상품판매 (Product Sales)**:
- Multiple category selection interface with arrows (›):
  - 배추 › 브라 › 브라&전피스 ›
  - 배추 › 브라티말러 › 브라티말러토상품 ›
  - 배추 › 골라사 › 가라에전피필 › **전속** (in orange badge)
  - 배추 › 골라사 › 가라에전피필 ›
  - 패치 › 패치로 ›
  - 패치 › 가라에계 › 드르르페 ›
  - 패치 › 가라에계 › 패치속 ›

**Sales Information Cards**:
Left section:
- "메추 나 패추 스전트피스대피로" (text field)
- "메추 나 패추 판메" (text field)
- "가매배정" (label)

Right section:
- "스메추 판매 피피" (text field)
- "스메추 판배 가배" (text field)

### Section 2: 기본정보 (Basic Information)

**상품코드** (Product Code):
- Text field for manual entry
- Checkbox: "자동생성 시 사용" (Use auto-generation)

**상품명** (Product Name):
- Text input field

**기타명 표시** (Other Name Display):
- Text field
- Buttons: "판매 등록" (Register Sale) | "판매 등록가계" (Register Sale Store)

### Section 3: 제품정보 (Product Information)

**제품 관계** (Product Relation):
- kg field (weight)
- 판명 field (name)
- cm field (dimensions)

**관매 과계** (Sales Relations):
- Fields with dots: .. - .. cm
- 표로부가 (Table addition)
- 페로나 (?)

**판별판** (Classification):
- 관매판 (Sales classification)
- 사매판 (Purchase classification)

**배송관련** (Shipping Related):
- Dropdown: "신표 메피 판거표" (New shipping method)

### Section 4: 판매판정 (Sales Classification)

Collapsible section (currently collapsed)

### Section 5: 상품개요정보 (Product Overview Information)

Large text editor area (empty)

### Section 6: 가정보가 (Price Information)

**판매가 (시판정)** (Selling Price - Market Price)**:
- Currency symbol: ₩
- Numeric input field
- Label: 시판정까지 판막가 : ₩

**판가(₩)** (Price):
- Currency symbol: ₩
- 공급가격 (Supply price) dropdown: ▼
- ₩ field
- ₩ field

**등록가** (Registration Price):
- ☑ 관매 상품으로 가로 (Register as sales product)

### Section 7: 판매조건 (Sales Conditions)

**상매판매** (Product Sales):
- Radio group:
  - ○ 상매관별 (Product management)
  - Dropdown: "판매 가피 가피" (Sales price method)
  - ○ 전조치 판배별필 관계가 (Sales relation management)
  - ○ 판피조치 (Price management)
  - ○ 다가별팔팔 (Multiple sales)
  - ○ 판매별판매 (Sales management)
  - ○ 다표관별메가 (Multiple management)

**관매 나이 별명** (Sales Classification):
- ○ 상매관별 (Product management) - Selected
- "~ 가관별 상매별명" (~ classification management)

**상매 나이 별명** (Product Classification):
- ○ 상매관별 (Product management) - Selected
- 필매 : (Required:) text field with "~ 가 판매 별피피 나 별" (pricing management info)

### Section 8: 상품판매피정보가 (Product Sales Configuration)

Collapsible section with expand/collapse arrow (▼)
Subtitle: "판매 과표 판피 나 판피팔 최피 나 별피 판별피 판매 가관별" (Sales configuration management details)

**Sub-tabs**:
- ● **판매 시피과로** (Sales Management) - Selected
- ○ 브피 판피과로가 (Product Management)
- ○ 관피 별피과로가 (Classification Management)
- ○ 속피 시별가 (Internal Management)

**판매 시피가** (Sales Configuration):
Table with columns:
- 번호 (Number)
- 별피로 시피가별 (Configuration name)
- 별피판매가 (Sales price)

Radio buttons and checkbox:
- ☑ 별피피메배시가 (Configuration settings)
- 별피 가피 (Configuration price)

**판매시피가별 피표** (Sales Configuration Table):
Columns:
- 별피과로 (Configuration)
- 별피과로 (Configuration)
- 별피과로 (Configuration)
- 별피과로 (Configuration)
- 별피과로 (Configuration)
- 별피과로 (Configuration)
- 별피과로 (Configuration)

- **+ 별피피 관비 추가** (+ Add configuration option) - Orange button

**판매 관피** (Sales Management):
Display mode: "시별가 별가" (Display mode)

Table with columns:
- Checkbox
- 번호 (Number)
- 별피시가판별가 (Configuration details)
- 별피시가 (Configuration)
- 판별가 (Classification)
- 판별가 (Classification)
- 별가 (Price)

Empty state message: "별피피가 별피피가관별니다" (No configurations registered)

### Section 9: 추가 상품정보 (Additional Product Information)

Collapsible section with "NEW" badge (▲ expanded)

**판매 별피** (Sales Information):
- 별피가 (Price)
- Text input: "별피기피" (Price input)
- 별피시가 (Configuration): text field with spinner controls (- □ +)

### Section 10: 메피별 판피 (Meta Information)

Collapsible section with checkbox ☑ "NEW"

**사피별 가별** (Meta Fields):
- Dropdown: "나별 나피가" (Field selection)

### Section 11: 별피시 별가 (Display Settings)

Collapsible section

**상품시피가** (Product Display):
- 별피가시가 (Display settings)
- 별피가시가6개 (6 display settings)
- 별피가시가6개 (6 display settings)
- 별피가시가6개 (6 display settings)
- 별피가시가 (Display settings)
- 별피가시가6개 (6 display settings)

Each row has:
- 시피별 (Display) label
- Dropdown: "별피시가 별피시시가 = 1280*1280px" (Image dimension specification)
- Image placeholder area on the right with:
  - Image icon
  - Upload buttons:
    - 별 (Select)
    - 별피 (Edit)
    - 가피 (Register)
    - 피판 (Upload)
    - 별피 (Delete)

### Bottom Action Buttons
Three centered buttons:
- **취소** (Cancel) - White/outlined
- **미리보기** (Preview) - White/outlined
- **저장** (Save) - Orange

### Right Panel: Help Section

**상품 등록** (Product Registration)

**상품 조회 및 수정** (Product Search and Edit)
등록된 상품 목록에서 직접 수정하시거나, 별피별로 상품명 입력 후 조회하여 수정합니다.
또한, 판매 중인 상품, 별피 중인 상품, 별피 중인 상품 등으로 상품을 조회할 수 있습니다.

**가매별명** (Price Classification)
게시판과 같이 가매별로 상품정보가 표시됩니다.
별(표) 상품별로 별피 판매 가피 별피별명에 대한 정보는 별피별명 설정 가능합니다.
별피, 별피 판매 상품 표시조건도 설정 가능합니다.
별피별로 시기 별피별명의 관비를 별피관로 별피기별관별니다.

**개정별가** (Standard Settings)
판매 상품별로 별피판별 관피별로 가관별판별가 별피판별로 관피별니다.
별피 판별별 별피별가피별판

**기별정보** (Basic Information)
에로 시피 별피-나-별피명 관피별 상 별피별가
별피 시피로 별피별

**별피피정보** (Product Information)
별피로 판명-등록 별피명 관피별 상 별피별가
별피별 - 별피 별피 나별 피판별판별명 별피별가 가관피별로 별피별가피별 별피별피로 별피별판가
별피별 - 별피 판매 가관별 별피별피로 나별 별피로 가별별로 판가별가별로 판피별피피별관니다

### Bottom Right: Floating Action Button
Blue circular button with document/checklist icon
Label: "상품 정보 등록 안내" (Product Information Registration Guide)

## Color Scheme
- **Primary**: Dark navy blue for sidebar
- **Active state**: Bright blue for selected items and underlines
- **Action buttons**: Orange for primary actions (Save, Add)
- **Secondary buttons**: White/outlined for cancel/preview
- **Badges**: Orange for "NEW" badges, colored badges for categories
- **Toggle switches**: Blue when selected
- **Background**: White/light gray for content areas
- **Form fields**: White with gray borders

## Form Features

### Input Types
- **Text inputs**: Single-line fields for names, codes
- **Text areas**: Multi-line for descriptions
- **Dropdowns**: Category selection, configuration options
- **Radio buttons**: Mutually exclusive choices
- **Checkboxes**: Multiple selection options
- **Number spinners**: Quantity/price controls with +/- buttons
- **Rich text editor**: Product overview/description
- **File upload**: Image management with preview
- **Toggle switches**: Enable/disable features

### Section Organization
- **Collapsible sections**: Expand/collapse for better organization
- **Tabbed interfaces**: Group related settings
- **Table displays**: Structured data entry
- **Badge indicators**: "NEW" features highlighted
- **Help tooltips**: Info icons for contextual help

### Validation and Actions
- **Required fields**: Marked with indicators
- **Auto-generation**: Options for automatic code generation
- **Preview capability**: See product before saving
- **Bulk actions**: Add multiple configurations
- **Image management**: Upload, edit, delete operations
- **Save/Cancel**: Standard form actions

## Data Display Patterns
- **Hierarchical categories**: Multi-level with breadcrumb-style navigation
- **Configuration tables**: Dynamic rows for variants/options
- **Image upload areas**: Visual placeholders with action buttons
- **Form sections**: Logically grouped with headers
- **Inline editing**: Edit directly within table cells
- **Multi-step selection**: Category drill-down with arrows
