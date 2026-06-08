import { versionsClient } from './versions.client';
import { client } from '../../client';

jest.mock('../../client', () => ({
  client: {
    put: jest.fn(),
  },
}));

jest.mock(
  '@/const',
  () => ({
    ALMONDYOUNG_API_BASE_URL: '/api',
  }),
  { virtual: true }
);

describe('versionsClient variant editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(client.put)
      .mockResolvedValue({ data: { variantId: 'variant-new', cowed: true } });
  });

  it('updates a draft variant through the version-scoped endpoint', async () => {
    await versionsClient.updateVariant('master-1', 'version-1', 'variant-1', {
      variantName: 'Edited',
      status: 'inactive',
      displayOrder: 2,
    });

    expect(client.put).toHaveBeenCalledWith(
      expect.stringContaining(
        '/masters/master-1/versions/version-1/variants/variant-1'
      ),
      {
        variantName: 'Edited',
        status: 'inactive',
        displayOrder: 2,
      }
    );
  });

  it('bulk updates draft variants through the version-scoped endpoint', async () => {
    await versionsClient.bulkUpdateVariants('master-1', 'version-1', {
      updates: [
        { id: 'variant-1', status: 'inactive' },
        { id: 'variant-2', status: 'inactive' },
      ],
    });

    expect(client.put).toHaveBeenCalledWith(
      expect.stringContaining(
        '/masters/master-1/versions/version-1/variants/bulk'
      ),
      {
        updates: [
          { id: 'variant-1', status: 'inactive' },
          { id: 'variant-2', status: 'inactive' },
        ],
      }
    );
  });
});
