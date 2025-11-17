# PIM 버전 관리 시스템 테스트 요약

생성일: 2025-11-17  
상태: ✅ 완료

## 📋 작성된 테스트 파일

### Unit Tests

1. **product-masters.service.spec.ts** (완료)
   - Create-Then-Update 패턴 테스트
   - 빈 draft 생성 및 기본 정보 입력
   - 옵션 관리 (optionDiff)
   - Variant 자동 생성
   - 에러 처리

2. **product-versions.service.spec.ts** (완료)
   - 버전 생성 및 번호 자동 증가
   - 매핑 복사 (옵션, variant, 가격 규칙)
   - 버전 Publish (draft → active/inactive)
   - 버전 조회 및 트리 구조
   - 버전 비교
   - 권한 확인 (canUserModifyVersion)

3. **pricing.service.spec.ts** (완료)
   - 가격 정책 설정 (base_price, membership_price, tiered_price)
   - 버전별 가격 정책 관리
   - 가격 정책 재사용
   - 고아 규칙 정리
   - Active/Inactive 버전 수정 불가 테스트

4. **pricing-calculator.service.spec.ts** (완료)
   - 기본 가격 계산 (0원에서 시작)
   - 3단계 레이어 적용 (base → membership → tiered)
   - Scope 매칭 (all_variants, with_option, variants)
   - 연산 타입 (override, offset, scale)
   - 여러 규칙 순차 적용
   - 모든 Variant 가격 계산

5. **edge-cases.spec.ts** (완료)
   - 동시성 문제 (DB 제약 확인)
   - 고아 리소스 관리
   - 빈 데이터 처리
   - 대용량 데이터 (옵션 조합 폭발)
   - 버전 트리 복잡도
   - 특수 문자 처리
   - 동시 수정 시나리오

### Integration Tests

6. **product-workflow.spec.ts** (완료)
   - 완전한 상품 생성 플로우 (생성 → 정보 입력 → 옵션 → 가격 → Publish)
   - 버전 수정 플로우 (Draft 생성 → 수정 → Publish)
   - 버전 롤백 시나리오
   - 복잡한 옵션 변경
   - 가격 정책 버전 독립성

## 🏗️ 테스트 인프라

### 핵심 컴포넌트

- **PimTestDatabase** (`test/support/pim-test-database.ts`)
  - PostgreSQL testcontainer 관리
  - Drizzle-kit을 사용한 스키마 자동 생성
  - 테이블 정리 및 격리 보장

- **PimTestFactory** (`test/support/pim-test-factory.ts`)
  - 버전 관리 아키텍처에 맞춘 헬퍼 메서드
  - Master, Version, Option, Variant, Pricing Rule 생성
  - 통합 시나리오 헬퍼 (완전한 상품 생성 등)

- **test-setup.ts** (`test/support/test-setup.ts`)
  - `beforeAll`: 데이터베이스 초기화 확인
  - `beforeEach`: 모든 테이블 정리
  - `afterEach`: 디버그 정보 출력 (선택적)

- **jest-setup.ts & jest-teardown.ts**
  - Global setup/teardown hooks
  - Testcontainer 생명주기 관리

## 🎯 테스트 커버리지

### 주요 검증 포인트

✅ **Create-Then-Update 패턴**
  - 빈 draft 생성 후 단계별 정보 입력
  - 모든 필드가 선택사항
  - masterId와 versionId 별도 생성

✅ **버전 관리**
  - Draft → Active → Inactive 상태 전환
  - 버전 트리 구조 (부모-자식 관계)
  - 매핑 복사 (옵션, variant, 가격 규칙)
  - 버전별 독립성

✅ **옵션 관리**
  - OptionDiff를 통한 동적 옵션 추가/수정/제거
  - Display 정보 (버전별, 언어별)
  - Variant 자동 재생성

✅ **가격 정책**
  - 0원에서 시작하는 계산
  - 3단계 레이어 (base_price, membership_price, tiered_price)
  - Scope 매칭 (all_variants, with_option, variants)
  - 연산 타입 (override, offset, scale)
  - 버전별 독립적인 가격 정책

✅ **트랜잭션 안정성**
  - 모든 작업이 원자적으로 처리
  - 트랜잭션 롤백 시 데이터 정합성 보장

✅ **고아 리소스 정리**
  - 사용하지 않는 Pricing Rule 자동 삭제
  - Variant는 절대 삭제 안 됨 (WMS 안정성)

✅ **DB 제약 조건**
  - masterId당 하나의 active 버전만 허용
  - 버전 번호 유니크 제약
  - Foreign key 제약

✅ **에지 케이스**
  - 대용량 데이터 처리
  - 특수 문자 및 유니코드
  - 동시 수정 시나리오
  - 빈 데이터 처리

## 🚀 테스트 실행 방법

### 전체 테스트 실행
```bash
cd apps/pim
npm test
```

### 특정 파일 실행
```bash
npm test -- product-masters.service.spec.ts
```

### Coverage 리포트 생성
```bash
npm test -- --coverage
```

### Watch 모드
```bash
npm test -- --watch
```

## ⚙️ 테스트 설정

