import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CopyObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import postgres, { type JSONValue, type Sql } from 'postgres';

const IMAGE_CONTEXT_POLICIES = {
  'product-image': {
    prefix: 'products/images/',
    maxBytes: 10_485_760,
    // GIF is intentionally limited to already active, public legacy rows. This tool does not change upload policy.
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  },
  'product-description-image': {
    prefix: 'products/description-image/',
    maxBytes: 20_971_520,
    mimeTypes: new Set(['image/jpeg', 'image/png']),
  },
} as const;
type ImageContextId = keyof typeof IMAGE_CONTEXT_POLICIES;
const IMAGE_CONTEXT_IDS = Object.keys(IMAGE_CONTEXT_POLICIES) as ImageContextId[];
const TECHNICAL_METADATA_KEYS = new Set(['width', 'height', 'duration', 'pages']);

export interface DatabaseIdentity {
  database: string;
  host: string;
  port: number;
}

function assertExactIdentity(actual: DatabaseIdentity, expected: DatabaseIdentity, label: string): void {
  if (
    actual.database !== expected.database ||
    actual.host !== expected.host ||
    Number(actual.port) !== Number(expected.port)
  ) {
    throw new Error(
      `${label} binding mismatch (expected ${expected.host}:${expected.port}/${expected.database}, ` +
        `received ${actual.host}:${actual.port}/${actual.database})`,
    );
  }
}

export function assertLiveImageSource(
  actual: DatabaseIdentity & { stage: string; readOnly: boolean },
  options: { stage: string; expected: DatabaseIdentity },
): void {
  if (options.stage !== 'live' || actual.stage !== 'live') throw new Error('Image source stage must be live');
  if (!actual.readOnly) throw new Error('Image source transaction must be read-only');
  assertExactIdentity(actual, options.expected, 'Image source');
}

export function assertDemoImageTarget(
  actual: DatabaseIdentity & { contextRows: number },
  options: { stage: string; expected: DatabaseIdentity },
): void {
  if (options.stage !== 'demo') throw new Error('Image target stage must be demo');
  assertExactIdentity(actual, options.expected, 'Image target');
  if (Number(actual.contextRows) !== IMAGE_CONTEXT_IDS.length) {
    throw new Error(
      `Demo product image context markers are invalid (expected ${IMAGE_CONTEXT_IDS.length}, received ${actual.contextRows})`,
    );
  }
}

export interface CatalogImageReference {
  fileId: string;
  references: number;
}

export interface ProductImageReferenceFact {
  fileId: string;
  versionStatus: string;
  fulfillmentKind: string;
  versionDeleted: boolean;
  masterDeleted: boolean;
}

export interface CatalogImageReferenceCoverage {
  requiredReferences: CatalogImageReference[];
  allReferenceRows: number;
  allDistinctReferences: number;
  excludedRows: number;
  excludedOnlyFileIds: string[];
  exclusionReasonCounts: Record<string, number>;
}

export function classifyCatalogImageReferences(facts: ProductImageReferenceFact[]): CatalogImageReferenceCoverage {
  const required = new Map<string, number>();
  const all = new Set<string>();
  const excludedIds = new Set<string>();
  const exclusionReasonCounts: Record<string, number> = {};

  for (const fact of facts) {
    all.add(fact.fileId);
    let reason: string | null = null;
    if (fact.masterDeleted) reason = 'deleted-master';
    else if (fact.versionDeleted) reason = 'deleted-version';
    else if (fact.versionStatus !== 'active') reason = 'non-active-version';
    else if (fact.fulfillmentKind !== 'physical') reason = 'non-physical-version';
    if (reason) {
      excludedIds.add(fact.fileId);
      exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] ?? 0) + 1;
    } else {
      required.set(fact.fileId, (required.get(fact.fileId) ?? 0) + 1);
    }
  }

  return {
    requiredReferences: [...required]
      .map(([fileId, references]) => ({ fileId, references }))
      .sort((left, right) => left.fileId.localeCompare(right.fileId)),
    allReferenceRows: facts.length,
    allDistinctReferences: all.size,
    excludedRows: facts.length - [...required.values()].reduce((sum, count) => sum + count, 0),
    excludedOnlyFileIds: [...excludedIds].filter((fileId) => !required.has(fileId)).sort(),
    exclusionReasonCounts: Object.fromEntries(Object.entries(exclusionReasonCounts).sort()),
  };
}

export interface ImageUploadRow {
  id: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  size: number;
  file_path: string;
  url?: string;
  storage_provider: string;
  status: string;
  context_id: string;
  metadata: Record<string, unknown> | null;
  uploaded_by?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  activated_at: string | null;
}

