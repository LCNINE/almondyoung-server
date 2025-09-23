export abstract class ApplicationException extends Error {
  abstract getErrorCode(): string;
  abstract getHttpStatus(): number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
