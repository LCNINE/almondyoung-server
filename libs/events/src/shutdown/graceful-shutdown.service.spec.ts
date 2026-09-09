import { GracefulShutdownService } from './graceful-shutdown.service';
import {
  ConsumerLagCollector,
  registerConsumerLagCollector,
  type ConsumerLagAdmin,
} from '../consumers/consumer-lag.collector';

function makeAdmin() {
  const disconnect = jest.fn(() => Promise.resolve());
  const admin: ConsumerLagAdmin = {
    connect: jest.fn(() => Promise.resolve()),
    disconnect,
    fetchOffsets: jest.fn(() => Promise.resolve([])),
    fetchTopicOffsets: jest.fn(() => Promise.resolve([])),
  };
  return { admin, disconnect };
}

describe('GracefulShutdownService', () => {
  it('종료 시 lag 폴러를 먼저 멈춘다 — Kafka 클라이언트가 없어도(폴러는 DI 밖에 산다)', async () => {
    const { admin, disconnect } = makeAdmin();
    const collector = new ConsumerLagCollector(admin, 'shutdown-group', [{ topic: 'shutdown.topic', partitions: 1 }]);
    await collector.start();
    registerConsumerLagCollector(collector);

    await new GracefulShutdownService(undefined).onApplicationShutdown('SIGTERM');

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
