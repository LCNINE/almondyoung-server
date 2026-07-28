import { SignUpForm } from "@/components/signup-form";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{ redirect_to?: string }>;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[640px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">회원가입</h1>
      </header>
      <SignUpForm redirectTo={redirectTo} />
    </main>
  );
}
