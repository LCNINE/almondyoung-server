/**
 * 컨슈머를 띄우는 앱은 종료 훅을 켠다 (#1073)
 *
 * 훅이 없으면 SIGTERM 뒤에도 컨슈머가 소비를 계속하다 SIGKILL 당한다 — 처리 중이던 메시지는
 * 커밋되지 못해 다시 오고, 그룹은 sessionTimeout(30s) 이 지나야 파티션을 넘긴다.
 * 훅이 있으면 Nest close() 가 consumer.disconnect() 로 커밋하고 그룹을 떠난다.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const APPS_DIR = join(__dirname, '../../../../apps');

function consumerMains(): string[] {
  return readdirSync(APPS_DIR)
    .map((app) => join(APPS_DIR, app, 'src/main.ts'))
    .filter((file) => existsSync(file) && readFileSync(file, 'utf8').includes('EventsModule.startConsumer(app'));
}

describe('startConsumer 를 부르는 앱의 종료 훅', () => {
  it('소비 앱이 하나 이상 있다 — 경로가 틀려 0개를 검사하는 일을 막는다', () => {
    expect(consumerMains().length).toBeGreaterThan(0);
  });

  it.each(consumerMains())('%s 가 app.enableShutdownHooks() 를 부른다', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/app\.enableShutdownHooks\(\)/);
  });
});
