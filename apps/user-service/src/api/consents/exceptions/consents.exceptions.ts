import { ApplicationException } from '@app/shared/filters/application.exception';

export class ConsentsNotFoundException extends ApplicationException {
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
