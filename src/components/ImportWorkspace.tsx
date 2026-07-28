import { AlertCircle, AlertTriangle, Camera, CheckCircle2, Download, FileSpreadsheet, RefreshCw, RotateCcw, Search, Upload, X } from 'lucide-react';
import { ChangeEvent, useState } from 'react';
import { formatPrice, parsePriceToCents, priceForInput, searchProducts, validateProducts } from '../lib/catalog';
import { createPublishedCatalog, importRows, readSpreadsheet } from '../lib/importer';
import { publishCatalog } from '../lib/server-api';
import type { Catalog, ImportIssue, Product } from '../types';

type ImportWorkspaceProps = {
  baseCatalog: Catalog | null;
  onBack: () => void;
  onCatalogPublished: (catalog: Catalog) => void;
  onPhotoImport: () => void;
};

function initialDateTime(): string {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function issueKey(issue: ImportIssue, index: number): string {
  return `${issue.severity}-${issue.row ?? 'global'}-${index}`;
}

export function ImportWorkspace({ baseCatalog, onBack, onCatalogPublished, onPhotoImport }: ImportWorkspaceProps) {
  const [sourceLabel, setSourceLabel] = useState('本地导入价格表');
  const [effectiveAt, setEffectiveAt] = useState(initialDateTime);
  const [draft, setDraft] = useState<Product[]>([]);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [fileName, setFileName] = useState('');
  const [previewQuery, setPreviewQuery] = useState('');
  const [status, setStatus] = useState('');
  const [publishError, setPublishError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  const draftIssues = draft.length > 0 ? validateProducts(draft) : [];
  const allIssues = [...importIssues, ...draftIssues];
  const hasErrors = allIssues.some((issue) => issue.severity === 'error');
  const previewProducts = searchProducts(draft, previewQuery);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    setStatus('');
    setPublishError('');
    setFileName(file.name);
    try {
      const rows = await readSpreadsheet(file);
      const result = importRows(rows, {
        sourceLabel: sourceLabel || file.name,
        effectiveAt: new Date(effectiveAt).toISOString(),
      });
      setDraft(result.catalog.products);
      setImportIssues(result.issues);
    } catch (error) {
      setDraft([]);
      setImportIssues([{ severity: 'error', message: error instanceof Error ? error.message : '无法读取该文件' }]);
    } finally {
      setIsReading(false);
      event.target.value = '';
    }
  }

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

  function resetDraft() {
    setDraft([]);
    setImportIssues([]);
    setFileName('');
    setPreviewQuery('');
    setStatus('');
    setPublishError('');
  }

  function downloadCatalog() {
    setPublishError('');
    const catalog = createPublishedCatalog(sourceLabel || fileName, effectiveAt, draft);
    const blob = new Blob([`${JSON.stringify(catalog, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'products.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('已下载 products.json 备份。');
  }

  async function publishCatalogToServer() {
    setIsPublishing(true);
    setStatus('');
    setPublishError('');
    try {
      const catalog = await publishCatalog(createPublishedCatalog(sourceLabel || fileName, effectiveAt, draft), adminToken);
      onCatalogPublished(catalog);
      setStatus(`已发布到 NAS，当前共 ${catalog.products.length} 条商品。`);
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
          <strong>价格表导入</strong>
        </div>
      </header>

      <nav className="import-mode-switch" aria-label="导入方式">
        <button type="button" className="active" aria-current="page">表格文件</button>
        <button type="button" onClick={onPhotoImport}><Camera size={16} aria-hidden="true" />照片识别</button>
      </nav>

      <section className="workspace-heading">
        <div>
          <span className="eyebrow">NAS 服务</span>
          <h1>导入与发布准备</h1>
        </div>
        <p>{baseCatalog ? `当前服务已发布 ${baseCatalog.products.length} 条商品，校对后可直接更新。` : '校对后可直接发布到当前 NAS 服务。'}</p>
      </section>

      <section className="import-controls" aria-label="价格表导入设置">
        <label className="field">
          <span>价格表来源</span>
          <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>生效时间</span>
          <input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} />
        </label>
        <label className="field">
          <span>管理员口令</span>
          <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="未设置可留空" autoComplete="off" disabled={isPublishing} />
        </label>
        <label className="file-picker">
          <input type="file" accept=".xlsx,.csv" onChange={handleFileChange} />
          <Upload size={18} aria-hidden="true" />
          <span>{isReading ? '正在读取' : '选择 Excel 或 CSV'}</span>
        </label>
      </section>

      {fileName ? (
        <div className="file-summary">
          <FileSpreadsheet size={18} aria-hidden="true" />
          <span>{fileName}</span>
          <span>{draft.length} 条候选商品</span>
          <button className="text-button" type="button" onClick={resetDraft}>
            <RotateCcw size={15} aria-hidden="true" />
            清空
          </button>
        </div>
      ) : null}

      {allIssues.length > 0 ? (
        <section className="issue-list" aria-live="polite">
          {allIssues.map((issue, index) => (
            <p key={issueKey(issue, index)} className={issue.severity === 'error' ? 'issue-error' : 'issue-warning'}>
              {issue.severity === 'error' ? <AlertCircle size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
              <span>{issue.row ? `第 ${issue.row} 行：` : ''}{issue.message}</span>
            </p>
          ))}
        </section>
      ) : null}

      {draft.length > 0 ? (
        <>
          <section className="draft-toolbar">
            <div>
              <span className="eyebrow">发布前校对</span>
              <h2>商品草稿</h2>
            </div>
            <div className="publish-actions">
              <button className="text-button" type="button" onClick={downloadCatalog} disabled={hasErrors || isPublishing}>
                <Download size={18} aria-hidden="true" />
                下载备份
              </button>
              <button className="primary-button" type="button" onClick={() => void publishCatalogToServer()} disabled={hasErrors || isPublishing}>
                {isPublishing ? <RefreshCw className="spin" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
                {isPublishing ? '正在发布' : '发布到 NAS'}
              </button>
            </div>
          </section>
          {publishError ? (
            <p className="notice notice-error publish-notice" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{publishError}</span>
            </p>
          ) : null}
          {status ? (
            <p className="notice notice-success publish-notice" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>{status}</span>
            </p>
          ) : null}

          <div className="draft-cards">
            {draft.map((product, index) => (
              <article key={`${product.id}-${index}`} className="draft-card">
                <div className="draft-card-heading">
                  <span>第 {index + 1} 条</span>
                  <div>
                    <label className="switch-label"><input type="checkbox" checked={product.active} onChange={(event) => updateProduct(index, { active: event.target.checked })} /><span>{product.active ? '上架' : '下架'}</span></label>
                    <button className="icon-button danger" type="button" onClick={() => removeProduct(index)} aria-label={`删除第 ${index + 1} 条商品`} title="删除商品"><X size={18} /></button>
                  </div>
                </div>
                <label className="draft-field">
                  <span>商品名称</span>
                  <input aria-label={`第 ${index + 1} 条商品名称`} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} />
                </label>
                <div className="draft-field-grid">
                  <label className="draft-field"><span>规格</span><input aria-label={`第 ${index + 1} 条规格`} value={product.specification ?? ''} onChange={(event) => updateProduct(index, { specification: event.target.value || undefined })} /></label>
                  <label className="draft-field"><span>Item ID</span><input aria-label={`第 ${index + 1} 条 Item ID`} value={product.itemId ?? ''} onChange={(event) => updateProduct(index, { itemId: event.target.value || undefined })} /></label>
                  <label className="draft-field"><span>零售价</span><input aria-label={`第 ${index + 1} 条零售价`} inputMode="decimal" value={product.priceCents >= 0 ? priceForInput(product.priceCents) : ''} onChange={(event) => updateProduct(index, { priceCents: parsePriceToCents(event.target.value) ?? -1 })} /></label>
                </div>
                <label className="draft-field">
                  <span>条码 / 别名</span>
                  <input aria-label={`第 ${index + 1} 条条码和别名`} value={[...(product.barcodes ?? []), ...(product.aliases ?? [])].join(', ')} onChange={(event) => updateProduct(index, { barcodes: event.target.value.split(/[，,;；]/).map((value) => value.trim()).filter(Boolean), aliases: [] })} />
                </label>
              </article>
            ))}
          </div>

          <div className="table-scroll">
            <table className="draft-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>规格</th>
                  <th>Item ID</th>
                  <th>零售价</th>
                  <th>条码 / 别名</th>
                  <th>状态</th>
                  <th><span className="sr-only">删除</span></th>
                </tr>
              </thead>
              <tbody>
                {draft.map((product, index) => (
                  <tr key={`${product.id}-${index}`}>
                    <td><input aria-label={`第 ${index + 1} 条商品名称`} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条规格`} value={product.specification ?? ''} onChange={(event) => updateProduct(index, { specification: event.target.value || undefined })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条 Item ID`} value={product.itemId ?? ''} onChange={(event) => updateProduct(index, { itemId: event.target.value || undefined })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条零售价`} inputMode="decimal" value={product.priceCents >= 0 ? priceForInput(product.priceCents) : ''} onChange={(event) => updateProduct(index, { priceCents: parsePriceToCents(event.target.value) ?? -1 })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条条码和别名`} value={[...(product.barcodes ?? []), ...(product.aliases ?? [])].join(', ')} onChange={(event) => updateProduct(index, { barcodes: event.target.value.split(/[，,;；]/).map((value) => value.trim()).filter(Boolean), aliases: [] })} /></td>
                    <td><label className="switch-label"><input type="checkbox" checked={product.active} onChange={(event) => updateProduct(index, { active: event.target.checked })} /><span>{product.active ? '上架' : '下架'}</span></label></td>
                    <td><button className="icon-button danger" type="button" onClick={() => removeProduct(index)} aria-label={`删除第 ${index + 1} 条商品`} title="删除商品"><X size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="preview-panel">
            <div>
              <span className="eyebrow">查询预览</span>
              <h2>发布前查一次</h2>
            </div>
            <label className="preview-search">
              <Search size={18} aria-hidden="true" />
              <input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="搜索名称、Item ID 或条码" />
            </label>
            {previewQuery ? (
              <div className="preview-results">
                {previewProducts.length ? previewProducts.map((product) => <p key={product.id}><strong>{product.name}</strong><span>{formatPrice(product.priceCents)}</span></p>) : <p>未找到匹配商品</p>}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
