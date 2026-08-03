import { buildVersionData } from './bulk-draft.fields';
import type { FlatFields } from './bulk-session.types';

const noImages = { fileIdFor: () => undefined };
const FILE_A = '0198f000-0000-7000-8000-00000000aaaa';

describe('buildVersionData', () => {
  it('채워진 스칼라를 타입에 맞게 옮긴다', () => {
    const fields: FlatFields = {
      'product.name': '반팔티',
      'product.brand': 'ACME',
      'product.marketPrice': '19900',
      'product.ageRestriction': '19',
      'product.isOverseas': 'Y',
      'product.seoKeywords': '여름|반팔',
    };
    const { data, errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toEqual([]);
    expect(data.name).toBe('반팔티');
    expect(data.brand).toBe('ACME');
    expect(data.marketPrice).toBe(19900);
    expect(data.ageRestriction).toBe(19);
    expect(data.isOverseas).toBe(true);
    expect(data.seoKeywords).toEqual(['여름', '반팔']);
  });

  it('필드경로에 없는 키는 아예 만들지 않는다 — 그것이 "변경 없음"이다', () => {
    const fields: FlatFields = { 'product.brand': 'ACME' };
    const { data } = buildVersionData(fields, { fields }, noImages);

    expect('name' in data).toBe(false);
    expect('marketPrice' in data).toBe(false);
    expect('thumbnailFileId' in data).toBe(false);
  });

  it('빈칸은 컬럼의 성격대로 착지한다 (nullable→null, notNull→기본값)', () => {
    const fields: FlatFields = {
      'product.brand': '',
      'product.maxQuantity': '',
      'product.ageRestriction': '',
      'product.minQuantity': '',
      'product.isWholesaleOnly': '',
      'product.seoKeywords': '',
      'product.salesEndDate': '',
    };
    const { data, errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toEqual([]);
    expect(data.brand).toBeNull();
    expect(data.maxQuantity).toBeNull();
    expect(data.ageRestriction).toBe(0);
    expect(data.minQuantity).toBe(1);
    expect(data.isWholesaleOnly).toBe(false);
    expect(data.seoKeywords).toEqual([]);
    expect(data.salesEndDate).toBeNull();
  });

  it('상품명은 비울 수 없다', () => {
    const fields: FlatFields = { 'product.name': '' };
    const { errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('상품명');
  });

  it('판매기간 ISO 문자열을 Date 로 되살린다', () => {
    const fields: FlatFields = { 'product.salesStartDate': '2026-08-01T15:00:00.000Z' };
    const { data } = buildVersionData(fields, { fields }, noImages);

    expect(data.salesStartDate).toBeInstanceOf(Date);
    expect((data.salesStartDate as Date).toISOString()).toBe('2026-08-01T15:00:00.000Z');
  });

  it('대표이미지키를 fileId 로 바꾸고, 빈칸이면 null 로 지운다', () => {
    const images = { fileIdFor: (key: string) => (key === 'IMG-1' ? FILE_A : undefined) };

    const set = buildVersionData(
      { 'product.thumbnailImageKey': 'IMG-1' },
      { fields: { 'product.thumbnailImageKey': 'IMG-1' } },
      images,
    );
    expect(set.data.thumbnailFileId).toBe(FILE_A);

    const cleared = buildVersionData(
      { 'product.thumbnailImageKey': '' },
      { fields: { 'product.thumbnailImageKey': '' } },
      images,
    );
    expect(cleared.data.thumbnailFileId).toBeNull();
  });

  it('해석되지 않은 이미지키는 행 오류다', () => {
    const fields: FlatFields = { 'product.thumbnailImageKey': 'IMG-9' };
    const { errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('IMG-9');
  });

  it('본문의 이미지 디렉티브를 fileId 로 치환한다', () => {
    const images = { fileIdFor: (key: string) => (key === 'IMG-2' ? FILE_A : undefined) };
    const fields: FlatFields = { 'product.description': '앞\n::product-image{imageKey="IMG-2"}\n뒤' };
    const { data, errors } = buildVersionData(fields, { fields }, images);

    expect(errors).toEqual([]);
    expect(data.description).toBe(`앞\n::product-image{fileId="${FILE_A}"}\n뒤`);
  });

  it('카테고리는 payload 의 해석 결과를 그대로 싣는다', () => {
    const fields: FlatFields = { 'category.set': 'A>B*' };
    const payload = { fields, categoryIds: ['cat-1', 'cat-2'], primaryCategoryId: 'cat-1' };
    const { data } = buildVersionData(fields, payload, noImages);

    expect(data.categoryIds).toEqual(['cat-1', 'cat-2']);
    expect(data.primaryCategoryId).toBe('cat-1');
  });
});