### Jest 설정 (`jest.config.js`)
- **testTimeout**: 60초 (testcontainer 시작 시간 고려)
- **maxWorkers**: 1 (DB 충돌 방지를 위한 순차 실행)
- **forceExit**: true (testcontainer 정리 보장)
- **setupFilesAfterEnv**: `test-setup.ts` (각 테스트 전 DB 정리)

### 환경 변수
- `TEST_DEBUG=true`: 테스트 후 테이블 카운트 출력
- `DATABASE_URL`: Testcontainer가 자동 설정

## 📊 테스트 통계

### 작성된 테스트 수
- **Unit Tests**: ~80+ test cases
  - ProductMastersService: ~15 tests
  - ProductVersionsService: ~20 tests
  - PricingService: ~15 tests
  - PricingCalculatorService: ~15 tests
  - Edge Cases: ~15 tests

- **Integration Tests**: ~5 complete workflows

### 예상 실행 시간
- 전체 테스트: ~3-5분 (testcontainer 시작 포함)
- 개별 파일: ~30-60초

## 🔍 디버깅 팁

### 1. 테스트 격리 문제
```bash
# beforeEach에서 clearAllTables() 호출 확인
# 순차 실행 보장 (maxWorkers: 1)
```

### 2. Testcontainer 시작 실패
```bash
# Docker가 실행 중인지 확인
docker ps

# Testcontainer 로그 확인
TEST_DEBUG=true npm test
```

### 3. 타입 에러
```bash
# 스키마와 타입이 동기화되어 있는지 확인
# PimTestFactory의 메서드 시그니처 확인
```

### 4. 트랜잭션 문제
```bash
# tx 파라미터가 올바르게 전달되는지 확인
# inTx() 헬퍼 사용 확인
```

## 🎓 새 테스트 작성 가이드

### 1. 기본 구조
```typescript
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';

describe('Your Test Suite', () => {
  beforeAll(async () => {
    await PimTestDatabase.setup();
    // Module 설정
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  it('should test something', async () => {
    // Factory를 사용한 테스트 데이터 생성
    const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();
    
    // 테스트 로직
    expect(master).toBeDefined();
  });
});
```

### 2. Factory 사용 예시
```typescript
// 빈 draft 생성
const { master } = await PimTestFactory.createEmptyDraftMaster();

// 기본 정보 포함 생성
const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
  name: '테스트 상품',
  brand: '브랜드',
});

// 옵션 포함 완전한 상품
const master = await PimTestFactory.createCompleteProductWithVersions({
  name: '상품',
  options: [
    {
      displayName: '색상',
      values: [{ displayName: '빨강' }, { displayName: '파랑' }],
    },
  ],
  basePrice: 10000,
});

// 가격 정책만
await PimTestFactory.createCompletePricingPolicy(
  master.masterId,
  master.version,
  {
    basePrice: 10000,
    membershipDiscount: 10,
    tieredPricing: [
      { minQuantity: 10, discountPercentage: 5 },
    ],
  },
);
```

### 3. 트랜잭션 사용
```typescript
const db = PimTestDatabase.getDb();

await db.transaction(async (tx) => {
  const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({}, tx);
  await PimTestFactory.createBasePriceRules(master.masterId, master.version, 10000, tx);
  // 모든 작업이 하나의 트랜잭션으로 처리됨
});
```

## 📝 향후 개선 사항

### 1. 성능 최적화
- [ ] 병렬 실행 가능한 테스트 분리
- [ ] Testcontainer 재사용 (여러 테스트 파일 간)

### 2. 추가 테스트
- [ ] WMS 이벤트 발행 검증 (mock 확인)
- [ ] 가격 계산 성능 테스트 (1000+ variants)
- [ ] 동시성 제어 상세 테스트

### 3. 테스트 유틸리티
- [ ] 스냅샷 테스트 도입
- [ ] Custom matchers (toBeValidMaster, toHaveActiveVersion 등)

## ✅ 체크리스트

테스트 작성 완료:
- [x] 기존 테스트 파일 제거
- [x] 새 PimTestFactory 작성
- [x] ProductMastersService 테스트
- [x] ProductVersionsService 테스트
- [x] PricingService 테스트
- [x] PricingCalculatorService 테스트
- [x] 통합 워크플로우 테스트
- [x] 에지 케이스 테스트

테스트 인프라:
- [x] PimTestDatabase (Testcontainer)
- [x] PimTestFactory (헬퍼)
- [x] test-setup.ts (격리)
- [x] Jest 설정 확인

문서화:
- [x] TEST_SUMMARY.md
- [x] 인라인 주석
- [x] 사용 예시

## 🔗 관련 문서

- [PIM_VERSION_MANAGEMENT_GUIDE.md](../PIM_VERSION_MANAGEMENT_GUIDE.md) - 시스템 전체 가이드
- [pim-version.plan.md](/pim-version.plan.md) - 테스트 계획 문서
- [test-setup.ts](./support/test-setup.ts) - 테스트 설정
- [pim-test-factory.ts](./support/pim-test-factory.ts) - 헬퍼 메서드

---

**마지막 업데이트**: 2025-11-17  
**작성자**: AI Assistant  
**검토자**: -



