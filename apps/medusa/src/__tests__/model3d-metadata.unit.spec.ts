import { mergeMetadata } from '@medusajs/framework/utils';

describe('product 3D metadata removal', () => {
  it('adds and removes a model with the installed Medusa metadata merge implementation', () => {
    const attached = mergeMetadata({ existingKey: 'keep' }, { model3dFileId: 'model-file-id' });
    const removed = mergeMetadata(attached, { model3dFileId: '' });

    expect(attached.model3dFileId).toBe('model-file-id');
    expect(removed).not.toHaveProperty('model3dFileId');
    expect(removed.existingKey).toBe('keep');
  });
});
