import type { CatalogAdapter, CatalogItem, FieldSpec } from '../types.js';
import type { BatchItemState } from './batch.js';
import { escapeAttr, escapeHtml } from './dom.js';
import { downloadSingleProductZip } from './export.js';
import { saveToLocalCatalog } from './storage.js';

export interface AdapterSpec {
  id: string;
  label: string;
  fields: FieldSpec[];
}

export interface RenderContext {
  adapter: AdapterSpec;
  storageKey: string;
  expandedProductIds: Set<string>;
  sourceLabels?: Record<string, { label: string; icon: string; className: string }>;
  groupFieldKey?: string; // e.g. 'expansion' or 'license'
  onRefreshItem?: (item: BatchItemState, cardElem: HTMLElement) => void;
  onChoiceSelected?: (item: BatchItemState, candidate: CatalogItem) => void;
  onToast?: (msg: string) => void;
}


/**
 * Filter products list by search term and status filter.
 */
export function getFilteredProducts(
  products: BatchItemState[],
  searchQuery: string,
  statusFilter: string
): BatchItemState[] {
  const q = searchQuery.trim().toLowerCase();
  const st = statusFilter;

  return products.filter((item) => {
    if (st === 'needs_choice') {
      if (!item.needsChoice) return false;
    } else if (st === 'found') {
      if (item.status !== 'found' || item.needsChoice) return false;
    } else if (st === 'not_found') {
      if (item.status === 'found') return false;
    }

    if (!q) return true;

    // Generic haystack from all string values of item
    const values = Object.values(item)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join(' ')
      .toLowerCase();

    return values.includes(q);
  });
}

/**
 * Build plain text representation of product sheet based on adapter fields.
 */
export function getGenericProductSheetText(item: CatalogItem, adapter: AdapterSpec, lang = 'es'): string {
  const isEs = lang === 'es';
  const title = (isEs && item.titleEs) ? item.titleEs : (item.title || 'Producto');
  const desc = isEs ? (item.description_es || item.description || '') : (item.description || '');
  const cleanDesc = desc
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lines: string[] = [title, '', isEs ? 'DESCRIPCIÓN:' : 'DESCRIPTION:', cleanDesc, '', isEs ? 'ESPECIFICACIONES:' : 'SPECIFICATIONS:'];

  adapter.fields.forEach((field) => {
    if (field.type === 'image' || field.key === 'title' || field.key === 'titleEs') return;
    const val = (item as any)[field.key];
    if (val !== undefined && val !== null && val !== '') {
      lines.push(`- ${field.label}: ${val}`);
    }
  });

  return lines.join('\n').trim();
}

/**
 * Build HTML representation of product sheet based on adapter fields.
 */
export function getGenericProductSheetHtml(item: CatalogItem, adapter: AdapterSpec, lang = 'es'): string {
  const isEs = lang === 'es';
  const desc = isEs ? (item.description_es || item.description || '') : (item.description || '');
  const cleanDesc = desc
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const specsList: string[] = [];
  adapter.fields.forEach((field) => {
    if (field.type === 'image' || field.key === 'title' || field.key === 'titleEs') return;
    const val = (item as any)[field.key];
    if (val !== undefined && val !== null && val !== '') {
      specsList.push(`<li><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(String(val))}</li>`);
    }
  });

  return `
<div class="evo-product-sheet">
  <p class="sheet-desc">${escapeHtml(cleanDesc)}</p>
  <ul class="sheet-specs" style="list-style-type: none; padding-left: 0; margin-top: 1rem; line-height: 1.6;">
    ${specsList.join('\n    ')}
  </ul>
</div>`.trim();
}

/**
 * Copy product sheet to clipboard in HTML or plain text.
 */
export async function copyGenericProductSheet(
  item: CatalogItem,
  adapter: AdapterSpec,
  format = 'html',
  lang = 'es',
  onToast?: (msg: string) => void
): Promise<void> {

  const htmlContent = getGenericProductSheetHtml(item, adapter, lang);
  const textContent = getGenericProductSheetText(item, adapter, lang);

  if (format === 'html') {
    try {
      const blobHtml = new Blob([htmlContent], { type: 'text/html' });
      const blobText = new Blob([textContent], { type: 'text/plain' });
      const clipboardItem = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      });
      await navigator.clipboard.write([clipboardItem]);
      if (onToast) onToast(`¡Ficha de ${item.upc || item.sku || item.title} copiada!`);
    } catch (e) {
      await navigator.clipboard.writeText(textContent);
      if (onToast) onToast('Ficha copiada en texto plano.');
    }
  } else {
    await navigator.clipboard.writeText(textContent);
    if (onToast) onToast('Ficha copiada en texto plano.');
  }
}

