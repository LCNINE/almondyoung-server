import { ADMIN_MANUAL_LABEL, ADMIN_MANUAL_SOURCE_SYSTEM, reviewAuthorityLabel } from './review-provenance';

describe('reviewAuthorityLabel', () => {
  it('관리자 수기 작성분은 권한이 없어도 「관리자 수기 작성」이다', () => {
    expect(reviewAuthorityLabel({ sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM, permission: null })).toBe(
      ADMIN_MANUAL_LABEL,
    );
  });

  it('그 밖은 기존 권한 라벨을 그대로 쓴다', () => {
    const permission = { id: 'p', batchId: null, grantedReason: null };
    expect(reviewAuthorityLabel({ sourceSystem: 'almondyoung', permission: { ...permission, provider: 'admin' } })).toBe(
      '관리자 권한',
    );
    expect(reviewAuthorityLabel({ sourceSystem: 'almondyoung', permission: { ...permission, provider: 'order' } })).toBe(
      '주문 권한',
    );
    expect(reviewAuthorityLabel({ sourceSystem: 'smartstore', permission: null })).toBe('권한 미연결');
  });

  it('출처를 모르는 응답(상태 변경 응답 등)도 권한 라벨로 떨어진다', () => {
    expect(reviewAuthorityLabel({ permission: undefined })).toBe('권한 미연결');
  });
});
