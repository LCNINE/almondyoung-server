import { SetMetadata } from '@nestjs/common';

export const WALLET_JWT_AUTH_KEY = 'walletJwtAuth';
export const WalletJwtAuth = () => SetMetadata(WALLET_JWT_AUTH_KEY, true);
