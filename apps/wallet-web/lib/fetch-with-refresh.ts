import { WalletSessionExpiredError } from './auth-expired';

export async function fetchWithAuthBounce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401) {
    throw new WalletSessionExpiredError();
  }

  return response;
}
