# Create Sales Product Form - Page 1

## Modal Title
**제고 생성** (Create Inventory)

## Page Structure
This is a multi-tabbed modal dialog with three main tabs at the top. A right-side panel shows detailed guidelines and instructions.

## Tabs
Three horizontal tabs:
1. **자품 제고 배치** (Product Stock Assignment) - Currently active (highlighted in orange)
2. **수품 제고 배치** (Receive Stock Assignment)
3. **재고내부 입력** (Internal Inventory Input)

## Left Panel Content - Form Section

### Section 1: 자품 제고 배치 (Product Stock Assignment)

#### Basic Information Fields
1. **상품 구분** (Product Category)
   - Dropdown: "토품 구분" (Product Type)

2. **물류차** (Logistics)
   - Dropdown: "물류차" (Logistics)

3. **공급가(발주주가)** (Supply Price/Purchase Price)
   - Dropdown: "공급가 업체" (Supply Price Company)
   - Buttons: "검색" (Search) | "신규 등록" (New Registration)

4. **수업입고관** (Receive Inbound)
   - Dropdown: Empty

5. **분도** (Classification)
   - Text: "*다음만 점유 하원이 선택 점을"

#### Category Section (분가)
Label: "분가" with "0" count and "▼" expansion indicator
- Checkbox: "수입식 하업이재추정" (Import Food Re-estimation)

Table with columns:
| 번호 | 슈션식/슈챔링 | 슈전어이먼 | 분가 |
|------|--------------|------------|------|
| 1    | JX0.0755mm   |            | 0 한 |
| 2    | JX0.0755mm   |            | 0 한 |
| 3    | JX0.0755mm   |            | 0 한 |
| 4    | JX0.0755mm   |            | 0 한 |

#### Product Information (상품정보)
- **MOQ**: Empty field
- **패2오**: Empty field
- **패2오3**: Empty field
- **패2오4**: Empty field

## Right Panel - Instructions (Light background)

### 제고 생성(자동) (Create Inventory - Auto)
Detailed guidelines section with multiple subsections:

#### 재널맨 판매 등록 후 자동으로 재고상품 생성
Instructions for automatic inventory creation after channel sales registration

**자동 제고발생**
- Details about automatic inventory creation
- Explanation of when inventory is automatically created using PIM system

**수품 제고발생**
- Information about receive stock creation
- Explains the input method for receive stock

**수품간랙 select box**
- Details about selection dropdown
- Explains path: 시품 / 판매 / 재널리젠 / 간랙화넙셋

**샘월**
- Information about samples
- Details about using PIM channel registration

**판패강분**
- Information about sales categories
- Explains how to create stock for shipping categories

**상품문성**
- Information about product composition
- Details about creating stock through PIM product composition

**유정기간**
- Information about valid period
- Explains management of dated products with expiration management

**빌주터나**
- Information about purchase terminal
- Details about when items exist but no matching criteria found

**중고선지**
- Information about used notices
- Details about automatic matching when stock exists

**Important Notes Section (Red text)**
- 중요 노디스:
- 아정만먼만 판고 알림 대상으챔 받분오먼 업이 소정하감 반대코입니다.

---

## 상품 매칭 설정(상품별) (Product Matching Settings by Product)

### 재고상품을 강제대고 판패상품때 매칭
Instructions for forcibly matching inventory products to sales products

**해당만제 강상품을 강제만 간섹다면:**
- Details about forced product matching
- Explanation that MOQ value can be set to 50 minimum

**분류**
- Information about classification
- Details about product composition and search functions

**제공 후 다우로또 채칭**
- Information about channels
- Details about channel matching availability

**Important Notes Section (Red text)**
- 중요 노디스:
- 아 정만먼먼는 공어 다우로또 채멸 기능이 없어어 합니다.

## Bottom Actions
Orange button: **자품 제고 자입** (Product Stock Input)

## Visual Hierarchy
- Clear separation between form fields and instructions
- Use of dropdowns, text inputs, and tables
- Checkbox selections for multi-option fields
- Expandable/collapsible sections with indicators
- Color coding: Orange for primary actions, red for important warnings

## Color Scheme
- **Primary Action**: Orange buttons
- **Form Background**: White
- **Instructions Panel**: Light beige/cream background
- **Text**: Dark gray/black
- **Warnings**: Red text for important notices
- **Active Tab**: Orange highlight
