import { assertLocalDevCoreUrl } from './guard';

describe('assertLocalDevCoreUrl', () => {
  it('localhost 의 dev_core 를 통과시키고 DB 이름을 돌려준다', () => {
    const result = assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/dev_core');
    expect(result.dbName).toBe('dev_core');
    expect(result.url.hostname).toBe('localhost');
  });

  it('127.0.0.1 도 통과시킨다', () => {
    expect(assertLocalDevCoreUrl('postgresql://postgres:postgres@127.0.0.1:5432/dev_core').dbName).toBe('dev_core');
  });

  it('원격 호스트를 거부한다', () => {
    expect(() =>
      assertLocalDevCoreUrl('postgresql://u:p@lcnine-services-live.ap-northeast-2.rds.amazonaws.com:5432/dev_core'),
    ).toThrow(/localhost/);
  });

  it('dev_core 가 아닌 DB 를 거부한다 — 공용 core 보호', () => {
    expect(() => assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/core')).toThrow(/dev_core/);
  });

  it('sst tunnel 로 localhost 에 붙은 원격 core 도 DB 이름으로 거부한다', () => {
    expect(() => assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/user_service')).toThrow(
      /dev_core/,
    );
  });

  it('URL 이 아니면 거부한다', () => {
    expect(() => assertLocalDevCoreUrl('not-a-url')).toThrow();
  });

  it('?host= 로 실제 접속 호스트를 덮어쓰려는 URL 을 거부한다', () => {
    expect(() =>
      assertLocalDevCoreUrl(
        'postgresql://postgres:postgres@localhost:5432/dev_core?host=some-remote.rds.amazonaws.com',
      ),
    ).toThrow(/쿼리 문자열/);
  });

  it('host= 가 아니어도 쿼리 문자열이 있으면 거부한다', () => {
    expect(() =>
      assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/dev_core?sslmode=disable'),
    ).toThrow(/쿼리 문자열/);
  });

  it('대문자 호스트도 소문자로 정규화하여 통과시킨다', () => {
    const result = assertLocalDevCoreUrl('postgresql://postgres:postgres@LOCALHOST:5432/dev_core');
    expect(result.dbName).toBe('dev_core');
    expect(result.url.hostname).toBe('LOCALHOST');
  });
});
