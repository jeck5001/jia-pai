export type Product = {
  id: string;
  itemId?: string;
  name: string;
  specification?: string;
  priceCents: number;
  unit?: string;
  barcodes?: string[];
  aliases?: string[];
  active: boolean;
  stockQuantity?: number;
  sourceLabel?: string;
  sourceImage?: string;
  sourceRow?: number;
};

export type Catalog = {
  version: string;
  effectiveAt: string | null;
  sourceLabel: string;
  products: Product[];
};

export type ImportIssue = {
  severity: 'error' | 'warning';
  message: string;
  row?: number;
};

export type ImportResult = {
  catalog: Catalog;
  issues: ImportIssue[];
  headerRow?: number;
};
