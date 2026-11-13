export interface RawMetadata {
  titles: string[];
  description: string;
  tags: string[];
  hook: string;
}

export interface SanitizedMetadata {
  titles: string[];
  description: string;
  tags: string[];
  hook: string;
}

const FORBIDDEN = /[<>]/g;
/** Keep English (Latin) copy only — strip other scripts from public metadata. */
const NON_LATIN = /[^\x00-\x7F]/g;

function cleanText(s: string): string {
  return s.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
}

function toEnglishText(s: string): string {
  return cleanText(s)
    .replace(NON_LATIN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingHashtagSpam(title: string): string {
  return title.replace(/(\s#[\w]+)+\s*$/g, "").trim();
}

function latinRatio(s: string): number {
  const letters = s.replace(/[^A-Za-z\u00C0-\u024F]/g, "");
  const all = s.replace(/\s+/g, "");
  if (!all.length) return 0;
  return letters.length / all.length;
}

export function sanitizeMetadata(raw: RawMetadata): SanitizedMetadata {
  const titles = (raw.titles.length ? raw.titles : ["Highlight moment"])
    .map((t) => stripTrailingHashtagSpam(toEnglishText(t)).slice(0, 70))
    .filter((t) => t.length >= 3 && latinRatio(t) >= 0.6)
    .slice(0, 3);

  while (titles.length < 3) {
    const base = titles[0] ?? "Highlight moment";
    titles.push(
      titles.length === 0
        ? base
        : titles.length === 1
          ? `${base}`.slice(0, 70)
          : `Short: ${base}`.slice(0, 70),
    );
  }

  let description = toEnglishText(raw.description).slice(0, 4500);
  if (!description || description.length < 80) {
    const seed = titles[0] ?? "this highlight";
    description = [
      `In this Short, you'll see ${seed}.`,
      "We break down the key moment so you can follow along quickly.",
      "Watch till the end for the takeaway, then check related clips on the channel.",
    ].join(" ");
  }
  if (!/#Shorts\b/i.test(description)) {
    const tagBits = (raw.tags ?? [])
      .map((t) => toEnglishText(t).replace(/\s+/g, ""))
      .filter((t) => t.length >= 2)
      .slice(0, 6)
      .map((t) => `#${t}`);
    const tagsLine = `\n\n#Shorts${tagBits.length ? ` ${tagBits.join(" ")}` : ""}`;
    description = (description + tagsLine).slice(0, 4500);
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of raw.tags) {
    const tag = toEnglishText(t)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30);
    if (!tag || seen.has(tag) || /[^\x00-\x7F]/.test(tag)) continue;
    seen.add(tag);
    const next = [...tags, tag];
    const total = next.join(",").length;
    if (total > 450) break;
    tags.push(tag);
    if (tags.length >= 15) break;
  }
  const englishFillers = [
    "shorts",
    "highlight",
    "viral",
    "clip",
    "trending",
    "fyp",
    "mustwatch",
    "story",
  ];
  for (const filler of englishFillers) {
    if (tags.length >= 8) break;
    if (seen.has(filler)) continue;
    tags.push(filler);
    seen.add(filler);
  }

  let hook = toEnglishText(raw.hook).slice(0, 120);
  if (!hook || latinRatio(hook) < 0.6) {
    hook = (titles[0] ?? "Key moment").split(/\s+/).slice(0, 6).join(" ");
  }

  return {
    titles,
    description,
    tags,
    hook,
  };
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "is", "are", "was", "were", "be", "this", "that", "it", "you", "i", "we",
  "they", "with", "as", "from", "by", "not", "have", "has", "had", "do", "does",
]);

export function generateFallbackMetadata(clipText: string): SanitizedMetadata {
  const englishOnly = toEnglishText(clipText);
  const sentences = englishOnly
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && latinRatio(s) >= 0.6);

  const first = sentences[0] ?? "This highlight moment";
  const second = sentences[1] ?? "Here is the key detail worth noticing.";
  const third =
    sentences[2] ??
    "Follow along and use this tip in your own workflow.";
  const title = first.slice(0, 70);

  const freq = new Map<string, number>();
  for (const w of englishOnly.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const tags = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  const description = [
    first,
    second,
    third,
    "If this helped, like the Short and subscribe for more practical clips.",
  ].join(" ");

  return sanitizeMetadata({
    titles: [title, title.slice(0, 50), `Short: ${title}`.slice(0, 70)],
    description,
    tags,
    hook: title.split(/\s+/).slice(0, 6).join(" "),
  });
}
