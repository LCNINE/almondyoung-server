/**
 * spec 용 — 쓰는 메서드만 채운 포트. 나머지는 부르면 던진다(단계가 다른 포트를 건드리면 빨갛게).
 * 포트 인터페이스를 다 채우지 않으려고 Proxy 를 쓰고, 그 때문에 한 번만 `as T` 로 넓힌다.
 */
export function stub<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof T];
      return () => {
        throw new Error(`이 spec 은 ${name}.${prop} 을 부르지 않는다`);
      };
    },
  }) as T;
}
