import { ValidationPipe } from '@nestjs/common';
import { TestBrowserPushDto } from './web-push.dto';

describe('test push request validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it.each([
    {},
    { endpoint: null },
    { endpoint: 'https://web.push.apple.com/token', userId: 'another-account' },
    { endpoint: 'https://web.push.apple.com/token', title: 'custom message' },
  ])('rejects missing endpoints and caller-selected recipients or content: %j', async (body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: TestBrowserPushDto })).rejects.toMatchObject({
      status: 400,
    });
  });
});
