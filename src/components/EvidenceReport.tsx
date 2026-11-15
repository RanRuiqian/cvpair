import { useState } from 'react';
import { useApp } from '../store';
import { refreshReportSelection } from '../joint/report';
import { linkJointApplications } from '../joint/versions';
import { db } from '../storage/db';
import { downloadBytes } from '../utils/download';

import { tx, txDeep } from '../i18n/tx';
const STATUS = txDeep({ direct: "相关经历", transferable: "可迁移背景", learning: "仅课程知识支持，实践仍有缺口", gap: "资料尚未体现" });
const CATEGORY = txDeep({ work: "实际工作", project: "项目经历", course: "课程学习", education: "教育背景", skill: "技能", certificate: "证书", award: "奖项", campus: "学生组织" });
export function EvidenceReport({ go }: { go?: (p: string) => void }) {
  const { resume, profile, template, job } = useApp();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  if (!resume?.evidenceReport) return null;
  const report = refreshReportSelection(resume)!;
  const canLink = !!job?.joint && job.id === resume.jobId;
  const refs = new Map(report.targets.flatMap((t) => t.requirements.map((r) => [r.requirementId, `${t.title.zh || t.title.en}：${r.text}`])));
  const warning = report.synthesis?.conflicts.length || (report.targets.length > 1 && (!report.synthesis?.common.length || report.targets.some((t) => t.requirements.filter((q) => q.assessment === 'learning' || q.assessment === 'gap').length >= t.requirements.length / 2)));
  return <details className="card evidence-report" data-testid="evidence-report">
    <summary>{report.targets.length > 1 ? tx("各岗位的匹配说明与提升方向") : tx("查看 AI 选材说明与提升方向")}</summary>
    <p className="muted small">{tx("AI 结合岗位需求、课程内容和经历进行选材。你可以在素材池自由调整；课程知识与实际项目分别呈现。")}</p>
    {warning ? <div className="notice warn" data-testid="joint-conflict">{tx("单份简历难以同时强匹配：岗位之间存在冲突或缺少共同要求。可继续使用共同版本，也可返回单岗位模式分别制作。")}</div> : null}
    {report.synthesis && (['common', 'complementary', 'conflicts'] as const).map((kind) => <details key={kind} open><summary>{kind === 'common' ? tx("共同要求") : kind === 'complementary' ? tx("互补 / 各岗特有要求") : tx("冲突 / 无法同时覆盖")}</summary>
      {report.synthesis![kind].length ? report.synthesis![kind].map((row, i) => <div className="notice small" key={i}><b>{tx("AI 关联依据：")}</b>{row.reason}<ul>{row.requirementIds.map((id) => <li key={id}>{refs.get(id) || id}</li>)}</ul></div>) : <p className="muted small">{tx("本次未识别到该类归纳；请人工核对。")}</p>}
    </details>)}
    {report.targets.map((target) => <section key={target.jobId} data-testid="role-evidence-report"><h4>{target.title.zh || target.title.en}</h4>
      {target.requirements.map((r, i) => <details className="card" key={r.requirementId || i} open={r.assessment === 'gap' || r.assessment === 'learning'}><summary><b>{r.text}</b> · {STATUS[r.assessment]}</summary>
        <p className="small">{tx("AI 候选原因 / 关联依据：")}{r.reason || tx("由所引事实提供对应背景，可自行调整。")}</p>
        {r.evidence.map((e) => <div className="notice small" key={e.id}><b>{CATEGORY[e.category]}</b> · {e.label}<br />{e.zh || e.en}<br /><span className={e.selected ? 'ok-text' : 'err-text'}>{e.selected ? tx("已选入本简历") : tx("未选入本简历，资料库保留")}</span></div>)}
        {r.risks.length > 0 && <div className="muted small">{tx("表述建议：")}{r.risks.join('；')}</div>}
      </details>)}
    </section>)}
    <details><summary>{tx("AI 选材原因（可在素材池或本份简历选项中调整、排序）")}</summary>{report.selectionReasons.map((s, i) => <p className="small" key={i}>{s}</p>)}</details>
    <div className="row"><button onClick={() => downloadBytes(new TextEncoder().encode(JSON.stringify(report, null, 2)), 'evidence-and-gaps.json', 'application/json')}>{tx("下载岗位匹配说明")}</button>
      {canLink && <button className="primary" data-testid="link-shared-resume" disabled={busy} onClick={async () => {
        setBusy(true); setMessage(tx("正在保存共同简历并关联待投递记录…"));
        try { const result = await linkJointApplications(db, { profile, template, resume, job: job! }); setMessage(tx("已关联 {0} 条记录，共用同一份简历版本。未修改为已投递；后续改简历请显式关联新版本。", result.applicationIds.length)); }
        catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
      }}>{tx("将同一版本关联到")} {report.targets.length} {tx("条投递记录")}</button>}
      {go && <button onClick={() => go('applications')}>{tx("查看求职记录 →")}</button>}
    </div>{message && <div role="status" className="notice" data-testid="shared-link-result">{message}</div>}
  </details>;
}
