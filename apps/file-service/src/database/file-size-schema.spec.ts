import { getTableColumns } from 'drizzle-orm';
import {
  DIGITAL_ASSET_FILE_CONTEXT_ID,
  DIGITAL_ASSET_FILE_MAX_SIZE_BYTES,
  FILE_CONTEXTS,
  fileContextMatchesSeed,
} from './default-file-contexts';
import { fileContexts, uploads } from './schema';

describe('file-service size schema and seed data', () => {
  it('stores upload and max file sizes in bigint columns', () => {
    expect(getTableColumns(fileContexts).maxFileSize.getSQLType()).toBe('bigint');
    expect(getTableColumns(uploads).size.getSQLType()).toBe('bigint');
  });

  it('defines the private digital asset file context with a 10GB limit', () => {
    const context = FILE_CONTEXTS.find((ctx) => ctx.id === DIGITAL_ASSET_FILE_CONTEXT_ID);

    expect(context).toMatchObject({
      id: 'digital-asset-file',
      allowPublic: false,
      allowPrivate: true,
      allowedMimeTypes: [],
      maxFileSize: DIGITAL_ASSET_FILE_MAX_SIZE_BYTES,
      pathPrefix: 'library/digital-assets',
      isActive: true,
    });
    expect(DIGITAL_ASSET_FILE_MAX_SIZE_BYTES).toBe(10 * 1024 * 1024 * 1024);
    expect(DIGITAL_ASSET_FILE_MAX_SIZE_BYTES).toBeGreaterThan(2_147_483_647);
  });

  it('treats the digital asset file context as seeded when bigint values come back as strings', () => {
    const context = FILE_CONTEXTS.find((ctx) => ctx.id === DIGITAL_ASSET_FILE_CONTEXT_ID)!;

    expect(
      fileContextMatchesSeed(
        {
          id: DIGITAL_ASSET_FILE_CONTEXT_ID,
          allow_public: false,
          allow_private: true,
          allowed_mime_types: '[]',
          max_file_size: String(DIGITAL_ASSET_FILE_MAX_SIZE_BYTES),
          path_prefix: 'library/digital-assets',
          is_active: true,
        },
        context,
      ),
    ).toBe(true);
  });
});
