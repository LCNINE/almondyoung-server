# Zod에서 Class-validator로 마이그레이션 요구사항

## 소개

현재 멤버십 구독 시스템은 Zod를 사용하여 HTTP 요청 검증을 수행하고 있습니다. NestJS의 표준 접근 방식인 class-validator로 마이그레이션하여 더 나은 TypeScript 통합, 데코레이터 기반 검증, 그리고 NestJS 생태계와의 일관성을 확보하고자 합니다. 이는 MVP 개발에 적합한 단순하고 직접적인 접근 방식을 유지하면서 진행됩니다.

## 요구사항

### 요구사항 1: 기존 Zod 스키마를 Class-validator DTO로 변환

**사용자 스토리:** 개발자로서, 기존 Zod 스키마를 class-validator 기반 DTO 클래스로 변환하여 NestJS 표준을 따르고 싶다.

#### 승인 기준

1. WHEN 기존 Zod 스키마가 있으면 THEN 시스템은 동일한 검증 로직을 가진 class-validator DTO 클래스로 변환해야 한다
2. WHEN DTO 클래스를 생성하면 THEN 시스템은 적절한 class-validator 데코레이터를 사용해야 한다
3. WHEN 복잡한 검증 규칙이 있으면 THEN 시스템은 커스텀 validator를 생성해야 한다
4. WHEN 타입 추론이 필요하면 THEN 시스템은 TypeScript 인터페이스를 유지해야 한다

### 요구사항 2: 컨트롤러 레이어 업데이트

**사용자 스토리:** 개발자로서, 모든 컨트롤러에서 Zod 파이프 대신 class-validator를 사용하고 싶다.

#### 승인 기준

1. WHEN 컨트롤러 메서드가 있으면 THEN 시스템은 @UsePipes(ZodValidationPipe) 대신 기본 ValidationPipe를 사용해야 한다
2. WHEN @Body() 데코레이터를 사용하면 THEN 시스템은 새로운 DTO 클래스를 타입으로 지정해야 한다
3. WHEN 글로벌 파이프 설정이 있으면 THEN 시스템은 ZodValidationPipe를 ValidationPipe로 교체해야 한다
4. WHEN 파라미터 검증이 필요하면 THEN 시스템은 적절한 class-validator 데코레이터를 사용해야 한다

### 요구사항 3: 에러 처리 일관성 유지

**사용자 스토리:** 개발자로서, 마이그레이션 후에도 동일한 에러 응답 형식을 유지하고 싶다.

#### 승인 기준

1. WHEN 검증 에러가 발생하면 THEN 시스템은 기존과 동일한 에러 응답 구조를 반환해야 한다
2. WHEN 한국어 에러 메시지가 있으면 THEN 시스템은 동일한 메시지를 유지해야 한다
3. WHEN 커스텀 에러 필터가 있으면 THEN 시스템은 class-validator 에러를 적절히 처리해야 한다
4. WHEN 필드별 에러가 있으면 THEN 시스템은 필드 경로와 메시지를 정확히 매핑해야 한다

### 요구사항 4: 기존 기능 호환성 보장

**사용자 스토리:** 개발자로서, 마이그레이션 후에도 모든 기존 API가 동일하게 작동하기를 원한다.

#### 승인 기준

1. WHEN API 엔드포인트를 호출하면 THEN 시스템은 기존과 동일한 검증 결과를 반환해야 한다
2. WHEN 유효한 요청을 보내면 THEN 시스템은 정상적으로 처리해야 한다
3. WHEN 무효한 요청을 보내면 THEN 시스템은 적절한 에러를 반환해야 한다
4. WHEN 복잡한 검증 규칙이 있으면 THEN 시스템은 동일한 검증 로직을 수행해야 한다

### 요구사항 5: 코드 정리 및 최적화

**사용자 스토리:** 개발자로서, 마이그레이션 완료 후 불필요한 Zod 관련 코드를 제거하고 싶다.

#### 승인 기준

1. WHEN 마이그레이션이 완료되면 THEN 시스템은 사용하지 않는 Zod 스키마를 제거해야 한다
2. WHEN Zod 의존성이 불필요하면 THEN 시스템은 package.json에서 제거해야 한다
3. WHEN 커스텀 Zod 파이프가 있으면 THEN 시스템은 해당 파일을 제거해야 한다
4. WHEN import 문이 정리되면 THEN 시스템은 불필요한 Zod import를 제거해야 한다

### 요구사항 6: 테스트 업데이트

**사용자 스토리:** 개발자로서, 모든 테스트가 새로운 class-validator 기반 검증과 함께 작동하기를 원한다.

#### 승인 기준

1. WHEN 컨트롤러 테스트가 있으면 THEN 시스템은 새로운 DTO 클래스를 사용하도록 업데이트해야 한다
2. WHEN 검증 테스트가 있으면 THEN 시스템은 class-validator 기반으로 수정해야 한다
3. WHEN 에러 케이스 테스트가 있으면 THEN 시스템은 새로운 에러 형식을 검증해야 한다
4. WHEN 모든 테스트를 실행하면 THEN 시스템은 성공적으로 통과해야 한다

### 요구사항 7: 문서화 및 타입 안전성

**사용자 스토리:** 개발자로서, Swagger 문서와 TypeScript 타입 안전성이 유지되기를 원한다.

#### 승인 기준

1. WHEN Swagger 문서를 생성하면 THEN 시스템은 class-validator 데코레이터를 기반으로 스키마를 생성해야 한다
2. WHEN API 문서를 확인하면 THEN 시스템은 정확한 검증 규칙을 표시해야 한다
3. WHEN TypeScript 컴파일을 수행하면 THEN 시스템은 타입 에러 없이 성공해야 한다
4. WHEN IDE에서 자동완성을 사용하면 THEN 시스템은 정확한 타입 정보를 제공해야 한다