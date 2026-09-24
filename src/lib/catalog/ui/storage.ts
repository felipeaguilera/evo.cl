import type { CatalogItem } from '../types.js';

/**
 * Local catalog storage system parameterized by storageKey (persistent client-side index).
 */

export function getLocalCatalog(storageKey: string): Record<string, CatalogItem> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function getUniqueLocalFigures(storageKey: string): CatalogItem[] {
  const catalog = getLocalCatalog(storageKey);
  const map = new Map<string, CatalogItem>();
  Object.values(catalog).forEach((item) => {
    if (!item || !item.title) return;
    const key = item.sku || item.upc || item.query || item.title;
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

export function saveToLocalCatalog(
  storageKey: string,
  item: CatalogItem,
  onQuotaError?: (err: Error) => void
): boolean {
  if (!item || item.status !== 'found') return false;
  try {
    if (typeof localStorage === 'undefined') return false;
    const catalog = getLocalCatalog(storageKey);
    const cleanItem: CatalogItem = { ...item, source: item.source || 'local_index' };
    if (item.query) catalog[item.query] = cleanItem;
    if (item.sku) catalog[item.sku] = cleanItem;
    if (item.upc) catalog[item.upc] = cleanItem;
    localStorage.setItem(storageKey, JSON.stringify(catalog));
    return true;
  } catch (e: any) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      const err = new Error('El almacenamiento local del navegador está lleno (QuotaExceededError). Exporta una copia JSON y limpia la base local.');
      console.warn(err.message);
      if (onQuotaError) onQuotaError(err);
    } else {
      console.warn('Error saving to local catalog:', e);
    }
    return false;
  }
}


export function getFromLocalCatalog(storageKey: string, query: string): CatalogItem | null {
  if (!query) return null;
  const catalog = getLocalCatalog(storageKey);
  return catalog[query] || null;
}

export function updateLocalCatalogBadge(
  storageKey: string,
  badgeElem: HTMLElement | null,
  singularUnit = 'producto',
  pluralUnit = 'productos'
): void {
  if (!badgeElem) return;
  const uniqueItems = getUniqueLocalFigures(storageKey);
  const count = uniqueItems.length;
  badgeElem.textContent = `${count} ${count === 1 ? singularUnit : pluralUnit}`;
}

export function exportLocalCatalogJson(storageKey: string, filenamePrefix = 'evo-catalog'): void {
  const uniqueItems = getUniqueLocalFigures(storageKey);
  if (uniqueItems.length === 0) {
    alert('La base local está vacía. Consulta códigos para indexar productos.');
    return;
  }
  const blob = new Blob([JSON.stringify(uniqueItems, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function importLocalCatalogJson(
  storageKey: string,
  file: File,
  onDone: (importedCount: number) => void,
  onError: (err: Error) => void
): void {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const text = event.target?.result as string;
      const data = JSON.parse(text);
      if (typeof data !== 'object' || data === null) {
        throw new Error('Formato JSON no reconocido');
      }

      const currentCatalog = getLocalCatalog(storageKey);
      let importedCount = 0;

      const items: CatalogItem[] = Array.isArray(data) ? data : Object.values(data);
      items.forEach((item) => {
        if (item && item.title) {
          const cleanItem: CatalogItem = {
            ...item,
            status: item.status || 'found',
            source: item.source || 'local_index',
          };
          if (item.query) currentCatalog[item.query] = cleanItem;
          if (item.sku) currentCatalog[item.sku] = cleanItem;
          if (item.upc) currentCatalog[item.upc] = cleanItem;
          importedCount++;
        }
      });

      localStorage.setItem(storageKey, JSON.stringify(currentCatalog));
      onDone(importedCount);
    } catch (err) {
      onError(err as Error);
    }
  };
  reader.onerror = () => onError(new Error('Error al leer el archivo.'));
  reader.readAsText(file);
}

export function clearLocalCatalog(storageKey: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey);
    }
  } catch (e) {
    console.warn('Error clearing local catalog:', e);
  }
}
