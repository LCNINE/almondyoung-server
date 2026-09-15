'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { isCustomError } from '../../customError';
import { isStocktakingOperationResult } from './stocktaking-result';

type PendingCountOperation = {
  method: 'post' | 'put';
  url: string;
  body: string;
  actorId: string;
  createdAt: number;
};
const prefix = `stocktaking-operation:${ALMONDYOUNG_API_BASE_URL}:`;
const maximumRecoveryAge = 29 * 24 * 60 * 60 * 1000;
const rejectedCodes = new Set([
  'STOCKTAKING_RECOUNT_REQUIRED',
  'STOCKTAKING_REVISION_CONFLICT',
  'STOCKTAKING_PREVIEW_STALE',
  'STOCKTAKING_COUNT_REQUIRED',
  'INBOUND_ORIGIN_STOCK_PROTECTED',
  'INBOUND_ORIGIN_STOCK_INCONSISTENT',
  'INBOUND_PUTAWAY_DESTINATION_INVALID',
]);

async function actorContext() {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/work-context`
  );
  const context = response.data as {
    actorId?: string;
    operationContractVersion?: number;
  };
  if (!context.actorId || context.operationContractVersion !== 2)
    throw new Error('앱을 새로 열어 주세요.');
  return {
    actorId: context.actorId,
    storageKey: `${prefix}${context.actorId}`,
  };
}

function readPending(storageKey: string): PendingCountOperation | undefined {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return undefined;
  const operation = JSON.parse(stored) as PendingCountOperation;
  if (
    !operation ||
    typeof operation.body !== 'string' ||
    !Number.isFinite(operation.createdAt) ||
    operation.createdAt > Date.now() ||
    typeof operation.actorId !== 'string' ||
    !['post', 'put'].includes(operation.method) ||
    !operation.url.startsWith(`${ALMONDYOUNG_API_BASE_URL}/stocktaking/`)
  ) {
    throw new Error('이전 작업을 확인해 주세요.');
  }
  if (Date.now() - operation.createdAt >= maximumRecoveryAge)
    throw new Error('오래된 작업이 남아 있어요. 관리자에게 확인해 주세요.');
  return operation;
}

function assertNoOtherActorPending(storageKey: string) {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix) && key !== storageKey)
      throw new Error(
        '이전 작업자의 미확인 작업이 있어요. 원래 계정에서 확인해 주세요.'
      );
  }
}

async function underLock<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks)
    throw new Error(
      '작업 저장을 확인할 수 없어요. 브라우저를 업데이트해 주세요.'
    );
  return navigator.locks.request(prefix, action);
}

/** The application interceptor unwraps Axios 4xx into CustomError. */
export function stocktakingFailure(error: unknown): {
  status?: number;
  code?: string;
  message?: string;
} {
  const wrapped = error as
    { response?: { status?: number; data?: unknown } } | undefined;
  const status = isCustomError(error)
    ? error.statusCode
    : wrapped?.response?.status;
  const body = (
    isCustomError(error) ? error.response : wrapped?.response?.data
  ) as { code?: unknown; error?: unknown; message?: unknown } | undefined;
  const code =
    typeof body?.code === 'string'
      ? body.code
      : typeof body?.error === 'string'
        ? body.error
        : undefined;
  return {
    status,
    code,
    message: typeof body?.message === 'string' ? body.message : undefined,
  };
}

async function transmit<T>(
  storageKey: string,
  operation: PendingCountOperation
): Promise<T> {
  try {
    const response = await client[operation.method](
      operation.url,
      JSON.parse(operation.body)
    );
    if (
      !isStocktakingOperationResult(
        operation.url,
        JSON.parse(operation.body),
        response.data
      )
    ) {
      throw new Error('처리 결과를 확인할 수 없어요. 작업 확인을 눌러 주세요.');
    }
    localStorage.removeItem(storageKey);
    return response.data as T;
  } catch (error) {
    const { status, code } = stocktakingFailure(error);
    if (
      [400, 404, 422].includes(status ?? 0) ||
      ([400, 404, 409, 422].includes(status ?? 0) &&
        code &&
        rejectedCodes.has(code))
    )
      localStorage.removeItem(storageKey);
    throw error;
  }
}

/** Preserve a submitted body before HTTP; a replacement action cannot bypass unresolved work. */
export async function performStocktakingOperation<T>(
  method: 'post' | 'put',
  url: string,
  body: unknown
): Promise<T> {
  return underLock(async () => {
    const { actorId, storageKey } = await actorContext();
    assertNoOtherActorPending(storageKey);
    const serialized = JSON.stringify(body);
    const existing = readPending(storageKey);
    if (existing && existing.actorId !== actorId)
      throw new Error('원래 작업자 계정에서 확인해 주세요.');
    if (
      existing &&
      (existing.method !== method ||
        existing.url !== url ||
        existing.body !== serialized)
    ) {
      throw new Error(
        '처리 여부가 확인되지 않은 작업이 있어요. 작업 확인을 눌러 주세요.'
      );
    }
    const operation = existing ?? {
      method,
      url,
      body: serialized,
      actorId,
      createdAt: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(operation));
    return transmit<T>(storageKey, operation);
  });
}

/** Explicit recovery only, after the server confirms the currently authenticated identity. */
export async function retryPendingStocktakingOperation(): Promise<boolean> {
  return underLock(async () => {
    const { actorId, storageKey } = await actorContext();
    assertNoOtherActorPending(storageKey);
    const operation = readPending(storageKey);
    if (!operation) return false;
    if (operation.actorId !== actorId)
      throw new Error('원래 작업자 계정에서 확인해 주세요.');
    await transmit(storageKey, operation);
    return true;
  });
}
