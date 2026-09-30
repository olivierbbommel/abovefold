import { NextResponse } from "next/server";
import { readingSites } from "@/lib/reading-discovery";

/* "From your reading": sites the owner's sources link to. Derived, never curated. */
export const dynamic = "force-dynamic";

export async function GET() {
  const sites = await readingSites(30);
  return NextResponse.json({ sites });
}
