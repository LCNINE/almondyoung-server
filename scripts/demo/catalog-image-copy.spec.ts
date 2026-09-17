import {
  applyCatalogImagePlan,
  assertDemoImageTarget,
  assertLiveImageSource,
  classifyCatalogImageReferences,
  normalizeDatabaseTimestamp,
  planCatalogImages,
  S3CatalogImageObjectStore,
  type CatalogImageObjectStore,
  type CatalogImageTarget,
  type ImageUploadRow,
  type ObjectFingerprint,
} from './catalog-image-copy';

const ACTOR = '019f1010-0001-7000-a000-000000000001';
const FILE_A = '11111111-1111-4111-8111-111111111111';
const FILE_B = '22222222-2222-4222-8222-222222222222';
const FILE_C = '33333333-3333-4333-8333-333333333333';

function upload(id: string, overrides: Partial<ImageUploadRow> = {}): ImageUploadRow {
  return {
    id,
    file_name: `${id}.webp`,
    original_name: '상품.webp',
    mime_type: 'image/webp',
    size: 1234,
    file_path: `products/images/2026/09/${id}.webp`,
    storage_provider: 's3',
    status: 'active',
    context_id: 'product-image',
    metadata: { width: 800, height: 800, privateNote: 'discard me' },
    is_public: true,
    created_at: '2026-09-01T00:00:00.000',
    updated_at: '2026-09-01T00:00:00.000',
    deleted_at: null,
    activated_at: '2026-09-01T00:00:01.000',
    ...overrides,
  };
}

class MemoryObjectStore implements CatalogImageObjectStore {
  readonly objects = new Map<string, ObjectFingerprint>();
  readonly copies: string[] = [];

  constructor(entries: Array<[string, ObjectFingerprint]>) {
    this.objects = new Map(entries);
  }

  head(bucket: string, key: string): Promise<ObjectFingerprint | null> {
    return Promise.resolve(this.objects.get(`${bucket}/${key}`) ?? null);
  }

  copy(sourceBucket: string, targetBucket: string, key: string): Promise<ObjectFingerprint> {
    const source = this.objects.get(`${sourceBucket}/${key}`);
    if (!source) return Promise.reject(new Error(`source object missing: ${key}`));
    this.objects.set(`${targetBucket}/${key}`, source);
    this.copies.push(key);
    return Promise.resolve(source);
  }
}

class MemoryTarget implements CatalogImageTarget {
  readonly rows = new Map<string, ImageUploadRow>();

  constructor(rows: ImageUploadRow[] = []) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  read(ids: string[]): Promise<ImageUploadRow[]> {
    return Promise.resolve(ids.flatMap((id) => (this.rows.has(id) ? [this.rows.get(id)!] : [])));
  }

  insertVerified(rows: ImageUploadRow[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const current = this.rows.get(row.id);
      if (current && JSON.stringify(current) !== JSON.stringify(row))
        throw new Error(`target upload collision: ${row.id}`);
      if (!current) {
        this.rows.set(row.id, row);
        inserted += 1;
      }
    }
    return Promise.resolve(inserted);
  }
}

