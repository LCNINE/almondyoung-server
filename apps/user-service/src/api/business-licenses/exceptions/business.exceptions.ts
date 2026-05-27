import { ApplicationException } from '@app/shared/filters/application.exception';
import { HttpStatus } from '@nestjs/common';

export class BusinessLicenseException extends ApplicationException {
  private readonly httpStatus: number;
  private readonly errorCode: string;

  constructor({
    message,
    httpStatus = HttpStatus.BAD_REQUEST,
    errorCode,
  }: {
    message: string;
    httpStatus?: number;
    errorCode: string;
  }) {
    super(message);
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
  }

  getErrorCode(): string {
    return this.errorCode;
  }

  getHttpStatus(): number {
    return this.httpStatus;
  }
}
