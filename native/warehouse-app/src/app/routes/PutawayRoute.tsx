import { useSearch } from '@tanstack/react-router';
import { PutawayQueueScreen } from '../../domains/inbound/PutawayQueueScreen';

export function PutawayRoute() {
  const search = useSearch({ from: '/_authed/putaway' });
  return <PutawayQueueScreen {...search} />;
}
