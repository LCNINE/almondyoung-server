/**
 * 기본 에러 클래스
 */
export class HttpApiError extends Error {
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
 * 유효성 검사 에러 전용 클래스
 */
export class ValidationError extends HttpApiError {
  constructor(
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message, 400, "VALIDATION_ERROR")
  }
}

/**
 * 인증 관련 오류 전용 클래스
 */
export class ApiAuthError extends HttpApiError {
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
export class ApiNetworkError extends HttpApiError {
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
