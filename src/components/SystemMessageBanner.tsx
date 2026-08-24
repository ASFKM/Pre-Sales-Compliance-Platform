import { useEffect, useState } from "react";
import { X, Megaphone } from "lucide-react";
import ApiClient from "../lib/api";

interface SystemMessage {
  id: string;
  source: "fleet_manager" | "local";
  audience: "admin_only" | "all_users";
  body: string;
  created_at: string;
  expires_at: string | null;
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

// A small scrolling ticker at the bottom of the app, above the diagnostic footer - notices
// relayed from the Fleet Manager (maintenance windows, etc.) or created locally by this
// installation's own super admin. Dismissal is per-browser (localStorage), no server-side
// per-user read state, kept deliberately simple. Server already filters out expired messages.
export default function SystemMessageBanner({ locale, hasPermission }: Props) {
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed());

  useEffect(() => {
    const load = () => ApiClient.get<SystemMessage[]>("/api/messages").then(setMessages).catch(() => setMessages([]));
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const canSeeAdminOnly = hasPermission("admin:settings");
  const visible = messages.filter((m) => (m.audience === "all_users" || canSeeAdminOnly) && !dismissed.includes(m.id));

  if (visible.length === 0) return null;

  // A single state update for however many ids are being dismissed at once - calling dismiss()
  // once per message in a loop was the actual bug: every call built `next` from the same stale
  // `dismissed` closure, so each subsequent setDismissed() overwrote the previous one and only the
  // last message in the loop ever actually stayed dismissed.
  const dismissAll = (ids: string[]) => {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  const combinedText = visible.map((m) => m.body).join("      •      ");

  return (
    <div className="shrink-0 h-7 flex items-center gap-2 px-3 overflow-hidden relative bg-brand-800 border-t border-brand-600">
      <Megaphone size={13} className="shrink-0 text-brand-200" />
      <div className="flex-1 overflow-hidden whitespace-nowrap relative">
        <div className="inline-block animate-ticker-scroll text-brand-50 text-[11px] font-medium">
          {combinedText}
        </div>
      </div>
      <button onClick={() => dismissAll(visible.map((m) => m.id))} className="shrink-0 text-brand-200 hover:text-white" title={locale === "pt" ? "Dispensar avisos" : "Dismiss notices"}>
        <X size={13} />
      </button>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        .animate-ticker-scroll {
          animation: ticker-scroll 22s linear infinite;
        }
        .animate-ticker-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
