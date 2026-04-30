/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

export type DiscoveryPageType =
  | "person_profile"
  | "team_or_roster"
  | "lab_or_group_page"
  | "article_or_press_release"
  | "event_or_speaker_page"
  | "directory_or_index_page"
  | "low_value_boilerplate"
  | "irrelevant";

export interface ParsedPageLink {
  url: string;
  anchorText: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  canonicalUrl: string;
  domain: string;
  status: number;
  contentType: string;
  title: string;
  excerpt: string;
  text: string;
  contentHash: string;
  links: ParsedPageLink[];
  fetchedAt: string;
}

export interface PageClassification {
  pageType: DiscoveryPageType;
  confidence: number;
  reason: string;
  method: "heuristic" | "llm";
  shouldExtract: boolean;
  shouldExpand: boolean;
}

export interface ScoredChildLink {
  url: string;
  anchorText: string;
  score: number;
  reason: string;
}

export interface ChildLinkScoringContext {
  parentPageType?: DiscoveryPageType;
  parentYieldedCandidate?: boolean;
  parentHasStrongSignals?: boolean;
  domainApprovedCount?: number;
  domainYieldScore?: number;
}

export interface ChildLinkSelectionOptions {
  limit?: number;
  minScore?: number;
  context?: ChildLinkScoringContext;
}

export interface HarvestedFrontierSeed {
  sourceUrl: string;
  urls: string[];
  contentType: string;
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

const POSITIVE_PATH_PATTERNS = [
  /\/people\b/,
  /\/person\b/,
  /\/team\b/,
  /\/faculty\b/,
  /\/staff\b/,
  /\/members?\b/,
  /\/leadership\b/,
  /\/board\b/,
  /\/fellows?\b/,
  /\/alumni\b/,
  /\/labs?\b/,
  /\/group\b/,
  /\/research\b/,
  /\/speakers?\b/,
  /\/conference\b/,
  /\/event\b/,
  /\/news\b/,
  /\/press\b/,
];

const NEGATIVE_PATH_PATTERNS = [
  /\/login\b/,
  /\/signin\b/,
  /\/signup\b/,
  /\/privacy\b/,
  /\/terms\b/,
  /\/policy\b/,
  /\/cookies?\b/,
  /\/calendar\b/,
  /\/careers?\b/,
  /\/jobs?\b/,
  /\/search\b/,
  /\/tag\b/,
  /\/archive\b/,
  /\/donate\b/,
];

const FLEMISH_TERMS = [
  "ku leuven",
  "ugent",
  "ghent university",
  "vub",
  "vrije universiteit brussel",
  "uantwerp",
  "university of antwerp",
  "imec",
  "baef",
  "belgian",
  "flemish",
  "flanders",
];

const US_TERMS = [
  "united states",
  "usa",
  "u.s.",
  "massachusetts",
  "california",
  "new york",
  "texas",
  "washington",
  "illinois",
  "florida",
  "boston",
  "new york city",
  "san francisco",
  "chicago",
  "seattle",
];

const COMMON_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/news/feed",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return Array.from(String(value))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127 || code === 9 || code === 10 || code === 13;
    })
    .join("");
}

export function normalizeWhitespace(value: string): string {
  return safeString(value).replace(/\s+/g, " ").trim();
}

export function extractDomain(inputUrl: string): string {
  try {
    const url = new URL(inputUrl);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function canonicalizeUrl(inputUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(inputUrl, baseUrl) : new URL(inputUrl);

    if (!/^https?:$/.test(url.protocol)) {
      return null;
    }

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    for (const key of [...url.searchParams.keys()]) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || TRACKING_PARAMS.has(lowerKey)) {
        url.searchParams.delete(key);
      }
    }

    const pathname = url.pathname
      .replace(/\/index\.(html|htm|php)$/i, "/")
      .replace(/\/+$/, "");
    url.pathname = pathname || "/";
    url.searchParams.sort();

    return url.toString();
  } catch {
    return null;
  }
}

