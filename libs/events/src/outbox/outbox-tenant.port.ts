/**
 * 이 앱 outbox 테이블이 든 DB 의 테넌트 id (선택). 없으면 앱 설정 T 다 — 앱 DB 가 곧 T 의 것인 «T 만 섬기는» 앱.
 * core 는 테넌트마다 DB 가 따로라 T 가 없고, 접속한 DB 로 이 값을 준다(`tenantOfCoreDatabase`).
 * 디스패처가 아웃박스를 켠 `forApp` 안에서 만들어지므로, 주는 모듈은 `@Global()` 이어야 optional 주입이 닿는다.
 */
export const OUTBOX_TENANT_ID = Symbol('OUTBOX_TENANT_ID');
