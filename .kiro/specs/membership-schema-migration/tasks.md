# 구현 계획

- [ ] 1. 새 스키마 구조 생성
  - 7개 타겟 테이블에 대한 새로운 Drizzle ORM 스키마 정의 작성
  - 기존 테이블과 새 테이블 간 데이터 매핑 함수 구현
  - _Requirements: 1.1, 4.1, 5.3_

- [-] 2. pause 매핑 기능 구현
  - [ ] 2.1 pause_entitlement_voids 매핑 로직 작성
    - pause와 entitlement 간 매핑 생성 함수 구현
    - original_ends_at, adjusted_ends_at 추적 로직 작성
    - 간단한 테스트 케이스 작성
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 2.2 pause_periods에 reason 필드 추가
    - pause_periods 스키마에 reason TEXT 컬럼 추가
    - pause 생성 시 reason 저장하도록 로직 수정
    - _Requirements: 2.4_

- [ ] 3. pause_usage_tracker 대체 뷰 생성
  - pause_usage_per_year SQL 뷰 생성
  - 기존 pause_usage_tracker와 동일한 데이터 제공하는 쿼리 작성
  - 성능 최적화는 나중에 필요시 진행
  - _Requirements: 3.1, 3.4_

- [ ] 4. 단계별 마이그레이션 구현
  - [ ] 4.1 1단계 - 새 테이블 생성
    - 기존 테이블과 함께 새 테이블들 생성
    - 기본적인 마이그레이션 로깅 설정
    - _Requirements: 6.1, 5.1_

  - [ ] 4.2 2단계 - 데이터 이관
    - 각 테이블별 데이터 이관 스크립트 작성
    - 배치 단위로 데이터 이관 (메모리 이슈 방지)
    - 이관 후 기본 검증 수행
    - _Requirements: 6.2, 5.2, 5.3_

  - [ ] 4.3 3단계 - 코드 업데이트
    - Drizzle ORM relations 새 테이블명으로 업데이트
    - 서비스 레이어 메서드들 새 스키마로 수정
    - 기존 API 호환성 유지
    - _Requirements: 6.3, 4.2, 4.3, 4.4_

  - [ ] 4.4 4단계 - 정리
    - 구 테이블 제거
    - 레거시 코드 참조 정리
    - import 구문들 새 스키마로 업데이트
    - _Requirements: 6.4, 1.2, 4.1_

- [ ] 5. 서비스 레이어 의존성 정리 및 업데이트
  - [ ] 5.1 SubscriptionService에 RightsService 의존성 주입
    - SubscriptionService 생성자에 RightsService 주입 추가
    - 구독 생성 시 직접 rights 테이블 조작 대신 RightsService.createUserRights() 사용
    - 구독 업그레이드 시 RightsService.terminateUserRights(), createUserRights() 사용
    - 구독 취소 시 RightsService.terminateUserRights() 사용
    - **기존 직접 rights 테이블 조작 코드 완전 제거**
    - _Requirements: 4.3, 1.3_

  - [ ] 5.2 SubscriptionService 리팩토링
    - subscription_contracts 테이블 사용하도록 구독 생성 로직 수정
    - 업그레이드/다운그레이드 로직 새 스키마에 맞게 수정
    - **기존 정책 검증 로직 완전 제거** (PolicyGuard가 담당)
    - **PolicyEngineService 의존성 및 관련 import 제거**
    - **기존 schema.subscriptionRights 관련 모든 코드 제거**
    - _Requirements: 4.3, 1.3_

  - [ ] 5.3 RightsService를 EntitlementService로 변경
    - RightsService를 EntitlementService로 이름 변경
    - subscription_entitlement 테이블 사용하도록 권한 검증 로직 수정
    - 벌크 권한 체크 로직 새 스키마로 수정
    - _Requirements: 4.3, 1.3_

  - [ ] 5.3 PolicyEngineService 업데이트
    - 새 entitlement 구조에 맞게 정책 검증 수정
    - pause 정책 검증을 새 pause_periods, pause_entitlement_voids로 수정
    - _Requirements: 4.3, 2.1, 2.2_

- [ ] 6. 기본 테스트 작성
  - [ ] 6.1 데이터 매핑 테스트
    - 스키마 변환 함수들 테스트
    - pause-entitlement 매핑 로직 테스트
    - _Requirements: 5.3, 2.3_

  - [ ] 6.2 마이그레이션 통합 테스트
    - 테스트 환경에서 전체 마이그레이션 테스트
    - 마이그레이션 전후 API 기능 테스트
    - _Requirements: 5.2, 5.3, 4.4_

- [ ] 7. API 레이어 업데이트
  - 구독 엔드포인트들 새 스키마로 수정
  - rights/entitlement 엔드포인트 새 데이터 구조로 수정
  - PolicyGuard 데코레이터가 올바르게 적용되어 있는지 확인
  - 기존 API 계약 유지 확인
  - _Requirements: 4.4, 1.3_

- [ ] 8. 롤백 메커니즘 구현 (필요시)
  - 각 단계별 롤백 스크립트 작성
  - 마이그레이션 실패 시 이전 상태로 복구 가능하도록 구현
  - _Requirements: 5.4, 6.5_