import { describe, expect, it } from 'vitest';
import { formatPrice, parsePriceToCents, searchProducts, uniqueProducts, validateProducts } from './catalog';
import type { Product } from '../types';

const products: Product[] = [
  {
    id: 'water',
    itemId: '980000001',
    name: '山泉苏打水',
    specification: '330ml',
    priceCents: 350,
    barcodes: ['6900000000001'],
    aliases: ['气泡水'],
    active: true,
  },
  {
    id: 'inactive',
    itemId: '980000003',
    name: '抑菌洗手液',
    specification: '500ml',
    priceCents: 1880,
    barcodes: ['6900000000003'],
    aliases: ['洗手'],
    active: false,
  },
];

describe('价格和查询', () => {
  it('将元金额准确转换为分，并以人民币格式显示', () => {
    expect(parsePriceToCents('58.5')).toBe(5850);
    expect(parsePriceToCents('¥1,200.08')).toBe(120008);
    expect(parsePriceToCents('12.345')).toBeNull();
    expect(formatPrice(5850)).toBe('¥58.5');
    expect(formatPrice(120008)).toBe('¥1,200.08');
  });

  it('可按名称、Item ID、别名和条码搜索，且不展示下架商品', () => {
    expect(searchProducts(products, '苏打').map((product) => product.id)).toEqual(['water']);
    expect(searchProducts(products, '980000001').map((product) => product.id)).toEqual(['water']);
    expect(searchProducts(products, '气泡水').map((product) => product.id)).toEqual(['water']);
    expect(searchProducts(products, '6900000000001').map((product) => product.id)).toEqual(['water']);
    expect(searchProducts(products, '洗手')).toEqual([]);
  });

  it('同一商品的多条来源报价都会保留在查询结果中', () => {
    const quotes: Product[] = [
      {
        id: 'quote-25',
        itemId: '980000099',
        name: '精选燕麦片3kg',
        priceCents: 6300,
        active: true,
        sourceLabel: '照片 25',
      },
      {
        id: 'quote-26',
        itemId: '980000099',
        name: '精选燕麦片3kg',
        priceCents: 6200,
        active: true,
        sourceLabel: '照片 26',
      },
    ];

    expect(searchProducts(quotes, '精选燕麦片').map((product) => [product.priceCents, product.sourceLabel])).toEqual([
      [6300, '照片 25'],
      [6200, '照片 26'],
    ]);
  });

  it('只去除同价的相同 Item ID 或相同商品名记录', () => {
    const result = uniqueProducts([
      { id: 'item-first', itemId: '980000101', name: '原始商品', priceCents: 1000, active: true },
      { id: 'item-repeat', itemId: '980000101', name: '另一写法', priceCents: 1000, active: true },
      { id: 'name-first', itemId: '980000102', name: '同名商品', priceCents: 2000, active: true },
      { id: 'name-repeat', itemId: '980000103', name: '同 名商品', priceCents: 2000, active: true },
      { id: 'different-price', itemId: '980000101', name: '原始商品', priceCents: 1100, active: true },
    ]);

    expect(result.map((product) => product.id)).toEqual(['item-first', 'name-first', 'different-price']);
  });

  it('保留相同 Item ID 但价格不同的商品，避免错误录入 ID 时阻塞发布', () => {
    const conflicts: Product[] = [
      { id: 'row-28', itemId: '980000101', name: '进口零触感超丝薄', priceCents: 10800, active: true, sourceRow: 28 },
      { id: 'row-29', itemId: '980000101', name: '洁面柔巾60片*12', priceCents: 8800, active: true, sourceRow: 29 },
    ];

    expect(validateProducts(conflicts).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(uniqueProducts(conflicts).map((product) => product.id)).toEqual(['row-28', 'row-29']);
  });
});