export interface PlannedCatalogImage {
  fileId: string;
  references: number;
  objectKey: string;
  sourcePublicBucket: string;
  targetPublicBucket: string;
  targetRow: ImageUploadRow;
}

export interface CatalogImagePlan {
  referenceRows: number;
  distinctReferences: number;
  referenceCounts: CatalogImageReference[];
  missingUploadIds: string[];
  rejectedUploads: Array<{ fileId: string; references: number; reasons: string[] }>;
  images: PlannedCatalogImage[];
  planSha256: string;
}

export interface ObjectFingerprint {
  contentLength: number;
  etag?: string;
  checksumSha256?: string;
}

export interface CatalogImageObjectStore {
  head(bucket: string, key: string): Promise<ObjectFingerprint | null>;
  copy(sourceBucket: string, targetBucket: string, key: string): Promise<ObjectFingerprint>;
}

interface S3CommandClient {
  send(command: { input: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

export class S3CatalogImageObjectStore implements CatalogImageObjectStore {
  constructor(private readonly client: S3CommandClient) {}

  async head(bucket: string, key: string): Promise<ObjectFingerprint | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }) as unknown as {
          input: Record<string, unknown>;
        },
      );
      return {
        contentLength: Number(result.ContentLength),
        ...(typeof result.ETag === 'string' ? { etag: result.ETag } : {}),
        ...(typeof result.ChecksumSHA256 === 'string' ? { checksumSha256: result.ChecksumSHA256 } : {}),
      };
    } catch (error) {
      const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async copy(sourceBucket: string, targetBucket: string, key: string): Promise<ObjectFingerprint> {
    const copySource = encodeURIComponent(`${sourceBucket}/${key}`).replace(/%2F/gi, '/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: targetBucket,
        Key: key,
        CopySource: copySource,
        MetadataDirective: 'COPY',
      }) as unknown as { input: Record<string, unknown> },
    );
    const copied = await this.head(targetBucket, key);
    if (!copied) throw new Error(`Copied object is missing after CopyObject: ${key}`);
    return copied;
  }
}

export interface CatalogImageTarget {
  read(ids: string[]): Promise<ImageUploadRow[]>;
  insertVerified(rows: ImageUploadRow[]): Promise<number>;
}

function cleanMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([key, value]) => TECHNICAL_METADATA_KEYS.has(key) && value != null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function padTimestampPart(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function normalizeDatabaseTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const naive = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
    if (naive) {
      return `${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6]}.${(naive[7] ?? '').padEnd(3, '0').slice(0, 3)}`;
    }
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid upload timestamp: ${String(value)}`);
  return (
    `${padTimestampPart(date.getFullYear(), 4)}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())}` +
    `T${padTimestampPart(date.getHours())}:${padTimestampPart(date.getMinutes())}:${padTimestampPart(date.getSeconds())}.` +
    padTimestampPart(date.getMilliseconds(), 3)
  );
}

function normalizeNullableDatabaseTimestamp(value: unknown): string | null {
  return value == null ? null : normalizeDatabaseTimestamp(value);
}

function optionalDatabaseString(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid upload ${label}`);
  return value;
}

function safeObjectKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix) || key.startsWith('/') || key.includes('\\')) return false;
  const parts = key.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function publicObjectUrl(bucket: string, region: string, key: string): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

