import React, { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React plugin error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: '#f87171', fontFamily: 'Inter, sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
          <p style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {this.state.error?.message}
          </p>
          <button 
            onClick={() => window.parent.postMessage({ pluginMessage: { type: 'cancel-request' } }, '*')} 
            style={{ marginTop: '16px', padding: '8px 12px', background: '#374151', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Please close and restart the plugin
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
