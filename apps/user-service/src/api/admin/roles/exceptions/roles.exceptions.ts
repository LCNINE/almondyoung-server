import { ApplicationException } from '@app/shared/filters/application.exception';

export class RoleNotFoundException extends ApplicationException {
  getErrorCode(): string {
    return 'ROLE_NOT_FOUND';
  }

  getHttpStatus(): number {
    return 404;
  }

  constructor(message: string) {
    super(message);
  }
}

export class UserNotFoundException extends ApplicationException {
  getErrorCode(): string {
    return 'USER_NOT_FOUND';
  }

  getHttpStatus(): number {
    return 404;
  }

  constructor(message: string) {
    super(message);
  }
}

export class RoleAlreadyExistsException extends ApplicationException {
  getErrorCode(): string {
    return 'ROLE_ALREADY_EXISTS';
  }

  getHttpStatus(): number {
    return 400;
  }

  constructor(message: string) {
    super(message);
  }
}

export class InvalidRoleIdsException extends ApplicationException {
  getErrorCode(): string {
    return 'INVALID_ROLE_IDS';
  }

  getHttpStatus(): number {
    return 400;
  }

  constructor(message: string) {
    super(message);
  }
}
