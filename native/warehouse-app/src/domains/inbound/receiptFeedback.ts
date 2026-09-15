import { errorMessage } from '../../core/data/errorMessage';
import { ReceiptStateError } from './receiptState';

/** State reader messages are already written for operators, unlike transport details. */
export function receiptFeedback(
  error: unknown,
  context: Parameters<typeof errorMessage>[1] = 'inbound'
) {
  if (
    error instanceof ReceiptStateError ||
    (error instanceof Error &&
      error.message === '앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.')
  )
    return error.message;
  return errorMessage(error, context);
}
