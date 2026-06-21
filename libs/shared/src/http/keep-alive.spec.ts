import { createServer, Server } from 'http';
import { ALB_IDLE_TIMEOUT_MS, applyAlbKeepAlive } from './keep-alive';

describe('applyAlbKeepAlive', () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    server.close();
  });

  it('keeps idle connections alive longer than the ALB idle timeout', () => {
    applyAlbKeepAlive(server);

    expect(server.keepAliveTimeout).toBeGreaterThan(ALB_IDLE_TIMEOUT_MS);
  });

  it('waits for headers longer than it keeps connections alive', () => {
    applyAlbKeepAlive(server);

    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
