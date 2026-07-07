import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Braces,
  ChevronDown,
  Database,
  GitBranch,
  Radio,
  ShieldCheck,
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

/** 责任方角标配色（与泳道图节点卡一致）。 */
const directionChip: Record<NodeDirection, string> = {
  User: 'bg-human/15 text-human-soft',
  A: 'bg-sky-500/15 text-sky-300',
  B: 'bg-teal-500/15 text-teal-300',
  C: 'bg-command/15 text-command-soft',
  D: 'bg-indigo-500/15 text-indigo-300',
  Merger: 'bg-emerald-500/15 text-emerald-300',
};

/** 冻结度用安静的色点 + 简短标签表达（替代 emoji）。 */
const frozenMeta: Record<FrozenLevel, { dot: string; label: string }> = {
  frozen: { dot: 'bg-emerald-400', label: 'frozen · 可对接' },
  partial: { dot: 'bg-amber-400', label: 'partial · 部分待定' },
  tbd: { dot: 'bg-rose-400', label: 'tbd · 未冻结' },
  reserved: { dot: 'bg-slate-500', label: 'reserved · v0 后置' },
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

      <div className="p-4">
        {!node ? (
          <p className="text-sm text-slate-500">点击泳道图中的节点查看详情。</p>
        ) : (
          // key=node.id：切换节点时重置所有折叠区的开合状态
          <div key={node.id} className="space-y-2.5">
            {/* ── 身份（常驻） ── */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                    {node.code}
                  </span>
                  <span
                    className={cn(
                      'rounded px-1 py-px font-mono text-[9px] font-semibold',
                      directionChip[node.direction],
                    )}
                  >
                    {node.direction}
                  </span>
                  {node.tier === 'human' && (
                    <span className="text-[9px] leading-none text-human">◆</span>
                  )}
                  <span className="font-display text-base font-semibold text-white">
                    {node.label}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {node.labelCn} · {node.owner}
                </div>
              </div>
              <NodeStatusPill status={node.status} />
            </div>

            {/* ── 概览：摘要 + 关键属性（常驻） ── */}
            <p className="text-xs leading-relaxed text-slate-300">{node.summary}</p>

            <dl className="grid grid-cols-[3.25rem_1fr] gap-x-3 gap-y-1.5 rounded-md border border-line bg-ink-900/50 px-3 py-2.5 text-[11px]">
              <dt className="text-slate-500">责任方</dt>
              <dd className="text-slate-300">{directionLabels[node.direction]}</dd>

              <dt className="text-slate-500">协调态</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {node.taskStatus ? (
                  <>
                    <TaskStatusPill status={node.taskStatus} />
                    <span className="font-mono text-[10px] text-slate-600">
                      = {UI_TO_CONTRACT_TASK_STATUS[node.taskStatus]}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </dd>

              <dt className="text-slate-500">冻结度</dt>
              <dd className="flex items-center gap-1.5 text-slate-300">
                <span className={cn('h-1.5 w-1.5 rounded-full', frozenMeta[node.frozen].dot)} />
                {frozenMeta[node.frozen].label}
              </dd>

              {node.statusNote && (
                <>
                  <dt className="text-slate-500">数据</dt>
                  <dd className="break-all font-mono text-[10px] text-slate-400">
                    {node.statusNote}
                  </dd>
                </>
              )}
            </dl>

            {/* ── Gate 决策（N13 常驻，该节点的核心信息） ── */}
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
              </div>
            )}

            {/* ── 折叠层：运行数据 / 契约 / 数据流 / 研判 ── */}

            {/* 运行数据（仅回放任务）：后端在本节点给出的事实，默认展开 */}
            {facts !== null && (
              <Collapsible
                icon={Database}
                title="运行数据"
                gloss="Run Data"
                accent="text-emerald-300"
                meta={facts.length > 0 ? String(facts.length) : undefined}
                defaultOpen
              >
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
              </Collapsible>
            )}

            {/* 契约规格：字段清单 decided / tbd + emit 事件 */}
            <Collapsible
              icon={Braces}
              title="契约规格"
              gloss="Contract"
              meta={`decided ${node.decided.length} · tbd ${node.tbd.length}`}
            >
              <div className="space-y-3">
                <FieldGroup title="decided · 已定" fields={node.decided} tone="emerald" />
                <FieldGroup title="tbd · 待定" fields={node.tbd} tone="amber" />
                {node.events.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-cyan-300">
                      <Radio className="h-3 w-3" /> emit 事件
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
              </div>
            </Collapsible>

            {/* 数据流：input → output */}
            <Collapsible
              icon={ArrowLeftRight}
              title="数据流"
              gloss="I/O"
              meta={`${node.input.length} → ${node.output.length}`}
            >
              <div className="space-y-2.5">
                <ChipList label="输入" items={node.input} tone="text-blue-300" />
                <ChipList label="输出" items={node.output} tone="text-emerald-300" />
              </div>
            </Collapsible>

            {/* 研判：风险 + 下一步 */}
            <Collapsible icon={AlertTriangle} title="风险研判" gloss="Assessment">
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-rose-300">
                    <AlertTriangle className="h-3 w-3" /> 风险
                  </div>
                  <p className="text-xs leading-relaxed text-rose-100/80">{node.risk}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-command-soft">
                    <ArrowRight className="h-3 w-3" /> 下一步
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300">{node.nextAction}</p>
                </div>
              </div>
            </Collapsible>

            {/* 活动：文件操作 / 执行日志（组件自带折叠，样式一致） */}
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

/** 统一样式的折叠抽屉（与 FileOpsPanel / 执行日志 同一视觉语言）。 */
function Collapsible({
  icon: Icon,
  title,
  gloss,
  meta,
  accent,
  defaultOpen = false,
  children,
}: {
  icon: typeof Database;
  title: string;
  gloss?: string;
  meta?: string;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-800 bg-ink-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/50"
      >
        <Icon className={cn('h-3.5 w-3.5', accent ?? 'text-slate-500')} />
        <span className={cn('text-[11px] font-semibold', accent ?? 'text-slate-300')}>{title}</span>
        {gloss && <span className="text-[10px] text-slate-600">{gloss}</span>}
        <span className="flex-1" />
        {meta && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {meta}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="border-t border-slate-800/80 px-3 py-2.5">{children}</div>}
    </div>
  );
}

/** 契约字段组（decided / tbd 共用）。 */
function FieldGroup({
  title,
  fields,
  tone,
}: {
  title: string;
  fields: FieldSpec[];
  tone: 'emerald' | 'amber';
}) {
  const toneText = tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300';
  return (
    <div>
      <div className={cn('mb-1.5 flex items-center gap-1 text-[10px] font-semibold', toneText)}>
        {title}
        <span className="text-slate-600">· {fields.length}</span>
      </div>
      {fields.length === 0 ? (
        <p className="text-[10px] text-slate-600">无</p>
      ) : (
        <div className="space-y-1">
          {fields.map((f) => (
            <div
              key={f.key}
              className="rounded border border-slate-800 bg-ink-900/60 px-2.5 py-1.5"
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

/** 输入 / 输出 的横排标签。 */
function ChipList({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  return (
    <div>
      <div className={cn('mb-1.5 text-[10px] font-semibold', tone)}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="rounded border border-slate-800 bg-ink-900/60 px-2 py-1 text-[11px] text-slate-300"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
