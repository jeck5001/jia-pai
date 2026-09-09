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
const DEFAULT_SUB2API_TIMEOUT_MS = 180_000;
const DEFAULT_SUB2API_MAX_TOKENS = 16_000;
const MAX_SUB2API_MAX_TOKENS = 128_000;
const MODEL_LIST_TIMEOUT_MS = 15_000;

const EXTRACTION_PROMPT = `你是小卖部价格表的结构化识别器。请读取图片中完整可见的价格表，识别每个商品行的 Item ID、商品名称、数量和零售价。

响应的第一个字符必须是 {，最后一个字符必须是 }。不要输出 Markdown 代码块、前言、结语或任何解释文字。
格式必须是：
{"products":[{"itemId":"981102169","name":"商品名称","quantity":10,"price":45}],"notes":[]}

规则：price 是人民币元数值，不要货币符号；Item ID 只保留原始数字；无法确认的字段用 null；不要虚构商品；忽略表头、页边残留和无关手写备注。若印刷价格被手写修改，以清楚可见的最新价格为准，并把不确定处写入 notes。
商品行很多时也必须保持 JSON 结构完整，宁可少输出几行，也不要输出被截断的半个对象。`;

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

function readTimeoutMs(value) {
  const timeoutMs = Number(value);
  return Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 ? timeoutMs : DEFAULT_SUB2API_TIMEOUT_MS;
}

function readMaxTokens(value) {
  const maxTokens = Number(value);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1_024) return DEFAULT_SUB2API_MAX_TOKENS;
  return Math.min(maxTokens, MAX_SUB2API_MAX_TOKENS);
}

function readConfig(overrides = {}) {
  return {
    adminToken: overrides.adminToken ?? process.env.ADMIN_TOKEN?.trim() ?? '',
    dataDir: overrides.dataDir ?? process.env.DATA_DIR ?? join(PROJECT_DIR, 'data'),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    sub2ApiBaseUrl: overrides.sub2ApiBaseUrl ?? process.env.SUB2API_BASE_URL?.trim() ?? 'http://192.168.5.35:8084/',
    sub2ApiKey: overrides.sub2ApiKey ?? process.env.SUB2API_API_KEY?.trim() ?? '',
    sub2ApiModel: overrides.sub2ApiModel ?? process.env.SUB2API_MODEL?.trim() ?? 'gpt-5.5',
    sub2ApiMaxTokens: readMaxTokens(overrides.sub2ApiMaxTokens ?? process.env.SUB2API_MAX_TOKENS),
    sub2ApiTimeoutMs: readTimeoutMs(overrides.sub2ApiTimeoutMs ?? process.env.SUB2API_TIMEOUT_MS),
    webRoot: overrides.webRoot ?? process.env.WEB_ROOT ?? DEFAULT_WEB_ROOT,
  };
}

