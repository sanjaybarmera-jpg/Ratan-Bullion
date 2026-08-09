/**
 * Client-side jewellery image compression.
 *
 * Purely a transport optimisation: it never touches category / collection /
 * product assignment. Originals (5-10 MB camera photos) are downscaled and
 * re-encoded in the browser; only the optimised bytes are uploaded.
 */

export type CompressedImage = {
  fileName: string;
  contentType: string;
  dataBase64: string;
  bytes: number;
  originalBytes: number;
  width: number;
  height: number;
};

export type CompressOptions = {
  /** Longest-edge cap in px. */
  maxDimension?: number;
  /** Soft size budget in KB; quality steps down until it fits. */
  targetKB?: number;
};

function supportsWebp(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

async function loadBitmap(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return { width: bmp.width, height: bmp.height, draw: bmp, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read image"));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: img,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read file"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

function baseName(name: string, ext: string) {
  return `${name.replace(/\.[^.]+$/, "") || "image"}.${ext}`;
}

/**
 * Resize (aspect preserved) + re-encode to WebP where supported, stepping the
 * quality down until the result fits the size budget.
 */
export async function compressImageFile(
  file: File,
  opts: CompressOptions = {},
): Promise<CompressedImage> {
  const maxDimension = opts.maxDimension ?? 1600;
  const targetBytes = (opts.targetKB ?? 300) * 1024;

  // Non-raster (e.g. SVG) or already tiny files pass through untouched.
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    const raw = await toBase64(file);
    return {
      fileName: file.name,
      contentType: file.type || "image/jpeg",
      dataBase64: raw,
      bytes: file.size,
      originalBytes: file.size,
      width: 0,
      height: 0,
    };
  }

  let src: Awaited<ReturnType<typeof loadBitmap>>;
  try {
    src = await loadBitmap(file);
  } catch {
    const raw = await toBase64(file);
    return {
      fileName: file.name,
      contentType: file.type || "image/jpeg",
      dataBase64: raw,
      bytes: file.size,
      originalBytes: file.size,
      width: 0,
      height: 0,
    };
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(src.width, src.height));
    const width = Math.max(1, Math.round(src.width * scale));
    const height = Math.max(1, Math.round(src.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src.draw, 0, 0, width, height);

    const webp = supportsWebp();
    const type = webp ? "image/webp" : "image/jpeg";
    const ext = webp ? "webp" : "jpg";

    let blob: Blob | null = null;
    for (const q of [0.86, 0.78, 0.7, 0.62, 0.55, 0.45]) {
      blob = await canvasToBlob(canvas, type, q);
      if (blob && blob.size <= targetBytes) break;
    }
    if (!blob) throw new Error("Could not encode image");

    // Never send something bigger than the original.
    if (blob.size >= file.size) {
      return {
        fileName: file.name,
        contentType: file.type || "image/jpeg",
        dataBase64: await toBase64(file),
        bytes: file.size,
        originalBytes: file.size,
        width: src.width,
        height: src.height,
      };
    }

    return {
      fileName: baseName(file.name, ext),
      contentType: type,
      dataBase64: await toBase64(blob),
      bytes: blob.size,
      originalBytes: file.size,
      width,
      height,
    };
  } finally {
    src.close();
  }
}

/** Product gallery images — richer detail budget. */
export const PRODUCT_IMAGE_OPTS: CompressOptions = { maxDimension: 1600, targetKB: 300 };
/** Category / collection thumbnails — smaller budget. */
export const THUMB_IMAGE_OPTS: CompressOptions = { maxDimension: 1000, targetKB: 150 };
