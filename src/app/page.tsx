import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error_description?: string }>;
}) {
  const { code, error_description } = await searchParams;

  // Supabase email-confirmation links redirect to the Site URL root with a
  // `?code=`. Forward it to the callback route that exchanges it for a session.
  if (code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  }
  if (error_description) {
    redirect(`/login?error=${encodeURIComponent(error_description)}`);
  }

  const user = await getUser();
  redirect(user ? "/problems" : "/login");
}
