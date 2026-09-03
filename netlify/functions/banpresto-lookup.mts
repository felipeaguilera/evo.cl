import type { Context } from "@netlify/functions";
import https from "node:https";
import http from "node:http";

export interface BanprestoProductResult {
  query: string;
  jan: string;
  itemNo?: string;
  title: string;
  originalTitle?: string;
  franchise: string;
  line: string;
  character?: string;
  price?: string;
  image: string;
  gallery: string[];
  link?: string;
  source: "distritomax" | "littlebuddytoys" | "upc_database" | "local_index" | "not_found";
  description?: string;
  description_es?: string;
  descriptionHtml?: string;
  descriptionHtml_en?: string;
  status: "found" | "not_found" | "error";
  diagnosis?: string;
  error?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// Global in-memory cache for serverless lifecycle
const SERVER_CACHE = new Map<string, BanprestoProductResult>();

// Known anime franchises for tokenization & tagging
const KNOWN_FRANCHISES = [
  "Dragon Ball Z", "Dragon Ball Super", "Dragon Ball", "Naruto Shippuden", "Naruto",
  "One Piece", "Jujutsu Kaisen", "My Hero Academia", "Demon Slayer", "Kimetsu no Yaiba",
  "Chainsaw Man", "Bleach", "Spy x Family", "Hell Teacher: Jigoku Sensei Nube", "Jigoku Sensei Nube",
  "Godzilla", "Shin Godzilla", "Hunter x Hunter", "HUNTER×HUNTER", "Tokyo Revengers", "Sailor Moon",
  "Yu-Gi-Oh", "Death Note", "Haikyu!!", "Blue Lock", "Pokemon", "Mobile Suit Gundam",
  "Evangelion", "Re:Zero", "Re:ZERO", "Sword Art Online", "Attack on Titan", "Initial D", "Digimon",
  "JoJo's Bizarre Adventure", "Gintama", "Fate/Grand Order", "Dr. Stone", "Solo Leveling",
  "Sanrio", "Hello Kitty", "Mega Man", "MEGA MAN", "Umamusume", "Overlord", "Dandadan", "DANDADAN",
  "Idolmaster", "IDOLM@STER", "Hololive", "Bocchi the Rock", "Frieren", "Wind Breaker", "Kaiju No. 8"
];

// Known Banpresto product lines
const KNOWN_LINES = [
  "Maximatic", "Grandista", "Match Makers", "Glitter & Glamours", "GLITTER&GLAMOURS",
  "The Shukko", "THE SHUKKO", "DXF", "Q Posket", "Vibration Stars", "Sofvimates", "SOFVIMATES", "BIG SOFVIMATES",
  "Blood of Saiyans", "Solid and Souls", "Combination Battle", "Battle Record Collection", "Senkozekkei",
  "Monster Roar Attack", "Monster Roah Attack", "King of Artist", "Relax time", "Relax Time",
  "Fluffy Puffy", "Celestial Vivi", "Effectreme", "Clearise", "History Box",
  "Break Time Collection", "World Collectable Figure", "WCF", "Ichibansho", "Masterlise",
  "Art Vignette", "Enshrined Monsters", "Noir Edge Collection", "Espresto", "ESPRESTO",
  "Cosplay Figure Collection", "Hunting Archives", "Pop Up Parade"
];

function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: string }> {
  return new Promise((resolve) => {
    const defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*; q=0.9",
      "Accept-Language": "es-419,es;q=0.9,en-US;q=0.8,en;q=0.7",
      ...headers,
    };

    const isHttps = url.startsWith("https:");
    const client = isHttps ? https : http;

    const req = client.get(url, { headers: defaultHeaders, timeout: 9000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith("http")) {
          redirectUrl = new URL(redirectUrl, url).toString();
        }
        return resolve(fetchUrl(redirectUrl, headers));
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 200, data }));
    });

    req.on("error", (err) => resolve({ status: 500, data: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 408, data: "Request timed out" });
    });
  });
}

