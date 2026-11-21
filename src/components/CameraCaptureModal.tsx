import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Camera, RefreshCw, X, Send, Paperclip, RotateCcw, Upload } from 'lucide-react';
import { CompressedImage, compressImageFile } from '../lib/imageUtils';

interface CameraCaptureModalProps {
  onClose: () => void;
  onAttach: (image: CompressedImage) => void;
  onAnalyzeNow: (image: CompressedImage) => void;
}

export function CameraCaptureModal({ onClose, onAttach, onAnalyzeNow }: CameraCaptureModalProps) {
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [captured, setCaptured] = useState<CompressedImage | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (captured) {
      stopStream();
      return;
    }

    let cancelled = false;
    const startCamera = async () => {
      setIsStarting(true);
      setCameraError(null);
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('المتصفح الحالي لا يدعم البث المباشر للكاميرا، يمكنك التقاط صورة مباشرة بالزر أدناه.');
        setIsStarting(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setCameraError('تعذر فتح الكاميرا مباشرة. تأكد من منح إذن الكاميرا أو التقط صورة عبر كاميرا الجهاز.');
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    };

    startCamera();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, captured]);

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    setIsProcessing(true);
    try {
      const canvas = document.createElement('canvas');
      const maxDim = 1280;
      let width = video.videoWidth;
      let height = video.videoHeight;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('تعذر التقاط الصورة');

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      setCaptured({
        data: dataUrl.split(',')[1] || '',
        mimeType: 'image/jpeg',
        previewUrl: dataUrl,
      });
    } catch {
      setCameraError('تعذر التقاط الصورة من الكاميرا. جرب مرة أخرى.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNativeFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setCameraError(null);
    try {
      const compressed = await compressImageFile(file);
      setCaptured(compressed);
    } catch {
      setCameraError('تعذر معالجة الصورة المختارة.');
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="كاميرا التحليل الذكي"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Camera className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>التصوير والتحليل الذكي</span>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="إغلاق الكاميرا"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewport */}
        <div className="relative bg-black aspect-[4/3] w-full flex items-center justify-center overflow-hidden">
          {captured ? (
            <img
              src={captured.previewUrl}
              alt="اللقطة الملتقطة"
              className="w-full h-full object-contain"
            />
          ) : cameraError ? (
            <div className="p-6 text-center space-y-4 max-w-sm">
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">{cameraError}</p>
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="accent-btn inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>فتح كاميرا الجهاز أو اختيار صورة</span>
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {isStarting && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-white">
                  جاري تشغيل الكاميرا...
                </div>
              )}
            </>
          )}

          <input
            ref={nativeCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleNativeFileChange}
            className="hidden"
          />
        </div>

        {/* Controls */}
        <div className="p-4 bg-slate-50 dark:bg-[#070B17] border-t border-slate-200 dark:border-white/10">
          {captured ? (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => setCaptured(null)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#101830] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة التصوير</span>
              </button>

              <div className="flex items-center gap-2 flex-1 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onAttach(captured);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#101830] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-800 dark:text-white cursor-pointer"
                >
                  <Paperclip className="w-4 h-4" />
                  <span>إرفاق لكتابة سؤال</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAnalyzeNow(captured);
                    onClose();
                  }}
                  className="accent-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  <Send className="w-4 h-4 rotate-180" />
                  <span>تحليل الصورة فورًا</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white dark:bg-[#101830] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>تبديل الكاميرا</span>
              </button>

              <button
                type="button"
                disabled={isStarting || isProcessing || Boolean(cameraError)}
                onClick={handleCapture}
                className="accent-btn inline-flex items-center gap-2 px-6 py-2.5 rounded-xl disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>{isProcessing ? 'جاري الالتقاط...' : 'التقاط صورة'}</span>
              </button>

              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white dark:bg-[#101830] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">كاميرا النظام</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
