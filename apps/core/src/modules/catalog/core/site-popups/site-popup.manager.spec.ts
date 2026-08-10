import { BadRequestError } from '@app/shared';
import { SitePopupManager } from './site-popup.manager';
import { CreateSitePopupDto, UpdateSitePopupDto } from './dto';
import { SitePopupEntity } from '../../schema/catalog.schema.types';

function makeExisting(overrides: Partial<SitePopupEntity> = {}): SitePopupEntity {
  return {
    id: 'popup-1',
    title: '안내',
    contentType: 'rich_text',
    content: '<p>안녕하세요</p>',
    pcImageFileId: null,
    mobileImageFileId: null,
    imageAlt: null,
    linkUrl: null,
    noticeId: null,
    pcWidth: null,
    pcHeight: null,
    mobileWidth: null,
    mobileHeight: null,
    placement: 'main',
    placementPaths: [],
    audience: 'all',
    dismissMode: 'today',
    dismissDays: null,
    dismissVersion: 1,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  } as SitePopupEntity;
}

function makeManager(existing: SitePopupEntity = makeExisting()) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(values);
          return Promise.resolve([{ ...makeExisting(), ...values }]);
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updated.push(values);
            return Promise.resolve([{ ...existing, ...values }]);
          },
        }),
      }),
    }),
  };

  const db = { run: (cb: (trx: typeof tx) => Promise<unknown>, t?: typeof tx) => cb(t ?? tx) };
  const reader = {
    findById: jest.fn().mockResolvedValue(existing),
    noticeExists: jest.fn().mockResolvedValue(true),
  };

  const manager = new SitePopupManager(db as never, reader as never);

  return { manager, reader, inserted, updated };
}

const VALID_CREATE: CreateSitePopupDto = {
  title: '안내',
  contentType: 'rich_text',
  content: '<p>안녕하세요</p>',
};

describe('SitePopupManager 저장 값', () => {
  it('관리자가 지정한 PC/모바일 크기를 저장한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({
      ...VALID_CREATE,
      pcWidth: 700,
      pcHeight: 500,
      mobileWidth: 320,
      mobileHeight: 400,
    });

    expect(inserted[0]).toMatchObject({
      pcWidth: 700,
      pcHeight: 500,
      mobileWidth: 320,
      mobileHeight: 400,
    });
  });

  it('수정에서 바꾼 크기를 반영한다', async () => {
    const { manager, updated } = makeManager(makeExisting({ pcWidth: 460, pcHeight: null }));

    await manager.update('popup-1', { pcWidth: 900, pcHeight: 600 });

    expect(updated[0]).toMatchObject({ pcWidth: 900, pcHeight: 600 });
  });

  it('크기를 null 로 보내면 비워 기본값으로 되돌린다', async () => {
    const { manager, updated } = makeManager(makeExisting({ pcWidth: 900, pcHeight: 600 }));

    await manager.update('popup-1', { pcWidth: null, pcHeight: null });

    expect(updated[0]).toMatchObject({ pcWidth: null, pcHeight: null });
  });

  it('크기를 생략하면 기존 크기를 유지한다', async () => {
    const { manager, updated } = makeManager(makeExisting({ pcWidth: 900, mobileWidth: 320 }));

    await manager.update('popup-1', { title: '제목만 수정' });

    expect(updated[0]).toMatchObject({ pcWidth: 900, mobileWidth: 320 });
  });

  it('경로 목록의 공백과 중복을 정리해 저장한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({
      ...VALID_CREATE,
      placement: 'paths',
      placementPaths: [' /products ', '/products', '', '/store'],
    });

    expect(inserted[0]).toMatchObject({ placementPaths: ['/products', '/store'] });
  });
});

