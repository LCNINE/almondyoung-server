import type { BoxView } from '../../domains/inbound-shipment/types';
import { arrivalDay } from './inboundBoxTypes';

/** 상자 화면 맨 위 줄 — «{선적 이름} · 상자 {이름} · {도착일} 도착». 끝난 선적이면 «끝남» */
export function BoxHeader({ box }: { box: BoxView }) {
  const day = arrivalDay(box.expectedArrival);
  const text = `${box.shipmentName} · 상자 ${box.label}${day ? ` · ${day} 도착` : ''}`;
  return (
    <header className="flex shrink-0 items-center gap-3 rounded-xl border border-[#e4e4e7] bg-white px-4 py-3">
      <h2 className="text-2xl font-semibold">{text}</h2>
      {box.shipmentStatus === 'closed' ? (
        <span className="rounded-[5px] bg-[#eff1f2] px-2 py-[5px] text-xs font-semibold whitespace-nowrap text-[#68706d]">끝남</span>
      ) : null}
    </header>
  );
}
