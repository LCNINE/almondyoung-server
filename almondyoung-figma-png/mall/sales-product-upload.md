# Sales Product Upload (상품 상급 등록)

## Overview
This page provides functionality for bulk product upload using CSV files. It's designed to streamline the process of adding multiple products to the system at once, with clear instructions and file upload capabilities.

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
- 이전원 (User/Account section)
- 관리구역 (Management Area) label

**거래처 관리** (Trading Partner Management) section header in sidebar

**Menu Items**:
- 판매처 관리(채널관리) (Sales Channel Management - Channel Management)
- 발주처관리 (Order Partner Management)
- 공급관리 (Supply Management)
- 외원 조회 (External Member Search)
- 단골리스트 (Regular Customer List)
- 블랙리스트 (Blacklist)

### Breadcrumb Navigation
홈 > 상품/판매관리 > 상품 관리 > 상품 상급 등록

## Main Content

### Tab Navigation
Two tabs at the top:
- **개별상품 등록** (Individual Product Registration)
- **CSV 상품 등록** (CSV Product Registration) - Currently active with blue underline

### Information Panel

**CSV 상품 등록 사용 방법** (CSV Product Upload Usage Instructions)

Light blue information box with bullet points:

1. **상품등록용 CSV 파일을 다운합니다.**
   - Text: "상품등록용 CSV 파일을 다운합니다." (Download the CSV file for product registration)
   - Link/Button: **상품등록 양식 받기** (Get Product Registration Form)

2. **다운 받은 CSV 파일에 내용을 입력합니다. (필수 입력값은 반드시 입력해야합니다.)**
   - Text: "다운 받은 CSV 파일에 내용을 입력합니다. (필수 입력값은 반드시 입력해야합니다.)"
   - Translation: Enter content in the downloaded CSV file. (Required fields must be filled in.)

3. **[파일선택] 클릭하여 상품등록용 파일을 선택후 [등록]버튼을 클릭합니다.**
   - Text: "[파일선택] 클릭하여 상품등록용 파일을 선택후 [등록]버튼을 클릭합니다."
   - Translation: Click [Select File] to choose the product registration file, then click the [Register] button.

### File Upload Section

**상품등록용 CSV 파일** (CSV File for Product Registration)

Upload interface with two buttons:
- **파일 선택** (Select File) - Gray button
- **선택된 파일이 없음** (No File Selected) - Gray text/button

### Action Button

Centered orange button:
- **파일전송** (Upload File)

## Features and Interactions

### CSV Upload Workflow
1. **Download template**: Get the CSV template file
2. **Fill in data**: Enter product information in the CSV
3. **Select file**: Choose the completed CSV file
4. **Upload**: Submit the file for processing

### Key Features
- **Bulk import**: Upload multiple products at once
- **Template-based**: Standardized CSV format
- **Required fields**: Clear indication of mandatory data
- **File validation**: System checks file format before processing
- **Simple interface**: Minimal, focused design for ease of use

### File Upload Controls
- **File selection button**: Opens file browser
- **Status indicator**: Shows selected file name or "no file selected"
- **Upload button**: Initiates the upload process

## Color Scheme
- **Primary**: Dark navy blue for sidebar
- **Active tab**: Blue underline for selected tab
- **Information panel**: Light blue background for instructions
- **Action button**: Orange for primary action (Upload)
- **Secondary buttons**: Gray for file selection
- **Text**: Dark gray for body text, blue for links
- **Background**: White for main content area

## User Experience Design

### Clear Instructions
- **Step-by-step guide**: Numbered instructions for clarity
- **Required field notice**: Explicit warning about mandatory fields
- **Visual hierarchy**: Information box stands out from upload interface

### Simplified Interface
- **Minimal elements**: Only essential controls shown
- **Clear labeling**: Descriptive button text
- **Logical flow**: Instructions → File selection → Upload
- **Status feedback**: Shows file selection state

### Error Prevention
- **Template download**: Ensures correct format
- **Required field guidance**: Prevents incomplete uploads
- **File validation**: Checks format before processing

## Data Display Patterns
- **Tabbed navigation**: Switch between individual and bulk upload
- **Information boxes**: Highlight important instructions
- **Button groups**: Related actions grouped together
- **Status displays**: Current state of file selection
- **Numbered lists**: Sequential instructions for clarity

## Use Cases
1. **Initial catalog import**: Load entire product catalog at once
2. **Bulk updates**: Update multiple products simultaneously
3. **Seasonal additions**: Add seasonal product collections
4. **Inventory restocking**: Import new inventory batches
5. **Data migration**: Transfer products from other systems
