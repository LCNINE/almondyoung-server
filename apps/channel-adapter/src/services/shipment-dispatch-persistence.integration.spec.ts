import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_CHANNEL_DISPATCH_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the channel dispatch persistence integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('shipment dispatch persistence migration', () => {
  let sql: postgres.Sql;
  let schema: string;

  beforeEach(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    schema = `channel_dispatch_${randomUUID().replaceAll('-', '')}`;
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await sql.unsafe(`SET search_path TO "${schema}"`);
    await sql.unsafe(`
      CREATE TABLE inbox_events (
        id uuid PRIMARY KEY,
        event_type varchar(100) NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);

    const migration = readFileSync(
      resolve(process.cwd(), 'apps/channel-adapter/drizzle/20260714040216_flawless_whirlwind.sql'),
      'utf8',
    );
    const schemaScopedMigration = migration.replaceAll('"public"."inbox_events"', `"${schema}"."inbox_events"`);
    for (const statement of schemaScopedMigration
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
  });

  afterEach(async () => {
    await sql.unsafe('SET search_path TO public');
    await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  it('enforces inbox idempotency and one operation per attempt/order/operation', async () => {
    const inboxId = randomUUID();
    const duplicateInboxId = randomUUID();
    await sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${inboxId}, 'ShipmentShipped', 'attempt-1')
    `;
    await expect(sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${duplicateInboxId}, 'ShipmentShipped', 'attempt-1')
    `).rejects.toMatchObject({ code: '23505' });

    const operationInboxId = randomUUID();
    await sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${operationInboxId}, 'ShipmentShipped', 'attempt-2')
    `;
    const attemptId = randomUUID();
    const shipmentId = randomUUID();
    const salesOrderId = randomUUID();
    const insertOperation = (id: string, operationInboxId: string) => sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key, request_snapshot
      ) VALUES (
        ${id}, ${operationInboxId}, ${attemptId}, ${shipmentId}, ${salesOrderId},
        'dispatch', 'naver', '1000000001', 'provider-key-1', '{}'::jsonb
      )
    `;
    await insertOperation(randomUUID(), inboxId);
    await expect(insertOperation(randomUUID(), operationInboxId)).rejects.toMatchObject({ code: '23505' });
  });

  it('supports durable manual cancellation without a shipment or dispatch attempt', async () => {
    const inboxId = randomUUID();
    const salesOrderId = randomUUID();
    await sql`INSERT INTO inbox_events (id, event_type) VALUES (${inboxId}, 'CoreOrderCancelled')`;
    await sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key,
        request_snapshot, status, error_message
      ) VALUES (
        ${randomUUID()}, ${inboxId}, NULL, NULL, ${salesOrderId},
        'cancel', 'coupang', '9001', 'cancel-key', '{}'::jsonb,
        'manual_adjustment_required', 'manual cancellation required'
      )
    `;

    const [row] = await sql`
      SELECT operation, status, dispatch_attempt_id, shipment_id
      FROM channel_dispatch_operations
      WHERE inbox_event_id = ${inboxId}
    `;
    expect(row).toMatchObject({
      operation: 'cancel',
      status: 'manual_adjustment_required',
      dispatch_attempt_id: null,
      shipment_id: null,
    });
  });

  it('atomically reclaims a processing operation only after its lease expires', async () => {
    const operationId = randomUUID();
    const inboxId = randomUUID();
    await sql`INSERT INTO inbox_events (id, event_type) VALUES (${inboxId}, 'ShipmentShipped')`;
    await sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key,
        request_snapshot, status, attempts, processing_started_at, lease_expires_at
      ) VALUES (
        ${operationId}, ${inboxId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()},
        'dispatch', 'naver', '1000000001', 'lease-key', '{}'::jsonb,
        'processing', 1, now() - interval '10 minutes', now() - interval '1 minute'
      )
    `;

    const [claimed] = await sql`
      UPDATE channel_dispatch_operations
      SET status = 'processing',
          attempts = attempts + 1,
          processing_started_at = now(),
          lease_expires_at = now() + interval '5 minutes'
      WHERE id = (
        SELECT id FROM channel_dispatch_operations
        WHERE status = 'processing' AND lease_expires_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING attempts, lease_expires_at, lease_expires_at > now()::timestamp AS lease_active
    `;

    expect(claimed.attempts).toBe(2);
    expect(claimed.lease_active).toBe(true);
  });
});
