/**
 * 효성 CMS 동의자료 등록완료 상태.
 *
 * 효성은 동의자료 등록 직후 `등록`을, 상위기관 확인 이후 `확인`을 registerStatus로 반환한다.
 * 둘 다 정기 출금에 사용 가능한 정상 등록 상태이므로 함께 취급한다.
 */
export const CMS_AGREEMENT_REGISTERED_STATUSES = ['등록', '확인'] as const;

export function isCmsAgreementRegistered(status: string | null | undefined): boolean {
  return status === '등록' || status === '확인';
}
