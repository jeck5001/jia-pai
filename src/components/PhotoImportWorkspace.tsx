import { Camera, Download, ImagePlus, Plus, RefreshCw, RotateCcw, Search, Upload, X } from 'lucide-react';
import { ChangeEvent, useEffect, useState } from 'react';
import { formatPrice, parsePriceToCents, priceForInput, searchProducts, stripDraftMetadata, uniqueProducts, validateProducts } from '../lib/catalog';
import { publishCatalog } from '../lib/server-api';
import { recognizePhotoWithServer } from '../lib/vision-import';
import type { Catalog, ImportIssue, Product } from '../types';

type PhotoImportWorkspaceProps = {
  baseCatalog: Catalog | null;
  onBack: () => void;
  onCatalogPublished: (catalog: Catalog) => void;
  onSpreadsheetImport: () => void;
};

type OcrProgress = {
  percent: number;
  status: string;
};

type PhotoPreview = {
  name: string;
  url: string;
};

function issueKey(issue: ImportIssue, index: number): string {
  return `${issue.severity}-${issue.row ?? 'global'}-${index}`;
}

function createManualProduct(index: number): Product {
  return {
    id: `manual-${Date.now()}-${index}`,
    name: '',
    priceCents: -1,
    active: true,
    sourceLabel: '手动补充',
    sourceRow: index,
  };
}

