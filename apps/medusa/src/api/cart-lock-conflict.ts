import { errorHandler as buildDefaultErrorHandler } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import type { NextFunction, Request, Response } from 'express';

/**
 * 카트 워크플로는 카트 id 로 락을 잡는데, 못 잡으면 locking provider 가 평범한 `Error` 를 던진다.
 * 기본 에러 핸들러는 MedusaError 가 아닌 예외를 전부 default 로 떨어뜨려 메시지를
 * "An unknown error occurred." 로 갈고 500 을 준다. 그래서 클라이언트 입장에서는 잠깐 겹친 것과
 * 진짜 장애가 똑같아 보이고, 다시 시도하면 풀릴 요청을 그대로 실패로 처리하게 된다.
 *
 * 락 실패는 상태가 잘못된 게 아니라 타이밍이라 conflict 로 올려 409 로 내보낸다. 재시도해도
 * 된다는 신호가 상태 코드에 실려야 클라이언트가 문구를 파싱하지 않고 판단할 수 있다.
 */
const LOCK_FAILURE_PATTERN = /failed to acquire lock/i;

/**
 * `instanceof` 로 판정하지 않는다. 워크플로 엔진을 거쳐 온 에러는 다른 realm 에서 만들어져
 * `error instanceof Error` 가 false 로 나온다 (로컬에서 실측). 모양으로 판정한다.
 */
const readMessage = (error: unknown): string => {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : '';
};

/** MedusaError 는 type 을 들고 있다. 이미 분류된 에러는 그 판정을 존중한다. */
const isAlreadyClassified = (error: unknown): boolean =>
  typeof (error as { type?: unknown })?.type === 'string';

export const toCartLockConflict = (error: unknown): unknown => {
  if (isAlreadyClassified(error)) return error;

  const message = readMessage(error);
  if (!LOCK_FAILURE_PATTERN.test(message)) return error;

  return new MedusaError(MedusaError.Types.CONFLICT, message);
};

/**
 * 기본 핸들러를 감싼다. 직접 구현하면 나머지 에러 매핑까지 우리가 떠안게 되므로,
 * 락 실패만 바꿔 끼우고 판단은 그대로 넘긴다.
 */
export const createCartLockAwareErrorHandler = () => {
  const defaultErrorHandler = buildDefaultErrorHandler();

  return (error: unknown, req: Request, res: Response, next: NextFunction) =>
    defaultErrorHandler(
      toCartLockConflict(error) as Parameters<typeof defaultErrorHandler>[0],
      req,
      res,
      next,
    );
};
