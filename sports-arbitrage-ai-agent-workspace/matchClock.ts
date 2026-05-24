/** Convert fractional match minutes (e.g. 4.9) to clock display (4:54). */
export function formatMatchClock(totalMinutes: number): string {
  const safe = Math.max(0, totalMinutes);
  let mins = Math.floor(safe);
  let secs = Math.round((safe - mins) * 60);
  if (secs >= 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Commentary line label — keeps stoppage notation for ESPN rows. */
export function formatCommentaryClock(minute: number, extraTime?: number): string {
  if (extraTime) return `${minute}'+${extraTime}`;
  return `${minute}'`;
}
