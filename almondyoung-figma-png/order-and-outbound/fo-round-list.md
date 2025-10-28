# FO Round List (Fulfillment Order Round List)

## Overview
This interface displays a list of picking rounds for fulfillment orders. Each round represents a batch of orders assigned to a picker for efficient warehouse picking operations. The page allows managers to view, monitor, and manage picking rounds.

## Layout Structure

### Left Sidebar (Dark Navy Background)
**Header**
- Logo: "LCNINE"
- Badge: "2 건수팀" indicator

**Navigation Menu**
- **주문/출고** (Orders/Outbound) section - Active
  - 입고 제품수: 567
  - 주문수집
  - 매장 제고
  - 주문입력
  - 주문 입력(수동/자동팀)
  - 주문 입력(수동/요청팀)
  - 주문내역 목록
  - 출고
  - [단말기] 개인별 출고
  - 주문별 출고 출력
  - **출고 회차별 조회** (highlighted/active)
  - 파티선수
  - 검수 할당
  - 할당요청 제고

### Top Navigation Bar
Horizontal tabs with icons:
- 회사/조직 (Company/Organization)
- 기본정보 (Basic Info)
- 주문/출고관리 (Order/Outbound Management) - Active
- 제조/생산 관리 (Manufacturing/Production Management)
- CS
- 판매 / 통계 (Sales / Statistics)
- 지시서 관리 (Instruction Management)
- 매입/입 관리 (Purchase/Inbound Management)

### Breadcrumb Navigation
홈 > 주문/출고 > 주문수집 > 출고 회차별 조회

## Filter Section

### Filter Controls (Single Row Layout)

**Filter Fields:**
- **조회가간** (Search Period): Date range with two date pickers
  - From: 2025-06-20 (with X clear button)
  - To: 2025-06-20 (with X clear button)
- **회차** (Round): Empty dropdown
- **피킹 담당자** (Picker): Empty dropdown
- **알뷰폼 어급** (Form Level): Empty dropdown
- **조건대역** (Condition Range): Dropdown showing "운송장 작성"

### Action Buttons
- Orange **검색** (Search) button
- White **초기화** (Reset) button (positioned to the right of search)

## Results Summary
- Icon with text: "17개의 출고회차 일시 입니다" (17 picking rounds found)
- Icon with text: "승수 장정 출력" (Print approved list)
- Pagination/Sort: 50건의 입가 (50 items) with dropdown at top-right

## Data Table

### Table Headers
| # | 출고번시부 | 회차 | 판매처 인력 | 피킹 담당자 | 알뷰폼 어급 | 출고건임용 (승수임차) | 출고건패호 | 출고건패호 | 소입시간 | 피킹라운드 | 배송부수 | 문의공장 출력 |
|---|----------|------|-----------|-----------|-----------|------------------|----------|----------|---------|----------|---------|-------------|
|   | FO Batch Date | Round | Sales Channel | Picker | Form Level | FO Count (Approved) | Completed FO | Failed FO | Small Time | Picking Round | Delivery Count | Customer List Print |

### Table Data Patterns

All 17 rows follow this consistent pattern:

**Date**: 2025-07-08 (same for all rows)
**Round Numbers**: 1회차, 2회차, 3회차, 4회차, 5회차, 6회차, 7회차, 8회차, 9회차, 10회차, 11회차, 12회차, 13회차, 14회차, 15회차, 16회차, 17회차
**Sales Channel**: 클라이언도 (same for all rows)

**Metrics (same for all rows):**
- 알뷰폼 어급 (승수임차): 20
- 출고건임용: 0
- 출고건패호: 0

**Actions Column (피킹라운드):**
- Dark circular icon button (likely for viewing/managing the round)

**Status Column (배송부수):**
- Blue hyperlink text: "대한빈도 권수출력" (Korea courier label print)
- Appears clickable

**Document Column (문의공장 출력):**
- Blue circular icon button with download/print functionality

### Row Examples:

**Row 1:**
- 출고번시부: 2025-07-08
- 회차: 1회차
- 판매처 인력: 클라이언도
- 알뷰폼 어급 (승수임차): 20
- 출고건임용: 0
- 출고건패호: 0
- 소입시간: (empty)
- 피킹라운드: [Dark circular button]
- 배송부수: 대한빈도 권수출력 (blue link)
- 문의공장 출력: [Blue circular button]

**Rows 2-17:** Identical structure with sequential round numbers (2회차 through 17회차)

### Footer
"페이지네이션" (Pagination) centered at bottom

## Right Panel (Help/Documentation)

### Title
"출고 회차별조회" (Outbound by Round Inquiry)

### Content Sections

**1. 출고지시 처리가 된 주문건을 회차별로 조회**
Description explaining how to view orders by picking round
- Detailed explanation text in Korean about round-based order viewing

**2. 출고지지**
Explanation of outbound instructions
- Text describing the process

**3. 출고건대업**
Information about outbound order types
- Details about order categorization

**4. 출고건패호**
Failed order information
- Description of failed order handling

**5. 스입시간**
Small time information
- Explanation of timing metrics

**6. 피킹담당자**
Picker assignment information
- Details about picker responsibilities

**7. 피킹라운드**
Description of picking round feature
- Bullet point: "피킹라운드 번 번호를 클릭하기가 됩니다."

**8. 운송장 출력**
Shipping label printing
- Information about label generation and printing
- Details about the process

**9. 중요 노티스** (Important Notice)
Highlighted in red:
- Header: "피킹라운드를 만생내와 관련자의 의뢰"
- Warning text: "출고지시 건 승수 출력 시 배생 처리완료자가 내생 처리 관생내작업 출력작이밖용"

## Floating Action Buttons (Bottom Right)
Two circular buttons stacked vertically:
- **Top button**: Blue circular button (likely for primary action)
- **Bottom button**: Light gray circular button (likely for secondary action)

## Color Scheme
- **Primary Navigation**: Dark navy (#1a1f3a)
- **Active Elements**: Purple/blue highlight for active menu item
- **Primary Button**: Orange (#f5a842) for search
- **Secondary Button**: White with gray border for reset
- **Table**: White background with light gray borders
- **Table Headers**: Light gray background
- **Action Buttons**:
  - Dark gray/charcoal for viewing rounds
  - Blue for document actions
- **Links**: Blue hyperlinks
- **Text**: Dark gray/black for content

## Typography
- Page title: Large, bold
- Table headers: Bold, dark text
- Data cells: Regular weight
- Links: Blue, underlined on hover
- Help text: Regular weight, smaller size

## Interaction Elements
- **Date Pickers**: Two date range inputs with clear buttons
- **Dropdowns**: Multiple filter dropdowns
- **Search Button**: Primary action button
- **Reset Button**: Secondary action button
- **Round View Buttons**: Dark circular icons for each round
- **Print Buttons**: Blue circular icons for document generation
- **Hyperlinks**: Blue text links for courier label printing
- **Floating Action Buttons**: Two circular buttons at bottom-right

## Key Features
- Sequential round numbering system (1-17 rounds shown)
- Consistent metrics across all rounds (20, 0, 0)
- Date-based filtering
- Picker assignment tracking
- Round-specific actions
- Document printing capabilities
- Courier label generation links
- Real-time status monitoring
- Batch processing view
- Comprehensive help documentation

## Data Insights
- All rounds created on same date (2025-07-08)
- All using same sales channel (클라이언도)
- Consistent approved count (20 per round)
- Zero completed or failed orders
- Multiple rounds can exist for same date
- Each round has independent document generation
