import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

export function App() {
  const [apiStatus, setApiStatus] = useState('正在连接服务…');

  useEffect(() => {
    apiRequest('/health')
      .then(() => setApiStatus('前后端连接正常'))
      .catch(() => setApiStatus('API 暂不可用，请确认后端已启动'));
  }, []);

  return (
    <main className="shell">
      <section className="welcome-card">
        <div className="eyebrow">PERSONAL FINANCE TRACKER</div>
        <h1>让每一笔收支都有据可查。</h1>
        <p>项目骨架已就绪。接下来将逐步接入账户、交易、预算与分析功能。</p>
        <div className="status"><span className="status-dot" />{apiStatus}</div>
      </section>
      <footer>Mini Finance Tracker <span>·</span> React + Express + MongoDB</footer>
    </main>
  );
}
