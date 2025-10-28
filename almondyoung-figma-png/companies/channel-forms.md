# Channel Forms - Design Specification

This document describes three modal forms for managing sales channel integrations (판매처 등록). The image shows three different channel type forms stacked vertically.

## Common Layout Structure

All three modals share the same basic structure:

### Header
- **Title Bar**: Dark navy blue background (#1F1B3D or similar)
- **Close Button**: X icon in top-right corner
- **Title Text**: White text, center-aligned

### Form Sections
Each form is divided into two main sections with light gray backgrounds:

1. **소명품 로그인 정보** (Shop Login Information) - Required basic information
2. **슈퍼인 상점** (Super Store Information) - Optional additional information with helper text "이 슈퍼인 정보는 입력 시 업데이트 정보를 받습니다."

### Footer Actions
- **취소 (Cancel)**: White/gray button on the left
- **저장 (Save)**: Orange button (#FF8C00 or similar) on the right

---

## Form 1: 판매처 등록(테미 스마트스토어) - Naver Smart Store

### Title
**판매처 등록(테미 스마트스토어)** - Channel Registration (Naver Smart Store)

### 소명품 로그인 정보 (Shop Login Information)

| Field Label | Field Type | Additional Info | Required |
|-------------|-----------|-----------------|----------|
| 판매처 분류 (Channel Category) | Dropdown | Placeholder: "판매처 분류 선택" | Yes (red indicator) |
| 판매채널 (Sales Channel) | Text Input | - | Yes (red indicator) |
| 소명품 ID (Shop ID) | Text Input | Right side shows: 수수료 (Commission) with % symbol | Yes (red indicator) |
| 비밀번호 (Password) | Text Input | - | Yes (red indicator) |
| 스마트스토어 주소 (Smart Store Address) | Text Input | - | Yes (red indicator) |
| API ID | Text Input | - | Yes (red indicator) |

### 슈퍼인 상점 (Super Store Information)

| Field Label | Field Type | Additional Info |
|-------------|-----------|-----------------|
| 슈퍼인 이름 (Super Name) | Text Input | - |
| 슈퍼인 전화 (Super Phone) | Text Input | - |
| 우편번호 (Postal Code) | Text Input | "검색" (Search) button on right |
| 주소 (Address) | Text Input (wide) | - |

---

## Form 2: 판매처 등록(쿠팡) - Coupang

### Title
**판매처 등록(쿠팡)** - Channel Registration (Coupang)

### 소명품 로그인 정보 (Shop Login Information)

| Field Label | Field Type | Additional Info | Required |
|-------------|-----------|-----------------|----------|
| 판매처 분류 (Channel Category) | Dropdown | Placeholder: "판매처 분류 선택" | Yes (red indicator) |
| 판매코드 (Sales Code) | Text Input | - | Yes (red indicator) |
| 판매채널 (Sales Channel) | Text Input | Right side shows: 벤더코드 (Vendor Code) | Yes (red indicator) |
| 소명품 ID (Shop ID) | Text Input | - | Yes (red indicator) |
| 비밀번호 (Password) | Text Input | Right side shows: 수수료 (Commission) with % symbol | Yes (red indicator) |
| Access Key | Text Input | - | Yes (red indicator) |
| Secret Key | Text Input | - | Yes (red indicator) |

### 슈퍼인 상점 (Super Store Information)

| Field Label | Field Type | Additional Info |
|-------------|-----------|-----------------|
| 슈퍼인 이름 (Super Name) | Text Input | - |
| 슈퍼인 전화 (Super Phone) | Text Input | - |
| 우편번호 (Postal Code) | Text Input | "검색" (Search) button on right |
| 주소 (Address) | Text Input (wide) | - |

---

## Form 3: 판매처 등록(지마켓) - Gmarket

### Title
**판매처 등록(지마켓)** - Channel Registration (Gmarket)

### 소명품 로그인 정보 (Shop Login Information)

| Field Label | Field Type | Additional Info | Required |
|-------------|-----------|-----------------|----------|
| 판매처 분류 (Channel Category) | Dropdown | Placeholder: "판매처 분류 선택" | Yes (red indicator) |
| 판매채널 (Sales Channel) | Text Input | Right side shows: 벤더 (Vendor) | Yes (red indicator) |
| 소명품 ID (Shop ID) | Text Input | - | Yes (red indicator) |
| 비밀번호 (Password) | Text Input | Right side shows: 수수료 (Commission) with % symbol | Yes (red indicator) |
| 버전 (Version) | Text Input | - | Yes (red indicator) |

### 슈퍼인 상점 (Super Store Information)

| Field Label | Field Type | Additional Info |
|-------------|-----------|-----------------|
| 슈퍼인 이름 (Super Name) | Text Input | - |
| 슈퍼인 전화 (Super Phone) | Text Input | - |
| 우편번호 (Postal Code) | Text Input | "검색" (Search) button on right |
| 주소 (Address) | Text Input (wide) | - |

---

## Design Specifications

### Colors
- **Primary Action**: Orange (#FF8C00)
- **Header Background**: Dark Navy (#1F1B3D)
- **Section Background**: Light Gray (#F8F8F8)
- **Required Field Indicator**: Red
- **Text**: Dark Gray/Black for labels, Gray for placeholders

### Typography
- **Modal Title**: Bold, white text, medium-large size
- **Section Headers**: Bold, dark text with bullet point
- **Field Labels**: Regular weight, dark text
- **Helper Text**: Small, gray text

### Spacing
- Form fields are organized in a single column layout
- Consistent padding around sections
- Fields with side-by-side inputs (like Shop ID with Commission) use grid layout

### Interaction Elements
- Dropdown menus have down arrow indicators
- Search button ("검색") for postal code lookup
- All text inputs have light borders
- Required fields marked with red square indicator (■)

### Validation
- Red indicators show required fields
- Forms cannot be submitted without completing required fields
