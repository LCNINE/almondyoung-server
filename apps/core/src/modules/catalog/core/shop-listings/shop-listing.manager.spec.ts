import { BadRequestError } from '@app/shared';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingEntity } from '../../schema/catalog.schema.types';

const BASE = { region: 'seoul', businessType: 'nail', dealType: 'transfer' } as const;
const THUMB = '019166f0-0000-7000-8000-000000000001';

function makeExisting(overrides: Partial<ShopListingEntity> = {}): ShopListingEntity {
  return {
    id: 'listing-1',
    slug: 'gangnam-nail-shop',
    title: '강남 네일샵 양도',
    content: '<p>본문</p>',
    thumbnailFileId: THUMB,
    ...BASE,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  } as ShopListingEntity;
}

function makeManager(options: { slugTaken?: boolean } = {}) {
  const existing = makeExisting();
  const inserted: Record<string, unknown>[] = [];

  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(values);
          return Promise.resolve([{ ...existing, ...values }]);
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({ returning: () => Promise.resolve([{ ...existing, ...values }]) }),
      }),
    }),
  };

  const db = { run: (cb: (trx: typeof tx) => Promise<unknown>, t?: typeof tx) => cb(t ?? tx) };
  const reader = {
    findById: jest.fn().mockResolvedValue(existing),
    slugTaken: jest.fn().mockResolvedValue(options.slugTaken ?? false),
  };

  const manager = new ShopListingManager(db as any, reader as any);

  return { manager, reader, inserted, existing };
}

describe('ShopListingManager', () => {
  it('slug 를 소문자로 정규화해 저장한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({
      slug: '  Gangnam-Nail-Shop  ',
      title: ' 강남 네일샵 ',
      thumbnailFileId: THUMB,
      ...BASE,
      content: '<p>본문</p>',
    });

    expect(inserted[0].slug).toBe('gangnam-nail-shop');
    expect(inserted[0].title).toBe('강남 네일샵');
  });

  it('slug 를 비우면 제목에서 만든다 — 한글은 살린다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({ ...BASE, title: '강남 네일샵 양도합니다!', thumbnailFileId: THUMB, content: '<p>본문</p>' });

    expect(inserted[0].slug).toBe('강남-네일샵-양도합니다');
  });

  it('겹치는 주소는 뒤에 번호를 붙여 피한다', async () => {
    const { manager, reader, inserted } = makeManager();
    reader.slugTaken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await manager.create({ ...BASE, title: '강남 네일샵', thumbnailFileId: THUMB, content: '<p>본문</p>' });

    expect(inserted[0].slug).toBe('강남-네일샵-2');
  });

  it('주소로 쓸 글자가 하나도 없으면 BadRequestError', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({ ...BASE, title: '!!!', thumbnailFileId: THUMB, content: '<p>본문</p>' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('수정 시 slug 중복 검사는 자기 자신을 제외한다', async () => {
    const { manager, reader } = makeManager();

    await manager.update('listing-1', { slug: 'new-slug' });

    expect(reader.slugTaken).toHaveBeenCalledWith('new-slug', 'listing-1', expect.anything());
  });

  it('태그만 있고 글자도 이미지도 없으면 BadRequestError', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({ ...BASE, slug: 'a-shop', title: '제목', thumbnailFileId: THUMB, content: '<p><br></p>' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('본문이 이미지뿐이어도 통과한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({
      ...BASE,
      title: '제목',
      thumbnailFileId: THUMB,
      content: '<p><img src="https://x/y.png" /></p>',
    });

    expect(inserted).toHaveLength(1);
  });
});