function rejectionReasons(upload: ImageUploadRow): string[] {
  const reasons: string[] = [];
  const policy = IMAGE_CONTEXT_POLICIES[upload.context_id as ImageContextId];
  if (!policy) reasons.push('wrong-context');
  if (upload.status !== 'active') reasons.push('not-active');
  if (upload.deleted_at != null) reasons.push('deleted');
  if (!upload.is_public) reasons.push('not-public');
  if (upload.storage_provider !== 's3') reasons.push('not-s3');
  if (policy && !safeObjectKey(upload.file_path, policy.prefix)) reasons.push('unsafe-object-key');
  if (policy && !(policy.mimeTypes as ReadonlySet<string>).has(upload.mime_type)) reasons.push('wrong-mime');
  if (
    policy &&
    (!Number.isSafeInteger(Number(upload.size)) || Number(upload.size) < 1 || Number(upload.size) > policy.maxBytes)
  ) {
    reasons.push('invalid-size');
  }
  return reasons;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function planCatalogImages(
  references: CatalogImageReference[],
  uploads: ImageUploadRow[],
  options: {
    sourcePublicBucket: string;
    targetPublicBucket: string;
    region: string;
    actorId: string;
  },
): CatalogImagePlan {
  if (!options.sourcePublicBucket || !options.targetPublicBucket || !options.region) {
    throw new Error('Source bucket, target bucket, and AWS region are required');
  }
  if (options.sourcePublicBucket === options.targetPublicBucket) {
    throw new Error('Source and target public buckets must differ');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.actorId)) {
    throw new Error('Demo upload actor must be a UUID');
  }

  const orderedReferences = [...references].sort((left, right) => left.fileId.localeCompare(right.fileId));
  const uploadsById = new Map(uploads.map((upload) => [upload.id, upload]));
  const missingUploadIds: string[] = [];
  const rejectedUploads: CatalogImagePlan['rejectedUploads'] = [];
  const images: PlannedCatalogImage[] = [];

  for (const reference of orderedReferences) {
    const upload = uploadsById.get(reference.fileId);
    if (!upload) {
      missingUploadIds.push(reference.fileId);
      continue;
    }
    const reasons = rejectionReasons(upload);
    if (reasons.length) {
      rejectedUploads.push({ fileId: reference.fileId, references: reference.references, reasons });
      continue;
    }
    const targetRow: ImageUploadRow = {
      ...upload,
      metadata: cleanMetadata(upload.metadata),
      uploaded_by: options.actorId,
      is_public: true,
      status: 'active',
      deleted_at: null,
      url: publicObjectUrl(options.targetPublicBucket, options.region, upload.file_path),
    };
    images.push({
      fileId: reference.fileId,
      references: reference.references,
      objectKey: upload.file_path,
      sourcePublicBucket: options.sourcePublicBucket,
      targetPublicBucket: options.targetPublicBucket,
      targetRow,
    });
  }

  const hashInput = images.map(({ fileId, references, objectKey, targetRow }) => ({
    fileId,
    references,
    objectKey,
    targetRow,
  }));
  return {
    referenceRows: orderedReferences.reduce((sum, row) => sum + row.references, 0),
    distinctReferences: orderedReferences.length,
    referenceCounts: orderedReferences,
    missingUploadIds,
    rejectedUploads,
    images,
    planSha256: createHash('sha256').update(stableJson(hashInput)).digest('hex'),
  };
}

function rowComparable(row: ImageUploadRow): unknown {
  return {
    id: row.id,
    file_name: row.file_name,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size: Number(row.size),
    file_path: row.file_path,
    url: row.url,
    storage_provider: row.storage_provider,
    status: row.status,
    context_id: row.context_id,
    metadata: cleanMetadata(row.metadata),
    uploaded_by: row.uploaded_by,
    is_public: row.is_public,
    created_at: normalizeDatabaseTimestamp(row.created_at),
    updated_at: normalizeDatabaseTimestamp(row.updated_at),
    deleted_at: normalizeNullableDatabaseTimestamp(row.deleted_at),
    activated_at: normalizeNullableDatabaseTimestamp(row.activated_at),
  };
}

function rowsMatch(left: ImageUploadRow, right: ImageUploadRow): boolean {
  return stableJson(rowComparable(left)) === stableJson(rowComparable(right));
}

