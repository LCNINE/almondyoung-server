import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ReviewRow } from './reviews';

export async function secretJson<T>(region: string, secretId: string): Promise<T> {
  const client = new SecretsManagerClient({ region, maxAttempts: 2 });
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }), {
    abortSignal: AbortSignal.timeout(20000),
  });
  if (!result.SecretString) throw new Error('Required secret is unavailable');

  try {
    return JSON.parse(result.SecretString) as T;
  } catch {
    throw new Error('Required secret is not valid JSON');
  }
}

export class ReadonlyDatabases {
  readonly channel: Client;
  readonly ugc: Client;
  private lockLost = false;
  private readonly startedAt = new Date();

  constructor(host: string, port: number, credentials: { username: string; password: string }, caFile: string) {
    if (!credentials.username || !credentials.password) throw new Error('Missing database credentials');
    const config = {
      host,
      port,
      user: credentials.username,
      password: credentials.password,
      ssl: { rejectUnauthorized: true, ca: readFileSync(caFile, 'utf8') },
      options: '-c default_transaction_read_only=on -c timezone=UTC',
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      application_name: 'night-maintenance-readonly',
    };
    this.channel = new Client({ ...config, database: 'channel_adapter' });
    this.ugc = new Client({ ...config, database: 'ugc' });
    this.channel.on('error', () => {
      this.lockLost = true;
    });
    this.ugc.on('error', () => {
      this.lockLost = true;
    });
  }

  async connect(): Promise<void> {
    await this.channel.connect();
    await this.ugc.connect();
    const result = await this.channel.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('almondyoung-night-maintenance'), hashtext('exclusive-runtime')) as locked",
    );
    if (!result.rows[0]?.locked) throw new Error('Another maintenance task already owns the lock');
  }

  async assertLock(): Promise<void> {
    if (this.lockLost) throw new Error('Maintenance database lock connection lost');
    await this.channel.query('select 1');
  }

  async load() {
    const channel = (
      await this.channel.query<{
        membership: number;
        stale: number;
        unmarked: number;
        failures: number;
      }>(
        `
      select count(*) filter(where event_type='MembershipStatusChanged' and status='pending' and next_attempt_at<=now())::int as membership,
             count(*) filter(where status='processing' and next_attempt_at<=now())::int as stale,
             count(*) filter(where event_type='ProductMasterActiveVersionChanged' and status='pending'
               and next_attempt_at<=now() and coalesce(metadata->>'origin','')<>'bulk_import')::int as unmarked,
             count(*) filter(where status='failed' and failed_at>=$1)::int as failures
      from inbox_events where status in ('pending','processing','failed')
    `,
        [this.startedAt],
      )
    ).rows[0];
    const ugc = (
      await this.ugc.query<{ pending: number; oldest: number; failed: number }>(
        `
      select count(*) filter(where status in ('PENDING','PROCESSING'))::int as pending,
             coalesce(max(extract(epoch from (now()-created_at))) filter(where status in ('PENDING','PROCESSING')),0)::float as oldest,
             count(*) filter(where status='FAILED' and failed_at>=$1)::int as failed
      from event.outbox_events where status in ('PENDING','PROCESSING','FAILED')
    `,
        [this.startedAt],
      )
    ).rows[0];

    return {
      membershipPending: channel.membership,
      staleProcessing: channel.stale,
      unmarkedProductPending: channel.unmarked,
      ugcPending: ugc.pending,
      ugcOldestSeconds: ugc.oldest,
      newUgcFailures: ugc.failed,
      newChannelFailures: channel.failures,
    };
  }

  async eligibleReviews(): Promise<ReviewRow[]> {
    return (
      await this.ugc.query<ReviewRow>(`
      select r.id, r.product_id as "productId", r.rating, r.status,
             e.provider, r.deleted_at::text as "deletedAt"
      from reviews r join review_eligibilities e on e.id=r.review_permission_id
      where e.provider='admin' and r.deleted_at is null and r.rating in (2,3)
      order by r.id
    `)
    ).rows;
  }

  async review(id: string): Promise<ReviewRow | undefined> {
    return (
      await this.ugc.query<ReviewRow>(
        `
      select r.id, r.product_id as "productId", r.rating, r.status,
             e.provider, r.deleted_at::text as "deletedAt"
      from reviews r join review_eligibilities e on e.id=r.review_permission_id
      where r.id=$1
    `,
        [id],
      )
    ).rows[0];
  }

  async reviewCounts(productIds: string[]) {
    return (
      await this.ugc.query<{ productId: string; reviewCount: number; averageRating: number }>(
        `
      select product_id as "productId", count(*)::int as "reviewCount",
             round(avg(rating)::numeric,1)::float as "averageRating"
      from reviews where product_id=any($1::uuid[]) and deleted_at is null and status='active'
      group by product_id
    `,
        [productIds],
      )
    ).rows;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.channel.end(), this.ugc.end()]);
  }
}
