import { useApp } from '../store';
import { useT } from '../i18n';
import type { Settings } from '../types';
import { ApiManager } from '../components/ApiManager';
import { BackupPanel } from '../components/tracker/BackupPanel';

import { loadEn, tx } from '../i18n/tx';
/** 语言名用本身的写法（不随界面语言翻译） */
const LANG_NATIVE_ZH = '中文';
export function SettingsPage() {
  const { settings, setSettings, isDemo } = useApp();
  const t = useT();
  return (
    <div className="page narrow">
      <div className="toolbar"><h2>{t('navSettings')}</h2></div>
      <div className="card form">
        <ApiManager />
      </div>
      <div className="card form">
        <label className="check"><input type="checkbox" data-testid="demo-toggle" checked={settings.demoMode} onChange={(e) => setSettings({ ...settings, demoMode: e.target.checked })} /> <span><b>{tx("演示模式")}</b>{tx("：不调用任何 AI，使用规则解析 / 关键词匹配 / 资料库原文与已有译文（缺失译文用「演示机翻」占位）")}</span></label>
        <label>{tx("岗位截图识别方式")}<select value={settings.ocrMode} onChange={(e) => setSettings({ ...settings, ocrMode: e.target.value as Settings['ocrMode'] })}><option value="local">{tx("浏览器本地识别（免费，默认；不把截图发给 AI）")}</option><option value="vision">{tx("AI 多模态模型识别（需在当前 API 的高级参数里填写多模态模型）")}</option></select></label>
        <label>{tx("界面语言")}<select value={settings.uiLang} onChange={(e) => { const next = e.target.value as 'zh' | 'en'; void (next === 'en' ? loadEn() : Promise.resolve()).catch(() => undefined).then(() => setSettings({ ...settings, uiLang: next })); }}><option value="zh">{LANG_NATIVE_ZH}</option><option value="en">{tx("English")}</option></select></label>
        <div className="notice">{t('privacy')}</div>
      </div>
      <BackupPanel isDemo={isDemo} />
    </div>
  );
}
