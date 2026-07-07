import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  ArrowRight,
  MousePointerSquareDashed,
  ShieldCheck,
  CheckCircle2,
  CircleDashed,
  Radio,
  GitBranch,
  Database,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { stripExecSuffix } from '@/data/workflow';
import { NodeStatusPill, TaskStatusPill } from '@/components/StatusPill';
import { NodeExecutionLog } from '@/components/NodeExecutionLog';
import { FileOpsPanel } from '@/components/FileOpsPanel';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { UI_TO_CONTRACT_TASK_STATUS } from '@/api/map';
import type {
  FieldSpec,
  FrozenLevel,
  GateDecision,
  InterventionScope,
  NodeDirection,
} from '@/types';

const scopeLabels: Record<InterventionScope, string> = {
  current_step: '仅当前步骤',
  current_agent: '当前 Agent 后续',
  whole_workflow: '整个 Workflow',
  project_rule: '项目长期规则',
};

const directionLabels: Record<NodeDirection, string> = {
  User: 'User · 用户 / 前端',
  A: 'A · Driver 执行',
  B: 'B · 角色 / 记忆',
  C: 'C · 协调编排',
  D: 'D · Hook / Gate',
  Merger: 'Merger · 合并器',
};

const frozenBadge: Record<
  FrozenLevel,
  { label: string; variant: 'green' | 'amber' | 'red' | 'slate' }
> = {
  frozen: { label: '🟢 frozen · 可直接对接', variant: 'green' },
  partial: { label: '🟡 partial · 部分待定', variant: 'amber' },
  tbd: { label: '🔴 tbd · 字段未冻结', variant: 'red' },
  reserved: { label: 'reserved · v0 后置', variant: 'slate' },
};

// Gate 四种决策 → 状态落点（字段清单 N13 decision_to_status）
const gateBranches: { decision: GateDecision; target: string }[] = [
  { decision: 'allow', target: '→ reviewing / completed' },
  { decision: 'deny', target: '→ blocked' },
  { decision: 'ask', target: '→ waiting_input' },
  { decision: 'defer', target: '→ pending_gate / pending_council' },
];

