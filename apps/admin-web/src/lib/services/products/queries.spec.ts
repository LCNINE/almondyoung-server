import { useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { useVersionDetailSuspense } from './queries';

// admin-web 의존성은 apps/admin-web/node_modules 에 있고 그건 루트 jest 의
// modulePathIgnorePatterns 로 무시된다. 이 파일의 다른 mock 들처럼 virtual 로
// 등록해야 해석 단계에서 안 터진다.
jest.mock(
  '@tanstack/react-query',
  () => ({
    useQuery: jest.fn(),
    useSuspenseQuery: jest.fn(() => ({ data: null })),
  }),
  { virtual: true }
);

jest.mock(
  '@/lib/api/domains',
  () => ({
    products: {
      versions: {
        getById: jest.fn(),
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