describe('catalog product image copy planning', () => {
  it('preserves PostgreSQL timestamp-without-time-zone wall clock fields', () => {
    const databaseTimestamp = new Date(2026, 8, 1, 14, 15, 16, 123);

    expect(normalizeDatabaseTimestamp(databaseTimestamp)).toBe('2026-09-01T14:15:16.123');
    expect(normalizeDatabaseTimestamp('2026-09-01 14:15:16.123456')).toBe('2026-09-01T14:15:16.123');
  });

  it('separates active physical display images from historical or deleted product versions', () => {
    const coverage = classifyCatalogImageReferences([
      {
        fileId: FILE_A,
        versionStatus: 'active',
        fulfillmentKind: 'physical',
        versionDeleted: false,
        masterDeleted: false,
      },
      {
        fileId: FILE_A,
        versionStatus: 'inactive',
        fulfillmentKind: 'physical',
        versionDeleted: false,
        masterDeleted: false,
      },
      {
        fileId: FILE_B,
        versionStatus: 'active',
        fulfillmentKind: 'physical',
        versionDeleted: true,
        masterDeleted: false,
      },
      {
        fileId: FILE_C,
        versionStatus: 'active',
        fulfillmentKind: 'digital',
        versionDeleted: false,
        masterDeleted: false,
      },
    ]);

    expect(coverage.requiredReferences).toEqual([{ fileId: FILE_A, references: 1 }]);
    expect(coverage.allReferenceRows).toBe(4);
    expect(coverage.allDistinctReferences).toBe(3);
    expect(coverage.excludedRows).toBe(3);
    expect(coverage.excludedOnlyFileIds).toEqual([FILE_B, FILE_C]);
    expect(coverage.exclusionReasonCounts).toEqual({
      'deleted-version': 1,
      'non-active-version': 1,
      'non-physical-version': 1,
    });
  });

  it('copies only referenced public active product-image rows and replaces the uploader', () => {
    const plan = planCatalogImages(
      [
        { fileId: FILE_A, references: 2 },
        { fileId: FILE_B, references: 1 },
        { fileId: FILE_C, references: 3 },
      ],
      [upload(FILE_A), upload(FILE_B, { is_public: false })],
      {
        sourcePublicBucket: 'live-public',
        targetPublicBucket: 'demo-public',
        region: 'ap-northeast-2',
        actorId: ACTOR,
      },
    );

    expect(plan.referenceRows).toBe(6);
    expect(plan.distinctReferences).toBe(3);
    expect(plan.missingUploadIds).toEqual([FILE_C]);
    expect(plan.rejectedUploads).toEqual([{ fileId: FILE_B, references: 1, reasons: ['not-public'] }]);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].targetRow).toEqual({
      ...upload(FILE_A),
      metadata: { width: 800, height: 800 },
      uploaded_by: ACTOR,
      url: `https://demo-public.s3.ap-northeast-2.amazonaws.com/products/images/2026/09/${FILE_A}.webp`,
    });
    expect(plan.images[0].targetRow).not.toHaveProperty('privateNote');
  });

  it('accepts a public active product-description-image used by product_images', () => {
    const plan = planCatalogImages(
      [{ fileId: FILE_A, references: 1 }],
      [
        upload(FILE_A, {
          context_id: 'product-description-image',
          file_path: `products/description-image/2026/09/${FILE_A}.png`,
          mime_type: 'image/png',
          size: 15_000_000,
        }),
      ],
      {
        sourcePublicBucket: 'live-public',
        targetPublicBucket: 'demo-public',
        region: 'ap-northeast-2',
        actorId: ACTOR,
      },
    );

    expect(plan.rejectedUploads).toEqual([]);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].targetRow.context_id).toBe('product-description-image');
  });

  it('accepts a legacy public active GIF in the product-image context', () => {
    const plan = planCatalogImages(
      [{ fileId: FILE_A, references: 1 }],
      [
        upload(FILE_A, {
          file_name: `${FILE_A}.gif`,
          original_name: '상품.gif',
          file_path: `products/images/2026/09/${FILE_A}.gif`,
          mime_type: 'image/gif',
        }),
      ],
      {
        sourcePublicBucket: 'live-public',
        targetPublicBucket: 'demo-public',
        region: 'ap-northeast-2',
        actorId: ACTOR,
      },
    );

    expect(plan.rejectedUploads).toEqual([]);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].targetRow.mime_type).toBe('image/gif');
  });

  it.each([
    ['wrong context', { context_id: 'receipt' }, 'wrong-context'],
    ['inactive upload', { status: 'pending' }, 'not-active'],
    ['deleted upload', { deleted_at: '2026-09-02T00:00:00.000Z' }, 'deleted'],
    ['private upload', { is_public: false }, 'not-public'],
    ['non-S3 upload', { storage_provider: 'local' }, 'not-s3'],
    ['unsafe object path', { file_path: 'products/images/../receipts/private.pdf' }, 'unsafe-object-key'],
    ['wrong MIME', { mime_type: 'application/pdf' }, 'wrong-mime'],
    ['oversized object', { size: 10_485_761 }, 'invalid-size'],
  ])('rejects a referenced %s instead of copying it', (_label, overrides, reason) => {
    const plan = planCatalogImages([{ fileId: FILE_A, references: 1 }], [upload(FILE_A, overrides)], {
      sourcePublicBucket: 'live-public',
      targetPublicBucket: 'demo-public',
      region: 'ap-northeast-2',
      actorId: ACTOR,
    });

    expect(plan.images).toEqual([]);
    expect(plan.rejectedUploads).toEqual([{ fileId: FILE_A, references: 1, reasons: [reason] }]);
  });
});

