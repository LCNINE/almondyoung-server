import { parseTenantList, TenancyConfig, TENANT_HEADER } from '@app/tenancy';
import { OrphanFileReaperService } from '../orphan-file-reaper.service';
import type { UploadedFileRepository, UploadedFileRow } from '../uploaded-file.repository';

const tenancy = new TenancyConfig(
  parseTenantList(
    JSON.stringify([
      { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'one-shared', privateBucket: 'one-shared' },
      { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'two-pub', privateBucket: 'two-priv' },
    ]),
  ),
  'reject',
);

const DAY = 24 * 60 * 60 * 1000;

function row(fileId: string, overrides: Partial<UploadedFileRow> = {}): UploadedFileRow {
  return {
    fileId,
    sessionId: 's1',
    tenantId: '1',
    contextId: 'product-image',
    uploadedAt: new Date(Date.now() - 40 * DAY),
    releasedAt: null,
    stuckAt: null,
    ...overrides,
  };
}

type Fakes = {
  service: OrphanFileReaperService;
  /** 나간 요청마다 `<테넌트 헤더> <메서드> <URL>`. */
  calls: string[];
  released: string[][];
  forgotten: string[][];
  deleted: string[];
  stuck: string[][];
};

function setup(options: {
  unchecked?: UploadedFileRow[];
  releasedRows?: UploadedFileRow[];
  referenced?: string[] | 'fail';
  /** file-service 가 이 경로에 404 를 낸다. */
  missingOn?: '/restore' | '/object' | '';
  /** 이 테넌트의 행을 읽으면 저장소가 던진다. */
  brokenTenant?: string;
}): Fakes {
  const released: string[][] = [];
  const forgotten: string[][] = [];
  const deleted: string[] = [];
  const stuck: string[][] = [];
  const calls: string[] = [];

  // 저장소 자리: 테넌트의 행만 준다(실제 저장소의 WHERE tenant_id).
  const ofTenant = (rows: UploadedFileRow[] | undefined, tenantId: string) => {
    if (tenantId === options.brokenTenant) return Promise.reject(new Error('db down'));
    return Promise.resolve((rows ?? []).filter((r) => r.tenantId === tenantId));
  };
  const repository = {
    findUnchecked: (tenantId: string) => ofTenant(options.unchecked, tenantId),
    findReleasedBefore: (tenantId: string) => ofTenant(options.releasedRows, tenantId),
    markReleased: (ids: string[]) => {
      released.push(ids);
      return Promise.resolve();
    },
    forget: (ids: string[]) => {
      forgotten.push(ids);
      return Promise.resolve();
    },
    markStuck: (ids: string[]) => {
      if (ids.length > 0) stuck.push(ids);
      return Promise.resolve();
    },
    countStuck: () => Promise.resolve(stuck.flat().length),
  } as unknown as UploadedFileRepository;

  global.fetch = ((url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const headers = new Headers(init?.headers);
    calls.push(`${headers.get(TENANT_HEADER) ?? '-'} ${init?.method ?? 'GET'} ${href}`);
    if (href.includes('/internal/product-files/referenced')) {
      if (options.referenced === 'fail') return Promise.resolve(new Response('', { status: 500 }));
      return Promise.resolve(Response.json({ referenced: options.referenced ?? [] }));
    }
    const suffix = href.endsWith('/restore') ? '/restore' : href.endsWith('/object') ? '/object' : '';
    if (options.missingOn === suffix) return Promise.resolve(new Response('', { status: 404 }));
    deleted.push(init?.method === 'POST' ? `POST ${href}` : href);
    return Promise.resolve(Response.json({ success: true }));
  }) as typeof fetch;

  return { service: new OrphanFileReaperService(repository, tenancy), calls, released, forgotten, deleted, stuck };
}

