import { coversWholeImage } from './image-crop';

// AI 생성기가 뱉는 3:2 원본
const W = 1536;
const H = 1024;

describe('coversWholeImage', () => {
  it('원본 전체를 덮으면 true', () => {
    expect(coversWholeImage({ x: 0, y: 0, width: W, height: H }, W, H)).toBe(true);
  });

  it('크롭 라이브러리의 소수점 오차(1px 이내)는 전체로 본다', () => {
    expect(
      coversWholeImage({ x: 0.4, y: 0.7, width: W - 0.8, height: H - 0.3 }, W, H),
    ).toBe(true);
  });

  it('상하가 잘렸으면 false', () => {
    // 3:1 로 자른 경우
    expect(coversWholeImage({ x: 0, y: 256, width: W, height: 512 }, W, H)).toBe(false);
  });

  it('좌우가 잘렸으면 false', () => {
    expect(coversWholeImage({ x: 200, y: 0, width: 1000, height: H }, W, H)).toBe(false);
  });

  it('줌인해서 원본보다 작은 영역만 쓰면 false', () => {
    expect(coversWholeImage({ x: 100, y: 100, width: 800, height: 500 }, W, H)).toBe(false);
  });
});
