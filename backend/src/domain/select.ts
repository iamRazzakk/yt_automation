export interface Selectable {
  start: number;
  end: number;
  score: number;
}

export function selectNonOverlapping<T extends Selectable>(
  items: T[],
  count: number,
  opts: { maxOverlapRatio?: number; minGapSec?: number } = {},
): T[] {
  const maxOverlap = opts.maxOverlapRatio ?? 0.2;
  const minGap = opts.minGapSec ?? 5;
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const accepted: T[] = [];

  for (const item of sorted) {
    if (accepted.length >= count) break;
    const dur = item.end - item.start;
    const ok = accepted.every((a) => {
      const overlap = Math.max(
        0,
        Math.min(item.end, a.end) - Math.max(item.start, a.start),
      );
      if (overlap / dur >= maxOverlap) return false;
      const gap = Math.max(item.start, a.start) - Math.min(item.end, a.end);
      // gap is negative when overlapping; when separate, positive distance between intervals
      const separation =
        item.end < a.start
          ? a.start - item.end
          : a.end < item.start
            ? item.start - a.end
            : 0;
      if (separation > 0 && separation < minGap) return false;
      return true;
    });
    if (ok) accepted.push(item);
  }

  return accepted.sort((a, b) => a.start - b.start);
}
