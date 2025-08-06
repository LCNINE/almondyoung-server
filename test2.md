안녕하세요, Nest.js 멤버십 서비스 E2E 테스트 작성을 도와주세요.

테스트 목표: 신규 사용자가 구독을 생성하고, 조회한 뒤, 취소하는 핵심 흐름을 검증합니다.

핵심 원칙:
- 원자성: beforeAll에서 이전 테스트의 잔여 데이터를 먼저 삭제해주세요.
- 완벽한 전제 조건: 아래 명시된 모든 전제 조건 데이터를 Foreign Key 순서에 맞게 DB에 직접 생성해주세요.
- DB 신뢰: API 응답이 아닌 DB의 최종 상태를 기준으로 핵심 검증을 수행해주세요.
- 스키마 준수: Drizzle 스키마의 데이터 타입을 완벽하게 준수해주세요.

테스트 시나리오 (Given-When-Then):
- Given (전제 조건):
    - 1개의 테스트 사용자 (`users` 테이블)
    - 1개의 Basic 티어 (`subscriptionTiers` 테이블)
    - 1개의 Basic 플랜 (`subscriptionPlans` 테이블)
- When (실행):
    - 사용자가 Basic 플랜으로 구독을 생성 (`POST /subscriptions`)
    - 사용자가 현재 구독을 조회 (`GET /subscriptions/current`)
    - 사용자가 구독을 취소 (`POST /subscriptions/cancel`)
- Then (검증):
    - 모든 API 호출은 성공 상태 코드를 반환해야 합니다.
    - 구독 생성 후, DB의 `subscriptions` 테이블에 `ACTIVE` 상태의 레코드가 생성되어야 합니다.
    - 구독 취소 후, DB의 `subscriptions` 테이블의 상태가 `CANCELLED` 또는 `PENDING_CANCELLATION`으로 변경되어야 합니다.

위 내용에 맞춰 new-subscription.e2e-spec.ts 파일의 전체 코드를 작성해주세요.
