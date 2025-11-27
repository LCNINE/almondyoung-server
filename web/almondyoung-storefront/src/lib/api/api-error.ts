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

/**
 * 네트워크 에러 전용 클래스
 */
export class ApiNetworkError extends ApiError {
  constructor(
    message = "NETWORK_ERROR",
    status = 500,
    statusText = "NETWORK_ERROR",
    data?: any
  ) {
    super(message, status, statusText, data)
    this.name = "ApiNetworkError"
  }
}
