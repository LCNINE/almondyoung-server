import { selfOrigin } from '@/lib/auth/access-token';

export async function POST(request: Request) {
  return Response.redirect(new URL('/', selfOrigin() ?? request.url));
}
