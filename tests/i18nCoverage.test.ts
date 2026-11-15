import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 脚本，无类型声明
import { collect } from '../scripts/i18n/extract.mjs';
import { EN } from '../src/i18n/en';
import { setTxLang, tx, txDeep, loadEn } from '../src/i18n/tx';

describe('界面英文翻译覆盖', () => {
  it('源码里每一条界面中文都有英文（新增文字请运行 node scripts/i18n/extract.mjs 并补进 src/i18n/en.ts）', () => {
    const keys = [...(collect() as Map<string, Set<string>>).entries()];
    const missing = keys.filter(([k]) => !(k in EN)).map(([k, f]) => `${[...f][0]}: ${k}`);
    expect(missing).toEqual([]);
  });
  it('占位符 {0} {1} 中英文一致', () => {
    const bad = Object.entries(EN).filter(([zh, en]) => JSON.stringify((zh.match(/\{\d+\}/g) ?? []).sort()) !== JSON.stringify((en.match(/\{\d+\}/g) ?? []).sort()));
    expect(bad).toEqual([]);
  });
  it('中文模式原样返回；英文模式查表、缺失回退中文；txDeep 按当前语言取值', async () => {
    setTxLang('zh');
    expect(tx('已保存：{0}', 'A')).toBe('已保存：A');
    const tbl = txDeep({ a: '已投递', n: { b: '面试中' }, arr: ['被拒'] });
    expect(tbl.a).toBe('已投递');
    await loadEn(); setTxLang('en');
    expect(tx('已投递')).toBe('Applied');
    expect(tx('没有这条翻译{0}', 1)).toBe('没有这条翻译1');
    expect(tx('删除 {0}', 'X')).toBe('Delete X');
    expect(tbl.a).toBe('Applied'); expect(tbl.n.b).toBe('Interviewing');
    setTxLang('zh');
    expect(tbl.a).toBe('已投递');
  });
});
