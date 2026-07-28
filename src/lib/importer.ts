import { readSheet } from 'read-excel-file/browser';
import { normalizeText, parsePriceToCents, stripDraftMetadata, uniqueProducts, validateProducts } from './catalog';
import type { Catalog, ImportIssue, ImportResult, Product } from '../types';

type ColumnName = 'itemId' | 'name' | 'specification' | 'priceCents' | 'quantity' | 'barcodes' | 'aliases' | 'active';
type ColumnMap = Partial<Record<ColumnName, number>>;

const HEADER_ALIASES: Record<ColumnName, string[]> = {
  itemId: ['商品itemid', 'itemid', '商品id', '商品编号', '货号', '编码'],
  name: ['商品名称', '名称', '品名', '存货名称'],
  specification: ['规格', '商品规格', '存货规格'],
  priceCents: ['零售价', '销售价', '销价', '售价', '零售单价'],
  quantity: ['数量', '库存数量', '存货数量'],
  barcodes: ['条码', '商品条码', 'barcode'],
  aliases: ['别名', '搜索别名', '关键词'],
  active: ['状态', '是否上架', 'active'],
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^\uFEFF/, '').trim();
}

function splitList(value: unknown): string[] {
  return cellText(value)
    .split(/[，,;；\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseActive(value: unknown): boolean {
  const normalized = normalizeText(cellText(value));
  return !['下架', '禁用', '否', 'false', '0'].includes(normalized);
}

function findColumnMap(row: unknown[]): ColumnMap {
  const normalizedHeaders = row.map((value) => normalizeText(cellText(value)));
  const result: ColumnMap = {};

  (Object.keys(HEADER_ALIASES) as ColumnName[]).forEach((field) => {
    const index = normalizedHeaders.findIndex((header) => HEADER_ALIASES[field].includes(header));
    if (index >= 0) result[field] = index;
  });

  return result;
}

function findHeader(rows: unknown[][]): { rowIndex: number; map: ColumnMap } | null {
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const map = findColumnMap(rows[index]);
    if (map.name !== undefined || map.priceCents !== undefined) {
      return { rowIndex: index, map };
    }
  }
  return null;
}

function valueAt(row: unknown[], index: number | undefined): unknown {
  return index === undefined ? '' : row[index];
}

function makeId(itemId: string, name: string, specification: string, row: number): string {
  const prefix = itemId || `${normalizeText(name)}-${normalizeText(specification)}` || `row-${row}`;
  return prefix.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-').slice(0, 80);
}

export type ImportOptions = {
  sourceLabel: string;
  effectiveAt: string;
  version?: string;
};

export function importRows(rows: unknown[][], options: ImportOptions): ImportResult {
  const header = findHeader(rows);
  const catalog: Catalog = {
    version: options.version ?? `draft-${Date.now()}`,
    effectiveAt: options.effectiveAt,
    sourceLabel: options.sourceLabel || '本地导入价格表',
    products: [],
  };
  const issues: ImportIssue[] = [];

  if (!header) {
    return {
      catalog,
      issues: [{ severity: 'error', message: '未找到表头，请包含“商品名称”和“零售价/销售价/销价”列' }],
    };
  }
  if (header.map.name === undefined) {
    issues.push({ severity: 'error', row: header.rowIndex + 1, message: '缺少必须列：商品名称' });
  }
  if (header.map.priceCents === undefined) {
    issues.push({ severity: 'error', row: header.rowIndex + 1, message: '缺少必须列：零售价、销售价或销价' });
  }
  if (issues.some((issue) => issue.severity === 'error')) {
    return { catalog, issues, headerRow: header.rowIndex + 1 };
  }

  rows.slice(header.rowIndex + 1).forEach((row, index) => {
    const sourceRow = header.rowIndex + index + 2;
    const values = row.map(cellText);
    if (values.every((value) => !value)) return;

    const name = cellText(valueAt(row, header.map.name));
    const priceCents = parsePriceToCents(valueAt(row, header.map.priceCents));
    if (!name) {
      issues.push({ severity: 'error', row: sourceRow, message: '商品名称不能为空' });
      return;
    }
    if (priceCents === null) {
      issues.push({ severity: 'error', row: sourceRow, message: '零售价不是合法金额' });
      return;
    }

    const itemId = cellText(valueAt(row, header.map.itemId));
    const specification = cellText(valueAt(row, header.map.specification));
    const quantityText = cellText(valueAt(row, header.map.quantity));
    const quantity = quantityText ? Number(quantityText) : null;
    if (typeof quantity === 'number' && (!Number.isFinite(quantity) || quantity < 0)) {
      issues.push({ severity: 'warning', row: sourceRow, message: '数量无法识别，已忽略' });
    }

    catalog.products.push({
      id: makeId(itemId, name, specification, sourceRow),
      itemId: itemId || undefined,
      name,
      specification: specification || undefined,
      priceCents,
      barcodes: splitList(valueAt(row, header.map.barcodes)),
      aliases: splitList(valueAt(row, header.map.aliases)),
      active: parseActive(valueAt(row, header.map.active)),
      stockQuantity: typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined,
      sourceRow,
    });
  });

  if (catalog.products.length === 0 && !issues.some((issue) => issue.severity === 'error')) {
    issues.push({ severity: 'error', message: '未读取到可导入的商品行' });
  }

  issues.push(...validateProducts(catalog.products));
  return { catalog, issues, headerRow: header.rowIndex + 1 };
}

export function removeExactDuplicates(products: Product[]): Product[] {
  return uniqueProducts(products);
}

export function createPublishedCatalog(sourceLabel: string, effectiveAt: string, products: Product[]): Catalog {
  return stripDraftMetadata({
    version: `published-${effectiveAt.replace(/[-:T]/g, '').slice(0, 12)}`,
    effectiveAt: new Date(effectiveAt).toISOString(),
    sourceLabel: sourceLabel.trim() || '本地导入价格表',
    products: removeExactDuplicates(products),
  });
}

export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  const isCsv = file.name.toLocaleLowerCase('zh-CN').endsWith('.csv');
  if (isCsv) return parseCsvRows(await file.text());
  return readSheet(file);
}

export function parseCsvRows(input: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