function fingerprintsMatch(left: ObjectFingerprint, right: ObjectFingerprint): boolean {
  if (left.contentLength !== right.contentLength) return false;
  if (left.checksumSha256 && right.checksumSha256) return left.checksumSha256 === right.checksumSha256;
  return Boolean(left.etag && right.etag && left.etag === right.etag);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error('Concurrency must be an integer between 1 and 64');
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

export async function applyCatalogImagePlan(
  plan: CatalogImagePlan,
  dependencies: { objectStore: CatalogImageObjectStore; target: CatalogImageTarget; concurrency: number },
): Promise<{ copiedObjects: number; reusedObjects: number; insertedRows: number; reusedRows: number }> {
  const ids = plan.images.map((image) => image.fileId);
  const expectedRows = new Map(plan.images.map((image) => [image.fileId, image.targetRow]));
  const existingRows = await dependencies.target.read(ids);
  for (const current of existingRows) {
    const expected = expectedRows.get(current.id);
    if (!expected || !rowsMatch(current, expected)) throw new Error(`target upload collision: ${current.id}`);
  }

  const objectStates = await mapWithConcurrency(plan.images, dependencies.concurrency, async (image) => {
    const [source, target] = await Promise.all([
      dependencies.objectStore.head(image.sourcePublicBucket, image.objectKey),
      dependencies.objectStore.head(image.targetPublicBucket, image.objectKey),
    ]);
    if (!source) throw new Error(`source object missing: ${image.fileId}`);
    if (target && !fingerprintsMatch(source, target)) throw new Error(`target object collision: ${image.fileId}`);
    return { image, source, target };
  });

  const copies = objectStates.filter((state) => !state.target);
  await mapWithConcurrency(copies, dependencies.concurrency, async ({ image, source }) => {
    const copied = await dependencies.objectStore.copy(
      image.sourcePublicBucket,
      image.targetPublicBucket,
      image.objectKey,
    );
    if (!fingerprintsMatch(source, copied)) throw new Error(`copied object verification failed: ${image.fileId}`);
  });

  const insertedRows = await dependencies.target.insertVerified(plan.images.map((image) => image.targetRow));
  return {
    copiedObjects: copies.length,
    reusedObjects: plan.images.length - copies.length,
    insertedRows,
    reusedRows: plan.images.length - insertedRows,
  };
}

const DEMO_IMAGE_ACTOR_ID = '019f1010-0001-7000-a000-000000000001';
const DEFAULT_QUERY_BATCH = 10_000;

interface CoreConnectionFile {
  live: { stage: string; url: string };
  demo: { stage: string; url: string };
}

interface FileConnectionFile {
  live: { url: string; publicBucket: string; privateBucket: string };
  demo: { url: string; publicBucket: string; privateBucket: string };
}

interface CatalogImageCliOptions {
  apply: boolean;
  connections?: string;
  fileConnections?: string;
  report?: string;
  region?: string;
  maxFiles?: number;
  concurrency: number;
  expectedLiveCoreDatabase?: string;
  expectedLiveFileDatabase?: string;
  expectedDemoFileDatabase?: string;
  expectedLiveServerHost?: string;
  expectedDemoServerHost?: string;
  expectedServerPort?: number;
}

interface CatalogImageReport {
  status: 'ready' | 'ready-with-gaps' | 'applied' | 'applied-with-gaps';
  mode: 'check' | 'apply';
  source: {
    core: DatabaseIdentity;
    files: DatabaseIdentity;
    allReferenceRows: number;
    allDistinctReferences: number;
    requiredReferenceRows: number;
    requiredDistinctReferences: number;
    excludedHistoricalRows: number;
    excludedOnlyFileIds: string[];
    exclusionReasonCounts: Record<string, number>;
    eligibleUploads: number;
    referenceCounts: CatalogImageReference[];
    missingUploadIds: string[];
    rejectedUploads: CatalogImagePlan['rejectedUploads'];
    planSha256: string;
  };
  target: {
    files: DatabaseIdentity;
    uploadsBefore: number;
    matchingReferencedRowsBefore: number;
    missingReferencedRowsBefore: number;
  };
  result: {
    copiedObjects: number;
    reusedObjects: number;
    insertedRows: number;
    reusedRows: number;
  } | null;
  limits: { maxFiles: number; concurrency: number };
  scope: {
    referenceTable: 'product_images.file_id';
    contexts: readonly ['product-image', 'product-description-image'];
    legacyPublicMimeAllowlist: readonly ['image/gif'];
    publicOnly: true;
    uploaderReplacement: string;
    categoryImageUrlsIncluded: false;
  };
}

function normalizeUploadRow(row: Record<string, unknown>): ImageUploadRow {
  const url = optionalDatabaseString(row.url, 'url');
  const uploadedBy = optionalDatabaseString(row.uploaded_by, 'uploaded_by');
  return {
    id: String(row.id),
    file_name: String(row.file_name),
    original_name: String(row.original_name),
    mime_type: String(row.mime_type),
    size: Number(row.size),
    file_path: String(row.file_path),
    ...(url === undefined ? {} : { url }),
    storage_provider: String(row.storage_provider),
    status: String(row.status),
    context_id: String(row.context_id),
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null,
    ...(uploadedBy === undefined ? {} : { uploaded_by: uploadedBy }),
    is_public: Boolean(row.is_public),
    created_at: normalizeDatabaseTimestamp(row.created_at),
    updated_at: normalizeDatabaseTimestamp(row.updated_at),
    deleted_at: normalizeNullableDatabaseTimestamp(row.deleted_at),
    activated_at: normalizeNullableDatabaseTimestamp(row.activated_at),
  };
}

async function probeIdentity(tx: Sql): Promise<DatabaseIdentity & { readOnly: boolean }> {
  const [identity] = await tx<{ database: string; host: string; port: number; read_only: boolean }[]>`
    SELECT current_database() AS database,
           COALESCE(host(inet_server_addr()), 'local') AS host,
           inet_server_port()::int AS port,
           current_setting('transaction_read_only') = 'on' AS read_only
  `;
  return {
    database: identity.database,
    host: identity.host,
    port: Number(identity.port),
    readOnly: Boolean(identity.read_only),
  };
}

async function assertProductImageContexts(tx: Sql, label: string): Promise<void> {
  const [context] = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM file_contexts
    WHERE (
      id = 'product-image'
      AND is_active = true
      AND allow_public = true
      AND allow_private = false
      AND path_prefix = 'products/images'
      AND max_file_size = 10485760
    ) OR (
      id = 'product-description-image'
      AND is_active = true
      AND allow_public = true
      AND allow_private = false
      AND path_prefix = 'products/description-image'
      AND max_file_size = 20971520
    )
  `;
  if (Number(context.count) !== IMAGE_CONTEXT_IDS.length)
    throw new Error(`${label} product image contexts are not the approved public-only policies`);
}

async function readImageReferences(
  client: Sql,
  expected: DatabaseIdentity,
  stage: string,
  maxFiles: number,
): Promise<{
  identity: DatabaseIdentity;
  references: CatalogImageReference[];
  coverage: CatalogImageReferenceCoverage;
}> {
  return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
    const tx = transaction as unknown as Sql;
    const identity = await probeIdentity(tx);
    assertLiveImageSource({ ...identity, stage }, { stage, expected });
    const rows = await tx<
      {
        file_id: string;
        version_status: string;
        fulfillment_kind: string;
        version_deleted: boolean;
        master_deleted: boolean;
      }[]
    >`
      SELECT image.file_id::text AS file_id,
             version.status::text AS version_status,
             version.fulfillment_kind,
             version.deleted_at IS NOT NULL AS version_deleted,
             master.deleted_at IS NOT NULL AS master_deleted
      FROM product_images AS image
      JOIN product_master_versions AS version ON version.id = image.version_id
      JOIN product_masters AS master ON master.id = version.master_id
      ORDER BY image.id
    `;
    const coverage = classifyCatalogImageReferences(
      rows.map((row) => ({
        fileId: row.file_id,
        versionStatus: row.version_status,
        fulfillmentKind: row.fulfillment_kind,
        versionDeleted: Boolean(row.version_deleted),
        masterDeleted: Boolean(row.master_deleted),
      })),
    );
    if (coverage.requiredReferences.length > maxFiles) {
      throw new Error(
        `Required referenced image count ${coverage.requiredReferences.length} exceeds --max-files ${maxFiles}`,
      );
    }
    return {
      identity,
      references: coverage.requiredReferences,
      coverage,
    };
  });
}

async function readSourceUploads(
  client: Sql,
  ids: string[],
  expected: DatabaseIdentity,
  stage: string,
): Promise<{ identity: DatabaseIdentity; uploads: ImageUploadRow[] }> {
  return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
    const tx = transaction as unknown as Sql;
    const identity = await probeIdentity(tx);
    assertLiveImageSource({ ...identity, stage }, { stage, expected });
    await assertProductImageContexts(tx, 'Live');
    const uploads: ImageUploadRow[] = [];
    for (let offset = 0; offset < ids.length; offset += DEFAULT_QUERY_BATCH) {
      const rows = await tx<Record<string, unknown>[]>`
        SELECT id, file_name, original_name, mime_type, size, file_path,
               storage_provider, status, context_id, metadata, is_public,
               created_at, updated_at, deleted_at, activated_at
        FROM uploads
        WHERE id = ANY(${ids.slice(offset, offset + DEFAULT_QUERY_BATCH)}::uuid[])
        ORDER BY id
      `;
      uploads.push(...rows.map(normalizeUploadRow));
    }
    return { identity, uploads };
  });
}

class PostgresCatalogImageTarget implements CatalogImageTarget {
  constructor(
    private readonly client: Sql,
    private readonly expected: DatabaseIdentity,
    private readonly stage: string,
  ) {}

  async probe(): Promise<{ identity: DatabaseIdentity; uploadCount: number }> {
    return this.client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
      const tx = transaction as unknown as Sql;
      const identity = await probeIdentity(tx);
      const [context] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM file_contexts
        WHERE (
          id = 'product-image' AND is_active = true AND allow_public = true AND allow_private = false
          AND path_prefix = 'products/images' AND max_file_size = 10485760
        ) OR (
          id = 'product-description-image' AND is_active = true AND allow_public = true AND allow_private = false
          AND path_prefix = 'products/description-image' AND max_file_size = 20971520
        )
      `;
      assertDemoImageTarget(
        { ...identity, contextRows: Number(context.count) },
        { stage: this.stage, expected: this.expected },
      );
      const [uploads] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM uploads`;
      return { identity, uploadCount: Number(uploads.count) };
    });
  }

  async read(ids: string[]): Promise<ImageUploadRow[]> {
    if (!ids.length) return [];
    return this.client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
      const tx = transaction as unknown as Sql;
      const rows: ImageUploadRow[] = [];
      for (let offset = 0; offset < ids.length; offset += DEFAULT_QUERY_BATCH) {
        const batch = await tx<Record<string, unknown>[]>`
          SELECT id, file_name, original_name, mime_type, size, file_path, url,
                 storage_provider, status, context_id, metadata, uploaded_by, is_public,
                 created_at, updated_at, deleted_at, activated_at
          FROM uploads
          WHERE id = ANY(${ids.slice(offset, offset + DEFAULT_QUERY_BATCH)}::uuid[])
          ORDER BY id
        `;
        rows.push(...batch.map(normalizeUploadRow));
      }
      return rows;
    });
  }

  async insertVerified(rows: ImageUploadRow[]): Promise<number> {
    if (!rows.length) return 0;
    return this.client.begin('ISOLATION LEVEL SERIALIZABLE', async (transaction) => {
      const tx = transaction as unknown as Sql;
      const identity = await probeIdentity(tx);
      const [context] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM file_contexts
        WHERE (
          id = 'product-image' AND is_active = true AND allow_public = true AND allow_private = false
          AND path_prefix = 'products/images' AND max_file_size = 10485760
        ) OR (
          id = 'product-description-image' AND is_active = true AND allow_public = true AND allow_private = false
          AND path_prefix = 'products/description-image' AND max_file_size = 20971520
        )
      `;
      assertDemoImageTarget(
        { ...identity, contextRows: Number(context.count) },
        { stage: this.stage, expected: this.expected },
      );
      let inserted = 0;
      for (let offset = 0; offset < rows.length; offset += DEFAULT_QUERY_BATCH) {
        const batch = rows.slice(offset, offset + DEFAULT_QUERY_BATCH);
        const result = await tx.unsafe<{ id: string }[]>(
          `INSERT INTO uploads (
             id, file_name, original_name, mime_type, size, file_path, url, storage_provider,
             status, context_id, metadata, uploaded_by, is_public,
             created_at, updated_at, deleted_at, activated_at
           )
           SELECT id, file_name, original_name, mime_type, size, file_path, url, storage_provider,
                  status, context_id, metadata, uploaded_by, is_public,
                  created_at, updated_at, deleted_at, activated_at
           FROM jsonb_to_recordset($1::jsonb) AS source(
             id uuid, file_name varchar, original_name varchar, mime_type varchar, size bigint,
             file_path text, url text, storage_provider varchar, status varchar, context_id varchar,
             metadata jsonb, uploaded_by uuid, is_public boolean, created_at timestamp,
             updated_at timestamp, deleted_at timestamp, activated_at timestamp
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING id::text`,
          [batch as unknown as JSONValue],
        );
        inserted += result.length;
      }

      const actual: ImageUploadRow[] = [];
      const ids = rows.map((row) => row.id);
      for (let offset = 0; offset < ids.length; offset += DEFAULT_QUERY_BATCH) {
        const batch = await tx<Record<string, unknown>[]>`
          SELECT id, file_name, original_name, mime_type, size, file_path, url,
                 storage_provider, status, context_id, metadata, uploaded_by, is_public,
                 created_at, updated_at, deleted_at, activated_at
          FROM uploads
          WHERE id = ANY(${ids.slice(offset, offset + DEFAULT_QUERY_BATCH)}::uuid[])
          ORDER BY id
        `;
        actual.push(...batch.map(normalizeUploadRow));
      }
      const actualById = new Map(actual.map((row) => [row.id, row]));
      for (const expected of rows) {
        const current = actualById.get(expected.id);
        if (!current || !rowsMatch(current, expected)) throw new Error(`target upload collision: ${expected.id}`);
      }
      return inserted;
    });
  }
}

