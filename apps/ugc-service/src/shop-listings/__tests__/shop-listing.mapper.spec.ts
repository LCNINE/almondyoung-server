import { ShopListingMapper } from '../mappers/shop-listing.mapper';
import { type ShopListingWithImages } from '../types';

const BASE: ShopListingWithImages = {
  id: 'l-1',
  slug: 'gangnam',
  title: '강남',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  areaPyeong: 10,
  deposit: null,
  monthlyRent: null,
  keyMoney: null,
  contactPhone: '01012345678',
  kakaoOpenChatUrl: null,
  authorType: 'member',
  authorUserId: 'u-1',
  status: 'published',
  rejectReason: '예전 사유',
  submittedAt: new Date('2026-09-23T00:00:00.000Z'),
  viewCount: 3,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
  createdAt: new Date('2026-09-23T00:00:00.000Z'),
  updatedAt: new Date('2026-09-23T00:00:00.000Z'),
  imageFileIds: ['f-0', 'f-1'],
};

describe('ShopListingMapper', () => {
  it('공개 DTO 에는 연락처·작성자가 없다', () => {
    const dto = ShopListingMapper.toPublicDto(BASE);
    expect(dto).not.toHaveProperty('contactPhone');
    expect(dto).not.toHaveProperty('kakaoOpenChatUrl');
    expect(dto).not.toHaveProperty('authorUserId');
    expect(dto).not.toHaveProperty('authorType');
  });

  it('썸네일은 첫 이미지다', () => {
    expect(ShopListingMapper.toPublicDto(BASE).thumbnailFileId).toBe('f-0');
    expect(ShopListingMapper.toPublicDto({ ...BASE, imageFileIds: [] }).thumbnailFileId).toBeNull();
  });

  it('거절 사유는 rejected 일 때만 내보낸다 — 승인 후에 옛 사유가 남아 보이지 않게', () => {
    expect(ShopListingMapper.toMineDto(BASE).rejectReason).toBeNull();
    expect(ShopListingMapper.toMineDto({ ...BASE, status: 'rejected' }).rejectReason).toBe('예전 사유');
  });
});
