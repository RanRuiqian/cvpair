// 找出在模块顶层（不在任何函数里）调用的 tx()：这类值在加载时就固定，切换语言不会变
import ts from 'typescript'; import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n, inFn) => {
    const fn = inFn || ts.isFunctionLike(n);
    if (!fn && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tx') {
      let d = n; while (d && !ts.isVariableStatement(d)) d = d.parent;
      console.log(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}\t${d ? d.declarationList.declarations.map((x) => x.name.getText()).join(',') : '?'}`);
      return;
    }
    ts.forEachChild(n, (c) => visit(c, fn));
  };
  visit(sf, false);
}