describe('SitePopupManager 검증', () => {
  it('본문형인데 본문이 비면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(manager.create({ title: '안내', contentType: 'rich_text' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it('태그만 남은 본문도 빈 본문으로 본다', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({ title: '안내', contentType: 'rich_text', content: '<p><br></p>' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('이미지만 넣은 본문은 빈 본문으로 보지 않는다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({
      title: '안내',
      contentType: 'rich_text',
      content: '<p><img src="https://example.com/a.png"></p>',
    });

    expect(inserted).toHaveLength(1);
  });

  it('이미지형인데 PC 이미지가 없으면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(manager.create({ title: '안내', contentType: 'image' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it('경로 지정인데 경로가 없으면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({ ...VALID_CREATE, placement: 'paths', placementPaths: [] }),
    ).rejects.toThrow(BadRequestError);
  });

  it('"/" 로 시작하지 않는 경로를 거부한다', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({ ...VALID_CREATE, placement: 'paths', placementPaths: ['products'] }),
    ).rejects.toThrow(BadRequestError);
  });

  it('숨김 일수 방식인데 일수가 없으면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(manager.create({ ...VALID_CREATE, dismissMode: 'days' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it('게시 종료가 시작보다 앞서면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({
        ...VALID_CREATE,
        displayStartAt: '2026-09-01T00:00:00.000Z',
        displayEndAt: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it('javascript: 링크를 거부한다', async () => {
    const { manager } = makeManager();

    await expect(
      // eslint-disable-next-line no-script-url
      manager.create({ ...VALID_CREATE, linkUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('프로토콜 상대 경로(//evil.com)를 거부한다', async () => {
    const { manager } = makeManager();

    await expect(manager.create({ ...VALID_CREATE, linkUrl: '//evil.com' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it('사이트 내 경로와 http(s) 링크는 허용한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({ ...VALID_CREATE, linkUrl: '/products/foo' });
    await manager.create({ ...VALID_CREATE, linkUrl: 'https://example.com' });

    expect(inserted).toHaveLength(2);
  });

  it('없는 공지를 연결하면 거부한다', async () => {
    const { manager, reader } = makeManager();
    reader.noticeExists.mockResolvedValue(false);

    await expect(
      manager.create({ ...VALID_CREATE, noticeId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(BadRequestError);
  });
});

describe('SitePopupManager 부분 수정 병합 검증', () => {
  it('본문형 팝업을 이미지형으로만 바꾸면 이미지가 없어 거부한다', async () => {
    const { manager } = makeManager(makeExisting({ contentType: 'rich_text', content: '<p>본문</p>' }));

    await expect(manager.update('popup-1', { contentType: 'image' })).rejects.toThrow(BadRequestError);
  });

  it('이미지형 팝업을 본문형으로만 바꾸면 본문이 없어 거부한다', async () => {
    const { manager } = makeManager(
      makeExisting({
        contentType: 'image',
        content: null,
        pcImageFileId: '11111111-1111-1111-1111-111111111111',
      }),
    );

    await expect(manager.update('popup-1', { contentType: 'rich_text' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it('이미지형 팝업의 PC 이미지만 비우면 거부한다', async () => {
    const { manager } = makeManager(
      makeExisting({
        contentType: 'image',
        content: null,
        pcImageFileId: '11111111-1111-1111-1111-111111111111',
      }),
    );

    await expect(manager.update('popup-1', { pcImageFileId: null })).rejects.toThrow(BadRequestError);
  });

  it('본문형 팝업의 위치만 경로 지정으로 바꾸면 경로가 없어 거부한다', async () => {
    const { manager } = makeManager();

    await expect(manager.update('popup-1', { placement: 'paths' })).rejects.toThrow(BadRequestError);
  });

  it('이미지와 본문형을 함께 보내면 통과한다', async () => {
    const { manager, updated } = makeManager(makeExisting({ contentType: 'rich_text' }));

    await manager.update('popup-1', {
      contentType: 'image',
      pcImageFileId: '11111111-1111-1111-1111-111111111111',
    });

    expect(updated[0]).toMatchObject({
      contentType: 'image',
      pcImageFileId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('기존 게시기간에 어긋나는 종료 일시만 보내면 거부한다', async () => {
    const { manager } = makeManager(
      makeExisting({ displayStartAt: new Date('2026-09-01T00:00:00.000Z') }),
    );

    const dto: UpdateSitePopupDto = { displayEndAt: '2026-08-01T00:00:00.000Z' };

    await expect(manager.update('popup-1', dto)).rejects.toThrow(BadRequestError);
  });
});
