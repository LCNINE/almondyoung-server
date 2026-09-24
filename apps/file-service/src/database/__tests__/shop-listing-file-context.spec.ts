import { FILE_CONTEXTS as SEEDS } from '../default-file-contexts';

describe('shop-listing-image 컨텍스트', () => {
  const context = SEEDS.find((c) => c.id === 'shop-listing-image');

  it('존재한다 — 없으면 PR 2 의 업로드가 전부 404', () => {
    expect(context).toBeDefined();
  });

  it('공개 이미지, 10MB', () => {
    expect(context).toMatchObject({
      allowPublic: true,
      allowPrivate: false,
      allowedMimeTypes: ['image/*'],
      maxFileSize: 10 * 1024 * 1024,
      pathPrefix: 'shop-listings/images',
      isActive: true,
    });
  });
});
