# 네이버 스마트스토어 API 토큰 발급 테스트

## 개요

네이버 스마트스토어 API 액세스 토큰이 정상적으로 발급되는지 테스트하는 도구입니다.

## 사전 준비

### 1. 네이버 커머스 API 신청

1. [네이버 커머스 API](https://commerce.naver.com/api) 페이지에서 API 신청
2. 승인 후 다음 정보 확보:
   - **Client ID**: 애플리케이션 식별자
   - **Client Secret**: 애플리케이션 비밀키
   - **Account ID**: 셀러 계정 ID (SELLER 타입 사용 시 필수)

### 2. 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 추가:

```bash
# 네이버 스마트스토어 API 설정
NAVER_CLIENT_ID=your_client_id_here
NAVER_CLIENT_SECRET=your_client_secret_here
NAVER_ACCOUNT_ID=your_account_id_here
NAVER_API_ENDPOINT=https://api.commerce.naver.com/external/v1
```

**⚠️ 주의사항:**

- `.env` 파일은 Git에 커밋하지 마세요
- `naver-env-example.txt` 파일을 참고하여 설정하세요

## 테스트 실행

### 방법 1: npm 스크립트 사용

```bash
cd /home/jihun/다운로드/그룹/almondyoung-server
npm run test:naver-token
```

### 방법 2: 직접 실행

```bash
cd /home/jihun/다운로드/그룹/almondyoung-server/apps/channel-adater
ts-node test-naver-token.ts
```

## 테스트 내용

### 1단계: 환경변수 검증

- 필수 환경변수들이 설정되었는지 확인
- 누락된 환경변수가 있으면 오류 메시지 출력

### 2단계: 액세스 토큰 발급

- 현재 timestamp 생성
- HMAC-SHA256 전자서명 생성
- 네이버 OAuth2 토큰 엔드포인트 호출
- 응답에서 access_token 추출

### 3단계: API 호출 테스트

- 발급받은 토큰으로 실제 API 호출
- `product-orders/last-changed-statuses` 엔드포인트 테스트
- 최근 24시간 주문 상태 변경 목록 조회

## 예상 결과

### ✅ 성공 시 (실제 테스트 결과)

```
🎯 네이버 스마트스토어 API 토큰 발급 테스트 시작

🔧 환경변수 확인:
   NAVER_CLIENT_ID: ✅ 설정됨
   NAVER_CLIENT_SECRET: ✅ 설정됨
   NAVER_ACCOUNT_ID: ✅ 설정됨
   NAVER_API_ENDPOINT: https://api.commerce.naver.com/external/v1

🚀 네이버 API 액세스 토큰 발급 시작...
   Timestamp: 1758168856942
   Password: 4uH5TNZ8qCHyBXOweC5Gh7_1758168856942
   Hashed: $2a$04$8vs9nt2lCVD0O8acKJXiles7QKMQZTKW.lnsXVykn96WI0hGg/k4y
   Client Secret Sign: JDJhJDA0JDh2czludDJsQ1ZEME84YWNLSlhpbGVzN1FLTVFaVEtXLmxuc1hWeWtuOTZXSTBoR2cvazR5
📤 토큰 발급 요청 전송...
✅ 토큰 발급 성공!
   Access Token: 314iF7G7BLsqDyiaVcwQ...
   Token Type: Bearer
   Expires In: 10799초
   Scope: N/A

🎉 테스트 완료!
```

**주요 특징**:

- ✅ **bcrypt 전자서명**: `password = client_id + "_" + timestamp` 형식으로 bcrypt 해싱
- ✅ **토큰 유효기간**: 10799초 (약 3시간)
- ✅ **type=SELF**: 자기 자신의 리소스 접근 방식

### ❌ 실패 시 (환경변수 누락)

```
🔧 환경변수 확인:
   NAVER_CLIENT_ID: ❌ 누락
   NAVER_CLIENT_SECRET: ❌ 누락

💥 테스트 실패: Error: ❌ NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다.
```

### ❌ 실패 시 (인증 오류)

```
❌ 토큰 발급 실패:
   HTTP Status: 400
   Error Response: {
     "error": "invalid_client",
     "error_description": "Client authentication failed"
   }
```

## 트러블슈팅

### 1. "Client authentication failed" 오류

- Client ID와 Client Secret이 올바른지 확인
- 네이버 커머스 API 콘솔에서 애플리케이션 상태 확인

### 2. "Invalid account_id" 오류

- Account ID가 올바른지 확인
- 셀러 계정과 연동된 Account ID인지 확인

### 3. "Insufficient scope" 오류

- API 신청 시 필요한 권한을 모두 신청했는지 확인
- 상품주문.조회, 상품주문.처리 권한 필요

### 4. 타임아웃 오류

- 네트워크 연결 상태 확인
- 방화벽에서 HTTPS 아웃바운드 허용 확인

## 다음 단계

토큰 발급이 성공하면:

1. 네이버 스마트스토어 Strategy 클래스의 `getAccessToken()` 메서드 검증 완료
2. 실제 주문 데이터 동기화 로직 구현 진행
3. 웹훅 엔드포인트 구현 (네이버에서 지원 시)
4. 이벤트 중복 처리 방지 로직 구현
