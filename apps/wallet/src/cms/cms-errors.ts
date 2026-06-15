export class CmsOperationError extends Error {
  constructor(
    readonly code: string,
    readonly customerMessage: string,
    readonly statusCode: number,
    readonly providerMessage?: string,
  ) {
    super(customerMessage);
    this.name = 'CmsOperationError';
  }
}

export function isCmsOperationError(error: unknown): error is CmsOperationError {
  return error instanceof CmsOperationError;
}

export function isCmsProviderAuthError(code: string, message: string): boolean {
  const normalized = `${code} ${message}`.toLowerCase();
  return (
    normalized.includes('인증') ||
    normalized.includes('auth') ||
    normalized.includes('authorization') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  );
}

export const CMS_CUSTOMER_MESSAGES = {
  providerIssue: '자동이체 서비스 설정 확인이 필요합니다. 잠시 후 다시 시도하거나 고객센터로 문의해주세요.',
  inputRejected: '입력하신 자동이체 정보를 확인해주세요.',
};
