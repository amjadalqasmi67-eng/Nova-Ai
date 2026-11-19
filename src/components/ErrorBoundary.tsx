import { Component, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  public componentDidCatch(error: Error) {
    console.error('Nova AI ErrorBoundary:', error);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen bg-slate-50 dark:bg-[#050711] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6"
          dir="rtl"
        >
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 p-8 text-center shadow-lg">
            <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold mb-2">حدث خلل غير متوقع في Nova AI</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              واجهت الواجهة خطأً تقنيًا مؤقتًا. يمكنك إعادة تحميل التطبيق لاستئناف عملك بأمان.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل الواجهة</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
