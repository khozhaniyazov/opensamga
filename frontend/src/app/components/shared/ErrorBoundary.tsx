import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, BookOpen } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <div className="w-14 h-14 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle size={24} className="text-amber-600" />
            </div>
            <h1
              className="text-zinc-800 mb-2"
              style={{ fontSize: 20, fontWeight: 700 }}
            >
              Произошла ошибка
            </h1>
            <p
              className="text-zinc-500 mb-6"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              Что-то пошло не так. Попробуйте обновить страницу.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              <RefreshCw size={16} />
              Обновить страницу
            </button>
            <div className="mt-8 flex items-center gap-2 justify-center opacity-30">
              <div className="w-5 h-5 rounded bg-amber-500 flex items-center justify-center">
                <BookOpen size={10} className="text-white" />
              </div>
              <span className="text-zinc-400" style={{ fontSize: 12 }}>
                Samga.ai
              </span>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
