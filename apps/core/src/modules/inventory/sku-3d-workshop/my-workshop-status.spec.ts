import { myWorkshopStatus } from './sku-3d-workshop.reader';

describe('myWorkshopStatus', () => {
  it.each([
    ['queued', null, 'making'],
    ['running', { publishedAt: new Date() }, 'making'],
    ['failed', { publishedAt: null }, 'failed'],
    [null, null, 'waiting'],
    ['succeeded', { publishedAt: null }, 'review'],
    ['succeeded', { publishedAt: new Date() }, 'public'],
  ] as const)('job %s, revision %o → %s', (job, revision, expected) => {
    expect(myWorkshopStatus(job, revision)).toBe(expected);
  });
});
