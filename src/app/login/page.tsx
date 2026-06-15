import { AuthForm } from "./AuthForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">CodeWithMe</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Sign in or create an account to start solving.
          </p>
        </div>
        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </p>
        )}
        <AuthForm redirectTo={redirectTo ?? "/problems"} />
      </div>
    </main>
  );
}
