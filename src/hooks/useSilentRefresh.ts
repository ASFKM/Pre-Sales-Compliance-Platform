import { useEffect } from "react";

// Phase 2 (auth hardening): the access token is now short-lived (10 min) since it's backed by
// refresh token rotation - this keeps it renewed in the background so the user is never
// interrupted by it expiring mid-session. The refresh token itself is an httpOnly cookie, never
// touched here; the browser sends it automatically with this same-origin request.
const REFRESH_INTERVAL_MS = 8 * 60 * 1000;

export function useSilentRefresh(isAuthenticated: boolean, onSessionExpired: () => void) {
  useEffect(() => {
    if (!isAuthenticated) return;

    const refresh = async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (!res.ok) {
          onSessionExpired();
          return;
        }
        const data = await res.json();
        if (data.token) {
          localStorage.setItem("ca_session_token", data.token);
        }
      } catch (err) {
        console.error("Silent token refresh failed", err);
      }
    };

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, onSessionExpired]);
}
