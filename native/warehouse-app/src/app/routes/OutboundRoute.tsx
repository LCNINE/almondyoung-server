import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { isStationDevice } from '../station';

export function OutboundRoute() {
  return <OutboundQueueScreen labelPrinting={isStationDevice()} />;
}
