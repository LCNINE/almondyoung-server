'use client';

import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CardErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            {this.state.error.message || '카드 내용을 불러오지 못했습니다.'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
