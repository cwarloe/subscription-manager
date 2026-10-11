export type OverlapRule = {
  ids: string[];
  note: string;
};

/** Product-structure warnings. These are not prices and not confirmed discounts. */
export const OVERLAP_RULES: OverlapRule[] = [
  {
    ids: ["apple-one", "apple-music"],
    note: "Apple One can include Apple Music. Confirm the tier before paying for both.",
  },
  {
    ids: ["apple-one", "apple-tv"],
    note: "Apple One can include Apple TV+. Confirm the tier before paying for both.",
  },
  {
    ids: ["apple-one", "icloud"],
    note: "Apple One can include some iCloud+ storage. A separate iCloud+ plan may duplicate that storage.",
  },
  {
    ids: ["amazon-prime", "prime-video"],
    note: "Amazon Prime includes Prime Video. A separate Prime Video membership can duplicate it.",
  },
  {
    ids: ["youtube-premium", "youtube-music"],
    note: "YouTube Premium includes YouTube Music Premium.",
  },
  {
    ids: ["disney-plus", "hulu"],
    note: "Disney sells bundles that combine Disney+ and Hulu. Separate plans can cost more than a bundle. The bundle price is unknown until it is verified.",
  },
  {
    ids: ["disney-plus", "espn"],
    note: "Disney sells bundles that include ESPN streaming. Separate plans are not assumed to be cheaper.",
  },
  {
    ids: ["hulu", "espn"],
    note: "Hulu and ESPN are sometimes sold as a bundle. Separate subscriptions are flagged only as possible overlap.",
  },
  {
    ids: ["microsoft-365", "copilot"],
    note: "Some Microsoft 365 plans include Copilot features and others sell Copilot separately. Inclusion is not assumed.",
  },
  {
    ids: ["creative-cloud", "firefly"],
    note: "Some Creative Cloud plans include Firefly credits. A separate Firefly plan can overlap.",
  },
  {
    ids: ["gemini", "google-one"],
    note: "Some Google One tiers include Gemini features. Do not assume every storage tier does.",
  },
  {
    ids: ["spotify", "apple-music", "youtube-music", "amazon-music", "tidal"],
    note: "These are separate music catalogs. More than one is a possible duplicate subscription, not a shared discount.",
  },
];

export function findOverlaps(activeServiceIds: string[]): { ids: string[]; note: string }[] {
  const active = new Set(activeServiceIds);
  const found: { ids: string[]; note: string }[] = [];
  for (const rule of OVERLAP_RULES) {
    const hit = rule.ids.filter((id) => active.has(id));
    if (hit.length >= 2) found.push({ ids: hit, note: rule.note });
  }
  return found;
}

export function findDuplicates(activeServiceIds: string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of activeServiceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}
