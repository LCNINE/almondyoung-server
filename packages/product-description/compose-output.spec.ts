import { appendUnusedImages, swapFileIds, wholeImagesOutsideBlocks } from './compose-output';

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

  it('영역(crop)으로만 쓰인 이미지는 나머지 부분이 빠진 것이라 전체를 덧붙인다', () => {
    const markdown = `::swatch{fileId="${A}" crop="0.1,0.1,0.2,0.2" code="01" name="문"}\n\n#네일`;

    expect(appendUnusedImages(markdown, [A])).toBe(
      `::swatch{fileId="${A}" crop="0.1,0.1,0.2,0.2" code="01" name="문"}\n\n::product-image{fileId="${A}" alt=""}\n\n#네일`,
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

describe('swapFileIds', () => {
  it('fileId 속성만 짝지은 값으로 바꾸고 crop 은 그대로 둔다', () => {
    const markdown = `::swatch{fileId="${A}" crop="0.1,0.1,0.2,0.2"}\n${A} 는 본문 글자라 안 바꾼다`;

    expect(swapFileIds(markdown, new Map([[A, B]]))).toBe(
      `::swatch{fileId="${B}" crop="0.1,0.1,0.2,0.2"}\n${A} 는 본문 글자라 안 바꾼다`,
    );
  });
});

describe('wholeImagesOutsideBlocks', () => {
  it('블록 밖 이미지 줄의 crop 은 떼고, 블록 안(compare·details)은 그대로 둔다', () => {
    const markdown = [
      `::product-image{fileId="${A}" alt="" crop="0.1,0.1,0.5,0.5"}`,
      ':::compare{label="CHECK!"}',
      `::product-image{fileId="${B}" alt="" crop="0.1,0.1,0.5,0.5"}`,
      ':::',
      ':::details{title="DETAILS"}',
      `::swatch{fileId="${C}" crop="0.1,0.1,0.2,0.2" code="01" name="문"}`,
      ':::',
    ].join('\n');

    expect(wholeImagesOutsideBlocks(markdown)).toBe(
      [
        `::product-image{fileId="${A}" alt=""}`,
        ':::compare{label="CHECK!"}',
        `::product-image{fileId="${B}" alt="" crop="0.1,0.1,0.5,0.5"}`,
        ':::',
        ':::details{title="DETAILS"}',
        `::swatch{fileId="${C}" crop="0.1,0.1,0.2,0.2" code="01" name="문"}`,
        ':::',
      ].join('\n'),
    );
  });

  it('crop 을 떼서 같은 이미지 전체가 블록 밖에 두 번 나오면 뒤의 줄을 지운다', () => {
    const markdown = [
      `::product-image{fileId="${A}" alt=""}`,
      '',
      `:::point{no="01"}`,
      '### 제목',
      ':::',
      `::product-image{fileId="${A}" alt="" crop="0.1,0.1,0.5,0.5"}`,
      '',
      '#네일',
    ].join('\n');

    expect(wholeImagesOutsideBlocks(markdown)).toBe(
      [`::product-image{fileId="${A}" alt=""}`, '', `:::point{no="01"}`, '### 제목', ':::', '', '#네일'].join('\n'),
    );
  });
});
