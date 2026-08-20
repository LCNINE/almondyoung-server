import type {
  BulkSessionImage,
  BulkSessionPhase,
  BulkSessionProgress,
  ResolveImageEntry,
  ResolveImageResult,
} from '@/lib/types/dto/bulk-session';
import {
  bulkSessionListRefetchInterval,
  bulkSessionRefetchInterval,
  canApprove,
  chunkResolutions,
  collectAllRequiredImages,
  IMAGE_PAGE_LIMIT,
  computeDraftingProgress,
  computePublishProgress,
  getBulkSessionView,
  isBulkSessionWorking,
  matchFilesToImageRows,
  normalizeFileName,
  pairResolveResults,
  shouldContinuePurge,
} from './bulk-session-model';

function progress(
  overrides: Partial<BulkSessionProgress> = {}
): BulkSessionProgress {
  return {
    sessionId: 's1',
    phase: 'review',
    phaseError: null,
    totalRows: 0,
    itemTotal: 0,
    itemCounts: [],
    imageCounts: [],
    publishCounts: [],
    cancelRequestedAt: null,
    ...overrides,
  };
}

function imageRow(overrides: Partial<BulkSessionImage> = {}): BulkSessionImage {
  return {
    imageKey: 'IMG-1',
    usage: 'main',
    contextId: 'product-image',
    sourceKind: 'file_name',
    sourceValue: 'front.jpg',
    status: 'awaiting_upload',
    fileId: null,
    required: true,
    ...overrides,
  };
}

describe('getBulkSessionView', () => {
  // phase 가 하나라도 빠지면 그 세션은 빈 화면이 된다. 전량을 못 박는다.
  const cases: Array<[BulkSessionPhase, string]> = [
    ['uploaded', 'working'],
    ['validating', 'working'],
    ['review', 'review'],
    ['awaiting_images', 'images'],
    ['drafting', 'working'],
    ['drafted', 'drafted'],
    ['publishing', 'working'],
    ['published', 'published'],
    ['canceled', 'canceled'],
    ['failed', 'failed'],
  ];

  it.each(cases)('%s → %s', (phase, view) => {
    expect(getBulkSessionView(phase)).toBe(view);
  });
});

describe('isBulkSessionWorking', () => {
  it.each([
    'uploaded',
    'validating',
    'drafting',
    'publishing',
  ] as BulkSessionPhase[])('%s 는 워커 차례다', (phase) =>
    expect(isBulkSessionWorking(phase)).toBe(true)
  );
  it.each([
    'review',
    'awaiting_images',
    'drafted',
    'published',
    'canceled',
    'failed',
  ] as BulkSessionPhase[])('%s 는 워커 차례가 아니다', (phase) =>
    expect(isBulkSessionWorking(phase)).toBe(false)
  );
  it('undefined 는 진행 중으로 본다 — 첫 응답 전에 화면이 굳지 않게', () => {
    expect(isBulkSessionWorking(undefined)).toBe(true);
  });
});

describe('bulkSessionRefetchInterval', () => {
  it('데이터가 없으면 2초 — 첫 요청이 실패해도 화면이 얼지 않는다', () => {
    expect(bulkSessionRefetchInterval(undefined)).toBe(2000);
  });
  it('워커 차례면 2초', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'validating' }))).toBe(
      2000
    );
  });
  it('사람 차례면 멈춘다', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'review' }))).toBe(
      false
    );
  });
  it('종단이면 멈춘다', () => {
    expect(bulkSessionRefetchInterval(progress({ phase: 'published' }))).toBe(
      false
    );
  });
});

describe('bulkSessionListRefetchInterval', () => {
  it('워커 차례인 세션이 하나라도 있으면 2초', () => {
    expect(
      bulkSessionListRefetchInterval([
        { phase: 'review' },
        { phase: 'drafting' },
      ])
    ).toBe(2000);
  });
  it('전부 사람 차례면 멈춘다', () => {
    expect(
      bulkSessionListRefetchInterval([
        { phase: 'review' },
        { phase: 'published' },
      ])
    ).toBe(false);
  });
  it('빈 목록은 멈춘다', () => {
    expect(bulkSessionListRefetchInterval([])).toBe(false);
  });
  it('데이터가 없으면 2초', () => {
    expect(bulkSessionListRefetchInterval(undefined)).toBe(2000);
  });
});

