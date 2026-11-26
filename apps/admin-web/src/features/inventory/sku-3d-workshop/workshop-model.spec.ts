import type {
  Sku3dWorkshopDetailDto,
  Sku3dWorkshopEventDto,
  Sku3dWorkshopRevisionDto,
} from '@/lib/types/dto/inventory';
import {
  canRetryCreate,
  canSendMessage,
  chatItems,
  dimensionQuestion,
  elapsedText,
  jobStage,
  latestProgressText,
  materialChangeText,
  mergeEvents,
  safeBackHref,
  shortHash,
  viewerRevision,
  workerStatusText,
  workshopStatusText,
} from './workshop-model';

const revision = (number: number): Sku3dWorkshopRevisionDto => ({
  id: `r${number}`,
  number,
  glbSha256: `${number}`.repeat(64).slice(0, 64),
  glbBytes: 1000,
  files: { renders: [], python: null, blend: null, plan: null },
  review: {
    summary: `v${number}`,
    verdict: 'ready_for_review',
    issues: [],
    proposals: [],
    autoFixes: [],
    unseenFaces: [],
    assumptions: [],
    needsPhotos: [],
    dimensionsUsed: { widthMm: 1, lengthMm: 1, heightMm: 1, basis: 'package' },
  },
  createdAt: '2026-11-26T00:00:00Z',
  publishedAt: null,
});

const event = (
  seq: number,
  type: Sku3dWorkshopEventDto['type'] = 'progress'
): Sku3dWorkshopEventDto => ({
  seq,
  jobId: null,
  revisionId: null,
  type,
  authorLabel: null,
  body: `e${seq}`,
  createdAt: '2026-11-26T00:00:00Z',
});

const detail = (
  overrides: Partial<Sku3dWorkshopDetailDto> = {}
): Sku3dWorkshopDetailDto => ({
  workshop: {
    id: 'w',
    skuId: 's',
    ownerId: 'u',
    ownerLabel: '작업자',
    codexSessionId: null,
    dimensionBasis: 'unknown',
    dimensionConfirmedAt: null,
    createdAt: '',
    updatedAt: '',
  },
  sku: {
    id: 's',
    code: 'C',
    name: 'N',
    packageWidthMm: 120,
    packageLengthMm: 45,
    packageHeightMm: 30,
    packageWeightG: 250,
    photos: [],
  },
  activeJob: null,
  revisions: [],
  worker: { online: true, lastSeenAt: '2026-11-26T00:00:00Z' },
  materialChanges: null,
  ...overrides,
});

