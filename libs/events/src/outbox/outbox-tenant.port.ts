/**
 * 이 앱 outbox 테이블이 든 DB 의 테넌트 id (선택). 없으면 앱 설정 T 다 — 앱 DB 가 곧 T 의 것인 «T 만 섬기는» 앱.
 * core 는 테넌트마다 DB 가 따로라 T 가 없다. 단일 DB(①)면 접속한 DB 로 이 값을 주고(`tenantOfCoreDatabase`),
 * DB 를 테넌트 맥락으로 고르면(②) `OUTBOX_TENANT_FROM_CONTEXT` 를 준다.
 * 디스패처가 아웃박스를 켠 `forApp` 안에서 만들어지므로, 주는 모듈은 `@Global()` 이어야 optional 주입이 닿는다.
 */
export const OUTBOX_TENANT_ID = Symbol('OUTBOX_TENANT_ID');

/**
 * outbox DB 를 테넌트 맥락이 고른다는 표시. 디스패처는 `DbService.forEachDatabase` 로 테넌트 DB 마다 그 테넌트 맥락에서
 * 돌므로, 행을 집은 DB 의 테넌트가 곧 그때의 맥락이다.
 */
export const OUTBOX_TENANT_FROM_CONTEXT = Symbol('OUTBOX_TENANT_FROM_CONTEXT');

export type OutboxTenant = string | typeof OUTBOX_TENANT_FROM_CONTEXT;
