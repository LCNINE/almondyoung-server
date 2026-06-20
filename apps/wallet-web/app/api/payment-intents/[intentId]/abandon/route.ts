import { proxyPaymentIntentAction } from '../proxy';

export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  return proxyPaymentIntentAction(request, intentId, 'abandon');
}
