import { stripDraftMetadata } from './catalog';
import type { Catalog, Product } from '../types';

type CreateManagedCatalogOptions = {
  sourceLabel: string;
  effectiveAt: string | null;
  now?: Date;
};

function versionDatePart(date: Date): string {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

export function createManagedProduct(index: number, now = new Date()): Product {
  return {
    id: `managed-${now.getTime()}-${index + 1}`,
    name: '',
    priceCents: -1,
    active: true,
  };
}

export function createManagedCatalog(
  baseCatalog: Catalog,
  products: Product[],
  { sourceLabel, effectiveAt, now = new Date() }: CreateManagedCatalogOptions,
): Catalog {
  return stripDraftMetadata({
    version: `managed-${versionDatePart(now)}`,
    effectiveAt,
    sourceLabel: sourceLabel.trim() || baseCatalog.sourceLabel,
    products,
  });
}
