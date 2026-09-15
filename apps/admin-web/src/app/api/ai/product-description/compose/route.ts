import { requireAiClient } from '../_lib/anthropic';
import {
  composeProductDescription,
  type ComposeRequest,
} from '../_lib/compose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAiClient();
  if (guard.error) return guard.error;

  const body = (await request.json()) as ComposeRequest;
  return composeProductDescription(guard.client, body);
}
