# WMS 문서 가이드

## 개요
본 디렉토리는 AlmondYoung WMS 시스템의 종합 문서를 포함합니다. 각 문서는 실제 구현된 코드와 일치하도록 최신 상태로 유지됩니다.

## 📋 문서 목록

### 🏗️ 시스템 아키텍처
- **[wms_nestjs_structure.md](./wms_nestjs_structure.md)** - WMS 전체 모듈 구조와 서비스 책임 정의
- **[order-module-architecture.md](./order-module-architecture.md)** - Order 모듈의 상세 아키텍처 설명
- **[inventory-state-architecture.md](./inventory-state-architecture.md)** - 재고 상태 관리 설계 원칙

### 📦 도메인별 가이드

#### 재고 관리 (Inventory)
- **[wms-inventory-inbound-overview.md](./wms-inventory-inbound-overview.md)** - 재고관리 및 입고 시스템 전반 개요
- **[location-service.md](./location-service.md)** - 로케이션 관리 서비스 상세 가이드

#### 주문 처리 (Order)
- **[wms-orders-design.md](./wms-orders-design.md)** - 주문 도메인(SO/FO) 설계 문서
- **[order-services-guide.md](./order-services-guide.md)** - Order 모듈 핵심 서비스들 상세 가이드
- **[so-fo-relationship-diagram.md](./so-fo-relationship-diagram.md)** - SO-FO 관계 다이어그램
- **[so-fo-ai-response.md](./so-fo-ai-response.md)** - SO-FO 설계 논의 기록

#### 출고 시스템 (Outbound)
- **[wms-outbound-requirements.md](./wms-outbound-requirements.md)** - 출고 시스템 요구사항
- **[outbound-system-implementation-plan.md](./outbound-system-implementation-plan.md)** - FOI 기반 출고 시스템 구현 계획
- **[goodsflow-openapi.md](./goodsflow-openapi.md)** - 굿스플로 택배 API 연동 문서

#### 발주 관리 (Purchase)
- **[purchase-order-requirements.md](./purchase-order-requirements.md)** - 발주 관리 시스템 요구사항

### 🔧 기술 가이드
- **[timezone-and-date-utils.md](./timezone-and-date-utils.md)** - Asia/Seoul 시간대 처리 유틸리티 가이드

## 🎯 문서 읽기 가이드

### 신규 개발자를 위한 권장 순서
1. **[wms_nestjs_structure.md](./wms_nestjs_structure.md)** - 전체 시스템 구조 파악
2. **[wms-inventory-inbound-overview.md](./wms-inventory-inbound-overview.md)** - 핵심 재고 시스템 이해
3. **[order-module-architecture.md](./order-module-architecture.md)** - 주문 시스템 구조 이해
4. **[order-services-guide.md](./order-services-guide.md)** - 핵심 서비스들의 역할과 API
5. 필요에 따라 도메인별 상세 문서 참조

### 기능별 문서 매핑

#### 재고 관리 작업 시
- [wms-inventory-inbound-overview.md](./wms-inventory-inbound-overview.md)
- [location-service.md](./location-service.md)
- [inventory-state-architecture.md](./inventory-state-architecture.md)

#### 주문/출고 작업 시
- [order-module-architecture.md](./order-module-architecture.md)
- [order-services-guide.md](./order-services-guide.md)
- [wms-orders-design.md](./wms-orders-design.md)
- [outbound-system-implementation-plan.md](./outbound-system-implementation-plan.md)

#### 발주 시스템 작업 시
- [purchase-order-requirements.md](./purchase-order-requirements.md)

#### 외부 연동 작업 시
- [goodsflow-openapi.md](./goodsflow-openapi.md)
- [timezone-and-date-utils.md](./timezone-and-date-utils.md)

## 📝 문서 업데이트 정책

### 최신성 보장
- 모든 문서는 실제 구현된 코드와 일치하도록 유지됩니다
- 코드 변경 시 관련 문서의 동시 업데이트를 권장합니다

### 문서 분류
- **✅ 완전 구현**: 실제 코드와 완전히 일치하는 문서
- **🚧 부분 구현**: 일부 기능이 구현되어 있고 문서가 이를 반영
- **📋 설계 문서**: 향후 구현 예정인 기능의 설계 문서

### 현재 상태
대부분의 문서가 **✅ 완전 구현** 상태로, 실제 동작하는 시스템을 정확히 반영합니다.

## 🔍 문서별 상세 정보

### 핵심 실무 문서
| 문서 | 상태 | 설명 |
|------|------|------|
| wms_nestjs_structure.md | ✅ | 실제 모듈 구조 완전 반영 |
| order-module-architecture.md | ✅ | 완전 구현된 Order 모듈 설명 |
| order-services-guide.md | ✅ | 15개 핵심 서비스 상세 가이드 |
| wms-inventory-inbound-overview.md | ✅ | 동작 중인 재고/입고 시스템 |
| location-service.md | ✅ | 구현된 로케이션 관리 시스템 |

### 설계 및 요구사항 문서
| 문서 | 상태 | 설명 |
|------|------|------|
| wms-orders-design.md | 📋 | 주문 시스템 설계 원칙 |
| outbound-system-implementation-plan.md | 📋 | FOI 기반 출고 시스템 계획 |
| purchase-order-requirements.md | 📋 | 발주 시스템 요구사항 |
| inventory-state-architecture.md | 📋 | 재고 상태 관리 설계 |

### 참조 문서
| 문서 | 상태 | 설명 |
|------|------|------|
| goodsflow-openapi.md | ✅ | 외부 API 연동 문서 |
| timezone-and-date-utils.md | ✅ | 구현된 시간 유틸리티 |
| so-fo-relationship-diagram.md | ✅ | 관계 다이어그램 |

## 🤝 기여 가이드

### 문서 수정 시
1. 관련 코드 변경사항 확인
2. 문서 내용 업데이트
3. 실제 동작과 일치성 검증
4. 다른 관련 문서들과의 일관성 확인

### 새 문서 작성 시
1. 적절한 카테고리 선택
2. README.md 목록에 추가
3. 다른 문서들과의 연관성 명시
4. 실제 구현 상태 표시

---

이 문서들은 AlmondYoung WMS의 복잡한 비즈니스 로직과 기술 구조를 이해하는 데 핵심적인 역할을 합니다. 각 문서는 실무에 직접 활용할 수 있도록 구체적이고 정확한 정보를 제공합니다.