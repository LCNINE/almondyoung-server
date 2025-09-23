import { ApplicationException } from '@app/shared/filters/application.exception';

export class BlacklistsNotFoundException extends ApplicationException {
  getErrorCode(): string {
    return 'BLACKLISTS_NOT_FOUND';
  }

  getHttpStatus(): number {
    return 404;
  }

  constructor(message: string) {
    super(message);
  }
}

export class BlacklistsAlreadyExistsException extends ApplicationException {
  getErrorCode(): string {
    return 'BLACKLISTS_ALREADY_EXISTS';
  }

  getHttpStatus(): number {
    return 400;
  }

  constructor(message: string) {
    super(message);
  }
}
