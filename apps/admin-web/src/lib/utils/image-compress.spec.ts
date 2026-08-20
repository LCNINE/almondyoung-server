import {
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
  WEBP_LOSSLESS_QUALITY,
  compressImageForUpload,
  formatBytes,
  isCompressible,
  scaledSize,
  toWebpName,
} from './image-compress';

describe('isCompressible', () => {
  it('일반 이미지는 변환할 수 있다', () => {
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

  it('가로폭 기준이면 세로로 긴 이미지를 줄이지 않는다', () => {
    expect(scaledSize(1000, 8000, { maxEdge: 1600, measure: 'width' })).toEqual({ width: 1000, height: 8000 });
  });

  it('가로폭 기준이면 가로가 넘칠 때만 비율대로 줄인다', () => {
    expect(scaledSize(3200, 8000, { maxEdge: 1600, measure: 'width' })).toEqual({ width: 1600, height: 4000 });
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

describe('compressImageForUpload', () => {
  type ToBlobCall = { type?: string; quality?: number; width: number; height: number };

  let toBlobCalls: ToBlobCall[];
  let encodedBytes: number;
  let bitmap: { width: number; height: number; close: jest.Mock };

  // node 테스트 환경에는 캔버스가 없다. 브라우저 API 를 전역 목으로 심어
  // "무엇으로 어떻게 인코딩했는지"만 검증한다.
  beforeEach(() => {
    toBlobCalls = [];
    encodedBytes = 1_000;
    bitmap = { width: 800, height: 600, close: jest.fn() };

    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => bitmap);
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: jest.fn() }),
          toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
            toBlobCalls.push({ type, quality, width: canvas.width, height: canvas.height });
            cb(new Blob([new Uint8Array(encodedBytes)]));
          },
        };
        return canvas;
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    delete (globalThis as { document?: unknown }).document;
  });

  const jpeg = (bytes: number, name = '사진.jpg') =>
    new File([new Uint8Array(bytes)], name, { type: 'image/jpeg', lastModified: 123 });

  it('작고 가벼운 이미지도 예외 없이 webp 로 변환한다', async () => {
    const result = await compressImageForUpload(jpeg(300_000));

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe('image/webp');
    expect(result.file.name).toBe('사진.webp');
    expect(result.originalBytes).toBe(300_000);
  });

  it('무손실 품질로만 인코딩한다', async () => {
    await compressImageForUpload(jpeg(300_000));

    expect(toBlobCalls).toEqual([
      expect.objectContaining({ type: 'image/webp', quality: WEBP_LOSSLESS_QUALITY }),
    ]);
    expect(WEBP_LOSSLESS_QUALITY).toBe(1);
  });

  it('기준 변이 넘치면 리사이즈해서 그린다', async () => {
    bitmap = { width: 4000, height: 3000, close: jest.fn() };

    await compressImageForUpload(jpeg(300_000));

    expect(toBlobCalls[0]).toEqual(expect.objectContaining({ width: MAX_EDGE, height: 1200 }));
  });

  it('가로폭 기준 옵션이면 세로로 긴 이미지를 줄이지 않는다', async () => {
    bitmap = { width: 1000, height: 8000, close: jest.fn() };

    await compressImageForUpload(jpeg(300_000), { measure: 'width', maxEdge: 1600 });

    expect(toBlobCalls[0]).toEqual(expect.objectContaining({ width: 1000, height: 8000 }));
  });

  it('무손실 결과가 원본보다 크면 원본을 그대로 쓴다', async () => {
    encodedBytes = 500_000;
    const original = jpeg(300_000);

    const result = await compressImageForUpload(original);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(original);
  });

  it('GIF 는 변환하지 않고 그대로 둔다', async () => {
    const gif = new File([new Uint8Array(9_000_000)], 'a.gif', { type: 'image/gif' });

    const result = await compressImageForUpload(gif);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(gif);
    expect(toBlobCalls).toHaveLength(0);
  });

  it('비이미지는 변환하지 않고 그대로 둔다', async () => {
    const pdf = new File([new Uint8Array(1_000)], 'doc.pdf', { type: 'application/pdf' });

    const result = await compressImageForUpload(pdf);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(pdf);
  });

  it('디코드에 실패하면(HEIC 등) 원본을 그대로 쓴다', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => {
      throw new Error('unsupported');
    });
    const heic = new File([new Uint8Array(1_000)], 'a.heic', { type: 'image/heic' });

    const result = await compressImageForUpload(heic);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(heic);
  });

  it('변환 뒤 비트맵을 회수한다', async () => {
    await compressImageForUpload(jpeg(300_000));

    expect(bitmap.close).toHaveBeenCalled();
  });
});
