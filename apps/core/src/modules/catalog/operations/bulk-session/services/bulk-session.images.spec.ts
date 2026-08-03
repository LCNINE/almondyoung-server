import {
  BULK_IMAGE_CONTEXT_BY_USAGE,
  checkFileMetadata,
  collectReferencedImageRefs,
  dedupeResolutions,
  imageRefKey,
  isBulkImageUsage,
} from './bulk-session.images';

describe('imageRefKey / isBulkImageUsage', () => {
  it('용도와 이미지키를 하나의 비교 가능한 문자열로 만든다', () => {
    expect(imageRefKey('main', 'IMG-1')).toBe('main:IMG-1');
    expect(imageRefKey('description', 'IMG-1')).toBe('description:IMG-1');
  });

  it('같은 키라도 용도가 다르면 다른 참조다', () => {
    expect(imageRefKey('main', 'IMG-1')).not.toBe(imageRefKey('description', 'IMG-1'));
  });

  it('용도 가드는 열거값만 통과시킨다', () => {
    expect(isBulkImageUsage('main')).toBe(true);
    expect(isBulkImageUsage('description')).toBe(true);
    expect(isBulkImageUsage('MAIN')).toBe(false);
    expect(isBulkImageUsage('thumbnail')).toBe(false);
  });
});

describe('collectReferencedImageRefs', () => {
  it('payload 들의 imageRefs 를 용도까지 포함해 모은다', () => {
    const refs = collectReferencedImageRefs([
      { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
      { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'description' }] },
    ]);
    expect([...refs].sort()).toEqual(['description:IMG-1', 'main:IMG-1']);
  });

  it('imageRefs 가 없는 payload 는 그냥 건너뛴다', () => {
    expect(collectReferencedImageRefs([{ fields: {} }]).size).toBe(0);
  });

  // jsonb 왕복 값이라 shape 이 다를 수 있다 — 가드를 통과 못 하는 값에서 죽으면 안 된다.
  it('payload 가 아닌 값(null·문자열·옛 shape)은 조용히 무시한다', () => {
    expect(collectReferencedImageRefs([null, 'x', 42, {}, { imageRefs: [] }]).size).toBe(0);
  });

  // isBulkItemPayload 는 imageRefs 필드를 검증하지 않으므로, imageRefs 가 배열이 아닌 경우 처리
  it('imageRefs 가 배열이 아니면(숫자, 객체) 그 payload 는 건너뛴다', () => {
    const refs = collectReferencedImageRefs([
      { fields: {}, imageRefs: 42 },
      { fields: {}, imageRefs: { foo: 1 } },
    ]);
    expect(refs.size).toBe(0);
  });

  // 배열 원소가 {imageKey, usage} 형태가 아니거나 usage 가 열거값이 아니면 그 원소만 버린다
  it('imageRefs 배열 원소가 올바른 형태가 아니면 그 원소는 버리고 정상분은 수집한다', () => {
    const refs = collectReferencedImageRefs([
      {
        fields: {},
        imageRefs: [
          { imageKey: 'IMG-1', usage: 'main' }, // 정상
          { notImageKey: 'IMG-2', usage: 'main' }, // 필드명 틀림
          { imageKey: 'IMG-3', usage: 'thumbnail' }, // usage 가 열거값 아님
          { imageKey: 42, usage: 'description' }, // imageKey 가 문자열 아님
          { imageKey: 'IMG-4', usage: 'description' }, // 정상
          // undefined 원소도 버린다
          undefined,
          null,
        ],
      },
    ]);
    expect([...refs].sort()).toEqual(['description:IMG-4', 'main:IMG-1']);
  });

  // 정상 payload 와 망가진 imageRefs 가 섞여 있을 때 정상분만 수집
  it('여러 payload 중 일부는 정상, 일부는 imageRefs 가 망가져도 정상분은 수집한다', () => {
    const refs = collectReferencedImageRefs([
      { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
      { fields: {}, imageRefs: 'not-an-array' },
      { fields: {}, imageRefs: [{ imageKey: 'IMG-2', usage: 'description' }] },
    ]);
    expect([...refs].sort()).toEqual(['description:IMG-2', 'main:IMG-1']);
  });
});

describe('checkFileMetadata', () => {
  it('용도에 맞는 컨텍스트면 통과다', () => {
    expect(checkFileMetadata({ contextId: 'product-image', status: 'active' }, 'main')).toBeNull();
    expect(checkFileMetadata({ contextId: 'product-description-image', status: 'active' }, 'description')).toBeNull();
  });

  // 용도별 MIME·크기 제약이 달라서(product-image 는 jpeg/png/webp 10MB) 컨텍스트가
  // 어긋난 파일은 제약을 우회해 들어온 것이다.
  it('컨텍스트가 어긋나면 기대·실제를 함께 담은 오류를 준다', () => {
    const error = checkFileMetadata({ contextId: 'product-description-image', status: 'active' }, 'main');
    expect(error).toContain('product-image');
    expect(error).toContain('product-description-image');
  });

  it('이미 삭제된 파일은 거절한다', () => {
    expect(checkFileMetadata({ contextId: 'product-image', status: 'deleted' }, 'main')).toContain('삭제');
  });

  it('용도 → 컨텍스트 매핑은 file-service 시드와 같은 두 값뿐이다', () => {
    expect(BULK_IMAGE_CONTEXT_BY_USAGE).toEqual({
      main: 'product-image',
      description: 'product-description-image',
    });
  });
});

describe('dedupeResolutions', () => {
  it('같은 (imageKey, usage) 가 여러 번 오면 마지막 것만 남긴다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'b' },
    ]);
    expect(out).toEqual([{ imageKey: 'IMG-1', usage: 'main', fileId: 'b' }]);
  });

  it('용도가 다르면 서로 다른 항목이라 둘 다 남는다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'description' as const, fileId: 'b' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('입력 순서를 유지한다 — 결과 배열이 요청 순서와 대응해야 화면이 짝지을 수 있다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-2', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'b' },
    ]);
    expect(out.map((e) => e.imageKey)).toEqual(['IMG-2', 'IMG-1']);
  });
});