describe('고아 파일 수거', () => {
  beforeEach(() => {
    process.env.CORE_INTERNAL_KEY = 'k';
    process.env.FILE_SERVICE_INTERNAL_KEY = 'k';
  });

  it('상품에 붙은 파일은 지우지 않고 추적만 그만둔다', async () => {
    const { service, released, forgotten, deleted } = setup({
      unchecked: [row('used'), row('orphan')],
      referenced: ['used'],
    });

    await service.reap();

    expect(forgotten).toContainEqual(['used']);
    expect(released).toContainEqual(['orphan']);
    expect(deleted.some((url) => url.includes('used'))).toBe(false);
    expect(deleted.some((url) => url.endsWith('/internal/files/orphan'))).toBe(true);
  });

  // 참조 조회가 실패했을 때 빈 배열로 읽으면 core 가 잠깐 죽은 사이에 살아 있는
  // 이미지를 전부 지운다.
  it('참조 조회가 실패하면 아무것도 지우지 않는다', async () => {
    const { service, released, deleted } = setup({
      unchecked: [row('a'), row('b')],
      referenced: 'fail',
    });

    await service.reap();

    expect(released).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('유예가 지난 soft delete 는 S3 객체까지 지우고 추적을 끝낸다', async () => {
    const { service, forgotten, deleted } = setup({
      releasedRows: [row('old', { releasedAt: new Date(Date.now() - 20 * DAY) })],
    });

    await service.reap();

    expect(deleted).toContain('http://localhost:3010/internal/files/old/object');
    expect(forgotten).toContainEqual(['old']);
  });

  // soft delete 된 뒤에도 fileId 는 대화에 남아 있어, 유예 중에 어드민이 상품에 붙일 수
  // 있다. 그걸 그대로 지우면 상품 이미지가 영구히 깨진다.
  it('유예 중에 상품에 붙은 파일은 지우지 않고 되살린다', async () => {
    const { service, forgotten, deleted } = setup({
      releasedRows: [row('reused', { releasedAt: new Date(Date.now() - 20 * DAY) })],
      referenced: ['reused'],
    });

    await service.reap();

    expect(deleted).toContain('POST http://localhost:3010/internal/files/reused/restore');
    expect(deleted.some((url) => url.includes('/object'))).toBe(false);
    expect(forgotten).toContainEqual(['reused']);
  });

  // 복구 404 = 상품이 참조하는 파일 행이 이미 사라졌다. 추적을 지우면 깨진 이미지를
  // 아무도 모른다.
  it('복구가 404 면 추적을 지우지 않고 큐에서만 뺀다', async () => {
    const { service, forgotten, stuck } = setup({
      releasedRows: [row('reused', { releasedAt: new Date(Date.now() - 20 * DAY) })],
      referenced: ['reused'],
      missingOn: '/restore',
    });

    await service.reap();

    expect(forgotten.flat()).not.toContain('reused');
    expect(stuck).toContainEqual(['reused']);
  });

  // 지우려는데 행이 없으면 지울 것도 추적할 것도 없다.
  it('실삭제가 404 면 추적을 끝낸다', async () => {
    const { service, forgotten } = setup({
      releasedRows: [row('gone', { releasedAt: new Date(Date.now() - 20 * DAY) })],
      missingOn: '/object',
    });

    await service.reap();

    expect(forgotten).toContainEqual(['gone']);
  });

  it('purge 직전 재확인이 실패하면 아무것도 지우지 않는다', async () => {
    const { service, forgotten, deleted } = setup({
      releasedRows: [row('old', { releasedAt: new Date(Date.now() - 20 * DAY) })],
      referenced: 'fail',
    });

    await service.reap();

    expect(deleted).toEqual([]);
    expect(forgotten).toEqual([]);
  });

  it('키가 없으면 아무것도 지우지 않는다', async () => {
    delete process.env.CORE_INTERNAL_KEY;
    const { service, released, deleted } = setup({ unchecked: [row('a')] });

    await service.reap();

    expect(released).toEqual([]);
    expect(deleted).toEqual([]);
  });

  // 상품은 테넌트 core DB 마다 따로다. 테넌트 2 파일을 테넌트 1 core 에 물으면 «미참조»로 읽혀 살아 있는 파일을 지운다.
  describe('테넌트마다', () => {
    it('그 테넌트의 파일만 그 테넌트 헤더를 붙여 core·file-service 에 묻는다', async () => {
      const { service, calls } = setup({
        unchecked: [row('one-a'), row('two-a', { tenantId: '2' })],
        releasedRows: [row('two-old', { tenantId: '2', releasedAt: new Date(Date.now() - 20 * DAY) })],
      });

      await service.reap();

      expect(calls).toEqual(
        expect.arrayContaining([
          '1 GET http://localhost:3100/internal/product-files/referenced?fileIds=one-a',
          '1 DELETE http://localhost:3010/internal/files/one-a',
          '2 GET http://localhost:3100/internal/product-files/referenced?fileIds=two-a',
          '2 DELETE http://localhost:3010/internal/files/two-a',
          '2 GET http://localhost:3100/internal/product-files/referenced?fileIds=two-old',
          '2 DELETE http://localhost:3010/internal/files/two-old/object',
        ]),
      );
      expect(calls.filter((c) => c.startsWith('1 ') && c.includes('two-'))).toEqual([]);
      expect(calls.filter((c) => c.startsWith('2 ') && c.includes('one-'))).toEqual([]);
      expect(calls.filter((c) => c.startsWith('- '))).toEqual([]);
    });

    it('목록 밖 테넌트의 행은 건드리지 않는다', async () => {
      const { service, calls } = setup({ unchecked: [row('stray', { tenantId: '9' }), row('legacy', { tenantId: null })] });

      await service.reap();

      expect(calls).toEqual([]);
    });

    it('한 테넌트가 실패해도 다른 테넌트는 돌고, 주기는 실패로 남는다', async () => {
      const { service, released } = setup({
        unchecked: [row('one-a'), row('two-a', { tenantId: '2' })],
        brokenTenant: '1',
      });

      await expect(service.reap()).rejects.toThrow(/tenant=1/);

      expect(released).toContainEqual(['two-a']);
    });
  });
});
