# 세금계산서 프론트엔드 기능 가이드

> **작성일**: 2025-11-20  
> **대상**: 프론트엔드 개발자  
> **백엔드 API**: Wallet 서비스 세금계산서 모듈

---

## 📚 목차

1. [개요](#개요)
2. [사용자 기능 (일반 회원용)](#사용자-기능-일반-회원용)
3. [관리자 기능 (어드민용)](#관리자-기능-어드민용)
4. [홈택스 엑셀 생성 가이드](#홈택스-엑셀-생성-가이드)
5. [상태 전이 흐름](#상태-전이-흐름)
6. [에러 처리](#에러-처리)
7. [UI/UX 권장사항](#uiux-권장사항)

---

## 개요

### 세금계산서 시스템 구조

```
[사용자] ──┐
           ├─> [Wallet API] ─> [세금계산서 DB]
[어드민] ──┘         │
                     └─> [OMS] (주문 정보)
```

### 핵심 개념

- **SoT (Single Source of Truth)**
  - 세금계산서 정보: Wallet 서비스
  - 주문/품목 정보: OMS 서비스
  - 공급자(우리 회사) 정보: Wallet 상수

- **상태 관리**: DRAFT → EXPORTED → ISSUED → (CANCELLED)
- **멱등성**: 같은 주문에 대해 중복 신청 불가
- **스냅샷**: 발행 시점의 모든 데이터를 JSON으로 저장
- **감사 로그**: 모든 상태 변경 기록

---

## 사용자 기능 (일반 회원용)

### 1. 세금계산서 신청 🆕

**화면**: 주문 상세 페이지 또는 마이페이지

#### API
```http
POST /wallet/tax-invoices
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "orderId": "order_abc123",
  "businessInfo": {
    "businessNumber": "123-45-67890",
    "name": "테스트 주식회사",
    "ownerName": "홍길동",
    "address": "서울시 강남구 테헤란로 123",
    "businessType": "도소매업",
    "businessItem": "화장품",
    "email": "tax@example.com"
  },
  "supplyDate": "2025-01-15",
  "saveAsDefault": true
}
```

#### 응답
```json
{
  "success": true,
  "data": {
    "id": "uuid...",
    "userId": "user_123",
    "orderId": "order_abc123",
    "status": "DRAFT",
    "supplyDate": "2025-01-15",
    "supplyAmount": 100000,
    "taxAmount": 10000,
    "totalAmount": 110000,
    "businessNumber": "123-45-67890",
    "businessName": "테스트 주식회사",
    "businessOwnerName": "홍길동",
    "businessAddress": "서울시 강남구 테헤란로 123",
    "createdAt": "2025-01-15T10:00:00Z"
  }
}
```

#### UI 구현 예시
```tsx
// 세금계산서 신청 버튼
<Button onClick={handleRequestTaxInvoice}>
  세금계산서 신청
</Button>

// 신청 모달
<TaxInvoiceRequestModal
  orderId={order.id}
  defaultBusinessInfo={savedBusinessInfo}
  onSuccess={() => {
    toast.success('세금계산서가 신청되었습니다.');
    router.push('/mypage/tax-invoices');
  }}
/>
```

#### 입력 폼 필드
- 사업자등록번호 (10자리, xxx-xx-xxxxx)
- 상호
- 대표자명
- 사업장 주소
- 업태 (선택)
- 종목 (선택)
- 이메일 (선택)
- 공급일자 (기본값: 주문 완료일)
- ☑️ 기본 정보로 저장

---

### 2. 내 세금계산서 목록 조회 📋

**화면**: 마이페이지 > 세금계산서 관리

#### API
```http
GET /wallet/tax-invoices?page=1&limit=10&status=ISSUED
Authorization: Bearer {JWT}
```

#### 쿼리 파라미터
- `page`: 페이지 번호 (기본 1)
- `limit`: 페이지당 개수 (기본 10)
- `status`: DRAFT | EXPORTED | ISSUED | CANCELLED | FAILED
- `fromDate`: YYYY-MM-DD
- `toDate`: YYYY-MM-DD

#### 응답
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid...",
        "orderId": "order_abc123",
        "status": "ISSUED",
        "supplyDate": "2025-01-15",
        "totalAmount": 110000,
        "businessName": "테스트 주식회사",
        "createdAt": "2025-01-15T10:00:00Z",
        "issuedAt": "2025-01-16T09:00:00Z"
      }
    ],
    "total": 15,
    "page": 1,
    "totalPages": 2
  }
}
```

#### UI 구현 예시
```tsx
<TaxInvoiceList>
  <Filters>
    <StatusFilter />
    <DateRangeFilter />
  </Filters>
  
  <Table>
    <Row>
      <Cell>공급일자</Cell>
      <Cell>상호</Cell>
      <Cell>금액</Cell>
      <Cell>상태</Cell>
      <Cell>작업</Cell>
    </Row>
    {invoices.map(invoice => (
      <Row key={invoice.id}>
        <Cell>{invoice.supplyDate}</Cell>
        <Cell>{invoice.businessName}</Cell>
        <Cell>{invoice.totalAmount.toLocaleString()}원</Cell>
        <Cell><StatusBadge status={invoice.status} /></Cell>
        <Cell>
          <Button onClick={() => viewDetail(invoice.id)}>
            상세보기
          </Button>
        </Cell>
      </Row>
    ))}
  </Table>
  
  <Pagination />
</TaxInvoiceList>
```

#### 상태별 뱃지 색상 권장
- `DRAFT`: 회색 (작성 중)
- `EXPORTED`: 파란색 (내보내기 완료)
- `ISSUED`: 초록색 (발행 완료)
- `CANCELLED`: 빨간색 (취소됨)
- `FAILED`: 주황색 (발행 실패)

---

### 3. 세금계산서 상세 조회 🔍

**화면**: 세금계산서 상세 페이지

#### API
```http
GET /wallet/tax-invoices/{invoiceId}
Authorization: Bearer {JWT}
```

#### 응답
```json
{
  "success": true,
  "data": {
    "id": "uuid...",
    "userId": "user_123",
    "orderId": "order_abc123",
    "status": "ISSUED",
    "supplyDate": "2025-01-15",
    "supplyAmount": 100000,
    "taxAmount": 10000,
    "totalAmount": 110000,
    "businessNumber": "123-45-67890",
    "businessName": "테스트 주식회사",
    "businessOwnerName": "홍길동",
    "businessAddress": "서울시 강남구 테헤란로 123",
    "createdAt": "2025-01-15T10:00:00Z",
    "issuedAt": "2025-01-16T09:00:00Z",
    "snapshot": {
      "supplier": {
        "businessNumber": "123-45-67890",
        "name": "알몬드영 주식회사",
        "ownerName": "홍길동",
        "address": "서울시 강남구 ...",
        "businessType": "도소매업",
        "businessItem": "화장품 유통",
        "email": "tax@almondyoung.com"
      },
      "buyer": {
        "businessNumber": "123-45-67890",
        "name": "테스트 주식회사",
        "ownerName": "홍길동",
        "address": "서울시 강남구 테헤란로 123"
      },
      "order": {
        "orderId": "order_abc123",
        "completedAt": "2025-01-15T18:00:00Z",
        "status": "COMPLETED",
        "paymentMethod": "CARD",
        "lines": [
          {
            "productName": "상품 A",
            "specification": "100ml",
            "quantity": 2,
            "unitPrice": 50000,
            "amount": 100000
          }
        ]
      },
      "amounts": {
        "supplyAmount": 100000,
        "taxAmount": 10000,
        "totalAmount": 110000,
        "issueDate": "2025-01-15"
      }
    }
  }
}
```

#### UI 구현 예시
```tsx
<TaxInvoiceDetail>
  <Header>
    <Title>세금계산서</Title>
    <StatusBadge status={invoice.status} />
  </Header>
  
  <Section title="공급자 (발행자)">
    <InfoRow label="사업자등록번호" value={snapshot.supplier.businessNumber} />
    <InfoRow label="상호" value={snapshot.supplier.name} />
    <InfoRow label="대표자명" value={snapshot.supplier.ownerName} />
    <InfoRow label="주소" value={snapshot.supplier.address} />
  </Section>
  
  <Section title="공급받는자 (귀하)">
    <InfoRow label="사업자등록번호" value={snapshot.buyer.businessNumber} />
    <InfoRow label="상호" value={snapshot.buyer.name} />
    <InfoRow label="대표자명" value={snapshot.buyer.ownerName} />
    <InfoRow label="주소" value={snapshot.buyer.address} />
  </Section>
  
  <Section title="품목 내역">
    <ProductTable>
      {snapshot.order.lines.map((line, idx) => (
        <Row key={idx}>
          <Cell>{line.productName}</Cell>
          <Cell>{line.specification}</Cell>
          <Cell>{line.quantity}</Cell>
          <Cell>{line.unitPrice.toLocaleString()}</Cell>
          <Cell>{line.amount.toLocaleString()}</Cell>
        </Row>
      ))}
    </ProductTable>
  </Section>
  
  <Section title="금액 정보">
    <AmountRow label="공급가액" value={snapshot.amounts.supplyAmount} />
    <AmountRow label="세액" value={snapshot.amounts.taxAmount} />
    <TotalRow label="합계" value={snapshot.amounts.totalAmount} />
  </Section>
  
  <Footer>
    <Button onClick={handlePrint}>인쇄</Button>
    {invoice.status === 'ISSUED' && (
      <Button onClick={handleDownloadPDF}>PDF 다운로드</Button>
    )}
  </Footer>
</TaxInvoiceDetail>
```

---

### 4. 기본 사업자 정보 관리 ⚙️

**화면**: 마이페이지 > 설정 > 세금계산서 기본 정보

#### 조회 API
```http
GET /wallet/tax-invoices/preferences
Authorization: Bearer {JWT}
```

#### 응답
```json
{
  "success": true,
  "data": {
    "businessNumber": "123-45-67890",
    "name": "테스트 주식회사",
    "ownerName": "홍길동",
    "address": "서울시 강남구 테헤란로 123",
    "businessType": "도소매업",
    "businessItem": "화장품",
    "email": "tax@example.com"
  }
}
```

#### 저장 API
```http
PUT /wallet/tax-invoices/preferences
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "businessInfo": {
    "businessNumber": "123-45-67890",
    "name": "테스트 주식회사",
    "ownerName": "홍길동",
    "address": "서울시 강남구 테헤란로 123",
    "businessType": "도소매업",
    "businessItem": "화장품",
    "email": "tax@example.com"
  }
}
```

#### UI 구현 예시
```tsx
<PreferencesForm>
  <Title>기본 사업자 정보</Title>
  <Description>
    세금계산서 신청 시 자동으로 입력될 정보입니다.
  </Description>
  
  <Input
    label="사업자등록번호"
    name="businessNumber"
    placeholder="000-00-00000"
    maxLength={12}
    required
  />
  
  <Input label="상호" name="name" required />
  <Input label="대표자명" name="ownerName" required />
  <Input label="사업장 주소" name="address" required />
  <Input label="업태" name="businessType" />
  <Input label="종목" name="businessItem" />
  <Input label="이메일" name="email" type="email" />
  
  <Button type="submit">저장</Button>
</PreferencesForm>
```

---

## 관리자 기능 (어드민용)

### 5. 전체 세금계산서 목록 조회 (관리자) 📊

**화면**: 관리자 > 세금계산서 관리

#### API
```http
GET /wallet/admin/tax-invoices?page=1&limit=20&status=DRAFT&fromDate=2025-01-01
Authorization: Bearer {JWT}
```

#### 쿼리 파라미터
- `page`, `limit`, `status`, `fromDate`, `toDate` (사용자 API와 동일)
- `userId`: 특정 사용자 필터링

#### UI 구현 예시
```tsx
<AdminTaxInvoiceList>
  <Filters>
    <SearchInput placeholder="사용자 ID 검색" />
    <StatusFilter />
    <DateRangeFilter />
    <Button onClick={handleExport}>엑셀 내보내기</Button>
  </Filters>
  
  <Table>
    <Row>
      <Checkbox /> {/* 일괄 선택 */}
      <Cell>ID</Cell>
      <Cell>사용자</Cell>
      <Cell>주문ID</Cell>
      <Cell>상호</Cell>
      <Cell>금액</Cell>
      <Cell>상태</Cell>
      <Cell>신청일</Cell>
      <Cell>작업</Cell>
    </Row>
    {invoices.map(invoice => (
      <Row key={invoice.id}>
        <Checkbox value={invoice.id} />
        <Cell>{invoice.id.slice(0, 8)}...</Cell>
        <Cell>{invoice.userId}</Cell>
        <Cell>{invoice.orderId}</Cell>
        <Cell>{invoice.businessName}</Cell>
        <Cell>{invoice.totalAmount.toLocaleString()}원</Cell>
        <Cell><StatusBadge status={invoice.status} /></Cell>
        <Cell>{formatDate(invoice.createdAt)}</Cell>
        <Cell>
          <ActionMenu invoice={invoice} />
        </Cell>
      </Row>
    ))}
  </Table>
</AdminTaxInvoiceList>
```

---

### 6. 세금계산서 일괄 내보내기 📤

**화면**: 관리자 > 세금계산서 관리 > 일괄 작업

**용도**: DRAFT 상태의 세금계산서들을 홈택스 등록 준비 상태로 변경

#### API
```http
POST /wallet/admin/tax-invoices/export
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "invoiceIds": [
    "uuid-1",
    "uuid-2",
    "uuid-3"
  ]
}
```

#### 응답
```json
{
  "success": true,
  "data": {
    "totalRequested": 3,
    "successCount": 2,
    "failureCount": 1,
    "results": [
      {
        "invoiceId": "uuid-1",
        "success": true
      },
      {
        "invoiceId": "uuid-2",
        "success": true
      },
      {
        "invoiceId": "uuid-3",
        "success": false,
        "error": "이미 내보내기된 세금계산서입니다"
      }
    ]
  }
}
```

#### UI 구현 예시
```tsx
const handleBulkExport = async () => {
  const selectedIds = getSelectedInvoiceIds();
  
  if (selectedIds.length === 0) {
    toast.warning('내보낼 세금계산서를 선택해주세요.');
    return;
  }
  
  const result = await exportTaxInvoices(selectedIds);
  
  toast.success(
    `${result.successCount}건 내보내기 완료, ${result.failureCount}건 실패`
  );
  
  // 실패 건 상세 표시
  if (result.failureCount > 0) {
    showFailureDetails(result.results.filter(r => !r.success));
  }
  
  refetchList();
};
```

---

### 7. 홈택스 엑셀 데이터 조회 📥

**화면**: 관리자 > 세금계산서 관리 > 홈택스 엑셀 생성

**용도**: EXPORTED 상태의 세금계산서들을 홈택스 업로드용 엑셀 파일로 변환

#### API
```http
GET /wallet/admin/tax-invoices/export/candidates?fromDate=2025-01-15&toDate=2025-01-20
Authorization: Bearer {JWT}
```

#### 응답
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "taxInvoiceId": "uuid-1",
      "orderId": "order_abc123",
      
      "supplierBusinessNumber": "123-45-67890",
      "supplierName": "알몬드영 주식회사",
      "supplierOwnerName": "홍길동",
      "supplierAddress": "서울시 강남구 ...",
      "supplierBusinessType": "도소매업",
      "supplierBusinessItem": "화장품 유통",
      "supplierEmail": "tax@almondyoung.com",
      
      "buyerBusinessNumber": "444-55-66777",
      "buyerName": "테스트 주식회사",
      "buyerOwnerName": "김대표",
      "buyerAddress": "서울시 서초구 ...",
      "buyerBusinessType": "제조업",
      "buyerBusinessItem": "화장품",
      "buyerEmail": "buyer@example.com",
      
      "issueDate": "2025-01-15",
      "supplyAmount": 100000,
      "taxAmount": 10000,
      "totalAmount": 110000,
      
      "productSummary": "상품 A 외 2건",
      "paymentMethod": "신용카드",
      "remark": "테스트 주문"
    }
  ]
}
```

**다음 섹션에서 엑셀 생성 방법 상세 설명**

---

### 8. 세금계산서 일괄 발행 완료 ✅

**화면**: 관리자 > 세금계산서 관리 > 일괄 작업

**용도**: 홈택스에 등록 완료된 세금계산서들을 ISSUED 상태로 변경

#### API
```http
POST /wallet/admin/tax-invoices/issue
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "invoiceIds": [
    "uuid-1",
    "uuid-2"
  ]
}
```

#### 응답 형식
```json
{
  "success": true,
  "data": {
    "totalRequested": 2,
    "successCount": 2,
    "failureCount": 0,
    "results": [...]
  }
}
```

---

### 9. 세금계산서 발행 실패 처리 ❌

**용도**: 홈택스 등록 중 문제가 발생한 경우

#### API
```http
POST /wallet/admin/tax-invoices/{invoiceId}/fail
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "reason": "홈택스 시스템 오류",
  "details": "사업자등록번호 검증 실패"
}
```

---

### 10. 세금계산서 취소 🚫

**용도**: 발행된 세금계산서를 취소 처리

#### API
```http
POST /wallet/admin/tax-invoices/{invoiceId}/cancel
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "reason": "고객 요청에 의한 취소"
}
```

#### UI 구현 예시
```tsx
<CancelModal>
  <Title>세금계산서 취소</Title>
  <Warning>
    세금계산서를 취소하면 되돌릴 수 없습니다.
    홈택스에서도 별도로 취소 처리해야 합니다.
  </Warning>
  
  <Input
    label="취소 사유"
    name="reason"
    required
    placeholder="예: 고객 요청에 의한 취소"
  />
  
  <Actions>
    <Button onClick={onClose}>닫기</Button>
    <Button variant="danger" onClick={handleCancel}>
      취소 처리
    </Button>
  </Actions>
</CancelModal>
```

---

## 홈택스 엑셀 생성 가이드

### 개요

홈택스 전자세금계산서 일괄 업로드를 위한 엑셀 파일을 생성합니다.

### 1단계: 데이터 조회

```typescript
const response = await fetch(
  '/wallet/admin/tax-invoices/export/candidates?fromDate=2025-01-15&toDate=2025-01-20',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

const { data } = await response.json();
// data: HometaxExportRow[]
```

### 2단계: 엑셀 생성 (xlsx 라이브러리 사용)

#### 설치
```bash
npm install xlsx
```

#### 코드 예시
```typescript
import * as XLSX from 'xlsx';

interface HometaxExportRow {
  // ... (API 응답 타입)
}

function generateHometaxExcel(data: HometaxExportRow[]) {
  // 1. 홈택스 양식에 맞게 데이터 변환
  const rows = data.map((row, index) => ({
    '순번': index + 1,
    '작성일자': row.issueDate,
    
    // 공급자 (우리 회사)
    '공급자 사업자등록번호': row.supplierBusinessNumber,
    '공급자 상호': row.supplierName,
    '공급자 대표자명': row.supplierOwnerName,
    '공급자 주소': row.supplierAddress,
    '공급자 업태': row.supplierBusinessType || '',
    '공급자 종목': row.supplierBusinessItem || '',
    '공급자 이메일': row.supplierEmail || '',
    
    // 공급받는자 (고객)
    '공급받는자 사업자등록번호': row.buyerBusinessNumber,
    '공급받는자 상호': row.buyerName,
    '공급받는자 대표자명': row.buyerOwnerName,
    '공급받는자 주소': row.buyerAddress,
    '공급받는자 업태': row.buyerBusinessType || '',
    '공급받는자 종목': row.buyerBusinessItem || '',
    '공급받는자 이메일': row.buyerEmail || '',
    
    // 금액
    '공급가액': row.supplyAmount,
    '세액': row.taxAmount,
    '합계금액': row.totalAmount,
    
    // 기타
    '품목': row.productSummary,
    '결제수단': row.paymentMethod || '',
    '비고': row.remark || '',
  }));
  
  // 2. 워크시트 생성
  const worksheet = XLSX.utils.json_to_sheet(rows);
  
  // 3. 컬럼 너비 설정 (선택사항)
  worksheet['!cols'] = [
    { wch: 5 },  // 순번
    { wch: 12 }, // 작성일자
    { wch: 15 }, // 사업자등록번호
    { wch: 20 }, // 상호
    { wch: 10 }, // 대표자명
    { wch: 40 }, // 주소
    { wch: 12 }, // 업태
    { wch: 12 }, // 종목
    { wch: 25 }, // 이메일
    // ... (나머지 컬럼)
  ];
  
  // 4. 워크북 생성
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '세금계산서');
  
  // 5. 파일 다운로드
  const fileName = `세금계산서_${data[0]?.issueDate || 'export'}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  
  return fileName;
}
```

### 3단계: UI 구현

```tsx
const ExportButton = () => {
  const [loading, setLoading] = useState(false);
  
  const handleExport = async () => {
    try {
      setLoading(true);
      
      // 1. 데이터 조회
      const response = await fetch(
        '/wallet/admin/tax-invoices/export/candidates' +
        `?fromDate=${fromDate}&toDate=${toDate}`
      );
      
      const { data, count } = await response.json();
      
      if (count === 0) {
        toast.warning('내보낼 세금계산서가 없습니다.');
        return;
      }
      
      // 2. 엑셀 생성
      const fileName = generateHometaxExcel(data);
      
      toast.success(
        `${count}건의 세금계산서가 엑셀로 다운로드되었습니다.`
      );
      
    } catch (error) {
      console.error(error);
      toast.error('엑셀 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Button
      onClick={handleExport}
      disabled={loading}
      icon={<DownloadIcon />}
    >
      {loading ? '생성 중...' : '홈택스 엑셀 다운로드'}
    </Button>
  );
};
```

### 홈택스 업로드 프로세스

```
1. [어드민] DRAFT 세금계산서 선택
2. [어드민] "일괄 내보내기" 클릭 → EXPORTED 상태로 변경
3. [어드민] "홈택스 엑셀 다운로드" 클릭
4. [어드민] 홈택스 사이트 접속
5. [어드민] 전자세금계산서 일괄 업로드 메뉴
6. [어드민] 생성된 엑셀 파일 업로드
7. [홈택스] 검증 및 등록
8. [어드민] "일괄 발행 완료" 클릭 → ISSUED 상태로 변경
```

---

## 상태 전이 흐름

### 상태 다이어그램

```
[주문 완료] 
    ↓
[사용자: 세금계산서 신청]
    ↓
┌─────────┐
│  DRAFT  │ ← 작성 중
└─────────┘
    ↓ [어드민: 일괄 내보내기]
┌──────────┐
│ EXPORTED │ ← 내보내기 완료 (홈택스 등록 대기)
└──────────┘
    ↓ [어드민: 일괄 발행 완료]
┌─────────┐
│ ISSUED  │ ← 발행 완료 ✅
└─────────┘
    ↓ (필요시)
┌───────────┐
│ CANCELLED │ ← 취소됨
└───────────┘

※ EXPORTED → FAILED 도 가능 (홈택스 등록 실패 시)
```

### 허용되는 상태 전이

| 현재 상태 | 다음 상태 | 액션 | 권한 |
|---------|---------|------|------|
| DRAFT | EXPORTED | 일괄 내보내기 | 어드민 |
| EXPORTED | ISSUED | 발행 완료 | 어드민 |
| EXPORTED | FAILED | 발행 실패 | 어드민 |
| ISSUED | CANCELLED | 취소 | 어드민 |
| FAILED | DRAFT | 재작성 | 어드민 |

### 상태별 사용자 행동

| 상태 | 사용자 가능 행동 | 어드민 가능 행동 |
|------|---------------|---------------|
| DRAFT | 상세 조회 | 내보내기, 삭제 |
| EXPORTED | 상세 조회 | 발행 완료, 발행 실패 |
| ISSUED | 상세 조회, 인쇄, PDF | 취소 |
| CANCELLED | 상세 조회 | - |
| FAILED | 상세 조회 | 재작성 |

---

## 에러 처리

### 공통 에러 응답 형식

```json
{
  "success": false,
  "error": "주문 정보를 확인할 수 없습니다"
}
```

### 주요 에러 케이스

#### 1. 중복 신청
```json
{
  "success": false,
  "error": "이미 해당 주문에 대한 세금계산서가 신청되었습니다"
}
```

**UI 처리**
```tsx
if (error.includes('이미 해당 주문')) {
  toast.error('이미 신청된 주문입니다.');
  // 기존 세금계산서 페이지로 이동
  router.push(`/mypage/tax-invoices/${existingInvoiceId}`);
}
```

#### 2. 잘못된 상태 전이
```json
{
  "success": false,
  "error": "ISSUED 상태에서는 EXPORTED 상태로 변경할 수 없습니다"
}
```

**UI 처리**
```tsx
if (error.includes('상태로 변경할 수 없습니다')) {
  toast.error('현재 상태에서는 해당 작업을 수행할 수 없습니다.');
  refetchData(); // 최신 상태 다시 조회
}
```

#### 3. 권한 없음
```json
{
  "success": false,
  "error": "Unauthorized"
}
```

**UI 처리**
```tsx
if (response.status === 401) {
  toast.error('로그인이 필요합니다.');
  router.push('/login');
}
```

#### 4. 주문 정보 없음
```json
{
  "success": false,
  "error": "주문 정보를 확인할 수 없습니다"
}
```

---

## UI/UX 권장사항

### 1. 상태별 액션 버튼 표시

```tsx
function TaxInvoiceActions({ invoice, isAdmin }) {
  const actions = useMemo(() => {
    const baseActions = [
      { label: '상세보기', onClick: () => viewDetail(invoice.id) }
    ];
    
    if (invoice.status === 'ISSUED') {
      baseActions.push(
        { label: '인쇄', onClick: () => print(invoice.id) },
        { label: 'PDF', onClick: () => downloadPDF(invoice.id) }
      );
    }
    
    if (isAdmin) {
      if (invoice.status === 'DRAFT') {
        baseActions.push({ 
          label: '내보내기', 
          onClick: () => exportInvoice(invoice.id) 
        });
      }
      
      if (invoice.status === 'EXPORTED') {
        baseActions.push(
          { label: '발행 완료', onClick: () => markAsIssued(invoice.id) },
          { label: '발행 실패', onClick: () => markAsFailed(invoice.id) }
        );
      }
      
      if (invoice.status === 'ISSUED') {
        baseActions.push({ 
          label: '취소', 
          onClick: () => cancelInvoice(invoice.id),
          variant: 'danger'
        });
      }
    }
    
    return baseActions;
  }, [invoice, isAdmin]);
  
  return (
    <ActionMenu actions={actions} />
  );
}
```

### 2. 필터 기본값

- **사용자**: 최근 1년, 모든 상태
- **어드민**: 최근 1개월, DRAFT + EXPORTED (처리 필요한 건만)

### 3. 알림 문구

```tsx
const NOTIFICATION_MESSAGES = {
  CREATED: '세금계산서가 신청되었습니다. 발행까지 영업일 기준 2-3일 소요됩니다.',
  ISSUED: '세금계산서가 발행되었습니다. 마이페이지에서 확인하실 수 있습니다.',
  CANCELLED: '세금계산서가 취소되었습니다.',
  FAILED: '세금계산서 발행에 실패했습니다. 고객센터로 문의해주세요.',
};
```

### 4. 로딩 상태

```tsx
// 일괄 작업 시 진행률 표시
<Progress
  current={processedCount}
  total={totalCount}
  message={`${processedCount} / ${totalCount} 처리 중...`}
/>
```

### 5. 빈 상태 안내

```tsx
<EmptyState
  icon={<InvoiceIcon />}
  title="세금계산서가 없습니다"
  description="주문 완료 후 세금계산서를 신청하실 수 있습니다."
  action={
    <Button onClick={() => router.push('/orders')}>
      주문 내역 보기
    </Button>
  }
/>
```

### 6. 반응형 디자인

- **모바일**: 카드 형식 리스트
- **태블릿**: 간소화된 테이블
- **데스크톱**: 전체 정보 테이블

### 7. 접근성 (a11y)

```tsx
<Button
  aria-label="세금계산서 상세보기"
  aria-describedby={`invoice-${invoice.id}`}
>
  상세보기
</Button>

<StatusBadge
  status={invoice.status}
  aria-label={`상태: ${STATUS_LABELS[invoice.status]}`}
/>
```

---

## 구현 체크리스트

### 사용자 화면
- [ ] 세금계산서 신청 버튼 (주문 상세 페이지)
- [ ] 세금계산서 신청 모달/폼
- [ ] 기본 정보 저장 체크박스
- [ ] 내 세금계산서 목록 (마이페이지)
- [ ] 세금계산서 상세 페이지
- [ ] 인쇄 기능
- [ ] PDF 다운로드 (선택)
- [ ] 기본 사업자 정보 설정 페이지
- [ ] 상태별 필터링
- [ ] 날짜 범위 필터링
- [ ] 페이지네이션

### 관리자 화면
- [ ] 전체 세금계산서 목록
- [ ] 사용자 ID 검색
- [ ] 일괄 선택 (체크박스)
- [ ] 일괄 내보내기 버튼
- [ ] 홈택스 엑셀 다운로드 버튼
- [ ] 일괄 발행 완료 버튼
- [ ] 개별 발행 실패 처리
- [ ] 개별 취소 처리
- [ ] 상태 변경 히스토리 (선택)
- [ ] 통계 대시보드 (선택)

### 공통
- [ ] 에러 토스트 알림
- [ ] 성공 토스트 알림
- [ ] 로딩 인디케이터
- [ ] 빈 상태 UI
- [ ] 반응형 디자인
- [ ] 접근성 대응

---

## FAQ

### Q1: 세금계산서를 수정할 수 있나요?
**A**: 아니요. 세금계산서는 작성 후 수정이 불가능합니다. 잘못 신청한 경우 어드민에서 취소 후 재신청해야 합니다.

### Q2: 한 주문에 여러 세금계산서를 발행할 수 있나요?
**A**: 아니요. 한 주문당 하나의 세금계산서만 발행 가능합니다 (멱등성 보장).

### Q3: 발행 완료까지 얼마나 걸리나요?
**A**: 
1. 사용자 신청 → DRAFT (즉시)
2. 어드민 내보내기 → EXPORTED (수동)
3. 홈택스 등록 (어드민 작업)
4. 어드민 발행 완료 → ISSUED (수동)

일반적으로 영업일 기준 2-3일 소요됩니다.

### Q4: 모바일에서도 신청할 수 있나요?
**A**: 네, 반응형 디자인으로 구현하면 모든 디바이스에서 신청 가능합니다.

### Q5: 엑셀 생성이 실패하면 어떻게 하나요?
**A**: 프론트엔드에서 `try-catch`로 처리하고, 에러 로그를 남긴 후 사용자에게 재시도 안내를 표시하세요.

---

## 참고 자료

- [홈택스 전자세금계산서 안내](https://www.hometax.go.kr/)
- [세금계산서 발급 의무 안내](https://www.nts.go.kr/)
- XLSX 라이브러리: https://www.npmjs.com/package/xlsx

---

**문서 버전**: 1.0  
**최종 수정**: 2025-11-20  
**작성자**: Backend Team

백엔드 API 관련 문의: `tech@almondyoung.com`

