import { JointJobsInput } from '../components/JointJobsInput';
import { EvidenceReport } from '../components/EvidenceReport';
import { AiDisclosure } from '../components/AiDisclosure';
import { uiStorage } from '../storage/mode';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../store';
import type { Lang, PhotoPosition, TemplateConfig } from '../types';
import { SetupCard } from '../components/SetupCard';
import { ItemsEditor } from '../components/ItemsEditor';
import { ResumeNotice } from '../components/ResumeNotice';
import { MaterialPool } from '../components/MaterialPool';
import { ExportDialog } from '../components/ExportDialog';
import { importProfileFromText, mergeProfiles } from '../ai/importProfile';
import { translateProfile } from '../ai/translate';
import { recognizeScreenshot } from '../ai/ocr';
import { analyzeJob, isAnalysisStale } from '../ai/jd';
import { extractJdBody } from '../ai/jdText';
import { JD_PREFILL_KEY, TRACKER_RETURN_KEY, type TrackerReturn } from '../tracker/useTracker';
import { linkResumeSnapshot } from '../tracker/repo';
import { defaultPdfLangs, storeResumePdfs } from '../tracker/quickRecord';
import { makeResumePdfs } from '../tracker/resumePdf';
import { db } from '../storage/db';
import { generateResume, localizeAi, runConsistency } from '../ai/generate';
import { fillResumeLabels, resumeLabelTargets } from '../ai/labels';
import { trimToPages } from '../ai/trim';
import { forEachText, needsTranslation, lt } from '../locale/text';
import { normalizeProfile } from '../storage/profileIO';
import { buildLayout } from '../render/layout';
import { englishResidue } from '../render/enResidue';
import { fillEnglishResidue } from '../ai/enFill';
import { fitToOnePage, describeFit, FIT_LIMITS, type LangFit } from '../export/autoOnePage';
import { Preview } from '../render/Preview';
import { useEditTemplate } from '../render/useEditTemplate';
import { FormatPanel } from '../components/FormatPanel';
import { makeGenericJob } from '../ai/genericJob';
import { JobExplainPanel } from '../components/JobExplainPanel';
import { measurePages, type PageInfo } from '../export/client';
import { fileToDataUrl } from '../utils/download';
import sample from '../sample/sample-profile.json';
import { SAMPLE_JD } from '../sample/sampleJd';
import { ALL_TEMPLATES } from '../templates';
import { fileToText } from '../ai/fileText';
import { ProgressNote } from '../components/ProgressNote';
import { PhotoCropper } from '../components/PhotoCropper';
import { JobHistory } from '../components/JobHistory';
import { ResumeFactsOptions } from '../components/ResumeFactsOptions';
import { CareerKit } from '../components/CareerKit';
import { FEATURES } from '../features';
import { useL } from '../i18n';

import { tx, txDeep, txPick } from '../i18n/tx';
const STEPS: [string, string][] = txDeep([["填写我的资料", 'My profile'], ["上传岗位要求", 'Target job'], ["编辑与下载", 'Edit & download']]);
const COLORS = [['#1a365d', '#2b6cb0'], ['#0f4c5c', '#e36414'], ['#3c096c', '#7b2cbf'], ['#22543d', '#38a169'], ['#1a1a1a', '#555555']];

export function WizardPage({ go }: { go: (p: string) => void }) {
  const app = useApp();
  const L = useL();
  const { settings, profile, job, resume } = app;
  const hasProfile = !!(profile.profile.name.zh || profile.profile.name.en || profile.work.length || profile.education.length);
  const [step, setStepS] = useState(() => Math.min(3, Number(uiStorage.getItem('wizardStep')) || (resume ? 3 : job ? 2 : hasProfile ? 2 : 1)));
  const setStep = (n: number) => { setStepS(n); uiStorage.setItem('wizardStep', String(n)); window.scrollTo(0, 0); };
  const can = [true, hasProfile, hasProfile && !!job];
  const cur = can[step - 1] ? step : Math.max(1, can.lastIndexOf(true) + 1 > 3 ? 3 : can.lastIndexOf(true) + 1);

  if (!settings.setupDone) return <div className="page wizard"><Hero /><SetupCard /></div>;
  return (
    <div className="page wizard">
      <ol className="stepper">
        {STEPS.map(([zs, es], i) => { const s = L(zs, es); return (
          <li key={zs} className={`${cur === i + 1 ? 'active' : ''} ${cur > i + 1 ? 'done' : ''}`}>
            <button disabled={!can[i]} onClick={() => setStep(i + 1)}><span className="num">{cur > i + 1 ? '✓' : i + 1}</span>{s}</button>
          </li>
        ); })}
      </ol>
      <TrackerReturnBanner go={go} />
      {settings.demoMode && <div className="notice warn">{L('当前为演示模式：不调用 AI，只做关键词匹配，英文缺失处用占位文字。', 'Demo mode: no AI calls — keyword matching only, missing translations use placeholders.')}<button className="link" onClick={() => go('settings')}>{L('连接 AI 服务 →', 'Connect AI →')}</button></div>}
      {cur === 1 && <Step1 next={() => setStep(2)} go={go} hasProfile={hasProfile} />}
      {cur === 2 && <Step2 next={() => { uiStorage.setItem(GEN_REQUEST, '1'); setStep(3); }} back={() => setStep(1)} />}
      {cur === 2 && <JobHistory onOpen={() => setStep(3)} go={go} />}
      {cur === 3 && <Step3 back={() => setStep(2)} go={go} />}
    </div>
  );
}

/** 从「求职投递」岗位详情进入时显示：生成后一键把简历快照关联回该岗位 */
function TrackerReturnBanner({ go }: { go: (p: string) => void }) {
  const { resume, profile, job, template } = useApp();
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState<TrackerReturn | null>(() => { try { const v = uiStorage.getItem(TRACKER_RETURN_KEY); return v ? JSON.parse(v) : null; } catch { return null; } });
  const [err, setErr] = useState('');
  if (!ret) return null;
  const clear = () => { uiStorage.setItem(TRACKER_RETURN_KEY, ''); setRet(null); };
  const linkBack = async () => {
    if (!resume) return;
    setBusy(true);
    try {
      await linkResumeSnapshot(db, ret.applicationId, { resume, profile, job, label: tx("{0} · 生成于 {1}", ret.label, resume.createdAt.slice(0, 16).replace('T', ' ')) });
      // 2026-11：同时存放工具生成的 PDF（失败不影响关联，可在岗位详情里重新生成）
      try {
        const langs = defaultPdfLangs(job);
        const r = await makeResumePdfs(profile, template, resume, job, { company: ret.label.split(' · ')[0] ?? '', title: ret.label.split(' · ')[1] ?? '' }, langs);
        await storeResumePdfs(db, ret.applicationId, ret.postingId, r.files, 'generated', { replaceGenerated: true });
      } catch (e) { console.warn('store generated pdf failed', e); }
      clear(); go(`applications/${ret.postingId}`);
    }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="notice tracker-return" data-testid="tracker-return">
      {tx("正在为岗位「")}<b>{ret.label}</b>{tx("」准备简历。生成并检查满意后：")}
      <button className="primary" data-testid="link-back" disabled={!resume || busy} onClick={linkBack}>{busy ? tx("正在存放简历 PDF…") : tx("关联当前简历并返回该岗位")}</button>
      <button className="link" onClick={() => go(`applications/${ret.postingId}`)}>{tx("先返回岗位")}</button><button className="link" onClick={clear}>{tx("不关联")}</button>
      {err && <div className="bad">{err}</div>}
    </div>
  );
}

