/**
 * core dev DB 대상 통합 테스트 러너 (rollback-only spec 전용).
 * `sst shell` 안에서 실행되어 SST Db 리소스 자격증명으로 DATABASE_URL을 만들고 jest를 돌린다.
 * 직접 호출하지 말고 scripts/test-core-integration.sh 를 사용할 것.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Resource } = require(path.join(ROOT, 'node_modules', 'sst'));

const db = Resource.Db;
const url = `postgresql://${db.username}:${encodeURIComponent(db.password)}@${db.host}:${db.port}/core?sslmode=require`;

const pattern = process.argv[2] || 'integration';
const result = spawnSync('npx', ['jest', `--testPathPattern=${pattern}`, '--runInBand'], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
