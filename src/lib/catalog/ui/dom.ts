/**
 * DOM and formatting utility functions for Catalog tools.
 */

export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeAttr(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, ' ');
}

export function generateHandle(title?: string, fallback?: string): string {
  const base = title || fallback || 'product';
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getCleanCodes(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[\r\n,;\s]+/)
    .map((c) => c.trim().replace(/[^\w-]/g, ''))
    .filter((c) => c.length >= 4);
}

export function updateInputCount(textareaElem: HTMLTextAreaElement | null, counterElem: HTMLElement | null): number {
  if (!textareaElem) return 0;
  const codes = getCleanCodes(textareaElem.value);
  const count = codes.length;
  if (counterElem) {
    counterElem.textContent = `${count} ${count === 1 ? 'código' : 'códigos'}`;
  }
  return count;
}

export function showToast(
  toastElem: HTMLElement | null,
  msgElem: HTMLElement | null,
  msg: string,
  durationMs = 3200
): void {
  if (!toastElem || !msgElem) return;
  msgElem.textContent = msg;
  toastElem.classList.add('show');
  setTimeout(() => {
    toastElem.classList.remove('show');
  }, durationMs);
}
