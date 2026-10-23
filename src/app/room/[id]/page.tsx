import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isValidRoomId } from "@/lib/collab";
import { RoomClient } from "./RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  if (!isValidRoomId(id)) {
    notFound();
  }

  return (
    <RoomClient
      roomId={id}
      socketUrl={process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001"}
    />
  );
}
