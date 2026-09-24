import type { FieldSpec } from '../types.js';

export interface CatalogAdapterSpec {
  id: 'pokemon' | 'banpresto' | 'funko' | string;
  label: string;
  fields: FieldSpec[];
}

export const POKEMON_FIELDS: FieldSpec[] = [
  { key: 'upc', label: 'UPC', type: 'text' },
  { key: 'productId', label: 'ID TCGplayer', type: 'text' },
  { key: 'title', label: 'Título', type: 'text' },
  { key: 'titleEs', label: 'Título ES', type: 'text' },
  { key: 'expansion', label: 'Expansión', type: 'badge' },
  { key: 'productType', label: 'Tipo', type: 'badge' },
  { key: 'variant', label: 'Variante', type: 'badge' },
  { key: 'language', label: 'Idioma', type: 'badge' },
  { key: 'price', label: 'Precio', type: 'text' },
  { key: 'image', label: 'Foto HD', type: 'image' },
  { key: 'link', label: 'TCGplayer', type: 'link' },
];

export const pokemonAdapterSpec: CatalogAdapterSpec = {
  id: 'pokemon',
  label: 'Pokémon TCG',
  fields: POKEMON_FIELDS,
};
