import { ApplicationException } from '@app/shared/filters/application.exception';

export class OAuthClientNotFoundException extends ApplicationException {
  getErrorCode(): string {
    return 'OAUTH_CLIENT_NOT_FOUND';
  }

  getHttpStatus(): number {
    return 404;
  }

  constructor(message: string) {
    super(message);
  }
}

export class OAuthClientAlreadyExistsException extends ApplicationException {
  getErrorCode(): string {
    return 'OAUTH_CLIENT_ALREADY_EXISTS';
  }

  getHttpStatus(): number {
    return 409;
  }

  constructor(message: string) {
    super(message);
  }
}

export class InvalidOAuthClientInputException extends ApplicationException {
  getErrorCode(): string {
    return 'INVALID_OAUTH_CLIENT_INPUT';
  }

  getHttpStatus(): number {
    return 400;
  }

  constructor(message: string) {
    super(message);
  }
}
