import type { Lang } from '../types';

/**
 * 界面文字翻译（2026-11，开源前补全英文界面）。
 * - 源码里界面文字仍写中文：tx('已保存：{0}', name)。中文模式原样返回（界面与之前完全一致）。
 * - 英文模式查 src/i18n/en.ts 的翻译表（按需动态加载，不增加中文用户的首屏体积）；表里没有的回退中文。
 * - 新增界面文字：直接写 tx('中文')，再运行 `node scripts/i18n/extract.mjs` 列出缺翻译的条目补进 en.ts。
 *   测试 tests/i18nCoverage.test.ts 会检查源码里所有 tx('…') 都有英文。
 */
let lang: Lang = 'zh';
let dict: Record<string, string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const fill = (s: string, args: unknown[]) => (args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (+i < args.length ? String(args[+i]) : m)) : s);

export function tx(zh: string, ...args: unknown[]): string {
  if (lang === 'zh' || !dict) return fill(zh, args);
  return fill(dict[zh] ?? zh, args);
}

/** 当前界面语言（由 store 在渲染时同步） */
export function setTxLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  if (l === 'en' && !dict) void loadEn();
}
export const txLang = () => lang;
export const txReady = () => lang === 'zh' || !!dict;

export function loadEn(): Promise<void> {
  if (dict) return Promise.resolve();
  if (!loading) loading = import('./en').then((m) => { dict = m.EN; listeners.forEach((f) => f()); });
  return loading;
}
/** 英文表加载完成后通知界面重新渲染 */
export function onTxReady(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** 把只读的中文标签表（如状态名）包成按当前界面语言取值的对象 */
export function txLabels<T extends Record<string, string>>(o: T): T {
  return new Proxy(o, { get: (t, k) => { const v = Reflect.get(t, k); return typeof v === 'string' ? tx(v) : v; } });
}

const deepCache = new WeakMap<object, object>();
/**
 * 模块顶层的标签表（字段名、步骤名、分组名等）用它包一层：每次读取字符串时按当前界面语言翻译。
 * 数组、嵌套对象同样生效；用法与原对象完全一致。
 */
export function txDeep<T>(v: T): T {
  if (!v || typeof v !== 'object') return v;
  const hit = deepCache.get(v as object); if (hit) return hit as T;
  const p = new Proxy(v as object, {
    get(t, k, r) {
      const x = Reflect.get(t, k, r);
      if (typeof x === 'string') return tx(x);
      if (x && typeof x === 'object') return txDeep(x);
      return x;
    },
  });
  deepCache.set(v as object, p);
  return p as T;
}

/** 中英双语字段（如模板名 {zh, en}）按当前界面语言取值，缺失时回退另一语言 */
export function txPick(v: { zh?: string; en?: string } | undefined | null): string {
  if (!v) return '';
  return lang === 'en' ? (v.en || v.zh || '') : (v.zh || v.en || '');
}
