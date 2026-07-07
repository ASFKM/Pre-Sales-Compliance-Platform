import { useEffect, useState } from "react";
import { X, Megaphone } from "lucide-react";
import ApiClient from "../lib/api";

interface SystemMessage {
  id: string;
  source: "fleet_manager" | "local";
  audience: "admin_only" | "all_users";
  body: string;
  created_at: string;
}

const DISMISSED_KEY = "ca_dismissed_system_messages";

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
}

interface Props {
  locale: string;
  hasPermission: (permission: string) => boolean;
}

// Notices relayed from the Fleet Manager (maintenance windows, etc.) or created locally by this
// installation's own super admin - dismissal is per-browser (localStorage), no server-side
// per-user read state, kept deliberately simple.
export default function SystemMessageBanner({ locale, hasPermission }: Props) {
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed());

  useEffect(() => {
    ApiClient.get<SystemMessage[]>("/api/messages").then(setMessages).catch(() => setMessages([]));
  }, []);

  const canSeeAdminOnly = hasPermission("admin:settings");
  const visible = messages.filter((m) => (m.audience === "all_users" || canSeeAdminOnly) && !dismissed.includes(m.id));

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  return (
    <div className="shrink-0 z-20">
      {visible.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <Megaphone size={14} className="shrink-0" />
            <span>{m.body}</span>
          </div>
          <button onClick={() => dismiss(m.id)} className="shrink-0 text-amber-500 hover:text-amber-800">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
