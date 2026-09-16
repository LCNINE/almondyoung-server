import type { FastifyReply } from 'fastify';

/**
 * 브라우저가 연결을 끊으면 abort 되는 신호.
 *
 * 요청 쪽(`request.raw`)의 'close' 를 쓰면 안 된다 — IncomingMessage 의 close 는
 * 요청 본문을 다 읽었을 때도 발생한다. multipart 를 파싱하고 나면 이미 발생해 버려서,
 * 그 뒤에 사용자가 Esc 를 눌러도 신호가 오지 않는다 (실측 확인).
 *
 * 응답 쪽(`reply.raw`)의 'close' 는 응답이 끝났거나 연결이 끊겼을 때 발생하므로,
 * 정상 종료(`writableEnded`)만 걸러내면 남는 것이 곧 사용자의 중단이다.
 */
export function clientAbortSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();

  reply.raw.on('close', () => {
    if (!reply.raw.writableEnded) controller.abort();
  });

  return controller.signal;
}
