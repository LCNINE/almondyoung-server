import { createHash } from 'node:crypto';
import { Inject, Injectable, ConflictException, Logger } from '@nestjs/common';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyTx,
  IdempotencyRepository,
} from './idempotency.repository';
import {
  IdempotencyKeyRecord,
  NewIdempotencyKeyRecord,
} from './idempotency.schema';

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const MAX_USER_ID_LENGTH = 64;
const MAX_REQUEST_PATH_LENGTH = 255;

export interface BeginHttpIdempotencyRequestInput {
  idempotencyKey: string;
  operation: string;
  actorId: string;
  requestMethod: string;
  requestPath: string;
  requestBody: unknown;
}

export interface BeginCommandIdempotencyRequestInput {
  idempotencyKey: string;
  operation: string;
  requestBody: unknown;
}

export interface ReplayDecision {
  kind: 'REPLAY';
  responseCode: number;
  responseBody: unknown;
}

export interface StartDecision {
  kind: 'STARTED';
  recordId: string;
}

export type IdempotencyDecision = ReplayDecision | StartDecision;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repository: IdempotencyRepository,
  ) {}

  async beginHttpRequest(
    input: BeginHttpIdempotencyRequestInput,
  ): Promise<IdempotencyDecision> {
    return this.beginRequest({
      scope: 'HTTP',
      operation: input.operation,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      requestMethod: input.requestMethod,
      requestPath: input.requestPath,
      requestBody: input.requestBody,
    });
  }

  async beginCommandRequest(
    input: BeginCommandIdempotencyRequestInput,
  ): Promise<IdempotencyDecision> {
    const actorId = 'wallet-command-consumer';
    const requestPath = `/commands/${input.operation}`;
    return this.beginRequest({
      scope: 'COMMAND',
      operation: input.operation,
      actorId,
      idempotencyKey: input.idempotencyKey,
      requestMethod: 'COMMAND',
      requestPath,
      requestBody: input.requestBody,
    });
  }

  async completeSuccess(
    recordId: string,
    responseCode: number,
    responseBody: unknown,
  ): Promise<void> {
    const now = new Date();

    await this.repository.runInTransaction(async (tx) => {
      const updated = await this.repository.updateIfPending(tx, recordId, {
        status: 'SUCCESS',
        responseCode,
        responseBody: JSON.stringify(responseBody ?? null),
        updatedAt: now,
      });

      if (!updated) {
        this.logger.warn(
          `Idempotency completeSuccess no-op: recordId=${recordId}, already-terminal`,
        );
      }
    });
  }

  async completeFailure(
    recordId: string,
    responseCode: number,
    responseBody: unknown,
  ): Promise<void> {
    const now = new Date();

    await this.repository.runInTransaction(async (tx) => {
      const updated = await this.repository.updateIfPending(tx, recordId, {
        status: 'FAILED',
        responseCode,
        responseBody: JSON.stringify(responseBody ?? null),
        updatedAt: now,
      });

      if (!updated) {
        this.logger.warn(
          `Idempotency completeFailure no-op: recordId=${recordId}, already-terminal`,
        );
      }
    });
  }

  private async beginRequest(input: {
    scope: 'HTTP' | 'COMMAND';
    operation: string;
    actorId: string;
    idempotencyKey: string;
    requestMethod: string;
    requestPath: string;
    requestBody: unknown;
  }): Promise<IdempotencyDecision> {
    const now = new Date();
    const recordId = this.buildScopedRecordId(
      input.scope,
      input.operation,
      input.actorId,
      input.idempotencyKey,
    );
    const requestHash = this.buildRequestHash(
      input.requestMethod,
      input.requestPath,
      input.requestBody,
    );

    return this.repository.runInTransaction(async (tx) => {
      let existing = await this.repository.findByIdForUpdate(tx, recordId);

      if (!existing) {
        const newRecord = this.buildPendingRecord({
          recordId,
          actorId: input.actorId,
          requestPath: input.requestPath,
          requestHash,
          now,
        });

        try {
          await this.repository.insert(tx, newRecord);
          return {
            kind: 'STARTED',
            recordId,
          };
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          existing = await this.repository.findByIdForUpdate(tx, recordId);
          if (!existing) {
            throw error;
          }
        }
      }

      return this.handleExistingRecord({
        tx,
        scope: input.scope,
        existing,
        recordId,
        requestHash,
        actorId: input.actorId,
        requestPath: input.requestPath,
        now,
      });
    });
  }

  private async handleExistingRecord(input: {
    tx: IdempotencyTx;
    scope: 'HTTP' | 'COMMAND';
    existing: IdempotencyKeyRecord;
    recordId: string;
    requestHash: string;
    actorId: string;
    requestPath: string;
    now: Date;
  }): Promise<IdempotencyDecision> {
    const { tx, scope, recordId, requestHash, actorId, requestPath, now } = input;
    let { existing } = input;

    if (existing.expiresAt.getTime() <= now.getTime()) {
      const didReset = await this.repository.updateIfExpired(tx, recordId, now, {
        userId: this.toStorageUserId(actorId),
        requestPath: this.toStorageRequestPath(requestPath),
        requestHash,
        status: 'PENDING',
        responseCode: null,
        responseBody: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: this.buildExpiresAt(now),
      });

      if (didReset) {
        return { kind: 'STARTED', recordId };
      }

      const refreshed = await this.repository.findByIdForUpdate(tx, recordId);
      if (!refreshed) {
        throw new Error(`IDEMPOTENCY_RECORD_MISSING_AFTER_EXPIRED_RESET: ${recordId}`);
      }
      existing = refreshed;
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
        message: 'Idempotency-Key reused with different payload',
      });
    }

    if (existing.status === 'PENDING') {
      if (scope === 'COMMAND') {
        return {
          kind: 'REPLAY',
          responseCode: 202,
          responseBody: {
            status: 'IN_PROGRESS',
          },
        };
      }

      throw new ConflictException({
        error: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        message: 'Request with this Idempotency-Key is currently being processed',
      });
    }

    return {
      kind: 'REPLAY',
      responseCode: existing.responseCode ?? (existing.status === 'FAILED' ? 500 : 200),
      responseBody: parseStoredResponseBody(existing.responseBody),
    };
  }

  private buildPendingRecord(input: {
    recordId: string;
    actorId: string;
    requestPath: string;
    requestHash: string;
    now: Date;
  }): NewIdempotencyKeyRecord {
    return {
      id: input.recordId,
      userId: this.toStorageUserId(input.actorId),
      requestPath: this.toStorageRequestPath(input.requestPath),
      requestHash: input.requestHash,
      status: 'PENDING',
      responseCode: null,
      responseBody: null,
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: this.buildExpiresAt(input.now),
    };
  }

  private buildScopedRecordId(
    scope: 'HTTP' | 'COMMAND',
    operation: string,
    actorId: string,
    idempotencyKey: string,
  ): string {
    const raw = `${scope}|${operation}|${actorId}|${idempotencyKey}`;
    return `wallet:v1:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
  }

  private buildRequestHash(
    requestMethod: string,
    requestPath: string,
    requestBody: unknown,
  ): string {
    const normalizedMethod = requestMethod.toUpperCase();
    const normalizedPath = requestPath.split('?')[0] || '/';
    const canonicalBody = stableCanonicalStringify(requestBody ?? null);
    const raw = `${normalizedMethod}\n${normalizedPath}\n${canonicalBody}`;
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  private buildExpiresAt(now: Date): Date {
    const ttlSeconds = parseInt(
      process.env.WALLET_IDEMPOTENCY_TTL_SECONDS ??
        `${DEFAULT_IDEMPOTENCY_TTL_SECONDS}`,
      10,
    );
    const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? ttlSeconds
      : DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    return new Date(now.getTime() + safeTtlSeconds * 1000);
  }

  private toStorageUserId(actorId: string): string {
    if (actorId.length <= MAX_USER_ID_LENGTH) {
      return actorId;
    }

    return createHash('sha256').update(actorId, 'utf8').digest('hex').slice(0, 64);
  }

  private toStorageRequestPath(requestPath: string): string {
    if (requestPath.length <= MAX_REQUEST_PATH_LENGTH) {
      return requestPath;
    }

    return requestPath.slice(0, MAX_REQUEST_PATH_LENGTH);
  }
}

function parseStoredResponseBody(responseBody: string | null): unknown {
  if (!responseBody) {
    return null;
  }

  try {
    return JSON.parse(responseBody);
  } catch {
    return responseBody;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const current = error as
    | {
        code?: string;
        message?: string;
        cause?: unknown;
        originalError?: unknown;
      }
    | undefined;

  if (!current) {
    return false;
  }

  if (current.code === '23505') {
    return true;
  }

  if ((current.message ?? '').includes('duplicate key value violates unique constraint')) {
    return true;
  }

  if (current.cause) {
    return isUniqueViolation(current.cause);
  }

  if (current.originalError) {
    return isUniqueViolation(current.originalError);
  }

  return false;
}

function stableCanonicalStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Request payload contains non-finite number');
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCanonicalStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const item = objectValue[key];
      if (item === undefined) {
        continue;
      }
      pairs.push(`${JSON.stringify(key)}:${stableCanonicalStringify(item)}`);
    }

    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Request payload includes unsupported type: ${typeof value}`);
}
