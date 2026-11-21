export interface CompressedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذر قراءة الصورة المختارة.'));
    img.src = src;
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر تحميل ملف الصورة.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Compresses any uploaded or captured image (even 10+ MB camera photos)
 * into a crisp, fast JPEG payload for Gemini Vision analysis.
 */
export async function compressImageFile(
  file: Blob,
  maxDimension = 1280,
  quality = 0.85
): Promise<CompressedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let width = img.naturalWidth || img.width || 800;
    let height = img.naturalHeight || img.height || 600;

    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallbackUrl = await readBlobAsDataUrl(file);
      return {
        data: fallbackUrl.split(',')[1] || '',
        mimeType: file.type || 'image/jpeg',
        previewUrl: fallbackUrl,
      };
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const jpegUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      data: jpegUrl.split(',')[1] || '',
      mimeType: 'image/jpeg',
      previewUrl: jpegUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Center-crops and compresses a user profile avatar to 160x160 JPEG
 * so it easily fits inside Firestore document size limits (< 45 KB).
 */
export async function compressAvatarFile(file: Blob, size = 160): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const srcW = img.naturalWidth || img.width || size;
    const srcH = img.naturalHeight || img.height || size;
    const cropSize = Math.min(srcW, srcH);
    const sx = Math.floor((srcW - cropSize) / 2);
    const sy = Math.floor((srcH - cropSize) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('تعذر معالجة الصورة على هذا المتصفح.');
    }

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 58000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    }
    if (dataUrl.length > 64000) {
      throw new Error('حجم الصورة بعد الضغط لا يزال كبيرًا. جرب صورة أخرى.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
