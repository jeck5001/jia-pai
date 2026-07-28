import { Plus, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { normalizeText, productSearchText, priceForInput, parsePriceToCents, uniqueProducts, validateProducts } from '../lib/catalog';
import { createManagedCatalog, createManagedProduct } from '../lib/catalog-management';
import { publishCatalog } from '../lib/server-api';
import type { Catalog, ImportIssue, Product } from '../types';

type ProductManagementWorkspaceProps = {
  baseCatalog: Catalog | null;
  onBack: () => void;
  onCatalogPublished: (catalog: Catalog) => void;
};

type VisibilityFilter = 'all' | 'active' | 'inactive';

function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function issueKey(issue: ImportIssue, index: number): string {
  return `${issue.severity}-${issue.row ?? 'global'}-${index}`;
}

function productNameRows(name: string): number {
  return Math.max(1, Math.ceil(Array.from(name).length / 9));
}

export function ProductManagementWorkspace({ baseCatalog, onBack, onCatalogPublished }: ProductManagementWorkspaceProps) {
  const [draft, setDraft] = useState<Product[]>(() => baseCatalog?.products ?? []);
  const [sourceLabel, setSourceLabel] = useState(() => baseCatalog?.sourceLabel ?? '');
  const [effectiveAt, setEffectiveAt] = useState(() => toDateTimeInput(baseCatalog?.effectiveAt ?? null));
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [adminToken, setAdminToken] = useState('');
  const [status, setStatus] = useState('');
  const [publishError, setPublishError] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (!baseCatalog) return;
    setDraft(baseCatalog.products);
    setSourceLabel(baseCatalog.sourceLabel);
    setEffectiveAt(toDateTimeInput(baseCatalog.effectiveAt));
    setPublishError('');
  }, [baseCatalog]);

  const issues = validateProducts(draft);
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const errorProductIds = new Set(issues.filter((issue) => issue.severity === 'error').flatMap((issue) => issue.productIds ?? []));
  const normalizedQuery = normalizeText(query);
  const visibleProducts = draft
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const matchesVisibility = visibility === 'all' || (visibility === 'active' ? product.active : !product.active);
      return matchesVisibility && (!normalizedQuery || productSearchText(product).includes(normalizedQuery));
    });
  const hasSpecifications = draft.some((product) => Boolean(product.specification?.trim()));
  const hasBarcodesOrAliases = draft.some((product) => [...(product.barcodes ?? []), ...(product.aliases ?? [])].some((value) => value.trim()));
  const activeCount = draft.filter((product) => product.active).length;
  const deduplicatedCount = uniqueProducts(draft).length;

  function updateProduct(index: number, patch: Partial<Product>) {
    setDraft((products) => products.map((product, productIndex) => (productIndex === index ? { ...product, ...patch } : product)));
    setStatus('');
    setPublishError('');
  }

  function removeProduct(index: number) {
    setDraft((products) => products.filter((_, productIndex) => productIndex !== index));
    setStatus('');
    setPublishError('');
  }

  function addProduct() {
    setDraft((products) => [...products, createManagedProduct(products.length)]);
    setStatus('');
    setPublishError('');
  }

  function resetDraft() {
    if (!baseCatalog) return;
    setDraft(baseCatalog.products);
    setSourceLabel(baseCatalog.sourceLabel);
    setEffectiveAt(toDateTimeInput(baseCatalog.effectiveAt));
    setQuery('');
    setPublishError('');
    setStatus('已恢复为当前已发布的商品目录。');
  }

  async function publishManagedCatalog() {
    if (!baseCatalog) return;
    setIsPublishing(true);
    setStatus('');
    setPublishError('');
    try {
      const catalog = await publishCatalog(createManagedCatalog(baseCatalog, draft, {
        sourceLabel,
        effectiveAt: toIsoDateTime(effectiveAt),
      }), adminToken);
      onCatalogPublished(catalog);
      setStatus(`已保存并发布，当前共 ${catalog.products.length} 条商品，其中 ${catalog.products.filter((product) => product.active).length} 条上架。`);
    } catch (error) {
      setPublishError(error instanceof Error ? `发布失败：${error.message}` : '发布失败，请稍后重试。');
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <main className="app-shell import-shell">
      <header className="app-header">
        <button className="back-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          返回查价
        </button>
        <div className="brand-lockup compact">
          <span className="brand-mark">价</span>
          <strong>商品管理</strong>
        </div>
      </header>

      {!baseCatalog ? (
        <section className="state-panel state-error manage-empty-state">
          <p>未能读取当前商品目录，请返回查价页刷新后再管理。</p>
        </section>
      ) : (
        <>
          <section className="workspace-heading">
            <div>
              <span className="eyebrow">NAS 服务</span>
              <h1>商品管理</h1>
            </div>
            <p>编辑、新增或下架商品后，点击保存并发布才会更新查价页面。</p>
          </section>

          <section className="manage-controls" aria-label="目录发布信息">
            <label>
              <span>价格表来源</span>
              <input value={sourceLabel} onChange={(event) => { setSourceLabel(event.target.value); setStatus(''); }} maxLength={80} />
            </label>
            <label>
              <span>生效时间</span>
              <input type="datetime-local" value={effectiveAt} onChange={(event) => { setEffectiveAt(event.target.value); setStatus(''); }} />
            </label>
            <p>来源和生效时间默认沿用已发布目录，可在本次发布时更新。</p>
          </section>

          <section className="manage-toolbar" aria-label="商品筛选和操作">
            <label className="manage-search">
              <Search size={18} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选名称、规格、Item ID 或条码" aria-label="筛选商品" />
              {query ? <button className="clear-query" type="button" onClick={() => setQuery('')} aria-label="清除筛选"><span>×</span></button> : null}
            </label>
            <div className="manage-filter" aria-label="上架状态筛选">
              <button type="button" className={visibility === 'all' ? 'active' : ''} onClick={() => setVisibility('all')}>全部</button>
              <button type="button" className={visibility === 'active' ? 'active' : ''} onClick={() => setVisibility('active')}>上架</button>
              <button type="button" className={visibility === 'inactive' ? 'active' : ''} onClick={() => setVisibility('inactive')}>下架</button>
            </div>
          </section>

          <section className="draft-toolbar manage-draft-toolbar">
            <div>
              <span className="eyebrow">商品目录</span>
              <h2>{draft.length} 条商品，{activeCount} 条上架</h2>
              {deduplicatedCount !== draft.length ? <p className="dedupe-note">检测到 {draft.length - deduplicatedCount} 条同价重复记录，发布时会自动只保留一条。</p> : null}
            </div>
            <div className="manage-actions">
              <button className="text-button" type="button" onClick={resetDraft} disabled={isPublishing}>
                <RotateCcw size={17} aria-hidden="true" />
                放弃修改
              </button>
              <button className="text-button add-product-button" type="button" onClick={addProduct} disabled={isPublishing}>
                <Plus size={18} aria-hidden="true" />
                新增商品
              </button>
            </div>
          </section>

          {issues.length ? (
            <section className="issue-list" aria-live="polite">
              {issues.map((issue, index) => <p key={issueKey(issue, index)} className={issue.severity === 'error' ? 'issue-error' : 'issue-warning'}>{issue.message}</p>)}
            </section>
          ) : null}

          <div className="manage-mobile-list">
            {visibleProducts.map(({ product, index }) => (
              <article key={product.id} className={errorProductIds.has(product.id) ? 'manage-mobile-product draft-row-error' : 'manage-mobile-product'}>
                <div className="manage-mobile-product-heading">
                  <span>商品 {index + 1}</span>
                  <div>
                    <label className="switch-label"><input type="checkbox" checked={product.active} onChange={(event) => updateProduct(index, { active: event.target.checked })} /><span>{product.active ? '上架' : '下架'}</span></label>
                    <button className="icon-button danger" type="button" onClick={() => removeProduct(index)} aria-label={`删除商品：${product.name || '新商品'}`} title="删除商品"><X size={17} /></button>
                  </div>
                </div>
                <label className="manage-mobile-field manage-mobile-field-wide">
                  <span>商品名称</span>
                  <textarea aria-label={`商品名称：${product.name || '新商品'}`} rows={productNameRows(product.name)} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} />
                </label>
                <div className="manage-mobile-field-grid">
                  {hasSpecifications ? <label className="manage-mobile-field"><span>规格</span><input aria-label={`商品规格：${product.name || '新商品'}`} value={product.specification ?? ''} onChange={(event) => updateProduct(index, { specification: event.target.value || undefined })} /></label> : null}
                  <label className="manage-mobile-field"><span>Item ID</span><input aria-label={`商品 Item ID：${product.name || '新商品'}`} value={product.itemId ?? ''} onChange={(event) => updateProduct(index, { itemId: event.target.value || undefined })} /></label>
                  <label className="manage-mobile-field"><span>零售价</span><input aria-label={`商品零售价：${product.name || '新商品'}`} inputMode="decimal" value={product.priceCents >= 0 ? priceForInput(product.priceCents) : ''} onChange={(event) => updateProduct(index, { priceCents: parsePriceToCents(event.target.value) ?? -1 })} /></label>
                  <label className="manage-mobile-field"><span>库存</span><input aria-label={`商品库存：${product.name || '新商品'}`} inputMode="numeric" value={product.stockQuantity ?? ''} onChange={(event) => {
                    const value = event.target.value.trim();
                    const quantity = Number(value);
                    updateProduct(index, { stockQuantity: value && Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined });
                  }} /></label>
                </div>
                {hasBarcodesOrAliases ? <label className="manage-mobile-field manage-mobile-field-wide"><span>条码 / 别名</span><input aria-label={`商品条码和别名：${product.name || '新商品'}`} value={[...(product.barcodes ?? []), ...(product.aliases ?? [])].join(', ')} onChange={(event) => updateProduct(index, { barcodes: event.target.value.split(/[，,;；]/).map((value) => value.trim()).filter(Boolean), aliases: [] })} /></label> : null}
              </article>
            ))}
            {!visibleProducts.length ? <p className="manage-no-results">{draft.length ? '没有符合当前筛选条件的商品。' : '还没有商品，点击“新增商品”开始录入。'}</p> : null}
          </div>

          <div className="table-scroll manage-desktop-table">
            <table className="draft-table manage-table">
              <thead>
                <tr>
                  <th>商品</th>
                  {hasSpecifications ? <th>规格</th> : null}
                  <th>Item ID</th>
                  <th>零售价</th>
                  <th>库存</th>
                  {hasBarcodesOrAliases ? <th>条码 / 别名</th> : null}
                  <th>状态</th>
                  <th><span className="sr-only">删除</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map(({ product, index }) => (
                  <tr key={product.id} className={errorProductIds.has(product.id) ? 'draft-row-error' : undefined}>
                    <td><textarea className="product-name-input" aria-label={`商品名称：${product.name || '新商品'}`} rows={productNameRows(product.name)} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} /></td>
                    {hasSpecifications ? <td><input aria-label={`商品规格：${product.name || '新商品'}`} value={product.specification ?? ''} onChange={(event) => updateProduct(index, { specification: event.target.value || undefined })} /></td> : null}
                    <td><input aria-label={`商品 Item ID：${product.name || '新商品'}`} value={product.itemId ?? ''} onChange={(event) => updateProduct(index, { itemId: event.target.value || undefined })} /></td>
                    <td><input aria-label={`商品零售价：${product.name || '新商品'}`} inputMode="decimal" value={product.priceCents >= 0 ? priceForInput(product.priceCents) : ''} onChange={(event) => updateProduct(index, { priceCents: parsePriceToCents(event.target.value) ?? -1 })} /></td>
                    <td><input aria-label={`商品库存：${product.name || '新商品'}`} inputMode="numeric" value={product.stockQuantity ?? ''} onChange={(event) => {
                      const value = event.target.value.trim();
                      const quantity = Number(value);
                      updateProduct(index, { stockQuantity: value && Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined });
                    }} /></td>
                    {hasBarcodesOrAliases ? <td><input aria-label={`商品条码和别名：${product.name || '新商品'}`} value={[...(product.barcodes ?? []), ...(product.aliases ?? [])].join(', ')} onChange={(event) => updateProduct(index, { barcodes: event.target.value.split(/[，,;；]/).map((value) => value.trim()).filter(Boolean), aliases: [] })} /></td> : null}
                    <td><label className="switch-label"><input type="checkbox" checked={product.active} onChange={(event) => updateProduct(index, { active: event.target.checked })} /><span>{product.active ? '上架' : '下架'}</span></label></td>
                    <td><button className="icon-button danger" type="button" onClick={() => removeProduct(index)} aria-label={`删除商品：${product.name || '新商品'}`} title="删除商品"><X size={17} /></button></td>
                  </tr>
                ))}
                {!visibleProducts.length ? <tr><td className="manage-no-results" colSpan={6 + Number(hasSpecifications) + Number(hasBarcodesOrAliases)}>{draft.length ? '没有符合当前筛选条件的商品。' : '还没有商品，点击“新增商品”开始录入。'}</td></tr> : null}
              </tbody>
            </table>
          </div>

          <section className="manage-publish-bar" aria-label="发布商品目录">
            <label className="admin-token-field">
              <span>管理员口令</span>
              <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="未设置可留空" autoComplete="off" disabled={isPublishing} />
            </label>
            <button className="primary-button" type="button" onClick={() => void publishManagedCatalog()} disabled={hasErrors || isPublishing}>
              {isPublishing ? <RefreshCw className="spin" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
              {isPublishing ? '正在发布' : '保存并发布'}
            </button>
          </section>
          {publishError ? <p className="publish-notice publish-notice-error" role="alert">{publishError}</p> : null}
          {status ? <p className="publish-notice" role="status">{status}</p> : null}
        </>
      )}
    </main>
  );
}
