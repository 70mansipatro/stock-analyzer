"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteAlertAction } from "@/app/(app)/alerts/actions";

export function AlertDeleteButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => deleteAlertAction(id))}
      disabled={pending}
      aria-label={`Delete alert ${label}`}
      title="Delete"
      className="rounded-lg p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
