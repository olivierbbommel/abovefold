// Starter packs offered on the "bring your feeds" onboarding step, for anyone
// without an OPML export from another reader. Every URL was checked live when
// added, but feeds can go dark later; the subscribe route reports per-feed
// failures rather than assuming these always succeed.
//
// `category` becomes (or matches) a Miniflux category, so picking a pack
// whose folder already exists adds to that folder instead of creating a
// near-duplicate.

export type StarterFeed = {
  title: string;
  url: string;
};

export type StarterPack = {
  id: string;
  name: string;
  category: string;
  description: string;
  feeds: StarterFeed[];
};

export const STARTER_PACKS: StarterPack[] = [
  {
    id: "ai-ml",
    name: "AI & ML",
    category: "AI & ML",
    description: "Research notes and industry commentary, not press releases.",
    feeds: [
      { title: "Simon Willison's Weblog", url: "https://simonwillison.net/atom/everything/" },
      { title: "Import AI", url: "https://jack-clark.net/feed/" },
      { title: "The Gradient", url: "https://thegradient.pub/rss/" },
      { title: "OpenAI News", url: "https://openai.com/news/rss.xml" },
    ],
  },
  {
    id: "tech",
    name: "Tech",
    category: "Tech",
    description: "General technology news and analysis.",
    feeds: [
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
      { title: "Ars Technica - All content", url: "https://feeds.arstechnica.com/arstechnica/index" },
      { title: "Hacker News: Front Page", url: "https://hnrss.org/frontpage" },
      { title: "TechCrunch", url: "https://techcrunch.com/feed/" },
    ],
  },
  {
    id: "business",
    name: "Business",
    category: "Business",
    description: "Strategy, markets, and long-form business writing.",
    feeds: [
      { title: "Stratechery by Ben Thompson", url: "https://stratechery.com/feed/" },
      { title: "Marginal Revolution", url: "https://marginalrevolution.com/feed" },
      { title: "AVC", url: "https://avc.com/feed/" },
      { title: "NYT DealBook", url: "https://rss.nytimes.com/services/xml/rss/nyt/DealBook.xml" },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    category: "Marketing",
    description: "Growth, brand, and search marketing news.",
    feeds: [
      { title: "Marketing Dive - Latest News", url: "https://www.marketingdive.com/feeds/news/" },
      { title: "Seth Godin's Blog", url: "https://seths.blog/feed/" },
      { title: "Search Engine Land", url: "https://searchengineland.com/feed" },
      { title: "HubSpot Marketing Blog", url: "https://blog.hubspot.com/marketing/rss.xml" },
    ],
  },
  {
    id: "gaming",
    name: "Gaming",
    category: "Gaming",
    description: "Reviews, industry news, and PC gaming coverage.",
    feeds: [
      { title: "Polygon.com", url: "https://www.polygon.com/feed/" },
      { title: "Kotaku", url: "https://kotaku.com/feed" },
      { title: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
      { title: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed" },
    ],
  },
  {
    id: "science",
    name: "Science",
    category: "Science",
    description: "Discoveries and research explained, from physics to space.",
    feeds: [
      { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/" },
      { title: "NASA", url: "https://www.nasa.gov/news-release/feed/" },
      { title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml" },
    ],
  },
  {
    id: "world",
    name: "World news",
    category: "World",
    description: "International coverage from newsrooms on different continents.",
    feeds: [
      { title: "BBC News World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      { title: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
      { title: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
      { title: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    ],
  },
];
