import type { CatalogItem } from '../types.js';
import { escapeAttr, escapeHtml, generateHandle } from './dom.js';

declare const JSZip: any;

export interface ExportShopifyOptions {
  products: (CatalogItem & { needsChoice?: boolean })[];
  lang?: 'es' | 'en';
  filenamePrefix?: string;
  vendor?: string;
  productType?: string;
  category?: string;
  tagFields?: string[];
  getProductSheetHtml?: (item: CatalogItem, lang: 'es' | 'en') => string;
  onComplete?: (exportedCount: number, omittedChoicesCount: number) => void;
}


export interface CopyTableOptions {
  products: (CatalogItem & { needsChoice?: boolean })[];
  columns?: Array<{ label: string; render: (item: CatalogItem) => string; renderTsv?: (item: CatalogItem) => string }>;
  onComplete?: (exportedCount: number, omittedChoicesCount: number) => void;
}

export interface ExportZipOptions {
  products: (CatalogItem & { needsChoice?: boolean })[];
  progressModal: HTMLElement | null;
  progressFill: HTMLElement | null;
  progressText: HTMLElement | null;
  filenamePrefix?: string;
  lookupEndpoint?: string;
  onComplete?: (downloadedCount: number, omittedChoicesCount: number) => void;
}

export interface ExportCsvOptions {
  products: (CatalogItem & { needsChoice?: boolean })[];
  filenamePrefix?: string;
  headers?: string[];
  rowMapper?: (item: CatalogItem) => string[];
  onComplete?: (exportedCount: number, omittedChoicesCount: number) => void;
}

/**
 * Fetch image blob safely with server proxy fallback to prevent CORS issues.
 */
export async function fetchImageBlob(imgUrl: string, lookupEndpoint = '/api/catalog-lookup'): Promise<Blob | null> {
  if (!imgUrl) return null;

  // 1. Try direct fetch
  try {
    const res = await fetch(imgUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 200) return blob;
    }
  } catch (e) {
    // Direct fetch failed (e.g. CORS block from image CDN)
  }

  // 2. Fallback to server proxy
  const proxyUrls = [
    `${lookupEndpoint}?img=${encodeURIComponent(imgUrl)}`,
    `/.netlify/functions/catalog-lookup?img=${encodeURIComponent(imgUrl)}`,
  ];

  for (const purl of proxyUrls) {
    try {
      const res = await fetch(purl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 200) return blob;
      }
    } catch (err) {
      console.warn('Proxy fetch failed:', err);
    }
  }

  return null;
}

/**
 * Download single product photos as ZIP.
 */
