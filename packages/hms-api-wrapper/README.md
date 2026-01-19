# HMS API Wrapper

효성 CMS(Hyosung CMS) API를 TypeScript로 래핑한 라이브러리입니다.

## 설치

```bash
npm install hms-api-wrapper
```

## 목업 서버 (개발/테스트용)

개발 및 테스트 환경에서 실제 API 대신 목업 서버를 사용할 수 있습니다.

### 목업 서버 실행

```bash
# 별도 레포지토리에서 목업 서버 실행
cd batchcms-mock-server
npm install
npm run dev
```

### 목업 API 사용

```typescript
import { ApiClientFactory } from "hms-api-wrapper";

// 환경 변수로 목업 사용 설정
process.env.USE_MOCK = "true";
process.env.MOCK_SERVER_URL = "http://localhost:3001";

// 실제 API와 동일한 방식으로 사용
const api = ApiClientFactory.createFromEnv();

// 사용법은 실제 API와 완전히 동일
const member = await api.members.create({
  memberId: "MEMBER-001",
  memberName: "홍길동",
  // ... 기타 필드
});
```

### 환경별 설정

```bash
# .env.development
USE_MOCK=true
MOCK_SERVER_URL=http://localhost:3005

# .env.production
USE_MOCK=false
```

## 사용법

### 기본 설정

```typescript
import { HmsAPI } from "hms-api-wrapper";

const hmsAPI = new HmsAPI({
  swKey: "YOUR_SW_KEY",
  custKey: "YOUR_CUST_KEY",
  isTest: true, // 테스트 환경 사용
  timeout: 30000,
});
```

### 목업 API 사용 (개발/테스트)

```typescript
import { ApiClientFactory } from "hms-api-wrapper";

// 환경 변수로 목업 사용 설정
process.env.USE_MOCK = "true";
process.env.MOCK_SERVER_URL = "http://localhost:3001";

// 실제 API와 동일한 방식으로 사용
const api = ApiClientFactory.createFromEnv();

// 또는 직접 설정
const api = ApiClientFactory.create({
  swKey: "mock-sw-key",
  custKey: "mock-cust-key",
  isTest: true,
  useMock: true,
  mockServerUrl: "http://localhost:3005"
});
```

## 기능

### 1. 결제 프로필 관리

```typescript
// 회원 등록
const profile = await hmsAPI.paymentProfiles.create({
  memberId: "MEMBER-01",
  memberName: "홍길동",
  phone: "01012345678",
  paymentKind: "CARD",
  paymentNumber: "1234567890123456",
  payerName: "홍길동",
  payerNumber: "1234567890",
  validYear: "25",
  validMonth: "12",
});

// 회원 조회
const member = await hmsAPI.paymentProfiles.get("MEMBER-01");
```

### 2. 결제 거래 처리

```typescript
// 결제 승인 요청
const payment = await hmsAPI.paymentTryansactions.requestTryansaction({
  transactionId: "TXN-001",
  memberId: "MEMBER-01",
  callAmount: 10000,
});

// 결제 취소
const cancel = await hmsAPI.paymentTryansactions.cancelTryansaction("TXN-001");
```

### 3. 배치 CMS 회원 관리

```typescript
// CMS 회원 등록
const member = await hmsAPI.members.create({
  memberId: "MEMBER-01",
  memberName: "홍길동",
  payerName: "홍길동",
  paymentKind: "CMS",
  paymentCompany: "088", // 신한은행
  paymentNumber: "1234567890123456",
  payerNumber: "1234567890",
  phone: "01012345678",
});

// CMS 회원 조회
const memberInfo = await hmsAPI.members.get("MEMBER-01");
```

### 4. 동의자료 관리 ⭐ NEW!

```typescript
import * as fs from "fs/promises";

// 동의자료 등록
const fileBuffer = await fs.readFile("agreement.jpg");
const registration = await hmsAPI.agreements.register("CUST-001", "MEMBER-01", {
  file: fileBuffer,
  filename: "agreement.jpg",
});

console.log("등록된 동의자료 키:", registration.agreementFile.agreementKey);

// 동의자료 조회
const agreementInfo = await hmsAPI.agreements.get(
  "CUST-001",
  registration.agreementFile.agreementKey
);

console.log("동의자료 상태:", agreementInfo.agreementFile.registerStatus);

// 독립적인 동의자료 조회 (이미 등록된 동의자료)
const existingAgreementInfo = await hmsAPI.agreements.get(
  "CUST-001",
  "1000000000000000000001" // 기존에 등록된 agreementKey
);

console.log("기존 동의자료 정보:", existingAgreementInfo.agreementFile);
```

### 5. 출금 관리 ⭐ NEW!

````typescript
// 출금 신청
const transactionId = `TX-${new Date().getTime()}`; // 고유 ID 생성
const requestResponse = await hmsAPI.withdrawals.request({
  transactionId: transactionId,
  memberId: 'MEMBER-01',
  paymentDate: '20250125', // YYYYMMDD 형식
  callAmount: 10000,
});

console.log('출금 신청 성공! 상태:', requestResponse.payment.status);

// 출금 수정 (마감 전에만 가능)
if (requestResponse.payment.status === '출금대기') {
  const updateResponse = await hmsAPI.withdrawals.update(transactionId, {
    paymentDate: '20250128', // 출금일 변경
    callAmount: 15000,       // 금액 변경
  });

  console.log('출금 수정 성공! 변경된 금액:', updateResponse.payment.callAmount);
}

#### 브라우저 환경에서 사용

```typescript
// 파일 input에서 선택된 파일
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const file = fileInput.files?.[0];

if (file) {
  const registration = await hmsAPI.agreements.register(
    'CUST-001',
    'MEMBER-01',
    {
      file: file,
      filename: file.name,
    }
  );
}
````

## API 참조

### HmsAPI

메인 클래스로 모든 서비스의 진입점입니다.

#### 생성자

```typescript
constructor(options: HttpClientConfig)
```

#### 속성

- `paymentProfiles`: PaymentProfileService - 결제 프로필 관리
- `paymentTryansactions`: PaymentTryansactionService - 결제 거래 처리
- `members`: MemberService - 배치 CMS 회원 관리
- `agreements`: ConsentService - 동의자료 관리
- `withdrawals`: WithdrawalService - 출금 관리

### HttpClientConfig

```typescript
interface HttpClientConfig {
  swKey: string; // 연동기관 키
  custKey: string; // 이용기관 키
  isTest?: boolean; // 테스트 환경 사용 여부 (기본값: false)
  timeout?: number; // 타임아웃 (기본값: 30000ms)
  baseURL?: string; // 커스텀 Base URL (선택사항)
}
```

## 에러 처리

```typescript
try {
  const result = await hmsAPI.paymentProfiles.create(profileData);
} catch (error) {
  if (error instanceof HsFmsError) {
    console.error("API 에러:", error.error.message);
    console.error("개발자 메시지:", error.error.developerMessage);
  } else {
    console.error("네트워크 에러:", error);
  }
}
```

## 개발

### 설치

```bash
npm install
```

### 빌드

```bash
npm run build
```

### 테스트

```bash
# 모든 테스트 실행
npm test

# 단위 테스트만 실행
npm run test:unit

# 통합 테스트만 실행
npm run test:all

# 테스트 커버리지 확인
npm run test:coverage
```

### 개발 모드

```bash
npm run dev
```

## 라이선스

ISC