async function translateToSpanish(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return "";
  try {
    const clean = text
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) return "";

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(clean)}`;
    const res = await fetchUrl(url);
    if (res.status === 200 && res.data) {
      const json = JSON.parse(res.data);
      if (Array.isArray(json) && Array.isArray(json[0])) {
        return json[0].map((part: any) => part[0]).join("");
      }
    }
  } catch (err) {
    console.warn("Translation error:", err);
  }
  return text;
}

function stripNavigationBoilerplate(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove HTML link tags pointing to collections / categories
  cleaned = cleaned.replace(/<p[^>]*>\s*<a[^>]+href="[^"]*(?:collections|category|categories)[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/p>/gi, "");
  cleaned = cleaned.replace(/<a[^>]+href="[^"]*(?:collections|category|categories)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "");

  // 2. Remove "Ver Todos / Ver Todas / View All / Shop All" repeated blocks
  const navBlockPattern = /(?:(?:Ver\s+(?:Todos|Todas|Todo|Toda)|View\s+All|Shop\s+All)\b[^.!?\n<]*?){2,}$/gim;
  cleaned = cleaned.replace(navBlockPattern, "");

  // Specific single phrases commonly injected by themes
  const knownJunkPhrases = [
    /\bVer\s+(?:Todos|Todas|Todo|Toda)\s+(?:Los|Las)?\s+[^.!?\n<]+/gi,
    /\bView\s+All\s+[^.!?\n<]+/gi,
    /\bShop\s+All\s+[^.!?\n<]+/gi,
    /\bCompartir\s+en\s+(?:Facebook|Twitter|Pinterest|WhatsApp|Instagram)\b/gi,
    /\bShare\s+on\s+(?:Facebook|Twitter|Pinterest|WhatsApp|Instagram)\b/gi,
    /\bAñadir\s+a\s+(?:Favoritos|Wishlist|Lista de Deseos)\b/gi,
    /\bAdd\s+to\s+(?:Wishlist|Favorites)\b/gi,
    /\bComparar\b\s*$/gim,
    /\bCompare\b\s*$/gim,
  ];

  for (const pattern of knownJunkPhrases) {
    cleaned = cleaned.replace(pattern, "");
  }

  // 3. Remove leftover empty paragraph tags
  cleaned = cleaned.replace(/<p\b[^>]*>\s*(?:&nbsp;|\s)*<\/p>/gi, "");

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function extractMetadata(rawTitle: string) {
  const clean = (rawTitle || "")
    .replace(/[『』~～♡?¿!¡#]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let franchise = "";
  for (const f of KNOWN_FRANCHISES) {
    if (new RegExp(f.replace(/[-:×@]/g, " "), "i").test(clean)) {
      franchise = f;
      break;
    }
  }

  let line = "";
  for (const l of KNOWN_LINES) {
    if (new RegExp(l.replace("&", "[&and]").replace(/[-:]/g, " "), "i").test(clean)) {
      line = l;
      break;
    }
  }

  let character = clean;
  if (franchise) {
    character = character.replace(new RegExp(franchise.replace(/[-:×@]/g, " "), "gi"), " ");
  }
  if (line) {
    character = character.replace(new RegExp(line.replace("&", "[&and]").replace(/[-:]/g, " "), "gi"), " ");
  }
  character = character
    .replace(/\b(FIGURE|VER|VERSION|EXTRA|SPECIAL|VOL\.\d+|VOL\s*\d+|THE\s+CULLING\s+GAME|THE\s+GRANDLINE\s+SERIES\s+EXTRA|4TH\.FORM|eXtra\s+Large|XL|BANPRESTO|COSPLAY|COLLECTION)\b/gi, " ")
    .replace(/[-_:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { clean, franchise, line, character };
}

function verifyMatch(candidateTitle: string, meta: { clean: string; franchise: string; line: string; character: string }, targetTitle: string): boolean {
  const cLower = candidateTitle.toLowerCase();

  // Exclude Funko unless specifically requested
  if (cLower.includes("funko pop") || (cLower.includes("funko") && !targetTitle.toLowerCase().includes("funko"))) {
    return false;
  }

  // If character was extracted with at least 3 chars, candidate MUST contain main character token
  if (meta.character && meta.character.length >= 3) {
    const charTokens = meta.character.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const hasCharMatch = charTokens.length === 0 || charTokens.some((t) => cLower.includes(t));
    if (!hasCharMatch) {
      return false;
    }
  }

  // If franchise was extracted, check franchise
  if (meta.franchise) {
    const fTokens = meta.franchise.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((t) => t.length > 3);
    const hasFranchise = fTokens.length === 0 || fTokens.some((t) => cLower.includes(t));
    if (!hasFranchise) {
      return false;
    }
  }

  return true;
}

function getSearchQueries(rawTitle: string) {
  const meta = extractMetadata(rawTitle);
  const queries: string[] = [];

  // Query 1: Line + Character
  if (meta.line && meta.character) {
    queries.push(`${meta.line} ${meta.character}`);
  }

  // Query 2: Franchise + Character
  if (meta.franchise && meta.character) {
    queries.push(`${meta.franchise} ${meta.character}`);
  }

  // Query 3: Character only
  if (meta.character && meta.character.length >= 3) {
    queries.push(meta.character);
  }

  // Query 4: Full clean title without noise
  queries.push(meta.clean);

  return { meta, queries: Array.from(new Set(queries.filter((q) => q.length > 2))) };
}

function formatPriceString(rawPrice: any): string {
  if (!rawPrice) return "";
  const str = String(rawPrice).trim();
  if (!str) return "";

  // If already formatted like $29.990 or $29,990
  if (/^\$\s*\d+/.test(str)) {
    return str.replace(/\s+/g, "");
  }

  // If integer number like 29990
  const num = parseInt(str.replace(/[^\d]/g, ""), 10);
  if (!isNaN(num) && num > 0) {
    return `$${num.toLocaleString("es-CL")}`;
  }

  return str;
}

function buildStandardDescriptionHtml(p: {
  title: string;
  franchise: string;
  line?: string;
  character?: string;
  jan?: string;
  itemNo?: string;
  price?: string;
  description?: string;
  lang?: "es" | "en";
}): string {
  const isEs = p.lang !== "en";
  const cleanDesc = stripNavigationBoilerplate(
    (p.description || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  if (isEs) {
    return `
