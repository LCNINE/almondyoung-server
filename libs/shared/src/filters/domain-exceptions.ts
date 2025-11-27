import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from './application.exception';

export class NotFoundError extends ApplicationException {
  constructor(message: string) {
    super(message);
  }

  getErrorCode(): string {
    return 'NOT_FOUND';
  }

  getHttpStatus(): number {
    return HttpStatus.NOT_FOUND;
  }
}

export class BadRequestError extends ApplicationException {
  constructor(message: string) {
    super(message);
  }

  getErrorCode(): string {
    return 'BAD_REQUEST';
  }

  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

export class ConflictError extends ApplicationException {
  constructor(message: string) {
    super(message);
  }

  getErrorCode(): string {
    return 'CONFLICT';
  }

  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

export class UnauthorizedError extends ApplicationException {
  constructor(message: string) {
    super(message);
  }

  getErrorCode(): string {
    return 'UNAUTHORIZED';
  }

  getHttpStatus(): number {
    return HttpStatus.UNAUTHORIZED;
  }
}

export class ForbiddenError extends ApplicationException {
  constructor(message: string) {
    super(message);
  }

  getErrorCode(): string {
    return 'FORBIDDEN';
  }

  getHttpStatus(): number {
    return HttpStatus.FORBIDDEN;
  }
}

