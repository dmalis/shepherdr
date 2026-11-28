// fork Needs you 5/6, one list: the service works out every open action once per snapshot (web/shared/attention.ts
// projectAttention, the one rule) and sends it with the snapshot, each task carrying its lead action. The pages' counts
// and lists, the app badge, the glance feed and which alerts may reach a device (service/push.ts alertsOf) all read
// this one result, so they never disagree. The design: fork/specs/needs-you.md.
import { withAttention } from "../web/shared/attention.ts";
import type { Snapshot } from "../web/shared/types.ts";

/** the snapshot with its open actions (snapshot.attention) and each task's lead action (task.action), at `now` */
export function attend<S extends Snapshot>(snap: S, now = Date.now()): S {
  const withIt = withAttention(snap, now);
  // in place: the service's snapshot is one object its later steps (push, glance, the inbox) read from
  snap.tasks = withIt.tasks;
  snap.attention = withIt.attention;
  return snap;
}