<div class="evo-product-sheet evo-banpresto-sheet">
  ${cleanDesc ? `<p class="sheet-desc">${cleanDesc}</p>` : `<p class="sheet-desc">Estatua y figura coleccionable oficial de la marca Banpresto / Bandai Spirits.</p>`}
  <ul class="sheet-specs" style="list-style-type: none; padding-left: 0; margin-top: 1rem; line-height: 1.6;">
    ${p.franchise ? `<li><strong>Licencia / Franquicia:</strong> ${p.franchise}</li>` : ""}
    ${p.line ? `<li><strong>Línea de Producto:</strong> ${p.line}</li>` : ""}
    ${p.character ? `<li><strong>Personaje:</strong> ${p.character}</li>` : ""}
    ${p.itemNo ? `<li><strong>Número de Ítem:</strong> ${p.itemNo}</li>` : ""}
    ${p.jan ? `<li><strong>Código JAN / EAN:</strong> ${p.jan}</li>` : ""}
    ${p.price ? `<li><strong>Precio de Venta (PVP):</strong> ${p.price}</li>` : ""}
    <li><strong>Material:</strong> PVC y ABS de alta calidad</li>
    <li><strong>Fabricante:</strong> Banpresto / Bandai Spirits</li>
    <li><strong>Condición:</strong> Nuevo en caja original sellada</li>
  </ul>
</div>`.trim();
  }

  return `
