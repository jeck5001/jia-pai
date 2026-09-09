import type { Product } from '../types';

export type ProductSortMode = 'manual' | 'name' | 'priceAsc' | 'priceDesc' | 'itemId' | 'activeFirst';

export const PRODUCT_SORT_OPTIONS: { value: ProductSortMode; label: string }[] = [
  { value: 'manual', label: '当前顺序' },
  { value: 'name', label: '按名称' },
  { value: 'priceAsc', label: '价格从低到高' },
  { value: 'priceDesc', label: '价格从高到低' },
  { value: 'itemId', label: '按 Item ID' },
  { value: 'activeFirst', label: '上架优先' },
];

export const PRODUCT_SORT_HINTS: Record<Exclude<ProductSortMode, 'manual'>, string> = {
  name: '已按名称重新排序，保存并发布后按此顺序展示。',
  priceAsc: '已按价格从低到高重新排序，保存并发布后按此顺序展示。',
  priceDesc: '已按价格从高到低重新排序，保存并发布后按此顺序展示。',
  itemId: '已按 Item ID 重新排序，保存并发布后按此顺序展示。',
  activeFirst: '已把上架商品排在前面，保存并发布后按此顺序展示。',
};

function priceValue(product: Product): number {
  return product.priceCents >= 0 ? product.priceCents : Number.MAX_SAFE_INTEGER;
}

function priceValueForDesc(product: Product): number {
  return product.priceCents >= 0 ? product.priceCents : -1;
}

function compareByName(left: Product, right: Product): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

function compareByItemId(left: Product, right: Product): number {
  const leftId = left.itemId?.trim();
  const rightId = right.itemId?.trim();
  if (!leftId && !rightId) return 0;
  if (!leftId) return 1;
  if (!rightId) return -1;
  return leftId.localeCompare(rightId, undefined, { numeric: true });
}

function compareByMode(mode: Exclude<ProductSortMode, 'manual'>) {
  switch (mode) {
    case 'name':
      return compareByName;
    case 'priceAsc':
      return (left: Product, right: Product) => priceValue(left) - priceValue(right) || compareByName(left, right);
    case 'priceDesc':
      return (left: Product, right: Product) => priceValueForDesc(right) - priceValueForDesc(left) || compareByName(left, right);
    case 'itemId':
      return compareByItemId;
    case 'activeFirst':
      return (left: Product, right: Product) => Number(right.active) - Number(left.active);
  }
}

/**
 * 按所选方式对商品目录重新排序。
 * - `manual`：恢复参照目录（已发布目录）的原始顺序；不在参照目录中的新增商品按原相对顺序排在末尾。
 * - 其他方式：稳定排序，未填价格或 Item ID 的商品排在末尾。
 */
export function sortProducts(products: Product[], mode: ProductSortMode, referenceOrder: Product[] = []): Product[] {
  if (mode === 'manual') {
    const order = new Map(referenceOrder.map((product, index) => [product.id, index]));
    return products
      .map((product, index) => ({ product, index }))
      .sort((left, right) => {
        const leftOrder = order.get(left.product.id) ?? referenceOrder.length + left.index;
        const rightOrder = order.get(right.product.id) ?? referenceOrder.length + right.index;
        return leftOrder - rightOrder;
      })
      .map(({ product }) => product);
  }
  return [...products].sort(compareByMode(mode));
}
