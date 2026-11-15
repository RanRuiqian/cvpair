// 还原：txDeep(...) 内部与 *_ZH 常量里误包的 tx("…") → "…"
import ts from 'typescript'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  let src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const strip = (root) => { const v = (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tx' && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0])) { edits.push({ s: n.getStart(sf), e: n.getEnd(), t: n.arguments[0].getText(sf) }); return; } ts.forEachChild(n, v); }; ts.forEachChild(root, v); };
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'txDeep') { strip(n); return; }
    if (ts.isVariableDeclaration(n) && /_ZH$/.test(n.name.getText(sf)) && n.initializer) { if (ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === 'tx') edits.push({ s: n.initializer.getStart(sf), e: n.initializer.getEnd(), t: '(' + n.initializer.arguments[0].getText(sf) + ')' }); else strip(n); return; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  edits.sort((a, b) => b.s - a.s);
  for (const x of edits) src = src.slice(0, x.s) + x.t + src.slice(x.e);
  if (edits.length) { fs.writeFileSync(f, src); console.log(edits.length, f); }
}
