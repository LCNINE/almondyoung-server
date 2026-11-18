import { toComposeImages } from './compose-input';

const FILE = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';

describe('toComposeImages', () => {
  it('이미지와 영역마다 서버가 만든 directive·attrs·픽셀 크기를 붙인다', () => {
    const [image] = toComposeImages([
      {
        fileId: FILE,
        kind: '스펙표',
        content: '컬러표',
        size: { width: 1000, height: 500 },
        regions: [{ label: 'MG04 문 펄', x: 0.3, y: 0.4, w: 0.1, h: 0.2 }],
      },
    ]);

    expect(image).toMatchObject({ kind: '스펙표', px: '1000×500', attrs: `fileId="${FILE}"` });
    expect(image.regions).toEqual([
      {
        label: 'MG04 문 펄',
        px: '100×100',
        directive: `::product-image{fileId="${FILE}" alt="" crop="0.3,0.4,0.1,0.2"}`,
        attrs: `fileId="${FILE}" crop="0.3,0.4,0.1,0.2"`,
      },
    ]);
  });

  // 클라이언트가 보낸 추출 결과라 모양이 틀릴 수 있다 — 예외 없이 틀린 것만 버린다.
  it.each([
    ['regions 가 객체', { regions: {} }],
    ['regions 에 null', { regions: [null] }],
    ['좌표가 문자열·NaN', { regions: [{ label: 'a', x: 'x', y: NaN, w: 0.1, h: 0.1 }] }],
    ['범위 밖 좌표', { regions: [{ label: 'a', x: 0.95, y: 0, w: 0.2, h: 0.1 }] }],
    ['이름 없는 영역', { regions: [{ label: ' ', x: 0, y: 0, w: 0.5, h: 0.5 }] }],
  ])('%s 이면 영역만 버리고 이미지는 남긴다', (_, extra) => {
    const images = toComposeImages([{ fileId: FILE, kind: '제품컷', content: '', ...extra }]);

    expect(images).toHaveLength(1);
    expect(images[0].regions).toEqual([]);
  });

  it('UUID 가 아닌 fileId·객체가 아닌 이미지·잘못된 크기는 버린다', () => {
    const images = toComposeImages([
      null,
      'x',
      { fileId: 'not-a-uuid" onerror="x' },
      { fileId: FILE, size: { width: -1, height: 'a' } },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]).not.toHaveProperty('px');
  });

  it('배열이 아니면 빈 목록이다', () => {
    expect(toComposeImages({})).toEqual([]);
  });
});
