# PIM 문서

PIM(Product Information Management) 서비스의 설계 문서 및 가이드입니다.

---

## 📚 문서 목록

### 1. [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md)
판매상품의 버전 관리 시스템에 대한 설계 철학과 원칙을 설명합니다.

**대상 독자:** 신규 개발자, 아키텍처 이해가 필요한 모든 팀원

**주요 내용:**
- Master와 Version의 개념 정의
- 설계 철학 및 원칙
- 아키텍처 패턴
- 명칭 규칙
- 사용 패턴 및 코드 예시
- 모범 사례 / 안티 패턴

**추천 읽는 순서:** 🥇 첫 번째

---

### 2. [API 설계 가이드](./API_DESIGN_GUIDE.md)
Master-Version 구조를 반영한 RESTful API 설계 가이드입니다.

**대상 독자:** Backend 개발자, Frontend 개발자, QA 엔지니어

**주요 내용:**
- API 설계 원칙
- 엔드포인트 구조 및 명세
- 요청/응답 형식
- 에러 처리
- 버전 관리 API 워크플로우
- 마이그레이션 가이드

**추천 읽는 순서:** 🥈 두 번째 (설계 철학 이해 후)

---

### 3. [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md)
버전 관리 도입 후 발견된 마이그레이션 이슈 및 해결 방안을 정리한 문서입니다.

**대상 독자:** 유지보수 담당자, 리팩토링 작업자, CTO

**주요 내용:**
- 발견된 이슈 목록 및 심각도
- 영향 범위 분석
- 수정 우선순위
- 상세 이슈 분석 및 수정 방안
- 체크리스트

**추천 읽는 순서:** 🥉 세 번째 (문제 해결 시 참고)

---

## 🚀 빠른 시작

### 새로운 팀원이 합류했을 때

1. **[Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md)** 읽기
   - Master와 Version 개념 이해
   - 설계 원칙 숙지

2. **[API 설계 가이드](./API_DESIGN_GUIDE.md)** 읽기
   - API 구조 파악
   - 엔드포인트 사용법 학습

3. **코드 실습**
   - `apps/pim/src/core/products/` 코드 리뷰
   - 테스트 코드 작성해보기

4. **[마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md)** 참고
   - 기존 이슈 파악
   - 체크리스트 숙지

---

## 🔧 개발 시나리오별 가이드

### 시나리오 1: 새로운 API 엔드포인트 추가

1. [API 설계 가이드](./API_DESIGN_GUIDE.md) - "설계 원칙" 섹션 참고
2. [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md) - "사용 패턴" 섹션 참고
3. 코드 작성
4. [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md) - 체크리스트로 검증

### 시나리오 2: 버그 수정

1. [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md) - 관련 이슈 검색
2. [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md) - "안티 패턴" 확인
3. 수정 후 테스트

### 시나리오 3: 리팩토링

1. [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md) - 우선순위 확인
2. [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md) - "모범 사례" 참고
3. [API 설계 가이드](./API_DESIGN_GUIDE.md) - API 일관성 유지

### 시나리오 4: 코드 리뷰

1. [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md) - 체크리스트 활용
2. [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md) - 설계 원칙 준수 확인
3. [API 설계 가이드](./API_DESIGN_GUIDE.md) - API 규칙 준수 확인

---

## 📖 용어 정리

| 용어 | 의미 | 예시 |
|------|------|------|
| **Master** | 버전들의 컨테이너 (메타데이터만 포함) | `product_masters` 테이블 |
| **Version** | 특정 시점의 상품 정보 (실제 데이터) | `product_master_versions` 테이블 |
| **Master ID** | Master의 UUID | `550e8400-e29b-41d4-a716-446655440000` |
| **Version ID** | Version의 UUID | `6ba7b810-9dad-11d1-80b4-00c04fd430c8` |
| **Version Number** | Master 내 버전 순번 | `1`, `2`, `3`, ... |
| **Version Status** | 버전 상태 | `draft`, `active`, `inactive` |
| **Active Version** | 현재 활성화된 버전 (사용자에게 노출) | 각 Master당 최대 1개 |
| **Draft Version** | 작성 중인 버전 (수정 가능) | 여러 개 가능 |

---

## 🎯 핵심 원칙 요약

### 1. 투명성 (Transparency)
일반 사용자는 버전의 존재를 인식할 필요가 없습니다. Active 버전만 자동으로 반환합니다.

### 2. 불변성 (Immutability)
Active/Inactive 버전은 수정할 수 없습니다. 변경이 필요하면 새 Draft를 생성합니다.

### 3. 단일 Active (Single Active)
하나의 Master는 최대 1개의 Active 버전만 가질 수 있습니다.

### 4. 명확한 구분
Master ID와 Version ID를 항상 명확히 구분합니다.

---

## ⚠️ 주의사항

### 절대 하지 말아야 할 것

❌ Master ID와 Version ID를 혼용  
❌ Active 버전 직접 수정  
❌ Version 없이 Mapping 테이블 사용  
❌ `productId` 같은 모호한 명칭 사용  
❌ 일반 사용자 API에 버전 개념 노출  

### 반드시 해야 할 것

✅ Master ID와 Version ID 명확히 구분  
✅ Draft 상태에서만 수정  
✅ Active 버전을 기본값으로 사용  
✅ 트랜잭션 올바르게 전파  
✅ 이벤트에 masterId와 versionId 모두 포함  

---

## 🔗 관련 파일

### 주요 코드
- 스키마: `apps/pim/src/schema.ts`
- 타입 정의: `apps/pim/src/types.ts`
- Product Masters Service: `apps/pim/src/core/products/services/product-masters.service.ts`
- Product Versions Service: `apps/pim/src/core/products/services/product-versions.service.ts`

### 테스트
- 단위 테스트: `apps/pim/test/unit/`
- 통합 테스트: `apps/pim/test/integration/`

### 이벤트
- Event Contracts: `packages/event-contracts/streams/product.stream.ts`

---

## 📝 문서 업데이트 가이드

이 문서들은 다음 경우에 업데이트해야 합니다:

### Master-Version 설계 철학
- 새로운 설계 원칙이 추가될 때
- 아키텍처 패턴이 변경될 때
- 새로운 모범 사례가 발견될 때

### API 설계 가이드
- 새로운 엔드포인트가 추가될 때
- 기존 엔드포인트가 변경될 때 (Breaking Change 명시)
- API 규칙이 업데이트될 때

### 마이그레이션 이슈 보고서
- 새로운 이슈가 발견될 때
- 이슈가 해결될 때 (체크리스트 업데이트)
- 우선순위가 변경될 때

---

## 📞 문의

문서에 대한 질문이나 제안사항이 있으면:
- CTO에게 문의
- Backend Team Lead에게 문의
- GitHub Issue 생성

---

**문서 버전:** 1.0.0  
**최종 업데이트:** 2025-11-24  
**작성자:** AI Development Assistant  
**관리자:** CTO, Backend Team Lead

