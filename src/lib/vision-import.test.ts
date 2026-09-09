import { describe, expect, it } from 'vitest';
import { parseVisionTable } from './vision-import';

const source = { fileIndex: 1, sourceImage: '价格表.jpg', sourceLabel: '大模型导入：价格表.jpg' };

describe('Sub2API 图片识别', () => {
  it('把模型 JSON 转为可校对的商品候选', () => {
    const result = parseVisionTable('```json\n{"products":[{"itemId":"981102169","name":"MM酸汤风味料理500g","quantity":10,"price":45},{"item_id":"666576","product_name":"不倒翁韩国进口小麦面条1.5kg","stock_quantity":"10","retail_price":"37"}]}\n```', source);

    expect(result.issues).toEqual([]);
    expect(result.products).toEqual([
      expect.objectContaining({ itemId: '981102169', name: 'MM酸汤风味料理500g', stockQuantity: 10, priceCents: 4500 }),
      expect.objectContaining({ itemId: '666576', name: '不倒翁韩国进口小麦面条1.5kg', stockQuantity: 10, priceCents: 3700 }),
    ]);
  });

  it('忽略 Claude 在 JSON 前后附加的说明文字和围栏', () => {
    const content = [
      '以下是我识别到的价格表：',
      '```json',
      '{"products":[{"itemId":"1001","name":"农心碗面 86g","quantity":24,"price":6.5}],"notes":[]}',
      '```',
      '如需补充请再发一张照片。',
    ].join('\n');

    const result = parseVisionTable(content, source);

    expect(result.issues).toEqual([]);
    expect(result.products).toEqual([expect.objectContaining({ name: '农心碗面 86g', priceCents: 650 })]);
  });

  it('输出被截断时抢救出完整的商品行并提示核对', () => {
    const content = '{"products":[{"name":"三养火鸡面 140g","price":7},{"name":"好丽友派 12枚","price":26},{"name":"不完整';

    const result = parseVisionTable(content, source, { finishReason: 'length' });

    expect(result.products.map((product) => product.name)).toEqual(['三养火鸡面 140g', '好丽友派 12枚']);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('max_tokens 截断');
  });

  it('JSON 不合法且无法抢救时给出原始返回内容', () => {
    const result = parseVisionTable('抱歉，我无法识别这张图片。', source);

    expect(result.products).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('我无法识别这张图片');
  });
});