<div class="evo-product-sheet evo-banpresto-sheet">
  ${cleanDesc ? `<p class="sheet-desc">${cleanDesc}</p>` : `<p class="sheet-desc">Official collectible figure and statue by Banpresto / Bandai Spirits.</p>`}
  <ul class="sheet-specs" style="list-style-type: none; padding-left: 0; margin-top: 1rem; line-height: 1.6;">
    ${p.franchise ? `<li><strong>License / Franchise:</strong> ${p.franchise}</li>` : ""}
    ${p.line ? `<li><strong>Product Line:</strong> ${p.line}</li>` : ""}
    ${p.character ? `<li><strong>Character:</strong> ${p.character}</li>` : ""}
    ${p.itemNo ? `<li><strong>Item Number:</strong> ${p.itemNo}</li>` : ""}
    ${p.jan ? `<li><strong>JAN / EAN Barcode:</strong> ${p.jan}</li>` : ""}
    ${p.price ? `<li><strong>Retail Price (MSRP):</strong> ${p.price}</li>` : ""}
    <li><strong>Material:</strong> High quality PVC & ABS</li>
    <li><strong>Manufacturer:</strong> Banpresto / Bandai Spirits</li>
    <li><strong>Condition:</strong> Brand new in original sealed box</li>
  </ul>
</div>`.trim();
}

// 1. TIER 1: DistritoMax Shopify Scraper
async function queryDistritoMax(rawTitle: string): Promise<Partial<BanprestoProductResult> | null> {
  const { meta, queries } = getSearchQueries(rawTitle);
  for (const q of queries) {
    try {
      const url = `https://distritomax.com/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product`;
      const res = await fetchUrl(url);
      if (res.status !== 200 || !res.data) continue;

      const json = JSON.parse(res.data);
      const prods = json?.resources?.results?.products || [];

      for (const p of prods) {
        if (verifyMatch(p.title, meta, rawTitle)) {
          let gallery: string[] = [];
          if (p.handle) {
            const pDetailRes = await fetchUrl(`https://distritomax.com/products/${p.handle}.json`);
            if (pDetailRes.status === 200 && pDetailRes.data) {
              const pJson = JSON.parse(pDetailRes.data);
              if (pJson?.product?.images && Array.isArray(pJson.product.images)) {
                gallery = pJson.product.images.map((img: any) => img.src);
              }
            }
          }

          if (gallery.length === 0 && p.image) {
            gallery = [p.image];
          }

          let franchise = meta.franchise || "Banpresto";
          const licTag = p.tags?.find((t: string) => t.startsWith("Licencia_"));
          if (licTag) franchise = licTag.replace("Licencia_", "");

          const scrapedPrice = p.price ? `$${parseFloat(p.price).toFixed(2)}` : undefined;
          const link = p.url ? `https://distritomax.com${p.url.split("?")[0]}` : undefined;

          return {
            source: "distritomax",
            title: p.title,
            franchise,
            line: meta.line || "Banpresto",
            character: meta.character,
            price: scrapedPrice,
            image: gallery[0] || p.image || "",
            gallery,
            link,
            description_es: stripNavigationBoilerplate(p.body || ""),
            status: "found",
          };
        }
      }
    } catch (e) {
      console.warn("DistritoMax search error for query", q, e);
    }
  }
  return null;
}

