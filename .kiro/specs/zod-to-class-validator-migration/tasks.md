# 구현 계획

- [ ] 1. DTO 디렉토리 구조 생성
  - apps/membership/src/shared/dtos/ 디렉토리 생성
  - 각 기능별 DTO 파일 구조 준비
  - _요구사항: 1.1, 1.2_

- [ ] 2. 기본 DTO 클래스 생성 (기존 Zod 스키마 변환)
  - [ ] 2.1 Admin Operations DTO 클래스 구현
    - CreateTierDto, UpdateTierDto, CreatePlanDto 등 관리자 기능용 DTO 클래스 작성
    - 기존 Zod 스키마의 검증 규칙을 class-validator 데코레이터로 변환
    - _요구사항: 1.1, 1.3_

  - [ ] 2.2 Subscription DTO 클래스 구현
    - CreateSubscriptionDto, UpgradeSubscriptionDto, PauseSubscriptionDto 등 구독 관련 DTO 클래스 작성
    - UUID, 날짜, 문자열 검증 규칙을 적절한 데코레이터로 변환
    - _요구사항: 1.1, 1.3_

  - [ ] 2.3 Policy Management DTO 클래스 구현
    - PolicyValidationDto, CreatePolicyDto 등 정책 관리용 DTO 클래스 작성
    - 복잡한 JSON 객체 검증을 위한 nested validation 구현
    - _요구사항: 1.1, 1.3_

- [ ] 3. 커스텀 Validator 구현
  - [ ] 3.1 날짜 범위 검증 Validator 생성
    - PauseSubscriptionDto의 startDate < endDate 검증을 위한 커스텀 validator 구현
    - 한국어 에러 메시지 포함
    - _요구사항: 1.3, 3.2_

  - [ ] 3.2 정책 규칙 검증 Validator 생성
    - POLICY_RULE_TYPES enum 기반 정책 타입 검증 커스텀 validator 구현
    - 정책 값 구조 검증 로직 구현
    - _요구사항: 1.3, 3.2_

- [ ] 4. 글로벌 ValidationPipe 설정
  - [ ] 4.1 app.module.ts에서 ZodValidationPipe를 ValidationPipe로 교체
    - 기존 Zod 에러 형식과 동일한 응답을 생성하는 exceptionFactory 구현
    - whitelist, forbidNonWhitelisted, transform 옵션 설정
    - _요구사항: 2.3, 3.1, 3.3_

  - [ ] 4.2 main.ts에서 nestjs-zod 관련 설정 제거
    - patchNestJsSwagger 호출 제거 및 표준 Swagger 설정으로 변경
    - _요구사항: 2.3, 7.1_

- [ ] 5. 컨트롤러 업데이트
  - [ ] 5.1 Subscription Controller 업데이트
    - @UsePipes(ZodValidationPipe) 제거하고 새로운 DTO 클래스 적용
    - @Body() 파라미터 타입을 새로운 DTO 클래스로 변경
    - _요구사항: 2.1, 2.2_

  - [ ] 5.2 Admin Operations Controller 업데이트
    - ZodValidationPipe 사용을 제거하고 새로운 DTO 클래스 적용
    - 모든 엔드포인트의 요청 타입을 새로운 DTO로 변경
    - _요구사항: 2.1, 2.2_

  - [ ] 5.3 Policy Management Controller 업데이트
    - 정책 관리 관련 모든 엔드포인트를 새로운 DTO 클래스로 업데이트
    - 복잡한 정책 검증 로직이 올바르게 작동하는지 확인
    - _요구사항: 2.1, 2.2_

  - [ ] 5.4 기타 Controller 업데이트
    - Pause, Rights 등 나머지 컨트롤러들을 새로운 DTO 클래스로 업데이트
    - 모든 ZodValidationPipe 사용 제거
    - _요구사항: 2.1, 2.2_

- [ ] 6. 테스트 업데이트
  - [ ] 6.1 DTO 검증 단위 테스트 작성
    - 각 DTO 클래스에 대한 validate() 함수 기반 단위 테스트 작성
    - 유효한 입력과 무효한 입력에 대한 테스트 케이스 구현
    - _요구사항: 6.2, 6.3_

  - [ ] 6.2 컨트롤러 테스트 업데이트
    - 기존 컨트롤러 테스트에서 새로운 DTO 클래스 사용하도록 수정
    - 검증 에러 케이스 테스트를 새로운 에러 형식에 맞게 업데이트
    - _요구사항: 6.1, 6.3_

  - [ ] 6.3 통합 테스트 실행 및 수정
    - 모든 기존 테스트가 새로운 검증 시스템과 함께 통과하는지 확인
    - 실패하는 테스트 케이스 수정
    - _요구사항: 6.4_

- [ ] 7. Swagger 문서 업데이트
  - [ ] 7.1 DTO 클래스에 ApiProperty 데코레이터 추가
    - 모든 DTO 속성에 적절한 Swagger 문서화 데코레이터 추가
    - 예시 값과 설명 포함
    - _요구사항: 7.1, 7.2_

  - [ ] 7.2 Swagger 스키마 검증
    - 생성된 API 문서가 올바른 검증 규칙을 표시하는지 확인
    - 기존 API 문서와 일관성 유지 확인
    - _요구사항: 7.2_

- [ ] 8. 코드 정리 및 최적화
  - [ ] 8.1 사용하지 않는 Zod 관련 파일 제거
    - zod-validation.pipe.ts 파일 삭제
    - requests.ts에서 사용하지 않는 Zod 스키마 제거
    - _요구사항: 5.1, 5.3_

  - [ ] 8.2 Import 문 정리
    - 모든 파일에서 불필요한 Zod import 제거
    - class-validator import 추가
    - _요구사항: 5.4_

  - [ ] 8.3 의존성 정리 (선택사항)
    - package.json에서 nestjs-zod 의존성 제거 검토 (다른 곳에서 사용 중인지 확인 후)
    - 사용하지 않는 Zod 관련 타입 정의 제거
    - _요구사항: 5.2_

- [ ] 9. 최종 검증 및 테스트
  - [ ] 9.1 전체 애플리케이션 빌드 및 실행 테스트
    - TypeScript 컴파일 에러 없이 빌드 성공 확인
    - 애플리케이션 정상 시작 확인
    - _요구사항: 7.3_

  - [ ] 9.2 API 엔드포인트 동작 검증
    - 모든 API 엔드포인트가 기존과 동일하게 작동하는지 수동 테스트
    - 검증 에러 응답이 기존 형식과 일치하는지 확인
    - _요구사항: 4.1, 4.2, 4.3_

  - [ ] 9.3 성능 및 호환성 최종 확인
    - 마이그레이션 전후 API 응답 시간 비교
    - 모든 기존 클라이언트 코드와의 호환성 확인
    - _요구사항: 4.4_