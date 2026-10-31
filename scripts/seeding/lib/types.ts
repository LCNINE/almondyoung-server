/**
 * Shared types for the unified DB setup & seeding system.
 */

/** 단일 테이블/엔티티 그룹의 시딩 현황 */
export interface SeedCheckItem {
  entity: string;
  expected: number;
  existing: number;
  missing: number;
  missingDetails?: string[];
}

/** 한 seed step의 전체 check 결과 */
export interface SeedCheckResult {
  service: string;
  items: SeedCheckItem[];
  isFullySeeded: boolean;
  summary: string;
}

/** apply() 실행 결과 */
export interface SeedApplyResult {
  service: string;
  success: boolean;
  itemsApplied: number;
  duration: number;
  error?: string;
}

/** DB 존재 확인 결과 */
export interface DatabaseCheckResult {
  name: string;
  exists: boolean;
}

/** 테넌트 목록에서 펼친 core DB 하나 (`core-tenants.ts`) */
export interface CoreTenantTarget {
  /** 목록 밖(준비 중, `--tenant`)이면 null */
  tenantId: string | null;
  slug: string;
  database: string;
  /** 테넌트 1 전용 시드(창고·자사몰)를 받는가 — 정적 레지스트리의 core DB 인 테넌트만 */
  tenantOneData: boolean;
}

/** 서비스 레지스트리 항목 */
export interface ServiceConfig {
  name: string;
  database: string;
  drizzleConfig?: string;
  hasSeedStep: boolean;
  /** 테넌트 목록에서 펼친 core 항목에만 있다 */
  tenant?: CoreTenantTarget;
}

/** 최종 리포트 */
export interface SetupReport {
  databasesCreated: string[];
  schemasSynced: string[];
  seedResults: SeedApplyResult[];
  totalDuration: number;
}

/** 모든 phase에 공통으로 전달되는 옵션 */
export interface PhaseOptions {
  yes: boolean;
  /** 배포 키 (root/df/lcnine-auth/lcnine-services) — service-registry 분기 */
  deployment?: string;
  /**
   * Phase 3에서 활성화할 시드 그룹.
   *  - undefined: 인터랙티브 선택
   *  - 빈 문자열 or 'none': phase 3 건너뜀
   *  - 그 외: 해당 그룹의 step만 실행
   */
  group?: string | null;
  /** `--tenant <slug>` — core DB 하나만(`resolveRegistry`) */
  tenant?: string;
  /** 운영 stage에서도 demo-* 그룹 실행 허용 */
  allowDemoInProd?: boolean;
}
