# Inventory Status Description Document

## Document Title
**재고 현황 목록** (Inventory Status List)

## Document Type
Text-based documentation page with hierarchical information structure

## Content Sections

### Main Section 1: 재고상품 조회 (재고현황 파악)
**Inventory Product Inquiry (Inventory Status Overview)**

#### Subsection: Overview
- 출고건을 자유롭게 조회 협수 있습니다.
- 기본값: 출고요청 상태의 출고건을 조회합니다.

#### Key Concepts:

**판매처** (Sales Outlet)
- 판매처로 등록되는 모든 곳 (자사몰, 스마트스토어, 쿠팡 외 3파넬별, 리츠슘 등)

**조회기간** (Inquiry Period)
- 출고요청일 / 출고 회랑일 (자급 당영은 없어도 팀 항목일수 있음)

**진행상태** (Progress Status)
- 출고요청 / 출고 지시 / 출고작업중 / 출고완료 / 출고 취소

**출고방식** (Outbound Method)
- 판매 / 달빌 (자급 당영은 시행하지 않지만 추가가능함)

**발주회사** (Ordering Company)
- 판매는 쿠월 발주하는 개념을 도입하지 않아 주급 확정을 취하로 본다면 회차별로 가능함

**출고회차** (Outbound Batch)
- 당일 생성된 출고회차만큼
- 전체선택 / 1차 .....

**발주터미널** (Order Terminal)
- 발주 터미널은 주급 확정 필드의 없어서 근이 나늘 필요가 없나 하는 향목

**출고지시** (Outbound Instruction)
- 선택 출고건을 한 회차로 출고지시

**입고출고지시** (Inbound/Outbound Instruction)
- 조회된 모든 출고건을 20개씩 묶어서 출고지시

---

### Important Notes Section (Red Text Header)
**중요 노티스**

#### Critical Points:
1. **출고지시 = 승낙완료**
   - 구스를문가 개념하는 시점이 어디일지 정리체해야합니다.

2. **출고지시 = 송장발행**
   - 구스를문가 개념하는 시점이 어디일지 정리체해야합니다. 아니기 때문에 간소화도 가능합니다.

3. **필드코드드 / 오더코드 정리가 필요함**
   - 쿠월방주의 개념으로 새로운 테이블에 저장되어할수 있지만
   - 그렇게 까지 대규모의 창고는 아니기때문에 간소화도 가능함니다 보면

## Visual Structure

### Typography
- Main headers in bold, larger font
- Subsection headers in bold
- Body text in regular weight
- Important notes in red text

### Organization
- Hierarchical structure with clear indentation
- Bullet points for list items
- Parenthetical explanations for context
- Sequential numbering for critical points

### Color Scheme
- **Headers**: Black text
- **Body Text**: Dark gray
- **Important Notes Header**: Red text
- **Background**: White

## Document Purpose
This appears to be internal documentation or specifications for the inventory status inquiry system, explaining:
- How to query inventory products
- What each field and status means
- System behavior and business rules
- Important considerations and notes for implementation

## Key Terminology Defined
- 판매처 (Sales outlets/channels)
- 조회기간 (Inquiry period)
- 진행상태 (Progress status)
- 출고방식 (Outbound methods)
- 발주회사 (Ordering company)
- 출고회차 (Outbound batch)
- 발주터미널 (Order terminal)
- 출고지시 (Outbound instruction)
- 입고출고지시 (Inbound/outbound instruction)

## Important Warnings
The red "중요 노티스" section highlights critical system behavior regarding:
- The timing of outbound instructions
- Differences between instruction confirmation and shipping label generation
- Need for field code and order code organization
- Scalability considerations for warehouse operations