describe('catalog product image database guards', () => {
  const identity = { database: 'files', host: '10.0.0.4', port: 5432 };

  it('requires the live file query to be a server-confirmed read-only transaction', () => {
    expect(() =>
      assertLiveImageSource({ ...identity, stage: 'live', readOnly: false }, { stage: 'live', expected: identity }),
    ).toThrow(/read-only/i);
    expect(() =>
      assertLiveImageSource({ ...identity, stage: 'demo', readOnly: true }, { stage: 'live', expected: identity }),
    ).toThrow(/live/i);
  });

  it('requires the exact demo database binding and both active public-only product image contexts', () => {
    expect(() => assertDemoImageTarget({ ...identity, contextRows: 1 }, { stage: 'live', expected: identity })).toThrow(
      /demo/i,
    );
    expect(() => assertDemoImageTarget({ ...identity, contextRows: 1 }, { stage: 'demo', expected: identity })).toThrow(
      /context/i,
    );
    expect(() =>
      assertDemoImageTarget(
        { database: 'live_files', host: identity.host, port: identity.port, contextRows: 2 },
        { stage: 'demo', expected: identity },
      ),
    ).toThrow(/binding/i);
    expect(() =>
      assertDemoImageTarget({ ...identity, contextRows: 2 }, { stage: 'demo', expected: identity }),
    ).not.toThrow();
  });
});

