import type { INestApplication } from '@nestjs/common';
import { ClsMiddleware } from 'nestjs-cls';

/**
 * HTTP 요청 하나 = 사슬 하나 (#612)
 *
 * 요청 스코프 CLS 컨텍스트를 연다. 이것이 없으면 `StreamPublisher` 가 `chainId` 를 심을
 * 곳이 없어 **한 요청 안의 두 발행이 서로 다른 사슬을 받는다** — 사슬이 소비 경계에서만
 * 끊긴 게 아니라 애초에 시작되지 않는다.
 *
 * ## 왜 `ClsModule.forRoot({ middleware: { mount: true } })` 가 아닌가
 *
 * `EventsModule.forApp` 은 **BC 별 다중 호출이 공식 패턴**이고(core 가 4번 부른다),
 * Nest 11 은 동적 모듈을 참조로 dedupe 한다 — 구조 해시로 묶던 Nest 10 과 다르다.
 * 그래서 `forApp` 안의 `ClsModule.forRoot` 는 앱마다 여러 벌이 되고, 거기에 mount 를
 * 켜면 **미들웨어가 요청당 그 횟수만큼** 붙는다. 마운트는 앱당 한 번이어야 하므로
 * 모듈 등록이 아니라 `main.ts` 의 명시 호출로 둔다.
 *
 * ## 왜 미들웨어인가
 *
 * `ClsMiddleware` 는 기본값(`useEnterWith: false`)에서 `cls.run(callback)` 으로 컨텍스트를
 * 열고 그 안에서 `next()` 를 부른다 — 요청이 끝나면 컨텍스트도 끝난다. `ClsGuard` 는
 * `cls.enterWith()` 라 컨텍스트가 현재 async resource 의 남은 수명에 눌러붙는다.
 *
 * 다른 미들웨어보다 **앞에서** 부를 것. 뒤에 두면 그 사이 미들웨어에서 일어난 발행이
 * 컨텍스트 밖이 된다.
 *
 * @example
 * const app = await NestFactory.create(AppModule);
 * mountEventChainContext(app);
 * await app.listen(port);
 */
export function mountEventChainContext(app: INestApplication): void {
  app.use(
    new ClsMiddleware({
      // 요청/응답 객체는 담지 않는다 — 이 컨텍스트의 용도는 chainId·eventId 뿐이고,
      // 담아두면 요청 수명 동안 참조가 남는다.
      saveReq: false,
      saveRes: false,
      // proxy provider 를 쓰지 않으므로 요청마다 resolve 를 돌 이유가 없다.
      resolveProxyProviders: false,
    }).use,
  );
}
