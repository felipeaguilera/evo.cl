// Utilidades compartidas de normalizacion y calculo de similitud

const STOP_WORDS = new Set([
  'pokemon',
  'tcg',
  'espanol',
  'spanish',
  'english',
  'ingles',
  'de',
  'la',
  'el',
  'los',
  'las',
  'the',
  'en',
  'para',
  'of',
  'and',
  'y',
  'a',
  'an',
  'edition',
  'edicion',
  'coleccion',
  'juego',
  'cartas',
]);

export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita tildes y diacriticos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Quita puntuacion
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTokens(text: string): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  return norm
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

export function normalizeUpc(rawUpc: string): string {
  if (!rawUpc) return '';
  const digits = rawUpc.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(13, '0');
}

export function calculateJaccard(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = new Set([...tokensA, ...tokensB]).size;
  if (unionSize === 0) return 0;

  // Si los tokens de A y B son exactamente iguales
  if (tokensA.length === tokensB.length && intersectionSize === tokensA.length) {
    return 1.0;
  }

  // Jaccard base
  let score = intersectionSize / unionSize;

  // Si todos los tokens de la consulta estan incluidos en el producto
  if (tokensA.every((t) => setB.has(t))) {
    score += 0.15;
  }

  return Math.min(0.99, score);
}

export function extractProductTypeAndVariant(name: string): { productType?: string; variant?: string } {
  let productType: string | undefined;
  let variant: string | undefined;

  // 1. Extraer variante entre corchetes o paréntesis [Sylveon ex], (Lucario), [Set of 2]
  const bracketMatch = name.match(/[\[\(]([^\]\)]+)[\]\)]/);
  if (bracketMatch) {
    variant = bracketMatch[1].trim();
  }

  // 2. Detectar tipo de producto
  const types = [
    'Elite Trainer Box',
    'Ultra-Premium Collection',
    'Premium Collection',
    'Poster Collection',
    'Tech Sticker Collection',
    'Binder Collection',
    'Figure Collection',
    'Knock Out Collection',
    'Booster Bundle',
    'Booster Box',
    'Booster Pack',
    'Mini Tin Display',
    'Mini Tin',
    'ex Tin',
    'ex Box',
    'Tin',
    'Battle Deck',
    'Blister',
    'Collection',
  ];

  for (const type of types) {
    const regex = new RegExp(`\\b${type}\\b`, 'i');
    if (regex.test(name)) {
      productType = type;
      break;
    }
  }

  // 3. Si no se extrajo variante por corchetes, ver si hay un nombre previo a "ex Box" o "ex Tin" (ej. "Sylveon ex Box")
  if (!variant) {
    const exMatch = name.match(/\b([A-Za-z]+)\s+ex\s+Box\b/i);
    if (exMatch && !['celebration', 'pokemon', 'tcg'].includes(exMatch[1].toLowerCase())) {
      variant = `${exMatch[1].trim()} ex`;
    }
    const tinMatch = name.match(/\b([A-Za-z]+)\s+ex\s+Tin\b/i);
    if (tinMatch && !['celebration', 'pokemon', 'tcg'].includes(tinMatch[1].toLowerCase())) {
      variant = `${tinMatch[1].trim()} ex`;
    }
  }

  return { productType, variant };
}
