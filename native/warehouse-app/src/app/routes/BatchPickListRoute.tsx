import { useParams } from '@tanstack/react-router';
import { PickListScreen } from '../../station/batches/PickListScreen';

export function BatchPickListRoute() {
  const { batchId } = useParams({ strict: false });
  return <PickListScreen batchId={batchId ?? ''} />;
}
