import { describe, expect, it } from 'vitest';
import { sortProducts } from './catalog-sort';
import type { Product } from '../types';

function product(overrides: Partial<Product> & { id: string }): Product {
  return { name: '', priceCents: -1, active: true, ...overrides };
}

describe('商品排序', () => {
  const list = [
    product({ id: 'a', name: '可乐 500ml', priceCents: 300, itemId: '1002', active: true }),
    product({ id: 'b', name: '面包', priceCents: 850, itemId: '981', active: false }),
    product({ id: 'c', name: '矿泉水', priceCents: 200, active: true }),
    product({ id: 'd', name: '泡面', priceCents: 450, itemId: '300', active: false }),
  ];

  it('按名称使用中文拼音顺序稳定排序', () => {
    expect(sortProducts(list, 'name').map((item) => item.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('价格排序把未填价格的商品放在末尾，且支持升降序', () => {
    const withBlank = [...list, product({ id: 'e', name: '未定价', priceCents: -1 })];
    expect(sortProducts(withBlank, 'priceAsc').map((item) => item.id)).toEqual(['c', 'a', 'd', 'b', 'e']);
    expect(sortProducts(withBlank, 'priceDesc').map((item) => item.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('Item ID 按数值顺序排序，缺失的排在末尾', () => {
    expect(sortProducts(list, 'itemId').map((item) => item.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('上架优先保持同组内原有相对顺序', () => {
    expect(sortProducts(list, 'activeFirst').map((item) => item.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('当前顺序恢复已发布目录排序，新增商品按相对顺序排在末尾', () => {
    const reference = [list[2], list[0], list[3], list[1]];
    const edited = [list[1], product({ id: 'new-1', name: '新商品' }), list[2], product({ id: 'new-2', name: '新商品2' }), list[0]];
    expect(sortProducts(edited, 'manual', reference).map((item) => item.id)).toEqual(['c', 'a', 'b', 'new-1', 'new-2']);
  });

  it('不会修改传入的数组', () => {
    const source = [...list];
    sortProducts(source, 'priceDesc');
    expect(source.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
