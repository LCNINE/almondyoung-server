import { buildSnippet, extractPlainText } from './archive-content';

describe('extractPlainText', () => {
  it('중첩된 블록의 text 를 깊이에 상관없이 모은다', () => {
    const blocks = [
      { type: 'heading', content: [{ type: 'text', text: '재고 정책' }] },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: '입고는 당일 마감' }],
        children: [{ type: 'paragraph', content: [{ type: 'text', text: '예외는 CS 문의' }] }],
      },
    ];

    expect(extractPlainText(blocks)).toBe('재고 정책 입고는 당일 마감 예외는 CS 문의');
  });

  it('블록이 배열이 아니거나 비어 있으면 빈 문자열', () => {
    expect(extractPlainText([])).toBe('');
    expect(extractPlainText(null)).toBe('');
    expect(extractPlainText({ type: 'paragraph' })).toBe('');
  });

  it('연속 공백과 줄바꿈을 한 칸으로 줄인다', () => {
    const blocks = [{ content: [{ text: '앞  \n\n 뒤' }] }];
    expect(extractPlainText(blocks)).toBe('앞 뒤');
  });

  it('아주 긴 본문에서도 상한을 넘기지 않는다', () => {
    const blocks = Array.from({ length: 200 }, () => ({ content: [{ text: 'ㄱ'.repeat(1000) }] }));
    expect(extractPlainText(blocks).length).toBeLessThanOrEqual(100_000);
  });
});

describe('buildSnippet', () => {
  it('일치 지점 앞뒤 문맥을 잘라 준다', () => {
    const text = `${'앞'.repeat(100)}핵심어${'뒤'.repeat(100)}`;
    const snippet = buildSnippet(text, '핵심어', 10);

    expect(snippet).toBe(`…${'앞'.repeat(10)}핵심어${'뒤'.repeat(10)}…`);
  });

  it('본문 처음에 일치하면 앞쪽 말줄임을 붙이지 않는다', () => {
    expect(buildSnippet('핵심어 뒤', '핵심어', 10)).toBe('핵심어 뒤');
  });

  it('대소문자를 가리지 않는다', () => {
    expect(buildSnippet('Inventory policy', 'inventory', 5)).toBe('Inventory poli…');
  });

  it('일치하는 곳이 없으면 null', () => {
    expect(buildSnippet('본문', '없는말')).toBeNull();
    expect(buildSnippet('', '검색어')).toBeNull();
  });
});
