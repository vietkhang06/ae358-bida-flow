export type TimeRange = { started_at: string; ended_at: string | null };

/** Clip and merge pauses so corrupt/overlapping history cannot double-discount time. */
export function billableSeconds(segment: TimeRange, pauses: TimeRange[], at: Date): number {
  const start = Date.parse(segment.started_at);
  const end = Math.min(segment.ended_at ? Date.parse(segment.ended_at) : at.getTime(), at.getTime());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const ranges = pauses.map((pause) => [
    Math.max(start, Date.parse(pause.started_at)),
    Math.min(end, pause.ended_at ? Date.parse(pause.ended_at) : end),
  ]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0]);
  let paused = 0, cursor = start;
  for (const [a, b] of ranges) {
    paused += Math.max(0, b - Math.max(a, cursor));
    cursor = Math.max(cursor, b);
  }
  return Math.max(0, (end - start - paused) / 1000);
}

export function segmentAmount(seconds: number, hourlyRate: number) {
  return Math.round(Math.ceil(seconds / 60) * hourlyRate / 60);
}
