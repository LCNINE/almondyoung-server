import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { BatchStatusScreen } from '../../station/batches/BatchStatusScreen';
import { isStationDevice } from '../station';

/** 스테이션 F2 배치 현황(스펙 §8). 핸드헬드엔 이 탭이 없다 — 경로로 들어오면 지금 출고작업을 그린다 */
export function OutboundBatchesRoute() {
  return isStationDevice() ? <BatchStatusScreen /> : <OutboundQueueScreen />;
}
