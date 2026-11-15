// 把界面组件里写死的中文包进 tx()：中文模式下 tx 原样返回（界面不变），英文模式查 src/i18n/en 翻译表。
// 用法：node scripts/i18n/codemod.mjs [--write] [--list out.json] <文件...>
import ts from 'typescript';
import fs from 'node:fs';
const args = process.argv.slice(2);
const write = args.includes('--write');
const li = args.indexOf('--list'); const listOut = li >= 0 ? args[li + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
const CJK = /[㐀-鿿！-～　-〿]/;
const HAS_HAN = /[㐀-鿿]/;
const SKIP_CALLEES = new Set(['L', 'lt', 't', 'T', 'tx', 'translate', 'require', 'RegExp', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'match', 'matchAll', 'split', 'replace', 'replaceAll', 'test', 'search', 'log', 'warn', 'error', 'info', 'debug', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'get', 'has', 'set']);
const SKIP_ATTRS = new Set(['key', 'className', 'data-testid', 'id', 'type', 'accept', 'href', 'src', 'name', 'value', 'htmlFor', 'lang', 'role', 'style', 'pattern']);
const strings = new Map();
const esc = (s) => JSON.stringify(s);
function calleeName(call) { const e = call.expression; if (ts.isIdentifier(e)) return e.text; if (ts.isPropertyAccessExpression(e)) return e.name.text; return ''; }
function skipContext(node) {
  let n = node, p = node.parent;
  // 跳过 tx/L 等已处理调用的参数、比较、case、导入、类型
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isConditionalExpression(p) && p.condition !== n || ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.BarBarToken || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))) { n = p; p = p.parent; }
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p) || ts.isEnumMember(p)) return true;
  if (ts.isBinaryExpression(p)) { const k = p.operatorToken.kind; if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(k)) return true; }
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isPropertyAssignment(p)) { const nm = p.name.getText(); if (/^['"]?(zh|en|id|key|kind|type|testid)['"]?$/.test(nm)) return true; }
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) { const c = ts.isCallExpression(p) ? calleeName(p) : (ts.isIdentifier(p.expression) ? p.expression.text : ''); if (SKIP_CALLEES.has(c) && !(c === 'tx' && p.arguments[0] !== n)) return true; }
  if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) return true;
  if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && ['includes'].includes(calleeName(p.parent))) return true;
  return false;
}
let total = 0;
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const add = (start, end, text, key) => { edits.push({ start, end, text }); strings.set(key, (strings.get(key) ?? 0) + 1); };
  const visit = (node) => {
    // 已用 txDeep 包裹的标签表、*_ZH 原文常量：保持原文，不再包 tx
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'txDeep') return;
    if (ts.isVariableDeclaration(node) && /_ZH$/.test(node.name.getText(sf))) return;
    if (ts.isJsxText(node)) {
      const raw = node.getFullText(sf); // JsxText 没有 trivia，等于原文
      if (HAS_HAN.test(raw) && !raw.includes('&') && !raw.includes('{') && !raw.includes('}')) {
        const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const core = m[2].replace(/\s*\n\s*/g, ' ');
        const start = node.pos + m[1].length;
        add(start, start + m[2].length, `{tx(${esc(core)})}`, core);
      }
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && HAS_HAN.test(node.text)) {
      if (!skipContext(node)) {
        const inAttr = ts.isJsxAttribute(node.parent);
        add(node.getStart(sf), node.getEnd(), inAttr ? `{tx(${esc(node.text)})}` : `tx(${esc(node.text)})`, node.text);
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      if (parts.some((x) => HAS_HAN.test(x)) && !skipContext(node)) {
        let key = node.head.text; const exprs = [];
        node.templateSpans.forEach((s, i) => { key += `{${i}}` + s.literal.text; exprs.push(s.expression.getText(sf)); });
        add(node.getStart(sf), node.getEnd(), `tx(${esc(key)}, ${exprs.join(', ')})`, key);
        return; // 内层中文留给下一轮
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  total += edits.length;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) src = src.slice(0, e.start) + e.text + src.slice(e.end);
  if (!/import \{[^}]*\btx\b[^}]*\} from ['"][./]*i18n\/tx['"]/.test(src)) {
    const rel = f.replace(/^src\//, '').split('/').slice(0, -1).map(() => '..').join('/') || '.';
    const imp = `import { tx } from '${rel}/i18n/tx';\n`;
    const lastImport = [...src.matchAll(/^import [^;]+;\s*$/gm)].pop();
    src = lastImport ? src.slice(0, lastImport.index + lastImport[0].length) + '\n' + imp.trimEnd() + src.slice(lastImport.index + lastImport[0].length) : imp + src;
  }
  if (write) fs.writeFileSync(f, src);
  console.log(`${edits.length}\t${f}`);
}
console.log(`total edits ${total}, unique strings ${strings.size}`);
if (listOut) fs.writeFileSync(listOut, JSON.stringify([...strings.keys()], null, 1));
