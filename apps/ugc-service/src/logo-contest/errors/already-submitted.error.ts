export class AlreadySubmittedError extends Error {
  constructor() {
    super('이미 출품한 작품이 있습니다. 한 계정은 한 번만 출품할 수 있습니다.');
    this.name = 'AlreadySubmittedError';
  }
}
