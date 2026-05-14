export async function POST(request: Request) {
  return Response.redirect(new URL('/', request.url));
}
