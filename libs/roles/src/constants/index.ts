export const USER_SCOPES = {
  MASTER: { key: 'master', desc: '마스터 권한' },
  USER: {
    READ: { key: 'user:read', desc: '사용자 읽기 권한' },
    WRITE: { key: 'user:write', desc: '사용자 쓰기 권한' },
    DELETE: { key: 'user:delete', desc: '사용자 삭제 권한' },
    UPDATE: { key: 'user:update', desc: '사용자 수정 권한' },
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
