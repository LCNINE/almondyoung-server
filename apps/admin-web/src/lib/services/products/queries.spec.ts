import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { useImportProgress, useVersionDetailSuspense } from './queries';
import type { ImportJobStatus, ImportProgressDto } from '@/lib/types/dto/product-import';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useSuspenseQuery: jest.fn(() => ({ data: null })),
}));

jest.mock(
  '@/lib/api/domains',
  () => ({
    products: {
      versions: {
        getById: jest.fn(),
      },
      productImport: {
        getProgress: jest.fn(),
      },
    },
  }),
  { virtual: true }
);

jest.mock(
  '@/lib/api/domains/products/channel-listings.client',
  () => ({
    channelListingsClient: {},
  }),
  { virtual: true }
);

jest.mock(
  '@/lib/api/domains/products/channel-categories.client',
  () => ({
    channelCategoriesClient: {},
  }),
  { virtual: true }
);

describe('product queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores raw version detail suspense data under the raw DTO cache key', () => {
    useVersionDetailSuspense('master-1', 'version-1');

    expect(useSuspenseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: productQueryKeys.versionDetailRaw('master-1', 'version-1'),
      })
    );
  });
});

describe('useImportProgress refetchInterval', () => {
  // 회귀 재발 방지: retry: false + isProgressRunning(undefined) === false 조합이면
  // 첫 요청 실패 이후 data 가 영영 undefined 로 남아 인터벌이 걸리지 않는다(화면이
  // 마운트 동안 영구히 얼어붙음). data 가 없는 동안은 계속 두드려야 롤링 배포 창이
  // 끝나는 순간 스스로 살아난다.
  function lastRefetchInterval(): (query: { state: { data: ImportProgressDto | undefined } }) => number | false {
    const options = (useQuery as jest.Mock).mock.calls.at(-1)?.[0];
    return options.refetchInterval;
  }

  const stage = (status: ImportJobStatus): ImportProgressDto['stages'][number] => ({
    key: 'commit',
    label: '상품 생성',
    status,
    done: 0,
    total: 0,
    failed: 0,
    error: null,
  });

  it('data 가 아직 없으면(초기 로드 · 404 · 일시적 5xx) 2000ms 로 계속 두드린다', () => {
    useImportProgress('s1');

    expect(lastRefetchInterval()({ state: { data: undefined } })).toBe(2000);
  });

  it('진행 중인 단계가 있으면 2000ms 로 폴링을 유지한다', () => {
    useImportProgress('s1');

    const running: ImportProgressDto = {
      sessionId: 's1',
      fileName: 'f.xlsx',
      canceled: false,
      cancelRequestedAt: null,
      totalRows: 10,
      invalidCount: 0,
      stages: [stage('running')],
    };
    expect(lastRefetchInterval()({ state: { data: running } })).toBe(2000);
  });

  it('모든 단계가 종료 상태면 폴링을 멈춘다', () => {
    useImportProgress('s1');

    const done: ImportProgressDto = {
      sessionId: 's1',
      fileName: 'f.xlsx',
      canceled: false,
      cancelRequestedAt: null,
      totalRows: 10,
      invalidCount: 0,
      stages: [stage('completed'), stage('canceled')],
    };
    expect(lastRefetchInterval()({ state: { data: done } })).toBe(false);
  });
});
