import type { Catalog, ImportIssue, Product } from '../types';

export function normalizeText(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase('zh-CN').replace(/[\s\-_./]+/g, '').trim();
}

export function formatPrice(priceCents: number): string {
  return `¥${(priceCents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function priceForInput(priceCents: number): string {
  return (priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2);
}

export function parsePriceToCents(value: unknown): number | null {
  const input = String(value ?? '')
    .trim()
    .replace(/[￥¥,，\s]/g, '');
  const match = input.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const integer = Number(match[1]);
  const decimal = (match[2] ?? '').padEnd(2, '0');
  const cents = integer * 100 + Number(decimal || 0);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function productSearchText(product: Product): string {
  return normalizeText(
    [
      product.itemId,
      product.name,
      product.specification,
      product.unit,
      ...(product.barcodes ?? []),
      ...(product.aliases ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function searchProducts(products: Product[], query: string): Product[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return products
    .filter((product) => product.active && productSearchText(product).includes(normalizedQuery))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function productKey(product: Pick<Product, 'itemId' | 'name' | 'specification'>): string {
  const itemId = normalizeText(product.itemId);
  if (itemId) return `item:${itemId}`;
  return `name:${normalizeText(product.name)}:${normalizeText(product.specification)}`;
}

export function validateProducts(products: Product[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const seenItemIds = new Map<string, Product>();
  const seenNamePrices = new Map<string, Product>();

  products.forEach((product, index) => {
    const row = product.sourceRow ?? index + 1;
    if (!product.name.trim()) {
      issues.push({ severity: 'error', row, rows: [row], productIds: [product.id], message: '商品名称不能为空' });
    }
    if (!Number.isInteger(product.priceCents) || product.priceCents < 0) {
      issues.push({ severity: 'error', row, rows: [row], productIds: [product.id], message: '零售价必须是大于或等于 0 的金额' });
    }

    const normalizedItemId = normalizeText(product.itemId);
    const existingByItemId = normalizedItemId ? seenItemIds.get(normalizedItemId) : undefined;
    if (existingByItemId && existingByItemId.priceCents === product.priceCents) {
      issues.push({ severity: 'warning', row, rows: [existingByItemId.sourceRow ?? products.indexOf(existingByItemId) + 1, row], productIds: [existingByItemId.id, product.id], message: '与前一条商品重复，将只保留一条' });
    } else {
      const namePriceKey = `${normalizeText(product.name)}:${product.priceCents}`;
      if (seenNamePrices.has(namePriceKey)) {
        const existingByName = seenNamePrices.get(namePriceKey)!;
        issues.push({ severity: 'warning', row, rows: [existingByName.sourceRow ?? products.indexOf(existingByName) + 1, row], productIds: [existingByName.id, product.id], message: '与前一条同名同价商品重复，将只保留一条' });
      } else {
        seenNamePrices.set(namePriceKey, product);
      }
    }

    if (normalizedItemId && !existingByItemId) seenItemIds.set(normalizedItemId, product);
  });

  return issues;
}

export function uniqueProducts(products: Product[]): Product[] {
  const seenItemPrices = new Set<string>();
  const seenNamePrices = new Set<string>();

  return products.filter((product) => {
    const itemId = normalizeText(product.itemId);
    const itemPriceKey = itemId ? `${itemId}:${product.priceCents}` : null;
    const namePriceKey = `${normalizeText(product.name)}:${product.priceCents}`;

    if ((itemPriceKey && seenItemPrices.has(itemPriceKey)) || seenNamePrices.has(namePriceKey)) return false;
    if (itemPriceKey) seenItemPrices.add(itemPriceKey);
    seenNamePrices.add(namePriceKey);
    return true;
  });
}

export function isPublishedCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<Catalog>;
  return (
    typeof catalog.version === 'string' &&
    typeof catalog.sourceLabel === 'string' &&
    Array.isArray(catalog.products)
  );
}

export function stripDraftMetadata(catalog: Catalog): Catalog {
  return {
    ...catalog,
    products: uniqueProducts(catalog.products).map(({ sourceRow: _sourceRow, ...product }) => product),
  };
}
