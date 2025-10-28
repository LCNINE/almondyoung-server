# Drop Ship Order List

## Overview
This is a comprehensive order management interface for drop-ship orders, featuring a dark sidebar navigation, filtering capabilities, statistics dashboard, and a detailed order list table.

## Layout Structure

### Left Sidebar (Dark Navy Background)
**Header**
- Logo: "LCNINE"
- Icons for user settings and notifications

**Navigation Menu**
- Active section: "주문/출고" (Orders/Outbound) - highlighted with purple/blue background and badge showing "2 건수팀"
- Menu items listed vertically:
  - 입고 제품수: 567
  - 주문수집
  - 매장 제고
  - 주문입력
  - 주문 입력(수동/자동팀)
  - 주문 입력(수동/요청팀)
  - **주문내역 목록** (active/highlighted)
  - 출고
  - [단말기] 개인별 출고
  - 주문별 출고 출력
  - 종입/출고 / 출고 관리팀 조회
  - 파티선수
  - 검수 할당
  - 할당요청 제고

### Top Navigation Bar
Horizontal tab menu with icons:
- 회사/조직 (Company/Organization)
- 기본정보 (Basic Info)
- 주문/출고관리 (Order/Outbound Management) - Active tab indicated by blue underline
- 제조/생산 관리 (Manufacturing/Production Management)
- CS
- 판매 / 통계 (Sales / Statistics)
- 지시서 관리 (Instruction Management)
- 매입/입 관리 (Purchase/Inbound Management)

### Breadcrumb Navigation
홈 > 주문/출고 > 주문수집 > 주문내역 목록

## Statistics Dashboard
**주문 현황** (Order Status) - with upward arrow indicator

Six metric cards displayed horizontally:
1. **총 입금수**: 495 (blue)
2. **적매출**: 17 (black)
3. **출고완가**: 20 (red)
4. **부분출고**: 15 (orange)
5. **매진자가**: 2 (black)
6. **출고완료**: 2137 (green)

Below: "오늘 주입수: 567"

## Filter Section

### Filter Controls (Organized in rows)

**Row 1:**
- **판매처** (Sales Channel): Dropdown with "전체 추가 입력" option
- **판매처 인력**: Dropdown

**Row 2:**
- **입가** (Date): Dropdown set to "수입일자"
- **전품**: Toggle button group
  - Selected: "오늘" (Today)
  - Options: 어제 (Yesterday), 일주일 (Week), 3개월 (3 months), 일일가기간 (Custom period)
- Date range: 2025-06-20 to 2025-06-20 with X clear buttons

**Row 3:**
- **가지수** (Status): Dropdown showing "출고 권한"

**Row 4:**
- **고재** (Type): Radio button group
  - Options: 출고위가 (checked), 부분출고, 완전출고, 매진자가, 적매출, 단재

**Action Button:**
- Orange "검색" (Search) button centered below filters

### View Options
- **총 2건** (Total 2 items)
- **제목 대이젤** checkbox

## Data Table

### Table Headers
| # | 주문일자 | 판매처 | 주문판호<br>전권번호 | 상품 | 이권자 | 수량 | 가능 | 금액 | 주문자/수정자 | 배송방법 | C/S 상태 |
|---|---------|--------|-------------------|------|--------|------|------|------|-------------|---------|----------|

### Table Rows (5 entries shown)

**Row 1:**
- #: 5
- 주문일자: 2025-06-20
- 판매처: [Logo icon] ----
- 주문판호: 20250609-0002382
  - 수배수: 매일아트프로
  - 전권번호: 010-3495-0000
- 상품: [Product image showing 3 bottles] 베이코비프로 빵에스트폴 미역 세수 10ml
  - 매일아트프로 세수 15ml 신선
  - 수입수량: 이상가 1 이상권
- 이권자: 입력하장, 주의수지, 스입가지
- 수량: 1
- 가능: ---
- 금액: 50,500원
- 주문자/수정자: 아승해 / 김관호 2
  - 판가: 50,500
  - [출입간호 알림] button
- 배송방법: 단채
- C/S 상태: 메모추가 button

**Rows 2-5:** Similar structure with identical product information, varying quantities (1, 5, 1, 1) and customer names

### Product Information Pattern
Each row shows:
- Product image (3 bottles)
- Product name: 베이코비프로 빵에스트폴 미역 세수 10ml
- Seller: 매일아트프로 세수 15ml 신선
- Status indicators: 이상가 (unit price issue) and 이상권 (quantity issue)

### Footer
"페이지네이션" (Pagination) - centered at bottom

## Right Panel (Information/Help Text)
**Title:** 지내송 주문내역 목록

**Section Headers with Content:**
1. **자동으로 부분출고로 분리된 전매송 상품 조회**
2. **이매일리**
3. **작업 업무 안내**
4. **수입권적 업무안내**
5. **출입업무 안내**

Contains detailed Korean text instructions for various order management processes, including warnings in red text about specific business rules and procedures.

## Color Scheme
- **Primary Navigation**: Dark navy (#1a1f3a)
- **Active State**: Purple/blue highlight
- **Accent**: Orange (search button)
- **Status Colors**:
  - Blue (총 입금수)
  - Red (출고완가)
  - Orange (부분출고)
  - Green (출고완료)
- **Links**: Blue hyperlinks
- **Background**: Light gray/white for main content area
- **Borders**: Light gray table borders

## Key Features
- Real-time order statistics at the top
- Multi-criteria filtering system
- Date range selection with preset options
- Order status radio button filtering
- Detailed order table with product images
- Clickable order numbers and customer information
- Action buttons for each order (출입간호 알림, 메모추가)
- Comprehensive help documentation in right panel