export async function downloadSingleProductZip(
  item: CatalogItem,
  filenamePrefix = 'product',
  lookupEndpoint = '/api/catalog-lookup'
): Promise<void> {
  if (typeof JSZip === 'undefined') {
    alert('Librería ZIP cargando... Por favor reintenta en 1 segundo.');
    return;
  }

  const gallery = item.gallery && item.gallery.length > 0 ? item.gallery : item.image ? [item.image] : [];
  if (gallery.length === 0) {
    alert('No hay fotografías disponibles para este producto.');
    return;
  }

  const upc = item.upc || item.sku || item.query || 'item';
  const zip = new JSZip();
  let savedPhotos = 0;

  for (let idx = 0; idx < gallery.length; idx++) {
    const imgUrl = gallery[idx];
    try {
      const blob = await fetchImageBlob(imgUrl, lookupEndpoint);
      if (blob) {
        const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
        zip.file(`${upc}_${String(idx + 1).padStart(2, '0')}.${ext}`, blob);
        savedPhotos++;
      }
    } catch (e) {
      console.warn('Error downloading single photo:', e);
    }
  }

  if (savedPhotos === 0) {
    alert('No fue posible descargar las imágenes de este producto.');
    return;
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}-${upc}-photos.zip`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export official Shopify CSV with bilingual option, excluding unresolved choice cards.
 */
export function exportShopifyCsv(opts: ExportShopifyOptions): void {
  const {
    products,
    lang = 'es',
    filenamePrefix = 'shopify-catalog',
    vendor = '',
    productType = 'Collectible',
    category = 'Toys & Games > Collectibles',
    tagFields,
    getProductSheetHtml,
    onComplete,
  } = opts;

  if (!products || products.length === 0) {
    alert('No hay productos para exportar.');
    return;
  }

  const omittedChoicesCount = products.filter((p) => p.needsChoice).length;
  const foundItems = products.filter((p) => p.status === 'found' && !p.needsChoice);

  if (foundItems.length === 0) {
    alert('No se encontraron productos válidos para exportar a Shopify (las variantes sin resolver fueron omitidas).');
    return;
  }

  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type',
    'Tags', 'Published', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
    'Option3 Name', 'Option3 Value', 'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker',
    'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Fulfillment Service',
    'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable',
    'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
    'SEO Title', 'SEO Description', 'Google Shopping / Google Product Category',
    'Google Shopping / Gender', 'Google Shopping / Age Group', 'Google Shopping / MPN',
    'Google Shopping / Condition', 'Google Shopping / Custom Product', 'Google Shopping / Custom Label 0',
    'Google Shopping / Custom Label 1', 'Google Shopping / Custom Label 2', 'Google Shopping / Custom Label 3',
    'Google Shopping / Custom Label 4', 'Variant Image', 'Variant Weight Unit', 'Variant Tax Code',
    'Cost per item', 'Status',
  ];

  const rows: string[][] = [];

  foundItems.forEach((item) => {
    const handle = generateHandle(item.title, item.upc || item.sku || item.query);
    const title = (lang === 'es' && item.titleEs) ? item.titleEs : item.title || `Item #${item.upc || item.sku || item.query}`;
    const type = item.productType || productType;

    const tagValues: string[] = [vendor];
    if (tagFields && tagFields.length > 0) {
      tagFields.forEach((k) => {
        const val = (item as any)[k];
        if (val && !tagValues.includes(String(val))) tagValues.push(String(val));
      });
    } else {
      ['expansion', 'license', 'productType', 'variant', 'language', 'fandom'].forEach((k) => {
        const val = (item as any)[k];
        if (val && !tagValues.includes(String(val))) tagValues.push(String(val));
      });
    }
    const tagsList = tagValues.filter(Boolean).join(', ');

    const sku = item.sku || item.upc || item.query;
    const barcode = item.upc || (item.query.length === 12 || item.query.length === 13 ? item.query : '');
    const price = (item.price || '0').replace('$', '').trim();
    
    let bodyHtml = '';
    if (getProductSheetHtml) {
      bodyHtml = getProductSheetHtml(item, lang);
    } else {
      const desc = lang === 'es' ? (item.description_es || item.description || '') : (item.description || '');
      bodyHtml = desc.replace(/\n/g, '<br>');
    }

    const customLabel0 = item.expansion || (item as any).license || '';
    const customLabel1 = item.variant || (item as any).boxNumber || '';
    const gallery = item.gallery && item.gallery.length > 0 ? item.gallery : item.image ? [item.image] : [];

    if (gallery.length === 0) {
      rows.push([
        `"${handle}"`, `"${title.replace(/"/g, '""')}"`, `"${bodyHtml.replace(/"/g, '""')}"`,
        `"${vendor}"`, `"${category}"`, `"${type}"`,
        `"${tagsList.replace(/"/g, '""')}"`, 'TRUE', '"Title"', '"Default Title"', '', '', '', '',
        `"${sku}"`, '150', 'shopify', '1', 'deny', 'manual',
        `"${price}"`, '', 'TRUE', 'TRUE', `"${barcode}"`, '', '', '', 'FALSE',
        `"${title.replace(/"/g, '""')}"`, `"${title.replace(/"/g, '""')}"`, '', '', '', `"${sku}"`,
        'new', 'FALSE', `"${customLabel0}"`, `"${customLabel1}"`, '', '', '', '', 'g', '', '', 'active',
      ]);
    } else {
      gallery.forEach((imgUrl, imgIdx) => {
        if (imgIdx === 0) {
          rows.push([
            `"${handle}"`, `"${title.replace(/"/g, '""')}"`, `"${bodyHtml.replace(/"/g, '""')}"`,
            `"${vendor}"`, `"${category}"`, `"${type}"`,
            `"${tagsList.replace(/"/g, '""')}"`, 'TRUE', '"Title"', '"Default Title"', '', '', '', '',
            `"${sku}"`, '150', 'shopify', '1', 'deny', 'manual',
            `"${price}"`, '', 'TRUE', 'TRUE', `"${barcode}"`, `"${imgUrl}"`, '1', `"${title.replace(/"/g, '""')}"`, 'FALSE',
            `"${title.replace(/"/g, '""')}"`, `"${title.replace(/"/g, '""')}"`, '', '', '', `"${sku}"`,
            'new', 'FALSE', `"${customLabel0}"`, `"${customLabel1}"`, '', '', '', '', 'g', '', '', 'active',
          ]);
        } else {
          const emptyCols = new Array(headers.length).fill('""');
          emptyCols[0] = `"${handle}"`;
          emptyCols[25] = `"${imgUrl}"`;
          emptyCols[26] = `"${imgIdx + 1}"`;
          emptyCols[27] = `"${title.replace(/"/g, '""')} - Vista ${imgIdx + 1}"`;
          rows.push(emptyCols);
        }
      });
    }
  });


  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}-${lang}-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (onComplete) {
    onComplete(foundItems.length, omittedChoicesCount);
  }
}