describe('computeDraftingProgress', () => {
  it('분모는 itemTotal 이지 totalRows 가 아니다', () => {
    const p = progress({
      totalRows: 3,
      itemTotal: 5,
      itemCounts: [
        { status: 'pending', count: 2 },
        { status: 'drafted', count: 3 },
      ],
    });
    expect(computeDraftingProgress(p)).toEqual({ done: 3, total: 5 });
  });

  it('pending 이 아닌 것은 전부 처리된 것으로 센다', () => {
    const p = progress({
      itemTotal: 4,
      itemCounts: [
        { status: 'pending', count: 1 },
        { status: 'drafted', count: 1 },
        { status: 'failed', count: 1 },
        { status: 'invalid', count: 1 },
      ],
    });
    expect(computeDraftingProgress(p)).toEqual({ done: 3, total: 4 });
  });

  it('아이템이 없으면 0/0 이다 — 0 나누기를 만들지 않는다', () => {
    expect(computeDraftingProgress(progress())).toEqual({ done: 0, total: 0 });
  });
});

describe('computePublishProgress', () => {
  it('idle 은 분모에서 뺀다 — 발행 대상이 아닌 행이다', () => {
    const p = progress({
      publishCounts: [
        { status: 'idle', count: 10 },
        { status: 'pending', count: 2 },
        { status: 'published', count: 5 },
        { status: 'failed', count: 1 },
      ],
    });
    expect(computePublishProgress(p)).toEqual({ done: 6, total: 8 });
  });

  it('아무도 발행 대상이 아니면 0/0 이다', () => {
    expect(
      computePublishProgress(
        progress({ publishCounts: [{ status: 'idle', count: 3 }] })
      )
    ).toEqual({
      done: 0,
      total: 0,
    });
  });
});

describe('normalizeFileName', () => {
  it('대소문자와 앞뒤 공백을 무시한다', () => {
    expect(normalizeFileName('  Front.JPG ')).toBe('front.jpg');
  });
  it('경로가 붙어 있으면 파일명만 남긴다 — 폴더 드롭이 상대경로를 준다', () => {
    expect(normalizeFileName('images/2026/Front.JPG')).toBe('front.jpg');
  });
  it('역슬래시 경로도 자른다', () => {
    expect(normalizeFileName('images\\Front.JPG')).toBe('front.jpg');
  });
});

