/**
 * ② core 의 «테넌트 맥락 없는 실패»를 `.dlq` 토픽에서 꺼내 사람이 고른 테넌트의 실패 테이블로 옮긴다 (multi-tenant ticket 30).
 *
 * ## 왜
 *
 * ② 에서 core 가 테넌트 없는(또는 목록 밖) 테넌트 이벤트·봉투를 못 알아보는 메시지를 받으면, 어느 테넌트 DB 에도 둘 수 없어
 * 실패 테이블 대신 옛 `<토픽>.dlq` 로 보낸다(`EventRetryInterceptor`, 10-15 설계 D6 의 예외 하나). `.dlq` 는 상태가 없고
 * 구독자끼리 섞이고 **보존 기간이 지나면 사라진다** — 알림을 보면 보존 기간 안에 이 스크립트로 옮긴다.
 *
 * 옮기면 봉투에 테넌트가 붙은 `failed` 행이 된다. 그 뒤는 그 테넌트 관리자의 이벤트 실패 화면에서 «다시 넣기» —
 * 봉투에 테넌트가 있으니 ② 문을 통과하고 그 테넌트 DB 에 쓴다. Kafka 를 거치지 않으므로 다른 구독자는 다시 받지 않는다.
 * 무엇을 옮기지 않는지는 `deadLetterFromDlq` 주석.
 *
 * ## 사용법
 *
 *   # 보기만 (기본) — core 의 것만, 판정과 함께
 *   npm run events:untenanted-dlq -- --stage live --topic orders.events.v1
 *   # 옮기기 — 테넌트와 메시지를 사람이 지목한다(«전부»는 없다)
 *   npm run events:untenanted-dlq -- --stage live --topic orders.events.v1 --tenant almondyoung --message-id <id> --write
 *   # 로컬 E2E — apps/core/.env 의 DATABASE_URL·TENANT_LIST·KAFKA_BROKERS
 *   npm run events:untenanted-dlq -- --local --topic orders.events.v1
 *
 * `--stage` 는 `sst shell`(lcnine-services) 안으로 스스로 재진입한다 — DB 자격증명은 SST Resource, 테넌트 목록은 SSM
 * `/lcnine-auth/<stage>/tenant-list`, 브로커는 SSM `/lcnine-platform/<stage>/kafka-brokers`. 브로커·DB 가 VPC 안이라
 * 다른 터미널에 터널(`./scripts/sst-tunnel.sh deployments/lcnine/services <stage>`)이 떠 있어야 한다.
 * ⚠️ 라이브 브로커(Redpanda)가 터널로 닿는지는 아직 실측하지 않았다.
 *
 * 토픽을 읽을 때 일회용 컨슈머 그룹을 만들고 끝나면 지운다 — 오프셋을 커밋하지 않는다. 같은 행을 두 번 넣으면 유일 키
 * (그룹·핸들러·messageId)에 걸려 «이미 있다»로 끝난다.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka, logLevel } from 'kafkajs';
import postgres, { type Sql } from 'postgres';
import { CORE_CONSUMER_GROUP } from '../../apps/core/src/core-consumer-group';
import { connectionStringFor } from '../../libs/db/src/db.service';
import { dead_letters } from '../../libs/events/src/dead-letter/dead-letter.schema';
import { deadLetterFromDlq } from '../../libs/events/src/dead-letter/dlq-import';
import { parseTenantList, type TenantList } from '../../libs/tenancy/src/tenant-list';
import { ensureInsideSstShell } from '../seeding/lib/sst-shell-relaunch';
import { readStageTenantList, sstShellStage } from '../seeding/lib/tenant-registry';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

interface Args {
  topic: string;
  stage?: string;
  local: boolean;
  tenant?: string;
  messageIds: string[];
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { topic: '', local: false, messageIds: [], write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`${flag} 에 값이 없다`);
      i += 1;
      return next;
    };
    if (flag === '--topic') args.topic = value();
    else if (flag === '--stage') args.stage = value();
    else if (flag === '--tenant') args.tenant = value();
    else if (flag === '--message-id') args.messageIds.push(value());
    else if (flag === '--local') args.local = true;
    else if (flag === '--write') args.write = true;
    else throw new Error(`모르는 인자: ${flag}`);
  }
  if (!args.topic) throw new Error('--topic <원래 토픽> 이 필요하다 (예: orders.events.v1) — .dlq 는 붙이지 않는다');
  if (args.local === (args.stage !== undefined)) throw new Error('--local 또는 --stage <stage> 중 하나');
  if (args.write && (!args.tenant || args.messageIds.length === 0)) {
    throw new Error(
      '--write 는 --tenant <slug> 와 --message-id <id>(여럿 가능)를 함께 — 테넌트는 메시지마다 사람이 고른다',
    );
  }
  return args;
}

interface Environment {
  brokers: string[];
  tenants: TenantList;
  connect(database: string): Sql;
}

function localEnvironment(): Environment {
  const env = parseDotenv(readFileSync('apps/core/.env'));
  const url = env.DATABASE_URL;
  if (!url || !env.KAFKA_BROKERS) throw new Error('apps/core/.env 에 DATABASE_URL·KAFKA_BROKERS 가 없다');
  return {
    brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
    tenants: parseTenantList(env.TENANT_LIST),
    connect: (database) => postgres(connectionStringFor(url, database), { max: 1, onnotice: () => undefined }),
  };
}

async function stageEnvironment(stage: string): Promise<Environment> {
  await ensureInsideSstShell({ stage, deployment: 'lcnine-services' });
  const shellStage = sstShellStage(process.env);
  if (shellStage !== stage) throw new Error(`sst shell 의 stage(${shellStage}) 가 --stage ${stage} 와 다르다`);
  const { createServiceConnection } = await import('../seeding/lib/db-connection');
  const brokers = execFileSync(
    'aws',
    [
      'ssm',
      'get-parameter',
      '--name',
      `/lcnine-platform/${stage}/kafka-brokers`,
      '--with-decryption',
      '--query',
      'Parameter.Value',
      '--output',
      'text',
    ],
    { encoding: 'utf8', env: { ...process.env, AWS_REGION: REGION }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return {
    brokers: brokers
      .trim()
      .split(',')
      .map((b) => b.trim()),
    tenants: readStageTenantList(stage),
    connect: (database) => createServiceConnection(database, { max: 1, prepare: false }),
  };
}

/** 새 메시지가 이만큼 오지 않으면 읽기를 끝낸다 — 끝 오프셋이 오지 않는 경우(트랜잭션 표식·압축 틈·보존 삭제)에도 멈추지 않게 */
const IDLE_MS = 15_000;

