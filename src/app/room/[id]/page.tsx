import { requireUser } from "@/lib/auth";
import { colorFor } from "@/lib/collab";
import { RoomClient } from "./RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const authUser = await requireUser();

  const name = authUser.email?.split("@")[0] ?? "anon";
  const user = { name, color: colorFor(authUser.email ?? authUser.id) };

  return (
    <RoomClient
      roomId={id}
      user={user}
      socketUrl={process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001"}
      signalingUrl={process.env.NEXT_PUBLIC_SIGNALING_URL ?? "ws://localhost:4444"}
    />
  );
}
