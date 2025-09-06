/**
 * 로케이션 타입 열거형
 */
export type LocationType = 'standard' | 'zone';

/**
 * 시스템 로케이션 역할 타입
 */
export type SystemLocationRole = 'inbound_default' | 'return_default';

/**
 * 공통 로케이션 식별자 인터페이스
 */
export interface LocationIdentifier {
    id: string;
    code: string;  // 실제 표시되는 로케이션 코드
    type: LocationType;
    warehouseId: string;
}

/**
 * 로케이션 메타데이터
 */
export interface LocationMetadata {
    capacityLimit?: number;
    fifoRank?: number;
    isExpirySeparated?: boolean;
    notes?: string;
}

/**
 * API에서 사용하는 통합 로케이션 응답
 */
export interface LocationResponse {
    id: string;
    code: string;           // A-01-01 또는 "입고기본존"
    displayName: string;    // 사용자에게 보여줄 이름
    type: LocationType;
    warehouseId: string;
    isActive: boolean;
    metadata?: LocationMetadata;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * 로케이션 열 정보
 */
export interface LocationColumn {
    id: string;
    warehouseId: string;
    columnName: string;     // 'A', 'B', 'C'
    displayOrder?: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * 로케이션 랙 정보
 */
export interface LocationRack {
    id: string;
    columnId: string;
    rackNumber: number;

    // 빈 설정
    defaultBinStart: number;
    defaultBinEnd: number;
    autoGenerateBins: boolean;

    // 물리적 정보
    physicalWidth?: number;
    physicalHeight?: number;
    notes?: string;
    isActive: boolean;

    createdAt: Date;
    updatedAt: Date;
}

/**
 * 표준 로케이션 정보 (계층 구조 포함)
 */
export interface StandardLocationInfo extends LocationResponse {
    type: 'standard';
    rackId: string;
    binIdentifier: string;

    // 계층 정보 (조인된 데이터)
    columnName?: string;
    rackNumber?: number;
}

/**
 * 구역 로케이션 정보
 */
export interface ZoneLocationInfo extends LocationResponse {
    type: 'zone';
    rackId: null;
    binIdentifier: null;
}

/**
 * 빈 설정 인터페이스
 */
export interface BinSettings {
    autoGenerate: boolean;
    standardBins?: { start: number; end: number }; // 1~15
    customBins?: string[]; // ['바닥', '상단', '특수']
}

/**
 * 랙 생성 요청
 */
export interface CreateRackRequest {
    columnName: string;
    rackNumber: number;
    binSettings: BinSettings;
    physicalWidth?: number;
    physicalHeight?: number;
    notes?: string;
}

/**
 * 구역 로케이션 생성 요청
 */
export interface CreateZoneLocationRequest {
    code: string;
    displayName?: string;
    capacityLimit?: number;
    notes?: string;
}

/**
 * 로케이션 조회 쿼리 옵션
 */
export interface LocationQueryOptions {
    warehouseId: string;
    type?: LocationType;
    columnName?: string;
    rackNumber?: number;
    isActive?: boolean;
    search?: string; // 코드나 이름으로 검색
}

/**
 * 로케이션 생성 응답
 */
export interface LocationCreateResult {
    success: boolean;
    created: LocationResponse[];
    errors?: string[];
}