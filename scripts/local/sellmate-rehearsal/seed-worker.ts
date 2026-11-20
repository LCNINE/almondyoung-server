/**
 * 로컬 작업자 계정 `worker01` — 컷오버 리허설은 작업자 계정으로 한다(#1251, 런북 §11).
 *
 * 관리자(`admin`)로 돌리면 작업자 권한의 구멍이 안 보인다. 그래서 `logistics_worker` 역할 «하나만» 가진 테넌트 1 계정을 만든다.
 * 역할의 권한은 카탈로그(`grantOnFirstRegistration`)가 user-service 부팅 때 준 그대로다 — 여기서 권한을 더하지 않는다.
 *
 * 멱등: 이미 있으면 비밀번호·역할만 맞춘다(다른 역할이 붙어 있으면 떼어 «하나만»을 지킨다). 로컬 시드 비밀번호는
 * scripts/local/seed-user-service-local.ts 와 같은 값이다.
 *
 * 사용: npx tsx scripts/local/sellmate-rehearsal/seed-worker.ts
 */
import * as bcrypt from 'bcrypt';
import postgres from 'postgres';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
const DATABASE_URL = process.env.USER_SERVICE_DATABASE_URL ?? `${LOCAL_PG}/user_service`;
const PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? 'Rehearsal1234!';
const LOGIN_ID = 'worker01';
const ROLE = 'logistics_worker';
const TENANT = '1';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
  throw new Error('로컬 전용 스크립트다. USER_SERVICE_DATABASE_URL 이 localhost 가 아니다');
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    const [role] = await sql<{ role_id: string }[]>`select role_id from roles where name = ${ROLE}`;
    if (!role) throw new Error(`역할 ${ROLE} 이 없다 — user-service 를 한 번 띄워 카탈로그를 등록한 뒤 다시`);
    const hash = await bcrypt.hash(PASSWORD, 10);
    // 문장마다 멱등이라 트랜잭션으로 묶지 않는다(중간에 죽으면 다시 돌린다).
    const [user] = await sql<{ id: string }[]>`
      insert into users (login_id, username, nickname, email, password, is_email_verified, tenant_id)
      values (${LOGIN_ID}, ${'Worker 01'}, ${'작업자1'}, ${'worker01@rehearsal.local'}, ${hash}, true, ${TENANT})
      on conflict (login_id, tenant_id) do update set password = excluded.password, deleted_at = null
      returning id`;
    await sql`delete from user_roles where user_id = ${user.id} and role_id <> ${role.role_id}`;
    await sql`
      insert into user_roles (user_id, role_id, tenant_id)
      select ${user.id}, ${role.role_id}, ${TENANT}
      where not exists (select 1 from user_roles where user_id = ${user.id} and role_id = ${role.role_id})`;
    const [perms] = await sql<{ n: number }[]>`
      select count(*)::int as n from iam_role_permissions where role_id = ${role.role_id}`;
    console.log(`${LOGIN_ID} / ${PASSWORD} — 역할 ${ROLE} 하나(권한 ${perms.n}개, 카탈로그가 준 그대로)`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
