import { versionsClient } from './versions.client';
import { client } from '../../client';

jest.mock('../../client', () => ({
  client: {
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
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

describe('versionsClient lifecycle actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(client.patch).mockResolvedValue({
      data: { message: 'Version published successfully' },
    });
    jest.mocked(client.delete).mockResolvedValue({
      data: { success: true, message: 'Draft version deleted successfully' },
    });
  });

  it('publishes a version through the Core lifecycle endpoint', async () => {
    await versionsClient.publish('master-1', 'version-1');

    expect(client.patch).toHaveBeenCalledWith(
      expect.stringContaining('/masters/master-1/versions/version-1/publish')
    );
  });

  it('deletes a draft version through the Core draft delete endpoint', async () => {
    await versionsClient.deleteDraft('master-1', 'version-1');

    expect(client.delete).toHaveBeenCalledWith(
      expect.stringContaining('/masters/master-1/versions/version-1')
    );
  });
});

describe('versionsClient.listMyDrafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(client.get).mockResolvedValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
    });
  });

  it('lists my drafts through the versions/my-drafts endpoint with query params', async () => {
    await versionsClient.listMyDrafts({ page: 2, q: '가방', sort: 'updatedAt', order: 'desc' });

    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('/versions/my-drafts'),
      { params: { page: 2, limit: undefined, q: '가방', sort: 'updatedAt', order: 'desc' } },
    );
  });
});
