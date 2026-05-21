import { digitalAssetsClient } from './digital-assets.client';
import { variantAssetLinksClient } from './variant-asset-links.client';

export const library = {
  digitalAssets: digitalAssetsClient,
  variantAssetLinks: variantAssetLinksClient,
};

export { digitalAssetsClient, variantAssetLinksClient };
