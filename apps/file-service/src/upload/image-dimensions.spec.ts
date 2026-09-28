import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageDimensions } from './image-dimensions';

const asset = (name: string) => readFileSync(join(__dirname, '../../../../web/almondyoung-storefront/public', name));

it('실제 PNG·JPEG·WebP 파일의 가로세로 크기를 읽는다', () => {
  expect(imageDimensions(asset('images/almond-logo-black.png'), 'image/png')).toEqual({ width: 275, height: 36 });
  expect(imageDimensions(asset('og-image.jpg'), 'image/jpeg')).toEqual({ width: 1200, height: 630 });
  expect(imageDimensions(asset('images/logo.webp'), 'image/webp')).toEqual({ width: 550, height: 550 });
  expect(imageDimensions(asset('images/almond-logo-black.png'), 'image/jpeg')).toBeNull();
  expect(imageDimensions(Buffer.from('invalid'), 'image/png')).toBeNull();
});
