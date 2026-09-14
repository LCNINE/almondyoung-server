import { ConflictException } from '@nestjs/common';

export type StocktakingConflictCode =
  | 'STOCKTAKING_RECOUNT_REQUIRED'
  | 'STOCKTAKING_REVISION_CONFLICT'
  | 'STOCKTAKING_PREVIEW_STALE'
  | 'STOCKTAKING_COUNT_REQUIRED';
export class StocktakingConflict extends ConflictException {
  constructor(code: StocktakingConflictCode) {
    const message =
      code === 'STOCKTAKING_RECOUNT_REQUIRED'
        ? '수량이 바뀌었어요. 이 위치를 다시 확인해 주세요.'
        : code === 'STOCKTAKING_COUNT_REQUIRED'
          ? '아직 세지 않은 상품이 있어요. 수량을 확인해 주세요.'
          : '수량이 바뀌었어요. 현재 내용을 다시 확인해 주세요.';
    super({ code, error: code, message });
  }
}
