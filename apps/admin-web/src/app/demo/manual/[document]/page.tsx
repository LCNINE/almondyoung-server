import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { isDemoConsoleEnabled } from '@/lib/demo/capabilities';

export const dynamic = 'force-dynamic';
const documents = new Set([
  'README',
  'retail',
  'warehouse',
  'workshop',
  'operator',
]);

export default async function DemoManual({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  if (!isDemoConsoleEnabled(process.env)) notFound();
  const { document } = await params;
  if (!documents.has(document)) notFound();
  const user = await getTokenPayload();
  if (!user || user.must_change_password) {
    const login = user?.must_change_password
      ? '/account/change-password'
      : '/auth/ensure';
    redirect(
      `${login}?redirect_to=${encodeURIComponent(`/demo/manual/${document}`)}`
    );
  }
  let markdown: string;
  try {
    markdown = await readFile(
      join(process.cwd(), 'demo-guides', `${document}.md`),
      'utf8'
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound();
    throw error;
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <nav className="mb-8 flex gap-6 border-b pb-4 text-sm">
        <Link className="underline" href="/demo/manual/README">
          사용법 목록
        </Link>
        <a className="underline" href={`/demo/guide/${document}.md?download=1`}>
          마크다운 원본
        </a>
      </nav>
      <article className="prose prose-slate max-w-none prose-img:h-auto prose-img:w-full prose-img:border prose-table:text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const match = href?.match(
                /^(README|retail|warehouse|workshop|operator)\.md(#.*)?$/
              );
              return (
                <a
                  href={
                    match ? `/demo/manual/${match[1]}${match[2] ?? ''}` : href
                  }
                >
                  {children}
                </a>
              );
            },
            img: ({ src, alt }) => {
              const image =
                typeof src === 'string' &&
                /^assets\/screens\/[a-zA-Z0-9._-]+\.png$/.test(src)
                  ? `/demo/guide/${src}`
                  : undefined;
              // These are authenticated screenshots, served by the guide file route.
              return image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={alt ?? ''} loading="lazy" />
              ) : null;
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </main>
  );
}