interface DlqRead {
  messages: unknown[];
  /** JSON 이 아닌 기록 — 이 도구가 만든 모양이 아니다. 세기만 한다 */
  unparsable: number;
  /** 끝까지 못 읽은 파티션(쉬는 시간에 걸렸다) */
  unfinished: number[];
}

/** `.dlq` 토픽을 처음부터 지금 끝까지 읽는다. 토픽이 없으면 빈 결과 */
async function readDlqTopic(brokers: string[], topic: string): Promise<DlqRead> {
  const read: DlqRead = { messages: [], unparsable: 0, unfinished: [] };
  const kafka = new Kafka({ clientId: 'untenanted-dlq-import', brokers, logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  try {
    if (!(await admin.listTopics()).includes(topic)) return read;
    const ends = new Map(
      (await admin.fetchTopicOffsets(topic))
        .filter((p) => BigInt(p.high) > BigInt(p.low))
        .map((p) => [p.partition, BigInt(p.high)]),
    );
    if (ends.size === 0) return read;

    const groupId = `untenanted-dlq-import-${process.pid}-${Date.now()}`;
    const consumer = kafka.consumer({ groupId });
    await consumer.connect();
    try {
      await consumer.subscribe({ topic, fromBeginning: true });
      await new Promise<void>((resolve, reject) => {
        let idle = setTimeout(resolve, IDLE_MS);
        const finish = () => {
          clearTimeout(idle);
          resolve();
        };
        consumer.on(consumer.events.CRASH, (event) => {
          clearTimeout(idle);
          reject(event.payload.error);
        });
        consumer
          .run({
            autoCommit: false,
            eachMessage: ({ partition, message }) => {
              clearTimeout(idle);
              idle = setTimeout(resolve, IDLE_MS);
              try {
                if (message.value) read.messages.push(JSON.parse(message.value.toString('utf-8')) as unknown);
              } catch {
                read.unparsable += 1;
              }
              const end = ends.get(partition);
              if (end !== undefined && BigInt(message.offset) + 1n >= end) ends.delete(partition);
              if (ends.size === 0) finish();
              return Promise.resolve();
            },
          })
          .catch(reject);
      });
      read.unfinished = [...ends.keys()];
    } finally {
      await consumer.disconnect();
      await admin.deleteGroups([groupId]).catch(() => undefined);
    }
    return read;
  } finally {
    await admin.disconnect();
  }
}

function summarize(message: unknown): {
  messageId: string;
  eventType: string;
  aggregateId: string;
  tenant: string;
  failedAt: string;
} {
  const pick = (value: unknown, ...path: string[]): string => {
    let at: unknown = value;
    for (const key of path) {
      at = at !== null && typeof at === 'object' ? Object.entries(at).find(([k]) => k === key)?.[1] : undefined;
    }
    return typeof at === 'string' ? at : '-';
  };
  return {
    messageId: pick(message, 'originalMessage', 'messageId'),
    eventType: pick(message, 'originalMessage', 'messageType'),
    aggregateId: pick(message, 'originalMessage', 'source', 'aggregateId'),
    tenant: pick(message, 'originalMessage', 'metadata', 'tenantId'),
    failedAt: pick(message, 'failedAt'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = args.local ? localEnvironment() : await stageEnvironment(args.stage ?? '');
  const dlqTopic = `${args.topic}.dlq`;
  const tenant = args.tenant ? env.tenants.entries.find((t) => t.slug === args.tenant) : undefined;
  if (args.tenant && !tenant) {
    throw new Error(
      `테넌트 slug «${args.tenant}» 가 목록에 없다 — ${env.tenants.entries.map((t) => t.slug).join(', ')}`,
    );
  }

  const { messages: all, unparsable, unfinished } = await readDlqTopic(env.brokers, dlqTopic);
  const ours = all
    .map((message) => {
      const info = summarize(message);
      // 지목이 없으면(보기만) 봉투가 이미 목록 테넌트면 그 테넌트로, 아니면 아무 목록 테넌트로 묻는다 — «옮길 수 있음»이
      // 어떤 테넌트로든 옮길 수 있다는 뜻이 되게. 쓸 때는 지목한 테넌트로 다시 판정한다
      const probe = tenant?.id ?? env.tenants.find(info.tenant)?.id ?? env.tenants.entries[0].id;
      const verdict = deadLetterFromDlq(message, {
        consumerGroup: CORE_CONSUMER_GROUP,
        tenantId: probe,
        tenants: env.tenants,
      });
      return { message, info, verdict };
    })
    .filter(({ verdict }) => verdict.kind === 'import' || verdict.code !== 'other-consumer');

  if (unparsable > 0) console.warn(`⚠️ JSON 이 아닌 기록 ${unparsable}건은 건너뛰었다`);
  if (unfinished.length > 0) {
    console.warn(
      `⚠️ 파티션 ${unfinished.join(', ')} 은 끝까지 읽지 못했다(${IDLE_MS / 1000}초 동안 새 기록 없음) — 다시 돌릴 것`,
    );
  }
  console.log(`${dlqTopic}: 전체 ${all.length}건 중 core(${CORE_CONSUMER_GROUP}) 의 것 ${ours.length}건`);
  for (const { info, verdict } of ours) {
    const note = verdict.kind === 'import' ? '옮길 수 있음' : `옮기지 않음 — ${verdict.reason}`;
    console.log(
      `  ${info.messageId}  ${info.eventType}  aggregate=${info.aggregateId}  tenant=${info.tenant}  failedAt=${info.failedAt}  ${note}`,
    );
  }
  if (!args.write || !tenant) {
    if (ours.length > 0) console.log('\n옮기려면 --tenant <slug> --message-id <id> --write');
    return;
  }

  const missing = args.messageIds.filter((id) => !ours.some(({ info }) => info.messageId === id));
  if (missing.length > 0) throw new Error(`이 토픽의 core 실패에 없는 messageId: ${missing.join(', ')}`);

  const sql = env.connect(tenant.coreDb);
  try {
    const db = drizzle(sql);
    for (const { message, info } of ours.filter(({ info }) => args.messageIds.includes(info.messageId))) {
      const verdict = deadLetterFromDlq(message, {
        consumerGroup: CORE_CONSUMER_GROUP,
        tenantId: tenant.id,
        tenants: env.tenants,
      });
      if (verdict.kind === 'skip') {
        console.log(`  ${info.messageId}: 옮기지 않음 — ${verdict.reason}`);
        continue;
      }
      const [row] = await db
        .insert(dead_letters)
        .values(verdict.row)
        .onConflictDoNothing({ target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId] })
        .returning({ id: dead_letters.id });
      console.log(
        row
          ? `  ${info.messageId}: 테넌트 ${tenant.slug} 의 실패 테이블에 넣었다 (dead_letters.id=${row.id})`
          : `  ${info.messageId}: 이미 있다 — 그대로 둔다`,
      );
    }
    console.log(`\n다음: 테넌트 ${tenant.slug} 관리자의 이벤트 실패 화면에서 그 행을 «다시 넣기»`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
