import { useParams } from '@tanstack/react-router';
import { SessionCountScreen } from '../../domains/stocktaking/SessionCountScreen';

export function StocktakingSessionRoute() {
  const { sessionId } = useParams({ strict: false });
  return <SessionCountScreen sessionId={sessionId ?? ''} />;
}
