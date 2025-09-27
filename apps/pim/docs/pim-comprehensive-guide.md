# PIM (Product Information Management) 시스템 종합 가이드

## 📋 목차
1. [시스템 개요](#시스템-개요)
2. [핵심 엔티티](#핵심-엔티티)
3. [주요 기능](#주요-기능)
4. [API 엔드포인트](#api-엔드포인트)
5. [가격 전략 시스템](#가격-전략-시스템)
6. [아키텍처](#아키텍처)
7. [데이터 플로우](#데이터-플로우)

---

## 🎯 시스템 개요

**PIM (Product Information Management) 시스템**은 전자상거래 플랫폼에서 상품 정보를 중앙 집중식으로 관리하는 마이크로서비스입니다.

### 핵심 가치
- **중앙 집중화**: 모든 상품 정보를 한 곳에서 관리
- **다채널 지원**: 여러 판매 채널에 최적화된 상품 정보 제공
- **유연한 가격 전략**: 옵션별/품목별 다양한 가격 책정 방식
- **확장성**: 대량의 상품과 복잡한 옵션 구조 지원

---

## 🗂️ 핵심 엔티티

### 1. **Product Categories (상품 카테고리)**
```typescript
상품 분류 체계를 관리하는 계층적 구조
```

**주요 속성:**
- `name`: 카테고리 명
- `slug`: URL 친화적 식별자
- `parentId`: 상위 카테고리 (계층 구조)
- `level`: 카테고리 깊이
- `path`: 전체 경로 (/electronics/smartphones)
- `sortOrder`: 정렬 순서

**용도:**
- 상품 분류 및 그룹화
- 네비게이션 메뉴 구성
- SEO 최적화된 URL 구조

### 2. **Product Masters (상품 마스터)**
```typescript
판매 상품의 기본 정보를 관리하는 핵심 엔티티
```

**주요 속성:**
- `name`: 상품명
- `description`: 상품 설명
- `brand`: 브랜드
- `categoryId`: 소속 카테고리
- `basePrice`: 기본 가격 (원 단위)
- `pricingStrategy`: 가격 전략 ('option_based' | 'variant_based')
- `attributes`: 상품 속성 (색상, 소재, 용량 등)
- `images`: 상품 이미지 URL 배열
- `seoTitle/seoDescription/seoKeywords`: SEO 최적화 정보

**핵심 개념:**
- **마스터**: 실제 판매되는 "상품"의 개념
- **물리적 속성 제외**: 무게, 크기 등은 관리하지 않음 (판매 중심)
- **SEO 최적화**: 검색 엔진 최적화를 위한 메타데이터 포함

### 3. **Product Option Groups & Values (상품 옵션)**
```typescript
상품의 선택 가능한 옵션들을 정의
```

**구조:**
- **Option Groups**: 옵션의 카테고리 (예: "색상", "크기")
- **Option Values**: 각 그룹의 구체적 값 (예: "빨강", "파랑")

**예시:**
```
옵션 그룹: "색상"
  ├── 옵션 값: "빨강" (추가 가격: +0원)
  ├── 옵션 값: "파랑" (추가 가격: +5,000원)
  └── 옵션 값: "검정" (추가 가격: +10,000원)

옵션 그룹: "크기"
  ├── 옵션 값: "S"
  ├── 옵션 값: "M"
  └── 옵션 값: "L"
```

### 4. **Product Variants (상품 품목)**
```typescript
옵션 조합으로 생성되는 실제 판매 단위
```

**개념:**
- 마스터 + 옵션 조합 = 품목
- 예: "나이키 티셔츠 (빨강/M)" = 하나의 품목
- 각 품목은 고유한 SKU를 가짐

**주요 속성:**
- `masterId`: 소속 마스터
- `sku`: 고유 식별 코드
- `basePrice`: 기본 가격 (variant_based 전략에서 사용)
- `attributes`: 품목별 속성

### 5. **Sales Channels (판매 채널)**
```typescript
상품이 판매되는 플랫폼들을 정의
```

**예시:**
- 자사 웹사이트
- 네이버 스마트스토어
- 쿠팡
- 11번가
- 오프라인 매장

### 6. **Channel Products (채널별 상품)**
```typescript
각 판매 채널에 특화된 상품 정보
```

**주요 속성:**
- `masterId`: 기준 마스터 상품
- `channelId`: 대상 판매 채널
- `name`: 채널별 상품명 (플랫폼에 맞게 최적화)
- `isActive`: 채널별 판매 활성화 여부
- `channelSpecificData`: 채널별 특수 데이터

**용도:**
- 플랫폼별 상품명 최적화
- 채널별 판매 상태 관리
- 플랫폼 특화 정보 저장

### 7. **가격 관리 테이블**
```typescript
- option_value_prices: 옵션별 가격 (option_based 전략)
- variant_prices: 품목별 가격 (variant_based 전략)
```

---

## 🚀 주요 기능

### 1. **상품 마스터 관리**
- ✅ 상품 마스터 생성/수정/삭제
- ✅ 옵션 그룹 및 값 자동 생성
- ✅ 품목 자동 생성 (옵션 조합)
- ✅ 가격 전략 초기화
- ✅ 상품 목록 조회 (페이징, 검색, 필터)
- ✅ 상품 상세 정보 조회

### 2. **상품 품목 관리**
- ✅ 품목별 정보 조회
- ✅ 품목별 가격 설정
- ✅ 품목 활성화/비활성화
- ✅ 품목별 SKU 관리

### 3. **채널별 상품 관리**
- ✅ 채널별 상품 등록
- ✅ 채널별 상품명 최적화
- ✅ 채널별 판매 상태 관리
- ✅ 플랫폼 특화 데이터 관리

### 4. **가격 전략 시스템**
- ✅ **Option-based**: 옵션별 추가 가격
- ✅ **Variant-based**: 품목별 고정 가격
- ✅ 가격 미리보기 기능
- ✅ 가격 전략 변경

### 5. **카테고리 관리**
- ✅ 계층적 카테고리 구조
- ✅ 카테고리별 상품 분류
- ✅ SEO 친화적 URL 생성

---

## 🌐 API 엔드포인트

### **Product Masters API** (`/masters`)
```typescript
POST   /masters              // 상품 마스터 생성
GET    /masters              // 상품 목록 조회 (페이징, 검색)
GET    /masters/:id          // 상품 상세 조회
PUT    /masters/:id          // 상품 정보 수정
DELETE /masters/:id          // 상품 삭제
GET    /masters/:id/preview  // 가격 미리보기
PUT    /masters/:id/pricing  // 가격 전략 변경
```

### **Product Variants API** (`/variants`)
```typescript
GET    /variants             // 품목 목록 조회
GET    /variants/:id         // 품목 상세 조회
PUT    /variants/:id         // 품목 정보 수정
PUT    /variants/:id/price   // 품목 가격 수정
```

### **Channel Products API** (`/channels/:channelId/products`)
```typescript
GET    /channels/:channelId/products              // 채널별 상품 목록
POST   /channels/:channelId/products              // 채널에 상품 등록
GET    /channels/:channelId/products/:productId   // 채널별 상품 상세
PUT    /channels/:channelId/products/:productId   // 채널별 상품 수정
DELETE /channels/:channelId/products/:productId   // 채널에서 상품 제거
```

### **Categories API** (`/categories`)
```typescript
GET    /categories           // 카테고리 목록 (계층 구조)
POST   /categories           // 카테고리 생성
GET    /categories/:id       // 카테고리 상세
PUT    /categories/:id       // 카테고리 수정
DELETE /categories/:id       // 카테고리 삭제
```

### **Sales Channels API** (`/sales-channels`)
```typescript
GET    /sales-channels       // 판매 채널 목록
POST   /sales-channels       // 판매 채널 생성
PUT    /sales-channels/:id   // 판매 채널 수정
DELETE /sales-channels/:id   // 판매 채널 삭제
```

---

## 💰 가격 전략 시스템

### **1. Option-based 전략**
```typescript
기본 가격 + 선택된 옵션들의 추가 가격

예시:
- 기본 상품: 50,000원
- 색상 "빨강": +0원
- 크기 "L": +5,000원
- 최종 가격: 55,000원
```

**장점:**
- 옵션별 세밀한 가격 조정 가능
- 새로운 옵션 추가 시 유연함

**적용 상품:**
- 의류, 신발 등 옵션별 가격 차이가 있는 상품

### **2. Variant-based 전략**
```typescript
각 품목(옵션 조합)마다 고정 가격

예시:
- "빨강/S": 50,000원
- "빨강/M": 52,000원
- "빨강/L": 55,000원
- "파랑/S": 55,000원 (색상에 따른 가격 차이)
```

**장점:**
- 복잡한 가격 정책 적용 가능
- 품목별 개별 관리

**적용 상품:**
- 전자제품, 복잡한 옵션 조합이 있는 상품

---

## 🏗️ 아키텍처

### **기술 스택**
- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod
- **Architecture**: Clean Architecture + DDD

### **레이어 구조**
```
📁 apps/pim/
├── 📁 src/
│   ├── 📁 controllers/     # API 엔드포인트
│   ├── 📁 services/        # 비즈니스 로직
│   │   └── 📁 pricing/     # 가격 전략 패턴
│   ├── 📁 schemas/         # 입력 검증 스키마
│   ├── 📁 types/           # TypeScript 타입 정의
│   ├── schema.ts           # 데이터베이스 스키마
│   └── pim.module.ts       # NestJS 모듈 설정
├── 📁 test/                # 통합 테스트
└── 📁 docs/                # 문서
```

### **디자인 패턴**
- **Strategy Pattern**: 가격 전략 시스템
- **Factory Pattern**: 가격 전략 팩토리
- **Repository Pattern**: 데이터 액세스 계층
- **DTO Pattern**: 데이터 전송 객체

---

## 📊 데이터 플로우

### **1. 상품 생성 플로우**
```
1. 상품 마스터 생성
   ↓
2. 옵션 그룹/값 생성
   ↓
3. 품목 자동 생성 (옵션 조합)
   ↓
4. 가격 전략 초기화
   ↓
5. 채널별 상품 등록 (선택사항)
```

### **2. 가격 계산 플로우**
```
Option-based:
고객 옵션 선택 → 기본가격 + 옵션 추가가격 → 최종 가격

Variant-based:
고객 옵션 선택 → 품목 식별 → 품목별 고정가격 → 최종 가격
```

### **3. 다채널 동기화 플로우**
```
마스터 상품 수정
   ↓
관련 품목 업데이트
   ↓
채널별 상품 정보 동기화
   ↓
각 플랫폼별 최적화된 정보 제공
```

---

## 🎯 완성 시 제공 기능

### **관리자 기능**
- 📦 상품 마스터 전체 생명주기 관리
- 🏷️ 복잡한 옵션 구조 설계 및 관리
- 💰 유연한 가격 전략 설정 및 변경
- 🌐 다채널 상품 정보 최적화
- 📊 상품 성과 분석 및 리포팅

### **고객 기능**
- 🔍 빠른 상품 검색 및 필터링
- 📱 반응형 상품 상세 페이지
- 💎 실시간 가격 계산 및 미리보기
- 🛒 옵션 선택에 따른 즉시 피드백

### **시스템 기능**
- ⚡ 대용량 상품 데이터 처리
- 🔄 실시간 재고 및 가격 동기화
- 🛡️ 데이터 무결성 보장
- 📈 확장 가능한 아키텍처

---

## 🔜 향후 확장 계획

1. **재고 관리 시스템 연동**
2. **주문 관리 시스템 연동**
3. **추천 알고리즘 적용**
4. **A/B 테스트 플랫폼 구축**
5. **다국어/다통화 지원**
6. **AI 기반 상품 태깅**

---

*이 문서는 PIM 시스템의 현재 상태와 목표를 종합적으로 정리한 것입니다. 개발 진행에 따라 지속적으로 업데이트됩니다.* 