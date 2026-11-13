import type { ShipmentByWaybill } from '../../domains/outbound/types';
import type { ReturnBinView } from './returnBinView';

export function AfterWithdrawal({
  bin,
  exitTo,
}: {
  bin: ReturnBinView;
  exitTo: ShipmentByWaybill['exitTo'];
}) {
  return (
    <section
      aria-label="다음 할 일"
      className="flex shrink-0 flex-col gap-2 rounded-[10px] border border-[#D5D8DE] bg-white p-[18px] text-[17px]"
    >
      <h3 className="text-[15px] font-semibold text-[#535968]">다음 할 일</h3>
      {bin.kind === 'loading' ? (
        <p>되돌림 바구니를 확인하고 있어요.</p>
      ) : bin.kind === 'failed' ? (
        <p>
          되돌림 바구니를 확인하지 못했어요. F4 «되돌림 적치»에서 확인해 주세요.
        </p>
      ) : bin.items.length === 0 ? (
        <p>되돌림 바구니는 비어 있어요.</p>
      ) : (
        <>
          <p className="font-semibold">
            되돌림 바구니의 상품을 F4 «되돌림 적치»에서 원래 자리에 넣어 주세요.
          </p>
          <ul aria-label="되돌릴 상품" className="flex flex-col gap-1">
            {bin.items.map((item) => (
              <li key={`${item.skuId}:${item.sourceLocationId}`}>
                {`${item.skuName} ${item.qty}개 → `}
                <span className="font-mono">{item.locationCode}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {exitTo === 'canceled' ? (
        <p className="text-[#535968]">
          이 상자의 주문은 취소됐어요. 다시 보내지 않아요.
        </p>
      ) : exitTo === 'draft' ? (
        <p className="text-[#535968]">
          이 상자의 주문은 관리자가 «출고 준비»에서 다시 준비해요.
        </p>
      ) : null}
    </section>
  );
}
