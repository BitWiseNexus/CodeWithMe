import Link from "next/link";
import { getUser } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export async function Header() {
  const user = await getUser();

  return (
    <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
      <Link href="/problems" className="font-bold">
        CodeWithMe
      </Link>
      {user && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-black/60 dark:text-white/60">{user.email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
