import { useParams, useRouterState } from '@tanstack/react-router';
import { SimpleOutboundScreen } from '../../domains/outbound/SimpleOutboundScreen';

export function SimpleOutboundRoute() {
  const { shipmentId } = useParams({ strict: false });
  // 큐 화면이 조회 결과를 넘긴다. 딥링크·새로고침이면 없으므로 화면이 재스캔을 안내한다.
  const shipment = useRouterState({ select: (s) => s.location.state.shipment });
  return <SimpleOutboundScreen shipmentId={shipmentId ?? ''} shipment={shipment ?? null} />;
}
