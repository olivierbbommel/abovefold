import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  // Signed in already: only reachable by going Back from the page a deep-link
  // login led to (the middleware never sends a signed-in visitor here). Go to
  // Today, which is what that Back button says. Not to `next`: that is the
  // page Back just left, and would loop.
  if (verifySession((await cookies()).get(COOKIE_NAME)?.value)) redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <form
        method="POST"
        action="/api/login"
        className="flex w-full max-w-xs flex-col items-center gap-6"
      >
        <h1 className="headline text-3xl text-ink">abovefold</h1>
        {next !== "/" && <input type="hidden" name="next" value={next} />}

        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="tap w-full rounded-md border border-line bg-surface px-4 py-3 text-center text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {error === "throttled" ? (
          <p className="text-sm text-muted" role="alert">
            Too many attempts. Wait a few minutes and try again.
          </p>
        ) : error ? (
          <p className="text-sm text-muted" role="alert">
            That didn&apos;t work. Try again.
          </p>
        ) : null}

        <button
          type="submit"
          className="tap w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
