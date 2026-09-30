"use client";

import { useRef, useState, type RefObject } from "react";
import { CircleX, FileUp, Globe, Hash, Link as LinkIcon, Mail, Newspaper, Rss, Search } from "lucide-react";
import type { Classified, InputKind } from "@/lib/resolve-input";
import { Spinner } from "./parts";

/*
 * The smart box (spec 5.4). One field for a name, a link, a subreddit, a
 * channel or "by email"; the chip under it says how the text is being read,
 * with no network involved. Enter or Find submits; a pasted address submits
 * on its own because a paste is intent.
 */

const CHIP_ICON: Record<Exclude<InputKind, "empty">, typeof LinkIcon> = {
  url: LinkIcon,
  feed: Rss,
  subreddit: Hash,
  youtube: Globe,
  email: Mail,
  name: Newspaper,
};

export default function AddBox({
  value,
  classified,
  resolving,
  inputRef,
  autoFocus,
  opmlLabel,
  showHints,
  onChange,
  onSubmit,
  onPasteSubmit,
  onOpml,
  asNewsletter = false,
  onEmail,
}: {
  value: string;
  classified: Classified;
  resolving: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  /** Replaces the chip while an OPML file is being imported. */
  opmlLabel: string | null;
  /** The hint and the OPML link, shown until there is something to look at. */
  showHints: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPasteSubmit: (v: string) => void;
  onOpml: (file: File) => void;
  /** Opened from Newsletters: say that a feed or an address both work. */
  asNewsletter?: boolean;
  onEmail?: () => void;
}) {
  const placeholder = asNewsletter ? "Newsletter name, site or feed link" : "Publication, link, subreddit or channel";
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const empty = value.trim().length === 0;
  const urlish = classified.kind === "url" || classified.kind === "feed";
  const ChipIcon = opmlLabel ? FileUp : classified.kind === "empty" ? null : CHIP_ICON[classified.kind];
  const chip = opmlLabel ?? classified.chip;

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty && !resolving) onSubmit();
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0];
          setDragging(false);
          if (file) {
            e.preventDefault();
            onOpml(file);
          }
        }}
        className={`add-box flex h-[3.25rem] items-center gap-2 rounded-xl border bg-surface pl-4 pr-2 lg:h-12 ${
          dragging ? "border-accent" : "border-line"
        }`}
      >
        <Search className="h-[18px] w-[18px] shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").trim();
            const el = e.currentTarget;
            // Only a paste that becomes the whole field is intent to add it.
            const whole = el.selectionStart === 0 && el.selectionEnd === el.value.length;
            if (pasted && (whole || el.value.trim() === "")) {
              e.preventDefault();
              onPasteSubmit(pasted);
            }
          }}
          autoFocus={autoFocus}
          type="text"
          inputMode={urlish ? "url" : "text"}
          autoCapitalize={urlish ? "none" : "words"}
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label={placeholder}
          placeholder={placeholder}
          className="add-input t-body h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
        />
        {!empty ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-faint hover:text-muted"
          >
            <CircleX className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        {/* Find appears with the first character (as in the artboards), so the
            empty field has room for its whole placeholder on a phone. */}
        <button
          type="submit"
          hidden={empty && !resolving}
          disabled={empty || resolving}
          aria-busy={resolving || undefined}
          className="add-find t-button relative flex h-9 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md bg-ink px-3.5 text-bg disabled:bg-surface-3 disabled:text-faint aria-busy:bg-ink aria-busy:text-bg"
        >
          <span className={`add-xfade ${resolving ? "opacity-0" : "opacity-100"}`}>Find</span>
          <span className={`add-xfade absolute inset-0 flex items-center justify-center ${resolving ? "opacity-100" : "opacity-0"}`}>
            <Spinner label={resolving ? "Finding" : undefined} />
          </span>
        </button>
      </form>

      <div className="flex items-center" aria-live="polite">
        {chip ? (
          <span key={chip} className="add-chip t-chip mt-2 inline-flex items-center gap-1.5 text-muted">
            {ChipIcon ? <ChipIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> : null}
            {chip}
          </span>
        ) : null}
      </div>

      {showHints && asNewsletter ? (
        <>
          <p className="t-caption mt-3 text-faint">
            Most newsletters publish a feed. Paste the site or its feed link and past issues come with it.
          </p>
          {onEmail ? (
            <button
              type="button"
              onClick={onEmail}
              className="add-textbtn tap -mx-1.5 mt-1 inline-flex items-center gap-1.5 rounded-sm px-1.5 t-caption text-accent lg:min-h-8"
            >
              <Mail className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              No feed? Get an email address for it
            </button>
          ) : null}
        </>
      ) : showHints ? (
        <>
          <p className="t-caption mt-3 text-faint">
            A name, a link, r/subreddit, a YouTube channel, or a newsletter you get by email.
          </p>
          <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="add-textbtn tap -mx-1.5 mt-1 inline-flex items-center gap-1.5 rounded-sm px-1.5 t-caption text-accent lg:min-h-8"
      >
        <FileUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Import an OPML file
          </button>
        </>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml,application/xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onOpml(file);
        }}
      />
    </div>
  );
}
