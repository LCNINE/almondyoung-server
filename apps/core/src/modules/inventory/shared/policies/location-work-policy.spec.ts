import { destinationIssue } from './location-work-policy';

const destination = { id: 'destination', warehouseId: 'warehouse', isActive: true, isSystem: false };

describe('work destination policy', () => {
  it.each([
    ['movement', null, 'MISSING'],
    ['putaway', null, 'MISSING'],
    ['movement', { ...destination, warehouseId: 'other', isActive: false }, 'WRONG_WAREHOUSE'],
    ['putaway', { ...destination, warehouseId: 'other', isSystem: true, isActive: false }, 'WRONG_WAREHOUSE'],
    ['movement', { ...destination, id: 'source', isActive: false }, 'SAME_LOCATION'],
    ['putaway', { ...destination, id: 'source', isSystem: true }, 'SAME_LOCATION'],
    ['putaway', { ...destination, isSystem: true, isActive: false }, 'SYSTEM'],
    ['putaway', { ...destination, isSystem: true }, 'SYSTEM'],
    ['movement', { ...destination, isSystem: true }, null],
    ['movement', { ...destination, isSystem: true, isActive: false }, 'INACTIVE'],
    ['movement', { ...destination, isActive: false }, 'INACTIVE'],
    ['putaway', { ...destination, isActive: false }, 'INACTIVE'],
    ['movement', destination, null],
    ['putaway', destination, null],
  ] as const)('%s destination %j yields %s', (purpose, target, expected) => {
    expect(
      destinationIssue({ purpose, warehouseId: 'warehouse', sourceLocationId: 'source', destination: target }),
    ).toBe(expected);
  });
});
