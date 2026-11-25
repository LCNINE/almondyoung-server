import { useParams } from '@tanstack/react-router';
import { PurchaseOrderReceiveScreen } from '../../domains/inbound/PurchaseOrderReceiveScreen';
import { isStationDevice } from '../station';

export function PurchaseOrderReceiveRoute() {
  const { poId } = useParams({ strict: false });
  return (
    <PurchaseOrderReceiveScreen poId={poId ?? ''} station={isStationDevice()} />
  );
}
