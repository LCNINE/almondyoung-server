import { applyDecorators, SetMetadata } from '@nestjs/common';
import { WALLET_JWT_AUTH_KEY } from './wallet-auth.decorator';

export const WALLET_ADMIN_AUTH_KEY = 'walletAdminAuth';

export const WalletAdminAuth = () =>
  applyDecorators(
    SetMetadata(WALLET_JWT_AUTH_KEY, true),
    SetMetadata(WALLET_ADMIN_AUTH_KEY, true),
  );
