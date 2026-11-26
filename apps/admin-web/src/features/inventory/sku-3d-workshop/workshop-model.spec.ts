import type {
  Sku3dWorkshopDetailDto,
  Sku3dWorkshopEventDto,
  Sku3dWorkshopRevisionDto,
} from '@/lib/types/dto/inventory';
import {
  canSendMessage,
  chatItems,
  dimensionQuestion,
  mergeEvents,
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
});
