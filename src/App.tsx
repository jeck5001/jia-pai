import { Capacitor } from '@capacitor/core';
import { Barcode, FileUp, History, PackageSearch, RefreshCw, Search, Settings, ShoppingBasket } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { readNasServerUrl, saveNasServerUrl } from './lib/app-config';
import { formatPrice, isPublishedCatalog, searchProducts } from './lib/catalog';
import { fetchCatalog, verifyNasServer } from './lib/server-api';
import type { Catalog, Product } from './types';

const ImportWorkspace = lazy(() => import('./components/ImportWorkspace').then((module) => ({ default: module.ImportWorkspace })));
const PhotoImportWorkspace = lazy(() => import('./components/PhotoImportWorkspace').then((module) => ({ default: module.PhotoImportWorkspace })));
const ProductManagementWorkspace = lazy(() => import('./components/ProductManagementWorkspace').then((module) => ({ default: module.ProductManagementWorkspace })));
const ScannerDialog = lazy(() => import('./components/ScannerDialog').then((module) => ({ default: module.ScannerDialog })));

type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: Catalog };

const RECENT_QUERIES_KEY = 'xiaomaibu-recent-queries';

function displayDate(value: string | null): string {
  if (!value) return '表格日期未标注';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未标注';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function readRecentQueries(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecentQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return readRecentQueries();
  const next = [trimmed, ...readRecentQueries().filter((value) => value !== trimmed)].slice(0, 6);
  localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next));
  return next;
}

