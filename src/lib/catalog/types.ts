export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'badge' | 'image' | 'link' | 'html';
}

export interface ParsedInput {
  raw: string;
  upc?: string;
  title?: string;
  price?: string;
  sku?: string;
  language?: 'EN' | 'ES';
}

export interface CatalogItem {
  query: string;
  upc: string;
  productId: number | string;
  sku?: string;
  title: string;
  titleEs?: string;
  expansion?: string; // groupName, ej. "ME: 30th Celebration"
  productType?: string; // Elite Trainer Box, Booster Pack, Tin, Collection, etc.
  variant?: string; // Sylveon ex, Lucario, etc.
  language?: 'EN' | 'ES' | string;
  releasedOn?: string;
  image: string;
  gallery: string[];
  link?: string;
  description?: string;
  description_es?: string;
  price?: string;
  source: 'tcgcsv' | 'local_index' | 'shopify_es' | 'translated' | 'not_found';
  status: 'found' | 'not_found' | 'error';
  diagnosis?: string;
  matchScore?: number;
  matchType?: 'upc_exact' | 'title_normalized' | 'title_jaccard';
  candidatesCount?: number;
}

export interface CatalogAdapter {
  id: 'pokemon' | 'banpresto' | 'funko';
  label: string;
  detect(input: string): number; // 0 a 1, para el autodetector
  parseInput(raw: string): ParsedInput; // UPC, titulo, precio
  lookup(p: ParsedInput): Promise<CatalogItem | CatalogItem[]>;
  fields: FieldSpec[]; // que muestra la ficha
}

export interface PokemonProductEntry {
  productId: number;
  name: string;
  cleanName: string;
  normalizedTitle: string;
  tokens: string[];
  groupId: number;
  groupName: string;
  upc?: string;
  imageUrl: string;
  url: string;
  releasedOn?: string;
  description?: string;
}

export interface PokemonIndexData {
  version: string;
  generatedAt: string;
  totalProducts: number;
  byUpc: Record<string, number[]>; // upc -> array de productIds
  byId?: Record<number, PokemonProductEntry>; // productId -> entry
  products: PokemonProductEntry[];
}

export interface QueryLookupResult {
  query: string;
  status: 'found' | 'not_found' | 'error';
  needsChoice: boolean;
  candidates: CatalogItem[];
}

export interface CatalogLookupResponse {
  results: QueryLookupResult[];
  indexGeneratedAt?: string;
  indexTotalProducts?: number;
}


