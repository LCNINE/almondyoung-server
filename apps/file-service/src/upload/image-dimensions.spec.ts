import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageDimensions } from './image-dimensions';

const asset = (name: string) => readFileSync(join(__dirname, '__fixtures__', name));

it('실제 PNG·JPEG·WebP 파일의 가로세로 크기를 읽는다', () => {
  expect(imageDimensions(asset('logo.png'), 'image/png')).toEqual({ width: 275, height: 36 });
  expect(imageDimensions(asset('og.jpg'), 'image/jpeg')).toEqual({ width: 1200, height: 630 });
  expect(imageDimensions(asset('logo.webp'), 'image/webp')).toEqual({ width: 512, height: 512 });
  expect(imageDimensions(asset('logo.png'), 'image/jpeg')).toBeNull();
  expect(imageDimensions(Buffer.from('invalid'), 'image/png')).toBeNull();
});
