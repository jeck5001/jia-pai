import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PROJECT_DIR = resolve(SERVER_DIR, '..');
const DEFAULT_WEB_ROOT = join(PROJECT_DIR, 'dist');
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_VISION_BYTES = 15 * 1024 * 1024;

const EXTRACTION_PROMPT = `你是小卖部价格表的结构化识别器。请读取图片中完整可见的价格表，识别每个商品行的 Item ID、商品名称、数量和零售价。

严格只返回 JSON，不要 Markdown、解释或代码块。格式必须是：
{"products":[{"itemId":"981102169","name":"商品名称","quantity":10,"price":45}],"notes":[]}

规则：price 是人民币元数值，不要货币符号；Item ID 只保留原始数字；无法确认的字段用 null；不要虚构商品；忽略表头、页边残留和无关手写备注。若印刷价格被手写修改，以清楚可见的最新价格为准，并把不确定处写入 notes。`;

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readConfig(overrides = {}) {
  return {
    adminToken: overrides.adminToken ?? process.env.ADMIN_TOKEN?.trim() ?? '',
    dataDir: overrides.dataDir ?? process.env.DATA_DIR ?? join(PROJECT_DIR, 'data'),
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    sub2ApiBaseUrl: overrides.sub2ApiBaseUrl ?? process.env.SUB2API_BASE_URL?.trim() ?? 'http://192.168.5.35:8084/',
    sub2ApiKey: overrides.sub2ApiKey ?? process.env.SUB2API_API_KEY?.trim() ?? '',
    sub2ApiModel: overrides.sub2ApiModel ?? process.env.SUB2API_MODEL?.trim() ?? 'gpt-5.5',
    webRoot: overrides.webRoot ?? process.env.WEB_ROOT ?? DEFAULT_WEB_ROOT,
  };
}

function completionUrl(baseUrl) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) throw new HttpError(503, '服务端 Sub2API 地址配置无效');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}${/\/v1$/i.test(normalized) ? '' : '/v1'}/chat/completions`;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function visionResponseText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
    throw new HttpError(502, 'Sub2API 返回格式不符合 OpenAI 兼容协议');
  }
  const message = payload.choices[0].message;
  if (!isRecord(message)) throw new HttpError(502, 'Sub2API 未返回识别内容');
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter(isRecord)
      .map((part) => typeof part.text === 'string' ? part.text : '')
      .join('\n')
      .trim();
    if (text) return text;
  }
  throw new HttpError(502, 'Sub2API 未返回可解析的识别内容');
}

function catalogIsValid(value) {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.sourceLabel !== 'string' || !Array.isArray(value.products)) return false;
  if (value.effectiveAt !== null && typeof value.effectiveAt !== 'string') return false;
  return value.products.every((product) => (
    isRecord(product)
    && typeof product.id === 'string'
    && typeof product.name === 'string'
    && typeof product.active === 'boolean'
    && Number.isInteger(product.priceCents)
    && product.priceCents >= 0
  ));
}

function emptyCatalog() {
  return {
    version: 'empty',
    effectiveAt: null,
    sourceLabel: '尚未导入价格表',
    products: [],
  };
}

async function readJsonBody(request, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) throw new HttpError(400, '请求内容不能为空');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求不是有效 JSON');
  }
}

function writeJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function writeError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : '服务器内部错误';
  if (!(error instanceof HttpError)) console.error(error);
  writeJson(response, status, { error: { message } });
}

function hasAdminAccess(request, adminToken) {
  if (!adminToken) return true;
  const supplied = request.headers['x-admin-token'];
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(adminToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function pathInside(root, requestPath) {
  const safeRelativePath = normalize(requestPath.replace(/^\/+/, ''));
  const candidate = resolve(root, safeRelativePath || 'index.html');
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function staticHeaders(filePath) {
  const extension = extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  };
  if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
  else if (filePath.includes(`${sep}assets${sep}`)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  return headers;
}

async function serveStatic(response, webRoot, pathname) {
  const root = resolve(webRoot);
  let filePath = pathInside(root, pathname);
  if (!filePath) throw new HttpError(403, '无权访问该资源');

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    if (extname(pathname)) throw new HttpError(404, '资源不存在');
    filePath = join(root, 'index.html');
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, staticHeaders(filePath));
    response.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(503, '前端构建文件不存在，请先执行 npm run build');
    throw error;
  }
}

async function createCatalogStore(config) {
  const catalogPath = join(resolve(config.dataDir), 'products.json');
  await mkdir(resolve(config.dataDir), { recursive: true });
  try {
    await stat(catalogPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(catalogPath, `${JSON.stringify(emptyCatalog(), null, 2)}\n`, 'utf8');
  }

  return {
    async read() {
      const content = await readFile(catalogPath, 'utf8');
      let catalog;
      try {
        catalog = JSON.parse(content);
      } catch {
        throw new HttpError(500, '保存的价格表不是有效 JSON');
      }
      if (!catalogIsValid(catalog)) throw new HttpError(500, '保存的价格表格式不正确');
      return catalog;
    },
    async write(catalog) {
      if (!catalogIsValid(catalog)) throw new HttpError(400, '价格表格式不正确');
      const temporaryPath = `${catalogPath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, catalogPath);
      return catalog;
    },
  };
}

async function recognizeWithSub2Api(imageUrl, config) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) {
    throw new HttpError(400, '请上传有效的图片');
  }
  if (!config.sub2ApiKey) throw new HttpError(503, '服务端未配置 SUB2API_API_KEY');

  let upstream;
  try {
    upstream = await fetch(completionUrl(config.sub2ApiBaseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sub2ApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.sub2ApiModel,
        temperature: 0,
        messages: [
          { role: 'system', content: '你只输出用户要求的 JSON。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new HttpError(502, '无法连接 Sub2API 服务');
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const message = isRecord(payload) && isRecord(payload.error) ? asString(payload.error.message) : undefined;
    throw new HttpError(502, message ? `Sub2API 请求失败：${message}` : `Sub2API 请求失败（HTTP ${upstream.status}）`);
  }
  return visionResponseText(payload);
}

export async function createApp(overrides = {}) {
  const config = readConfig(overrides);
  const catalogStore = await createCatalogStore(config);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        writeJson(response, 200, { status: 'ok', visionConfigured: Boolean(config.sub2ApiKey) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        writeJson(response, 200, await catalogStore.read());
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/api/catalog') {
        if (!hasAdminAccess(request, config.adminToken)) throw new HttpError(401, '管理员口令不正确');
        writeJson(response, 200, await catalogStore.write(await readJsonBody(request, MAX_CATALOG_BYTES)));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/vision/recognize') {
        const body = await readJsonBody(request, MAX_VISION_BYTES);
        writeJson(response, 200, { content: await recognizeWithSub2Api(body.imageUrl, config) });
        return;
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (request.method === 'HEAD') {
          response.writeHead(405, { Allow: 'GET, POST, PUT' });
          response.end();
          return;
        }
        await serveStatic(response, config.webRoot, url.pathname);
        return;
      }
      response.writeHead(405, { Allow: 'GET, POST, PUT' });
      response.end();
    } catch (error) {
      writeError(response, error);
    }
  });

  return { config, server };
}
