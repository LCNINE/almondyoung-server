import { parseBulkSessionsTab } from './tab-param';

describe('일괄 등록 화면 탭 파라미터', () => {
  it('없으면 업로드 세션이 기본이다 — 사이드바 동선의 기존 동작을 보존한다', () => {
    expect(parseBulkSessionsTab(undefined)).toBe('sessions');
    expect(parseBulkSessionsTab('')).toBe('sessions');
  });

  it('forms 를 인식한다', () => {
    expect(parseBulkSessionsTab('forms')).toBe('forms');
  });

  it('모르는 값은 기본으로 떨어진다', () => {
    expect(parseBulkSessionsTab('nope')).toBe('sessions');
  });
});