function completionUrl(baseUrl) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) throw new HttpError(503, '服务端 Sub2API 地址配置无效');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}${/\/v1$/i.test(normalized) ? '' : '/v1'}/chat/completions`;
}

function modelsUrl(baseUrl) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) throw new HttpError(503, '服务端 Sub2API 地址配置无效');
  return `${normalized}${/\/v1$/i.test(normalized) ? '' : '/v1'}/models`;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function serviceOrigin(endpoint) {
  return new URL(endpoint).origin;
}

function networkFailureDetails(error) {
  const cause = error && typeof error === 'object' ? error.cause : undefined;
  return {
    code: asString(cause?.code) ?? asString(error?.code),
    type: asString(cause?.name) ?? asString(error?.name) ?? 'UnknownError',
  };
}

function networkFailureMessage(details) {
  if (details.code === 'ECONNREFUSED') return '无法连接 Sub2API 服务（ECONNREFUSED，连接被拒绝）。请检查 NAS 到服务地址的端口和路由。';
  if (details.code === 'ENOTFOUND') return '无法连接 Sub2API 服务（ENOTFOUND，地址无法解析）。请检查服务地址。';
  if (details.code === 'ETIMEDOUT' || details.code === 'UND_ERR_CONNECT_TIMEOUT' || details.type === 'TimeoutError') {
    return '连接 Sub2API 服务超时。请检查 NAS 到服务地址的网络连通性。';
  }
  return '无法连接 Sub2API 服务。请查看 NAS 容器日志中的 [vision] 记录。';
}

function visionResponse(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
    throw new HttpError(502, 'Sub2API 返回格式不符合 OpenAI 兼容协议');
  }
  const choice = payload.choices[0];
  const finishReason = asString(choice.finish_reason) ?? asString(choice.finishReason) ?? '';
  const message = choice.message;
  if (!isRecord(message)) throw new HttpError(502, 'Sub2API 未返回识别内容');
  let text = '';
  if (typeof message.content === 'string') text = message.content.trim();
  else if (Array.isArray(message.content)) {
    text = message.content
      .filter(isRecord)
      .map((part) => (typeof part.text === 'string' ? part.text : typeof part.content === 'string' ? part.content : ''))
      .join('\n')
      .trim();
  }
  if (!text) text = asString(message.reasoning_content) ?? asString(message.reasoning) ?? '';
  if (!text) {
    throw new HttpError(
      502,
      finishReason
        ? `Sub2API 未返回可解析的识别内容（finish_reason=${finishReason}）。若为 length/content_filter，请调大 SUB2API_MAX_TOKENS 或换模型。`
        : 'Sub2API 未返回可解析的识别内容',
    );
  }
  return { content: text, finishReason };
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

const VISION_MODEL_PATTERN = /^[A-Za-z0-9._:@+/-]{1,128}$/;

function resolveVisionModel(requestedModel, config) {
  if (requestedModel === undefined || requestedModel === '') return config.sub2ApiModel;
  if (typeof requestedModel !== 'string' || !VISION_MODEL_PATTERN.test(requestedModel.trim())) {
    throw new HttpError(400, '识别模型名称不合法，请重新获取模型列表后选择');
  }
  return requestedModel.trim();
}

function parseModelIds(payload) {
  if (!isRecord(payload)) return [];
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  return [...new Set(rows
    .map((row) => (typeof row === 'string' ? row : isRecord(row) && typeof row.id === 'string' ? row.id : ''))
    .map((id) => id.trim())
    .filter(Boolean))];
}

async function fetchSub2ApiModels(config) {
  if (!config.sub2ApiKey) throw new HttpError(503, '服务端未配置 SUB2API_API_KEY');

  const endpoint = modelsUrl(config.sub2ApiBaseUrl);
  let upstream;
  try {
    upstream = await config.fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${config.sub2ApiKey}` },
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
  } catch (error) {
    const details = networkFailureDetails(error);
    console.error('[vision] Sub2API model list fetch failed', {
      endpoint: serviceOrigin(endpoint),
      errorCode: details.code ?? 'UNKNOWN',
      errorType: details.type,
      timeoutMs: MODEL_LIST_TIMEOUT_MS,
    });
    throw new HttpError(502, networkFailureMessage(details));
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const message = isRecord(payload) && isRecord(payload.error) ? asString(payload.error.message) : undefined;
    console.warn('[vision] Sub2API model list returned an error response', {
      endpoint: serviceOrigin(endpoint),
      status: upstream.status,
    });
    throw new HttpError(502, message ? `获取模型列表失败：${message}` : `获取模型列表失败（HTTP ${upstream.status}）`);
  }

  const models = parseModelIds(payload);
  if (!models.length) throw new HttpError(502, 'Sub2API 未返回可用模型，请检查服务状态');
  return [config.sub2ApiModel, ...models.filter((model) => model !== config.sub2ApiModel)];
}

async function recognizeWithSub2Api(imageUrl, model, config) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) {
    throw new HttpError(400, '请上传有效的图片');
  }
  if (!config.sub2ApiKey) throw new HttpError(503, '服务端未配置 SUB2API_API_KEY');

  const endpoint = completionUrl(config.sub2ApiBaseUrl);
  let upstream;
  try {
    upstream = await config.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sub2ApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: config.sub2ApiMaxTokens,
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
      signal: AbortSignal.timeout(config.sub2ApiTimeoutMs),
    });
  } catch (error) {
    const details = networkFailureDetails(error);
    console.error('[vision] Sub2API connection failed', {
      endpoint: serviceOrigin(endpoint),
      errorCode: details.code ?? 'UNKNOWN',
      errorType: details.type,
      timeoutMs: config.sub2ApiTimeoutMs,
    });
    throw new HttpError(502, networkFailureMessage(details));
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const message = isRecord(payload) && isRecord(payload.error) ? asString(payload.error.message) : undefined;
    console.warn('[vision] Sub2API returned an error response', {
      endpoint: serviceOrigin(endpoint),
      status: upstream.status,
    });
    throw new HttpError(502, message ? `Sub2API 请求失败：${message}` : `Sub2API 请求失败（HTTP ${upstream.status}）`);
  }
  return visionResponse(payload);
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
      if (request.method === 'GET' && url.pathname === '/api/vision/models') {
        writeJson(response, 200, { models: await fetchSub2ApiModels(config), default: config.sub2ApiModel });
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
        const model = resolveVisionModel(body.model, config);
        const result = await recognizeWithSub2Api(body.imageUrl, model, config);
        if (result.finishReason === 'length') {
          console.warn('[vision] model output truncated by max_tokens', { model, maxTokens: config.sub2ApiMaxTokens });
        }
        writeJson(response, 200, { content: result.content, finishReason: result.finishReason || null });
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
