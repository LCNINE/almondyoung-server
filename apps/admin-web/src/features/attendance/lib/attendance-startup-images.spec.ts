import sharp from 'sharp';

// The root Jest transform disables esModuleInterop; retain the real native renderer.
jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.requireActual('sharp'),
}));
import {
  attendanceStartupImages,
  renderAttendanceStartupImage,
} from './attendance-startup-images';

it('serves a real native launch PNG at the exact iPhone screen resolution', async () => {
  const image = await renderAttendanceStartupImage(390, 844, 3);
  const metadata = await sharp(image).metadata();

  expect(metadata.format).toBe('png');
  expect(metadata.width).toBe(1170);
  expect(metadata.height).toBe(2532);

  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) =>
    Array.from(
      data.subarray(
        (y * info.width + x) * info.channels,
        (y * info.width + x) * info.channels + 3
      )
    );

  expect(at(0, 0)).toEqual([255, 251, 245]);
  expect(data.some((value) => value < 100)).toBe(true);
});

it('advertises portrait and landscape launch images without requiring login', () => {
  const image = attendanceStartupImages.find(
    (entry) =>
      entry.media.includes('(device-width: 390px)') &&
      entry.media.includes('(orientation: portrait)') &&
      entry.media.includes('pixel-ratio: 3')
  );

  expect(image?.url).toBe(
    '/api/attendance/startup-image?width=390&height=844&scale=3&v=clock-1'
  );
  expect(
    attendanceStartupImages.some((entry) =>
      entry.media.includes('(orientation: landscape)')
    )
  ).toBe(true);
});

it('rejects arbitrary image dimensions instead of allocating unbounded images', async () => {
  await expect(renderAttendanceStartupImage(50000, 50000, 3)).rejects.toThrow(
    'Unsupported startup image'
  );
});
