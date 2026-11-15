# 参与贡献 · Contributing

欢迎提 Issue 和 Pull Request！ / Issues and pull requests are welcome!

## 提 Issue / Filing an issue

- **Bug**：请写清楚操作步骤、期望结果、实际结果、浏览器版本；页面出错时，把错误页里的「复制错误信息」粘贴过来。
  Describe the steps, expected vs. actual result and your browser; if the error page appeared, paste the text from “Copy error details”.
- **请不要贴真实简历、联系方式或 API Key。** 需要示例时请用虚构内容。
  **Never post your real resume, contact details or API key.** Use made-up examples.

## 开发 / Development

```bash
npm ci
npm run dev            # http://localhost:5173 （?demo = 演示模式 / demo mode）
npm test               # 单元测试 / unit tests (vitest)
npx tsc -b             # 类型检查 / type check
npm run lint           # oxlint
npm run build
```

浏览器端到端测试（Python Playwright）/ Browser end-to-end tests:

```bash
pip install playwright && python -m playwright install chromium
npm run build && npx vite preview --port 4173 &
python3 tests/e2e/tracker_e2e.py      # 更多见 AGENTS.md / see AGENTS.md for the full list
```

项目结构、数据结构和规则见 [AGENTS.md](AGENTS.md) 与 [docs/](docs/README.md)。
Architecture, data schema and project rules are in [AGENTS.md](AGENTS.md) and [docs/](docs/README.md) (mostly in Chinese).

## 几条规则 / Ground rules

1. **只用虚构数据。** 测试、截图、示例里的人名、公司、联系方式都必须是编造的（网址用 `example.com`）。不得提交 API Key。
   **Fictional data only** in tests, screenshots and fixtures; never commit API keys.
2. **数据库只做增量迁移**（`src/storage/db.ts` 追加新版本），不删表、不清库。
   **Database migrations are additive only.**
3. **界面文字要双语。** 源码里写 `tx('中文')`，然后运行 `node scripts/i18n/extract.mjs`，把缺的英文补进 `src/i18n/en.ts`（测试会检查）。发给 AI 的提示词和简历内容不要包 `tx`。
   **UI text must be bilingual:** write `tx('中文')`, run `node scripts/i18n/extract.mjs` and add the English to `src/i18n/en.ts` (a test enforces this). Don't wrap AI prompts or resume content in `tx`.
4. **AI 不得编造事实**；不要加入自动投递、自动发邮件之类功能。
   **AI must never invent facts;** no auto-apply or auto-email features.
5. 提交前请确保 `npm test`、`npx tsc -b`、`npm run lint`、`npm run build` 都通过。
   Make sure tests, type check, lint and build pass before opening a PR.
