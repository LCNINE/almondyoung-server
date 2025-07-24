import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 멱등성 관련 기본 예외 클래스
 */
export class IdempotencyException extends HttpException {
  constructor(message: string, status: HttpStatus) {
    super(message, status);
  }
}

/**
 * 409 Conflict - 요청이 처리 중일 때
 * 클라이언트는 잠시 후 재시도해야 함
 */
export class IdempotencyConflictException extends IdempotencyException {
  constructor(message = '요청이 처리 중입니다. 잠시 후 다시 시도해주세요.') {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 422 Unprocessable Entity - 동일한 멱등키에 대해 다른 페이로드가 전송됨
 * 클라이언트는 새로운 멱등키로 요청해야 함
 */
export class IdempotencyPayloadMismatchException extends IdempotencyException {
  constructor(message = '동일한 멱등키에 대해 다른 요청 내용이 전송되었습니다.') {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * 400 Bad Request - 잘못된 멱등키 형식
 */
export class InvalidIdempotencyKeyException extends IdempotencyException {
  constructor(message = '유효하지 않은 멱등키 형식입니다. UUID v4 형식을 사용해주세요.') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

/**
 * 429 Too Many Requests - 멱등키 생성 한도 초과
 */
export class IdempotencyRateLimitException extends IdempotencyException {
  constructor(message = '멱등키 생성 한도를 초과했습니다. 잠시 후 다시 시도해주세요.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * 에러 응답 인터페이스
 */
export interface IdempotencyErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  idempotencyKey?: string;
}