describe('catalog product image copy apply', () => {
  const fingerprint = { contentLength: 1234, etag: '"source-etag"', checksumSha256: 'checksum' };
  const makePlan = () =>
    planCatalogImages([{ fileId: FILE_A, references: 1 }], [upload(FILE_A)], {
      sourcePublicBucket: 'live-public',
      targetPublicBucket: 'demo-public',
      region: 'ap-northeast-2',
      actorId: ACTOR,
    });

  it('copies a missing object before inserting its allowlisted demo upload row', async () => {
    const plan = makePlan();
    const store = new MemoryObjectStore([[`live-public/${plan.images[0].objectKey}`, fingerprint]]);
    const target = new MemoryTarget();

    const result = await applyCatalogImagePlan(plan, { objectStore: store, target, concurrency: 2 });

    expect(result).toEqual({ copiedObjects: 1, reusedObjects: 0, insertedRows: 1, reusedRows: 0 });
    expect(store.objects.get(`demo-public/${plan.images[0].objectKey}`)).toEqual(fingerprint);
    expect(target.rows.get(FILE_A)).toEqual(plan.images[0].targetRow);
  });

  it('copies eligible public images while leaving unavailable references in the coverage report', async () => {
    const plan = planCatalogImages(
      [
        { fileId: FILE_A, references: 1 },
        { fileId: FILE_B, references: 1 },
        { fileId: FILE_C, references: 1 },
      ],
      [upload(FILE_A), upload(FILE_B, { is_public: false })],
      {
        sourcePublicBucket: 'live-public',
        targetPublicBucket: 'demo-public',
        region: 'ap-northeast-2',
        actorId: ACTOR,
      },
    );
    const store = new MemoryObjectStore([[`live-public/${plan.images[0].objectKey}`, fingerprint]]);
    const target = new MemoryTarget();

    const result = await applyCatalogImagePlan(plan, { objectStore: store, target, concurrency: 2 });

    expect(result).toEqual({ copiedObjects: 1, reusedObjects: 0, insertedRows: 1, reusedRows: 0 });
    expect(plan.missingUploadIds).toEqual([FILE_C]);
    expect(plan.rejectedUploads).toEqual([{ fileId: FILE_B, references: 1, reasons: ['not-public'] }]);
  });

  it('replays without copying or inserting when the target object and row already match', async () => {
    const plan = makePlan();
    const key = plan.images[0].objectKey;
    const store = new MemoryObjectStore([
      [`live-public/${key}`, fingerprint],
      [`demo-public/${key}`, fingerprint],
    ]);
    const target = new MemoryTarget([plan.images[0].targetRow]);

    const result = await applyCatalogImagePlan(plan, { objectStore: store, target, concurrency: 2 });

    expect(result).toEqual({ copiedObjects: 0, reusedObjects: 1, insertedRows: 0, reusedRows: 1 });
    expect(store.copies).toEqual([]);
  });

  it('stops before object writes when an existing demo upload row conflicts', async () => {
    const plan = makePlan();
    const key = plan.images[0].objectKey;
    const store = new MemoryObjectStore([[`live-public/${key}`, fingerprint]]);
    const target = new MemoryTarget([upload(FILE_A, { file_path: 'products/images/other.webp' })]);

    await expect(applyCatalogImagePlan(plan, { objectStore: store, target, concurrency: 2 })).rejects.toThrow(
      /target upload collision/,
    );
    expect(store.copies).toEqual([]);
  });

  it('stops before object writes when an existing demo object has different content', async () => {
    const plan = makePlan();
    const key = plan.images[0].objectKey;
    const store = new MemoryObjectStore([
      [`live-public/${key}`, fingerprint],
      [`demo-public/${key}`, { contentLength: 1234, etag: '"different"', checksumSha256: 'different' }],
    ]);
    const target = new MemoryTarget();

    await expect(applyCatalogImagePlan(plan, { objectStore: store, target, concurrency: 2 })).rejects.toThrow(
      /target object collision/,
    );
    expect(store.copies).toEqual([]);
    expect(target.rows.size).toBe(0);
  });
});

describe('S3 product image boundary', () => {
  it('copies a public object with an encoded source and verifies the destination head', async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const client = {
      send(command: { input: Record<string, unknown> }) {
        inputs.push(command.input);
        if ('CopySource' in command.input) return Promise.resolve({ ETag: '"etag"' });
        return Promise.resolve({ ContentLength: 321, ETag: '"etag"', ChecksumSHA256: 'checksum' });
      },
    };
    const store = new S3CatalogImageObjectStore(client);

    const result = await store.copy('live-public', 'demo-public', 'products/images/한 글.webp');

    expect(inputs).toEqual([
      {
        Bucket: 'demo-public',
        Key: 'products/images/한 글.webp',
        CopySource: 'live-public/products/images/%ED%95%9C%20%EA%B8%80.webp',
        MetadataDirective: 'COPY',
      },
      { Bucket: 'demo-public', Key: 'products/images/한 글.webp', ChecksumMode: 'ENABLED' },
    ]);
    expect(result).toEqual({ contentLength: 321, etag: '"etag"', checksumSha256: 'checksum' });
  });

  it('returns null only for an S3 not-found response', async () => {
    const store = new S3CatalogImageObjectStore({
      send() {
        return Promise.reject(
          Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
        );
      },
    });

    await expect(store.head('bucket', 'products/images/missing.webp')).resolves.toBeNull();
  });
});
