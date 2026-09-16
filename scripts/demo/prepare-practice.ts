import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const inputSchema = z
  .object({
    requestId: z.string().uuid(),
    items: z
      .array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }))
      .min(1)
      .max(50),
    prepareDemand: z.boolean().default(false),
  })
  .strict();

/** A saved request UUID is required so an operator can replay an uncertain result safely. */
export function parsePracticeFile(value: unknown) {
  const parsed = inputSchema.parse(value);
  if (new Set(parsed.items.map((item) => item.skuId)).size !== parsed.items.length) throw new Error('Duplicate SKU');
  return parsed;
}

export function practiceEndpoint(env: NodeJS.ProcessEnv): string {
  if (env.APP_STAGE !== 'demo' || env.EXTERNAL_INTEGRATIONS_MODE !== 'mock')
    throw new Error('Demo mock environment required');
  const url = new URL(env.DEMO_CORE_URL ?? 'https://core.almondyoung-next.com');
  if (
    url.origin !== 'https://core.almondyoung-next.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Only the verified demo Core origin is allowed');
  }
  return `${url.origin}/demo/practice`;
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--request', '--out', '--apply']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || values.has(key)) throw new Error('Use --request FILE [--out FILE] [--apply]');
    if (key === '--apply') values.set(key, 'true');
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing ${key} value`);
      values.set(key, value);
    }
  }
  const file = values.get('--request');
  if (!file) throw new Error('A saved request file is required');
  const request = parsePracticeFile(JSON.parse(await readFile(resolve(file), 'utf8')));
  const endpoint = practiceEndpoint(process.env);
  if (!values.has('--apply')) {
    console.log(
      JSON.stringify({
        mode: 'check',
        requestId: request.requestId,
        skus: request.items.length,
        prepareDemand: request.prepareDemand,
      }),
    );
    return;
  }
  const token = process.env.DEMO_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error('DEMO_ADMIN_ACCESS_TOKEN is required');
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Demo preparation returned HTTP ${response.status}; retain the same request file when checking an uncertain result`,
    );
  const result: unknown = await response.json();
  const out = values.get('--out');
  if (out) await writeFile(resolve(out), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      mode: 'apply',
      requestId: request.requestId,
      skus: request.items.length,
      resultFileWritten: !!out,
    }),
  );
}
if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Preparation failed');
    process.exitCode = 1;
  });
