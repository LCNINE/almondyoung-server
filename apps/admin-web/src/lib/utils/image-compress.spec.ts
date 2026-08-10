import {
  COMPRESS_OVER_BYTES,
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
  formatBytes,
  isCompressible,
  scaledSize,
  shouldCompress,
  toWebpName,
} from './image-compress';

describe('isCompressible', () => {
  it('일반 이미지는 줄일 수 있다', () => {
    expect(isCompressible('image/jpeg')).toBe(true);
    expect(isCompressible('image/png')).toBe(true);
    expect(isCompressible('image/webp')).toBe(true);
  });

  // 캔버스로 다시 그리면 애니메이션이 첫 프레임만 남고 벡터는 래스터가 된다.
  it('GIF 와 SVG 는 건드리지 않는다', () => {
    expect(isCompressible('image/gif')).toBe(false);
    expect(isCompressible('image/svg+xml')).toBe(false);
  });

  it('이미지가 아니면 대상이 아니다', () => {
    expect(isCompressible('application/pdf')).toBe(false);
  });
});

describe('shouldCompress', () => {
  it('긴 변이 기준을 넘으면 줄인다', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 100_000, longestEdge: MAX_EDGE + 1 })).toBe(true);
  });

  it('용량이 기준을 넘으면 작은 이미지여도 줄인다', () => {
    expect(shouldCompress({ type: 'image/png', size: COMPRESS_OVER_BYTES + 1, longestEdge: 800 })).toBe(true);
  });

  it('작고 가벼우면 원본을 그대로 쓴다', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 300_000, longestEdge: 1200 })).toBe(false);
  });

  it('GIF 는 크더라도 줄이지 않는다', () => {
    expect(shouldCompress({ type: 'image/gif', size: 9_000_000, longestEdge: 4000 })).toBe(false);
  });
});

describe('scaledSize', () => {
  it('비율을 유지하며 긴 변을 맞춘다', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1200 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: MAX_EDGE });
  });

  it('이미 작은 이미지는 확대하지 않는다', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('아주 납작한 이미지도 최소 1px 은 남긴다', () => {
    expect(scaledSize(8000, 1).height).toBe(1);
  });
});

describe('formatBytes', () => {
  it('사람이 읽는 단위로 바꾼다', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(8.2 * 1024 * 1024)).toBe('8.2MB');
  });

  it('업로드 상한을 표시할 수 있다', () => {
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe('4.0MB');
  });
});

describe('toWebpName', () => {
  it('확장자를 webp 로 바꾼다', () => {
    expect(toWebpName('사진.JPG')).toBe('사진.webp');
    expect(toWebpName('a.b.png')).toBe('a.b.webp');
  });

  it('확장자가 없으면 붙인다', () => {
    expect(toWebpName('scan')).toBe('scan.webp');
  });
});
