import type { Product } from '../types';

export type ProductSortMode =
  | 'manual'
  | 'name'
  | 'nameDesc'
  | 'priceAsc'
  | 'priceDesc'
  | 'itemId'
  | 'itemIdDesc'
  | 'stockAsc'
  | 'stockDesc'
  | 'activeFirst'
  | 'activeLast';

export type SortColumn = 'name' | 'price' | 'itemId' | 'stock' | 'active';

export const PRODUCT_SORT_OPTIONS: { value: ProductSortMode; label: string }[] = [
  { value: 'manual', label: '当前顺序' },
  { value: 'name', label: '名称 A → Z' },
  { value: 'nameDesc', label: '名称 Z → A' },
  { value: 'priceAsc', label: '价格从低到高' },
  { value: 'priceDesc', label: '价格从高到低' },
  { value: 'itemId', label: 'Item ID 升序' },
  { value: 'itemIdDesc', label: 'Item ID 降序' },
  { value: 'stockAsc', label: '库存从少到多' },
  { value: 'stockDesc', label: '库存从多到少' },
  { value: 'activeFirst', label: '上架优先' },
  { value: 'activeLast', label: '下架优先' },
];

export const PRODUCT_SORT_HINTS: Partial<Record<ProductSortMode, string>> = {
  manual: '已恢复为当前已发布的商品顺序。',
  name: '已按名称排序，保存并发布后按此顺序展示。',
  nameDesc: '已按名称倒序排序，保存并发布后按此顺序展示。',
  priceAsc: '已按价格从低到高排序，保存并发布后按此顺序展示。',
  priceDesc: '已按价格从高到低排序，保存并发布后按此顺序展示。',
  itemId: '已按 Item ID 升序排序，保存并发布后按此顺序展示。',
  itemIdDesc: '已按 Item ID 降序排序，保存并发布后按此顺序展示。',
  stockAsc: '已按库存从少到多排序，未填库存的商品排在末尾。',
  stockDesc: '已按库存从多到少排序，未填库存的商品排在末尾。',
  activeFirst: '已把上架商品排在前面，保存并发布后按此顺序展示。',
  activeLast: '已把下架商品排在前面，保存并发布后按此顺序展示。',
};

/** 表头点击时使用的列与升降序映射；再次点击同一列即切换方向。 */
export const SORT_COLUMN_MODES: Record<SortColumn, { asc: ProductSortMode; desc: ProductSortMode }> = {
  name: { asc: 'name', desc: 'nameDesc' },
  price: { asc: 'priceAsc', desc: 'priceDesc' },
  itemId: { asc: 'itemId', desc: 'itemIdDesc' },
  stock: { asc: 'stockAsc', desc: 'stockDesc' },
  active: { asc: 'activeFirst', desc: 'activeLast' },
};

/** 点击表头时的下一个排序方式：同列切换升降序，换列从升序开始。 */
export function nextSortMode(column: SortColumn, current: ProductSortMode): ProductSortMode {
  const { asc, desc } = SORT_COLUMN_MODES[column];
  return current === asc ? desc : asc;
}

export function activeSortDirection(mode: ProductSortMode): 'asc' | 'desc' | undefined {
  if (mode === 'manual') return undefined;
  const column = (Object.keys(SORT_COLUMN_MODES) as SortColumn[]).find(
    (key) => SORT_COLUMN_MODES[key].asc === mode || SORT_COLUMN_MODES[key].desc === mode,
  );
  if (!column) return undefined;
  return SORT_COLUMN_MODES[column].desc === mode ? 'desc' : 'asc';
}

function priceValue(product: Product): number {
  return product.priceCents >= 0 ? product.priceCents : Number.MAX_SAFE_INTEGER;
}

function priceValueForDesc(product: Product): number {
  return product.priceCents >= 0 ? product.priceCents : -1;
}

function stockValue(product: Product): number | undefined {
  return typeof product.stockQuantity === 'number' && Number.isFinite(product.stockQuantity)
    ? product.stockQuantity
    : undefined;
}

function compareByName(left: Product, right: Product): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

/** Item ID 按数值感知比较；未填写的商品无论升降序都排在末尾。 */
function compareByItemId(direction: 'asc' | 'desc') {
  return (left: Product, right: Product) => {
    const leftId = left.itemId?.trim();
    const rightId = right.itemId?.trim();
    if (!leftId && !rightId) return compareByName(left, right);
    if (!leftId) return 1;
    if (!rightId) return -1;
    const result = leftId.localeCompare(rightId, undefined, { numeric: true });
    return (direction === 'asc' ? result : -result) || compareByName(left, right);
  };
}

/** 数值列比较：未填写的商品无论升降序都排在末尾。 */
function compareByNumber(pick: (product: Product) => number | undefined, direction: 'asc' | 'desc') {
  return (left: Product, right: Product) => {
    const leftValue = pick(left);
    const rightValue = pick(right);
    if (leftValue === undefined && rightValue === undefined) return compareByName(left, right);
    if (leftValue === undefined) return 1;
    if (rightValue === undefined) return -1;
    const difference = leftValue - rightValue;
    return (direction === 'asc' ? difference : -difference) || compareByName(left, right);
  };
}

function compareByMode(mode: Exclude<ProductSortMode, 'manual'>) {
  switch (mode) {
    case 'name':
      return compareByName;
    case 'nameDesc':
      return (left: Product, right: Product) => compareByName(right, left);
    case 'priceAsc':
      return (left: Product, right: Product) => priceValue(left) - priceValue(right) || compareByName(left, right);
    case 'priceDesc':
      return (left: Product, right: Product) => priceValueForDesc(right) - priceValueForDesc(left) || compareByName(left, right);
    case 'itemId':
      return compareByItemId('asc');
    case 'itemIdDesc':
      return compareByItemId('desc');
    case 'stockAsc':
      return compareByNumber(stockValue, 'asc');
    case 'stockDesc':
      return compareByNumber(stockValue, 'desc');
    case 'activeFirst':
      return (left: Product, right: Product) => Number(right.active) - Number(left.active);
    case 'activeLast':
      return (left: Product, right: Product) => Number(left.active) - Number(right.active);
  }
}

/**
 * 按所选方式对商品目录重新排序。
 * - `manual`：恢复参照目录（已发布目录）的原始顺序；不在参照目录中的新增商品按原相对顺序排在末尾。
 * - 其他方式：稳定排序，未填价格 / 库存 / Item ID 的商品排在末尾。
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
