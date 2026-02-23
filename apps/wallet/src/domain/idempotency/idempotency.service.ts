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
          `Idempotency record not in PENDING state during completeSuccess: recordId=${recordId}`,
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
          `Idempotency record not in PENDING state during completeFailure: recordId=${recordId}`,
        );
      }
    });
  }

  private async beginRequest(params: {
    scope: 'HTTP' | 'COMMAND';
    operation: string;
    actorId: string;
    idempotencyKey: string;
    requestMethod: string;
    requestPath: string;
    requestBody: unknown;
  }): Promise<IdempotencyDecision> {
    const ttlSeconds = this.readTtlSeconds();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const recordId = this.buildRecordId(params.actorId, params.idempotencyKey);
    const userId = params.actorId.slice(0, MAX_USER_ID_LENGTH);
    const requestPath = params.requestPath.slice(0, MAX_REQUEST_PATH_LENGTH);
    const requestHash = this.hashRequestBody(params.requestBody);

    return this.repository.runInTransaction(async (tx) => {
      const existing = await this.repository.findByIdForUpdate(tx, recordId);

      if (!existing) {
        return this.insertAndStart(tx, {
          recordId,
          userId,
          requestPath,
          requestHash,
          now,
          expiresAt,
        });
      }

      return this.handleExisting(tx, existing, {
        recordId,
        requestHash,
        now,
        expiresAt,
      });
    });
  }

  private async insertAndStart(
    tx: IdempotencyTx,
    params: {
      recordId: string;
      userId: string;
      requestPath: string;
      requestHash: string;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<StartDecision> {
    const record: NewIdempotencyKeyRecord = {
      id: params.recordId,
      userId: params.userId,
      requestPath: params.requestPath,
      requestHash: params.requestHash,
      status: 'PENDING',
      createdAt: params.now,
      updatedAt: params.now,
      expiresAt: params.expiresAt,
    };

    await this.repository.insert(tx, record);
    return { kind: 'STARTED', recordId: params.recordId };
  }

  private async handleExisting(
    tx: IdempotencyTx,
    existing: IdempotencyKeyRecord,
    params: {
      recordId: string;
      requestHash: string;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<IdempotencyDecision> {
    if (existing.requestHash !== params.requestHash) {
      throw new ConflictException({
        error: 'IDEMPOTENCY_KEY_HASH_MISMATCH',
        message:
          'Idempotency key is already associated with a different request body',
      });
    }

    if (existing.status === 'PENDING') {
      const isExpired = existing.expiresAt <= params.now;
      if (isExpired) {
        await this.repository.updateIfExpired(tx, params.recordId, params.now, {
          status: 'PENDING',
          responseCode: null,
          responseBody: null,
          updatedAt: params.now,
          expiresAt: params.expiresAt,
        });
        return { kind: 'STARTED', recordId: params.recordId };
      }

      throw new ConflictException({
        error: 'IDEMPOTENCY_KEY_IN_FLIGHT',
        message: 'A request with this idempotency key is already being processed',
      });
    }

    if (existing.status === 'SUCCESS') {
      return {
        kind: 'REPLAY',
        responseCode: existing.responseCode ?? 200,
        responseBody: existing.responseBody
          ? JSON.parse(existing.responseBody)
          : null,
      };
    }

    if (existing.status === 'FAILED') {
      const isExpired = existing.expiresAt <= params.now;
      if (isExpired) {
        await this.repository.update(tx, params.recordId, {
          status: 'PENDING',
          responseCode: null,
          responseBody: null,
          updatedAt: params.now,
          expiresAt: params.expiresAt,
        });
        return { kind: 'STARTED', recordId: params.recordId };
      }

      return {
        kind: 'REPLAY',
        responseCode: existing.responseCode ?? 500,
        responseBody: existing.responseBody
          ? JSON.parse(existing.responseBody)
          : null,
      };
    }

    throw new Error(
      `IDEMPOTENCY_UNKNOWN_STATUS: recordId=${params.recordId}, status=${existing.status}`,
    );
  }

  private buildRecordId(actorId: string, idempotencyKey: string): string {
    return createHash('sha256')
      .update(`${actorId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 64);
  }

  private hashRequestBody(body: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(body ?? null))
      .digest('hex')
      .slice(0, 64);
  }

  private readTtlSeconds(): number {
    const raw = process.env.WALLET_IDEMPOTENCY_TTL_SECONDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    }
    return Math.floor(parsed);
  }
}
