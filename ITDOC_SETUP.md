# itdoc 통합 가이드

이 문서는 멤버십 시스템에 itdoc을 통합하여 테스트 기반 자동 문서화를 구현하는 방법을 설명합니다.

## 개요

**itdoc**은 테스트 코드를 기반으로 API 문서를 자동 생성하는 Node.js 도구입니다. 테스트가 성공하면 자동으로 OpenAPI 스펙 문서가 생성되어 항상 최신 상태의 정확한 API 문서를 유지할 수 있습니다.

## 설치 및 설정

### 1. 패키지 설치

```bash
npm install itdoc --save-dev
```

### 2. 프로젝트 구조

```
almondyoung-server-1/
├── apps/membership/
│   ├── src/                          # 소스 코드
│   └── test/
│       ├── global-setup.ts           # itdoc 글로벌 설정
│       ├── jest-e2e.json            # Jest 설정 (globalSetup 추가)
│       ├── subscription.itdoc.e2e-spec.ts    # 구독 API 문서화 테스트
│       ├── plan-tier.itdoc.e2e-spec.ts       # 플랜/티어 API 문서화 테스트
│       ├── admin-operations.itdoc.e2e-spec.ts # 관리자 API 문서화 테스트
│       └── fixtures/                 # 테스트 데이터
├── docs/api/                         # 생성된 문서 출력 디렉토리
├── scripts/run-itdoc-tests.js        # itdoc 실행 스크립트
└── package.json                      # itdoc 설정 포함
```

### 3. package.json 설정

```json
{
  "scripts": {
    "test:membership:itdoc": "jest --config ./apps/membership/test/jest-e2e.json --testNamePattern='itdoc'",
    "docs:generate": "npm run test:membership:itdoc && npx itdoc",
    "docs:serve": "npx itdoc serve"
  },
  "itdoc": {
    "output": "docs/api",
    "document": {
      "title": "Membership System API Documentation",
      "description": "Auto-generated API documentation for the Membership System based on test cases",
      "version": "1.0.0"
    }
  }
}
```

## 사용법

### 1. 문서 생성

```bash
# itdoc 테스트 실행 및 문서 생성
npm run docs:generate

# 또는 스크립트 사용
node scripts/run-itdoc-tests.js
```

### 2. 문서 서빙

```bash
# 로컬 서버에서 문서 확인
npm run docs:serve
```

### 3. 개별 테스트 실행

```bash
# itdoc 테스트만 실행
npm run test:membership:itdoc

# 전체 e2e 테스트 실행
npm run test:membership:e2e
```

## itdoc 테스트 작성 방법

### 기본 구조

```typescript
import { describeAPI, field, HttpMethod, HttpStatus, itDoc } from 'itdoc';

describeAPI(
  HttpMethod.POST,
  '/subscriptions',
  {
    summary: 'Create a new subscription',
    description: 'Creates a new subscription for the authenticated user',
    tag: 'Subscription Management',
  },
  globalThis.__APP__,  // 글로벌 설정에서 설정된 앱 인스턴스
  (apiDoc) => {
    itDoc('Successfully create a new subscription', async () => {
      return apiDoc
        .test()
        .req()
        .header({
          'x-user-id': field('User ID', 'user-uuid'),
        })
        .body({
          planId: field('Plan ID to subscribe to', 'plan-uuid', true),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          contractId: field('Created contract ID', 'uuid-string'),
          entitlementId: field('Created entitlement ID', 'uuid-string'),
        });
    });
  }
);
```

### 주요 구성 요소

1. **describeAPI**: API 엔드포인트 정의
   - HTTP 메서드, 경로, 메타데이터 설정

2. **itDoc**: 개별 테스트 케이스 정의
   - 성공/실패 시나리오별로 작성

3. **field**: 필드 설명 및 예시값 정의
   - `field(description, example, required?)`

4. **req/res**: 요청/응답 구조 정의
   - header, body, pathParam, queryParam 등

## 생성되는 문서 형식

itdoc은 다음 형식의 문서를 생성합니다:

- **OpenAPI 3.0 스펙** (JSON/YAML)
- **HTML 문서** (Redoc 스타일)
- **Markdown 문서**

## 현재 구현된 API 문서화

### 1. 구독 관리 API (`subscription.itdoc.e2e-spec.ts`)
- POST /subscriptions - 구독 생성
- GET /subscriptions/current - 현재 구독 조회 (쿼리 파라미터로 userId 전달)
- POST /subscriptions/pause - 구독 일시정지 (정책 검증 포함)
- POST /subscriptions/pause/resume - 구독 재개
- POST /subscriptions/cancel - 구독 취소
- POST /subscriptions/upgrade - 구독 업그레이드
- GET /subscriptions/history - 구독 이력 조회

