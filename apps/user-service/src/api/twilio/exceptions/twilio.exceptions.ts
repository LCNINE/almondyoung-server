import { ApplicationException } from '@app/shared/filters/application.exception';
import { HttpStatus } from '@nestjs/common';

export class TwilioLookupException extends ApplicationException {
  private readonly httpStatus: number;

  constructor({
    message,
    httpStatus = HttpStatus.BAD_REQUEST,
  }: {
    message: string;
    httpStatus?: number;
  }) {
    super(message);
    this.httpStatus = httpStatus;
  }

  getErrorCode(): string {
    return 'TWILIO_LOOKUP_EXCEPTION';
  }

  getHttpStatus(): number {
    return this.httpStatus;
  }
}
