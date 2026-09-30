import { ReasonStar } from "./Icons";

/**
 * The "this source is drowning your feed" recommendation card. Rendered only
 * by the caller when openRate is non-null AND < 15% AND volumePerDay > 10 , 
 * this component doesn't re-check those thresholds, it just formats the
 * message for whichever source already passed them.
 *
 * The recommendation itself is derived/computed (indigo, ReasonStar), but
 * "Mute source" is a real user action, so it gets rust, not the dark chip
 * the mockup uses, to stay consistent with the rest of the app (see the
 * "Read later" button on the article page).
 */
export default function MuteSuggestion({
  feedTitle,
  volumePerDay,
  openRatePct,
}: {
  feedTitle: string;
  volumePerDay: number;
  openRatePct: number;
}) {
  return (
    <div className="flex items-start gap-3 bg-surface-2 rounded-[10px] px-[18px] py-4 mt-6 max-w-[680px]">
      <ReasonStar className="w-[15px] h-[15px] text-ai shrink-0 mt-[2px]" />
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] text-ink-2 leading-[1.6] text-pretty">
          {feedTitle} publishes about {Math.round(volumePerDay)} items a day and you open{" "}
          {openRatePct}% of them. Ranking already buries most of it. You can mute the source
          entirely without losing what you actually read.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="tap h-[30px] flex items-center px-[13px] rounded-[7px] bg-accent text-accent-ink text-[12.5px] font-medium"
          >
            Mute source
          </button>
          <button
            type="button"
            className="tap h-[30px] flex items-center px-[13px] rounded-[7px] border border-line text-[12.5px] text-ink-2"
          >
            Keep as is
          </button>
        </div>
      </div>
    </div>
  );
}
