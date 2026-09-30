"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type ToastInput = {
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type ToastRecord = ToastInput & { id: number };

type ToastContextValue = {
  push: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Call from any client component under <ToastProvider> (mounted in app/layout.tsx) to raise a toast. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be called from within <ToastProvider>");
  }
  return ctx;
}

let nextToastId = 1;
const DEFAULT_DURATION_MS = 4000;
const MAX_STACK = 3;
const EXIT_MS = 160;

/**
 * Quiet, useful toasts, bottom-centre on mobile, bottom-left on desktop.
 * Stacks at most 3; a 4th push drops the oldest rather than growing forever.
 * The whole region is a single role="status"/aria-live="polite" landmark,
 * per the design spec, individual toasts don't add their own live region.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: ToastInput) => {
    const id = nextToastId++;
    setToasts((current) => {
      const next = [...current, { ...toast, id }];
      return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Phone: centred, ABOVE the tab bar (the audit found it overlapping,
          A10). Desktop: bottom-left of the content column. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4
          bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)]
          lg:bottom-6 lg:left-[288px] lg:right-auto lg:items-start lg:px-0"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDone={() => remove(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDone }: { toast: ToastRecord; onDone: () => void }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    timerRef.current = setTimeout(close, toast.durationMs ?? DEFAULT_DURATION_MS);
    return () => {
      cancelAnimationFrame(frame);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (exitRef.current) clearTimeout(exitRef.current);
    };
    // Only ever runs once per toast instance, durationMs is fixed at push time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    // Let the exit transition play before actually removing it from the
    // stack. motion-reduce:duration-0 below means this is instant for
    // anyone who asked for reduced motion, the setTimeout still fires,
    // just after a transition that took 0ms.
    exitRef.current = setTimeout(onDone, EXIT_MS);
  }

  function pause() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }
  function resume() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(close, 2500);
  }

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={`pointer-events-auto flex w-full max-w-[400px] items-center gap-2 rounded-lg
        border border-hairline bg-surface py-1 pl-4 pr-1 shadow-e2
        transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none
        ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <p className="min-w-0 flex-1 py-2 t-body text-ink">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            close();
          }}
          className="tap flex h-11 shrink-0 items-center rounded-sm px-3 t-button text-accent hover:bg-surface-2"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-muted"
      >
        <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
