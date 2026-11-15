"""英文界面回归：空数据库 + uiLang=en，逐页打开，界面上不应出现中文（语言切换按钮「中文」除外）。
用法：npm run build && npx vite preview --port 4173 &  然后 python3 tests/e2e/i18n_en_e2e.py"""
import os, tempfile
from playwright.sync_api import sync_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:4173/')
SCAN = r"""() => {
  const HAN=/[㐀-鿿]/; const out=new Set();
  const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n=walker.nextNode())) { const t=n.textContent.trim(); if (t && HAN.test(t) && !n.parentElement.closest('textarea,.lang-switch,option[value=zh],.preview-wrap')) out.add(t.slice(0,80)); }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) for (const a of ['placeholder','title','aria-label']) { const v=el.getAttribute(a); if (v && HAN.test(v) && !el.classList.contains('lang-switch')) out.add('@'+a+': '+v.slice(0,80)); }
  return [...out];
}"""
PAGES = ['#wizard', '#applications', '#applications/record', '#applications/new', '#applications/import', '#applications/backup', '#profile', '#layout', '#settings']
checks = []
def chk(name, ok, extra=''):
    checks.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
with tempfile.TemporaryDirectory() as d, sync_playwright() as p:
    c = p.chromium.launch_persistent_context(d, executable_path=os.environ.get('CHROMIUM_PATH'), args=['--no-sandbox'], viewport={'width': 1440, 'height': 1000})
    c.route('**/*', lambda r: r.continue_() if r.request.url.startswith(B) else r.abort())
    pg = c.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B); pg.wait_for_selector('.lang-switch')
    pg.click('.lang-switch'); pg.wait_for_function("document.querySelector('.lang-switch').textContent.includes('中文')")
    chk('切换到英文：导航是英文', 'Applications' in pg.inner_text('body'))
    for h in PAGES:
        pg.goto(B + h); pg.reload(); pg.wait_for_timeout(1200)
        left = pg.evaluate(SCAN)
        chk(f'{h} 没有中文界面文字', not left, left)
    for w in ['1', '2', '3']:
        pg.evaluate(f"localStorage.setItem('wizardStep','{w}')"); pg.goto(B + '#wizard'); pg.reload(); pg.wait_for_timeout(1200)
        left = pg.evaluate(SCAN); chk(f'向导第 {w} 步没有中文界面文字', not left, left)
    pg.click('.lang-switch'); pg.wait_for_timeout(500)
    chk('切回中文：导航是中文', '求职投递' in pg.inner_text('body'))
    chk('无页面错误', not errs, errs)
    c.close()
print(f'RESULT {sum(checks)} / {len(checks)}')
