export interface Category {
  slug: string;
  name: string;
  description: string;
}

export interface Variant {
  slug: string;
  category: string;
  name: string;
  repo: string;
  tagline: string;
  arch: 'Desktop' | 'CLI' | 'Web' | 'Browser' | 'SDK' | 'Mobile';
  model: 'Standalone' | 'Local LLM' | 'Hybrid' | 'Cloud API';
  license: 'MIT' | 'Apache-2' | 'AGPL' | 'GPL-3' | 'BSD-3' | 'ISC' | 'Source';
  stage: 'Prod' | 'Beta' | 'Proto' | 'Lesson';
  lesson?: string;
  stack: string;
  region: string;
  stars: number;
  spark: number[];
  traits: string[];
  x: number;
  y: number;
  addedAt?: string;
}

export interface CatalogIndex {
  generatedAt: string;
  categories: Category[];
  variants: Variant[];
}

export interface PulseSummary {
  total: number;
  byCategory: Record<string, number>;
  byVariant: Record<string, number>;
  myCategories?: string[];
}
