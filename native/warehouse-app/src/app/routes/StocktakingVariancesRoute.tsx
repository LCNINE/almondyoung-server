import { useParams } from '@tanstack/react-router';
import { VarianceReviewScreen } from '../../domains/stocktaking/VarianceReviewScreen';

export function StocktakingVariancesRoute() {
  const { sessionId } = useParams({ strict: false });
  return <VarianceReviewScreen sessionId={sessionId ?? ''} />;
}
