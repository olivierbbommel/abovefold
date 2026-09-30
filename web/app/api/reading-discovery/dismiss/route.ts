import { NextRequest, NextResponse } from "next/server";
import { dismissSite } from "@/lib/reading-discovery";

/* "Not interested" on a site in the From-your-reading catalog. */
const HOST = /^[a-z0-9.-]{3,253}$/;

export async function POST(request: NextRequest) {
  let host = "";
  try {
    const body = await request.json();
    host = typeof body?.host === "string" ? body.host.toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  if (!HOST.test(host)) return NextResponse.json({ error: "host is required" }, { status: 400 });
  await dismissSite(host);
  return NextResponse.json({ dismissed: true });
}
