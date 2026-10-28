import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * 手机拍摄的条码照片常见两个问题，默认的 MultiFormatReader 都处理不了：
 * 1. EXIF 方向让条码在画面里是旋转 90/180/270 度的，一维码扫描行扫不到；
 * 2. 条码只占整张照片的一小块，按原始分辨率解码容易失败。
 * 所以这里显式打开 TRY_HARDER / ALSO_INVERTED，并按旋转角度与缩放多档重试。
 */
const POSSIBLE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
];

/** 长边上限，超过就等比缩小，避免超大原图拖慢解码。 */
const MAX_EDGE = 1600;

const ROTATIONS = [0, 90, 270, 180];
const SCALES = [1, 0.5];

export function createBarcodeReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, POSSIBLE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints as ConstructorParameters<typeof BrowserMultiFormatReader>[0]);
}

type LoadedImage = { image: HTMLImageElement; revoke: () => void };

async function loadImage(file: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { image, revoke: () => URL.revokeObjectURL(url) };
}

/**
 * 把图片按指定角度旋转并缩放到 canvas，用于多档重试。
 * invert=true 时做反色，用于识别浅底深字或反光造成的反色条码。
 */
function renderToCanvas(
  image: HTMLImageElement,
  rotation: number,
  scale: number,
  invert = false,
): HTMLCanvasElement {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const swap = rotation === 90 || rotation === 270;

  // 旋转后参与比对的边长变了，长边上限要按旋转后的尺寸算。
  const longEdge = swap ? Math.max(naturalHeight, naturalWidth) : Math.max(naturalWidth, naturalHeight);
  const fit = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const factor = fit * scale;

  const width = Math.max(1, Math.round(naturalWidth * factor));
  const height = Math.max(1, Math.round(naturalHeight * factor));

  const canvas = document.createElement('canvas');
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布上下文');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);

  if (invert) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 255 - data[index];
      data[index + 1] = 255 - data[index + 1];
      data[index + 2] = 255 - data[index + 2];
    }
    context.putImageData(pixels, 0, 0);
  }

  return canvas;
}

/**
 * 从用户选择的照片里解码条码。多角度、多缩放、正反色依次尝试，任一命中即返回。
 * 全部失败返回 null。
 */
export async function decodeBarcodeFromImage(file: Blob): Promise<string | null> {
  const { image, revoke } = await loadImage(file);
  const reader = createBarcodeReader();

  try {
    for (const invert of [false, true]) {
      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          let canvas: HTMLCanvasElement;
          try {
            canvas = renderToCanvas(image, rotation, scale, invert);
          } catch {
            continue;
          }
          try {
            return reader.decodeFromCanvas(canvas).getText();
          } catch {
            // NotFoundException：这一档没解出来，继续下一档。
          }
        }
      }
    }
    return null;
  } finally {
    revoke();
  }
}
