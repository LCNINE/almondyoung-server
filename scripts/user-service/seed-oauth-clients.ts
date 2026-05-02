/**
 * env(OAUTH_CLIENTS) → DB(oauth_clients) 1회 시드.
 *
 * 사용:
 *   OAUTH_CLIENTS='[{"clientId":"...","clientSecretHash":"...","redirectUris":["..."],"allowedScopes":["..."]}]' \
 *   DATABASE_URL=postgres://... \
 *   npx tsx scripts/user-service/seed-oauth-clients.ts
 *
 * - 동일 clientId 가 이미 있으면 skip (멱등). 강제 갱신은 admin API 또는 --force 옵션.
 * - clientSecretHash 는 env 에 들어 있던 bcrypt 해시를 그대로 옮겨 심는다(원문 secret 은 운영자가 보관).
 */
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from '../../apps/user-service/database/drizzle/schema';

const oauthClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecretHash: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  allowedScopes: z.array(z.string()).optional(),
});
const oauthClientsSchema = z.array(oauthClientSchema);

async function main(): Promise<void> {
  config();
  config({ path: '.env.local', override: false });

  const databaseUrl = process.env.DATABASE_URL;
  const raw = process.env.OAUTH_CLIENTS;
  const force = process.argv.includes('--force');

  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }
  if (!raw) {
    console.log('OAUTH_CLIENTS env not set — nothing to seed');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`OAUTH_CLIENTS must be JSON: ${(e as Error).message}`);
  }
  const clients = oauthClientsSchema.parse(parsed);

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { schema });

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const c of clients) {
    const [existing] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, c.clientId))
      .limit(1);

    if (existing && !force) {
      console.log(`  skip  ${c.clientId} (already exists)`);
      skipped += 1;
      continue;
    }

    if (existing && force) {
      await db
        .update(schema.oauthClients)
        .set({
          clientSecretHash: c.clientSecretHash,
          redirectUris: c.redirectUris,
          allowedScopes: c.allowedScopes ?? null,
          isActive: true,
          deactivatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.oauthClients.clientId, c.clientId));
      console.log(`  upd   ${c.clientId}`);
      updated += 1;
      continue;
    }

    await db.insert(schema.oauthClients).values({
      clientId: c.clientId,
      clientSecretHash: c.clientSecretHash,
      redirectUris: c.redirectUris,
      allowedScopes: c.allowedScopes ?? null,
    });
    console.log(`  ins   ${c.clientId}`);
    inserted += 1;
  }

  await sql.end({ timeout: 5 });

  console.log(`\ndone: inserted=${inserted} updated=${updated} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
