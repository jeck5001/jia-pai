import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPublishedCatalog, importRows, parseCsvRows } from './importer';

function fixtureRows(name: string): unknown[][] {
  const filePath = fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
  return parseCsvRows(readFileSync(filePath, 'utf8'));
}

const options = {
  sourceLabel: '测试价格表',
  effectiveAt: '2026-07-27T12:00:00.000Z',
  version: 'test-v1',
};

describe('价格表导入', () => {
  it('识别中文表头，导入三条商品，并保留上架状态与金额', () => {
    const result = importRows(fixtureRows('valid-price-sheet.csv'), options);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.catalog.products).toHaveLength(3);
    expect(result.catalog.products[0]).toMatchObject({
      itemId: '980000001',
      name: '山泉苏打水',
      priceCents: 350,
      active: true,
      barcodes: ['6900000000001'],
    });
    expect(result.catalog.products[2]).toMatchObject({ active: false, priceCents: 1880 });
  });

  it('拒绝缺少价格列的文件', () => {
    const result = importRows(fixtureRows('invalid-missing-price.csv'), options);
    expect(result.catalog.products).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('零售价') }));
  });

  it('阻止相同 Item ID 导入不同价格', () => {
    const result = importRows(
      [
        ['商品 Item ID', '商品名称', '零售价'],
        ['980001', '同款商品', '10'],
        ['980001', '同款商品', '12'],
      ],
      options,
    );
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('价格不同') }));
  });

  it('正确读取带引号和逗号的 CSV 字段', () => {
    expect(parseCsvRows('商品名称,零售价\n"混合,坚果",12.5\n')).toEqual([
      ['商品名称', '零售价'],
      ['混合,坚果', '12.5'],
    ]);
  });

  it('导出的发布价格表保留分金额，且移除仅供校对使用的行号', () => {
    const imported = importRows(fixtureRows('valid-price-sheet.csv'), options);
    const catalog = createPublishedCatalog('正式测试表', options.effectiveAt, imported.catalog.products);
    expect(catalog).toMatchObject({
      version: 'published-202607271200',
      sourceLabel: '正式测试表',
    });
    expect(catalog.products[0]).toMatchObject({ priceCents: 350 });
    expect('sourceRow' in catalog.products[0]).toBe(false);
  });
});