/**
 * Copy rich HTML / TSV table to clipboard, excluding unresolved choice cards.
 */
export async function copyTableHtml(opts: CopyTableOptions): Promise<void> {
  const { products, columns, onComplete } = opts;

  if (!products || products.length === 0) {
    alert('No hay productos para copiar.');
    return;
  }

  const omittedChoicesCount = products.filter((p) => p.needsChoice).length;
  const foundItems = products.filter((p) => p.status === 'found' && !p.needsChoice);

  if (foundItems.length === 0) {
    alert('No hay productos encontrados para copiar (las variantes sin resolver fueron omitidas).');
    return;
  }

  const defaultCols = columns || [
    {
      label: 'Foto',
      render: (item: CatalogItem) =>
        item.image ? `<img src="${item.image}" width="40" height="40" style="object-fit:contain; vertical-align:middle;" />` : '',
      renderTsv: (item: CatalogItem) => item.image || '',
    },
    {
      label: 'UPC',
      render: (item: CatalogItem) => `<span style="font-family:monospace;">${escapeHtml(item.upc || item.query)}</span>`,
      renderTsv: (item: CatalogItem) => item.upc || item.query || '',
    },
    {
      label: 'Título',
      render: (item: CatalogItem) => `<strong>${escapeHtml(item.title || '')}</strong>`,
      renderTsv: (item: CatalogItem) => item.title || '',
    },
    {
      label: 'Expansión',
      render: (item: CatalogItem) => escapeHtml(item.expansion || '—'),
      renderTsv: (item: CatalogItem) => item.expansion || '',
    },
    {
      label: 'Tipo',
      render: (item: CatalogItem) => escapeHtml(item.productType || '—'),
      renderTsv: (item: CatalogItem) => item.productType || '',
    },
    {
      label: 'Fuente',
      render: (item: CatalogItem) => escapeHtml(item.source || '—'),
      renderTsv: (item: CatalogItem) => item.source || '',
    },
  ];

  let html = `<table border="1" style="border-collapse:collapse; font-family:sans-serif; font-size:13px; width:100%;">
    <thead>
      <tr style="background:#f1f5f9; text-align:left;">
        ${defaultCols.map((c) => `<th style="padding:8px;">${escapeHtml(c.label)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>`;

  let tsv = defaultCols.map((c) => c.label).join('\t') + '\n';

  foundItems.forEach((item) => {
    html += '<tr>';
    const rowTsvParts: string[] = [];

    defaultCols.forEach((col) => {
      html += `<td style="padding:6px;">${col.render(item)}</td>`;
      rowTsvParts.push((col.renderTsv ? col.renderTsv(item) : col.render(item)).replace(/<[^>]+>/g, '').trim());
    });

    html += '</tr>';
    tsv += rowTsvParts.join('\t') + '\n';
  });

  html += '</tbody></table>';

  try {
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([tsv], { type: 'text/plain' });
    const clipboardItem = new ClipboardItem({
      'text/html': blobHtml,
      'text/plain': blobText,
    });
    await navigator.clipboard.write([clipboardItem]);
  } catch (e) {
    await navigator.clipboard.writeText(tsv);
  }

  if (onComplete) {
    onComplete(foundItems.length, omittedChoicesCount);
  }
}

/**
 * Export full batch ZIP archive of images, excluding unresolved choices.
 */
export async function exportImagesZip(opts: ExportZipOptions): Promise<void> {
  const { products, progressModal, progressFill, progressText, filenamePrefix = 'photos', lookupEndpoint, onComplete } = opts;

  if (typeof JSZip === 'undefined') {
    alert('Librería ZIP cargando... Por favor intenta en 2 segundos.');
    return;
  }

  const omittedChoicesCount = products.filter((p) => p.needsChoice).length;
  const validProducts = products.filter((p) => p.status === 'found' && !p.needsChoice);
  const itemsWithImages = validProducts.filter((p) => (p.gallery && p.gallery.length > 0) || p.image);

  if (itemsWithImages.length === 0) {
    alert('No hay imágenes disponibles para empaquetar.');
    return;
  }

  if (progressModal) progressModal.style.display = 'flex';
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Iniciando descarga de fotografías del lote...';

  const zip = new JSZip();
  let totalImages = 0;
  itemsWithImages.forEach((p) => {
    const g = p.gallery && p.gallery.length > 0 ? p.gallery : p.image ? [p.image] : [];
    totalImages += g.length;
  });

  let downloadedCount = 0;

  for (const item of itemsWithImages) {
    const upc = item.upc || item.sku || item.query || 'item';
    const gallery = item.gallery && item.gallery.length > 0 ? item.gallery : item.image ? [item.image] : [];

    for (let idx = 0; idx < gallery.length; idx++) {
      const imgUrl = gallery[idx];
      try {
        const blob = await fetchImageBlob(imgUrl, lookupEndpoint);
        if (blob) {
          const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
          const filename = `${upc}_${String(idx + 1).padStart(2, '0')}.${ext}`;
          zip.file(filename, blob);
          downloadedCount++;
        }
      } catch (e) {
        console.warn(`Error downloading image ${imgUrl}:`, e);
      }

      const pct = Math.round((downloadedCount / totalImages) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `Descargando imagen ${downloadedCount} de ${totalImages} (${pct}%)...`;
    }
  }

  if (downloadedCount === 0) {
    if (progressModal) progressModal.style.display = 'none';
    alert('No fue posible descargar imágenes del lote.');
    return;
  }

  if (progressText) progressText.textContent = 'Comprimiendo archivo ZIP...';
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.zip`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (progressModal) progressModal.style.display = 'none';

  if (onComplete) {
    onComplete(downloadedCount, omittedChoicesCount);
  }
}

/**
 * Export general CSV with all query attributes, excluding unresolved choices.
 */
export function exportCsv(opts: ExportCsvOptions): void {
  const { products, filenamePrefix = 'catalog-general', headers: customHeaders, rowMapper, onComplete } = opts;

  if (!products || products.length === 0) {
    alert('No hay productos para exportar.');
    return;
  }

  const omittedChoicesCount = products.filter((p) => p.needsChoice).length;
  const validProducts = products.filter((p) => !p.needsChoice);

  if (validProducts.length === 0) {
    alert('No hay productos válidos para exportar.');
    return;
  }

  const headers = customHeaders || [
    'Query', 'UPC', 'ProductId', 'Title', 'Title_ES', 'Expansion', 'ProductType', 'Variant',
    'Language', 'Price', 'Source', 'Status', 'Diagnosis', 'Description_ES', 'Description_EN', 'Gallery_URLs', 'ImageURL', 'Link'
  ];

  const rows = validProducts.map((p) => {
    if (rowMapper) return rowMapper(p);
    return [
      `"${(p.query || '').replace(/"/g, '""')}"`,
      `"${(p.upc || '').replace(/"/g, '""')}"`,
      `"${p.productId || ''}"`,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      `"${(p.titleEs || '').replace(/"/g, '""')}"`,
      `"${(p.expansion || '').replace(/"/g, '""')}"`,
      `"${(p.productType || '').replace(/"/g, '""')}"`,
      `"${(p.variant || '').replace(/"/g, '""')}"`,
      `"${(p.language || '').replace(/"/g, '""')}"`,
      `"${(p.price || '').replace(/"/g, '""')}"`,
      `"${(p.source || '').replace(/"/g, '""')}"`,
      `"${(p.status || '').replace(/"/g, '""')}"`,
      `"${(p.diagnosis || '').replace(/"/g, '""')}"`,
      `"${(p.description_es || '').replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      `"${((p.gallery && p.gallery.length > 0) ? p.gallery.join(' | ') : (p.image || '')).replace(/"/g, '""')}"`,
      `"${(p.image || '').replace(/"/g, '""')}"`,
      `"${(p.link || '').replace(/"/g, '""')}"`,
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (onComplete) {
    onComplete(validProducts.length, omittedChoicesCount);
  }
}
