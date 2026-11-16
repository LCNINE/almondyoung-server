import { useSearch } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../core/design/PlaceholderScreen';
import { InboundBoxesScreen } from '../../station/inbound/InboundBoxesScreen';
import { isStationDevice } from '../station';

/** 스테이션 F3 선적 상자 입고(#1239). 핸드헬드엔 이 작업이 없다 — 경로로 들어오면 알리기만 한다 */
export function InboundBoxesRoute() {
  const { shipmentId, boxId } = useSearch({ from: '/_authed/inbound/boxes' });
  if (!isStationDevice()) return <PlaceholderScreen title="선적 상자" note="스테이션에서 하는 작업이에요" />;
  // 입고내역 링크가 상자를 정해 오면 대기를 건너뛰고 그 상자를 연다
  return <InboundBoxesScreen initial={shipmentId && boxId ? { shipmentId, boxId } : undefined} />;
}