function parseCli(argv: string[]): CatalogImageCliOptions {
  const options: CatalogImageCliOptions = { apply: false, concurrency: 8 };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--check':
        break;
      case '--connections':
        options.connections = value;
        index += 1;
        break;
      case '--file-connections':
        options.fileConnections = value;
        index += 1;
        break;
      case '--report':
        options.report = value;
        index += 1;
        break;
      case '--aws-region':
        options.region = value;
        index += 1;
        break;
      case '--max-files':
        options.maxFiles = Number(value);
        index += 1;
        break;
      case '--concurrency':
        options.concurrency = Number(value);
        index += 1;
        break;
      case '--expect-live-core-database':
        options.expectedLiveCoreDatabase = value;
        index += 1;
        break;
      case '--expect-live-file-database':
        options.expectedLiveFileDatabase = value;
        index += 1;
        break;
      case '--expect-demo-file-database':
        options.expectedDemoFileDatabase = value;
        index += 1;
        break;
      case '--expect-live-server-host':
        options.expectedLiveServerHost = value;
        index += 1;
        break;
      case '--expect-demo-server-host':
        options.expectedDemoServerHost = value;
        index += 1;
        break;
      case '--expect-server-port':
        options.expectedServerPort = Number(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireString(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function requireInteger(value: number | undefined, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value! < minimum || value! > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value!;
}

async function readPrivateJson<T>(filePath: string): Promise<T> {
  const absolute = resolve(filePath);
  const mode = (await stat(absolute)).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`${absolute} must not be readable or writable by group/others`);
  return JSON.parse(await readFile(absolute, 'utf8')) as T;
}

function parsedDatabase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function assertConnectedEndpoints(core: CoreConnectionFile, files: FileConnectionFile): void {
  for (const stage of ['live', 'demo'] as const) {
    const coreUrl = new URL(core[stage].url);
    const fileUrl = new URL(files[stage].url);
    if (coreUrl.hostname !== fileUrl.hostname || (coreUrl.port || '5432') !== (fileUrl.port || '5432')) {
      throw new Error(`${stage} core/file connected endpoints must use the same audited tunnel or direct endpoint`);
    }
  }
  if (core.live.stage !== 'live' || core.demo.stage !== 'demo')
    throw new Error('Core connection stage markers are invalid');
  if (files.live.publicBucket === files.demo.publicBucket) throw new Error('Live and demo public buckets must differ');
  for (const stage of ['live', 'demo'] as const) {
    if (!files[stage].publicBucket || !files[stage].privateBucket)
      throw new Error(`${stage} file buckets are required`);
  }
}

function findRowCollisions(expectedRows: ImageUploadRow[], currentRows: ImageUploadRow[]): string[] {
  const expected = new Map(expectedRows.map((row) => [row.id, row]));
  return currentRows
    .filter((row) => !expected.has(row.id) || !rowsMatch(row, expected.get(row.id)!))
    .map((row) => row.id)
    .sort();
}

export async function runCatalogImageCopyCli(argv = process.argv): Promise<CatalogImageReport> {
  const options = parseCli(argv);
  const maxFiles = requireInteger(options.maxFiles, '--max-files', 1, 50_000);
  const concurrency = requireInteger(options.concurrency, '--concurrency', 1, 64);
  const coreConnections = await readPrivateJson<CoreConnectionFile>(
    requireString(options.connections, '--connections'),
  );
  const fileConnections = await readPrivateJson<FileConnectionFile>(
    requireString(options.fileConnections, '--file-connections'),
  );
  assertConnectedEndpoints(coreConnections, fileConnections);
  const serverPort = requireInteger(options.expectedServerPort, '--expect-server-port', 1, 65_535);
  const expectedLiveCore: DatabaseIdentity = {
    database: requireString(options.expectedLiveCoreDatabase, '--expect-live-core-database'),
    host: requireString(options.expectedLiveServerHost, '--expect-live-server-host'),
    port: serverPort,
  };
  const expectedLiveFiles: DatabaseIdentity = {
    database: requireString(options.expectedLiveFileDatabase, '--expect-live-file-database'),
    host: expectedLiveCore.host,
    port: serverPort,
  };
  const expectedDemoFiles: DatabaseIdentity = {
    database: requireString(options.expectedDemoFileDatabase, '--expect-demo-file-database'),
    host: requireString(options.expectedDemoServerHost, '--expect-demo-server-host'),
    port: serverPort,
  };
  if (parsedDatabase(coreConnections.live.url) !== expectedLiveCore.database) {
    throw new Error('Live core URL database does not match the explicit expected database');
  }
  if (parsedDatabase(fileConnections.live.url) !== expectedLiveFiles.database) {
    throw new Error('Live file URL database does not match the explicit expected database');
  }
  if (parsedDatabase(fileConnections.demo.url) !== expectedDemoFiles.database) {
    throw new Error('Demo file URL database does not match the explicit expected database');
  }

  const liveCore = postgres(coreConnections.live.url, { max: 1, prepare: false, onnotice: () => undefined });
  const liveFiles = postgres(fileConnections.live.url, { max: 1, prepare: false, onnotice: () => undefined });
  const demoFiles = postgres(fileConnections.demo.url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const sourceReferences = await readImageReferences(
      liveCore,
      expectedLiveCore,
      coreConnections.live.stage,
      maxFiles,
    );
    const sourceUploads = await readSourceUploads(
      liveFiles,
      sourceReferences.references.map((row) => row.fileId),
      expectedLiveFiles,
      coreConnections.live.stage,
    );
    const region = requireString(options.region, '--aws-region');
    const plan = planCatalogImages(sourceReferences.references, sourceUploads.uploads, {
      sourcePublicBucket: fileConnections.live.publicBucket,
      targetPublicBucket: fileConnections.demo.publicBucket,
      region,
      actorId: DEMO_IMAGE_ACTOR_ID,
    });
    const target = new PostgresCatalogImageTarget(demoFiles, expectedDemoFiles, coreConnections.demo.stage);
    const targetProbe = await target.probe();
    const currentRows = await target.read(plan.images.map((image) => image.fileId));
    const collisions = findRowCollisions(
      plan.images.map((image) => image.targetRow),
      currentRows,
    );
    if (collisions.length) throw new Error(`Target upload row collisions: ${collisions.length}`);

    const hasGaps = plan.missingUploadIds.length > 0 || plan.rejectedUploads.length > 0;
    let result: CatalogImageReport['result'] = null;
    if (options.apply) {
      const objectStore = new S3CatalogImageObjectStore(new S3Client({ region }) as unknown as S3CommandClient);
      result = await applyCatalogImagePlan(plan, { objectStore, target, concurrency });
    }
    const report: CatalogImageReport = {
      status: options.apply ? (hasGaps ? 'applied-with-gaps' : 'applied') : hasGaps ? 'ready-with-gaps' : 'ready',
      mode: options.apply ? 'apply' : 'check',
      source: {
        core: sourceReferences.identity,
        files: sourceUploads.identity,
        allReferenceRows: sourceReferences.coverage.allReferenceRows,
        allDistinctReferences: sourceReferences.coverage.allDistinctReferences,
        requiredReferenceRows: plan.referenceRows,
        requiredDistinctReferences: plan.distinctReferences,
        excludedHistoricalRows: sourceReferences.coverage.excludedRows,
        excludedOnlyFileIds: sourceReferences.coverage.excludedOnlyFileIds,
        exclusionReasonCounts: sourceReferences.coverage.exclusionReasonCounts,
        eligibleUploads: plan.images.length,
        referenceCounts: plan.referenceCounts,
        missingUploadIds: plan.missingUploadIds,
        rejectedUploads: plan.rejectedUploads,
        planSha256: plan.planSha256,
      },
      target: {
        files: targetProbe.identity,
        uploadsBefore: targetProbe.uploadCount,
        matchingReferencedRowsBefore: currentRows.length,
        missingReferencedRowsBefore: plan.images.length - currentRows.length,
      },
      result,
      limits: { maxFiles, concurrency },
      scope: {
        referenceTable: 'product_images.file_id',
        contexts: ['product-image', 'product-description-image'],
        legacyPublicMimeAllowlist: ['image/gif'],
        publicOnly: true,
        uploaderReplacement: DEMO_IMAGE_ACTOR_ID,
        categoryImageUrlsIncluded: false,
      },
    };
    await writeFile(resolve(requireString(options.report, '--report')), `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    console.log(
      JSON.stringify(
        {
          status: report.status,
          mode: report.mode,
          allReferenceRows: report.source.allReferenceRows,
          allDistinctReferences: report.source.allDistinctReferences,
          requiredReferenceRows: report.source.requiredReferenceRows,
          requiredDistinctReferences: report.source.requiredDistinctReferences,
          excludedHistoricalRows: report.source.excludedHistoricalRows,
          eligibleUploads: report.source.eligibleUploads,
          missingUploads: report.source.missingUploadIds.length,
          rejectedUploads: report.source.rejectedUploads.length,
          targetRowsBefore: report.target.matchingReferencedRowsBefore,
          result: report.result,
          planSha256: report.source.planSha256,
        },
        null,
        2,
      ),
    );
    return report;
  } finally {
    await Promise.allSettled([liveCore.end(), liveFiles.end(), demoFiles.end()]);
  }
}

if (require.main === module) {
  runCatalogImageCopyCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
