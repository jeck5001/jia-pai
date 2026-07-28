import { describe, expect, it } from 'vitest';
import { createManagedCatalog, createManagedProduct } from './catalog-management';
import type { Catalog, Product } from '../types';

const baseCatalog: Catalog = {
  version: 'published-202607280900',
  effectiveAt: '2026-07-28T01:00:00.000Z',
  sourceLabel: '七月价格表',
  products: [],
};

describe('商品管理发布目录', () => {
  it('为手动新增商品提供独立的内部 ID 和可编辑初始值', () => {
    expect(createManagedProduct(2, new Date('2026-07-28T02:03:04.000Z'))).toMatchObject({
      id: 'managed-1785204184000-3',
      name: '',
      priceCents: -1,
      active: true,
    });
  });

  it('保留目录元数据，并在发布时应用现有的精确去重规则', () => {
    const products: Product[] = [
      { id: 'first', itemId: '1001', name: '苏打水', priceCents: 350, active: true, sourceRow: 4 },
      { id: 'repeat', itemId: '1001', name: '苏打水新版名称', priceCents: 350, active: true, sourceRow: 5 },
      { id: 'different-price', itemId: '1001', name: '苏打水', priceCents: 400, active: true },
    ];

    const catalog = createManagedCatalog(baseCatalog, products, {
      sourceLabel: '',
      effectiveAt: baseCatalog.effectiveAt,
      now: new Date('2026-07-28T02:03:04.000Z'),
    });

    expect(catalog).toMatchObject({
      version: 'managed-20260728020304',
      sourceLabel: '七月价格表',
      effectiveAt: baseCatalog.effectiveAt,
    });
    expect(catalog.products.map((product) => product.id)).toEqual(['first', 'different-price']);
    expect('sourceRow' in catalog.products[0]).toBe(false);
  });
});
