import { Capacitor } from '@capacitor/core';
import { normalizeNasServerUrl, resolveApiUrl } from './app-config';
import type { Catalog } from '../types';

type ErrorPayload = {
  error?: {
    message?: unknown;
  };
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload: ErrorPayload | null = await response.json().catch(() => null);
  const message = payload?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function apiUrl(path: string): string {
  return resolveApiUrl(path, {
    isNativePlatform: Capacitor.isNativePlatform(),
    storage: window.localStorage,
  });
}

export async function verifyNasServer(value: string): Promise<string> {
  const nasServerUrl = normalizeNasServerUrl(value);
  let response: Response;
  try {
    response = await fetch(`${nasServerUrl}/api/health`, { cache: 'no-store' });
  } catch {
    throw new Error('无法连接 NAS 服务，请检查地址、内网连接和端口。');
  }
  if (!response.ok) throw new Error(`NAS 服务健康检查失败（HTTP ${response.status}）`);
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || (payload as { status?: unknown }).status !== 'ok') {
    throw new Error('NAS 服务未返回有效的健康检查结果');
  }
  return nasServerUrl;
}

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(apiUrl('/api/catalog'), { cache: 'no-store' });
  if (!response.ok) throw new Error(await readError(response, '价格表请求失败'));
  return response.json() as Promise<Catalog>;
}

export async function publishCatalog(catalog: Catalog, adminToken: string): Promise<Catalog> {
  const response = await fetch(apiUrl('/api/catalog'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
    body: JSON.stringify(catalog),
  });
  if (!response.ok) throw new Error(await readError(response, '价格表发布失败'));
  return response.json() as Promise<Catalog>;
}

export async function recognizeImage(imageUrl: string): Promise<string> {
  const response = await fetch(apiUrl('/api/vision/recognize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) throw new Error(await readError(response, '图片识别失败'));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || typeof (payload as { content?: unknown }).content !== 'string') {
    throw new Error('服务端未返回可解析的识别内容');
  }
  return (payload as { content: string }).content;
}
