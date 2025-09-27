## 로케이션 서비스 가이드

본 문서는 WMS 내 로케이션(Location) 관리 설계와 사용법을 정리합니다. 컨트롤러/서비스/DTO/스키마의 역할과 핵심 정책, API 사용 예시를 포함합니다.

### 위치와 주요 파일
- 컨트롤러: `apps/wms/src/inventory/controllers/location.controller.ts`
- 서비스: `apps/wms/src/inventory/services/location.service.ts`
- DTOs:
  - 생성/확장: `apps/wms/src/inventory/dto/location-create.dto.ts`
  - 수정/일괄수정: `apps/wms/src/inventory/dto/location-update.dto.ts`
  - 조회/리스트 응답: `apps/wms/src/inventory/dto/location-query.dto.ts`, `apps/wms/src/inventory/dto/location-response.dto.ts`
- 타입: `apps/wms/src/inventory/types/location.types.ts`
- 상수: `apps/wms/src/inventory/constants/warehouse.constants.ts`
- 스키마: `apps/wms/database/schemas/wms-schema.ts`

## 데이터 모델

### 개요
로케이션은 3계층 구조를 가집니다.
1) `location_columns`(열, A/B/C 등) → 2) `location_racks`(랙 번호) → 3) `locations`(실제 보관 위치)

### 테이블 요약
- `location_columns`
  - 컬럼: `id`, `warehouse_id`, `column_name`, `display_order`, `is_active`, `created_at`, `updated_at`
  - 제약: 창고별 `warehouse_id + column_name` 유니크

- `location_racks`
  - 컬럼: `id`, `column_id`, `rack_number`, `default_bin_start`, `default_bin_end`, `auto_generate_bins`, 물리정보(`physical_width`, `physical_height`), `notes`, `is_active` 등
  - 제약: `column_id + rack_number` 유니크

- `locations`
  - 공통: `id`, `warehouse_id`, `code`, `location_type`(`standard` | `zone`), `display_name`, `is_active`, `notes`, 메타(`capacity_limit`, `fifo_rank`, `is_expiry_separated`), `created_at`, `updated_at`
  - 표준(Standard): `rack_id`(FK), `bin_identifier` 필수. 예: `A-01-01`
  - 구역(Zone): `rack_id`, `bin_identifier`는 항상 NULL. 예: `zone-1`, `zone-inbound-default`
  - 제약:
    - `warehouse_id + code` 유니크
    - 표준/구역 무결성 체크 (표준은 `rack_id`/`bin_identifier` 필수, 구역은 둘 다 NULL)
    - 시스템 로케이션 보호(아래 참조)

### 시스템 로케이션(내장 기본존)
- 목적: 모든 창고에 기본으로 존재해야 하는 운영 존(예: 입고기본존, 반품기본존)을 시스템이 생성·보호
- 스키마 필드: `is_system boolean default false`, `system_role enum('inbound_default','return_default')`
- 제약:
  - `is_system = true` ⇔ `system_role IS NOT NULL`
  - `unique(warehouse_id, system_role)` (창고당 역할 1개)
  - 정책: `is_system = true` → `location_type = 'zone'`
- 역할 정의/기본값: `SYSTEM_LOCATION_DEFAULTS`(`zone-inbound-default`/`입고 기본존`, `zone-return-default`/`반품 기본존`)
  - 파일: `apps/wms/src/inventory/constants/warehouse.constants.ts`

## 서비스 책임

### 생성/수정/조회 핵심
- 열 생성: `createColumn(warehouseId, dto)`
- 랙 생성: `createRack(warehouseId, dto)`
  - `binSettings.autoGenerate=true`이면 `defaultBinStart~defaultBinEnd` 범위로 표준 빈을 자동 생성(A-01-01 형식)
  - `binSettings.customBins[]` 제공 시 커스텀 빈 추가 생성(예: `A-01-바닥`)
- 구역 로케이션 생성: `createZoneLocation(warehouseId, dto)`
  - 코드에 한글 포함 시, `zone-N` 자동 코드 부여(표시는 한글 유지 가능)
- 목록/상세 조회: `getLocations(warehouseId, query)`, `getLocationById(locationId)`
  - 필터: 타입/열/랙/활성/검색어 + 페이징/정렬

