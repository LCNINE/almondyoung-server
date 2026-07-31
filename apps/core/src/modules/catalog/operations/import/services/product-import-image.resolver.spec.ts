import { indexSessionImages, unresolvedImageError, SessionImageRow } from './product-import-image.resolver';
import { ProductRecord } from '../dto/import.types';

function row(over: Partial<SessionImageRow>): SessionImageRow {
  return { imageKey: 'IMG-1', usage: 'main', status: 'uploaded', fileId: 'f-1', errorMessage: null, ...over };
}

function record(over: Partial<ProductRecord>): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: {},
    version: {},
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
    ...over,
  };
}

describe('indexSessionImages', () => {
  it('용도별로 갈라 uploaded 행만 fileId 맵에 넣는다', () => {
    const index = indexSessionImages([
      row({ imageKey: 'IMG-1', usage: 'main', fileId: 'f-main' }),
      row({ imageKey: 'IMG-1', usage: 'description', fileId: 'f-desc' }),
      row({ imageKey: 'IMG-2', usage: 'main', status: 'fetch_failed', fileId: null, errorMessage: '404' }),
    ]);
    expect(index.fileIds.main.get('IMG-1')).toBe('f-main');
    expect(index.fileIds.description.get('IMG-1')).toBe('f-desc');
    expect(index.fileIds.main.has('IMG-2')).toBe(false);
    expect(index.failures.get('main:IMG-2')).toBe('404');
  });

  it('uploaded 인데 fileId 가 없으면 실패로 본다 (있을 수 없는 상태지만 조용히 통과시키지 않는다)', () => {
    const index = indexSessionImages([row({ status: 'uploaded', fileId: null })]);
    expect(index.fileIds.main.size).toBe(0);
    expect(index.failures.get('main:IMG-1')).toMatch(/fileId/);
  });

  it('errorMessage 가 없는 미완료 행은 상태를 사유로 쓴다', () => {
    const index = indexSessionImages([row({ status: 'pending', fileId: null, errorMessage: null })]);
    expect(index.failures.get('main:IMG-1')).toMatch(/pending/);
  });
});

describe('unresolvedImageError', () => {
  const index = indexSessionImages([
    row({ imageKey: 'IMG-1', usage: 'main', fileId: 'f-main' }),
    row({ imageKey: 'IMG-2', usage: 'main', status: 'probe_failed', fileId: null, errorMessage: 'DNS 실패' }),
    row({ imageKey: 'IMG-3', usage: 'description', fileId: 'f-desc' }),
  ]);

  it('전부 해결되면 null', () => {
    const out = unresolvedImageError(
      record({ thumbnailImageKey: 'IMG-1', descriptionImageKeys: ['IMG-3'] }),
      index,
    );
    expect(out).toBeNull();
  });

  it('이미지를 안 쓰는 행도 null', () => {
    expect(unresolvedImageError(record({}), index)).toBeNull();
  });

  it('대표 이미지가 실패했으면 키와 사유를 담은 메시지를 돌려준다', () => {
    const out = unresolvedImageError(record({ thumbnailImageKey: 'IMG-2' }), index);
    expect(out).toMatch(/IMG-2/);
    expect(out).toMatch(/DNS 실패/);
  });

  it('부가·본문도 함께 본다', () => {
    const out = unresolvedImageError(
      record({ additionalImageKeys: ['IMG-2'], descriptionImageKeys: ['GHOST'] }),
      index,
    );
    expect(out).toMatch(/IMG-2/);
    expect(out).toMatch(/GHOST/);
  });

  it('인덱스에 아예 없는 키도 실패로 본다', () => {
    expect(unresolvedImageError(record({ thumbnailImageKey: 'NOPE' }), index)).toMatch(/NOPE/);
  });
});
