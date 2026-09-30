import { redirect } from "next/navigation";

/*
 * The folder index became Library (spec 8.1). Folder and feed pages still
 * link back here, and FolderActions returns here after a delete, so the old
 * path keeps working.
 */
export default function FoldersRedirect() {
  redirect("/library");
}
