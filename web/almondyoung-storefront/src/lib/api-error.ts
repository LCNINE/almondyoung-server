export class ApiError extends Error {
  public digest?: string

  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public data?: any
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * 인증 관련 오류 전용 클래스
 * - ApiError를 상속받지만, 인증 복구(AuthRestore) 로직에서만 특별히 취급됩니다.
 */
export class ApiAuthError extends ApiError {
  constructor(
    message = "UNAUTHORIZED",
    status = 401,
    statusText = "UNAUTHORIZED",
    data?: any
  ) {
    super(message, status, statusText, data)
    this.name = "ApiAuthError"
    this.digest = "UNAUTHORIZED"
  }
}
