import { useParams, useRouterState } from '@tanstack/react-router';
import { WithdrawBoxScreen } from '../../domains/outbound/WithdrawBoxScreen';

export function WithdrawRoute() {
  const { shipmentId } = useParams({ strict: false });
  // 큐 화면이 조회 결과(뺄 목록 포함)를 넘긴다. 딥링크·새로고침이면 없으므로 화면이 재스캔을 안내한다.
  const shipment = useRouterState({ select: (s) => s.location.state.shipment });
  return <WithdrawBoxScreen shipmentId={shipmentId ?? ''} shipment={shipment ?? null} />;
}
