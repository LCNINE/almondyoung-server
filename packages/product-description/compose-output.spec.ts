import { appendUnusedImages } from './compose-output';

const A = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';
const B = '018f70fb-8a0f-7d44-9f1b-4d6f563a2222';
const C = '018f70fb-8a0f-7d44-9f1b-4d6f563a3333';

describe('appendUnusedImages', () => {
  it('본문에 통째로 안 쓰인 이미지를 올린 순서대로 해시태그 줄 바로 위에 덧붙인다', () => {
    const markdown = [
      `:::cover{fileId="${B}" alt="" kicker="K"}`,
      '## 제목',
      ':::',
      '',
      '#네일 #젤',
      '',
      '<!-- 확인 필요: 용량 -->',
    ].join('\n');

    expect(appendUnusedImages(markdown, [A, B, C])).toBe(
      [
        `:::cover{fileId="${B}" alt="" kicker="K"}`,
        '## 제목',
        ':::',
        '',
        `::product-image{fileId="${A}" alt=""}`,
        `::product-image{fileId="${C}" alt=""}`,
        '',
        '#네일 #젤',
        '',
        '<!-- 확인 필요: 용량 -->',
      ].join('\n'),
    );
  });

  it('해시태그 줄이 없으면 맨 끝에 붙이고, 다 쓰였으면 그대로 둔다', () => {
    expect(appendUnusedImages('본문', [A])).toBe(`본문\n\n::product-image{fileId="${A}" alt=""}`);
    expect(appendUnusedImages(`::product-image{fileId="${A}" alt=""}`, [A])).toBe(
      `::product-image{fileId="${A}" alt=""}`,
    );
  });

  it('제목(## )은 해시태그 줄로 보지 않는다', () => {
    expect(appendUnusedImages('## 자주 묻는 질문', [A])).toBe(
      `## 자주 묻는 질문\n\n::product-image{fileId="${A}" alt=""}`,
    );
  });
});
