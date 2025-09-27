# WMS 창고 레이아웃 시스템 MVP 설계

## 📋 MVP 개요

MVP에서는 **핵심 가치**에만 집중합니다:
- 2D GUI로 창고 레이아웃을 시각적으로 설계
- 블록 기반 레이아웃 편집
- 설계된 레이아웃을 실제 운영에 적용

**제외되는 고급 기능들:**
- ❌ 버전 관리 시스템
- ❌ 컴파일 검증 시스템  
- ❌ Draft/Published 상태 관리
- ❌ 롤백 기능

---

## 🎯 MVP 핵심 원칙

### 1:1 관계 유지
- **1개 창고 = 최대 1개 레이아웃**
- 레이아웃이 없는 창고도 허용 (아직 설계 안 함)

### 단순한 참조 관계
- **표준 로케이션**: 문자열 참조 (자동 생성)
- **독립 로케이션**: 일반적인 FK 참조

### 즉시 적용
- 레이아웃 저장 = 즉시 운영 적용
- 별도의 "배포" 과정 없음

---

## 🗃️ MVP 데이터베이스 설계

### 1. warehouse_structure (창고 구조 정의)
```sql
CREATE TABLE warehouse_structure (
    id UUID PRIMARY KEY DEFAULT uuid_v7(),
    warehouse_id UUID REFERENCES warehouses(id) UNIQUE,
    
    -- 동적 생성 규칙 (표준 로케이션용)
    structure_config JSONB NOT NULL,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 2. warehouse_layouts (창고별 단일 레이아웃)
```sql
CREATE TABLE warehouse_layouts (
    id UUID PRIMARY KEY DEFAULT uuid_v7(),
    warehouse_id UUID REFERENCES warehouses(id) UNIQUE, -- 1:1 관계
    
    -- 레이아웃 메타데이터
    name VARCHAR(255) NOT NULL DEFAULT 'Main Layout',
    description TEXT,
    
    -- 상태 (단순화)
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. layout_blocks (레이아웃 블록들)
```sql
CREATE TABLE layout_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_v7(),
    layout_id UUID REFERENCES warehouse_layouts(id) ON DELETE CASCADE,
    block_type VARCHAR(20) NOT NULL, -- 'rack' | 'location_set' | 'path' | 'column'
    
    -- 2D 그리드 위치
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    
    -- 접근 방향
    open_directions TEXT[], -- ['north', 'south', 'east', 'west']
    
    -- 블록별 참조 정보
    block_reference JSONB NOT NULL,
    
    -- 메타데이터
    display_name VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4. layout_block_locations (로케이션 집합용 FK 테이블)
```sql
CREATE TABLE layout_block_locations (
    id UUID PRIMARY KEY DEFAULT uuid_v7(),
    block_id UUID REFERENCES layout_blocks(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(block_id, location_id)
);
```

---

## 🧱 MVP 블록 참조 방식

### 🏭 **랙 블록 (문자열 참조)**
```typescript
interface RackBlockReference {
  type: 'rack';
  rackId: string;  // "A-04" - 단순 식별자
}
```

### 📏 **열 블록 (문자열 참조)**
```typescript
interface ColumnBlockReference {
  type: 'column';
  columnName: string;      // "A"
  rackRange: {
    start: number;         // 1
    end: number;           // 5
  };
}
```

### 📦 **로케이션 집합 블록 (FK 참조)**
```typescript
interface LocationSetBlockReference {
  type: 'location_set';
  // locationNames 대신 별도 테이블로 FK 관리
}
```

### 🛤️ **길 블록**
```typescript
interface PathBlockReference {
  type: 'path';
  // 추가 참조 정보 없음
}
```

---

## 🔧 MVP API 설계

### 레이아웃 관리
```typescript
// 창고 레이아웃 생성 (최초 1회만)
POST /warehouses/{id}/layout
{
  "name": "Main Layout",
  "description": "창고 A의 기본 레이아웃"
}

// 창고 레이아웃 조회
GET /warehouses/{id}/layout

// 창고 레이아웃 수정
PUT /warehouses/{id}/layout
{
  "name": "Updated Layout",
  "description": "수정된 레이아웃"
}

// 창고 레이아웃 삭제
DELETE /warehouses/{id}/layout
```

### 블록 관리
```typescript
// 블록 생성
POST /layouts/{layout_id}/blocks
{
  "block_type": "rack",
  "position_x": 5,
  "position_y": 2,
  "width": 2,
  "height": 1,
  "open_directions": ["west"],
  "block_reference": {
    "type": "rack",
    "rackId": "A-04"
  },
  "display_name": "A-04 랙"
}

// 블록 목록 조회
GET /layouts/{layout_id}/blocks

// 블록 수정
PUT /blocks/{block_id}
{
  "position_x": 6,
  "display_name": "A-04 랙 (수정됨)"
}

// 블록 삭제
DELETE /blocks/{block_id}
```

### 로케이션 집합 관리 (FK 기반)
```typescript
// 로케이션 집합 블록에 로케이션 추가
POST /blocks/{block_id}/locations
{
  "location_id": "location-uuid-123"
}

// 로케이션 집합에서 로케이션 제거
DELETE /blocks/{block_id}/locations/{location_id}

// 로케이션 집합 내 로케이션 목록 조회
GET /blocks/{block_id}/locations
```

---

## 📊 MVP 데이터 예시

### 1. Warehouse Layout
```json
{
  "id": "layout-001",
  "warehouse_id": "wh-001",
  "name": "창고 A 메인 레이아웃",
  "description": "창고 A의 기본 레이아웃 설계",
  "is_active": true,
  "created_at": "2024-01-15T09:00:00Z"
}
```

### 2. Layout Blocks
```json
[
  {
    "id": "block-rack-001",
    "layout_id": "layout-001",
    "block_type": "rack",
    "position_x": 5,
    "position_y": 2,
    "width": 2,
    "height": 1,
    "open_directions": ["west"],
    "block_reference": {
      "type": "rack",
      "rackId": "A-04"
    },
    "display_name": "A-04 랙"
  },
  {
    "id": "block-location-set-001",
    "layout_id": "layout-001",
    "block_type": "location_set",
    "position_x": 0,
    "position_y": 0,
    "width": 3,
    "height": 2,
    "open_directions": ["east"],
    "block_reference": {
      "type": "location_set"
    },
    "display_name": "입고 구역"
  }
]
```

### 3. Layout Block Locations (FK 테이블)
```json
[
  {
    "id": "rel-001",
    "block_id": "block-location-set-001",
    "location_id": "loc-inbound-zone",
    "created_at": "2024-01-15T09:00:00Z"
  },
  {
    "id": "rel-002", 
    "block_id": "block-location-set-001",
    "location_id": "loc-temp-storage-a",
    "created_at": "2024-01-15T09:00:00Z"
  }
]
```

---

## 🚀 MVP 구현 로드맵

### Phase 1: 기본 CRUD (2주) 🎯
**목표: 레이아웃과 블록을 생성/조회/수정/삭제할 수 있는 기반**

#### 📋 백엔드 구현
- ✅ `warehouse_structure` 테이블 생성
- ✅ `warehouse_layouts` 테이블 생성
- ✅ `layout_blocks` 테이블 생성
- ✅ `layout_block_locations` 테이블 생성
- ✅ 레이아웃 CRUD API
- ✅ 블록 CRUD API
- ✅ 로케이션 집합 관리 API

#### 🛡️ 기본 검증 로직
- ✅ 창고당 레이아웃 1개 제한
- ✅ 블록 겹침 검사
- ✅ 블록 위치 범위 검증
- ✅ FK 제약조건 검증

### Phase 2: 2D 에디터 (4주) 🎮
**목표: 실제 사용 가능한 웹 기반 레이아웃 에디터**

- ✅ React 기반 그리드 컴포넌트
- ✅ 드래그 앤 드롭 블록 배치
- ✅ 4가지 블록 타입 UI
- ✅ 실시간 충돌 검사
- ✅ 로케이션 선택 UI (독립 로케이션용)

### Phase 3: 기본 연동 (2주) 🔄
**목표: 기존 WMS와 기본적인 연동**

- ✅ 레이아웃 데이터를 실제 로케이션으로 변환
- ✅ 기존 LocationService와 연동
- ✅ 기본적인 FIFO 순서 적용

---

## 💡 MVP의 제약사항 및 향후 확장점

### 현재 제약사항
- ❌ 레이아웃 변경 시 이력 관리 없음
- ❌ 잘못된 레이아웃 설계 시 사전 검증 없음
- ❌ 실험적 레이아웃 테스트 불가
- ❌ 로케이션 삭제 시 FK 제약조건으로 레이아웃 영향받음

### 향후 확장 가능한 기능들
- ✅ 버전 관리 시스템 추가
- ✅ 컴파일/검증 시스템 추가
- ✅ A/B 테스트 기능
- ✅ 레이아웃 성능 분석
- ✅ 자동 최적화 제안

---

## 🎯 MVP 성공 기준

### 기술적 성공
- [ ] 창고 관리자가 2D GUI로 레이아웃 설계 가능
- [ ] 설계된 레이아웃이 실제 WMS 시스템에 반영됨
- [ ] 기존 피킹 시스템과 문제없이 연동

### 비즈니스 성공  
- [ ] 레이아웃 변경 시간 90% 단축 (기존 수일 → 수시간)
- [ ] 창고 관리자 만족도 80% 이상
- [ ] 시스템 안정성 99% 이상 유지

**MVP 완성 후 실제 사용 피드백을 통해 v2.0 기능(버전 관리, 컴파일 등) 필요성 검증** 