describe('matchFilesToImageRows', () => {
  it('파일명이 맞는 행에 붙인다', () => {
    const rows = [imageRow({ imageKey: 'IMG-1', sourceValue: 'front.jpg' })];
    const result = matchFilesToImageRows([{ name: 'FRONT.JPG' }], rows);
    expect(result.tasks).toEqual([
      {
        imageKey: 'IMG-1',
        usage: 'main',
        contextId: 'product-image',
        file: { name: 'FRONT.JPG' },
      },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('한 파일이 두 용도에 걸리면 작업이 둘 생긴다 — contextId 가 달라 두 번 올린다', () => {
    const rows = [
      imageRow({
        imageKey: 'IMG-1',
        usage: 'main',
        contextId: 'product-image',
        sourceValue: 'a.jpg',
      }),
      imageRow({
        imageKey: 'IMG-1',
        usage: 'description',
        contextId: 'product-description-image',
        sourceValue: 'a.jpg',
      }),
    ];
    const result = matchFilesToImageRows([{ name: 'a.jpg' }], rows);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((t) => t.contextId)).toEqual([
      'product-image',
      'product-description-image',
    ]);
  });

  it('요구 목록에 없는 파일은 unmatchedFiles 로 간다', () => {
    const result = matchFilesToImageRows([{ name: 'ghost.png' }], [imageRow()]);
    expect(result.tasks).toEqual([]);
    expect(result.unmatchedFiles).toEqual(['ghost.png']);
  });

  it('아직 파일이 안 온 요구는 missing 에 남는다', () => {
    const rows = [
      imageRow({ imageKey: 'IMG-1', sourceValue: 'a.jpg' }),
      imageRow({ imageKey: 'IMG-2', sourceValue: 'b.jpg' }),
    ];
    const result = matchFilesToImageRows([{ name: 'a.jpg' }], rows);
    expect(result.missing.map((r) => r.imageKey)).toEqual(['IMG-2']);
  });

  it('같은 이름의 파일이 둘 이상이면 duplicateNames 로 알린다', () => {
    const result = matchFilesToImageRows(
      [{ name: 'a/front.jpg' }, { name: 'b/FRONT.jpg' }],
      [imageRow({ sourceValue: 'front.jpg' })]
    );
    expect(result.duplicateNames).toEqual(['front.jpg']);
    // 뒤엣것이 이긴다 — 워크북이 파일명만 받으므로 구조적으로 구분할 수 없다. 화면은
    // 이 동작을 「마지막 파일이 사용됩니다」로 안내한다(images-panel/index.tsx) — 어느
    // 파일이 실제로 살아남는지까지 고정해야 그 문구가 거짓말이 되는 걸 막는다.
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].file.name).toBe('b/FRONT.jpg');
  });

  it('이미 resolved 인 행은 요구가 아니다', () => {
    const rows = [imageRow({ status: 'resolved', fileId: 'f1' })];
    expect(matchFilesToImageRows([{ name: 'front.jpg' }], rows).tasks).toEqual(
      []
    );
  });

  it('1,000행 너머의 요구에도 매칭된다 — 전량 rows 가 들어온다는 전제다', () => {
    const rows = Array.from({ length: 1500 }, (_, i) =>
      imageRow({ imageKey: `IMG-${i}`, sourceValue: `${i}.jpg` })
    );
    const result = matchFilesToImageRows([{ name: '1499.jpg' }], rows);
    expect(result.tasks.map((t) => t.imageKey)).toEqual(['IMG-1499']);
    expect(result.unmatchedFiles).toEqual([]);
  });

  it('required=false 인 행은 요구가 아니다 — invalid 행만 참조하던 이미지다', () => {
    const rows = [imageRow({ required: false })];
    expect(matchFilesToImageRows([{ name: 'front.jpg' }], rows).tasks).toEqual(
      []
    );
  });
});

describe('collectAllRequiredImages', () => {
  const makeRows = (count: number, offset = 0): BulkSessionImage[] =>
    Array.from({ length: count }, (_, i) =>
      imageRow({ imageKey: `IMG-${offset + i}`, sourceValue: `${offset + i}.jpg` })
    );

  function pagedFetcher(all: BulkSessionImage[]) {
    const calls: number[] = [];
    const fetchPage = (page: number, limit: number) => {
      calls.push(page);
      const data = all.slice((page - 1) * limit, page * limit);
      return Promise.resolve({
        data,
        total: all.length,
        page,
        limit,
        requiredTotal: all.length,
        requiredResolved: 0,
      });
    };
    return { fetchPage, calls };
  }

  it('한 페이지를 넘는 목록은 끝까지 돌아 전량을 모은다', async () => {
    const all = makeRows(IMAGE_PAGE_LIMIT * 2 + 500);
    const { fetchPage, calls } = pagedFetcher(all);
    const snapshot = await collectAllRequiredImages(fetchPage);
    expect(calls).toEqual([1, 2, 3]);
    expect(snapshot.rows).toHaveLength(all.length);
    expect(snapshot.rows[all.length - 1].imageKey).toBe(
      `IMG-${all.length - 1}`
    );
  });

  it('한 페이지로 끝나면 한 번만 부른다', async () => {
    const { fetchPage, calls } = pagedFetcher(makeRows(3));
    const snapshot = await collectAllRequiredImages(fetchPage);
    expect(calls).toEqual([1]);
    expect(snapshot.rows).toHaveLength(3);
  });

  it('빈 목록도 한 번만 부르고 끝난다', async () => {
    const { fetchPage, calls } = pagedFetcher([]);
    const snapshot = await collectAllRequiredImages(fetchPage);
    expect(calls).toEqual([1]);
    expect(snapshot.rows).toEqual([]);
  });

  it('요약 카운트는 마지막 응답의 것을 쓴다', async () => {
    let call = 0;
    const snapshot = await collectAllRequiredImages((page, limit) => {
      call += 1;
      return Promise.resolve({
        data: call === 1 ? makeRows(limit) : makeRows(1, limit),
        total: limit + 1,
        page,
        limit,
        requiredTotal: limit + 1,
        requiredResolved: call === 1 ? 0 : 7,
      });
    });
    expect(snapshot.requiredResolved).toBe(7);
  });

  it('서버가 빈 페이지를 돌려줘 전량을 못 채우면 조용히 넘기지 않고 던진다', async () => {
    await expect(
      collectAllRequiredImages((page, limit) =>
        Promise.resolve({
          data: page === 1 ? makeRows(limit) : [],
          total: limit + 100,
          page,
          limit,
          requiredTotal: limit + 100,
          requiredResolved: 0,
        })
      )
    ).rejects.toThrow('끝까지 불러오지 못했습니다');
  });
});

describe('chunkResolutions', () => {
  const entry = (i: number): ResolveImageEntry => ({
    imageKey: `IMG-${i}`,
    usage: 'main',
    fileId: `f${i}`,
  });

  it('기본 50개씩 자른다 — 서버 상한이다', () => {
    const chunks = chunkResolutions(
      Array.from({ length: 120 }, (_, i) => entry(i))
    );
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it('상한 이하면 한 덩어리다', () => {
    expect(chunkResolutions([entry(1)])).toEqual([[entry(1)]]);
  });

  it('빈 입력은 빈 배열이다 — 빈 요청을 보내면 400 이다', () => {
    expect(chunkResolutions([])).toEqual([]);
  });
});

describe('pairResolveResults', () => {
  const sent: ResolveImageEntry[] = [
    { imageKey: 'IMG-1', usage: 'main', fileId: 'f1' },
    { imageKey: 'IMG-1', usage: 'description', fileId: 'f2' },
  ];

  it('인덱스가 아니라 (imageKey, usage) 로 짝짓는다', () => {
    // 서버가 순서를 뒤집어 돌려줘도 올바르게 붙어야 한다.
    const results: ResolveImageResult[] = [
      {
        imageKey: 'IMG-1',
        usage: 'description',
        ok: false,
        error: '파일을 찾을 수 없습니다',
      },
      { imageKey: 'IMG-1', usage: 'main', ok: true, error: null },
    ];
    expect(pairResolveResults(sent, results)).toEqual([
      { imageKey: 'IMG-1', usage: 'main', ok: true, error: null },
      {
        imageKey: 'IMG-1',
        usage: 'description',
        ok: false,
        error: '파일을 찾을 수 없습니다',
      },
    ]);
  });

  it('응답이 요청보다 짧으면 빠진 항목을 실패로 본다', () => {
    const results: ResolveImageResult[] = [
      { imageKey: 'IMG-1', usage: 'main', ok: true, error: null },
    ];
    const paired = pairResolveResults(sent, results);
    expect(paired[1]).toEqual({
      imageKey: 'IMG-1',
      usage: 'description',
      ok: false,
      error: '서버가 이 항목의 결과를 돌려주지 않았습니다.',
    });
  });
});

describe('shouldContinuePurge', () => {
  it('남았고 이번에 진전이 있었으면 계속한다', () => {
    expect(shouldContinuePurge({ purged: 100, failed: 0, remaining: 40 })).toBe(
      true
    );
  });
  it('다 지웠으면 멈춘다', () => {
    expect(shouldContinuePurge({ purged: 40, failed: 0, remaining: 0 })).toBe(
      false
    );
  });
  it('남았는데 진전이 없으면 멈춘다 — 영구 실패 행 앞에서 무한 루프를 막는다', () => {
    expect(shouldContinuePurge({ purged: 0, failed: 3, remaining: 3 })).toBe(
      false
    );
  });
});

describe('canApprove', () => {
  it('review 이고 미결정이 0 이면 승인할 수 있다', () => {
    expect(canApprove('review', 0)).toBe(true);
  });
  it('미결정이 남았으면 못 한다', () => {
    expect(canApprove('review', 1)).toBe(false);
  });
  it('review 가 아니면 못 한다', () => {
    expect(canApprove('drafted', 0)).toBe(false);
  });
});
