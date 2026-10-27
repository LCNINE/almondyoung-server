import { PlaceholderScreen } from '../../core/design/PlaceholderScreen';
import { ReturnsScreen } from '../../station/returns/ReturnsScreen';
import { isStationDevice } from '../station';

/** 스테이션 F7 반품(K8 PR7b N1). 핸드헬드엔 이 탭이 없다 — 경로로 들어오면 알리기만 한다 */
export function CustomerReturnsRoute() {
  return isStationDevice() ? <ReturnsScreen /> : <PlaceholderScreen title="반품" note="스테이션에서 하는 작업이에요" />;
}
