# 아몬드영 채널 어댑터 서비스

판매채널(네이버 스마트스토어, 쿠팡 등)과 내부 MSA 시스템 간의 **양방향 데이터 번역 및 이벤트 중계**를 담당하는 마이크로서비스입니다.

## 🚀 서비스 개요

- **포트**: 3003
- **역할**: 외부 판매채널과 내부 시스템 간 데이터 동기화
- **지원 채널**: 네이버 스마트스토어, 쿠팡
- **아키텍처**: 전략 패턴 + 팩토리 패턴

## 📋 주요 기능

### 1. 채널 어댑터 기능 (`/adapter`)

- **데이터 폴링**: 외부 채널에서 주기적 데이터 수집
- **웹훅 처리**: 실시간 이벤트 수신 및 처리
- **명령 실행**: 발송처리, 취소승인 등 채널별 명령 수행
- **전체 동기화**: 모든 활성 채널 일괄 동기화

### 2. 동기화 상태 관리 (`/adapter/sync-status`)

- **실시간 모니터링**: 채널별 동기화 상태 실시간 조회
- **성능 통계**: 처리량, 응답시간, 성공률 등 성능 지표
- **이력 관리**: 동기화 히스토리 및 오류 로그
- **헬스 체크**: 채널별 연결 상태 확인

## 🔗 API 엔드포인트

### 핵심 기능

```
GET    /adapter/health           # 서비스 상태 확인
GET    /adapter/poll             # 채널 데이터 폴링
POST   /adapter/sync/:channel/:dataType  # 개별 채널 동기화
POST   /adapter/sync/all/:dataType       # 전체 채널 동기화
POST   /adapter/webhook/:channel         # 웹훅 이벤트 처리
POST   /adapter/command/:channel         # 채널 명령 실행
GET    /adapter/channels                 # 지원 채널 목록
GET    /adapter/config                   # 채널 설정 조회
GET    /adapter/logs/:channel            # 채널별 로그 조회
POST   /adapter/test/:channel            # 채널 연결 테스트
```

### 채널별 단건 조회 API (전략 패턴)

```
GET    /adapter/:channel/query/:queryType/:identifier      # 범용 단건 조회 (전략 패턴 적용)
```

**지원 채널 및 조회 타입:**

- **쿠팡**: `coupang/query/ordersheet/{shipmentBoxId}`, `coupang/query/ordersheet-by-orderid/{orderId}`
- **네이버**: `naver_smartstore/query/order/{productOrderId}` (향후 구현)
- **기타**: 각 전략에서 구현된 조회 타입

### 동기화 상태

```
GET    /adapter/sync-status/overview              # 전체 통계 개요
GET    /adapter/sync-status/channel/:channel      # 채널별 상세 통계
GET    /adapter/sync-status/history/:channel/:dataType  # 동기화 히스토리
GET    /adapter/sync-status/realtime              # 실시간 상태
GET    /adapter/sync-status/performance           # 성능 지표
```

## 📊 API 문서

서비스 실행 후 다음 URL에서 Swagger API 문서를 확인할 수 있습니다:

```
http://localhost:3003/api-docs
```

## 🔍 채널별 단건 조회 API (전략 패턴)

### 개요

전략 패턴을 활용한 범용 단건 조회 API입니다. 각 채널별로 특화된 조회 기능을 제공하며, 새로운 채널 추가 시 전략만 구현하면 자동으로 API가 확장됩니다.

### 엔드포인트

```
GET /adapter/{channel}/query/{queryType}/{identifier}
```

**파라미터:**

- `channel`: 채널 타입 (coupang, naver_smartstore 등)
- `queryType`: 조회 타입 (각 채널별로 지원하는 타입이 다름)
- `identifier`: 조회 식별자 (shipmentBoxId, orderId, productOrderId 등)

### 쿠팡 지원 조회 타입

#### 1. shipmentBoxId 기준 조회

```
GET /adapter/coupang/query/ordersheet/{shipmentBoxId}
```

#### 2. orderId 기준 조회

```
GET /adapter/coupang/query/ordersheet-by-orderid/{orderId}
```

### 주요 사용 사례

1. **🏠 배송지 변경 확인**

   - 결제 완료 후 고객이 배송지를 변경할 수 있음
   - 상품준비중 처리 이후 반드시 배송지 정보 확인 필요

2. **📦 상품 정보 일치 여부 확인**

   - 출고 전 `sellerProductName + sellerProductItemName`과 `vendorItemName` 정보 일치 확인
   - 불일치 시 출고 보류 및 온라인 문의 접수 필요

3. **🚚 실시간 배송 상태 조회**
   - 운송장 번호, 배송 상태 등 최신 정보 확인

### 요청 예시

#### 1. shipmentBoxId 기준 조회

```bash
# cURL 요청
curl -X GET "http://localhost:3003/adapter/coupang/ordersheet/642538971006401429" \
  -H "Content-Type: application/json"

# 테스트 스크립트 사용
npx tsx test-coupang-single.ts 642538971006401429
```

#### 2. orderId 기준 조회

```bash
# cURL 요청
curl -X GET "http://localhost:3003/adapter/coupang/ordersheet/by-orderid/500000596" \
  -H "Content-Type: application/json"

# 테스트 스크립트 사용 (orderId 버전)
npx tsx test-coupang-single-orderid.ts 500000596
```

### 응답 예시

