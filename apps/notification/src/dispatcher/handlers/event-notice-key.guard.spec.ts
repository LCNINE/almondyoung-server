/**
 * 이벤트로 보내는 알림은 멱등 키를 갖는다 (#1073)
 *
 * 컨슈머가 오프셋을 커밋하면서, 처리했지만 커밋 못 한 메시지가 재시작 뒤 다시 올 수 있게 됐다.
 * 키가 없으면 디스패처는 새 행을 만들어 같은 알림을 또 보낸다(알림톡·SMS 면 돈도 든다).
 * 키가 있으면 (idempotency_key, channel) ON CONFLICT 가 두 번째를 버린다.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const HANDLERS = __dirname;
const consumerFiles = readdirSync(HANDLERS).filter((f) => f.endsWith('.consumer.ts'));

describe('notification 컨슈머의 send 호출', () => {
  it('검사할 파일이 있다', () => {
    expect(consumerFiles.length).toBeGreaterThan(0);
  });

  it.each(consumerFiles)('%s 의 send 호출 수만큼 idempotencyKey 가 있다', (file) => {
    const src = readFileSync(join(HANDLERS, file), 'utf8');
    const sends = (src.match(/notificationDispatcherService\.send\(/g) ?? []).length;
    const keys = (src.match(/idempotencyKey:/g) ?? []).length;

    expect(keys).toBeGreaterThanOrEqual(sends);
  });
});
