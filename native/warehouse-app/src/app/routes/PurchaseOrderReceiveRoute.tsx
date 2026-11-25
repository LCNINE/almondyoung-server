import { useParams } from '@tanstack/react-router';
import { PurchaseOrderReceiveScreen } from '../../domains/inbound/PurchaseOrderReceiveScreen';

export function PurchaseOrderReceiveRoute() {
  const { poId } = useParams({ strict: false });
  return <PurchaseOrderReceiveScreen poId={poId ?? ''} />;
}
