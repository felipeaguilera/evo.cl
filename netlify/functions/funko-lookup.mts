import type { Context } from "@netlify/functions";
import https from "node:https";

export interface ProductResult {
  query: string;
  upc: string;
  sku: string;
  title: string;
  license: string;
  fandom?: string;
  brand?: string;
  series?: string;
  boxNumber?: string;
  price?: string;
  image: string;
  gallery: string[];
  link?: string;
  source: "funko_storefront" | "upc_database" | "local_index" | "not_found";
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
const SERVER_CACHE = new Map<string, ProductResult>();

function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: string }> {
  return new Promise((resolve) => {
    const defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*; q=0.9",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      ...headers,
    };

    const req = https.get(url, { headers: defaultHeaders, timeout: 9000 }, (res) => {
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

function extractBoxNumber(text: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/#\s*(\d+)/i) || text.match(/\bNo\.\s*(\d+)/i) || text.match(/\b(\d{3,4})\b/);
  return match ? `#${match[1]}` : undefined;
}

function buildStandardDescriptionHtml(p: {
  title: string;
  license: string;
  fandom?: string;
  boxNumber?: string;
  sku: string;
  upc?: string;
  description?: string;
  lang?: "es" | "en";
}): string {
  const isEs = p.lang !== "en";
  const cleanDesc = (p.description || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (isEs) {
    return `
<div class="evo-product-sheet">
  ${cleanDesc ? `<p class="sheet-desc">${cleanDesc}</p>` : `<p class="sheet-desc">Figura coleccionable oficial de la marca Funko.</p>`}
  <ul class="sheet-specs" style="list-style-type: none; padding-left: 0; margin-top: 1rem; line-height: 1.6;">
    ${p.license ? `<li><strong>Colección / Licencia:</strong> ${p.license}</li>` : ""}
    ${p.fandom ? `<li><strong>Fandom / Universo:</strong> ${p.fandom}</li>` : ""}
    ${p.boxNumber ? `<li><strong>Número de Caja:</strong> ${p.boxNumber}</li>` : ""}
    ${p.sku ? `<li><strong>Número de Ítem / SKU:</strong> ${p.sku}</li>` : ""}
    ${p.upc ? `<li><strong>Código de Barras (UPC):</strong> ${p.upc}</li>` : ""}
    <li><strong>Material:</strong> Vinilo de alta calidad</li>
    <li><strong>Fabricante:</strong> Funko LLC</li>
    <li><strong>Condición:</strong> Nuevo en caja original sellada</li>
  </ul>
</div>`.trim();
  }

  return `
<div class="evo-product-sheet">
  ${cleanDesc ? `<p class="sheet-desc">${cleanDesc}</p>` : `<p class="sheet-desc">Official collectible figure by Funko.</p>`}
  <ul class="sheet-specs" style="list-style-type: none; padding-left: 0; margin-top: 1rem; line-height: 1.6;">
    ${p.license ? `<li><strong>Collection / License:</strong> ${p.license}</li>` : ""}
    ${p.fandom ? `<li><strong>Fandom / Universe:</strong> ${p.fandom}</li>` : ""}
    ${p.boxNumber ? `<li><strong>Box Number:</strong> ${p.boxNumber}</li>` : ""}
    ${p.sku ? `<li><strong>Item Number / SKU:</strong> ${p.sku}</li>` : ""}
    ${p.upc ? `<li><strong>Barcode (UPC):</strong> ${p.upc}</li>` : ""}
    <li><strong>Material:</strong> High quality collectible vinyl</li>
    <li><strong>Manufacturer:</strong> Funko LLC</li>
    <li><strong>Condition:</strong> Brand new in original window box</li>
  </ul>
</div>`.trim();
}

async function queryFunkoCommerceCloud(sku: string, upc: string): Promise<ProductResult | null> {
  if (!sku || sku.length < 4) return null;
  try {
    const url = `https://funko.com/on/demandware.store/Sites-FunkoUS-Site/default/Product-Variation?pid=${encodeURIComponent(sku)}&quantity=1`;
    const res = await fetchUrl(url, {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    });

    if (res.status === 200 && res.data) {
      const json = JSON.parse(res.data);
      const prod = json.product;
      if (prod && prod.productName) {
        const title = prod.productName.trim();
        const license = prod.license || prod.brand || "Funko";
        const fandom = prod.fandom || "";
        const series = prod.series || "";
        const boxNumber = prod.boxNumber ? `#${prod.boxNumber}` : extractBoxNumber(title);
        const description_en = prod.longDescription || prod.productDescription || "";

        // Automatic Spanish Translation
        const description_es = await translateToSpanish(description_en);

        // Extract and upscale all HD images
        const rawImages: string[] = [];
        if (prod.images && Array.isArray(prod.images.large)) {
          prod.images.large.forEach((imgObj: any) => {
            if (imgObj && imgObj.url) {
              const clean = imgObj.url.split("?")[0];
              rawImages.push(`${clean}?sw=1000&sh=1000&sm=fit`);
            }
          });
        }

        const gallery = Array.from(new Set(rawImages));
        const mainImage = gallery[0] || (prod.imageURL ? `${prod.imageURL.split("?")[0]}?sw=1000&sh=1000&sm=fit` : "");

        const price = prod.price?.sales?.formatted || "$14.99";
        let link = prod.selectedProductUrl || prod.pdpLink || "";
        if (link && !link.startsWith("http")) {
          link = `https://funko.com${link.startsWith("/") ? "" : "/"}${link}`;
        }

        const descriptionHtml = buildStandardDescriptionHtml({
          title,
          license,
          fandom,
          boxNumber,
          sku,
          upc,
          description: description_es || description_en,
          lang: "es",
        });

        const descriptionHtml_en = buildStandardDescriptionHtml({
          title,
          license,
          fandom,
          boxNumber,
          sku,
          upc,
          description: description_en,
          lang: "en",
        });

        return {
          query: sku,
          upc,
          sku,
          title,
          license,
          fandom,
          brand: "Funko",
          series,
          boxNumber,
          price,
          image: mainImage,
          gallery,
          link,
          source: "funko_storefront",
          description: description_en,
          description_es,
          descriptionHtml,
          descriptionHtml_en,
          status: "found",
        };
      }
    }
  } catch (err) {
    console.warn("[Funko CC API] Error querying SKU", sku, err);
  }
  return null;
}

function parseFunkoStorefrontSearch(html: string, query: string, upc: string): ProductResult[] {
  if (!html || typeof html !== "string") return [];
  const results: ProductResult[] = [];
  const blocks = html.split('<div class="product"');

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const pid = block.match(/data-pid="([^"]+)"/)?.[1] || "";
    const titleMatch =
      block.match(/class="product-name[^"]*"[^>]*>([^<]+)<\/a>/)?.[1] ||
      block.match(/<a[^>]+class="product-name[^"]*"[^>]*>([^<]+)<\/a>/)?.[1];
    const license = block.match(/class="product-license[^"]*">([\s\S]*?)<\/div>/)?.[1]?.trim() || "";
    const fandom = block.match(/data-fandom="([^"]+)"/)?.[1] || "";
    const brand = block.match(/data-brand="([^"]+)"/)?.[1] || "Funko";
    let link = block.match(/href="([^"]+\.html)"/)?.[1] || "";
    if (link && !link.startsWith("http")) {
      link = `https://funko.com${link.startsWith("/") ? "" : "/"}${link}`;
    }

    const rawImages = [
      ...block.matchAll(/src="([^"]+dw\/image[^"]+)"/g),
      ...block.matchAll(/data-src="([^"]+dw\/image[^"]+)"/g),
      ...block.matchAll(/<img[^>]+class="tile-image[^"]*"[^>]+src="([^"]+)"/g),
    ].map((m) => m[1].replace(/&amp;/g, "&"));

    const uniqueImages = Array.from(new Set(rawImages)).map((img) => {
      const clean = img.split("?")[0];
      return `${clean}?sw=1000&sh=1000&sm=fit`;
    });

    const mainImage = uniqueImages[0] || "";
    const price =
      block.match(/class="value"[^>]*content="([^"]+)"/)?.[1] ||
      block.match(/class="sales"[^>]*>([\s\S]*?)<\/span>/)?.[1]?.trim() ||
      "$14.99";

    if (pid && titleMatch) {
      const title = titleMatch.trim();
      const boxNumber = extractBoxNumber(title);
      const descriptionHtml = buildStandardDescriptionHtml({
        title,
        license,
        fandom,
        boxNumber,
        sku: pid,
        upc,
        lang: "es",
      });

      const descriptionHtml_en = buildStandardDescriptionHtml({
        title,
        license,
        fandom,
        boxNumber,
        sku: pid,
        upc,
        lang: "en",
      });

      results.push({
        query: pid,
        upc,
        sku: pid,
        title,
        license,
        fandom,
        brand,
        boxNumber,
        price: price.startsWith("$") ? price : `$${price}`,
        image: mainImage,
        gallery: uniqueImages,
        link,
        source: "funko_storefront",
        descriptionHtml,
        descriptionHtml_en,
        status: "found",
      });
    }
  }

  return results;
}

