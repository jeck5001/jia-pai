import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type ScannerDialogProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
};

export function ScannerDialog({ open, onClose, onDetected }: ScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('请将包装条码置于取景框内');

  useEffect(() => {
    if (!open || !videoRef.current) return undefined;

    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result, error) => {
          if (result && !stopped) {
            stopped = true;
            controls?.stop();
            onDetected(result.getText());
            return;
          }
          if (error && error.name !== 'NotFoundException' && !stopped) {
            setMessage('相机暂时无法读取条码，请调整距离或改用搜索');
          }
        },
      )
      .then((nextControls) => {
        controls = nextControls;
        if (stopped) controls.stop();
      })
      .catch(() => {
        if (!stopped) setMessage('无法打开相机，请允许相机权限后重试');
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onDetected, open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="scanner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">相机扫描</span>
            <h2 id="scanner-title">扫描商品条码</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭扫码窗口" title="关闭">
            <X size={20} strokeWidth={2.2} />
          </button>
        </header>
        <div className="scanner-viewfinder">
          <video ref={videoRef} muted playsInline aria-label="条码扫描取景器" />
          <div className="scanner-frame" aria-hidden="true" />
          <Camera className="scanner-icon" size={20} aria-hidden="true" />
        </div>
        <p className="scanner-message" role="status">{message}</p>
      </section>
    </div>
  );
}