describe('3D 작업실 화면 로직', () => {
  it('viewerRevision keeps last finished while running', () => {
    const revisions = [revision(2), revision(1)];

    expect(viewerRevision(revisions, null)?.number).toBe(2);
    expect(viewerRevision(revisions, 'r1')?.number).toBe(1);
    expect(viewerRevision(revisions, 'gone')?.number).toBe(2);
    expect(viewerRevision([], null)).toBeNull();
  });

  it('mergeEvents dedupes by seq and keeps order', () => {
    expect(
      mergeEvents([event(1), event(3)], [event(3), event(2), event(4)]).map(
        (e) => e.seq
      )
    ).toEqual([1, 2, 3, 4]);
  });

  it('chatItems shows conversation and status but only the latest progress lines', () => {
    const events = [
      event(1, 'user_message'),
      ...[2, 3, 4, 5, 6, 7].map((n) => event(n)),
      event(8, 'assistant_message'),
    ];
    const items = chatItems(events, 3);

    expect(items.map((e) => e.seq)).toEqual([1, 5, 6, 7, 8]);
  });

  it('workerStatusText never claims a connection the server did not see', () => {
    expect(workerStatusText({ online: false, lastSeenAt: null })).toBe(
      '작업 PC 가 아직 연결된 적이 없어요'
    );
    expect(
      workerStatusText({ online: false, lastSeenAt: '2026-11-26T00:00:00Z' })
    ).toMatch(/꺼져 있어요/);
    expect(
      workerStatusText({ online: true, lastSeenAt: '2026-11-26T00:00:00Z' })
    ).toBe('작업 PC 연결됨');
  });

  it('workshopStatusText follows the active job', () => {
    expect(workshopStatusText(detail())).toBe('');
    expect(
      workshopStatusText(
        detail({
          activeJob: {
            id: 'j',
            workshopId: 'w',
            kind: 'create',
            status: 'queued',
            attempts: 0,
            createdAt: '',
            startedAt: null,
          },
        })
      )
    ).toBe('순서를 기다리고 있어요');
    expect(
      workshopStatusText(
        detail({
          worker: { online: false, lastSeenAt: null },
          activeJob: {
            id: 'j',
            workshopId: 'w',
            kind: 'create',
            status: 'queued',
            attempts: 0,
            createdAt: '',
            startedAt: null,
          },
        })
      )
    ).toBe('작업 PC 가 꺼져 있어요. 요청은 대기열에 남아요');
    expect(
      workshopStatusText(
        detail({
          activeJob: {
            id: 'j',
            workshopId: 'w',
            kind: 'revise',
            status: 'running',
            attempts: 1,
            createdAt: '',
            startedAt: '',
          },
        })
      )
    ).toBe('고치고 있어요');
  });

  it('dimensionQuestion asks only until the basis is confirmed', () => {
    expect(dimensionQuestion(detail())).toMatch(/포장째 크기/);
    expect(
      dimensionQuestion(
        detail({
          workshop: {
            ...detail().workshop,
            dimensionConfirmedAt: '2026-11-26T00:00:00Z',
          },
        })
      )
    ).toBeNull();
  });

  it('canSendMessage needs a finished version and no running job', () => {
    expect(canSendMessage(detail())).toBe(false);
    expect(canSendMessage(detail({ revisions: [revision(1)] }))).toBe(true);
    expect(
      canSendMessage(
        detail({
          revisions: [revision(1)],
          activeJob: {
            id: 'j',
            workshopId: 'w',
            kind: 'revise',
            status: 'running',
            attempts: 1,
            createdAt: '',
            startedAt: '',
          },
        })
      )
    ).toBe(false);
  });

  it('shortHash shows the first 8 characters', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef01');
  });

  it('stops claiming a connection when the status is stale', () => {
    expect(
      workerStatusText(
        { online: true, lastSeenAt: '2026-11-26T00:00:00Z' },
        31_000
      )
    ).toBe('작업 PC 상태를 확인하고 있어요');
  });

  it('offers a retry only after a first build left nothing', () => {
    const confirmed = {
      ...detail().workshop,
      dimensionConfirmedAt: '2026-11-26T00:00:00Z',
    };

    expect(canRetryCreate(detail())).toBe(false);
    expect(canRetryCreate(detail({ workshop: confirmed }))).toBe(true);
    expect(
      canRetryCreate(detail({ workshop: confirmed, revisions: [revision(1)] }))
    ).toBe(false);
  });

  it('safeBackHref keeps only internal capture paths', () => {
    expect(safeBackHref('/mobile/sku-field-capture/mine?who=all', '/x')).toBe(
      '/mobile/sku-field-capture/mine?who=all'
    );
    expect(safeBackHref('/inventory/sku-field-capture', '/x')).toBe(
      '/inventory/sku-field-capture'
    );
    expect(safeBackHref('/\\evil.example', '/x')).toBe('/x');
    expect(safeBackHref('/mobile/\\evil.example', '/x')).toBe('/x');
    expect(safeBackHref('//evil.example', '/x')).toBe('/x');
    expect(safeBackHref('https://evil.example', '/x')).toBe('/x');
    expect(safeBackHref(null, '/x')).toBe('/x');
  });

  it('hides command lines from the chat', () => {
    const command = { ...event(2), body: '실행: pwsh -Command Get-Content' };

    expect(chatItems([event(1), command, event(3)]).map((e) => e.seq)).toEqual([
      1, 3,
    ]);
  });

  it('jobStage follows the job and its first progress', () => {
    const job = {
      id: 'j',
      workshopId: 'w',
      kind: 'create' as const,
      status: 'running' as const,
      attempts: 1,
      createdAt: '',
      startedAt: '',
    };

    expect(jobStage(null, [])).toBeNull();
    expect(jobStage({ ...job, status: 'queued' }, [])?.step).toBe(1);
    expect(jobStage(job, [])?.step).toBe(2);
    expect(jobStage(job, [{ ...event(1), jobId: 'j' }])).toEqual({
      step: 3,
      label: '만들고 있어요',
    });
  });

  it('latestProgressText skips command lines and other jobs', () => {
    const job = {
      id: 'j',
      workshopId: 'w',
      kind: 'create' as const,
      status: 'running' as const,
      attempts: 1,
      createdAt: '',
      startedAt: '',
    };
    const events = [
      { ...event(1), jobId: 'j', body: '렌더를 비교하고 있어요' },
      { ...event(2), jobId: 'j', body: '실행: blender -b' },
      { ...event(3), jobId: 'other', body: '다른 작업' },
    ];

    expect(latestProgressText(job, events)).toBe('렌더를 비교하고 있어요');
  });

  it('elapsedText shows minutes and seconds', () => {
    expect(
      elapsedText('2026-11-26T00:00:00Z', Date.parse('2026-11-26T00:12:05Z'))
    ).toBe('12:05');
  });

  it('materialChangeText summarises what changed after the last version', () => {
    expect(materialChangeText(null)).toBeNull();
    expect(
      materialChangeText({
        addedPhotos: ['a', 'b'],
        removedPhotos: ['c'],
        dimensions: null,
      })
    ).toBe(
      '마지막 버전을 만든 뒤 실측 자료가 바뀌었어요 (사진 2장 추가, 사진 1장 삭제)'
    );
  });
});