export async function hashString(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function maybeParseHtml(html: string): Document | null {
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

function extractCanonicalHref(doc: Document | null): string {
  if (!doc) return "";
  return normalizeWhitespace(
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
  );
}

function extractTitle(doc: Document | null, html: string): string {
  if (doc) {
    const docTitle = normalizeWhitespace(doc.title || "");
    if (docTitle) return docTitle;

    const heading = normalizeWhitespace(
      doc.querySelector("h1")?.textContent || "",
    );
    if (heading) return heading;
  }

  const fallback = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  return normalizeWhitespace(fallback);
}

function extractText(doc: Document | null, html: string): string {
  if (doc?.body) {
    doc.querySelectorAll("script, style, noscript, svg").forEach((node) => node.remove());
    return normalizeWhitespace(doc.body.textContent || "");
  }

  const fallback = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(fallback);
}

function extractLinks(doc: Document | null, baseUrl: string): ParsedPageLink[] {
  if (!doc) return [];

  const dedupe = new Set<string>();
  const links: ParsedPageLink[] = [];

  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = normalizeWhitespace(anchor.getAttribute("href") || "");
    const anchorText = normalizeWhitespace(anchor.textContent || "");
    const canonicalUrl = canonicalizeUrl(href, baseUrl);

    if (!canonicalUrl) continue;
    if (dedupe.has(canonicalUrl)) continue;
    if (!anchorText && !href) continue;

    dedupe.add(canonicalUrl);
    links.push({ url: canonicalUrl, anchorText });

    if (links.length >= 200) {
      break;
    }
  }

  return links;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const requestedUrl = canonicalizeUrl(url) || url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(requestedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "FlemishNetworkDiscoveryBot/1.0",
      },
    });

    const finalUrl = canonicalizeUrl(response.url || requestedUrl) || requestedUrl;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const fetchedAt = new Date().toISOString();

    if (!response.ok) {
      return {
        url: requestedUrl,
        finalUrl,
        canonicalUrl: finalUrl,
        domain: extractDomain(finalUrl),
        status: response.status,
        contentType,
        title: "",
        excerpt: "",
        text: "",
        contentHash: "",
        links: [],
        fetchedAt,
      };
    }

    const html = await response.text();
    const doc = maybeParseHtml(html);
    const canonicalHref = extractCanonicalHref(doc);
    const canonicalUrl =
      canonicalizeUrl(canonicalHref || finalUrl, finalUrl) || finalUrl;
    const title = extractTitle(doc, html);
    const text = extractText(doc, html).slice(0, 24000);
    const contentHash = text ? await hashString(text) : "";
    const excerpt = text.slice(0, 500);
    const links = extractLinks(doc, finalUrl);

    return {
      url: requestedUrl,
      finalUrl,
      canonicalUrl,
      domain: extractDomain(canonicalUrl || finalUrl),
      status: response.status,
      contentType,
      title,
      excerpt,
      text,
      contentHash,
      links,
      fetchedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface TextFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
}

async function fetchTextResponse(url: string, accept: string): Promise<TextFetchResult | null> {
  const requestedUrl = canonicalizeUrl(url) || url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(requestedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "FlemishNetworkDiscoveryBot/1.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    return {
      finalUrl: canonicalizeUrl(response.url || requestedUrl) || requestedUrl,
      status: response.status,
      contentType: (response.headers.get("content-type") || "").toLowerCase(),
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXmlEntities(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function extractXmlLocs(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)];
  return matches
    .map((match) => decodeXmlEntities(match[1] || ""))
    .filter(Boolean);
}

function extractFeedItemUrls(xml: string): string[] {
  const linkMatches = [...xml.matchAll(/<item[\s\S]*?<link>([\s\S]*?)<\/link>/gi)];
  const entryHrefMatches = [...xml.matchAll(/<entry[\s\S]*?<link[^>]+href=["']([^"']+)["']/gi)];
  const entryTextMatches = [...xml.matchAll(/<entry[\s\S]*?<link>([\s\S]*?)<\/link>/gi)];

  return [...linkMatches, ...entryHrefMatches, ...entryTextMatches]
    .map((match) => decodeXmlEntities(match[1] || ""))
    .filter(Boolean);
}

function scoreHarvestedUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    let score = 0;

    if (POSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      score += 3;
    }
    if (NEGATIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      score -= 5;
    }
    if (/\/news|\/press|\/people|\/team|\/faculty|\/members|\/fellows|\/alumni|\/speaker/.test(path)) {
      score += 2;
    }
    if (/(\?|&)(page|paged|offset|sort|replytocom)=/.test(query) || /\/page\/\d+/.test(path)) {
      score -= 4;
    }
    if (path.split("/").filter(Boolean).length >= 6) {
      score -= 1;
    }

    return score;
  } catch {
    return -10;
  }
}

