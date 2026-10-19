import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getExecutionForUser } from "@/lib/db/executions";

/**
 * GET: status (and result, once finished) of one of the user's executions.
 * The browser polls this as a fallback when the Socket.IO result doesn't
 * arrive (realtime server down, socket reconnecting, …).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const execution = await getExecutionForUser(id, user.id);
    if (!execution) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(execution);
  } catch {
    return NextResponse.json({ error: "Could not load execution" }, { status: 500 });
  }
}