```json
{
  "success": true,
  "data": {
    "channelType": "coupang",
    "externalOrderId": "5077495966",
    "externalProductOrderId": "16885250726",
    "status": "PAID",
    "buyer": {
      "name": "김철수",
      "contact": "050-1234-5678",
      "address": {
        "postalCode": "12345",
        "roadAddress": "서울시 강남구 테헤란로 123",
        "detailAddress": "456호"
      }
    },
    "dispatch": {
      "deliveryCompanyCode": "CJ대한통운",
      "trackingNumber": "123456789012",
      "dispatchedAt": "2023-01-01T15:00:00+09:00"
    },
    "quantity": 2,
    "priceAmount": 19000,
    "discountAmount": 1000
  },
  "meta": {
    "shipmentBoxId": "642538971006401429",
    "retrievedAt": "2023-01-01T10:00:00.000Z",
    "source": "coupang_single_query"
  }
}
```

### 에러 응답

| 상태 코드 | 설명                  | 해결 방법                      |
| --------- | --------------------- | ------------------------------ |
| 400       | 잘못된 배송번호 형식  | shipmentBoxId 형식 확인        |
| 401       | API 인증 실패         | 쿠팡 API 키 확인               |
| 404       | 발주서를 찾을 수 없음 | shipmentBoxId 존재 여부 확인   |
| 500       | 쿠팡 API 호출 실패    | 네트워크 상태 및 API 상태 확인 |

## 🛠 실행 방법

### 개발 환경

```bash
# 의존성 설치
npm install

# 환경변수 설정 (채널별 API 키 등)
cp .env.example .env

# 개발 서버 실행
npm run start:dev channel-adater
```

### 프로덕션 환경

```bash
# 빌드
npm run build channel-adater

# 프로덕션 실행
npm run start:prod channel-adater
```

## 🔧 환경 설정

### 네이버 스마트스토어

```env
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret
NAVER_API_ENDPOINT=https://api.commerce.naver.com
```

### 쿠팡

```env
COUPANG_VENDOR_ID=your_vendor_id
COUPANG_ACCESS_KEY=your_access_key
COUPANG_SECRET_KEY=your_secret_key
COUPANG_API_ENDPOINT=https://api-gateway.coupang.com
```

## 🏗 아키텍처

```
채널 어댑터 서비스
├── 컨트롤러 계층
│   ├── ChannelAdapterController    # 핵심 API
│   └── SyncStatusController        # 상태 관리 API
├── 서비스 계층
│   ├── AdapterOrchestrationService # 동기화 조율
│   ├── SyncStatusService          # 상태 관리
│   └── ChannelAdapterService      # 기본 서비스
└── 전략 계층
    ├── ChannelStrategyFactory     # 전략 팩토리
    ├── NaverSmartstoreStrategy   # 네이버 전략
    └── CoupangStrategy           # 쿠팡 전략
```

## 🔄 동기화 플로우

### 1. 폴링 기반 동기화

```
1. 스케줄러가 주기적으로 동기화 요청
2. ChannelStrategy가 외부 API 호출
3. 응답 데이터를 InternalOrderEvent로 변환
4. 중복 검사 후 이벤트 브로커로 발행
5. 동기화 결과를 SyncStatusService에 기록
```

### 2. 웹훅 기반 동기화

```
1. 외부 채널에서 웹훅 이벤트 수신
2. ChannelStrategy가 이벤트 검증 및 변환
3. InternalOrderEvent로 표준화
4. 이벤트 브로커로 즉시 발행
```

## 📈 모니터링

### 주요 지표

- **처리량**: 시간당 동기화 이벤트 수
- **성공률**: 동기화 성공 비율
- **응답시간**: 평균 처리 시간
- **오류율**: 실패한 동기화 비율

### 알림 조건

- 동기화 실패율 10% 초과
- 평균 응답시간 5초 초과
- 1시간 이상 동기화 중단

## 🧪 테스트

### 단위 테스트

```bash
npm run test channel-adater
```

### 통합 테스트

```bash
npm run test:e2e channel-adater
```

### 채널별 테스트 스크립트

```bash
# 네이버 스마트스토어 테스트
node test-naver-sync.ts

# 쿠팡 테스트
node test-coupang-sync.ts

# 쿠팡 발주서 단건 조회 테스트
npx tsx test-coupang-single.ts <shipmentBoxId>

# 오케스트레이션 테스트
node test-orchestration.ts
```

## 🔍 트러블슈팅

### 일반적인 문제들

#### 1. API 인증 실패

```
오류: 401 Unauthorized
해결: 환경변수의 API 키가 올바른지 확인
```

#### 2. 동기화 지연

```
원인: 외부 API 응답 지연 또는 네트워크 이슈
해결: 타임아웃 설정 조정 또는 재시도 로직 확인
```

#### 3. 메모리 사용량 증가

```
원인: 대량 데이터 처리 시 메모리 누수
해결: 배치 크기 조정 및 가비지 컬렉션 모니터링
```

## 📝 개발 가이드

### 새 채널 추가하기

1. **전략 클래스 구현**

```typescript
@Injectable()
export class NewChannelStrategy implements ChannelStrategy {
  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    // 구현
  }

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 구현
  }

  // ... 기타 메서드
}
```

2. **팩토리에 등록**

```typescript
getStrategy(channelType: ChannelType): ChannelStrategy {
  switch (channelType) {
    case 'new_channel':
      return this.newChannelStrategy;
    // ...
  }
}
```

3. **모듈에 추가**

```typescript
@Module({
  providers: [
    // ...
    NewChannelStrategy,
  ],
})
```

## 🤝 기여 가이드

1. 기능 브랜치 생성
2. 코드 작성 및 테스트
3. 린트 검사 통과
4. Pull Request 생성

## 📄 라이선스

MIT License - 자세한 내용은 LICENSE 파일 참조