### 시스템 로케이션 프로비저닝(멱등)
- `ensureSystemLocations(warehouseId)`
  - 창고에 대해 필수 역할(입고/반품 기본존) 존재 확인 후 미존재 시 생성
- 트리거 지점
  - 앱 부팅 시: 모든 창고에 대해 1회 보정 (`InventoryService.onModuleInit`)
  - 창고 생성 시: 즉시 보정 (`InventoryService.createWarehouse`)
- 역할 조회 유틸: `getSystemLocationByRole(warehouseId, role)`

### 보호 정책(시스템 로케이션)
- 수정: `LocationService.updateLocation`에서 허용 필드만 수정 반영
  - 허용: `displayName`, `notes`, `isActive`, `capacityLimit`, `fifoRank`, `isExpirySeparated`
  - 비허용: `code`, `locationType`, `systemRole` 등 식별자/핵심 무결성
- 삭제: `deleteLocation(locationId)` 차단 (예외 발생)

## REST API 개요
컨트롤러: `@Controller('wms/locations')`

### 열(Column)
- POST `/wms/locations/warehouses/:warehouseId/columns` 생성
- GET `/wms/locations/warehouses/:warehouseId/columns` 조회(활성 필터)
- PUT `/wms/locations/columns/:columnId` 수정

### 랙(Rack)
- POST `/wms/locations/warehouses/:warehouseId/racks` 생성(표준 빈 자동/커스텀 가능)
- GET `/wms/locations/warehouses/:warehouseId/racks` 조회(열/활성 필터)
- PUT `/wms/locations/racks/:rackId` 수정
- POST `/wms/locations/warehouses/:warehouseId/racks/custom-bins` 커스텀 빈 추가

### 로케이션(Location)
- POST `/wms/locations/warehouses/:warehouseId/zones` 구역 로케이션 생성
- GET `/wms/locations/warehouses/:warehouseId` 로케이션 목록(통합)
- GET `/wms/locations/:locationId` 로케이션 상세
- PUT `/wms/locations/:locationId` 로케이션 수정(시스템 로케이션은 제한적)

### 쿼리 파라미터(주요)
- `type`: `standard | zone`
- `columnName`, `rackNumber`
- `isActive`
- `search`: 코드/표시명 키워드
- 페이징: `page`, `limit`
- 정렬: `sortBy`(`code|createdAt|columnName|rackNumber`), `sortOrder`(`asc|desc`)

## 사용 시나리오 예시

### 1) 기본 구조 생성
1. 열 생성: `POST /wms/locations/warehouses/{whId}/columns` (예: columnName=A)
2. 랙 생성: `POST /wms/locations/warehouses/{whId}/racks`
   - `{ columnName: 'A', rackNumber: 1, binSettings: { autoGenerate: true, standardBins: { start: 1, end: 20 } } }`
3. 커스텀 빈 추가(선택): `POST /wms/locations/warehouses/{whId}/racks/custom-bins`
   - `{ columnName: 'A', rackNumber: 1, customBinName: '바닥' }`

### 2) 시스템 로케이션 활용
- 앱 부팅/창고 생성 시 자동 생성됨
- 업무 로직에서 기본존 필요 시: `getSystemLocationByRole(warehouseId, 'inbound_default' | 'return_default')`

### 3) 목록 조회/검색
- `GET /wms/locations/warehouses/{whId}?type=standard&columnName=A&search=01&page=1&limit=20&sortBy=code&sortOrder=asc`

## 설계 원칙 요약
- 표준/구역 로케이션 이원화, 스키마 체크로 무결성 보장
- 코드 규칙: 표준은 `A-01-01`; 구역은 의미 기반(`zone-inbound-default`) 또는 `zone-N`
- 시스템 로케이션은 역할 기반으로 식별·보호(삭제 불가, 제한적 수정)
- 조회 API는 단일 엔드포인트로 통합(타입/열/랙/검색/정렬 지원)

## 변경 이력(요지)
- 시스템 로케이션 역할/필드/제약 추가
- `LocationService`에 프로비저닝/보호 로직 추가
- `InventoryService` 부팅/창고 생성 시 시스템 로케이션 보정 연결

## 참고
- 인덱스: `locationIndexes`에 창고/타입, 랙/빈, 열/이름 인덱스 구성
- 관련 도메인: 재고 이벤트/원장과의 연결은 별도 문서 참조


