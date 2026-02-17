import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const HMAC_SIGNATURE_VERSION = 'v1';
const DEFAULT_ALLOWED_CLOCK_SKEW_MS = 60_000;
const DEFAULT_SIGNATURE_TTL_MS = 5 * 60_000;

export type HmacVerificationErrorCode =
  | 'SIGNATURE_VERSION_UNSUPPORTED'
  | 'SIGNATURE_TIMESTAMP_INVALID'
  | 'SIGNATURE_EXPIRED'
  | 'SNAPSHOT_CANONICALIZATION_FAILED'
  | 'INVALID_SIGNATURE';

export class HmacVerificationError extends Error {
  constructor(
    public readonly code: HmacVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HmacVerificationError';
  }
}

export interface VerifyHmacIntegrityInput {
  snapshotPayload: unknown;
  signature: string;
  signatureVersion: string;
  signedAt: string;
  now?: Date;
}

export interface VerifyHmacIntegrityOptions {
  sharedSecret: string;
  expectedVersion?: string;
  allowedClockSkewMs?: number;
  signatureTtlMs?: number;
}

export interface VerifyHmacIntegrityResult {
  canonicalPayload: string;
  payloadHash: string;
  signingString: string;
}

export function verifyHmacIntegrity(
  input: VerifyHmacIntegrityInput,
  options: VerifyHmacIntegrityOptions,
): VerifyHmacIntegrityResult {
  const expectedVersion = options.expectedVersion ?? HMAC_SIGNATURE_VERSION;

  if (input.signatureVersion !== expectedVersion) {
    throw new HmacVerificationError(
      'SIGNATURE_VERSION_UNSUPPORTED',
      `Unsupported signatureVersion: ${input.signatureVersion}`,
    );
  }

  validateSignedAt(
    input.signedAt,
    input.now?.getTime() ?? Date.now(),
    options.allowedClockSkewMs ?? DEFAULT_ALLOWED_CLOCK_SKEW_MS,
    options.signatureTtlMs ?? DEFAULT_SIGNATURE_TTL_MS,
  );

  if (!options.sharedSecret) {
    throw new HmacVerificationError(
      'INVALID_SIGNATURE',
      'HMAC shared secret is not configured',
    );
  }

  const canonicalPayload = canonicalizeSnapshotPayload(input.snapshotPayload);
  const payloadHash = computePayloadHash(canonicalPayload);
  const signingString = buildSigningString(
    input.signatureVersion,
    input.signedAt,
    payloadHash,
  );
  const expectedSignature = computeHmacSignature(
    options.sharedSecret,
    signingString,
  );

  if (!constantTimeStringEqual(input.signature, expectedSignature)) {
    throw new HmacVerificationError(
      'INVALID_SIGNATURE',
      'HMAC signature verification failed',
    );
  }

  return {
    canonicalPayload,
    payloadHash,
    signingString,
  };
}

export function canonicalizeSnapshotPayload(snapshotPayload: unknown): string {
  try {
    return canonicalizeJsonValue(snapshotPayload);
  } catch (error) {
    throw new HmacVerificationError(
      'SNAPSHOT_CANONICALIZATION_FAILED',
      error instanceof Error ? error.message : 'Failed to canonicalize snapshot payload',
    );
  }
}

export function computePayloadHash(canonicalPayload: string): string {
  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

export function buildSigningString(
  signatureVersion: string,
  signedAt: string,
  payloadHash: string,
): string {
  return `${signatureVersion}\n${signedAt}\n${payloadHash}`;
}

export function computeHmacSignature(
  sharedSecret: string,
  signingString: string,
): string {
  return createHmac('sha256', sharedSecret)
    .update(signingString, 'utf8')
    .digest('base64url');
}

function validateSignedAt(
  signedAt: string,
  nowMs: number,
  allowedClockSkewMs: number,
  signatureTtlMs: number,
): void {
  const signedAtMs = Date.parse(signedAt);

  if (Number.isNaN(signedAtMs)) {
    throw new HmacVerificationError(
      'SIGNATURE_TIMESTAMP_INVALID',
      `Invalid signedAt timestamp: ${signedAt}`,
    );
  }

  if (signedAtMs > nowMs + allowedClockSkewMs) {
    throw new HmacVerificationError(
      'SIGNATURE_TIMESTAMP_INVALID',
      'signedAt is in the future beyond allowed clock skew',
    );
  }

  if (nowMs - signedAtMs > signatureTtlMs + allowedClockSkewMs) {
    throw new HmacVerificationError(
      'SIGNATURE_EXPIRED',
      'HMAC signature is expired',
    );
  }
}

function canonicalizeJsonValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Snapshot payload contains non-finite number');
    }

    const serialized = JSON.stringify(value);
    if (!serialized) {
      throw new Error('Snapshot payload number serialization failed');
    }

    if (serialized.includes('e') || serialized.includes('E')) {
      throw new Error('Snapshot payload number cannot use exponential notation');
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJsonValue(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue).sort();
    const serializedPairs: string[] = [];

    for (const key of sortedKeys) {
      const propertyValue = objectValue[key];

      if (propertyValue === undefined) {
        continue;
      }

      serializedPairs.push(
        `${JSON.stringify(key)}:${canonicalizeJsonValue(propertyValue)}`,
      );
    }

    return `{${serializedPairs.join(',')}}`;
  }

  throw new Error(
    `Snapshot payload includes unsupported type: ${Object.prototype.toString.call(value)}`,
  );
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
