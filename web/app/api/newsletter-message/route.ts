import { NextRequest, NextResponse } from "next/server";
import { deleteAdminMessage } from "@/lib/newsletter";
import { positiveIntParam } from "@/lib/route-params";

/* Dismiss a verification / welcome mail from an address card. Session-gated. */
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");
  const id = positiveIntParam(params.get("id") ?? "");
  if (!token || id === null) {
    return NextResponse.json({ error: "token and id are required" }, { status: 400 });
  }
  const deleted = await deleteAdminMessage(token, id);
  return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
}
