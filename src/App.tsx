import { useState } from 'react';
import { AppProvider, useApp } from './store';
import { useT, type MsgKey } from './i18n';
import { ProfilePage } from './pages/ProfilePage';
import { JobPage } from './pages/JobPage';
import { GeneratePage } from './pages/GeneratePage';
import { LayoutPage } from './pages/LayoutPage';
import { SettingsPage } from './pages/SettingsPage';
import { WizardPage } from './pages/WizardPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FEATURES } from './features';
import { exitDemoUrl } from './storage/mode';

import { loadEn, tx } from './i18n/tx';
/** 切换按钮上用语言本身的写法 */
const LANG_NATIVE_ZH = '中文';
const NAV: [string, MsgKey][] = [['applications', 'navApplications'], ['profile', 'navProfile'], ['layout', 'navLayout'], ['settings', 'navSettings']];
const ADV: [string, MsgKey][] = [['job', 'navJob'], ['generate', 'navGenerate']];

function Shell() {
  const { ready, loadError, settings, setSettings, isDemo } = useApp();
  const t = useT();
  const [page, setPageS] = useState(() => location.hash.slice(1) || 'wizard');
  const go = (p: string) => { setPageS(p); window.history.replaceState(null, '', `#${p}`); window.scrollTo(0, 0); };
  if (loadError) return <div className="notice error" role="alert">{tx("本地资料读取或升级失败。数据库升级事务失败会整体回滚，程序不会清库或重置密钥。请保留浏览器数据，关闭其他标签页后重试；若仍失败，请返回上一版本并导出备份。")}<button onClick={() => location.reload()}>{tx("重新读取")}</button></div>;
  if (!ready) return <div className="loading">{tx("加载中…")}</div>;
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">📄 {t('appName')}</div>
        <button className={page === 'wizard' ? 'active main-nav' : 'main-nav'} onClick={() => go('wizard')}>{t('navWizard')}</button>
        {NAV.map(([k, m]) => <button key={k} data-testid={`nav-${k}`} className={page === k || page.startsWith(`${k}/`) ? 'active' : ''} onClick={() => go(k)}>{t(m)}</button>)}
        <details className="adv-menu"><summary>{settings.uiLang === 'en' ? 'Advanced' : tx("高级")}</summary>{ADV.map(([k, m]) => <button key={k} className={page === k ? 'active' : ''} onClick={(e) => { go(k); (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>{t(m)}</button>)}</details>
        <span className="spacer" />
        {FEATURES.uiLangSwitch && <button className="lang-switch" title={tx("中文 / English")} onClick={() => { const next = settings.uiLang === 'en' ? 'zh' : 'en'; void (next === 'en' ? loadEn() : Promise.resolve()).catch(() => undefined).then(() => setSettings({ ...settings, uiLang: next })); }}>{settings.uiLang === 'en' ? LANG_NATIVE_ZH : 'EN'}</button>}
        {settings.demoMode && <button className="badge st-machine" onClick={() => go('settings')}>{t('demoBadge')}</button>}
      </nav>
      {isDemo && <div className="notice warn demo-banner" data-testid="demo-banner">{tx("演示模式：这里的资料是示例，保存在独立的演示数据库里，")}<b>{tx("不会改动你的真实资料")}</b>。<a href={exitDemoUrl()}>{tx("退出演示 →")}</a></div>}
      <main>
        {page === 'wizard' && <WizardPage go={go} />}
        {(page === 'applications' || page.startsWith('applications/')) && <ApplicationsPage sub={page.startsWith('applications/') ? page.slice('applications/'.length) : ''} go={go} />}
        {page === 'profile' && <ProfilePage />}
        {page === 'job' && <JobPage go={go} />}
        {page === 'generate' && <GeneratePage go={go} />}
        {page === 'layout' && <LayoutPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
      <footer className="app-footer muted small" data-testid="app-footer">
        <span>CVPair · {tx("开源免费")} · <a href="https://github.com/RanRuiqian/cvpair" target="_blank" rel="noreferrer">GitHub</a></span>
        <span>{tx("资料只保存在你的浏览器里；换设备请用「设置 → 备份与恢复」。")}</span>
      </footer>
    </div>
  );
}

export default function App() { return <ErrorBoundary><AppProvider><Shell /></AppProvider></ErrorBoundary>; }