function ProductResult({ product, onSelect }: { product: Product; onSelect: () => void }) {
  const details = [
    product.specification,
    product.itemId ? `ID ${product.itemId}` : null,
    product.sourceLabel ? `来源 ${product.sourceLabel}` : null,
    product.stockQuantity !== undefined ? `表中数量 ${product.stockQuantity}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <button className="product-result" type="button" onClick={onSelect}>
      <div className="product-copy">
        <strong>{product.name}</strong>
        <span>{details || '规格未标注'}</span>
      </div>
      <span className="product-price">{formatPrice(product.priceCents)}</span>
    </button>
  );
}

export default function App() {
  const isNativePlatform = Capacitor.isNativePlatform();
  const [view, setView] = useState<'lookup' | 'import' | 'photo-import' | 'manage'>('lookup');
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>(readRecentQueries);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerNotice, setScannerNotice] = useState('');
  const [nasServerUrl, setNasServerUrl] = useState(() => readNasServerUrl(isNativePlatform, window.localStorage));
  const [nasServerInput, setNasServerInput] = useState(() => nasServerUrl ?? '');
  const [nasSettingsOpen, setNasSettingsOpen] = useState(() => isNativePlatform && !nasServerUrl);
  const [nasConnectionStatus, setNasConnectionStatus] = useState('');
  const [nasConnectionError, setNasConnectionError] = useState('');
  const [isCheckingNasConnection, setIsCheckingNasConnection] = useState(false);

  useEffect(() => {
    if (isNativePlatform && !nasServerUrl) return;
    let cancelled = false;
    async function loadCatalog() {
      try {
        const data: unknown = await fetchCatalog();
        if (!isPublishedCatalog(data)) throw new Error('价格表格式不正确');
        if (!cancelled) setCatalogState({ status: 'ready', catalog: data });
      } catch {
        if (!cancelled) setCatalogState({ status: 'error' });
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [isNativePlatform, nasServerUrl]);

  const catalog = catalogState.status === 'ready' ? catalogState.catalog : null;

  function openNasSettings() {
    setNasServerInput(nasServerUrl ?? '');
    setNasConnectionStatus('');
    setNasConnectionError('');
    setNasSettingsOpen(true);
  }

  async function testAndSaveNasServer() {
    setIsCheckingNasConnection(true);
    setNasConnectionStatus('');
    setNasConnectionError('');
    try {
      const verifiedUrl = await verifyNasServer(nasServerInput);
      const savedUrl = saveNasServerUrl(verifiedUrl, isNativePlatform, window.localStorage);
      setNasServerUrl(savedUrl);
      setNasServerInput(savedUrl);
      setCatalogState({ status: 'loading' });
      setNasConnectionStatus('连接成功，正在读取价格表。');
      setNasSettingsOpen(false);
    } catch (error) {
      setNasConnectionError(error instanceof Error ? error.message : '无法连接 NAS 服务，请稍后重试。');
    } finally {
      setIsCheckingNasConnection(false);
    }
  }

  if (isNativePlatform && (!nasServerUrl || nasSettingsOpen)) {
    return (
      <main className="app-shell nas-config-shell">
        <header className="app-header">
          <div className="brand-lockup">
            <span className="brand-mark">价</span>
            <div><strong>小卖部查价</strong><span>Android 应用</span></div>
          </div>
        </header>
        <section className="nas-config-panel" aria-labelledby="nas-config-title">
          <span className="eyebrow">首次连接</span>
          <h1 id="nas-config-title">连接 NAS</h1>
          <p>输入小卖部查价服务的内网地址。连接成功后，商品、照片和管理员数据都只会与这台 NAS 通信。</p>
          <label className="nas-config-field">
            <span>NAS 服务地址</span>
            <input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={isCheckingNasConnection}
              inputMode="url"
              onChange={(event) => setNasServerInput(event.target.value)}
              placeholder="http://192.168.1.10:3000"
              value={nasServerInput}
            />
          </label>
          <p className="nas-config-note">支持 HTTP 或 HTTPS。HTTP 仅适用于公司可信内网。</p>
          {nasConnectionError ? <p className="nas-config-error" role="alert">{nasConnectionError}</p> : null}
          {nasConnectionStatus ? <p className="success-notice" role="status">{nasConnectionStatus}</p> : null}
          <div className="nas-config-actions">
            {nasServerUrl ? <button className="text-button" type="button" onClick={() => setNasSettingsOpen(false)} disabled={isCheckingNasConnection}>取消</button> : null}
            <button className="primary-button" type="button" onClick={() => void testAndSaveNasServer()} disabled={isCheckingNasConnection}>
              {isCheckingNasConnection ? <RefreshCw className="spin" size={18} aria-hidden="true" /> : null}
              {isCheckingNasConnection ? '正在连接' : '测试连接并保存'}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (view === 'import') {
    return <Suspense fallback={<main className="app-shell"><section className="state-panel"><RefreshCw className="spin" size={22} aria-hidden="true" /><p>正在打开导入工具</p></section></main>}><ImportWorkspace baseCatalog={catalog} onBack={() => setView('lookup')} onCatalogPublished={(nextCatalog) => setCatalogState({ status: 'ready', catalog: nextCatalog })} onPhotoImport={() => setView('photo-import')} /></Suspense>;
  }

  if (view === 'photo-import') {
    return <Suspense fallback={<main className="app-shell"><section className="state-panel"><RefreshCw className="spin" size={22} aria-hidden="true" /><p>正在打开照片识别</p></section></main>}><PhotoImportWorkspace baseCatalog={catalog} onBack={() => setView('lookup')} onCatalogPublished={(nextCatalog) => setCatalogState({ status: 'ready', catalog: nextCatalog })} onSpreadsheetImport={() => setView('import')} /></Suspense>;
  }

  if (view === 'manage') {
    return <Suspense fallback={<main className="app-shell"><section className="state-panel"><RefreshCw className="spin" size={22} aria-hidden="true" /><p>正在打开商品管理</p></section></main>}><ProductManagementWorkspace baseCatalog={catalog} onBack={() => setView('lookup')} onCatalogPublished={(nextCatalog) => setCatalogState({ status: 'ready', catalog: nextCatalog })} /></Suspense>;
  }
  const results = catalog ? searchProducts(catalog.products, query) : [];
  const activeCount = catalog?.products.filter((product) => product.active).length ?? 0;
  const hasPublishedProducts = activeCount > 0;

  function chooseQuery(nextQuery: string) {
    setQuery(nextQuery);
    setScannerNotice('');
  }

  function selectProduct() {
    setRecents(saveRecentQuery(query));
  }

  function handleScannedCode(code: string) {
    setScannerOpen(false);
    setQuery(code);
    const matched = catalog ? searchProducts(catalog.products, code).length > 0 : false;
    setScannerNotice(matched ? `已识别条码 ${code}` : `条码 ${code} 未在当前价格表中匹配，请改用名称搜索。`);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">价</span>
          <div><strong>小卖部查价</strong><span>内部价格查询</span></div>
        </div>
        <div className="header-actions">
          {isNativePlatform ? <button className="import-button" type="button" onClick={openNasSettings} aria-label="NAS 设置" title="NAS 设置"><Settings size={18} aria-hidden="true" /><span>NAS 设置</span></button> : null}
          <button className="import-button management-button" type="button" onClick={() => setView('manage')} aria-label="商品管理" title="商品管理">
            <PackageSearch size={18} aria-hidden="true" />
            <span>商品管理</span>
          </button>
          <button className="import-button" type="button" onClick={() => setView('import')} aria-label="导入价格表" title="导入价格表">
            <FileUp size={18} aria-hidden="true" />
            <span>导入价格表</span>
          </button>
        </div>
      </header>

      {nasConnectionStatus ? <p className="nas-connection-notice success-notice" role="status">{nasConnectionStatus}</p> : null}

      <section className="lookup-stage" aria-labelledby="lookup-title">
        <div className="lookup-heading">
          <span className="eyebrow">图片报价汇总</span>
          <h1 id="lookup-title">查商品价格</h1>
          <p>{catalog ? `${catalog.sourceLabel} · ${displayDate(catalog.effectiveAt)}` : '正在读取已发布价格表'}</p>
        </div>

        <div className="search-row">
          <label className="search-box">
            <Search size={21} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => chooseQuery(event.target.value)}
              placeholder="搜索名称、规格、Item ID 或条码"
              aria-label="搜索商品"
            />
            {query ? <button className="clear-query" type="button" onClick={() => chooseQuery('')} aria-label="清除搜索"><span>×</span></button> : null}
          </label>
          <button className="scan-button" type="button" onClick={() => setScannerOpen(true)} title="扫码查询">
            <Barcode size={21} aria-hidden="true" />
            <span>扫码</span>
          </button>
        </div>

        {scannerNotice ? <p className="scanner-notice" role="status">{scannerNotice}</p> : null}

        {catalogState.status === 'loading' ? <section className="state-panel"><RefreshCw className="spin" size={22} aria-hidden="true" /><p>正在读取价格表</p></section> : null}
        {catalogState.status === 'error' ? <section className="state-panel state-error"><p>无法加载价格表，请刷新页面或联系管理员。</p></section> : null}
        {catalogState.status === 'ready' && !hasPublishedProducts ? <section className="state-panel"><ShoppingBasket size={24} aria-hidden="true" /><p>尚未导入已发布价格表</p></section> : null}

        {catalogState.status === 'ready' && hasPublishedProducts && query ? (
          <section className="results-section" aria-live="polite">
            <div className="results-heading"><span>{results.length} 个结果</span><span>仅展示上架商品</span></div>
            {results.length ? <div className="results-list">{results.map((product) => <ProductResult product={product} key={product.id} onSelect={selectProduct} />)}</div> : <div className="state-panel compact-state"><p>未找到匹配商品，请核对名称、规格或条码。</p></div>}
          </section>
        ) : null}

        {catalogState.status === 'ready' && hasPublishedProducts && !query ? (
          <section className="recent-section">
            <div className="section-label"><History size={17} aria-hidden="true" /><span>最近查询</span></div>
            {recents.length ? <div className="recent-list">{recents.map((recent) => <button key={recent} type="button" onClick={() => chooseQuery(recent)}>{recent}</button>)}</div> : <p className="muted-copy">开始输入商品名称或扫描包装条码</p>}
          </section>
        ) : null}
      </section>

      {scannerOpen ? <Suspense fallback={null}><ScannerDialog open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleScannedCode} /></Suspense> : null}
    </main>
  );
}
