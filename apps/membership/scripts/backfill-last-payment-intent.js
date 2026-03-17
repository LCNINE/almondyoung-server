#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function parseArgs(argv) {
  const args = {
    apply: false,
    limit: 500,
    windowMinutes: 30,
    from: null,
    to: null,
    userId: null,
    membershipUrl: null,
    walletUrl: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--window-minutes') args.windowMinutes = Number(argv[++i]);
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--membership-url') args.membershipUrl = argv[++i];
    else if (a === '--wallet-url') args.walletUrl = argv[++i];
    else if (a === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node apps/membership/scripts/backfill-last-payment-intent.js [options]

Options:
  --apply                    실제 업데이트 실행 (기본: dry-run/audit)
  --limit <n>                최대 처리 건수 (기본: 500)
  --window-minutes <n>       계약생성시각 기준 매칭 시간창 분 (기본: 30)
  --from <YYYY-MM-DD>        계약 created_at 시작일(UTC)
  --to <YYYY-MM-DD>          계약 created_at 종료일(UTC, inclusive date)
  --user-id <id>             특정 user_id만 처리
  --membership-url <url>     membership DB URL override
  --wallet-url <url>         wallet DB URL override
  --help

Env:
  MEMBERSHIP_DATABASE_URL    membership DB URL
  WALLET_DATABASE_URL        wallet DB URL
`);
}

function loadMembershipUrlFromEnvFile() {
  const envPath = path.join(process.cwd(), 'apps/membership/.env');
  if (!fs.existsSync(envPath)) return null;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const line = lines.find((l) => l.startsWith('DATABASE_URL='));
  if (!line) return null;
  return line.slice('DATABASE_URL='.length).trim().replace(/^'/, '').replace(/'$/, '');
}

function toUtcRange(fromDate, toDate) {
  const from = fromDate ? `${fromDate}T00:00:00.000Z` : null;
  const to = toDate ? `${toDate}T23:59:59.999Z` : null;
  return { from, to };
}

async function queryContracts(membership, opts) {
  const { from, to } = toUtcRange(opts.from, opts.to);
  const params = [];
  const where = ['c.last_payment_intent_id IS NULL'];

  if (from) {
    params.push(from);
    where.push(`c.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`c.created_at <= $${params.length}::timestamptz`);
  }
  if (opts.userId) {
    params.push(opts.userId);
    where.push(`c.user_id = $${params.length}`);
  }

  params.push(opts.limit);
  const sql = `
    SELECT
      c.id,
      c.user_id,
      c.plan_id,
      c.created_at,
      c.status,
      c.last_payment_intent_id,
      c.wallet_reference_id,
      p.price AS plan_price
    FROM subscription_contracts c
    JOIN plan p ON p.id = c.plan_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.created_at ASC
    LIMIT $${params.length}
  `;

  const r = await membership.query(sql, params);
  return r.rows;
}

async function findWalletCandidate(wallet, contract, windowMinutes) {
  const start = new Date(new Date(contract.created_at).getTime() - windowMinutes * 60 * 1000);
  const end = new Date(new Date(contract.created_at).getTime() + windowMinutes * 60 * 1000);

  const q = `
    SELECT
      pi.id,
      pi.user_id,
      pi.payable_amount,
      pi.status,
      pi.created_at,
      pi.metadata,
      ABS(EXTRACT(EPOCH FROM (pi.created_at - $2::timestamptz))) AS diff_sec
    FROM payment_intents pi
    WHERE pi.user_id = $1
      AND pi.payable_amount = $3
      AND pi.status IN ('AUTHORIZED', 'CAPTURED', 'SUCCEEDED')
      AND pi.created_at BETWEEN $4::timestamptz AND $5::timestamptz
      AND (pi.metadata->>'type' = 'MEMBERSHIP_FEE' OR pi.metadata->>'type' IS NULL)
    ORDER BY diff_sec ASC, pi.created_at ASC
    LIMIT 10
  `;

  const r = await wallet.query(q, [
    contract.user_id,
    contract.created_at,
    Number(contract.plan_price),
    start.toISOString(),
    end.toISOString(),
  ]);

  if (r.rows.length === 0) return { chosen: null, candidates: [] };

  const planMatched = r.rows.filter((row) => row.metadata?.planId === contract.plan_id);
  const candidates = planMatched.length > 0 ? planMatched : r.rows;
  const chosen = candidates[0];
  const ambiguous =
    candidates.length > 1 && Number(candidates[0].diff_sec) === Number(candidates[1].diff_sec);

  return { chosen: ambiguous ? null : chosen, candidates };
}

async function findWalletReference(wallet, intentId) {
  const q = `
    SELECT provider_transaction_id
    FROM charges
    WHERE intent_id = $1::uuid
      AND provider_transaction_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const r = await wallet.query(q, [intentId]);
  return r.rows[0]?.provider_transaction_id ?? null;
}

async function run() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const membershipUrl =
    opts.membershipUrl ||
    process.env.MEMBERSHIP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    loadMembershipUrlFromEnvFile();
  const walletUrl = opts.walletUrl || process.env.WALLET_DATABASE_URL || null;

  if (!membershipUrl) {
    throw new Error('membership DB URL is missing. Set MEMBERSHIP_DATABASE_URL or --membership-url');
  }

  const membership = new Client({ connectionString: membershipUrl });
  await membership.connect();

  try {
    const contracts = await queryContracts(membership, opts);

    if (!walletUrl) {
      console.log(
        JSON.stringify(
          {
            mode: 'audit-only',
            reason: 'wallet DB URL not provided',
            pendingContracts: contracts.length,
            sample: contracts.slice(0, 20),
          },
          null,
          2,
        ),
      );
      return;
    }

    const wallet = new Client({ connectionString: walletUrl });
    await wallet.connect();
    try {
      const results = [];
      let updated = 0;
      let ambiguous = 0;
      let noMatch = 0;

      for (const contract of contracts) {
        const match = await findWalletCandidate(wallet, contract, opts.windowMinutes);
        if (!match.chosen) {
          if (match.candidates.length === 0) noMatch += 1;
          else ambiguous += 1;
          results.push({
            contractId: contract.id,
            userId: contract.user_id,
            status: match.candidates.length === 0 ? 'no_match' : 'ambiguous',
            candidates: match.candidates.slice(0, 3).map((c) => ({
              id: c.id,
              status: c.status,
              created_at: c.created_at,
              diff_sec: Number(c.diff_sec),
              planId: c.metadata?.planId ?? null,
            })),
          });
          continue;
        }

        const walletRef = await findWalletReference(wallet, match.chosen.id);
        const row = {
          contractId: contract.id,
          userId: contract.user_id,
          status: opts.apply ? 'updated' : 'would_update',
          intentId: match.chosen.id,
          walletReferenceId: walletRef,
          matchedAt: match.chosen.created_at,
          diffSec: Number(match.chosen.diff_sec),
        };

        if (opts.apply) {
          await membership.query(
            `
              UPDATE subscription_contracts
              SET last_payment_intent_id = $2,
                  wallet_reference_id = COALESCE(wallet_reference_id, $3),
                  updated_at = now()
              WHERE id = $1::uuid
                AND last_payment_intent_id IS NULL
            `,
            [contract.id, match.chosen.id, walletRef],
          );
          updated += 1;
        }
        results.push(row);
      }

      console.log(
        JSON.stringify(
          {
            mode: opts.apply ? 'apply' : 'dry-run',
            scanned: contracts.length,
            updated,
            noMatch,
            ambiguous,
            results,
          },
          null,
          2,
        ),
      );
    } finally {
      await wallet.end();
    }
  } finally {
    await membership.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
