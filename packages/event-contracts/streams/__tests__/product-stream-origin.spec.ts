import { PRODUCT_STREAM } from '../product.stream';

const basePayload = {
  masterId: 'master-1',
  versionId: 'version-1',
  name: '립 틴트',
  previousActiveVersionId: null,
  changeReason: 'published',
  changedAt: '2026-07-29T00:00:00.000Z',
};

describe('PRODUCT_STREAM ProductMasterActiveVersionChanged origin 마커', () => {
  const schema = PRODUCT_STREAM.events.ProductMasterActiveVersionChanged.schema!;

  it('대량 임포트 게시의 origin 과 세션 id 를 실어 나른다', () => {
    const parsed = schema.parse({
      ...basePayload,
      origin: 'bulk_import',
      importSessionId: '0198f0a0-0000-7000-8000-000000000001',
    });

    expect(parsed.origin).toBe('bulk_import');
    expect(parsed.importSessionId).toBe('0198f0a0-0000-7000-8000-000000000001');
  });

  it('단건 게시처럼 출처가 없는 이벤트도 그대로 통과시킨다', () => {
    const parsed = schema.parse(basePayload);

    expect(parsed.origin).toBeUndefined();
    expect(parsed.importSessionId).toBeUndefined();
  });

  it('정의되지 않은 origin 값은 거부한다', () => {
    expect(() => schema.parse({ ...basePayload, origin: 'category_refresh' })).toThrow();
  });
});
