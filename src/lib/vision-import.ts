import type { ImportIssue, Product } from '../types';
import { recognizeImage } from './server-api';

export type PhotoImportSource = {
  fileIndex: number;
  sourceImage: string;
  sourceLabel: string;
};

export type PhotoTableParseResult = {
  products: Product[];
  issues: ImportIssue[];
};

export type VisionParseMeta = {
  finishReason?: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[￥¥,，\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}

function removeCodeFence(value: string): string {
  const closed = value.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (closed?.[1]?.trim()) return closed[1].trim();
  // 输出被截断时代码块往往没有右围栏。
  const open = value.trim().match(/```(?:json)?\s*([\s\S]*)$/i);
  if (open?.[1]?.trim()) return open[1].trim();
  return value.trim();
}

function rowName(row: JsonRecord): string | undefined {
  return asString(row.name ?? row.productName ?? row.product_name);
}

function rowPrice(row: JsonRecord): number | undefined {
  return asNumber(row.price ?? row.retailPrice ?? row.retail_price ?? row.priceYuan ?? row.price_yuan);
}

function isProductRow(value: unknown): value is JsonRecord {
  return isRecord(value) && rowName(value) !== undefined && rowPrice(value) !== undefined;
}

type JsonSpan = { text: string; top: boolean };

/**
 * 单次线性扫描，把文本中所有闭合的 {...} / [...] 片段括出来。
 * top=true 表示该片段不在另一个片段内。未闭合的尾部不会进入结果，
 * 但其内部已经写完的对象仍会被收集，这就是截断抢救的依据。
 */
function jsonSpans(value: string): JsonSpan[] {
  const spans: JsonSpan[] = [];
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(index);
    else if (char === '}' || char === ']') {
      const open = stack.pop();
      if (open === undefined) continue;
      spans.push({ text: value.slice(open, index + 1), top: stack.length === 0 });
    }
  }
  return spans;
}

type ExtractedRows = {
  rows: unknown[];
  parsed: boolean;
  salvaged: boolean;
};

/**
 * 不要求模型输出严格 JSON：先试完整的顶层对象，多个时取商品行最多的那个
 * （模型有时会先复述一遍提示词里的格式示例）；顶层被截断时，退而把已写完的
 * 单个商品对象逐个捞回来。
 */
function extractRows(content: string): ExtractedRows {
  const body = removeCodeFence(content ?? '');
  let best: unknown[] = [];
  let salvaged: JsonRecord[] = [];
  let parsed = false;

  for (const span of jsonSpans(body)) {
    let payload: unknown;
    try {
      payload = JSON.parse(span.text);
    } catch {
      continue;
    }
    parsed = true;
    if (span.top) {
      const rows = productRows(payload);
      if (rows.length >= best.length) best = rows;
    } else if (isProductRow(payload)) {
      salvaged.push(payload);
    }
  }

  if (best.length) return { rows: best, parsed, salvaged: false };
  if (salvaged.length) return { rows: salvaged, parsed, salvaged: true };
  return { rows: [], parsed, salvaged: false };
}

function rawSample(content: string, limit = 200): string {
  const flat = (content ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function productRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.products)) return payload.products;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片'));
    reader.readAsDataURL(file);
  });
}

async function imageForVision(file: File): Promise<string> {
  if (!('createImageBitmap' in window)) return readFileAsDataUrl(file);

  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= 2560) {
      bitmap.close();
      return readFileAsDataUrl(file);
    }

    const scale = 2560 / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法准备图片');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compressed = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法压缩图片')), 'image/jpeg', 0.9);
    });
    return readFileAsDataUrl(compressed);
  } catch {
    return readFileAsDataUrl(file);
  }
}

export function parseVisionTable(content: string, source: PhotoImportSource, meta: VisionParseMeta = {}): PhotoTableParseResult {
  const { rows, parsed, salvaged } = extractRows(content);
  const issues: ImportIssue[] = [];

  if (!rows.length && !parsed) {
    const sample = rawSample(content);
    console.warn('[vision] 模型返回无法解析为 JSON，原始输出如下：', { source: source.sourceImage, finishReason: meta.finishReason, content });
    issues.push({
      severity: 'warning',
      message: `${source.sourceImage} 的大模型返回不是有效 JSON${meta.finishReason ? `（finish_reason=${meta.finishReason}）` : ''}。实际返回：${sample || '(空)'}`,
    });
    return { products: [], issues };
  }

  const products: Product[] = [];
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      issues.push({ severity: 'warning', row: index + 1, message: '模型返回了无法识别的商品行，已跳过' });
      return;
    }
    const name = rowName(row);
    const price = rowPrice(row);
    if (!name || price === undefined) {
      issues.push({ severity: 'warning', row: index + 1, message: '模型未返回完整商品名称或价格，已跳过' });
      return;
    }
    const quantity = asNumber(row.quantity ?? row.stockQuantity ?? row.stock_quantity);
    products.push({
      id: `vision-${source.fileIndex}-${String(index + 1).padStart(3, '0')}`,
      itemId: asString(row.itemId ?? row.item_id),
      name,
      priceCents: Math.round(price * 100),
      stockQuantity: quantity,
      active: true,
      sourceLabel: source.sourceLabel,
      sourceImage: source.sourceImage,
      sourceRow: index + 1,
    });
  });

  if (meta.finishReason === 'length') {
    issues.push({
      severity: 'warning',
      message: `${source.sourceImage} 的模型输出被 max_tokens 截断，已恢复 ${products.length} 行。请调大服务端 SUB2API_MAX_TOKENS，或把价格表分成几张拍摄。`,
    });
  } else if (salvaged) {
    issues.push({
      severity: 'warning',
      message: `${source.sourceImage} 的模型返回不是严格 JSON，已自动抢救出 ${products.length} 个完整商品行，请逐行核对。`,
    });
  }

  if (!products.length && !issues.length) {
    issues.push({ severity: 'warning', message: `${source.sourceImage} 未解析到完整商品行，请检查图片和模型输出` });
  }
  return { products, issues };
}

export async function recognizePhotoWithServer(file: File, source: PhotoImportSource, model?: string): Promise<PhotoTableParseResult> {
  const imageUrl = await imageForVision(file);
  const recognition = await recognizeImage(imageUrl, model);
  return parseVisionTable(recognition.content, source, { finishReason: recognition.finishReason });
}
