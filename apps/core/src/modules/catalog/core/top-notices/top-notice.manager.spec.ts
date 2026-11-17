import { BadRequestError } from '@app/shared';
import { TopNoticeManager } from './top-notice.manager';
import { TopNoticeEntity } from '../../schema/catalog.schema.types';

function makeExisting(overrides: Partial<TopNoticeEntity> = {}): TopNoticeEntity {
  return {
    id: 'top-notice-1',
    text: '5만원 이상 무료배송',
    linkUrl: null,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function makeManager(existing: TopNoticeEntity = makeExisting()) {
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
  const reader = { findById: jest.fn().mockResolvedValue(existing) };

  const manager = new TopNoticeManager(db as never, reader as never);

  return { manager, inserted, updated };
}

describe('TopNoticeManager 저장 값', () => {
  it('기본값으로 활성, 정렬 0 을 넣는다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({ text: '5만원 이상 무료배송' }, 'admin-1');

    expect(inserted[0]).toMatchObject({
      text: '5만원 이상 무료배송',
      linkUrl: null,
      isActive: true,
      sortOrder: 0,
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
    });
  });

  it('빈 링크는 링크 없음으로 저장한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({ text: '안내', linkUrl: '   ' });

    expect(inserted[0]).toMatchObject({ linkUrl: null });
  });

  it('링크를 null 로 보내면 비운다', async () => {
    const { manager, updated } = makeManager(makeExisting({ linkUrl: '/cs/notice/abc' }));

    await manager.update('top-notice-1', { linkUrl: null });

    expect(updated[0]).toMatchObject({ linkUrl: null });
  });

  it('링크를 생략하면 기존 링크를 유지한다', async () => {
    const { manager, updated } = makeManager(makeExisting({ linkUrl: '/cs/notice/abc' }));

    await manager.update('top-notice-1', { text: '문구만 수정' });

    expect(updated[0]).toMatchObject({ text: '문구만 수정', linkUrl: '/cs/notice/abc' });
  });
});

describe('TopNoticeManager 검증', () => {
  it('게시 종료가 시작보다 앞서면 거부한다', async () => {
    const { manager } = makeManager();

    await expect(
      manager.create({
        text: '안내',
        displayStartAt: '2026-12-01T00:00:00.000Z',
        displayEndAt: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it('기존 게시기간에 어긋나는 종료 일시만 보내면 거부한다', async () => {
    const { manager } = makeManager(makeExisting({ displayStartAt: new Date('2026-12-01T00:00:00.000Z') }));

    await expect(manager.update('top-notice-1', { displayEndAt: '2026-11-01T00:00:00.000Z' })).rejects.toThrow(
      BadRequestError,
    );
  });

  it.each(['javascript:alert(1)', '//evil.com', 'products/foo'])('위험하거나 형식이 틀린 링크 %s 를 거부한다', async (linkUrl) => {
    const { manager } = makeManager();

    await expect(manager.create({ text: '안내', linkUrl })).rejects.toThrow(BadRequestError);
  });

  it('사이트 내 경로와 http(s) 링크는 허용한다', async () => {
    const { manager, inserted } = makeManager();

    await manager.create({ text: '안내', linkUrl: '/cs/notice/0190c1a2-0000-7000-8000-000000000000' });
    await manager.create({ text: '안내', linkUrl: 'https://example.com/event' });

    expect(inserted).toHaveLength(2);
  });
});
