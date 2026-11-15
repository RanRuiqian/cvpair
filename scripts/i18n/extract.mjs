// 列出源码中所有界面中文（tx 的第一个参数、txDeep 表里的字符串、*_ZH 常量），
// 与 src/i18n/en.ts 对比，输出缺少英文的条目。
// 用法：node scripts/i18n/extract.mjs [--all] [--json out.json]
import ts from 'typescript'; import fs from 'node:fs'; import { execSync } from 'node:child_process';
const HAN = /[㐀-鿿]/;
export function collect() {
  const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx' src/App.tsx", { encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('src/i18n/') && fs.existsSync(f));
  const keys = new Map();
  const put = (k, f) => { if (HAN.test(k)) { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(f); } };
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8'); if (!/\btx(Deep)?\(|_ZH\b/.test(src)) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const strs = (root) => { const v = (n) => { if (ts.isStringLiteralLike(n)) put(n.text, f); ts.forEachChild(n, v); }; v(root); };
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        if (n.expression.text === 'tx' && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) put(n.arguments[0].text, f);
        if (n.expression.text === 'txDeep' && n.arguments[0]) { if (ts.isIdentifier(n.arguments[0])) { /* 引用另一张表，如 STATUS_LABEL_ZH，在其定义处收集 */ } else strs(n.arguments[0]); }
      }
      if (ts.isVariableDeclaration(n) && /_ZH$/.test(n.name.getText(sf)) && n.initializer) strs(n.initializer);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes('--all'); const ji = process.argv.indexOf('--json');
  const keys = collect();
  const enSrc = fs.readFileSync('src/i18n/en.ts', 'utf8');
  const have = new Set(); for (const m of enSrc.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) have.add(JSON.parse(m[1]));
  const out = [...keys.keys()].filter((k) => all || !have.has(k));
  if (ji >= 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(out, null, 1));
  console.log(`界面中文 ${keys.size} 条，缺英文 ${[...keys.keys()].filter((k) => !have.has(k)).length} 条`);
}