export function NodeInspector() {
  const nodes = useDemoStore((s) => s.nodes);
  const selectedNodeId = useDemoStore((s) => s.selectedNodeId);
  const rules = useDemoStore((s) => s.interventionRules);
  const feedback = useDemoStore((s) => s.interventionFeedback);
  const replay = useDemoStore(selectActiveReplay);

  const node = nodes.find((n) => n.id === selectedNodeId) ?? null;
  // 回放任务：该节点后端给出的事实字段（快照原文；空数组 = 本次 run 未提供）
  const facts = node && replay ? (replay.nodeFacts[stripExecSuffix(node.id)] ?? []) : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Intervention feedback banner */}
      {feedback && (
        <div className="m-3 mb-0 rounded-md border border-human/40 bg-human/10 p-3 shadow-glow-human">
          <div className="callsign flex items-center gap-2 text-[10px] text-human">
            <ShieldCheck className="h-4 w-4" /> 介入已生效
          </div>
          <p className="mt-1 text-xs leading-relaxed text-human-soft/90">{feedback}</p>
        </div>
      )}

      {/* Node detail */}
      <div className="p-4">
        <div className="callsign mb-2 flex items-center gap-2 text-[10px] text-slate-500">
          <MousePointerSquareDashed className="h-3.5 w-3.5" />
          Node Inspector
        </div>

        {!node ? (
          <p className="text-sm text-slate-500">点击泳道图中的节点查看详情。</p>
        ) : (
          <div className="space-y-3">
            {/* Header: code + label + node visual status */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                    {node.code}
                  </span>
                  <span className="font-display text-base font-semibold text-white">
                    {node.label}
                  </span>
                </div>
                <div className="callsign mt-0.5 text-[10px] text-slate-500">
                  {node.labelCn} · {node.owner}
                </div>
              </div>
              <NodeStatusPill status={node.status} />
            </div>

            {/* Meta chips: direction + frozen */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="slate">{directionLabels[node.direction]}</Badge>
              <Badge variant={frozenBadge[node.frozen].variant}>
                {frozenBadge[node.frozen].label}
              </Badge>
            </div>

            {/* Canonical task status */}
            <div className="rounded-md border border-line bg-ink-900/60 p-2.5">
              <div className="callsign mb-1.5 text-[9px] text-slate-500">
                TASK STATUS · 协调器主状态
              </div>
              {node.taskStatus ? (
                <>
                  <TaskStatusPill status={node.taskStatus} />
                  <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                    契约态 · TaskStatus = {UI_TO_CONTRACT_TASK_STATUS[node.taskStatus]}
                  </p>
                </>
              ) : (
                <span className="font-mono text-[11px] text-slate-400">—</span>
              )}
              {node.statusNote && (
                <p className="mt-1.5 font-mono text-[10px] text-slate-500">{node.statusNote}</p>
              )}
            </div>

            <p className="rounded-md border border-line bg-ink-900/60 p-3 text-xs leading-relaxed text-slate-300">
              {node.summary}
            </p>

            {/* 回放任务：后端在本节点给出的全部事实（快照原文，动态渲染） */}
            {facts !== null && (
              <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className="callsign mb-2 flex items-center gap-1.5 text-[10px] text-emerald-300">
                  <Database className="h-3.5 w-3.5" />
                  本次 Run · 后端数据
                </div>
                {facts.length === 0 ? (
                  <p className="text-[11px] text-slate-500">本次 run 未提供该节点数据。</p>
                ) : (
                  <div className="space-y-1">
                    {facts.map((f, i) => (
                      <div key={`${f.key}-${i}`} className="flex gap-2 font-mono text-[10px]">
                        <span className="w-[38%] shrink-0 break-all text-slate-500">{f.key}</span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-slate-200">
                          {f.value}
                        </span>
                        {f.time && <span className="shrink-0 text-slate-600">{f.time}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Gate decision branches (N13 only) */}
            {node.gateDecision && (
              <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300">
                  <GitBranch className="h-3.5 w-3.5" /> Gate 决策 → 状态落点
                </div>
                <div className="mt-2 space-y-1">
                  {gateBranches.map((b) => {
                    const active = b.decision === node.gateDecision;
                    return (
                      <div
                        key={b.decision}
                        className={cn(
                          'flex items-center justify-between rounded px-2 py-1 font-mono text-[10px]',
                          active
                            ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/40'
                            : 'text-slate-500',
                        )}
                      >
                        <span className="font-semibold">{b.decision}</span>
                        <span>{b.target}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-indigo-200/70">
                  本次走 <span className="font-semibold">{node.gateDecision}</span> 分支。
                </p>
              </div>
            )}

            {/* decided / tbd field schema */}
            <FieldSchema
              icon={CheckCircle2}
              title="decided · 已定字段"
              fields={node.decided}
              tone="emerald"
              emptyText="该节点无已冻结字段。"
            />
            <FieldSchema
              icon={CircleDashed}
              title="tbd · 待定字段"
              fields={node.tbd}
              tone="amber"
              emptyText="无待定字段，字段已全部冻结。"
            />

            {/* emitted events */}
            {node.events.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                  <Radio className="h-3.5 w-3.5" /> emit 事件
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {node.events.map((e) => (
                    <span
                      key={e}
                      className="rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[10px] text-cyan-200"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <InfoList icon={ArrowDownToLine} title="输入" items={node.input} tone="blue" />
            <InfoList icon={ArrowUpFromLine} title="输出" items={node.output} tone="green" />

            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" /> 风险
              </div>
              <p className="mt-1 text-xs text-rose-100/80">{node.risk}</p>
            </div>

            <div className="rounded-md border border-command/20 bg-command/5 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-command-soft">
                <ArrowRight className="h-3.5 w-3.5" /> 下一步
              </div>
              <p className="mt-1 text-xs text-slate-300">{node.nextAction}</p>
            </div>

            <FileOpsPanel nodeId={node.id} status={node.status} />

            <NodeExecutionLog nodeId={node.id} status={node.status} />
          </div>
        )}
      </div>

      {/* Intervention rules */}
      {rules.length > 0 && (
        <div className="border-t border-line p-4">
          <div className="callsign mb-2 flex items-center gap-2 text-[10px] text-human">
            <ShieldCheck className="h-3.5 w-3.5" />
            用户介入规则 · {rules.length}
          </div>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="rounded-md border border-human/30 bg-human/5 p-3">
                <p className="text-xs text-human-soft">{r.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="amber">{scopeLabels[r.scope]}</Badge>
                  {r.affectedAgents.map((a) => (
                    <Badge key={a} variant="slate">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldSchema({
  icon: Icon,
  title,
  fields,
  tone,
  emptyText,
}: {
  icon: typeof CheckCircle2;
  title: string;
  fields: FieldSpec[];
  tone: 'emerald' | 'amber';
  emptyText: string;
}) {
  const toneText = tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300';
  return (
    <div>
      <div className={cn('mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold', toneText)}>
        <Icon className="h-3.5 w-3.5" /> {title}
        <span className="text-slate-600">· {fields.length}</span>
      </div>
      {fields.length === 0 ? (
        <p className="text-[11px] text-slate-600">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {fields.map((f) => (
            <div
              key={f.key}
              className="rounded-md border border-slate-800 bg-ink-900/60 px-2.5 py-1.5"
            >
              <div className="font-mono text-[11px] font-semibold text-slate-200">{f.key}</div>
              <div className="mt-0.5 font-mono text-[10px] leading-snug text-slate-500">
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoList({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: typeof ArrowDownToLine;
  title: string;
  items: string[];
  tone: 'blue' | 'green';
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold',
          tone === 'blue' ? 'text-blue-300' : 'text-emerald-300',
        )}
      >
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="rounded-md border border-slate-800 bg-ink-900/60 px-2 py-1 text-[11px] text-slate-300"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