function Hero() {
  const L = useL();
  return (
    <div className="hero-text">
      <h1>{L('上传岗位截图，一键生成中英文简历', 'Screenshot a job post, get a tailored resume in Chinese & English')}</h1>
      <p>{L('填一次个人资料 → 每投一个岗位，上传它的招聘截图 → 自动挑选最相关的经历、改写贴合岗位 → 下载中文 / 英文的 PDF 和 Word。', 'Fill in your profile once → for each job, upload the posting screenshot → the most relevant experience is picked and rewritten to fit → download Chinese / English PDF and Word.')}</p>
      <div className="hero-points" data-testid="hero-points">
        <div><b>{tx("🔒 数据只在你的浏览器")}</b><span>{tx("没有账号、没有服务器；资料、简历、投递记录都存在本机，只有你选的 AI 服务商会收到生成所需的内容。")}</span></div>
        <div><b>{tx("🔁 一份资料，中英两版")}</b><span>{tx("中英文由同一份资料生成，并自动核对两版的数字、日期是否一致。")}</span></div>
        <div><b>{tx("📋 投完也能管")}</b><span>{tx("拖入投递成功截图自动建记录，并保存当时投出去的那份简历。")}</span></div>
      </div>
      <div className="row center hero-actions">
        <a className="button" data-testid="hero-demo" href={`${window.location.pathname}?demo#wizard`}>{tx("👀 先看演示（示例资料，不需要 API Key）")}</a>
      </div>
    </div>
  );
}

function Step1({ next, go, hasProfile }: { next: () => void; go: (p: string) => void; hasProfile: boolean }) {
  const { profile, setProfile, settings, replaceProfile } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const [adding, setAdding] = useState(!hasProfile);
  const [prog, setProg] = useState<{ m: string; p?: number } | null>(null);
  const loadFile = async (f: File) => {
    setMsg(null); setProg({ m: tx("读取 {0}", f.name) });
    try { const t = await fileToText(f, (m, p) => setProg({ m, p })); if (!t.trim()) throw new Error(tx("没有读到文字")); setText(t); setMsg({ t: 'ok', m: tx("已读取 {0}（{1} 字），请检查后点「AI 帮我整理」。", f.name, t.length) }); }
    catch (e) { setMsg({ t: 'error', m: tx("读取失败：") + (e as Error).message }); } finally { setProg(null); }
  };

  const importText = async () => {
    if (settings.demoMode) { setMsg({ t: 'error', m: tx("演示模式无法 AI 整理文字。请先连接 AI 服务，或点「先看看示例」。") }); return; }
    setBusy(tx("AI 正在整理你的经历（约 10–30 秒）…")); setMsg(null);
    try {
      let p = mergeProfiles(profile, await importProfileFromText(settings, text));
      setBusy(tx("正在自动翻译成英文…"));
      try { p = (await translateProfile(settings, p, p.primaryLanguage === 'zh' ? 'en' : 'zh')).profile; } catch { /* 翻译失败不影响导入 */ }
      await replaceProfile(p, tx("AI 整理经历前")); setText(''); setAdding(false);
      setMsg({ t: 'ok', m: tx("已整理：{0} 段工作、{1} 个项目、{2} 段教育、{3} 项技能。请核对下面的信息。", p.work.length, p.projects.length, p.education.length, p.skills.length) });
    } catch (e) { setMsg({ t: 'error', m: tx("整理失败：") + (e as Error).message }); }
    finally { setBusy(''); }
  };
  let missing = 0, machine = 0;
  forEachText(profile, (t, path) => { if (path === 'profile.summary') return; if (needsTranslation(t, 'en') || needsTranslation(t, 'zh')) missing++; if (t.status?.en === 'machine' || t.status?.zh === 'machine') machine++; });
  const fixTranslate = async () => {
    setBusy(tx("翻译中…"));
    try { let p = (await translateProfile(settings, profile, 'en')).profile; p = (await translateProfile(settings, p, 'zh')).profile; setProfile(p); }
    catch (e) { setMsg({ t: 'error', m: (e as Error).message }); } finally { setBusy(''); }
  };
  const pr = profile.profile;

  return (
    <div className="step">
      <h2>{tx("① 你的个人资料")}</h2>
      <p className="muted">{tx("资料只需填一次，以后结合岗位挑选有价值的经历，并兼顾职业与组织背景。请写清实际做过什么、用了什么方法；有真实成果再填写数字。")}</p>
      {hasProfile && (
        <div className="card profile-summary">
          <div className="row">
            <PhotoPicker />
            <div className="grow">
              <div className="big-name">{lt(pr.name, 'zh') || tx("（未填写姓名）")} <span className="muted">{pr.name.en && pr.name.en !== pr.name.zh ? pr.name.en : ''}</span></div>
              <div className="muted">{lt(pr.headline, 'zh')} · {[pr.contacts.phone, pr.contacts.email].filter(Boolean).join(' · ')}</div>
              <div className="chips">
                <span className="chip">{tx("工作")} {profile.work.length}</span><span className="chip">{tx("项目")} {profile.projects.length}</span><span className="chip">{tx("教育")} {profile.education.length}</span>
                <span className="chip">{tx("技能")} {profile.skills.length}</span><span className="chip">{tx("证书/获奖")} {profile.certificates.length + profile.awards.length}</span>
              </div>
            </div>
          </div>
          {profile.work.slice(0, 4).map((w) => <div key={w.id} className="small">💼 {lt(w.company, 'zh')} · {lt(w.title, 'zh')}（{w.bullets.length} {tx("条经历）")}</div>)}
          {missing > 0 && <div className="notice warn">{tx("有")} {missing} {tx("处缺少英文/中文版本。")}<button disabled={!!busy || settings.demoMode} onClick={fixTranslate}>{tx("一键自动翻译")}</button></div>}
          {machine > 0 && <div className="muted small">ℹ {machine} {tx("处是机器翻译，建议在「详细编辑」里扫一眼。")}</div>}
          <div className="row">
            <button onClick={() => go('profile')}>{tx("✏️ 详细编辑资料")}</button>
            {!adding && <button onClick={() => setAdding(true)}>{tx("➕ 粘贴更多经历")}</button>}
            <span className="spacer" />
            <button className="primary big" onClick={next}>{tx("资料没问题，下一步 →")}</button>
          </div>
        </div>
      )}
      {adding && (
        <div className="card">
          <h3>{hasProfile ? tx("粘贴补充的经历") : tx("最快的方式：把你现有的简历文字粘贴进来")}</h3>
          <p className="muted small">{tx("可以是旧简历、LinkedIn 简介、随手写的经历——中文或英文都行。AI 只整理你写的内容，不会编造；整理后会自动生成另一种语言。")}</p>
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("例如：\n张三，138xxxx，zhangsan@xx.com\n2021.07-至今 某某科技 高级前端工程师\n- 主导编辑器重构，首屏加载降低 40%\n...\n2014-2018 某某大学 计算机 本科")} />
          <div className="row">
            <label className="filebtn">{tx("📄 上传旧简历（PDF / Word / 图片 / txt）")}<input data-testid="resume-file" type="file" accept=".pdf,.docx,.doc,.txt,.md,text/plain,application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} /></label>
            <span className="spacer" />
            {!hasProfile && <button onClick={() => setProfile(normalizeProfile(sample))}>{tx("先看看示例")}</button>}
            {!hasProfile && <button onClick={() => go('profile')}>{tx("我想手动逐项填写")}</button>}
            <button className="primary big" disabled={!text.trim() || !!busy} onClick={importText}>{tx("✨ AI 帮我整理")}</button>
          </div>
        </div>
      )}
      {prog && <ProgressNote msg={prog.m} pct={prog.p} />}
      {busy && <div className="notice"><span className="spinner" /> {busy}</div>}
      {msg && <div className={`notice ${msg.t}`}>{msg.m}</div>}
    </div>
  );
}

