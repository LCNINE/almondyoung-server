import { FILE_CONTEXTS } from '../default-file-contexts';

describe('SKU 3D model file context', () => {
  it('allows only public GLB files up to 20 MiB', () => {
    expect(FILE_CONTEXTS.find((context) => context.id === 'sku-3d-model')).toMatchObject({
      allowPublic: true,
      allowPrivate: false,
      allowedMimeTypes: ['model/gltf-binary'],
      maxFileSize: 20 * 1024 * 1024,
      pathPrefix: 'inventory/sku-3d-models',
      isActive: true,
    });
  });
});
