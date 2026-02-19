#!/usr/bin/env ts-node
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import postgres from 'postgres';

type CliOptions = {
  id?: string;
  messageId?: string;
  envPath: string;
  reason: string;
  keepAttempts: boolean;
  force: boolean;
  dryRun: boolean;
};

type OutboxEventRow = {
  id: string;
  message_id: string;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  dead_lettered_at: Date | null;
  dead_letter_reason: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: Date;
};

function printHelp(): void {
  console.log(`
Requeue one wallet outbox event.

Usage:
  ts-node scripts/wallet/requeue-outbox-event.ts --id <outbox-id> [options]
  ts-node scripts/wallet/requeue-outbox-event.ts --message-id <message-id> [options]

Options:
  --id <uuid>               Outbox event id
  --message-id <id>         Outbox message id
  --env <path>              Env file path (default: apps/wallet/.env)
  --reason <text>           Reason note stored in last_error_message
                            (default: manually requeued by operator)
  --keep-attempts           Keep current attempts count (default resets to 0)
  --force                   Allow requeue from any status
  --dry-run                 Show target row without updating
  --help                    Show this help
`);
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const id = options.id ? String(options.id).trim() : undefined;
  const messageId = options['message-id']
    ? String(options['message-id']).trim()
    : undefined;

  if ((!id && !messageId) || (id && messageId)) {
    throw new Error('Exactly one of --id or --message-id must be provided.');
  }

  return {
    id,
    messageId,
    envPath: options.env
      ? String(options.env)
      : path.join(process.cwd(), 'apps', 'wallet', '.env'),
    reason: options.reason
      ? String(options.reason)
      : 'manually requeued by operator',
    keepAttempts: Boolean(options['keep-attempts']),
    force: Boolean(options.force),
    dryRun: Boolean(options['dry-run']),
  };
}

function loadEnv(envPath: string): void {
  dotenv.config({ path: envPath, override: false });
  dotenv.config({
    path: path.join(path.dirname(envPath), '.env.local'),
    override: false,
  });
}

function assertDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  return databaseUrl;
}

function assertRequeueAllowed(row: OutboxEventRow, force: boolean): void {
  if (force) {
    return;
  }
  if (row.status === 'DEAD_LETTER' || row.status === 'FAILED') {
    return;
  }
  throw new Error(
    `Outbox event status ${row.status} is not requeueable without --force.`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();
  loadEnv(options.envPath);
  const databaseUrl = assertDatabaseUrl();

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const rows = options.id
      ? await sql<OutboxEventRow[]>`
          select
            id,
            message_id,
            status,
            attempts,
            next_attempt_at,
            dead_lettered_at,
            dead_letter_reason,
            last_error_code,
            last_error_message,
            updated_at
          from outbox_events
          where id = ${options.id}
          limit 1
        `
      : await sql<OutboxEventRow[]>`
          select
            id,
            message_id,
            status,
            attempts,
            next_attempt_at,
            dead_lettered_at,
            dead_letter_reason,
            last_error_code,
            last_error_message,
            updated_at
          from outbox_events
          where message_id = ${options.messageId!}
          limit 1
        `;

    const current = rows[0];
    if (!current) {
      throw new Error('Outbox event not found.');
    }

    assertRequeueAllowed(current, options.force);

    if (options.dryRun) {
      console.log('[dry-run] matched outbox event:');
      console.log(
        JSON.stringify(
          {
            id: current.id,
            messageId: current.message_id,
            status: current.status,
            attempts: current.attempts,
            nextAttemptAt: current.next_attempt_at,
            deadLetteredAt: current.dead_lettered_at,
            deadLetterReason: current.dead_letter_reason,
          },
          null,
          2,
        ),
      );
      return;
    }

    const nextAttempts = options.keepAttempts ? current.attempts : 0;
    const updatedRows = await sql<OutboxEventRow[]>`
      update outbox_events
      set
        status = 'PENDING',
        attempts = ${nextAttempts},
        next_attempt_at = now(),
        published_at = null,
        dead_lettered_at = null,
        dead_letter_reason = null,
        last_error_code = 'OUTBOX_MANUAL_REQUEUE',
        last_error_message = ${options.reason},
        updated_at = now()
      where id = ${current.id}
      returning
        id,
        message_id,
        status,
        attempts,
        next_attempt_at,
        dead_lettered_at,
        dead_letter_reason,
        last_error_code,
        last_error_message,
        updated_at
    `;

    const updated = updatedRows[0];
    console.log('Outbox event requeued:');
    console.log(
      JSON.stringify(
        {
          id: updated.id,
          messageId: updated.message_id,
          previousStatus: current.status,
          status: updated.status,
          previousAttempts: current.attempts,
          attempts: updated.attempts,
          nextAttemptAt: updated.next_attempt_at,
          lastErrorCode: updated.last_error_code,
          lastErrorMessage: updated.last_error_message,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`requeue-outbox-event failed: ${message}`);
  process.exit(1);
});

