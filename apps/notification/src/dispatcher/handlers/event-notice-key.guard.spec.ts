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

// 핸들러(@On) 단위로 쪼갠다. 파일 전체를 세면 다른 핸들러의 남는 키가 빠뜨린 키를 가려서
// 새 핸들러가 키 없이 보내도 통과한다. 핸들러 뒤의 private 헬퍼·클래스 밖 함수는 잘라낸다 —
// 헬퍼가 `input.idempotencyKey` 를 넘기는 줄이 마지막 핸들러의 키로 세지면 안 된다.
const DISPATCH_CALL = /notificationDispatcherService\.send\(|notifyMember\(|this\.sendBillingNotice\(/g;

function handlerSegments(src: string): { name: string; text: string }[] {
  return src
    .split('@On(')
    .slice(1)
    .map((raw, index) => {
      const text = raw.split(/\n {2}private /)[0].split(/\n\}/)[0];
      const name = /async (\w+)\(/.exec(text)?.[1] ?? `#${index}`;
      return { name, text };
    });
}

const rows = consumerFiles.flatMap((file) =>
  handlerSegments(readFileSync(join(HANDLERS, file), 'utf8')).map(({ name, text }) => ({
    label: `${file} ${name}`,
    calls: (text.match(DISPATCH_CALL) ?? []).length,
    keys: (text.match(/idempotencyKey/g) ?? []).length,
  })),
);

describe('notification 컨슈머의 send 호출', () => {
  it('검사할 핸들러가 있다', () => {
    expect(consumerFiles.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows.map((r) => [r.label, r] as const))('%s 는 발송 호출마다 idempotencyKey 가 있다', (_label, row) => {
    expect(row.keys).toBeGreaterThanOrEqual(row.calls);
  });
});
