import { digitalAssetsClient } from './digital-assets.client';
import { variantAssetLinksClient } from './variant-asset-links.client';
import { ownershipsClient } from './ownerships.client';

export const library = {
  digitalAssets: digitalAssetsClient,
  variantAssetLinks: variantAssetLinksClient,
  ownerships: ownershipsClient,
};

export { digitalAssetsClient, variantAssetLinksClient, ownershipsClient };
