import { cn } from '../../core/design/cn';
import { RETURN_REASON_LABELS } from '../../domains/customer-returns/reasons';
import type { ReturnView } from '../../domains/customer-returns/types';

export function ReturnReasonBand({ view }: { view: ReturnView }) {
  const seller = view.feeBearer === 'seller';

  return (
    <>
      <div
        className={cn(
          'rounded-md px-3 py-2.5 text-base font-semibold',
          seller ? 'bg-[#fff7e6] text-[#9a681c]' : 'bg-[#f4f4f5] text-[#27272a]'
        )}
      >
        {RETURN_REASON_LABELS.get(view.reason) ?? view.reason} ·{' '}
        {seller ? '판매자 부담' : '고객 부담'}
      </div>
      {view.note ? (
        <div className="text-base text-[#27272a]">메모: {view.note}</div>
      ) : null}
    </>
  );
}
