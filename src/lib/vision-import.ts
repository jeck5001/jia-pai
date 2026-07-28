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
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match?.[1] ?? value).trim();
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

export function parseVisionTable(content: string, source: PhotoImportSource): PhotoTableParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(removeCodeFence(content));
  } catch {
    return { products: [], issues: [{ severity: 'warning', message: `${source.sourceImage} 的大模型返回不是有效 JSON` }] };
  }

  const products: Product[] = [];
  const issues: ImportIssue[] = [];
  productRows(payload).forEach((row, index) => {
    if (!isRecord(row)) {
      issues.push({ severity: 'warning', row: index + 1, message: '模型返回了无法识别的商品行，已跳过' });
      return;
    }
    const name = asString(row.name ?? row.productName ?? row.product_name);
    const price = asNumber(row.price ?? row.retailPrice ?? row.retail_price ?? row.priceYuan ?? row.price_yuan);
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

  if (!products.length && !issues.length) {
    issues.push({ severity: 'warning', message: `${source.sourceImage} 未解析到完整商品行，请检查图片和模型输出` });
  }
  return { products, issues };
}

export async function recognizePhotoWithServer(file: File, source: PhotoImportSource): Promise<PhotoTableParseResult> {
  const imageUrl = await imageForVision(file);
  return parseVisionTable(await recognizeImage(imageUrl), source);
}
