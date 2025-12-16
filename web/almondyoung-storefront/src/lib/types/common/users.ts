export interface UserBaseType {
  id: string
  loginId: string
  username: string
  email: string
  isEmailVerified: boolean
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * server action response type
 * 이 타입을 사용해야 프론트단에서 래핑된 에러를 처리할 수 있습니다.
 */
export type ApiResponse<T> =
  | { success?: boolean; data: T }
  | { error: { message: string; status: number } }
