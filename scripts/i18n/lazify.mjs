// 把模块顶层声明里的 tx("…") 去掉，并把整个初始值包进 txDeep(…)（只处理对象 / 数组初始值）
import ts from 'typescript'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  let src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = []; const prim = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer; if (!init) continue;
      let calls = [];
      const find = (n) => { if (ts.isFunctionLike(n)) return; if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tx') { calls.push(n); return; } ts.forEachChild(n, find); };
      find(init);
      if (!calls.length) continue;
      let core = init; while (ts.isAsExpression(core) || ts.isSatisfiesExpression?.(core) || ts.isParenthesizedExpression(core)) core = core.expression;
      if (!ts.isObjectLiteralExpression(core) && !ts.isArrayLiteralExpression(core)) { prim.push(`${f}:${d.name.getText()}`); continue; }
      if (calls.some((c) => c.arguments.length !== 1)) { prim.push(`${f}:${d.name.getText()} (tx with args)`); continue; }
      for (const c of calls) edits.push({ s: c.getStart(sf), e: c.getEnd(), t: c.arguments[0].getText(sf) });
      edits.push({ s: init.getStart(sf), e: init.getStart(sf), t: 'txDeep(' }, { s: init.getEnd(), e: init.getEnd(), t: ')' });
    }
  }
  edits.sort((a, b) => b.s - a.s || b.e - a.e);
  for (const x of edits) src = src.slice(0, x.s) + x.t + src.slice(x.e);
  if (edits.length) src = src.replace(/import \{ tx \} from '([./]*)i18n\/tx';/, "import { tx, txDeep } from '$1i18n/tx';");
  fs.writeFileSync(f, src);
  if (prim.length) console.log('MANUAL:', prim.join('  '));
}
