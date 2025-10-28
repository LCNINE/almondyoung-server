# SKU Option Edit Form

## Modal Title (Dark purple header)
**옵션 정보 수정** (Option Information Modification)

## Modal Layout
Scrollable modal dialog showing various collapsed and expanded sections of the option edit form.

## Action Buttons (Top Right)
- **취소** (Cancel) - White button
- **저장** (Save) - Orange button

## Form Sections (Multiple Views Shown)

### Left Column - Collapsed Sections View

The image shows multiple collapsed sections with expand/collapse indicators:

#### Visible Section Headers:
1. **기본정보** (Basic Information) - Collapsed with "▼" indicator
2. **바코드** (Barcode) - Collapsed
3. **물류정보** (Logistics Information) - Collapsed
4. **재고정보** (Stock Information) - Collapsed
5. **단제(승낙)정보** (Channel Approval Information) - Collapsed

Each section has a chevron indicator showing it can be expanded.

### Middle Column - Partially Expanded View

Shows some sections expanded with form fields visible:

#### Section: 기본정보 (Basic Information)
- **상품명**: Product name field
- **사업 상품명**: Business product name field
- Additional fields partially visible

#### Section: 재고정보 (Stock Information)
Shows stock-related fields including:
- Stock quantity inputs
- Location fields
- Numeric entry fields with unit indicators

### Right Column - Detailed Form Fields

#### Section: 단제(승낙)정보 Expanded
Shows a detailed table with multiple rows:

**Table Headers:**
- 분도 (Category)
- 제공오멉쁨 (Supply)
- 공급처 (Supplier)

**Table Data:**
Shows "지젤박" entries with empty fields for supplier information

#### Image Section Visible
Shows image upload area with:
- Placeholder text for image size requirements
- Image icon
- Product images displayed (black bottles)

### Bottom Sections

#### Section: 단제(승낙)정보 Table View
Multiple collapsed and expanded states showing:

**Sales Channel Integration Table:**
- Column headers for product codes and names
- Multiple rows with product information
- Some rows showing:
  - Product code: "5574"
  - Product name: "다젤 M 노와이프 미러젤 매트 탑젤 14ml 2종"
  - Empty pricing fields

**Repeated Sections:**
The image shows the same form in different states of expansion/collapse, demonstrating the accordion-style interface.

### Right-Most Panel

#### Expanded View of Sales Information
Shows detailed table with:

**Column Headers:**
- 분도 (Category)
- 공급처 (Supplier)
- 제고금액 (Stock Amount)

**Data Rows:**
Multiple entries showing:
- "지젤박" as category
- Empty supplier fields
- Numeric values in various columns

#### Timestamps Section
- **등록일자** (Registration Date)
- **최종수정일자** (Last Modified Date)
Date/time stamps with user information

## Visual Patterns

### Accordion Interface
The form uses an accordion pattern where:
- Sections can be collapsed to show only headers
- Clicking expands to reveal form fields
- Multiple sections can be open simultaneously
- Visual indicators (▼/▲) show expand/collapse state

### Section Organization
Grouped into logical categories:
1. Basic product information
2. Barcode management
3. Logistics details
4. Stock information
5. Channel integration
6. Sales information
7. Image management
8. Product description
9. Designer/promoter assignment

## Color Scheme
- **Modal Header**: Dark purple (#3D2C5C)
- **Primary Action**: Orange (Save button)
- **Secondary Action**: White/gray (Cancel button)
- **Section Headers**: Light gray background
- **Form Background**: White
- **Table Alternating Rows**: Subtle gray
- **Text**: Dark gray/black
- **Borders**: Light gray

## Interactive Elements
- Expandable/collapsible sections
- Text input fields
- Numeric input fields
- Dropdown selectors
- Checkboxes
- Data tables
- Image upload areas
- Action buttons

## Key Features
- Space-efficient accordion layout
- Progressive disclosure of information
- Organized into logical sections
- Visual indicators for section state
- Consistent layout across sections
- Multiple barcode support
- Channel integration table
- Sales information table
- Image management
- Audit trail information

## User Experience
- Sections can be collapsed to reduce scrolling
- Focus on relevant sections by expanding only what's needed
- Clear visual separation between sections
- Consistent interaction patterns
- Form validation indicators
- Save/Cancel options always visible at top

## Data Tables
Multiple embedded tables for:
- Channel information
- Sales data
- Product variants
- Pricing information
- Each with appropriate column headers and data rows

## Form State Management
The multiple views show:
- All sections collapsed (minimal view)
- Some sections expanded (working view)
- All sections expanded (full detail view)
- Ability to toggle individual sections