function PhotoPicker() {
  const { profile, setProfile } = useApp();
  const [src, setSrc] = useState('');
  return (
    <>
      <label className="photo-pick" title={tx("点击上传证件照（仅用于中文版，保存在本机）")}>
        {profile.profile.photo ? <img src={profile.profile.photo} style={{ aspectRatio: String(profile.profile.photoAspect ?? 0.75) }} /> : <span>＋<br />{tx("照片")}</span>}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSrc(await fileToDataUrl(f)); e.target.value = ''; }} />
      </label>
      {src && <PhotoCropper src={src} onCancel={() => setSrc('')} onDone={(url, aspect) => { const p = structuredClone(profile); p.profile.photo = url; p.profile.photoAspect = aspect; setProfile(p); setSrc(''); }} />}
    </>
  );
}

function Step2({ next, back }: { next: () => void; back: () => void }) {
  const { job, setJob } = useApp();
  const [joint, setJoint] = useState(() => uiStorage.getItem('jdMode') === 'joint' || !!job?.joint);
  const mode = (value: boolean) => { setJoint(value); uiStorage.setItem('jdMode', value ? 'joint' : 'single'); if (!value && job?.joint) setJob(null); };
  return <><div className="row card"><button disabled={!joint} onClick={() => mode(false)}>{tx("单岗位模式")}</button><button data-testid="joint-mode" disabled={joint} onClick={() => mode(true)}>{tx("同一企业多岗位联合匹配（1–3 个）")}</button></div>{joint ? <JointJobsInput next={next} back={back} /> : <SingleStep2 next={next} back={back} />}</>;
}

/**
 * 2026-11（第三轮）：岗位页与生成过程的状态放在组件外。
 * 负责人反馈：上传截图 / AI 正在识别时切到「设置」或「版式设置」，回来后截图、文字、进度全没了。
 * 原因是这些都存在组件本地 state，切页面组件被卸载。现在放到模块级存储（应用内切换页面不丢），
 * 岗位文字另存 uiStorage（刷新也不丢）；识别 / 分析 / 生成任务在后台继续，回来时显示进度与结果。
 */
const GEN_REQUEST = 'genRequest';
/** 元素当前可用宽度（display:none 时 clientWidth 为 0，保留上一次的值） */
function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const update = () => { if (el.clientWidth) setW(el.clientWidth); };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return w;
}
/** 生成耗时提示：联合岗位深度思考可能要好几分钟，让用户知道仍在运行。 */
function Elapsed() {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t0 = Date.now(); const h = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000); return () => clearInterval(h); }, []);
  return <span className="muted small">{tx("（已用时")} {Math.floor(sec / 60)} {tx("分")} {sec % 60} {tx("秒；联合岗位可能需要 5–15 分钟，请勿关闭页面）")}</span>;
}
type JdDraft = { init: boolean; jobId?: string; shots: { url: string; raw: string }[]; text: string; edited: boolean; busy: string; pct?: number; err: string; info: string };
const JD_DRAFT_TEXT = 'jdDraftText';
let jdDraft: JdDraft = { init: false, shots: [], text: '', edited: false, busy: '', err: '', info: '' };
const jdSubs = new Set<() => void>();
function setJdDraft(patch: Partial<JdDraft> | ((d: JdDraft) => Partial<JdDraft>)) {
  jdDraft = { ...jdDraft, ...(typeof patch === 'function' ? patch(jdDraft) : patch) };
  try { uiStorage.setItem(JD_DRAFT_TEXT, jdDraft.text); } catch { /* 存储不可用时只保留内存 */ }
  jdSubs.forEach((f) => f());
}
const useJdDraft = () => useSyncExternalStore((cb) => { jdSubs.add(cb); return () => { jdSubs.delete(cb); }; }, () => jdDraft);
type GenState = { busy: string; err: string; running: boolean; errJob?: string };
let genState: GenState = { busy: '', err: '', running: false };
const genSubs = new Set<() => void>();
const setGen = (patch: Partial<GenState>) => { genState = { ...genState, ...patch }; genSubs.forEach((f) => f()); };
const useGen = () => useSyncExternalStore((cb) => { genSubs.add(cb); return () => { genSubs.delete(cb); }; }, () => genState);

