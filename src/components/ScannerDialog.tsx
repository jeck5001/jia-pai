import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type ScannerDialogProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
};

type CameraMode = 'probing' | 'live' | 'unsupported';

const DEFAULT_HINT = '请将包装条码置于取景框内';

/**
 * 微信内置浏览器（X5/XWeb 内核）不实现 getUserMedia，且 http:// 内网地址
 * 不属于安全上下文，navigator.mediaDevices 会被浏览器直接置为 undefined。
 * 这两种情况下实时扫码必然失败，只能降级到「拍照/相册选图后解码」。
 */
function liveCameraUnavailableReason(): string | null {
  if (typeof navigator === 'undefined') return '当前环境不支持调用相机';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
    if (isWeChat) {
      return '微信内置浏览器不支持网页直接调用相机，已切换为拍照识别';
    }
    if (!window.isSecureContext) {
      return '当前页面不是 HTTPS 安全连接，浏览器禁止调用相机，已切换为拍照识别';
    }
    return '当前浏览器不支持网页调用相机，已切换为拍照识别';
  }
  return null;
}

function isWeChatBrowser(): boolean {
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
}

export function ScannerDialog({ open, onClose, onDetected }: ScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(DEFAULT_HINT);
  const [mode, setMode] = useState<CameraMode>('probing');
  const [isDecodingPhoto, setIsDecodingPhoto] = useState(false);

  // onDetected 每次渲染都是新函数，放进 ref 避免 effect 反复重跑重复开摄像头。
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return undefined;

    const reason = liveCameraUnavailableReason();
    if (reason) {
      setMode('unsupported');
      setMessage(reason);
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;

    setMode('probing');
    setMessage(DEFAULT_HINT);

    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video,
        (result, error) => {
          if (stopped) return;
          if (result) {
            stopped = true;
            controls?.stop();
            onDetectedRef.current(result.getText());
            return;
          }
          if (error && error.name !== 'NotFoundException') {
            setMessage('相机暂时无法读取条码，请调整距离或改用拍照识别');
          }
        },
      )
      .then((nextControls) => {
        controls = nextControls;
        if (stopped) {
          controls.stop();
          return;
        }
        setMode('live');
        setMessage(DEFAULT_HINT);
      })
      .catch((error: unknown) => {
        if (stopped) return;
        const name = error instanceof Error ? error.name : '';
        setMode('unsupported');
        if (name === 'NotAllowedError') {
          setMessage('相机权限被拒绝，可在浏览器设置中允许后重试，或改用拍照识别');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setMessage('未检测到可用的摄像头，已切换为拍照识别');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          setMessage('摄像头被其他应用占用，已切换为拍照识别');
        } else {
          setMessage('无法打开相机，已切换为拍照识别');
        }
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open]);

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 允许重复选择同一张照片。
    event.target.value = '';
    if (!file) return;

    setIsDecodingPhoto(true);
    setMessage('正在识别照片中的条码…');

    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      onDetectedRef.current(result.getText());
    } catch {
      setMessage('照片中没有识别到条码，请靠近条码重新拍摄，或改用名称搜索');
    } finally {
      URL.revokeObjectURL(objectUrl);
      setIsDecodingPhoto(false);
    }
  }

  if (!open) return null;

  const showLiveVideo = mode === 'live' || mode === 'probing';
  const showWeChatTip = mode === 'unsupported' && isWeChatBrowser();

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

        <div className={`scanner-viewfinder${showLiveVideo ? '' : ' scanner-viewfinder-idle'}`}>
          {showLiveVideo ? (
            <>
              <video ref={videoRef} muted playsInline aria-label="条码扫描取景器" />
              <div className="scanner-frame" aria-hidden="true" />
              <Camera className="scanner-icon" size={20} aria-hidden="true" />
            </>
          ) : (
            <div className="scanner-fallback" aria-hidden="true">
              <ImageIcon size={34} />
              <span>拍照识别条码</span>
            </div>
          )}
        </div>

        <p className="scanner-message" role="status">{message}</p>

        {mode === 'unsupported' ? (
          <>
            <button
              className="scanner-photo-button"
              type="button"
              disabled={isDecodingPhoto}
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera size={18} aria-hidden="true" />
              <span>{isDecodingPhoto ? '正在识别…' : '拍照 / 从相册选择'}</span>
            </button>
            <input
              ref={fileInputRef}
              className="scanner-file-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
            />
            {showWeChatTip ? (
              <p className="scanner-tip">
                小提示：点击右上角 ··· 选择「在浏览器打开」，可直接使用实时扫码。
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
