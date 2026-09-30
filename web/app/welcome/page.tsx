import { feedsByCategory, folders as minifluxFolders } from "@/lib/miniflux";
import OnboardingFlow, { type ExistingFeed } from "../components/OnboardingFlow";

// Always fresh, reflects whatever is actually subscribed right now, same
// reasoning as app/page.tsx.
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  let existingFeeds: ExistingFeed[] = [];
  try {
    const [folders, byCategory] = await Promise.all([minifluxFolders(), feedsByCategory()]);
    existingFeeds = folders.flatMap((folder) =>
      (byCategory[folder.id] ?? []).map((feed) => ({
        id: feed.id,
        title: feed.title,
        category: folder.title,
      }))
    );
  } catch {
    // Miniflux unreachable, the flow still works, it just can't show or
    // offer to remove the pre-seeded feeds. Never block onboarding on this.
  }

  return (
    <div className="min-h-screen bg-bg text-ink flex items-center justify-center px-5 py-10 sm:py-14">
      <OnboardingFlow existingFeeds={existingFeeds} />
    </div>
  );
}