function SingleStep2({ next, back }: { next: () => void; back: () => void }) {
  const { settings, profile, job, setJob, resume, setResume } = useApp();
  // v1.10：每张截图单独保存识别原文，删除某张时可以重建文字；岗位正文 = 去掉网页噪声后的识别文字（可修改）
  const pre = uiStorage.getItem(JD_PREFILL_KEY);
  // 从投递记录带入的岗位文字优先；记下当前 job，避免随后被「切换岗位」同步覆盖。
  if (pre) { uiStorage.setItem(JD_PREFILL_KEY, ''); setJdDraft({ init: true, jobId: job?.id, shots: [], text: pre, edited: true }); }
  else if (!jdDraft.init) setJdDraft({ init: true, jobId: job?.id, shots: (job?.screenshots ?? []).map((url) => ({ url, raw: '' })), text: uiStorage.getItem(JD_DRAFT_TEXT) || job?.rawText || '' });
  // 从历史 / 投递记录打开了另一个岗位：草稿换成那个岗位的内容（正在识别 / 分析时不打断）。放在 effect 里，避免渲染中通知订阅者。
  useEffect(() => {
    if (job && jdDraft.jobId !== job.id && !jdDraft.busy) setJdDraft({ jobId: job.id, shots: (job.screenshots ?? []).map((url) => ({ url, raw: '' })), text: job.rawText ?? '', edited: false, err: '', info: '' });
  }, [job]);
  const { shots, text, edited, busy, pct, err, info } = useJdDraft();
  const setShots = (v: JdDraft['shots']) => setJdDraft({ shots: v });
  const setText = (v: string | ((t: string) => string)) => setJdDraft((d) => ({ text: typeof v === 'function' ? v(d.text) : v }));
  const setEdited = (v: boolean) => setJdDraft({ edited: v });
  const setBusy = (v: string) => setJdDraft({ busy: v });
  const setPct = (v: number | undefined) => setJdDraft({ pct: v });
  const setErr = (v: string) => setJdDraft({ err: v });
  const setInfo = (v: string) => setJdDraft({ info: v });
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = shots.map((x) => x.url);
  const rawAll = shots.map((x) => x.raw).filter(Boolean).join('\n');
  const removedNoise = rawAll ? extractJdBody(rawAll).removed : [];
  const stale = !!job && !!text.trim() && isAnalysisStale(job, text);
  const hasResult = !!resume && !!job && resume.jobId === job.id;

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const urls = await Promise.all(list.map(fileToDataUrl));
    setErr(''); setInfo('');
    let cur = [...shots];
    for (let i = 0; i < urls.length; i++) {
      const at = cur.length; // 按位置对应（两张相同图片也各自保存识别结果）
      cur = [...cur, { url: urls[i], raw: '' }]; setShots(cur);
      try {
        const r = await recognizeScreenshot(settings, urls[i], (m, p) => { setBusy(tx("第 {0}/{1} 张：{2}", i + 1, urls.length, m)); setPct(p === undefined ? undefined : (i + p) / urls.length); });
        cur = cur.map((x, k) => (k === at ? { ...x, raw: r.text } : x)); setShots(cur);
        const body = extractJdBody(cur.map((x) => x.raw).filter(Boolean).join('\n')).text;
        setText((t) => (edited && t.trim() ? `${t}\n${extractJdBody(r.text).text}`.trim() : body));
      } catch (e) { setErr(tx("截图识别失败：{0}。你也可以直接把岗位文字粘贴到下面。", (e as Error).message)); }
    }
    setBusy(''); setPct(undefined);
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /** 清空本次岗位：只清当前文字 / 分析 / 生成结果；资料母库与历史投递记录不动 */
  const clearJob = (askFirst = true) => {
    if (askFirst && hasResult && !confirm(tx("清空本次岗位会同时清除当前生成的简历（历史投递记录和个人资料不受影响）。继续吗？"))) return false;
    setJdDraft({ shots: [], text: '', edited: false, info: '', err: '', jobId: undefined });
    if (job) setJob(null);
    if (resume) setResume(null);
    return true;
  };
  const removeShot = (i: number) => {
    if (shots.length === 1) { clearJob(); return; }
    const rest = shots.filter((_, k) => k !== i);
    setShots(rest);
    // 剩余截图重建正文（用户手动改过的文字保留，但分析会因文字变化被标为过期）
    if (!edited) setText(extractJdBody(rest.map((x) => x.raw).filter(Boolean).join('\n')).text);
    setInfo(tx("已删除一张截图：岗位文字已按剩余截图更新，之前的分析结果需要重新分析后才会使用。"));
  };

  const analyze = async (force = false) => {
    setErr(''); setInfo('');
    if (force && hasResult && !confirm(tx("重新分析会生成新的岗位分析，当前生成的简历需要重新生成（旧简历仍保存在历史记录里）。继续吗？"))) return;
    if (!force && stale && hasResult && !confirm(tx("岗位文字已修改，重新分析后需要重新生成简历（旧简历仍保存在历史记录里）。继续吗？"))) return;
    setBusy(tx("AI 正在读懂这个岗位…"));
    try {
      const history = await db.jobs.toArray().catch(() => [] as NonNullable<typeof job>[]);
      const r = await analyzeJob(settings, text, { current: job, history, force });
      if (r.reused === 'current') { setInfo(tx("岗位文字没有变化，沿用已有分析结果（没有重新调用 AI）。需要时可点「重新分析」。")); return; }
      const j = { ...r.job, screenshots: imgs, ocrRawText: rawAll || undefined };
      setJdDraft({ jobId: j.id });
      setJob(j);
      // 重新解析只新增岗位版本；保留已编辑简历，直到用户明确重新生成。
      if (r.reused === 'history') setInfo(tx("这份岗位文字之前分析过，已复用当时的分析结果（没有重新调用 AI）。"));
      if (r.aiError) setErr(tx("AI 解析失败（{0}），已用简单规则解析，请核对。", r.aiError));
    } finally { setBusy(''); }
  };
  const edit = (fn: (j: NonNullable<typeof job>) => void) => { if (!job) return; const n = structuredClone(job); fn(n); setJob(n); };

  return (
    <div className="step">
      <h2>{tx("② 你想投哪个岗位？")}</h2>
      <p className="muted">{tx("把招聘页面截图拖进来（或 Ctrl+V 粘贴截图），也可以直接粘贴岗位文字。可以放多张截图。")}</p>
      <div className="notice small row" data-testid="generic-box">
        <span className="grow">{tx("还没有具体岗位？可以直接生成一份")}<b>{tx("公版简历")}</b>{tx("：AI 从你的资料库里挑最有代表性、适用面最广的内容，精炼成一页，投哪里都说得过去。")}</span>
        <button data-testid="generic-resume" onClick={() => { const j = makeGenericJob(profile); setJdDraft({ shots: [], text: '', edited: false, info: '', err: '', jobId: j.id }); setJob(j); next(); }}>{tx("生成公版简历 →")}</button>
      </div>
      <div className="grid2 top">
        <div className="card">
          <div className={`dropzone ${busy ? 'busy' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            {shots.length ? <div className="thumbs">{shots.map((x, i) => (
              <div key={i} className="thumb" data-testid="jd-thumb">
                <img src={x.url} />
                <button type="button" className="thumb-del" title={tx("删除这张截图")} aria-label={tx("删除这张截图")} data-testid="thumb-del" onClick={(e) => { e.stopPropagation(); removeShot(i); }}>×</button>
              </div>))}</div> : <><div className="dz-icon">🖼️</div><b>{tx("点击选择 / 拖入 / 粘贴 岗位截图")}</b><div className="muted small">{tx("支持 png、jpg、webp")}</div></>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <label>{tx("岗位文字（已自动去掉「共有 N 个职位」等网页噪声，可修改，或直接粘贴）")}<textarea data-testid="jd-text" rows={10} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} placeholder={tx("岗位名称、公司、职责、任职要求……")} /></label>
          {rawAll && <details className="small" data-testid="ocr-raw"><summary>{tx("查看截图识别原文")}{removedNoise.length ? tx("（已去掉 {0} 行网页噪声）", removedNoise.length) : ''}</summary><pre className="src-pre">{rawAll}</pre>{removedNoise.length > 0 && <div className="muted">{tx("去掉的行：")}{removedNoise.join(' / ')}</div>}<button className="link" onClick={() => { setText(rawAll); setEdited(true); }}>{tx("改用完整识别原文")}</button></details>}
          <div className="row"><button className="link" onClick={() => { setText(SAMPLE_JD); setEdited(true); }}>{tx("用一个示例岗位试试")}</button>
            {(text || shots.length > 0 || job) && <button className="link" data-testid="clear-job" onClick={() => clearJob()}>{tx("清空本次岗位")}</button>}
            <span className="spacer" />
            {job && !stale && <button disabled={!text.trim() || !!busy} data-testid="reanalyze" onClick={() => analyze(true)}>{tx("↻ 重新分析")}</button>}
            <button className="primary big" data-testid="analyze" disabled={!text.trim() || !!busy} onClick={() => analyze(false)}>{tx("🔍 分析岗位")}</button></div>
          {stale && <div className="notice warn" data-testid="stale-warn">{tx("岗位文字已修改，右侧的分析结果可能已过期。点「分析岗位」按新文字重新分析。")}</div>}
          {info && <div className="notice ok" data-testid="analyze-info">{info}</div>}
          {busy && <ProgressNote msg={busy} pct={pct} />}
          {err && <div className="notice error">{err}</div>}
        </div>
        <div className="stack">
        <div className="card" data-testid="single-jd-analysis">
          {!job ? <div className="empty">{tx("分析结果会显示在这里：公司、岗位、关键要求。")}</div> : (
            <>
              <h3>{job.title.zh || job.title.en || tx("岗位")} <span className="muted small">{job.title.en}</span>{stale && <span className="badge st-stale">{tx("可能过期")}</span>}</h3>
              <div className="grid2">
                <label>{tx("公司简称")}<input value={job.company.short} placeholder={tx("没识别到，请填写")} onChange={(e) => edit((j) => { j.company.short = e.target.value; })} /></label>
                <label>{tx("岗位缩写（用于文件名）")}<input value={job.roleAbbr} placeholder={tx("如 FE / PM / DA")} onChange={(e) => edit((j) => { j.roleAbbr = e.target.value; })} /></label>
              </div>
              {job.yearsRequired != null && <div className="small">{tx("经验要求：")}{job.yearsRequired} {tx("年以上")}</div>}
              {(job.responsibilities?.length ?? 0) > 0 && <><div className="small"><b>{tx("岗位职责：")}</b></div><div className="chips">{job.responsibilities!.map((k, i) => <span key={i} className="chip">{k.zh || k.en}</span>)}</div></>}
              <div className="small"><b>{tx("必备：")}</b></div>
              <div className="chips">{job.mustHave.map((k, i) => <span key={i} className="chip must">{k.zh || k.en}</span>)}</div>
              <div className="small"><b>{tx("加分（JD 明确写出的）：")}</b>{job.niceToHave.length ? '' : <span className="muted">{tx("JD 没有明确列出加分项")}</span>}</div>
              {job.niceToHave.length > 0 && <div className="chips">{job.niceToHave.map((k, i) => <span key={i} className="chip">{k.zh || k.en}</span>)}</div>}
              <div className="small"><b>{tx("关键词（中 / 英）：")}</b></div>
              <div className="chips">{job.keywords.map((k, i) => <span key={i} className="chip kw">{k.zh}{k.en && k.en !== k.zh ? ` / ${k.en}` : ''}</span>)}</div>
            </>
          )}
        </div>
        {job && !job.joint && <JobExplainPanel />}
        </div>
      </div>
      <div className="row nav-row"><button onClick={back}>{tx("← 上一步")}</button><span className="spacer" /><button className="primary big" disabled={!job || stale} title={stale ? tx("岗位文字已修改，请先重新分析") : ''} onClick={next}>{tx("生成简历 →")}</button></div>
    </div>
  );
}

function Step3({ back, go }: { back: () => void; go: (p: string) => void }) {
  const { settings, profile, setProfile, job, resume, setResume, template, templateId, setTemplateId, templates, canUndo, undo } = useApp();
  useEffect(() => {
    if (!FEATURES.undo) return;
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !/INPUT|TEXTAREA/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); undo(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const moved = (['zh', 'en'] as Lang[]).flatMap((l) => buildLayout(profile, template, l, resume).movedFromSide.map((m) => ({ l, m })));
  const editTpl = useEditTemplate();
  // 生成进度放在组件外：生成中切到设置 / 版式设置再回来，进度仍在，也不会重复发起生成。
  const { busy, err, running } = useGen();
  const setBusy = (v: string) => setGen({ busy: v });
  const setErr = (v: string) => setGen({ err: v });
  const [view, setView] = useState<'zh' | 'en' | 'both'>('zh');
  // 手机 / 窄屏：预览和素材库分成两个标签，预览按屏幕宽度缩放（可点「放大看」横向滑动）
  const vw = useViewportWidth(), narrow = vw <= 1000;
  const [mTab, setMTab] = useState<'preview' | 'pool'>('preview'), [zoom, setZoom] = useState(false);
  const [previewRef, previewW] = useElementWidth();
  const previewScale = narrow ? (zoom ? 0.9 : Math.min(0.72, ((previewW || vw - 44) - 2) / (210 * 3.7795))) : view === 'both' ? 0.46 : (previewW ? Math.max(0.45, Math.min(0.72, (previewW - 4) / (210 * 3.7795))) : 0.72);
  const [showItems, setShowItems] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [pages, setPages] = useState<PageInfo | null | 'error'>(null);
  const started = useRef(false);
  const primary: Lang = job?.jdLanguage ?? 'zh';

  /** 补齐选中条目的单位 / 职位 / 学位 / 技能 / 课程名等短字段的另一语言（写回母库，以后复用）。失败不影响简历。 */
  const withLabels = async (r: NonNullable<typeof resume>, base = profile) => (await withLabelsAndProfile(r, base)).resume;
  const withLabelsAndProfile = async (r: NonNullable<typeof resume>, base = profile) => {
    try {
      setBusy(tx("正在补齐单位、职位、学位、技能等名称的中英文…"));
      const filled = await fillResumeLabels(settings, base, r);
      if (filled.count) setProfile(filled.profile);
      return { resume: filled.resume, profile: filled.profile };
    } catch (e) { return { resume: { ...r, notes: [...(r.notes ?? []), tx("名称补译未完成：{0}", (e as Error).message)] }, profile: base }; }
  };
  const run = async () => {
    if (!job || genState.running) return;
    setGen({ running: true, err: '' });
    try {
      let r = await generateResume(settings, profile, job, primary, template.page.targetPages, setBusy, { template, measure: (r) => measurePages(profile, { ...template, page: { ...template.page, autoFit: false } }, r) });
      const labelled = await withLabelsAndProfile(r);
      let filled = labelled.resume;
      try { setBusy(tx("正在检查英文版里残留的中文，并译成英文…")); filled = (await fillEnglishResidue(settings, labelled.profile, template, labelled.resume)).resume; }
      catch (e) { filled = { ...labelled.resume, notes: [...(labelled.resume.notes ?? []), tx("英文版残留中文补译未完成：{0}", (e as Error).message)] }; }
      setBusy(tx("正在核对页数，保持 {0} 页内…", template.page.targetPages || 1));
      const fixedTpl = { ...template, page: { ...template.page, autoFit: false } };
      r = await trimToPages(labelled.profile, fixedTpl, filled, (x) => measurePages(labelled.profile, fixedTpl, x));
      setResume({ ...r, templateId });
    }
    catch (e) { const at = genState.busy; setGen({ err: `${(e as Error).message}${at ? tx("（出错步骤：{0}）", at) : ''}`, errJob: job.id }); } finally { setGen({ busy: '', running: false }); }
  };
  // 同一岗位刚生成失败时，切页面回来不自动重跑（避免重复调用 AI）；用户可点「重新生成」。
  // 从第 2 步点「生成简历 / 生成共同简历」进来：当前岗位还没有对应简历时自动生成（旧岗位的简历保留在历史里）。
  // 其它方式进入（刷新、从历史打开）只在完全没有简历时自动生成，不覆盖已编辑的旧简历。
  useEffect(() => {
    if (started.current || !job || running || genState.errJob === job.id) return;
    const requested = uiStorage.getItem(GEN_REQUEST) === '1';
    if (requested) uiStorage.setItem(GEN_REQUEST, '');
    if (!resume || (requested && resume.jobId !== job.id)) { started.current = true; run(); }
  });
  // 实时统计 PDF 页数（Worker 中渲染，防抖）
  useEffect(() => {
    if (!resume) return;
    let alive = true;
    const t = setTimeout(() => measurePages(profile, template, resume).then((p) => alive && setPages(p ?? 'error')), 700);
    return () => { alive = false; clearTimeout(t); };
  }, [profile, template, resume]);

  const latestResume = useRef(resume);
  useEffect(() => { latestResume.current = resume; }, [resume]);
  const resync = async () => {
    if (!resume) return;
    const ids = resume.items.filter((i) => i.syncStatus !== 'in-sync').map((i) => i.sourceId);
    if (settings.demoMode) { setResume(runConsistency({ ...resume, items: resume.items.map((i) => ({ ...i, syncStatus: 'in-sync' })) })); return; }
    setBusy(tx("重新翻译修改过的条目…"));
    try { const translated = await withLabels(ids.length ? await localizeAi(settings, profile, job, resume, ids) : resume); if (latestResume.current === resume) setResume(translated); else setErr(tx("同步期间简历已修改，保留当前编辑；可按需再次同步。")); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const enResidue = resume ? englishResidue(buildLayout(profile, template, 'en', resume)) : [];
  const fixEnglish = async () => {
    if (!resume) return;
    setBusy(tx("正在把英文版里残留的中文译成英文…")); setErr('');
    try {
      const out = await fillEnglishResidue(settings, profile, template, resume);
      if (latestResume.current !== resume) setErr(tx("补译期间简历已修改，请再点一次。"));
      else { setResume(out.resume); if (out.remaining) setErr(tx("还有 {0} 处没能自动译好（译文数字对不上或仍含中文），请在左侧「逐条修改内容」里手动改成英文。", out.remaining)); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  /** 自动调整为 1 页：只微调字号 / 行距 / 间距 / 页边距（不删内容），有下限；放不下就保持原样。 */
  const [fitMsg, setFitMsg] = useState<{ lines: string[]; backup: TemplateConfig | null } | null>(null);
  const fitOnePage = async () => {
    if (!resume) return;
    setBusy(tx("正在微调字号、行距、间距和页边距，尽量放进 1 页（按真实 PDF 页数测量，约需几十秒）…")); setErr(''); setFitMsg(null);
    try {
      const backup = structuredClone(template);
      const r = await fitToOnePage(template, (t) => measurePages(profile, { ...t, page: { ...t.page, autoFit: false } }, resume), 1);
      if (latestResume.current !== resume) { setErr(tx("调整期间简历已修改，请再点一次。")); return; }
      const say = (name: string, f: LangFit) => `${name}：${f.status === 'already' ? tx("已经是 1 页，无需调整") : f.status === 'fitted' ? tx("已调到 1 页（{0}）", describeFit(f)) : tx("调到下限仍超过 1 页，已保持原样（下限：正文 {0} pt、行距 {1}、页边距 {2} mm 等）。可点「自动删减到 1 页内」取消最不重要的内容，或改用 2 页", FIT_LIMITS.bodyPt, FIT_LIMITS.lineHeight, FIT_LIMITS.marginMm)}`;
      const ok = r.zh.status !== 'failed' || r.en.status !== 'failed';
      if (r.changed || (ok && (template.page.targetPages || 1) !== 1)) editTpl((x) => { x.page = { ...x.page, ...r.template.page, targetPages: 1 }; x.spacing = r.template.spacing; x.locales = r.template.locales; });
      setFitMsg({ lines: [say(tx("中文版"), r.zh), say(tx("英文版"), r.en)], backup: r.changed ? backup : null });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  /** 按实际 PDF 页数，从最不重要的内容开始暂时取消勾选，直到放进目标页数（可在左侧重新勾选；资料库不变）。 */
  const autoTrim = async () => {
    if (!resume) return;
    setBusy(tx("正在按实际 PDF 页数删减低相关内容，保持 {0} 页内…", template.page.targetPages || 1)); setErr('');
    try {
      const fixedTpl = { ...template, page: { ...template.page, autoFit: false } };
      const next = await trimToPages(profile, fixedTpl, resume, (x) => measurePages(profile, fixedTpl, x));
      if (latestResume.current !== resume) setErr(tx("删减期间简历已修改，请再点一次。")); else setResume(next);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  // 刚把「篇幅」改小时，页数测完发现超出 → 自动删减一次（不会在其它时候偷偷删内容）
  const trimAfterMeasure = useRef(false);
  useEffect(() => {
    if (trimAfterMeasure.current && pages && pages !== 'error') {
      trimAfterMeasure.current = false;
      if (pages.zh.overflow || pages.en.overflow) autoTrim();
    }
  });
  const pendingItems = resume?.items.filter((i) => i.syncStatus !== 'in-sync').length ?? 0;
  // 新勾选的条目可能只有一种语言的单位 / 职位 / 技能名：同样提示「同步翻译」。
  const pendingLabels = resume ? resumeLabelTargets(profile, resume).length : 0;
  const pending = pendingItems + pendingLabels;
  const photoPos = template.locales.zh.photo.enabled ? template.locales.zh.photo.position : 'none';
  const baseOf = (id: string) => ALL_TEMPLATES.find((b) => id === b.id || id.startsWith(b.id + '-custom'))?.id;
  const pageText = (l: Lang) => pages === 'error' ? '—' : pages ? tx("{0} 页{1}{2}", pages[l].pages, pages[l].level ? tx("（已自动缩排）") : '', pages[l].overflow ? tx(" ⚠ 超出目标页数") : '') : tx("计算中…");

  return (
    <div className="step">
      <h2>{tx("③ 编辑与下载")}</h2>
      {resume && job && resume.jobId !== job.id && <div className="notice warn" data-testid="previous-resume-retained">{tx("岗位已重新解析；下方保留的是上一岗位版本的简历及手动选择。点击「重新生成」才会为当前岗位创建新简历，旧版继续保留在本机历史记录中。")}</div>}
      <AiDisclosure />
      {busy && <div className="notice"><span className="spinner" /> {busy} <Elapsed /></div>}
      {err && <div className="notice error">{err}</div>}
      {resume && (
        <div className="card result-bar">
          <div className="grow">
            <b>{resume.generatedBy === 'ai' ? tx("AI 已完成岗位选材与撰写") : tx("演示简历（未调用 AI）")}</b>
            <p className="muted small">{tx("左侧勾选、编辑、排序，右侧实时更新。调整素材不调用 AI，也不修改个人资料库。")}</p>
            <ResumeNotice />
          </div>
          <button disabled={!!busy} onClick={run}>{tx("🔄 重新生成")}</button>
        </div>
      )}
      {moved.length > 0 && <div className="notice warn" data-testid="side-warn">{tx("⚠ 侧栏放不下，已把「")}{[...new Set(moved.map((x) => template.locales.zh.sectionTitles?.[x.m] ?? x.m))].join('、')}{tx("」移到主栏末尾显示（")}{[...new Set(moved.map((x) => x.l === 'zh' ? tx("中文版") : tx("英文版")))].join('、')}{tx("），内容没有被截断。想放回侧栏可以在左侧清单减少条目，或换单栏样式。")}</div>}
      {enResidue.length > 0 && <div className="notice warn" data-testid="en-residue">{tx("英文版里还有")} {enResidue.length} {tx("处中文（如「")}{enResidue[0].length > 24 ? enResidue[0].slice(0, 24) + '…' : enResidue[0]}」）。<button data-testid="en-residue-fix" disabled={!!busy || settings.demoMode} onClick={fixEnglish}>{tx("译成英文")}</button>{settings.demoMode && <span className="muted small">{tx("（演示模式不调用 AI）")}</span>}</div>}
      {pending > 0 && <div className="notice warn">{pendingItems ? tx("{0} 条文字", pendingItems) : ''}{pendingItems && pendingLabels ? '、' : ''}{pendingLabels ? tx("{0} 个名称", pendingLabels) : ''}{tx("的另一语言可按需同步，也可直接编辑和下载。")}<button onClick={resync}>{tx("同步翻译")}</button></div>}

      <div className="card quick-layout">
        <details className="m-collapse" open={!narrow}><summary>{tx("版式：样式 / 照片 / 篇幅 / 配色")}</summary>
        <div className="row">
          <b>{tx("样式")}</b>
          {ALL_TEMPLATES.map((t) => <button key={t.id} className={baseOf(templateId) === t.id ? 'active' : ''} onClick={() => setTemplateId(templates.find((x) => !x.builtin && x.id.startsWith(t.id + '-custom'))?.id ?? t.id)}>{txPick(t.name)}</button>)}
          <span className="sep" />
          <b>{tx("照片")}</b>
          {(['left', 'right', 'none'] as PhotoPosition[]).map((p) => <button key={p} className={photoPos === p ? 'active' : ''} onClick={() => editTpl((x) => { x.locales.zh.photo.position = p; x.locales.zh.photo.enabled = p !== 'none'; })}>{p === 'left' ? tx("左上") : p === 'right' ? tx("右上") : tx("不放")}</button>)}
          <span className="sep" />
          <b>{tx("篇幅")}</b>
          {[1, 2].map((n) => <button key={n} className={template.page.targetPages === n ? 'active' : ''} onClick={() => { trimAfterMeasure.current = n < (template.page.targetPages || 1); editTpl((x) => { x.page.targetPages = n; }); }}>{n} {tx("页内")}</button>)}
          <button data-testid="fit-one-page" disabled={!resume || !!busy} title={tx("只微调字号、行距、间距、页边距（有下限，不会压得太小太挤），不删内容；放不进 1 页就保持原样")} onClick={fitOnePage}>{tx("自动调整为 1 页")}</button>
          <span className="sep" />
          <b>{tx("配色")}</b>
          {COLORS.map(([a, b]) => <button key={a} className={`swatch ${template.colors.primary === a ? 'active' : ''}`} style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} onClick={() => editTpl((x) => { x.colors.primary = a; x.colors.accent = b; })} />)}
          <span className="spacer" />
          {FEATURES.undo && <button disabled={!canUndo} title="Ctrl+Z" onClick={undo}>{tx("↶ 撤销")}</button>}
          <button className="link" onClick={() => go('layout')}>{tx("更多版式设置 →")}</button>
        </div>
        </details>
        {resume && <div className="row" data-testid="headline-edit">
          <b>{tx("姓名下方一行")}</b>
          <label><input type="checkbox" data-testid="headline-show" checked={!resume.headlineHidden} onChange={(e) => setResume({ ...resume, headlineHidden: !e.target.checked })} /> {tx("显示")}</label>
          {!resume.headlineHidden && (['zh', 'en'] as const).map((l) => {
            const cur = (resume.headline?.[l] ?? '').trim() || lt(profile.profile.headline, l, false);
            return <input key={`${resume.id}-${l}-${cur}`} data-testid={`headline-${l}`} aria-label={l === 'zh' ? tx("姓名下方一行（中文）") : 'Headline under name (English)'} placeholder={l === 'zh' ? tx("求职方向（中文）") : 'Headline (English)'} defaultValue={cur} style={{ minWidth: 220 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== cur) setResume({ ...resume, headline: { zh: resume.headline?.zh ?? '', en: resume.headline?.en ?? '', [l]: v } }); }} />;
          })}
          <span className="muted small">{tx("AI 会按岗位写这一行；可直接改，或取消「显示」。")}</span>
        </div>}
        {resume && <div className="row" data-testid="contact-links">
          <b>{tx("链接")}</b>
          {([['github', 'GitHub', tx("github.com/你的用户名")], ['linkedin', tx("领英 LinkedIn"), tx("linkedin.com/in/你的主页")], ['portfolio', tx("作品集网站"), 'yourname.com']] as const).map(([k, label, ph]) => {
            const vis = (resume.contactVisibility ?? profile.profile.contacts.visibility) ?? {};
            const cur = profile.profile.contacts[k] ?? '';
            return <span key={`${k}-${cur}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <label><input type="checkbox" data-testid={`link-show-${k}`} checked={vis[k] === true} onChange={(e) => setResume({ ...resume, contactVisibility: { ...vis, [k]: e.target.checked } })} /> {label}</label>
              <input data-testid={`link-${k}`} aria-label={label} placeholder={ph} defaultValue={cur} style={{ width: 190 }}
                onBlur={(e) => {
                  const v = e.target.value.trim(); if (v === cur) return;
                  setProfile({ ...profile, profile: { ...profile.profile, contacts: { ...profile.profile.contacts, [k]: v } } });
                  if (v && vis[k] !== true) setResume({ ...resume, contactVisibility: { ...vis, [k]: true } });
                }} />
            </span>;
          })}
          <span className="muted small">{tx("填好并勾选后显示在姓名下方，PDF / Word 里可点击。")}</span>
        </div>}
        <div className="row">
          {(['zh', 'en', 'both'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'zh' ? tx("中文版") : v === 'en' ? 'English' : tx("中英对照")}</button>)}
          <span className="muted small">{tx("中文版")} {pageText('zh')} {tx("· 英文版")} {pageText('en')}</span>
        </div>
        {fitMsg && <div className="notice small" data-testid="fit-result">{fitMsg.lines.map((l, i) => <div key={i}>{l}</div>)}
          {fitMsg.backup && <button data-testid="fit-undo" onClick={() => { const b = fitMsg.backup!; editTpl((x) => { x.page = b.page; x.spacing = b.spacing; x.locales = b.locales; }); setFitMsg(null); }}>{tx("恢复调整前的版式")}</button>}</div>}
        {pages && pages !== 'error' && (pages.zh.overflow || pages.en.overflow) && <div className="notice warn small" data-testid="overflow-tip">{tx("实际 PDF 超出目标页数（上方页数按真实 PDF 测量；预览框里的「已用 %」只是估算）。")}<button className="primary" data-testid="auto-trim" disabled={!!busy} onClick={autoTrim}>{tx("自动删减到")} {template.page.targetPages || 1} {tx("页内")}</button> {tx("会从最不重要的内容开始暂时取消勾选，可在左侧重新勾选；也可以改为「2 页内」。本工具不会为了塞进页面而把字号缩到难以阅读。")}</div>}
        {narrow && resume && (
          <div className="m-tabs" data-testid="m-tabs">
            <button className={mTab === 'preview' ? 'active' : ''} data-testid="m-tab-preview" onClick={() => setMTab('preview')}>{tx("简历预览")}</button>
            <button className={mTab === 'pool' ? 'active' : ''} data-testid="m-tab-pool" onClick={() => setMTab('pool')}>{tx("编辑素材")}</button>
            {mTab === 'preview' && <button data-testid="m-zoom" onClick={() => setZoom(!zoom)}>{zoom ? tx("适应屏幕") : tx("放大看")}</button>}
          </div>
        )}
        <div className="pool-layout" data-m={narrow && resume ? mTab : undefined}>
          {resume && <MaterialPool />}
          <div className="previews" ref={previewRef}>
            {(view === 'both' && !narrow ? (['zh', 'en'] as Lang[]) : [view === 'both' ? 'zh' as Lang : view]).map((l) => <Preview key={l} m={buildLayout(profile, template, l, resume)} scale={previewScale} />)}
          </div>
          <FormatPanel view={view} />
        </div>
      </div>
      <ResumeFactsOptions />
      {resume && !!resume.notes?.length && (
        <details className="card" data-testid="resume-notes">
          <summary>{tx("生成与版面说明（")}{resume.notes.length} {tx("条）")}{(() => { const d = resume.notes.find((n) => n.startsWith('版面诊断')); return d ? `：${d}` : ''; })()}</summary>
          <ul className="small">{resume.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
      <JobExplainPanel />
      <EvidenceReport go={go} />
      {resume && (
        <div className="card">
          <button className="link big-link" onClick={() => setShowItems(!showItems)}>{showItems ? '▾' : '▸'} {tx("想改某句话？逐条修改内容（")}{resume.items.length} {tx("条）")}</button>
          {showItems && <ItemsEditor />}
        </div>
      )}
      <details><summary>{tx("可选：求职信、自我介绍与备考方向")}</summary><CareerKit /></details>
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      <div className="row nav-row"><button onClick={back}>{tx("← 换个岗位")}</button><span className="spacer" /><button className="primary big" disabled={!resume} onClick={() => setShowExport(true)}>{tx("⬇ 下载 PDF / Word")}</button></div>
    </div>
  );
}
