import { type CoreShopListingRow, transformListing } from './transform';

const ROW: CoreShopListingRow = {
  id: '019166f0-0000-7000-8000-00000000aaaa',
  slug: '강남-네일샵',
  title: '강남 네일샵',
  content: '<p>본문</p>',
  region: 'seoul',
  business_type: 'nail',
  deal_type: 'transfer',
  area_pyeong: 10,
  deposit: 1000,
  monthly_rent: null,
  key_money: null,
  thumbnail_file_id: 't',
  images: ['a', 't', 'b'],
  is_active: true,
  view_count: 42,
  created_at: new Date('2026-08-13T00:00:00.000Z'),
  updated_at: new Date('2026-08-14T00:00:00.000Z'),
  created_by: 'admin-1',
  updated_by: 'admin-2',
};

describe('transformListing', () => {
  it('id·slug·조회수·작성 시각을 보존한다', () => {
    const { listing } = transformListing(ROW);
    expect(listing).toMatchObject({
      id: ROW.id,
      slug: ROW.slug,
      view_count: 42,
      created_at: ROW.created_at,
      updated_at: ROW.updated_at,
    });
  });

  it('작성자는 관리자, 연락처는 비운다', () => {
    const { listing } = transformListing(ROW);
    expect(listing).toMatchObject({
      author_type: 'admin',
      author_user_id: 'admin-1',
      updated_by: 'admin-2',
      contact_phone: null,
      kakao_open_chat_url: null,
    });
  });

  it('is_active → published / hidden', () => {
    expect(transformListing(ROW).listing.status).toBe('published');
    expect(transformListing({ ...ROW, is_active: false }).listing.status).toBe('hidden');
  });

  it('본문은 마크다운으로', () => {
    expect(transformListing(ROW).listing.content).toBe('본문');
  });

  it('썸네일을 맨 앞으로 옮기고 나머지 순서를 지킨다', () => {
    expect(transformListing(ROW).imageFileIds).toEqual(['t', 'a', 'b']);
  });

  it('썸네일이 images 에 없으면 앞에 끼운다', () => {
    expect(transformListing({ ...ROW, images: ['a', 'b'] }).imageFileIds).toEqual(['t', 'a', 'b']);
  });

  it('썸네일이 없으면 images 그대로, images 가 null 이면 빈 배열', () => {
    expect(transformListing({ ...ROW, thumbnail_file_id: null }).imageFileIds).toEqual(['a', 't', 'b']);
    expect(transformListing({ ...ROW, thumbnail_file_id: null, images: null }).imageFileIds).toEqual([]);
  });

  it('중복 fileId 는 한 번만', () => {
    expect(transformListing({ ...ROW, images: ['a', 'a', 't'] }).imageFileIds).toEqual(['t', 'a']);
  });
});