// 2. TIER 2: Little Buddy Toys WooCommerce Scraper
async function queryLittleBuddy(rawTitle: string): Promise<Partial<BanprestoProductResult> | null> {
  const { meta, queries } = getSearchQueries(rawTitle);
  for (const q of queries) {
    try {
      const url = `https://littlebuddytoys.com/?s=${encodeURIComponent(q)}&post_type=product`;
      const res = await fetchUrl(url);
      if (res.status !== 200 || !res.data) continue;

      const matches = [
        ...res.data.matchAll(
          /<li[^>]*class="[^"]*product[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*class="woocommerce-loop-product__title">([^<]+)<\/h2>/gi
        ),
      ];

      for (const m of matches) {
        const prodLink = m[1];
        const prodTitle = m[2].trim().replace(/&#038;/g, "&").replace(/&#8211;/g, "-");

        if (verifyMatch(prodTitle, meta, rawTitle)) {
          const pPage = await fetchUrl(prodLink);
          let gallery: string[] = [];
          let desc_en = "";

          if (pPage.data) {
            const imgMatches = [
              ...pPage.data.matchAll(
                /<div[^>]*class="woocommerce-product-gallery__image[^"]*"[\s\S]*?<a[^>]+href="([^"]+\.(?:jpg|jpeg|png|webp))"/gi
              ),
            ];
            gallery = imgMatches.map((im) => im[1]);
            if (gallery.length === 0) {
              const mainImg = pPage.data.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^"]+)"/i);
              if (mainImg) gallery = [mainImg[1]];
            }

            const descMatch =
              pPage.data.match(/<div[^>]*class="[^"]*woocommerce-product-details__short-description[^"]*"[\s\S]*?<\/div>/i) ||
              pPage.data.match(/<div[^>]*id="tab-description"[^>]*>([\s\S]*?)<\/div>/i);
            if (descMatch) {
              const rawDesc = descMatch[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              desc_en = stripNavigationBoilerplate(rawDesc);
            }
          }

          const desc_es = await translateToSpanish(desc_en);

          return {
            source: "littlebuddytoys",
            title: prodTitle,
            franchise: meta.franchise || "Banpresto",
            line: meta.line || "Banpresto",
            character: meta.character,
            image: gallery[0] || "",
            gallery,
            link: prodLink,
            description: desc_en,
            description_es: desc_es,
            status: "found",
          };
        }
      }
    } catch (e) {
      console.warn("LittleBuddy search error for query", q, e);
    }
  }
  return null;
}

// 3. TIER 3: UPC Database Fallback
async function queryUpcDatabase(jan: string): Promise<Partial<BanprestoProductResult> | null> {
  if (!jan || jan.length < 8) return null;
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(jan)}`;
    const res = await fetchUrl(url, { Accept: "application/json" });
    if (res.status === 200 && res.data) {
      const json = JSON.parse(res.data);
      if (json.items && json.items.length > 0) {
        const item = json.items[0];
        const title = item.title || "";
        const images: string[] = Array.isArray(item.images) ? item.images : [];
        const desc_en = stripNavigationBoilerplate(item.description || "");
        const desc_es = await translateToSpanish(desc_en);

        const meta = extractMetadata(title);

        return {
          source: "upc_database",
          title,
          franchise: meta.franchise || item.brand || "Banpresto",
          line: meta.line || "Banpresto",
          character: meta.character,
          image: images[0] || "",
          gallery: images,
          description: desc_en,
          description_es: desc_es,
          status: "found",
        };
      }
    }
  } catch (err) {
    console.error("UPC DB query error:", err);
  }
  return null;
}

// Parse single query input (supports "JAN | Title | PVP" or "JAN \t Title \t PVP" or JSON or 2-field strings)
function parseInputItem(rawInput: any): { jan: string; title: string; price?: string; itemNo?: string } {
  if (typeof rawInput === "object" && rawInput !== null) {
    const rawPrice = rawInput.price || rawInput.pvp || rawInput.PVP;
    return {
      jan: String(rawInput.jan || rawInput.sku || rawInput.upc || "").trim(),
      title: String(rawInput.title || rawInput.name || "").trim(),
      price: rawPrice ? formatPriceString(rawPrice) : undefined,
      itemNo: rawInput.itemNo ? String(rawInput.itemNo).trim() : undefined,
    };
  }

  const str = String(rawInput || "").trim();

  // Pipe separated: "JAN | Title | Price" or "JAN | Title"
  if (str.includes("|")) {
    const parts = str.split("|").map((p) => p.trim());
    const firstIsCode = /^\d{5,13}$/.test(parts[0]);
    const jan = firstIsCode ? parts[0] : (parts[1] && /^\d{5,13}$/.test(parts[1]) ? parts[1] : "");
    
    // Check if 3rd part or 2nd part looks like price ($29.990 or 29990)
    let title = "";
    let price: string | undefined = undefined;

    if (parts.length >= 3) {
      title = firstIsCode ? parts[1] : parts[0];
      price = formatPriceString(parts[2]);
    } else {
      title = firstIsCode ? parts.slice(1).join(" ") : parts[0];
    }

    return { jan, title, price };
  }

  // Tab separated (direct paste from Excel)
  if (str.includes("\t")) {
    const parts = str.split("\t").map((p) => p.trim());
    const firstIsCode = /^\d{5,13}$/.test(parts[0]);
    const jan = firstIsCode ? parts[0] : (parts[1] && /^\d{5,13}$/.test(parts[1]) ? parts[1] : "");
    
    let title = "";
    let price: string | undefined = undefined;

    if (parts.length >= 3) {
      title = firstIsCode ? parts[1] : parts[0];
      price = formatPriceString(parts[2]);
    } else {
      title = firstIsCode ? parts.slice(1).join(" ") : parts[0];
    }

    return { jan, title, price };
  }

  // If numeric code only
  if (/^\d{12,13}$/.test(str)) {
    return { jan: str, title: `Banpresto JAN ${str}` };
  }

  return { jan: "", title: str };
}

async function lookupSingleBanpresto(rawInput: any, forceRefresh = false): Promise<BanprestoProductResult> {
  const { jan, title, price: inputPrice, itemNo } = parseInputItem(rawInput);
  const cacheKey = `${jan || ""}:${title || ""}`;

  if (!forceRefresh && cacheKey !== ":") {
    const cached = (jan && SERVER_CACHE.get(jan)) || SERVER_CACHE.get(cacheKey) || (title && SERVER_CACHE.get(title));
    if (cached && cached.status === "found") {
      const finalPrice = inputPrice || cached.price || "";
      return {
        ...cached,
        price: finalPrice,
        query: typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput),
      };
    }
  }

  let result: Partial<BanprestoProductResult> | null = null;

  // 1. TIER 1: DistritoMax (Primary Shopify Source for Banpresto in Spanish)
  if (title) {
    result = await queryDistritoMax(title);
  }

  // 2. TIER 2: Little Buddy Toys (Official Americas Distributor)
  if (!result && title) {
    result = await queryLittleBuddy(title);
  }

  // 3. TIER 3: UPC Database (Fallback by JAN)
  if (!result && jan) {
    result = await queryUpcDatabase(jan);
  }

  const meta = extractMetadata(title || result?.title || "");
  const finalJan = jan || result?.jan || "";
  const finalItemNo = itemNo || (finalJan.length === 13 ? finalJan.substring(7, 12) : undefined);
  const hasRealInputTitle = Boolean(title && !/^Banpresto JAN \d+$/i.test(title));
  const finalTitle = hasRealInputTitle
    ? title
    : (result?.title || title || (finalJan ? `Banpresto Item #${finalJan}` : "Figura Banpresto"));
  const finalFranchise = result?.franchise || meta.franchise || "Banpresto";
  const finalLine = result?.line || meta.line || "Banpresto";
  const finalChar = result?.character || meta.character;
  const finalDescEs = result?.description_es || "";
  const finalDescEn = result?.description || "";

  // PRICE PRIORITY RULE:
  // 1. inputPrice ALWAYS takes precedence over scraped price.
  // 2. If no inputPrice, use scraped price if found.
  // 3. If neither, empty/undefined - NEVER an invented fixed placeholder like $29.990.
  const finalPrice = inputPrice || (result?.price ? formatPriceString(result.price) : "");

  const descriptionHtml = buildStandardDescriptionHtml({
    title: finalTitle,
    franchise: finalFranchise,
    line: finalLine,
    character: finalChar,
    jan: finalJan,
    itemNo: finalItemNo,
    price: finalPrice,
    description: finalDescEs || finalDescEn,
    lang: "es",
  });

  const descriptionHtml_en = buildStandardDescriptionHtml({
    title: finalTitle,
    franchise: finalFranchise,
    line: finalLine,
    character: finalChar,
    jan: finalJan,
    itemNo: finalItemNo,
    price: finalPrice,
    description: finalDescEn || finalDescEs,
    lang: "en",
  });

  if (result && result.status === "found") {
    const fullResult: BanprestoProductResult = {
      query: typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput),
      jan: finalJan,
      itemNo: finalItemNo,
      title: finalTitle,
      originalTitle: title,
      franchise: finalFranchise,
      line: finalLine,
      character: finalChar,
      price: finalPrice,
      image: result.image || "",
      gallery: result.gallery && result.gallery.length > 0 ? result.gallery : result.image ? [result.image] : [],
      link: result.link,
      source: result.source || "distritomax",
      description: finalDescEn,
      description_es: finalDescEs,
      descriptionHtml,
      descriptionHtml_en,
      status: "found",
    };

    if (jan) SERVER_CACHE.set(jan, fullResult);
    if (title) SERVER_CACHE.set(title, fullResult);
    SERVER_CACHE.set(cacheKey, fullResult);
    return fullResult;
  }

  // Not found fallback
  const notFoundResult: BanprestoProductResult = {
    query: typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput),
    jan: finalJan,
    itemNo: finalItemNo,
    title: finalTitle,
    originalTitle: title,
    franchise: finalFranchise,
    line: finalLine,
    character: finalChar,
    price: finalPrice,
    image: "",
    gallery: [],
    source: "not_found",
    status: "not_found",
    diagnosis: "Figura no indexada en catálogo web de distribuidores activos",
    descriptionHtml,
    descriptionHtml_en,
  };

  return notFoundResult;
}

