import type { CommandHistoryEntry } from "@/stores/commandHistoryStore";

export interface RankedHistoryEntry {
  entry: CommandHistoryEntry;
  score: number;
}

/** Score a case-insensitive subsequence. A contiguous run and a word start are
 * worth more than a scattered match; null means the query is not a subsequence. */
export function subsequenceScore(query: string, text: string): number | null {
  const q = query.trim().toLocaleLowerCase();
  const candidate = text.toLocaleLowerCase();
  if (!q) return 0;

  let queryIndex = 0;
  let previousIndex = -1;
  let score = 0;
  for (let i = 0; i < candidate.length && queryIndex < q.length; i += 1) {
    if (candidate[i] !== q[queryIndex]) continue;

    score += 1;
    if (previousIndex === i - 1) score += 8;
    if (i === 0 || /[\s_./:-]/.test(candidate[i - 1])) score += 6;
    previousIndex = i;
    queryIndex += 1;
  }

  return queryIndex === q.length ? score : null;
}

/** Rank local history without changing the store's retention or filtering
 * policy. Command text always outranks a label-only match. */
export function rankCommandHistory(
  entries: CommandHistoryEntry[],
  query: string,
): CommandHistoryEntry[] {
  const normalized = query.trim();
  if (!normalized) return [...entries].sort((a, b) => b.timestamp - a.timestamp);

  return entries
    .map((entry, index): RankedHistoryEntry & { index: number } => {
      const command = subsequenceScore(normalized, entry.command);
      const session = subsequenceScore(normalized, entry.sessionName);
      const connection = subsequenceScore(normalized, entry.connectionId);
      const labelScore = Math.max(session ?? -Infinity, connection ?? -Infinity);
      return {
        entry,
        // The bands make command matches primary and labels secondary, while
        // retaining enough score detail for contiguous/boundary ranking.
        score: command === null ? (labelScore === -Infinity ? -Infinity : 1_000 + labelScore) : 10_000 + command,
        index,
      };
    })
    .filter((item) => item.score !== -Infinity)
    .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp || b.index - a.index)
    .map((item) => item.entry);
}
