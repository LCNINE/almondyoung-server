import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CRON_ONCE_METADATA, CronOnceMetadata } from './cron-once.constants';
import { CronOnceRunner } from './cron-once.runner';

/**
 * `@nestjs/schedule` 의 `ScheduleExplorer` 와 같은 절차로 `@CronOnce` 메서드를 찾아 `CronJob` 으로
 * 만들고 `SchedulerRegistry` 에 등록한다. 콜백은 `CronOnceRunner.wrap` 을 거친다.
 *
 * - 탐색·등록은 `onModuleInit`, 시작은 `onApplicationBootstrap` — Nest 의 orchestrator 가 크론을
 *   mount 하는 시점과 같다. 앱이 다 뜨기 전에 본문이 도는 일을 막는다.
 * - `SchedulerRegistry.addCronJob` 은 같은 이름이 있으면 throw 한다. 모듈이 두 벌 떠서 크론이
 *   두 번 등록되는 사고(#599, 8일 무증상)가 **부팅 실패**가 된다. 의도한 성질이다.
 * - 종료 시 정리는 Nest 의 `SchedulerOrchestrator.onApplicationShutdown` 이 registry 전체를 닫으므로
 *   여기서 따로 하지 않는다.
 */
@Injectable()
export class CronOnceExplorer implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('CronOnce');
  private readonly jobs: CronJob[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly registry: SchedulerRegistry,
    private readonly runner: CronOnceRunner,
  ) {}

  onModuleInit(): void {
    for (const wrapper of [...this.discovery.getProviders(), ...this.discovery.getControllers()]) {
      const { instance } = wrapper;
      if (!instance || !Object.getPrototypeOf(instance)) continue;
      if (!wrapper.isDependencyTreeStatic()) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const methodRef = (instance as Record<string, unknown>)[methodName];
        if (typeof methodRef !== 'function') continue;
        const meta = this.reflector.get<CronOnceMetadata | undefined>(CRON_ONCE_METADATA, methodRef);
        if (!meta) continue;
        this.register(meta, () => Promise.resolve(methodRef.call(instance)));
      }
    }
    this.logger.log(`registered ${this.jobs.length} cron-once job(s): ${this.jobs.map((j) => j.name).join(', ')}`);
  }

  onApplicationBootstrap(): void {
    for (const job of this.jobs) job.start();
  }

  private register(meta: CronOnceMetadata, body: () => Promise<unknown>): void {
    const job = CronJob.from({
      cronTime: meta.expression,
      onTick: this.runner.wrap(meta, body),
      start: false,
      name: meta.name,
      ...(meta.timeZone ? { timeZone: meta.timeZone } : {}),
    });
    this.registry.addCronJob(meta.name, job);
    this.jobs.push(job);
  }
}
