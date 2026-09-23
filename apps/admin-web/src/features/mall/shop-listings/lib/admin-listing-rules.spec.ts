import { CustomError } from '@/lib/api/customError';
import type { AdminShopListingDto } from '@/lib/types/dto/products';
import {
  adminFormValuesFrom,
  adminListingActions,
  buildAdminListQuery,
  buildAdminPayload,
  isModerationConflict,
  SHOP_LISTING_STATUS_TABS,
  type AdminShopListingFormValues,
} from './admin-listing-rules';

const FILE = '019f890e-dec0-7060-a32e-024c3e47c6be';

const memberListing: AdminShopListingDto = {
  id: 'l1',
  slug: 'gangnam-nail',
  title: '강남 네일',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  areaPyeong: 15,
  deposit: 20_000_000,
  monthlyRent: null,
  keyMoney: 30_000_000,
  thumbnailFileId: FILE,
  imageFileIds: [FILE],
  status: 'pending',
  viewCount: 0,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  rejectReason: null,
  contactPhone: '01012345678',
  kakaoOpenChatUrl: 'https://open.kakao.com/o/abc',
  submittedAt: '2026-09-24T00:00:00.000Z',
  authorType: 'member',
  authorUserId: 'u1',
};

describe('adminListingActions (spec §8.3 표)', () => {
  it.each([
    ['pending', ['approve', 'reject']],
    ['published', ['hide', 'close']],
    ['closed', ['hide', 'reopen']],
    ['hidden', ['unhide']],
    ['rejected', []],
  ] as const)('%s → %j', (status, expected) => {
    expect(adminListingActions(status)).toEqual(expected);
  });
});

describe('SHOP_LISTING_STATUS_TABS', () => {
  it('첫 탭(기본)은 검토 대기다', () => {
    expect(SHOP_LISTING_STATUS_TABS[0].value).toBe('pending');
  });
});

describe('buildAdminListQuery', () => {
  it('「전체」와 빈 검색어는 키를 싣지 않는다 — 쿼리 키가 흔들리지 않게', () => {
    expect(buildAdminListQuery('all', 'all', '  ')).toEqual({});
    expect(buildAdminListQuery('pending', 'member', ' 네일 ')).toEqual({
      status: 'pending',
      authorType: 'member',
      q: '네일',
    });
  });
});

describe('buildAdminPayload — PUT 전체 교체 계약', () => {
  it('회원 글을 그대로 저장해도 연락처가 살아남는다', () => {
    const result = buildAdminPayload(adminFormValuesFrom(memberListing));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.contactPhone).toBe('01012345678');
    expect(result.payload.kakaoOpenChatUrl).toBe('https://open.kakao.com/o/abc');
  });

  it('연락처가 비어도 키는 항상 싣는다(null)', () => {
    const values: AdminShopListingFormValues = {
      ...adminFormValuesFrom(memberListing),
      contactPhone: ' ',
      kakaoOpenChatUrl: '',
    };
    const result = buildAdminPayload(values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.payload)).toEqual(expect.arrayContaining(['contactPhone', 'kakaoOpenChatUrl']));
    expect(result.payload.contactPhone).toBeNull();
    expect(result.payload.kakaoOpenChatUrl).toBeNull();
  });

  it('만원 → 원, 전화는 숫자만', () => {
    const result = buildAdminPayload({ ...adminFormValuesFrom(memberListing), deposit: '500', contactPhone: '02-123-4567' });
    expect(result.ok && result.payload.deposit).toBe(5_000_000);
    expect(result.ok && result.payload.contactPhone).toBe('021234567');
  });

  it.each([
    [{ title: ' ' }, 'title'],
    [{ region: '' }, 'region'],
    [{ businessType: '' }, 'businessType'],
    [{ imageFileIds: [] }, 'imageFileIds'],
    [{ content: '' }, 'content'],
    [{ contactPhone: '123' }, 'contactPhone'],
    [{ kakaoOpenChatUrl: 'https://x.y' }, 'kakaoOpenChatUrl'],
  ] as const)('%j → %s', (patch, field) => {
    const result = buildAdminPayload({ ...adminFormValuesFrom(memberListing), ...patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe(field);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('adminFormValuesFrom', () => {
  it('새 글은 빈 폼(거래 유형만 양도)', () => {
    expect(adminFormValuesFrom(undefined)).toMatchObject({ title: '', dealType: 'transfer', imageFileIds: [], contactPhone: '' });
  });
});

describe('isModerationConflict', () => {
  it('409 만 참', () => {
    expect(isModerationConflict(new CustomError({ message: 'x', statusCode: 409 }))).toBe(true);
    expect(isModerationConflict(new CustomError({ message: 'x', statusCode: 400 }))).toBe(false);
    expect(isModerationConflict(new Error('x'))).toBe(false);
  });
});
