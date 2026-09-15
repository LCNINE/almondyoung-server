import { requireAiClient } from '../_lib/anthropic';
import { extractProductFacts } from '../_lib/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
  fileIds: string[];
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAiClient();
  if (guard.error) return guard.error;

  const body = (await request.json()) as RequestBody;
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter(Boolean)
    : [];
  return extractProductFacts(guard.client, fileIds);
}
