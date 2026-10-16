import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createHttpsWowpressTransport } from './wowpress.transport';

describe('createHttpsWowpressTransport', () => {
  let server: Server;
  let base: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const timers: NodeJS.Timeout[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server has no port');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(() => timers.splice(0).forEach(clearInterval));
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('parses a JSON response and sends the Bearer token', async () => {
    let auth: string | undefined;
    handler = (req, res) => {
      auth = req.headers.authorization;
      res.end(JSON.stringify({ resultCode: '200' }));
    };
    const transport = createHttpsWowpressTransport({ requestImpl: httpRequest });

    await expect(transport({ method: 'GET', url: `${base}/x`, json: { a: 1 }, token: 't' })).resolves.toEqual({
      status: 200,
      body: { resultCode: '200' },
    });
    expect(auth).toBe('Bearer t');
  });

  it('rejects with a synchronous requestImpl error and leaves no timer armed', async () => {
    jest.useFakeTimers();
    try {
      const transport = createHttpsWowpressTransport({
        requestImpl: () => {
          throw new Error('invalid header');
        },
      });

      await expect(transport({ method: 'POST', url: `${base}/x`, json: {} })).rejects.toThrow('invalid header');
      expect(jest.getTimerCount()).toBe(0);
      expect(() => jest.advanceTimersByTime(60_000)).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects at the overall deadline even while the server keeps trickling bytes', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      timers.push(setInterval(() => res.write(' '), 10));
    };
    const transport = createHttpsWowpressTransport({ requestImpl: httpRequest, deadlineMs: 150 });

    await expect(transport({ method: 'POST', url: `${base}/slow`, json: {} })).rejects.toThrow('deadline');
  });

  it('rejects when the response body exceeds the byte cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end('x'.repeat(5_000));
    };
    const transport = createHttpsWowpressTransport({ requestImpl: httpRequest, maxBodyBytes: 1_000 });

    await expect(transport({ method: 'POST', url: `${base}/big`, json: {} })).rejects.toThrow('exceeds');
  });
});
