import { QuickInboundScreen } from '../../domains/inbound/QuickInboundScreen';
import { isStationDevice } from '../station';

export function QuickInboundRoute() {
  return <QuickInboundScreen station={isStationDevice()} />;
}