### 2. 플랜/티어 관리 API (`plan-tier.itdoc.e2e-spec.ts`)
- GET /plans - 모든 활성 플랜 조회
- GET /plans/:planId - 플랜 상세 조회
- GET /tiers - 모든 티어 조회
- GET /tiers/:tierId/plans - 티어별 플랜 조회
- GET /tiers/:tierId/benefits - 티어 혜택 조회

### 3. 관리자 API (`admin-operations.itdoc.e2e-spec.ts`)
- POST /admin/tiers - 티어 생성 (Zod 검증 포함)
- POST /admin/plans - 플랜 생성
- PUT /admin/plans/:planId - 플랜 수정
- DELETE /admin/plans/:planId - 플랜 비활성화
- PUT /admin/tiers/:tierId - 티어 수정
- POST /admin/entitlements/adjust - 구독 기간 조정 (-365~365일)
- GET /admin/users/:userId/pause-history - 사용자 일시정지 이력
- POST /admin/policies - 정책 생성
- PUT /admin/policies/:policyId - 정책 수정
- DELETE /admin/policies/:policyId - 정책 비활성화

### 4. 일시정지 관리 API (`pause-resume.itdoc.e2e-spec.ts`)
- GET /subscriptions/pause/history - 사용자 일시정지 이력
- POST /subscriptions/pause - 정책 검증 시나리오들
  - 성공: 정책 범위 내 일시정지
  - 실패: 최대 일시정지 횟수 초과
  - 실패: 최소 기간 미달
  - 실패: 쿨다운 기간 미경과
  - 실패: 블랙아웃 기간 중 시도
- POST /subscriptions/pause/resume - 재개 시나리오들
  - 성공: 일반 재개
  - 성공: 조기 재개 보너스 적용
  - 실패: 일시정지되지 않은 구독
  - 실패: 활성 구독 없음

## 글로벌 설정 (`global-setup.ts`)

```typescript
// NestJS 앱 초기화 및 글로벌 변수 설정
export default async function globalSetup() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  
  await app.init();
  
  // itdoc이 사용할 수 있도록 HTTP 서버를 글로벌 변수에 저장
  globalThis.__APP__ = app.getHttpServer() as App;
}
```

## 장점

1. **테스트와 문서의 동기화**: 테스트가 성공해야만 문서가 생성되므로 항상 정확한 문서 유지
2. **자동화**: CI/CD 파이프라인에 통합하여 자동으로 문서 업데이트
3. **실제 데이터**: 테스트에서 사용하는 실제 요청/응답 데이터로 문서 생성
4. **다양한 시나리오**: 성공/실패 케이스를 모두 문서화
5. **OpenAPI 호환**: 표준 OpenAPI 스펙으로 생성되어 다양한 도구와 호환

## 주의사항

1. **테스트 순서**: itdoc 테스트는 실제 API를 호출하므로 테스트 데이터 설정이 중요
2. **데이터베이스 상태**: 각 테스트가 독립적으로 실행될 수 있도록 데이터 정리 필요
3. **인증**: 현재 `x-user-id` 헤더를 사용한 개발용 인증 사용
4. **성능**: 실제 API 호출로 인해 일반 단위 테스트보다 느림

## 확장 방법

새로운 API 엔드포인트를 문서화하려면:

1. 새로운 `.itdoc.e2e-spec.ts` 파일 생성
2. `describeAPI`와 `itDoc`을 사용하여 테스트 작성
3. `npm run docs:generate` 실행하여 문서 업데이트

## 트러블슈팅

### 문제: 글로벌 설정이 로드되지 않음
**해결**: `jest-e2e.json`에 `globalSetup` 경로가 올바르게 설정되어 있는지 확인

### 문제: 모듈 경로 해결 실패
**해결**: `global-setup.ts`에서 `tsconfig-paths` 설정이 올바른지 확인

### 문제: 테스트 실행 중 데이터베이스 오류
**해결**: 테스트 데이터베이스가 올바르게 설정되어 있고, 시드 데이터가 준비되어 있는지 확인

## 참고 자료

- [itdoc 공식 문서](https://itdoc.kr/)
- [itdoc GitHub](https://github.com/do-pa/itdoc)
- [OpenAPI 스펙](https://swagger.io/specification/)