export const banprestoLookupHandler = async (req: Request, _context?: Context): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const reqUrl = new URL(req.url);
    const proxyImgUrl = reqUrl.searchParams.get("img") || reqUrl.searchParams.get("image");

    // IMAGE PROXY HANDLER FOR JSZIP (CORS-FREE BINARY STREAM)
    if (proxyImgUrl) {
      try {
        const imgRes = await fetch(proxyImgUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        });
        if (imgRes.ok) {
          const contentType = imgRes.headers.get("content-type") || "image/jpeg";
          const arrayBuffer = await imgRes.arrayBuffer();
          return new Response(arrayBuffer, {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      } catch (proxyErr) {
        console.warn("Banpresto image proxy error:", proxyErr);
      }
    }

    let itemsToLookup: any[] = [];
    let forceRefresh = false;

    if (req.method === "GET") {
      const q = reqUrl.searchParams.get("query") || reqUrl.searchParams.get("q");
      const jan = reqUrl.searchParams.get("jan");
      const title = reqUrl.searchParams.get("title");
      const price = reqUrl.searchParams.get("price") || reqUrl.searchParams.get("pvp");
      if (jan || title) {
        itemsToLookup = [{ jan, title, price }];
      } else if (q) {
        itemsToLookup = [q];
      }
      if (reqUrl.searchParams.get("force") === "true" || reqUrl.searchParams.get("refresh") === "true") {
        forceRefresh = true;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.action === "proxy_image" && body.url) {
        const imgRes = await fetch(body.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        });
        if (imgRes.ok) {
          const contentType = imgRes.headers.get("content-type") || "image/jpeg";
          const arrayBuffer = await imgRes.arrayBuffer();
          return new Response(arrayBuffer, {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }

      if (body.forceRefresh === true || body.refresh === true) {
        forceRefresh = true;
      }

      if (body.items && Array.isArray(body.items)) {
        itemsToLookup = body.items;
      } else if (body.queries && Array.isArray(body.queries)) {
        itemsToLookup = body.queries;
      } else if (body.query) {
        itemsToLookup = Array.isArray(body.query) ? body.query : [body.query];
      } else if (body.jan || body.title) {
        itemsToLookup = [{ jan: body.jan, title: body.title, price: body.price || body.pvp, itemNo: body.itemNo }];
      }
    }

    if (itemsToLookup.length === 0) {
      return new Response(JSON.stringify({ error: "Missing items or query parameter" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const items = await Promise.all(
      itemsToLookup.slice(0, 10).map((item) => lookupSingleBanpresto(item, forceRefresh))
    );

    return new Response(
      JSON.stringify({
        total: items.length,
        items,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error("Banpresto lookup function error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal server error during Banpresto lookup",
        message: err.message,
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export default banprestoLookupHandler;
