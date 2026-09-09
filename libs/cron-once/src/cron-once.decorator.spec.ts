import { Reflector } from '@nestjs/core';
import { CRON_ONCE_METADATA, CronOnceMetadata } from './cron-once.constants';
import { CronOnce } from './cron-once.decorator';

describe('@CronOnce', () => {
  const reflector = new Reflector();

  it('메서드에 expression·name·timeZone 메타데이터를 남긴다', () => {
    class Job {
      @CronOnce('0 3 * * *', { name: 'nightly', timeZone: 'Asia/Seoul' })
      // this 를 안 쓰므로 `this: void` 로 선언 — unbound-method 없이 Job.prototype.run 을 값으로 넘긴다.
      async run(this: void): Promise<void> {}
    }
    const meta = reflector.get<CronOnceMetadata>(CRON_ONCE_METADATA, Job.prototype.run);
    expect(meta).toEqual({ expression: '0 3 * * *', name: 'nightly', timeZone: 'Asia/Seoul' });
  });

  it('name 이 비면 데코레이션 시점에 throw 한다', () => {
    expect(() => {
      class Job {
        @CronOnce('0 3 * * *', { name: '' })
        async run(): Promise<void> {}
      }
      return Job;
    }).toThrow(/name/);
  });

  it('메서드 본문은 건드리지 않는다 (호출하면 그대로 실행된다)', async () => {
    class Job {
      calls = 0;
      @CronOnce('* * * * * *', { name: 'tick' })
      run(): Promise<void> {
        this.calls += 1;
        return Promise.resolve();
      }
    }
    const job = new Job();
    await job.run();
    expect(job.calls).toBe(1);
  });
});
