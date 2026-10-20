import {
  attendanceStartupImages,
  renderAttendanceStartupSvg,
} from './attendance-startup-images';

it('draws the launch image at the exact iPhone screen resolution', () => {
  const svg = renderAttendanceStartupSvg(390, 844, 3);

  expect(svg).toContain('width="1170" height="2532"');
  expect(svg).toContain('fill="#FFFBF5"');
  expect(svg).not.toContain('__CLOCK_ID__');
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

it('rejects arbitrary image dimensions instead of allocating unbounded images', () => {
  expect(() => renderAttendanceStartupSvg(50000, 50000, 3)).toThrow(
    'Unsupported startup image'
  );
});