async function queryUpcDatabase(upc: string, sku: string): Promise<ProductResult | null> {
  if (!upc || upc.length < 8) return null;
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`;
    const res = await fetchUrl(url, { "Accept": "application/json" });
    if (res.status === 200 && res.data) {
      const json = JSON.parse(res.data);
      if (json.items && json.items.length > 0) {
        const item = json.items[0];
        const title = item.title || "";
        const boxNumber = extractBoxNumber(title);
        const images: string[] = Array.isArray(item.images) ? item.images : [];
        const mainImage = images[0] || "";

        let license = item.brand || "Funko";
        const titleParts = title.split(":");
        if (titleParts.length > 1) {
          license = titleParts[0].replace(/funko|pop!|vinyl|figure/gi, "").trim() || license;
        }

        const description_en = item.description || "";
        const description_es = await translateToSpanish(description_en);

        const descriptionHtml = buildStandardDescriptionHtml({
          title,
          license,
          boxNumber,
          sku: sku || item.model || "",
          upc,
          description: description_es || description_en,
          lang: "es",
        });

        const descriptionHtml_en = buildStandardDescriptionHtml({
          title,
          license,
          boxNumber,
          sku: sku || item.model || "",
          upc,
          description: description_en,
          lang: "en",
        });

        return {
          query: upc,
          upc,
          sku: sku || item.model || "",
          title,
          license,
          brand: item.brand || "Funko",
          boxNumber,
          price: "$14.99",
          image: mainImage,
          gallery: images,
          source: "upc_database",
          description: description_en,
          description_es,
          descriptionHtml,
          descriptionHtml_en,
          status: "found",
        };
      }
    }
  } catch (err) {
    console.error("UPC DB query error:", err);
  }
  return null;
}

function getErrorDiagnosis(query: string, sku: string): string {
  const numSku = parseInt(sku, 10);
  if (numSku >= 72569 && numSku <= 72575) {
    return "Llavero Pocket Pop! (Sub-línea con catálogo separado)";
  }
  if (query.startsWith("889698")) {
    return "Vaulted / Retirado del catálogo activo de Funko.com";
  }
  if (query.startsWith("849803")) {
    return "Loungefly / Sub-marca de Funko";
  }
  return "Código UPC no indexado en registro comercial";
}

async function lookupSingleCode(rawQuery: string, forceRefresh = false): Promise<ProductResult> {
  const query = String(rawQuery || "").trim().replace(/[^\w-]/g, "");
  if (!query) {
    return {
      query: rawQuery,
      upc: "",
      sku: "",
      title: "",
      license: "",
      image: "",
      gallery: [],
      source: "not_found",
      status: "not_found",
      diagnosis: "Código vacío",
      error: "Empty query",
    };
  }

  let upc = "";
  let sku = query;

  if (/^\d{12}$/.test(query)) {
    upc = query;
    if (query.startsWith("889698")) {
      sku = query.substring(6, 11);
    }
  } else if (/^\d{4,6}$/.test(query)) {
    sku = query;
  }

  // CHECK SERVER IN-MEMORY CACHE (IF NOT FORCED REFRESH)
  if (!forceRefresh) {
    const cached = (sku && SERVER_CACHE.get(sku)) || (upc && SERVER_CACHE.get(upc)) || SERVER_CACHE.get(query);
    if (cached && cached.status === "found") {
      return { ...cached, query: rawQuery };
    }
  }

  // TIER 1: Funko Commerce Cloud API (Fetches Complete Multi-Angle Gallery & Long Descriptions)
  if (sku) {
    const ccResult = await queryFunkoCommerceCloud(sku, upc);
    if (ccResult) {
      if (sku) SERVER_CACHE.set(sku, ccResult);
      if (upc) SERVER_CACHE.set(upc, ccResult);
      SERVER_CACHE.set(query, ccResult);
      return ccResult;
    }
  }

  // TIER 2: Funko Storefront Search
  try {
    const funkoSearchUrl = `https://funko.com/search/?q=${encodeURIComponent(sku)}&vault=true`;
    const funkoRes = await fetchUrl(funkoSearchUrl);
    if (funkoRes.status === 200 && funkoRes.data) {
      const parsed = parseFunkoStorefrontSearch(funkoRes.data, query, upc);
      if (parsed.length > 0) {
        const item = parsed[0];
        if (sku) SERVER_CACHE.set(sku, item);
        if (upc) SERVER_CACHE.set(upc, item);
        SERVER_CACHE.set(query, item);
        return item;
      }
    }
  } catch (e) {
    console.warn("Funko search failed, trying UPC fallback:", e);
  }

  // TIER 3: UPC Database Fallback (For Vaulted & Distributor Catalog Items)
  if (upc || /^\d{12}$/.test(query)) {
    const upcToSearch = upc || query;
    const upcResult = await queryUpcDatabase(upcToSearch, sku);
    if (upcResult) {
      if (sku) SERVER_CACHE.set(sku, upcResult);
      if (upc) SERVER_CACHE.set(upc, upcResult);
      SERVER_CACHE.set(query, upcResult);
      return upcResult;
    }
  }

  // TIER 4: Not Found with Diagnostic Classification
  const notFoundResult: ProductResult = {
    query,
    upc,
    sku,
    title: `Item #${sku || query}`,
    license: "Funko",
    brand: "Funko",
    image: "",
    gallery: [],
    source: "not_found",
    status: "not_found",
    diagnosis: getErrorDiagnosis(query, sku),
  };

  return notFoundResult;
}

export const funkoLookupHandler = async (req: Request, _context?: Context): Promise<Response> => {
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
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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
        console.warn("Image proxy error:", proxyErr);
      }
    }

    let queries: string[] = [];
    let forceRefresh = false;

    if (req.method === "GET") {
      const q = reqUrl.searchParams.get("query") || reqUrl.searchParams.get("q");
      if (q) queries = [q];
      if (reqUrl.searchParams.get("force") === "true" || reqUrl.searchParams.get("refresh") === "true") {
        forceRefresh = true;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.action === "proxy_image" && body.url) {
        const imgRes = await fetch(body.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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
      if (body.query) {
        queries = Array.isArray(body.query) ? body.query : [body.query];
      } else if (body.queries && Array.isArray(body.queries)) {
        queries = body.queries;
      }
    }

    if (queries.length === 0) {
      return new Response(JSON.stringify({ error: "Missing query parameter" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const items = await Promise.all(queries.slice(0, 10).map((q) => lookupSingleCode(q, forceRefresh)));

    return new Response(
      JSON.stringify({
        total: items.length,
        items,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error("Funko lookup function error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal server error during Funko lookup",
        message: err.message,
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export default funkoLookupHandler;
