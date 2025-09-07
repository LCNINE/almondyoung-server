# 신용카드 기반 구독 정기결제 통합 테스트 가이드

이 가이드는 HMS 카드 API를 통한 구독 정기결제 시스템의 통합 테스트 실행 방법을 설명합니다.

## 📋 테스트 개요

### 테스트 구성

1. **로컬 멤버십 데이터 기반 테스트**: `membership-db.json`의 테스트 데이터 활용
2. **HMS 카드 등록 및 memberID 획득**: 실제 HMS API 호출 시뮬레이션
3. **구독 정기결제 통합 플로우**: 전체 결제 프로세스 검증
4. **에러 시나리오 및 동시성 테스트**: 다양한 예외 상황 처리 확인

### 주요 테스트 파일

- `recurring-payment-card-integration.spec.ts`: 전체 구독 결제 통합 테스트
- `hms-memberid-flow.spec.ts`: HMS memberID 획득 및 결제 플로우 테스트
- `membership-db.json`: 로컬 테스트 데이터

## 🚀 테스트 실행 방법

### 1. 환경 설정

```bash
# 프로젝트 루트에서 의존성 설치
npm install

# 테스트 환경 변수 설정 (선택사항)
export TEST_DATABASE_URL="your-test-database-url"
export NODE_ENV=test
```

### 2. 개별 테스트 실행

#### HMS memberID 플로우 테스트

```bash
# HMS 카드 등록 및 memberID 획득 테스트
npm run test -- --testPathPattern="hms-memberid-flow.spec.ts"
```

#### 구독 정기결제 통합 테스트

```bash
# 전체 구독 결제 플로우 테스트
npm run test -- --testPathPattern="recurring-payment-card-integration.spec.ts"
```

### 3. 전체 통합 테스트 실행

```bash
# 모든 통합 테스트 실행
npm run test -- --testPathPattern="integration"

# 상세 로그와 함께 실행
npm run test -- --testPathPattern="integration" --verbose
```

## 📊 테스트 시나리오

### 1. HMS memberID 플로우 테스트 (`hms-memberid-flow.spec.ts`)

#### 테스트 단계:

1. **로컬 멤버십 데이터 검증**

   - `membership-db.json` 데이터 로드 확인
   - 카드 정보 유효성 검증

2. **HMS 카드 등록 및 memberID 획득**

   - 3개의 테스트 카드를 HMS에 등록
   - 각각 고유한 HMS memberID 획득
   - 등록 성공/실패 결과 확인

3. **HMS memberID를 사용한 결제 테스트**

   - 등록된 각 memberID로 결제 실행
   - 다양한 금액(100원~50,000원)으로 테스트
   - 결제 성공률 및 트랜잭션 ID 확인

4. **HMS 상태 검증 및 에러 처리**

   - 유효하지 않은 memberID로 결제 시도
   - HMS memberID 검증 기능 테스트
   - 예외 상황 처리 확인

5. **통합 플로우 검증**
   - 카드 등록 → 결제 → 검증의 전체 플로우 테스트

#### 예상 결과:

```
✅ 로컬 멤버십 데이터 로드 성공
✅ 카드 1 등록 성공: HMS_CARD_1234567890
✅ 카드 2 등록 성공: HMS_CARD_0987654321
✅ 카드 3 등록 성공: HMS_CARD_5555666677
✅ 모든 HMS memberID가 고유함을 확인
✅ 결제 테스트 1 성공: MOCK_CARD_1234567890
✅ 다양한 금액 결제 테스트 완료
✅ HMS memberID 검증 성공
🎉 전체 통합 플로우 검증 완료
```

### 2. 구독 정기결제 통합 테스트 (`recurring-payment-card-integration.spec.ts`)

#### 테스트 단계:

1. **HMS 카드 등록 및 memberID 획득**

   - 신용카드를 HMS에 등록
   - memberID 획득 및 데이터베이스 저장