/**
 * Render product cards list, supporting both normal cards and "needsChoice" selector cards.
 */
export function renderProductCards(
  container: HTMLElement,
  items: BatchItemState[],
  ctx: RenderContext
): void {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `<div class="panel-card" style="text-align:center; padding:2.5rem; color:var(--text-3); width:100%;">No hay coincidencias con el filtro aplicado</div>`;
    return;
  }

  const defaultSourceLabels: Record<string, { label: string; icon: string; className: string }> = {
    local_index: { label: 'Base Local', icon: 'ph-hard-drive', className: 'source-local' },
    not_found: { label: 'No Encontrado', icon: 'ph-warning-circle', className: 'source-none' },
    ...(ctx.sourceLabels || {}),
  };


  items.forEach((item, index) => {
    const cardId = `pcard-${item.query || index}-${index}`;
    const isExpanded = ctx.expandedProductIds.has(cardId);

    // ==========================================
    // CASE A: CARD REQUIRES VARIANT CHOICE
    // ==========================================
    if (item.needsChoice && item.candidates && item.candidates.length > 1) {
      const choiceCard = document.createElement('div');
      choiceCard.className = 'funko-product-card card-needs-choice';
      choiceCard.id = cardId;

      let candidatesHtml = '';
      item.candidates.forEach((cand, cIdx) => {
        const candImg = cand.image || '/assets/no-picture.svg';
        const candTitle = cand.title || 'Sin título';

        let candBadgesHtml = '';
        ctx.adapter.fields.forEach((f) => {
          if (f.type === 'badge') {
            const val = (cand as any)[f.key];
            if (val) {
              candBadgesHtml += `<span class="badge-tag">${escapeHtml(String(val))}</span>`;
            }
          }
        });

        candidatesHtml += `
          <div class="variant-choice-option" data-candidate-idx="${cIdx}" title="Clic para seleccionar esta variante">
            <div class="variant-choice-thumb">
              <img src="${escapeAttr(candImg)}" alt="${escapeAttr(candTitle)}" onerror="this.src='/assets/no-picture.svg'" />
            </div>
            <div class="variant-choice-info">
              <strong class="variant-choice-title">${escapeHtml(candTitle)}</strong>
              <div class="variant-choice-meta">
                ${candBadgesHtml}
                <span class="mono-code-badge">ID: ${cand.productId}</span>
              </div>
            </div>
            <button class="btn-compact btn-accent btn-select-variant" type="button">
              <i class="ph ph-check"></i> Elegir
            </button>
          </div>
        `;
      });


      choiceCard.innerHTML = `
        <div class="card-choice-banner">
          <div class="card-choice-badge">
            <i class="ph ph-git-fork"></i> Requiere Selección de Variante (${item.candidates.length} candidatas)
          </div>
          <div class="card-codes-row">
            <span class="mono-code-badge"><i class="ph ph-barcode"></i> Consulta: <strong>${escapeHtml(item.query)}</strong></span>
          </div>
        </div>
        <p class="choice-instruction">Este código corresponde a múltiples productos en el catálogo oficial. Selecciona la variante correcta para incluirla en la exportación:</p>
        <div class="variant-choices-list">
          ${candidatesHtml}
        </div>
      `;

      // Hook click on candidates
      choiceCard.querySelectorAll('.variant-choice-option').forEach((optElem) => {
        optElem.addEventListener('click', () => {
          const cIdx = Number(optElem.getAttribute('data-candidate-idx'));
          const selectedCand = item.candidates![cIdx];
          if (!selectedCand) return;

          // Update item state
          item.needsChoice = false;
          Object.assign(item, selectedCand, {
            query: item.query,
            status: 'found',
            needsChoice: false,
            fromCache: false,
          });

          // Save selection to persistent storage under query & UPC
          saveToLocalCatalog(ctx.storageKey, item);

          if (ctx.onChoiceSelected) {
            ctx.onChoiceSelected(item, selectedCand);
          }
          if (ctx.onToast) {
            ctx.onToast(`Variante "${selectedCand.title}" seleccionada.`);
          }
        });
      });

      container.appendChild(choiceCard);
      return;
    }

    // ==========================================
    // CASE B: NORMAL PRODUCT CARD
    // ==========================================
    const imgSrc = item.image || '/assets/no-picture.svg';
    const gallery = item.gallery && item.gallery.length > 0 ? item.gallery : item.image ? [item.image] : [];
    const photosCount = gallery.length;

    // Badges
    const sInfo = defaultSourceLabels[item.source] || {
      label: item.source || 'Desconocido',
      icon: 'ph-info',
      className: 'source-local',
    };
    const sourceBadge = `<span class="badge-source ${sInfo.className}"><i class="ph ${sInfo.icon}"></i> ${escapeHtml(sInfo.label)}</span>`;
    const cacheBadge = item.fromCache
      ? `<span class="badge-cache" title="Recuperado de la base local (0ms)"><i class="ph ph-hard-drive"></i></span>`
      : '';
    const sourceBadgeGroup = `<span class="source-badge-group">${sourceBadge}${cacheBadge}</span>`;

    // Dynamic field badges from adapter.fields
    let fieldBadgesHtml = '';
    ctx.adapter.fields.forEach((f) => {
      if (f.type === 'badge') {
        const val = (item as any)[f.key];
        if (val) {
          fieldBadgesHtml += `<span class="badge-tag">${escapeHtml(String(val))}</span>`;
        }
      }
    });

    const card = document.createElement('div');
    card.className = `funko-product-card ${isExpanded ? 'is-expanded' : ''}`;
    card.id = cardId;

    // Gallery thumbnails strip
    let thumbsStripHtml = '';
    gallery.forEach((url, gIdx) => {
      thumbsStripHtml += `
        <div class="card-thumb-item ${gIdx === 0 ? 'active' : ''}" data-url="${escapeAttr(url)}">
          <img src="${escapeAttr(url)}" alt="Vista ${gIdx + 1}" onerror="this.src='/assets/no-picture.svg'">
        </div>
      `;
    });

    const cleanDescEs = (item.description_es || item.description || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+(>|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanDescEn = (item.description || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+(>|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Single photo notice badge (when only 1 photo exists and no enriched gallery from Shopify)
    const singlePhotoNotice = (photosCount === 1 && item.source !== 'shopify_es')
      ? `<span class="card-photo-notice" title="TCGplayer CDN provee 1 imagen oficial en HD"><i class="ph ph-camera"></i> 1 foto HD (Oficial)</span>`
      : '';


    // Dynamic specs list for expanded drawer
    let drawerSpecsHtml = '';
    ctx.adapter.fields.forEach((field) => {
      if (field.type === 'image' || field.key === 'title' || field.key === 'titleEs') return;
      const val = (item as any)[field.key];
      if (val !== undefined && val !== null && val !== '') {
        drawerSpecsHtml += `<li><strong>${escapeHtml(field.label)}:</strong> <span>${escapeHtml(String(val))}</span></li>`;
      }
    });

    card.innerHTML = `
      <div class="card-main-grid">
        <!-- LEFT COLUMN: GALLERY -->
        <div class="card-gallery-col">
          <div class="card-hero-img-box">
            <img class="card-active-img" src="${escapeAttr(gallery[0] || imgSrc)}" alt="${escapeAttr(item.title || '')}" onerror="this.src='/assets/no-picture.svg'">
          </div>

          ${gallery.length > 1 ? `<div class="card-thumbs-strip">${thumbsStripHtml}</div>` : ''}

          <div class="card-gallery-footer">
            <span class="card-photo-count"><i class="ph ph-image"></i> ${photosCount} ${photosCount === 1 ? 'foto' : 'fotos'}</span>
            ${singlePhotoNotice}
          </div>
        </div>

        <!-- RIGHT COLUMN: PRODUCT INFO & ACTIONS -->
        <div class="card-content-col">
          <div class="card-top-meta">
            <div class="card-pills-row">
              ${fieldBadgesHtml}
              ${sourceBadgeGroup}
            </div>
            <div class="card-codes-row">
              <span class="mono-code-badge"><i class="ph ph-barcode"></i> UPC: <strong>${escapeHtml(item.upc || item.query)}</strong></span>
              ${item.productId ? `<span class="mono-code-badge"><i class="ph ph-tag"></i> ID: <strong>${escapeHtml(String(item.productId))}</strong></span>` : ''}
            </div>
          </div>

          <h3 class="card-title">${escapeHtml(item.title || 'Sin título')}</h3>

          <p class="card-desc-snippet">${escapeHtml(cleanDescEs || cleanDescEn || 'Sin descripción disponible.')}</p>

          <div class="card-unified-actions">
            <button class="btn-compact btn-accent btn-copy-html-card" type="button" title="Copiar HTML formateado">
              <i class="ph ph-copy"></i> <span>Copiar Ficha</span>
            </button>
            <button class="btn-compact btn-copy-text-card" type="button" title="Copiar ficha en texto plano">
              <i class="ph ph-clipboard-text"></i> <span>Texto</span>
            </button>
            ${photosCount > 0 ? `
              <button class="btn-compact btn-single-zip" type="button" title="Descargar paquete ZIP de fotos">
                <i class="ph ph-file-zip"></i> <span>ZIP (${photosCount})</span>
              </button>
            ` : ''}
            <button class="btn-compact btn-refresh-card" type="button" title="Forzar re-consulta a la red externa">
              <i class="ph ph-arrows-clockwise"></i> <span>Refrescar</span>
            </button>
          </div>

          <div class="card-actions-wrapper">
            <button class="btn-expand-ficha-full ${isExpanded ? 'active' : ''}" type="button">
              <div class="btn-expand-inner">
                <i class="ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'}"></i>
                <span>${isExpanded ? 'Ocultar Ficha y Especificaciones' : 'Ver Ficha Completa y Especificaciones'}</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- FULL-WIDTH EXPANDED DRAWER -->
      <div class="card-expanded-drawer" style="display: ${isExpanded ? 'block' : 'none'};">
        <div class="expanded-sheet-box">
          <div class="expanded-sheet-header">
            <div class="drawer-lang-selector">
              <button class="drawer-lang-btn active" data-lang="es" type="button">🇪🇸 Español</button>
              <button class="drawer-lang-btn" data-lang="en" type="button">🇺🇸 English</button>
            </div>
            <div class="expanded-external-links-top">
              ${item.link ? `<a href="${escapeAttr(item.link)}" target="_blank" rel="noopener" class="btn-compact btn-accent"><i class="ph ph-arrow-square-out"></i> ${escapeHtml(ctx.adapter.label || 'Sitio Oficial')}</a>` : ''}
              <a href="https://www.google.com/search?q=${encodeURIComponent((ctx.adapter.label || '') + ' ' + (item.upc || item.sku || item.title || ''))}" target="_blank" rel="noopener" class="btn-compact"><i class="ph ph-google-logo"></i> Google</a>
            </div>
          </div>


          <div class="expanded-sheet-body">
            <p class="expanded-sheet-desc" data-desc-es="${escapeAttr(cleanDescEs)}" data-desc-en="${escapeAttr(cleanDescEn)}">${escapeHtml(cleanDescEs || cleanDescEn)}</p>
            
            <ul class="expanded-sheet-specs">
              ${drawerSpecsHtml}
            </ul>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);

    // 1. Thumbnail click interaction
    const cardActiveImg = card.querySelector<HTMLImageElement>('.card-active-img');
    const thumbs = card.querySelectorAll<HTMLElement>('.card-thumb-item');
    thumbs.forEach((th) => {
      th.addEventListener('click', () => {
        thumbs.forEach((t) => t.classList.remove('active'));
        th.classList.add('active');
        if (cardActiveImg && th.dataset.url) {
          cardActiveImg.src = th.dataset.url;
        }
      });
    });

    // 2. Single Product ZIP
    card.querySelector('.btn-single-zip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSingleProductZip(item, ctx.adapter.id);
    });

    // 3. Refresh Action
    card.querySelector('.btn-refresh-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.onRefreshItem) {
        ctx.onRefreshItem(item, card);
      }
    });

    // 4. Copy Actions
    let currentLang: 'es' | 'en' = 'es';
    card.querySelector('.btn-copy-html-card')?.addEventListener('click', () => {
      copyGenericProductSheet(item, ctx.adapter, 'html', currentLang, ctx.onToast);
    });
    card.querySelector('.btn-copy-text-card')?.addEventListener('click', () => {
      copyGenericProductSheet(item, ctx.adapter, 'text', currentLang, ctx.onToast);
    });

    // 5. Expand / Collapse Action
    const btnExpand = card.querySelector<HTMLButtonElement>('.btn-expand-ficha-full');
    const drawer = card.querySelector<HTMLElement>('.card-expanded-drawer');
    if (btnExpand && drawer) {
      btnExpand.addEventListener('click', () => {
        const willExpand = !ctx.expandedProductIds.has(cardId);
        if (willExpand) {
          ctx.expandedProductIds.add(cardId);
          card.classList.add('is-expanded');
          btnExpand.classList.add('active');
          drawer.style.display = 'block';
          const icon = btnExpand.querySelector('.btn-expand-inner i');
          const span = btnExpand.querySelector('.btn-expand-inner span');
          if (icon) icon.className = 'ph ph-caret-up';
          if (span) span.textContent = 'Ocultar Ficha y Especificaciones';
        } else {
          ctx.expandedProductIds.delete(cardId);
          card.classList.remove('is-expanded');
          btnExpand.classList.remove('active');
          drawer.style.display = 'none';
          const icon = btnExpand.querySelector('.btn-expand-inner i');
          const span = btnExpand.querySelector('.btn-expand-inner span');
          if (icon) icon.className = 'ph ph-caret-down';
          if (span) span.textContent = 'Ver Ficha Completa y Especificaciones';
        }
      });
    }

    // 6. Bilingual Toggle in Drawer
    const langBtns = card.querySelectorAll<HTMLButtonElement>('.drawer-lang-btn');
    const descElem = card.querySelector<HTMLElement>('.expanded-sheet-desc');
    langBtns.forEach((b) => {
      b.addEventListener('click', () => {
        langBtns.forEach((t) => t.classList.remove('active'));
        b.classList.add('active');
        currentLang = (b.dataset.lang as 'es' | 'en') || 'es';
        if (descElem) {
          if (currentLang === 'en') {
            descElem.textContent = descElem.getAttribute('data-desc-en') || cleanDescEn;
          } else {
            descElem.textContent = descElem.getAttribute('data-desc-es') || cleanDescEs;
          }
        }
      });
    });
  });
}

/**
 * Render collections breakdown view based on groupFieldKey.
 */
export function renderCollectionsSummary(
  gridContainer: HTMLElement,
  subtitleElem: HTMLElement | null,
  tabsLabelElem: HTMLElement | null,
  products: BatchItemState[],
  groupKey = 'expansion',
  onGroupClick?: (groupName: string) => void
): void {
  if (products.length === 0) return;

  const total = products.length;
  const foundItems = products.filter((p) => p.status === 'found');
  const totalFound = foundItems.length;

  if (subtitleElem) {
    subtitleElem.textContent = `Se identificaron ${totalFound} de ${total} productos (${Math.round((totalFound / total) * 100)}%). Haz clic en una colección para filtrar.`;
  }

  const collectionsMap: Record<string, BatchItemState[]> = {};
  foundItems.forEach((item) => {
    const group = (item as any)[groupKey] || 'Otras Colecciones';
    if (!collectionsMap[group]) {
      collectionsMap[group] = [];
    }
    collectionsMap[group].push(item);
  });

  const totalCollections = Object.keys(collectionsMap).length;
  if (tabsLabelElem) {
    tabsLabelElem.textContent = `Colecciones (${totalCollections})`;
  }

  let collectionsHtml = '';
  const sortedEntries = Object.entries(collectionsMap).sort((a, b) => b[1].length - a[1].length);

  for (const [groupName, items] of sortedEntries) {
    let thumbsHtml = '';
    items.slice(0, 6).forEach((it) => {
      const src = it.image || '/assets/no-picture.svg';
      thumbsHtml += `
        <div style="width:34px; height:34px; min-width:34px; aspect-ratio:1/1; background:#fff; border:1px solid var(--border); border-radius:4px; padding:2px; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
          <img src="${escapeAttr(src)}" alt="" style="width:100%; height:100%; object-fit:contain; display:block;" onerror="this.src='/assets/no-picture.svg'">
        </div>
      `;
    });

    collectionsHtml += `
      <div class="collection-card" data-group="${escapeAttr(groupName)}" style="cursor:pointer;" title="Clic para filtrar por ${escapeAttr(groupName)}">
        <div class="collection-card-header">
          <span class="collection-name">${escapeHtml(groupName)}</span>
          <span class="collection-badge">${items.length}</span>
        </div>
        <div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:2px; margin:4px 0;">
          ${thumbsHtml}
        </div>
        <span style="font-family:'IBM Plex Mono',monospace; font-size:0.7rem; color:var(--text-3);">${items.length} ${items.length === 1 ? 'producto' : 'productos'}</span>
      </div>
    `;
  }

  gridContainer.innerHTML = collectionsHtml || '<p style="color:var(--text-3); font-size:0.84rem;">Sin productos encontrados en este lote.</p>';

  gridContainer.querySelectorAll<HTMLElement>('.collection-card').forEach((card) => {
    card.addEventListener('click', () => {
      const g = card.getAttribute('data-group') || '';
      if (onGroupClick) {
        onGroupClick(g);
      }
    });
  });
}
