import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { SessionGate } from './auth/SessionGate';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="fatal-error"><h1>工作台未能開啟</h1><p>請重新整理頁面。本機資料不會被自動刪除。</p><button onClick={() => location.reload()}>重新整理</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><SessionGate><App /></SessionGate></ErrorBoundary></StrictMode>);
