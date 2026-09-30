"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import AddSheet, { type AddSheetOptions } from "./AddSheet";

/*
 * One Add sheet for the whole app (spec 4.3, 5.4). Anything can open it:
 * the plus in Today, Library and the rail, "Add newsletter", a folder page's
 * "Add a source". Mounted once in app/(app)/layout.tsx.
 *
 *   const { openAdd } = useAddSheet();
 *   openAdd();                              // search step
 *   openAdd({ step: "email" });             // Follow by email step
 *   openAdd({ folderId: 4 });               // preselect a folder
 *   openAdd({ query: "arstechnica.com" });  // prefill and resolve
 *   openAdd({ asNewsletter: true });        // Newsletters: feed or email
 */
type Ctx = { openAdd: (options?: AddSheetOptions) => void };
const AddSheetContext = createContext<Ctx | null>(null);

export function useAddSheet(): Ctx {
  const ctx = useContext(AddSheetContext);
  if (!ctx) throw new Error("useAddSheet must be used inside <AddSheetProvider>");
  return ctx;
}

export default function AddSheetProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<AddSheetOptions | null>(null);
  const openAdd = useCallback((o: AddSheetOptions = {}) => setOptions(o), []);
  return (
    <AddSheetContext.Provider value={{ openAdd }}>
      {children}
      <AddSheet open={options !== null} options={options ?? {}} onClose={() => setOptions(null)} />
    </AddSheetContext.Provider>
  );
}
