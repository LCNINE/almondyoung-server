// ?tab= 파싱. 판정을 컴포넌트에 두면 검증할 수 없어(admin-web 은 컴포넌트 테스트 불가)
// 순수 함수로 뽑는다.

export type BulkSessionsTab = 'sessions' | 'forms';

/**
 * 기본값이 'sessions' 인 이유: 사이드바 메뉴로 들어오는 기존 동선이 지금까지 세션
 * 목록을 보여줬다. 상품 목록에서 새 탭으로 열 때만 ?tab=forms 를 붙인다.
 */
export function parseBulkSessionsTab(raw: string | undefined): BulkSessionsTab {
  return raw === 'forms' ? 'forms' : 'sessions';
}
