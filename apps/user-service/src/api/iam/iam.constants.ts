/**
 * 역할 «이름»을 코드가 아는 유일한 곳.
 *
 * 나머지 코드는 권한만 본다. master 는 «권한 목록 전체»를 계산해서 받는 시스템 역할이라
 * 화면에서 편집·삭제할 수 없고 최소 1명이 남아야 한다 — 그 규칙이 여기 이름에 걸려 있다.
 */
export const SYSTEM_ROLE_NAME = 'master';

/** 고객 역할. 관리자 권한 배포·관리 화면 대상이 아니다. */
export const CUSTOMER_ROLE_NAMES: readonly string[] = ['user', 'membership'];
