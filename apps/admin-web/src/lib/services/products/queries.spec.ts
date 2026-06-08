import { useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { useVersionDetailSuspense } from './queries';

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
