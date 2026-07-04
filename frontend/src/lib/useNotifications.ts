import { useEffect, useState, useCallback } from "react";
import { api, type NotificationItem } from "./api";
import { useSession } from "./session";

/** Polls the activity feed + unread count; exposes markRead/refresh. */
export function useNotifications(pollMs = 15000) {
  const session = useSession();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!session.email) return;
    try {
      const r = await api.listNotifications(session.email);
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* ignore */ }
  }, [session.email]);

  const markRead = useCallback(async () => {
    if (!session.email) return;
    try {
      await api.markNotificationsRead(session.email);
      setUnread(0);
      setItems((cur) => cur.map((i) => ({ ...i, read: true })));
    } catch { /* ignore */ }
  }, [session.email]);

  useEffect(() => {
    if (!session.email) return;
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [session.email, refresh, pollMs]);

  return { items, unread, refresh, markRead };
}
