"use client";

import { useRouter } from "next/navigation";

export function CreateRoomButton() {
  const router = useRouter();

  const createRoom = () => {
    const id = crypto.randomUUID().slice(0, 8);
    router.push(`/room/${id}`);
  };

  return (
    <button
      onClick={createRoom}
      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
    >
      New collaborative session
    </button>
  );
}
