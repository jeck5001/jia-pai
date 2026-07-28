import { describe, expect, it } from 'vitest';
import { parseVisionTable } from './vision-import';

describe('Sub2API 图片识别', () => {
  it('把模型 JSON 转为可校对的商品候选', () => {
    const result = parseVisionTable('```json\n{"products":[{"itemId":"981102169","name":"MM酸汤风味料理500g","quantity":10,"price":45},{"item_id":"666576","product_name":"不倒翁韩国进口小麦面条1.5kg","stock_quantity":"10","retail_price":"37"}]}\n```', {
      fileIndex: 1,
      sourceImage: '价格表.jpg',
      sourceLabel: '大模型导入：价格表.jpg',
    });

    expect(result.issues).toEqual([]);
    expect(result.products).toEqual([
      expect.objectContaining({ itemId: '981102169', name: 'MM酸汤风味料理500g', stockQuantity: 10, priceCents: 4500 }),
      expect.objectContaining({ itemId: '666576', name: '不倒翁韩国进口小麦面条1.5kg', stockQuantity: 10, priceCents: 3700 }),
    ]);
  });
});
