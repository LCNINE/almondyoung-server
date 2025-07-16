# HMS API NestJS 서비스 분리 가이드

## 개요

이 프로젝트에서는 HMS API를 NestJS 서비스 패턴으로 분리하여 사용합니다:
- **카드결제 기능**: 실제 HMS API 사용 (`CardPaymentProfileService`, `CardPaymentTransactionService`)
- **배치 CMS 기능**: 목업서버 사용 (`BatchCmsMemberService`, `BatchCmsAgreementService`, `BatchCmsWithdrawalService`)

## 아키텍처

```
PaymentMethodService
├── 카드결제 서비스들 (실제 HMS API)
│   ├── CardPaymentProfileService
│   └── CardPaymentTransactionService
└── 배치 CMS 서비스들 (목업서버)
    ├── BatchCmsMemberService
    ├── BatchCmsAgreementService
    └── BatchCmsWithdrawalService
```

## 환경 설정

### 1. 환경 변수 설정

```bash
# HMS API 인증 정보
HMS_SW_KEY=your-sw-key-here
HMS_CUST_KEY=your-cust-key-here

# 배치 CMS 목업서버 사용 여부
USE_MOCK_BATCH_CMS=true

# 목업서버 URL
MOCK_SERVER_URL=http://localhost:3005

# 환경 설정
NODE_ENV=development
```

### 2. 목업서버 실행

배치 CMS 기능을 테스트하려면 목업서버를 실행해야 합니다:

```bash
cd hms-api-wrapper
npm run mock-server
```

## 사용 방법

### 카드결제 기능 (실제 API)

```typescript
// 카드 결제 프로필 생성
const profileResult = await paymentMethodService.createCardPaymentProfile({
  customerId: 'customer123',
  cardNumber: '1234-5678-9012-3456',
  // ... 기타 카드 정보
});

// 카드 결제 실행
const paymentResult = await paymentMethodService.executeCardPayment({
  profileId: profileResult.profileId,
  amount: 10000,
  // ... 기타 거래 정보
});
```

### 배치 CMS 기능 (목업서버)

```typescript
// 회원 생성
const memberResult = await paymentMethodService.createBatchCmsMember({
  name: '홍길동',
  email: 'hong@example.com',
  // ... 기타 회원 정보
});

// 동의서 등록
const agreementResult = await paymentMethodService.registerBatchCmsAgreement(
  'custId123',
  'memberId456',
  {
    file: fileBuffer,
    filename: 'agreement.pdf'
  }
);

// 출금 요청
const withdrawalResult = await paymentMethodService.requestBatchCmsWithdrawal({
  memberId: 'memberId456',
  amount: 50000,
  // ... 기타 출금 정보
});
```

## 의존성 주입 구조

```typescript
@Injectable()
export class PaymentMethodService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly bnplService: BnplService,
    // 카드 결제 서비스들 (실제 HMS API)
    private readonly cardPaymentProfileService: CardPaymentProfileService,
    private readonly cardPaymentTransactionService: CardPaymentTransactionService,
    // 배치 CMS 서비스들 (목업서버)
    private readonly batchCmsMemberService: BatchCmsMemberService,
    private readonly batchCmsAgreementService: BatchCmsAgreementService,
    private readonly batchCmsWithdrawalService: BatchCmsWithdrawalService,
  ) {}
}
```

### 모듈 설정

```typescript
@Module({
  imports: [SharedModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    BnplService,
    // 카드 결제 서비스들 (실제 HMS API)
    CardPaymentProfileService,
    CardPaymentTransactionService,
    // 배치 CMS 서비스들 (목업서버)
    BatchCmsMemberService,
    BatchCmsAgreementService,
    BatchCmsWithdrawalService,
  ],
  exports: [PaymentMethodService, BnplService],
})
export class PaymentMethodModule {}
```

## 장점

1. **NestJS 패턴 준수**: 표준 NestJS 의존성 주입 패턴 사용
2. **서비스 분리**: 각 기능별로 독립적인 서비스로 분리하여 관리 용이
3. **타입 안전성**: 인터페이스를 통한 강력한 타입 체크
4. **테스트 용이성**: 각 서비스를 독립적으로 모킹 및 테스트 가능
5. **선택적 목업 사용**: 배치 CMS만 목업서버를 사용하여 개발 효율성 증대
6. **환경별 설정**: 개발/테스트/운영 환경에 따른 유연한 설정

## 환경별 동작

### 개발 환경 (NODE_ENV=development)
- 카드결제: 실제 HMS API (테스트 모드)
- 배치 CMS: 목업서버

### 테스트 환경
- 카드결제: 실제 HMS API (테스트 모드)
- 배치 CMS: 목업서버 또는 실제 API (설정에 따라)

### 운영 환경 (NODE_ENV=production)
- 카드결제: 실제 HMS API (운영 모드)
- 배치 CMS: 실제 HMS API (USE_MOCK_BATCH_CMS=false 설정 필요)

## 트러블슈팅

### 목업서버 연결 실패
```bash
# 목업서버가 실행 중인지 확인
curl http://localhost:3005/health

# 목업서버 재시작
cd hms-api-wrapper
npm run mock-server
```

### HMS API 인증 실패
- HMS_SW_KEY, HMS_CUST_KEY 환경변수 확인
- HMS API 테스트 모드 설정 확인

### 타입 에러
- hms-api-wrapper 패키지 버전 확인
- TypeScript 컴파일 옵션 확인