export function PhotoImportWorkspace({ baseCatalog, onBack, onCatalogPublished, onSpreadsheetImport }: PhotoImportWorkspaceProps) {
  const [draft, setDraft] = useState<Product[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [previews, setPreviews] = useState<PhotoPreview[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [currentFile, setCurrentFile] = useState('');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [previewQuery, setPreviewQuery] = useState('');
  const [status, setStatus] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  const draftIssues = draft.length ? validateProducts(draft) : [];
  const allIssues = [...issues, ...draftIssues];
  const hasErrors = allIssues.some((issue) => issue.severity === 'error');
  const errorRows = new Set(draftIssues.filter((issue) => issue.severity === 'error').flatMap((issue) => issue.rows ?? (issue.row ? [issue.row] : [])));
  const baseProducts = baseCatalog?.products ?? [];
  const existingCount = uniqueProducts(baseProducts).length;
  const mergedCount = uniqueProducts([...baseProducts, ...draft]).length;
  const addedCount = Math.max(0, mergedCount - existingCount);
  const previewProducts = searchProducts(draft, previewQuery);

  function focusIssue(issue: ImportIssue) {
    const row = issue.rows?.[issue.rows.length - 1] ?? issue.row;
    const index = draft.findIndex((product, productIndex) => (product.sourceRow ?? productIndex + 1) === row);
    const target = index >= 0 ? document.getElementById(`candidate-${index}`) : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    setIsRecognizing(true);
    setDraft([]);
    setIssues([]);
    setFileNames(files.map((file) => file.name));
    setPreviews(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
    setCurrentFile('');
    setProgress(null);
    setPreviewQuery('');
    setStatus('');
    setIsConfirmed(false);

    try {
      const nextProducts: Product[] = [];
      const nextIssues: ImportIssue[] = [];
      for (const [index, file] of files.entries()) {
        setCurrentFile(file.name);
        setProgress({ percent: Math.round((index / files.length) * 80) + 15, status: '正在请求大模型识别表格' });
        const source = {
          fileIndex: index + 1,
          sourceImage: file.name,
          sourceLabel: `大模型导入：${file.name}`,
        };
        const result = await recognizePhotoWithServer(file, source);
        nextProducts.push(...result.products);
        nextIssues.push(...result.issues);
      }
      setDraft(nextProducts);
      setIssues([{ severity: 'warning', message: '大模型识别结果仅作候选，请逐行核对原图后再确认导出' }, ...nextIssues]);
    } catch (error) {
      setIssues([{ severity: 'error', message: error instanceof Error ? `图片识别失败：${error.message}` : '图片识别失败，请检查 NAS 服务配置' }]);
    } finally {
      setIsRecognizing(false);
      setCurrentFile('');
      setProgress(null);
    }
  }

  function updateProduct(index: number, patch: Partial<Product>) {
    setDraft((products) => products.map((product, productIndex) => (productIndex === index ? { ...product, ...patch } : product)));
    setStatus('');
    setIsConfirmed(false);
  }

  function removeProduct(index: number) {
    setDraft((products) => products.filter((_, productIndex) => productIndex !== index));
    setStatus('');
    setIsConfirmed(false);
  }

  function addProduct() {
    setDraft((products) => [...products, createManualProduct(products.length + 1)]);
    setStatus('');
    setIsConfirmed(false);
  }

  function resetDraft() {
    setDraft([]);
    setIssues([]);
    setFileNames([]);
    setPreviews([]);
    setPreviewQuery('');
    setStatus('');
    setIsConfirmed(false);
  }

  function mergedCatalog(): Catalog {
    const now = new Date();
    return stripDraftMetadata({
      version: `photo-import-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
      effectiveAt: baseCatalog?.effectiveAt ?? null,
      sourceLabel: baseCatalog ? `${baseCatalog.sourceLabel} + ${fileNames.length || 1} 张新增照片` : `新增照片 ${fileNames.length || 1} 张`,
      products: [...baseProducts, ...draft],
    });
  }

  function downloadMergedCatalog() {
    const catalog = mergedCatalog();
    const blob = new Blob([`${JSON.stringify(catalog, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'products.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`已下载 products.json，合并后共 ${catalog.products.length} 条商品，本次新增 ${addedCount} 条。`);
  }

  async function publishMergedCatalog() {
    setIsPublishing(true);
    setStatus('');
    try {
      const catalog = await publishCatalog(mergedCatalog(), adminToken);
      onCatalogPublished(catalog);
      setStatus(`已发布到 NAS，当前共 ${catalog.products.length} 条商品，本次新增 ${addedCount} 条。`);
    } catch (error) {
      setIssues([{ severity: 'error', message: error instanceof Error ? `发布失败：${error.message}` : '发布失败，请稍后重试' }]);
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
        <button type="button" onClick={onSpreadsheetImport}>表格文件</button>
        <button type="button" className="active" aria-current="page">照片识别</button>
      </nav>

      <section className="workspace-heading">
        <div>
          <span className="eyebrow">NAS 服务端视觉模型</span>
          <h1>大模型识别价格表</h1>
        </div>
        <p>{baseCatalog ? `将与当前 ${existingCount} 条已发布商品合并并直接发布` : '识别后可直接发布到当前 NAS 服务'}</p>
      </section>

      <p className="service-note">模型、服务地址和 API Key 均由 NAS 服务端配置，不会发送到浏览器。</p>

      <section className="photo-controls" aria-label="价格表照片导入">
        <label className="file-picker photo-picker" title="拍照或选择价格表照片">
          <input type="file" accept="image/*" multiple onChange={handleImageChange} disabled={isRecognizing} />
          {isRecognizing ? <RefreshCw className="spin" size={18} aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
          <span>{isRecognizing ? '正在识别' : '拍照或选择图片'}</span>
        </label>
        {draft.length || fileNames.length ? <button className="text-button" type="button" onClick={resetDraft} disabled={isRecognizing}><RotateCcw size={15} aria-hidden="true" />清空本次照片</button> : null}
      </section>

      {fileNames.length ? (
        <div className="file-summary">
          <ImagePlus size={18} aria-hidden="true" />
          <span>{fileNames.length === 1 ? fileNames[0] : `${fileNames[0]} 等 ${fileNames.length} 张图片`}</span>
          {draft.length ? <span>{draft.length} 条候选商品</span> : null}
        </div>
      ) : null}

      {previews.length ? <div className="photo-previews">{previews.map((preview) => (
        <a key={preview.url} className="photo-preview" href={preview.url} target="_blank" rel="noreferrer">
          <img src={preview.url} alt={`价格表原图：${preview.name}`} />
          <span>{preview.name}</span>
        </a>
      ))}</div> : null}

      {isRecognizing ? <section className="state-panel photo-progress"><RefreshCw className="spin" size={22} aria-hidden="true" /><p>{currentFile || '正在准备大模型请求'}{progress ? ` · ${progress.status} ${progress.percent}%` : ''}</p></section> : null}

      {allIssues.length ? (
        <section className="issue-list" aria-live="polite">
          {allIssues.map((issue, index) => (
            <p key={issueKey(issue, index)} className={issue.severity === 'error' ? 'issue-error' : 'issue-warning'}>
              {issue.row ? `第 ${issue.row} 行：` : ''}{issue.message}
              {issue.row || issue.rows?.length ? <button className="issue-jump" type="button" onClick={() => focusIssue(issue)}>{(issue.rows?.length ?? issue.productIds?.length ?? 0) > 1 ? '查看冲突行' : '定位此行'}</button> : null}
            </p>
          ))}
        </section>
      ) : null}

      {draft.length ? (
        <>
          <section className="draft-toolbar">
            <div>
              <span className="eyebrow">识别校对</span>
              <h2>商品候选</h2>
            </div>
            <div className="photo-actions">
              <button className="text-button" type="button" onClick={addProduct}><Plus size={17} aria-hidden="true" />新增一行</button>
              <label className="confirmation-check"><input type="checkbox" checked={isConfirmed} onChange={(event) => setIsConfirmed(event.target.checked)} />已逐行核对候选数据</label>
              <label className="admin-token-field">
                <span>管理员口令</span>
                <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="未设置可留空" autoComplete="off" disabled={isPublishing} />
              </label>
              <button className="text-button" type="button" onClick={downloadMergedCatalog} disabled={hasErrors || !isConfirmed || isPublishing}>
                <Download size={18} aria-hidden="true" />
                下载备份
              </button>
              <button className="primary-button" type="button" onClick={() => void publishMergedCatalog()} disabled={hasErrors || !isConfirmed || isPublishing}>
                {isPublishing ? <RefreshCw className="spin" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
                {isPublishing ? '正在发布' : '发布到 NAS'}
              </button>
            </div>
          </section>
          <div className="table-scroll">
            <table className="draft-table photo-draft-table">
              <thead>
                <tr>
                  <th>候选行</th>
                  <th>商品</th>
                  <th>Item ID</th>
                  <th>表中数量</th>
                  <th>零售价</th>
                  <th>状态</th>
                  <th><span className="sr-only">删除</span></th>
                </tr>
              </thead>
              <tbody>
                {draft.map((product, index) => (
                  <tr id={`candidate-${index}`} key={`${product.id}-${index}`} className={errorRows.has(product.sourceRow ?? index + 1) ? 'draft-row-error' : ''}>
                    <td className="draft-row-number">第 {product.sourceRow ?? index + 1} 行</td>
                    <td><input aria-label={`第 ${index + 1} 条商品名称`} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条 Item ID`} value={product.itemId ?? ''} onChange={(event) => updateProduct(index, { itemId: event.target.value || undefined })} /></td>
                    <td><input aria-label={`第 ${index + 1} 条表中数量`} inputMode="numeric" value={product.stockQuantity ?? ''} onChange={(event) => {
                      const value = event.target.value.trim();
                      updateProduct(index, { stockQuantity: value && Number.isFinite(Number(value)) ? Number(value) : undefined });
                    }} /></td>
                    <td><input aria-label={`第 ${index + 1} 条零售价`} inputMode="decimal" value={product.priceCents >= 0 ? priceForInput(product.priceCents) : ''} onChange={(event) => updateProduct(index, { priceCents: parsePriceToCents(event.target.value) ?? -1 })} /></td>
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
              <h2>新增前查一次</h2>
            </div>
            <label className="preview-search">
              <Search size={18} aria-hidden="true" />
              <input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="搜索名称或 Item ID" />
            </label>
            {previewQuery ? (
              <div className="preview-results">
                {previewProducts.length ? previewProducts.map((product) => <p key={product.id}><strong>{product.name}</strong><span>{formatPrice(product.priceCents)}</span></p>) : <p>未找到候选商品</p>}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {status ? <p className="success-notice" role="status">{status}</p> : null}
    </main>
  );
}
