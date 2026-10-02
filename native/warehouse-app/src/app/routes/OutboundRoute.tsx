import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { InspectionScreen } from '../../station/outbound/InspectionScreen';
import { isStationDevice } from '../station';

/** 스테이션 F1 은 출고 검수(스펙 §6). 핸드헬드는 지금 출고작업 그대로다(§2-5) */
export function OutboundRoute() {
  return isStationDevice() ? <InspectionScreen /> : <OutboundQueueScreen />;
}
