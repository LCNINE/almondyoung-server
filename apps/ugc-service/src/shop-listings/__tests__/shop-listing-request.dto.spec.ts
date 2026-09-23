import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminShopListingDto, MemberShopListingDto } from '../dto';

const IMAGE = '019166f0-0000-7000-8000-000000000001';

const VALID = {
  title: '강남 네일샵 양도',
  content: '역 5분 거리입니다.',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  imageFileIds: [IMAGE],
  contactPhone: '010-1234-5678',
};

function withoutPhone(body: typeof VALID): Omit<typeof VALID, 'contactPhone'> {
  const copy: Partial<typeof VALID> = { ...body };
  delete copy.contactPhone;
  return copy as Omit<typeof VALID, 'contactPhone'>;
}

async function errorsOf<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('MemberShopListingDto', () => {
  it('정상 입력은 통과하고 전화번호의 하이픈이 빠진다', async () => {
    const dto = plainToInstance(MemberShopListingDto, VALID);
    expect(await validate(dto)).toEqual([]);
    expect(dto.contactPhone).toBe('01012345678');
  });

  it('회원 글은 전화번호가 필수다', async () => {
    expect(await errorsOf(MemberShopListingDto, withoutPhone(VALID))).toContain('contactPhone');
  });

  it('0 으로 시작하지 않는 번호는 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, contactPhone: '1012345678' })).toContain('contactPhone');
  });

  it('공백뿐인 본문은 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, content: '  \n ' })).toContain('content');
  });

  it('본문 10,000자 초과는 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, content: 'a'.repeat(10_001) })).toContain('content');
  });

  it('이미지는 1~15장, 중복 불가', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: [] })).toContain('imageFileIds');
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: [IMAGE, IMAGE] })).toContain('imageFileIds');
    const sixteen = Array.from({ length: 16 }, (_, i) => `019166f0-0000-7000-8000-${String(i).padStart(12, '0')}`);
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: sixteen })).toContain('imageFileIds');
  });

  it('오픈채팅은 open.kakao.com 만', async () => {
    expect(
      await errorsOf(MemberShopListingDto, { ...VALID, kakaoOpenChatUrl: 'https://evil.example/open.kakao.com/' }),
    ).toContain('kakaoOpenChatUrl');
    expect(await errorsOf(MemberShopListingDto, { ...VALID, kakaoOpenChatUrl: 'https://open.kakao.com/o/abc' })).toEqual(
      [],
    );
  });
});

describe('AdminShopListingDto', () => {
  it('관리자 글은 전화번호가 없어도 된다', async () => {
    expect(await errorsOf(AdminShopListingDto, withoutPhone(VALID))).toEqual([]);
  });

  it('slug 형식을 검사한다', async () => {
    expect(await errorsOf(AdminShopListingDto, { ...VALID, slug: 'Bad Slug' })).toContain('slug');
    expect(await errorsOf(AdminShopListingDto, { ...VALID, slug: '강남-네일' })).toEqual([]);
  });
});
