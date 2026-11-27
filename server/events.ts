import { randomUUID } from "node:crypto";
import { Store, type Actor } from "./store.js";
// A committed event is processed independently of the originating transaction.
// Consumer receipts make retries idempotent; failed work never changes domain truth.
export function processEvents(
  s: Store,
  limit = 100,
  deliver?: (event: any) => void,
) {
  const pending = s.db
    .prepare(
      "SELECT * FROM outbox WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT ?",
    )
    .all(Date.now(), limit) as any[];
  for (const e of pending) {
    try {
      s.tx(() => {
        if (
          s.db
            .prepare("SELECT 1 FROM deliveries WHERE event_id=? AND consumer=?")
            .get(e.id, "in-app")
        ) {
          s.db
            .prepare("UPDATE outbox SET state='delivered' WHERE id=?")
            .run(e.id);
          return;
        }
        if (deliver) deliver(e);
        const payload = JSON.parse(e.payload),
          a: Actor = {
            id: e.actor,
            org: e.org,
            name: "Event processor",
            role: "admin",
          };
        const settings = s.list(e.org, "settings")[0];
        if (settings?.dispatch && e.kind === "assignment") {
          const assignment = { ...payload, id: e.entity };
          const users = s.db
            .prepare(
              "SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org=? AND m.worker_id=? AND m.active=1 AND u.active=1",
            )
            .all(e.org, payload.workerId) as any[];
          for (const user of users)
            s.add(a, "notice", {
              projectId: assignment.projectId,
              recipientId: user.id,
              title:
                "Assignment " +
                (assignment.status === "Cancelled" ? "cancelled" : "updated"),
              message: `${assignment.date}: ${assignment.hours} planned hours. Open your field view for the work package.`,
              assignmentId: assignment.id,
              eventId: e.id,
              status: "Unread",
            });
        }
        s.db
          .prepare("INSERT INTO deliveries VALUES(?,?,?)")
          .run(e.id, "in-app", new Date().toISOString());
        s.db
          .prepare("UPDATE outbox SET state='delivered',error=NULL WHERE id=?")
          .run(e.id);
      });
    } catch (error: any) {
      const tries = e.attempts + 1;
      s.db
        .prepare(
          "UPDATE outbox SET state=?,attempts=?,next_at=?,error=? WHERE id=?",
        )
        .run(
          tries >= 5 ? "dead-letter" : "pending",
          tries,
          Date.now() + Math.min(3600000, 1000 * 2 ** tries),
          String(error.message).slice(0, 500),
          e.id,
        );
    }
  }
  return { processed: pending.length };
}
