import { useParams } from '@tanstack/react-router';
import { PlanReceiveScreen } from '../../domains/inbound/PlanReceiveScreen';

export function PlanReceiveRoute() {
  const { planId } = useParams({ strict: false });
  return <PlanReceiveScreen planId={planId ?? ''} />;
}
