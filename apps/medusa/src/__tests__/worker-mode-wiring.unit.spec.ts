import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0037 (#855) — store/admin 분리의 «앱 쪽» 배선 가드.
 *
 * 인프라(services.ts)는 `MEDUSA_WORKER_MODE` 와 `MEDUSA_RUN_DB_MIGRATE` 를 넣는데,
 * 앱이 그 env 를 안 읽으면 두 서비스가 조용히 둘 다 `shared` 로 떠서 cron 이 두 번 돌고
 * migrate 가 두 컨테이너에서 경쟁한다. 텍스트 가드로 배선이 남아 있는지 본다.
 */
const MEDUSA_DIR = join(__dirname, '..', '..');

describe('store/admin 분리 배선 (ADR-0037)', () => {
  it('medusa-config.js 가 MEDUSA_WORKER_MODE 로 workerMode 를 받는다', () => {
    const config = readFileSync(join(MEDUSA_DIR, 'medusa-config.js'), 'utf8');
    expect(config).toMatch(/workerMode:\s*process\.env\.MEDUSA_WORKER_MODE\s*\|\|\s*'shared'/);
  });

  it('Dockerfile CMD 가 MEDUSA_RUN_DB_MIGRATE=false 일 때 migrate 를 건너뛴다', () => {
    const dockerfile = readFileSync(join(MEDUSA_DIR, 'Dockerfile'), 'utf8');
    const cmdLine = dockerfile.split('\n').find((l) => l.startsWith('CMD '));
    expect(cmdLine).toBeDefined();
    // exec 형식 `CMD ["sh", "-c", "<shell>"]` — JSON 으로 풀어 셸 문자열만 본다.
    const [shell, flag, script] = JSON.parse(cmdLine!.slice('CMD '.length)) as string[];
    expect([shell, flag]).toEqual(['sh', '-c']);
    expect(script).toContain('if [ "$MEDUSA_RUN_DB_MIGRATE" != "false" ]; then yarn medusa db:migrate --execute-safe-links; fi');
    expect(script).toMatch(/&& yarn start$/);
  });
});
