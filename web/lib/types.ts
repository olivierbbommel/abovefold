// Shared types for the data layer. Other modules (routes, components) code
// against these, do not rename fields without updating every caller.

export type Item = {
  id: number;
  title: string;
  url: string;
  feedTitle: string;
  feedId: number;
  publishedAt: string; // ISO 8601
  leadImage: string | null; // raw stored URL, NOT rewritten to /proxy/... here
  summary: string | null;
  bullets: string[] | null;
  topics: string[] | null;
  score: number;
  reason: string;
  clusterSize: number; // 1 when the article has no cluster row
  clusterId: number | null;
};

export type Article = Item & {
  extractedText: string;
  author: string | null;
};

export type Folder = {
  id: number;
  title: string;
  unread: number;
};

export type SourceStats = {
  openRate: number | null; // null when fewer than 10 opened+skipped interactions exist
  volumePerDay: number;
  lastPost: string | null; // ISO 8601
};
