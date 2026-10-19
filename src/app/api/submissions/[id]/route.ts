import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getSubmissionForUser } from "@/lib/db/submissions";

/**
 * GET: one of the user's submissions — status, result once judged, and the
 * submitted code (for "open in editor" from the history list). The browser
 * also polls this when the Socket.IO verdict doesn't arrive.
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
    const submission = await getSubmissionForUser(id, user.id);
    if (!submission) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(submission);
  } catch {
    return NextResponse.json({ error: "Could not load submission" }, { status: 500 });
  }
}
