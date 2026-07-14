import { insertAtCursor } from './product-description-insert';

describe('insertAtCursor', () => {
  it('selection 미지정: 빈 문자열엔 개행 없이 삽입 후 후행 개행', () => {
    expect(insertAtCursor('', 'IMG')).toBe('IMG\n');
  });

  it('selection 미지정: 개행으로 끝나지 않으면 선행 개행 보정 후 append', () => {
    expect(insertAtCursor('hello', 'IMG')).toBe('hello\nIMG\n');
  });

  it('selection 미지정: 이미 개행으로 끝나면 선행 개행 추가 안 함', () => {
    expect(insertAtCursor('hello\n', 'IMG')).toBe('hello\nIMG\n');
  });

  it('커서가 시작(0): 선행 개행 없음', () => {
    expect(insertAtCursor('abc', 'IMG', { start: 0, end: 0 })).toBe('IMG\nabc');
  });

  it('커서가 끝: 후행 개행 없음(뒤가 비어있음)', () => {
    expect(insertAtCursor('abc', 'IMG', { start: 3, end: 3 })).toBe('abc\nIMG');
  });

  it('커서가 중간: prefix/suffix 사이 삽입, 앞뒤 개행 보정', () => {
    expect(insertAtCursor('ab\ncd', 'IMG', { start: 3, end: 3 })).toBe(
      'ab\nIMG\ncd'
    );
  });

  it('선택 구간(start<end)을 삽입물로 대체', () => {
    expect(insertAtCursor('abXYcd', 'IMG', { start: 2, end: 4 })).toBe(
      'ab\nIMG\ncd'
    );
  });
});