2. **구독 결제수단 검증**

   - SUBSCRIPTION 용도 결제수단 검증
   - PURCHASE 전용 결제수단 거부 확인

3. **구독 정기결제 실행**

   - 월간 구독 결제 (9,900원)
   - 연간 구독 결제 (99,000원, 할인 적용)
   - 멱등성 키를 사용한 중복 요청 처리

4. **결제 상태 조회**

   - 트랜잭션 ID로 결제 상태 조회
   - 구독 결제 메타데이터 확인

5. **에러 시나리오 테스트**

   - 존재하지 않는 결제수단
   - 다른 사용자의 결제수단
   - 잘못된 금액
   - 비활성화된 결제수단

6. **동시성 및 성능 테스트**
   - 5개의 동시 결제 요청 처리
   - 트랜잭션 ID 고유성 확인

#### 예상 결과:

```
✅ HMS memberID 획득 성공: HMS_CARD_1234567890
✅ 결제수단 등록 완료: pm_test_123
✅ 월간 구독 결제 성공
✅ 연간 구독 결제 성공 (할인 적용)
✅ 멱등성 키 중복 요청 처리 성공
✅ 동시성 테스트 성공
```

## 🔧 테스트 데이터 구조

### membership-db.json

```json
{
  "members": [
    {
      "id": "member_001",
      "name": "김테스트",
      "subscriptionType": "monthly",
      "subscriptionAmount": 9900
    }
  ],
  "paymentMethods": [
    {
      "id": "pm_card_001",
      "methodType": "CARD",
      "paymentPurpose": "SUBSCRIPTION",
      "cardInfo": {
        "memberName": "김테스트",
        "phone": "01012345678",
        "paymentNumber": "1234567890123456",
        "payerNumber": "9001011234",
        "validYear": "25",
        "validMonth": "12"
      }
    }
  ]
}
```

## 🐛 트러블슈팅

### 일반적인 문제

1. **데이터베이스 연결 오류**

   ```bash
   # 환경 변수 확인
   echo $TEST_DATABASE_URL

   # 데이터베이스 연결 테스트
   npm run test -- --testNamePattern="데이터베이스"
   ```

2. **HMS API 연결 문제**

   ```bash
   # HMS API 설정 확인
   npm run test -- --testNamePattern="HMS" --verbose
   ```

3. **테스트 데이터 충돌**
   ```bash
   # 테스트 데이터 정리 후 재실행
   npm run test -- --testPathPattern="integration" --runInBand
   ```

### 로그 확인

테스트 실행 중 상세한 로그를 확인하려면:

```bash
# 디버그 모드로 실행
DEBUG=* npm run test -- --testPathPattern="integration"

# Jest 상세 출력
npm run test -- --testPathPattern="integration" --verbose --no-coverage
```

## 📈 성능 지표

### 예상 테스트 실행 시간

- HMS memberID 플로우 테스트: ~30초
- 구독 정기결제 통합 테스트: ~45초
- 전체 통합 테스트: ~75초

### 성공 기준

- 모든 테스트 케이스 통과율: 100%
- HMS memberID 등록 성공률: 100% (Mock 환경)
- 결제 처리 성공률: 100% (Mock 환경)
- 동시성 테스트 성공률: 100%

## 🔄 CI/CD 통합

### GitHub Actions 예시

```yaml
name: Recurring Payment Integration Tests
on: [push, pull_request]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test -- --testPathPattern="integration"
        env:
          TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
```

## 📞 지원

테스트 관련 문제가 발생하면:

1. 로그 파일 확인
2. 환경 변수 설정 검토
3. 데이터베이스 연결 상태 확인
4. HMS API 응답 상태 확인

---

**참고**: 이 테스트는 Mock HMS API를 사용하므로 실제 결제가 발생하지 않습니다. 프로덕션 환경에서는 실제 HMS API 설정이 필요합니다.
