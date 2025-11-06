export const USER_SCOPES = {
  MASTER: { key: 'master', desc: '마스터 권한' },
  USER: {
    READ: { key: 'user:read', desc: '사용자 - 사용자 정보 조회' },
    MODIFY: { key: 'user:modify', desc: '사용자 - 사용자 정보 생성, 수정' },
    DELETE: { key: 'user:delete', desc: '사용자 - 사용자 정보 삭제' },
  },
  WHOLESALE: {
    READ: { key: 'wholesale:read', desc: '도매회원 - 도매 관련 정보 조회' },
  },
  ADMIN: {
    ACCESS: { key: 'admin:access', desc: '관리자 페이지 접근 권한 (베이스라인)' },
    USERS: {
      READ: { key: 'admin:users:read', desc: '관리자 - 사용자 조회만' },
      MODIFY: { key: 'admin:users:modify', desc: '관리자 - 사용자 생성, 수정' },
      ARCHIVE: { key: 'admin:users:archive', desc: '관리자 - 사용자 soft delete (비활성화, 휴면 처리 등)' },
      PURGE: { key: 'admin:users:purge', desc: '관리자 - 사용자 hard delete (완전 삭제, 복구 불가)' },
    },
    SETTINGS: {
      READ: { key: 'admin:settings:read', desc: '관리자 - 설정 조회' },
      MODIFY: { key: 'admin:settings:modify', desc: '관리자 - 설정 수정' },
    },
    LOGS: {
      READ: { key: 'admin:logs:read', desc: '관리자 - 로그 조회' },
    },
  },
} as const;



// USER_SCOPES의 모든 값들에서 key 추출
type ExtractKeys<T> = T extends { key: infer K }
  ? K
  : T extends object
    ? { [K in keyof T]: ExtractKeys<T[K]> }[keyof T]
    : never;

// UserScope 타입 정의
export type UserScope = ExtractKeys<typeof USER_SCOPES>;