function prioritizeHarvestedUrls(urls: string[], domain: string, limit: number): string[] {
  const dedupe = new Set<string>();
  const scored = urls
    .map((value) => canonicalizeUrl(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => extractDomain(value) === domain)
    .filter((value) => !value.toLowerCase().endsWith(".xml"))
    .map((value) => ({ url: value, score: scoreHarvestedUrl(value) }))
    .filter((item) => item.score > -3)
    .sort((a, b) => b.score - a.score);

  const result: string[] = [];

  for (const item of scored) {
    if (dedupe.has(item.url)) continue;
    dedupe.add(item.url);
    result.push(item.url);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export async function harvestSitemapUrls(
  domain: string,
  limit = 20,
): Promise<HarvestedFrontierSeed | null> {
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/sitemap-index.xml`,
  ];

  for (const candidate of candidates) {
    const response = await fetchTextResponse(
      candidate,
      "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
    );
    if (!response) continue;

    const topLevelLocs = extractXmlLocs(response.text);
    if (topLevelLocs.length === 0) continue;

    let urls = topLevelLocs;
    const nestedSitemaps = topLevelLocs
      .map((value) => canonicalizeUrl(value))
      .filter((value): value is string => Boolean(value))
      .filter((value) => value.toLowerCase().endsWith(".xml"))
      .sort((a, b) => scoreHarvestedUrl(b) - scoreHarvestedUrl(a))
      .slice(0, 4);

    if (nestedSitemaps.length > 0) {
      const nestedUrls: string[] = [];

      for (const nestedUrl of nestedSitemaps) {
        const nestedResponse = await fetchTextResponse(
          nestedUrl,
          "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
        );
        if (!nestedResponse) continue;
        nestedUrls.push(...extractXmlLocs(nestedResponse.text));

        if (nestedUrls.length >= limit * 3) {
          break;
        }
      }

      if (nestedUrls.length > 0) {
        urls = nestedUrls;
      }
    }

    const prioritized = prioritizeHarvestedUrls(urls, domain, limit);
    if (prioritized.length === 0) continue;

    return {
      sourceUrl: response.finalUrl,
      urls: prioritized,
      contentType: response.contentType,
    };
  }

  return null;
}

export async function harvestFeedUrls(
  domain: string,
  limit = 10,
): Promise<HarvestedFrontierSeed | null> {
  for (const path of COMMON_FEED_PATHS) {
    const response = await fetchTextResponse(
      `https://${domain}${path}`,
      "application/rss+xml,application/atom+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
    );
    if (!response) continue;

    const urls = prioritizeHarvestedUrls(extractFeedItemUrls(response.text), domain, limit);
    if (urls.length === 0) continue;

    return {
      sourceUrl: response.finalUrl,
      urls,
      contentType: response.contentType,
    };
  }

  return null;
}

function countPatternMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

export function classifyPageHeuristically(page: FetchedPage): PageClassification {
  const url = page.canonicalUrl || page.finalUrl || page.url;
  const path = safeString(new URL(url).pathname).toLowerCase();
  const title = page.title.toLowerCase();
  const excerpt = page.excerpt.toLowerCase();
  const textWindow = page.text.slice(0, 5000);
  const textWindowLower = textWindow.toLowerCase();
  const nameCount = countPatternMatches(textWindow, /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g);
  const linkCount = page.links.length;

  let personScore = 0;
  let rosterScore = 0;
  let labScore = 0;
  let articleScore = 0;
  let eventScore = 0;
  let directoryScore = 0;
  let lowValueScore = 0;

  if (NEGATIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    lowValueScore += 6;
  }

  if (POSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    rosterScore += 2;
  }

  if (/(\/people\/|\/person\/|\/faculty\/|\/staff\/)/.test(path)) {
    personScore += 3;
  }
  if (/(\/team|\/members|\/fellows|\/alumni|\/leadership|\/board)/.test(path)) {
    rosterScore += 4;
  }
  if (/(\/lab|\/labs|\/group|\/research-center|\/research-centre)/.test(path)) {
    labScore += 4;
  }
  if (/(\/news|\/press|\/article|\/blog|\/story|\/release)/.test(path)) {
    articleScore += 4;
  }
  if (/(\/event|\/conference|\/speaker|\/summit|\/symposium)/.test(path)) {
    eventScore += 4;
  }
  if (/(\/directory|\/index|\/listing|\/profiles)/.test(path)) {
    directoryScore += 3;
  }

  if (/(team|faculty|members|fellows|alumni|leadership|board)/.test(title)) {
    rosterScore += 3;
  }
  if (/(lab|group|center|centre|research)/.test(title)) {
    labScore += 3;
  }
  if (/(press|news|article|story|interview|announcement)/.test(title)) {
    articleScore += 3;
  }
  if (/(speaker|conference|event|summit|symposium|workshop)/.test(title)) {
    eventScore += 3;
  }
  if (/(directory|index|listing)/.test(title)) {
    directoryScore += 2;
  }
  if (/(privacy|cookie|terms|careers|jobs|login|sign in)/.test(title)) {
    lowValueScore += 4;
  }
  if (/(profile|bio|about)/.test(title) && nameCount > 0) {
    personScore += 2;
  }

  if (/(faculty|team|members|fellows|alumni|leadership)/.test(excerpt)) {
    rosterScore += 2;
  }
  if (/(lab|research group|center|centre)/.test(excerpt)) {
    labScore += 2;
  }
  if (/(press release|news|announced|appointed|joins|interview)/.test(excerpt)) {
    articleScore += 2;
  }
  if (/(speaker|panel|conference|event)/.test(excerpt)) {
    eventScore += 2;
  }
  if (/(directory|listing|index)/.test(excerpt)) {
    directoryScore += 1;
  }

  if (nameCount >= 8) {
    rosterScore += 3;
    directoryScore += 2;
  } else if (nameCount >= 3) {
    rosterScore += 1;
  }

  if (linkCount >= 30) {
    directoryScore += 2;
  }

  const flemishSignals = FLEMISH_TERMS.filter((term) => textWindowLower.includes(term)).length;
  const usSignals = US_TERMS.filter((term) => textWindowLower.includes(term)).length;

  if (flemishSignals > 0) {
    personScore += 1;
    rosterScore += 1;
    articleScore += 1;
  }
  if (usSignals > 0) {
    personScore += 1;
    rosterScore += 1;
    eventScore += 1;
  }

  if (page.text.length < 120) {
    lowValueScore += 2;
  }

  const scores: Array<[DiscoveryPageType, number]> = [
    ["person_profile", personScore],
    ["team_or_roster", rosterScore],
    ["lab_or_group_page", labScore],
    ["article_or_press_release", articleScore],
    ["event_or_speaker_page", eventScore],
    ["directory_or_index_page", directoryScore],
    ["low_value_boilerplate", lowValueScore],
    ["irrelevant", 0],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  const [pageType, topScore] = scores[0];
  const secondScore = scores[1]?.[1] || 0;
  const confidence = clamp(
    topScore <= 0 ? 0.2 : 0.45 + (topScore - secondScore) * 0.1,
    0.2,
    0.95,
  );

  if (pageType === "low_value_boilerplate" || topScore <= 0) {
    return {
      pageType: topScore <= 0 ? "irrelevant" : "low_value_boilerplate",
      confidence,
      reason: topScore <= 0
        ? "No strong person, roster, lab, article, or event signals."
        : "Negative path/title signals outweighed useful content signals.",
      method: "heuristic",
      shouldExtract: false,
      shouldExpand: false,
    };
  }

  const shouldExtract = !["directory_or_index_page"].includes(pageType);
  const shouldExpand = true;

  return {
    pageType,
    confidence,
    reason: `Signals favored ${pageType} (score ${topScore}, names ${nameCount}, links ${linkCount}, Flemish cues ${flemishSignals}).`,
    method: "heuristic",
    shouldExtract,
    shouldExpand,
  };
}

export function scoreChildLink(
  parentUrl: string,
  link: ParsedPageLink,
  context: ChildLinkScoringContext = {},
): ScoredChildLink | null {
  const parentDomain = extractDomain(parentUrl);
  const childDomain = extractDomain(link.url);
  const childUrl = new URL(link.url);
  const path = safeString(childUrl.pathname).toLowerCase();
  const query = safeString(childUrl.search).toLowerCase();
  const anchorText = normalizeWhitespace(link.anchorText).toLowerCase();
  const parentPath = safeString(new URL(parentUrl).pathname).toLowerCase();

  if (!link.url || !childDomain) return null;
  if (parentDomain !== childDomain) return null;
  if (link.url === canonicalizeUrl(parentUrl)) return null;

  let score = 0;
  const reasons: string[] = [];

  if (POSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    score += 3;
    reasons.push("positive_path");
  }
  if (NEGATIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    score -= 5;
    reasons.push("negative_path");
  }
  if (/(team|faculty|members|fellows|alumni|leadership|board|speaker|event|lab|group)/.test(anchorText)) {
    score += 3;
    reasons.push("positive_anchor");
  }
  if (/(privacy|terms|calendar|careers|search|login|sign in|jobs)/.test(anchorText)) {
    score -= 5;
    reasons.push("negative_anchor");
  }
  if (/(about|contact|home|overview|news|blog)/.test(anchorText) && path.split("/").filter(Boolean).length <= 2) {
    score -= 2;
    reasons.push("generic_nav");
  }
  if (/(ku leuven|ugent|ghent university|vub|uantwerp|imec|baef|belgian|flemish)/.test(anchorText)) {
    score += 2;
    reasons.push("flemish_anchor");
  }
  if (/\/share\b|\/author\b|\/category\b|\/tags?\b|\/wp-json\b|\/cdn-cgi\//.test(path)) {
    score -= 4;
    reasons.push("system_path");
  }
  if (/(\?|&)(page|paged|offset|sort|replytocom)=/.test(query) || /\/page\/\d+/.test(path)) {
    score -= 4;
    reasons.push("pagination");
  }
  if (path === parentPath || path.startsWith(`${parentPath}/page/`)) {
    score -= 2;
    reasons.push("near_duplicate_path");
  }

  if (context.parentHasStrongSignals) {
    score += 1;
    reasons.push("strong_parent");
  }
  if (context.parentYieldedCandidate) {
    score += 2;
    reasons.push("yielding_parent");
  }
  if ((context.domainApprovedCount || 0) > 0) {
    score += 2;
    reasons.push("approved_domain");
  }
  if ((context.domainYieldScore || 0) >= 1) {
    score += 1;
    reasons.push("yield_domain");
  }
  if (
    context.parentPageType === "directory_or_index_page" &&
    /(profile|person|member|faculty|staff|team|people)/.test(`${path} ${anchorText}`)
  ) {
    score += 2;
    reasons.push("directory_child");
  }

  if (path.split("/").filter(Boolean).length >= 5) {
    score -= 1;
    reasons.push("deep_path");
  }
  if (path.split("/").filter(Boolean).length >= 7) {
    score -= 1;
    reasons.push("very_deep_path");
  }

  if (score <= 1) return null;

  return {
    url: link.url,
    anchorText: normalizeWhitespace(link.anchorText),
    score,
    reason: reasons.join(","),
  };
}

export function pickTopChildLinks(
  parentUrl: string,
  links: ParsedPageLink[],
  options: number | ChildLinkSelectionOptions = 5,
): ScoredChildLink[] {
  const limit = typeof options === "number" ? options : options.limit ?? 5;
  const minScore = typeof options === "number" ? 2 : options.minScore ?? 2;
  const context = typeof options === "number" ? {} : options.context ?? {};
  const dedupe = new Set<string>();
  const scored = links
    .map((link) => scoreChildLink(parentUrl, link, context))
    .filter((link): link is ScoredChildLink => link !== null && link.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const result: ScoredChildLink[] = [];

  for (const link of scored) {
    if (dedupe.has(link.url)) continue;
    dedupe.add(link.url);
    result.push(link);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}
