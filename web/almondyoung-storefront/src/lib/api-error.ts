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
    // 401 에러의 경우 digest를 "UNAUTHORIZED"로 설정
    if (status === 401) {
      this.digest = "UNAUTHORIZED"
    }
  }
}
