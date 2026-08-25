import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Save,
  ScanSearch,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { memoryApi } from '@/api/memory';
import { BackendError } from '@/api/transport';
import type {
  MemoryAgentMetaPatch,
  MemoryCapabilities,
  MemoryOperationName,
  MemoryPersonaPatch,
  MemoryReplacementStrategy,
  MemoryRetiredReason,
  RpcAgentBoardAgentView,
  RpcPersonaView,
  RpcRetireResult,
  RpcRetirementScanResult,
} from '@/api/types/memory';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IdChip } from '@/components/ui/IdChip';
import { Panel } from '@/components/ui/Panel';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/utils';

/**
 * Agent 生命周期面板 —— 创建 / 改名 / 画像 / 退休扫描 / 退休 / 删除。
 *
 * 三条约束，都来自后端契约而不是审美：
 *
 * 1. **按声明渲染入口。** 每个分区先读 `memory.getCapabilities` 里对应的
 *    `operations.<name>`：`available` 才给控件，`unavailable` 就把后端给的 `reason`
 *    原样摆出来。能力还没读回来时说「正在读取」，不预设它可用。
 * 2. **删除的第二次确认由后端触发，不由界面猜。** 后端把「Agent 未退休」当业务错误
 *    （APPLICATION_ERROR）透传，原话里写着补救办法 `pass force: true`。界面先只带
 *    `confirm: true` 试一次，被拒了才把原话摆给用户、再单独确认一次 `force: true`。
 *    市场池 Agent、角色不存在这类错误不会走到强删那一步 —— 它们不该被引导去强删。
 * 3. **退休扫描只是建议。** 后端 `runRetirementScan` 从不真的退休任何 Agent，
 *    所以扫描结果里的「建议退休」旁边不放一键退休，只放「用作退休原因」的表单预填。
 * 4. **退休是两阶段的，终态会删掉实体。** 上游 #114 之后：名下还有在跑任务时只置
 *    draining 并返回 `status='pre_retired'`（`asset_disposition` 是 undefined —— 直接读
 *    它的字段会抛 TypeError），等任务收尾自动 finalize；finalize 完成后 **Agent 实体从库里
 *    删除**，只留一条没有 RPC 出口的归档。所以 `status='retired'` 之后这个面板必须像删除
 *    一样收起来，否则后续任何 `getAgent` 都会 `Agent not found`。
 *
 * 错误口径：分区内的操作失败一律交给 `onError` 由父组件统一展示；只有弹窗里的表单
 * （新建 Agent）把错误留在弹窗内 —— 弹窗盖住了父组件的错误条，扔上去用户看不见。
 */
export interface MemoryPanelProps {
  roleId: string;
  capabilities: MemoryCapabilities | undefined;
  onError: (message: string) => void;
  /** 任何写操作成功后调用，让父组件重新拉取 Agent 列表。 */
  onChanged: () => void;
}

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/** 后端在删除被拒时给出的补救办法原文；只认这一句才引导强制删除。 */
const FORCE_HINT = 'pass force: true';

// ── 枚举词表：中文标签在前，协议字面量只作灰色注解（F2） ──

const RETIRE_REASONS: { value: MemoryRetiredReason; label: string }[] = [
  { value: 'manual', label: '人工决定' },
  { value: 'performance_degradation', label: '表现下滑' },
  { value: 'inactivity', label: '长期闲置' },
  { value: 'persona_drift', label: '画像漂移' },
  { value: 'split', label: '拆分重组' },
];

const REPLACEMENTS: { value: MemoryReplacementStrategy; label: string }[] = [
  { value: 'none', label: '不建替代' },
  { value: 'clean_slate', label: '空白替代' },
  { value: 'seeded_slate', label: '带种子替代' },
];

const SCAN_ACTION_LABEL: Record<string, string> = {
  retire: '建议退休',
  warn: '需要关注',
  keep: '建议保留',
};

const LAYER_LABEL: Record<string, string> = {
  statistical: '统计门控',
  persona_drift: '画像漂移',
  llm: '模型评估',
};

const PERSONA_FIELDS: { key: keyof MemoryPersonaPatch; label: string; rows: number }[] = [
  { key: 'summary', label: '角色摘要', rows: 3 },
  { key: 'skills_overview', label: '技能概览', rows: 3 },
  { key: 'experience_coverage', label: '经验覆盖', rows: 3 },
  { key: 'recent_performance', label: '近期表现', rows: 3 },
  { key: 'notes', label: '补充说明', rows: 2 },
];

type PersonaDraft = Record<keyof MemoryPersonaPatch, string>;

const EMPTY_PERSONA_DRAFT: PersonaDraft = {
  summary: '',
  skills_overview: '',
  experience_coverage: '',
  recent_performance: '',
  notes: '',
};

function toPersonaDraft(persona: RpcPersonaView): PersonaDraft {
  return {
    summary: persona.summary ?? '',
    skills_overview: persona.skills_overview ?? '',
    experience_coverage: persona.experience_coverage ?? '',
    recent_performance: persona.recent_performance ?? '',
    notes: persona.notes ?? '',
  };
}

/** 只把改动过的段落塞进 PATCH：后端要求至少一个字段，空串是「清空这一段」而不是「不改」。 */
function personaPatch(persona: RpcPersonaView, draft: PersonaDraft): MemoryPersonaPatch {
  const patch: MemoryPersonaPatch = {};
  for (const field of PERSONA_FIELDS) {
    if (draft[field.key] !== (persona[field.key] ?? '')) patch[field.key] = draft[field.key];
  }
  return patch;
}

const parseTags = (raw: string): string[] =>
  raw
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const parseLines = (raw: string): string[] =>
  raw
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const ratio = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');

type Busy = 'meta' | 'persona' | 'regenerate' | 'scan' | 'retire' | 'delete' | null;

const INPUT_CLASS =
  'w-full rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40';

export function AgentAdminPanel({ roleId, capabilities, onError, onChanged }: MemoryPanelProps) {
  const [agent, setAgent] = useState<RpcAgentBoardAgentView>();
  const [agentLoading, setAgentLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleted, setDeleted] = useState(false);
  /** 退休 finalize 完成 —— 与 deleted 同样意味着实体已不在库里。 */
  const [retired, setRetired] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  const [nameDraft, setNameDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [personaDraft, setPersonaDraft] = useState<PersonaDraft>(EMPTY_PERSONA_DRAFT);

  const [scans, setScans] = useState<RpcRetirementScanResult[]>();
  const [retireReason, setRetireReason] = useState<MemoryRetiredReason>('manual');
  const [replacement, setReplacement] = useState<MemoryReplacementStrategy>('none');
  const [retireResult, setRetireResult] = useState<RpcRetireResult>();

  const [confirming, setConfirming] = useState<'retire' | 'delete' | null>(null);
  /** 后端拒绝删除时的原话；非 null 即弹出第二次（强制删除）确认。 */
  const [forceMessage, setForceMessage] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  // 父组件多半会传一个每次渲染都新建的箭头函数；放进依赖数组会让读取 Agent 变成死循环。
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // 切换 Agent：上一个 Agent 的一次性结果必须清掉，否则会张冠李戴。
  useEffect(() => {
    setScans(undefined);
    setRetireResult(undefined);
    setDeleted(false);
    setRetired(false);
    setRetireReason('manual');
    setReplacement('none');
  }, [roleId]);

  useEffect(() => {
    let active = true;
    setAgentLoading(true);
    void memoryApi
      .getAgent(roleId)
      .then((result) => {
        if (!active) return;
        setAgent(result.agent);
        setNameDraft(result.agent.name);
        setTagsDraft((result.agent.tags ?? []).join(', '));
        setPersonaDraft(toPersonaDraft(result.agent.persona));
      })
      .catch((reason: unknown) => {
        if (active) onErrorRef.current(errorMessage(reason));
      })
      .finally(() => {
        if (active) setAgentLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleId, reloadToken]);

  const metaPatch = (): MemoryAgentMetaPatch => {
    const patch: MemoryAgentMetaPatch = {};
    if (!agent) return patch;
    const nextName = nameDraft.trim();
    // name 在后端是 .min(1)：空名字不是「不改」，是一次必然被拒的请求。
    if (nextName.length > 0 && nextName !== agent.name) patch.name = nextName;
    const nextTags = parseTags(tagsDraft);
    if (!sameList(nextTags, agent.tags ?? [])) patch.tags = nextTags;
    return patch;
  };

  const metaDirty = Object.keys(metaPatch()).length > 0;
  const personaDirty = agent
    ? Object.keys(personaPatch(agent.persona, personaDraft)).length > 0
    : false;

  const saveMeta = async () => {
    const patch = metaPatch();
    if (busy || Object.keys(patch).length === 0) return;
    setBusy('meta');
    try {
      const result = await memoryApi.updateAgent(roleId, patch);
      setAgent(result.agent);
      setNameDraft(result.agent.name);
      setTagsDraft((result.agent.tags ?? []).join(', '));
      onChanged();
    } catch (reason) {
      onError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const applyPersona = (persona: RpcPersonaView) => {
    setAgent((current) => (current ? { ...current, persona } : current));
    setPersonaDraft(toPersonaDraft(persona));
  };

  const savePersona = async () => {
    if (!agent || busy) return;
    const patch = personaPatch(agent.persona, personaDraft);
    if (Object.keys(patch).length === 0) return;
    setBusy('persona');
    try {
      const result = await memoryApi.updatePersona(roleId, patch);
      applyPersona(result.persona);
      onChanged();
    } catch (reason) {
      onError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const regeneratePersona = async () => {
    if (busy) return;
    setBusy('regenerate');
    try {
      const result = await memoryApi.regeneratePersona(roleId);
      applyPersona(result.persona);
      onChanged();
    } catch (reason) {
      onError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const runScan = async () => {
    if (busy) return;
    setBusy('scan');
    try {
      const result = await memoryApi.retirementScan(roleId);
      setScans(result.scans);
    } catch (reason) {
      onError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const runRetire = async () => {
    if (busy) return;
    setBusy('retire');
    try {
      const result = await memoryApi.retireAgent(roleId, {
        reason: retireReason,
        replacement,
      });
      setRetireResult(result.retire);
      // status='retired' 表示 finalize 完成、实体已删；再去 getAgent 只会拿到
      // `Agent not found`，所以这里跟删除走同一条收尾路径（收起面板 + 让父组件重拉列表）。
      if (result.retire.status === 'retired') {
        setAgent(undefined);
        setRetired(true);
      } else {
        setReloadToken((token) => token + 1);
      }
      onChanged();
    } catch (reason) {
      onError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async (force: boolean) => {
    if (busy) return;
    setBusy('delete');
    try {
      await memoryApi.deleteAgent(
        roleId,
        force ? { confirm: true, force: true } : { confirm: true },
      );
      setAgent(undefined);
      setDeleted(true);
      onChanged();
    } catch (reason) {
      const message = errorMessage(reason);
      // 只有后端自己写出了 `pass force: true` 才引导强删；
      // 「市场池不可删」「角色不存在」同样是 APPLICATION_ERROR，但强删救不了它们。
      if (!force && reason instanceof BackendError && message.includes(FORCE_HINT)) {
        setForceMessage(message);
        return;
      }
      onError(message);
    } finally {
      setBusy(null);
    }
  };

  const createState = operationState(capabilities, 'create_agent');

  return (
    <div className="space-y-3">
      <AgentHeader
        agent={agent}
        loading={agentLoading}
        gone={deleted ? 'deleted' : retired ? 'retired' : undefined}
        roleId={roleId}
      />

      <OperationSection title="新建 Agent" method="memory.createAgent" state={createState}>
        <p className="text-body text-fg-muted">
          新建的是另一个 Agent，不会改变当前选中的这个；创建成功后左侧列表会重新拉取。
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <UserPlus className="h-3.5 w-3.5" />
          新建 Agent
        </Button>
      </OperationSection>

      {!deleted && !retired && (
        <>
          <OperationSection
            title="基本信息"
            method="memory.updateAgent"
            state={operationState(capabilities, 'update_agent')}
          >
            {agent ? (
              <div className="space-y-3">
                <Field label="名称">
                  <input
                    value={nameDraft}
                    onChange={(e) => {
                      setNameDraft(e.target.value);
                    }}
                    placeholder="展示用名称"
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="标签" hint="逗号或换行分隔；清空即删除全部标签。">
                  <input
                    value={tagsDraft}
                    onChange={(e) => {
                      setTagsDraft(e.target.value);
                    }}
                    placeholder="backend, review"
                    className={INPUT_CLASS}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null || !metaDirty}
                    onClick={() => void saveMeta()}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {busy === 'meta' ? '保存中…' : '保存改动'}
                  </Button>
                  {!metaDirty && (
                    <span className="text-body text-fg-muted">没有待保存的改动。</span>
                  )}
                </div>
              </div>
            ) : (
              <PendingLine text="正在读取当前 Agent…" loading={agentLoading} />
            )}
          </OperationSection>

          <OperationSection
            title="角色画像"
            method="memory.updatePersona"
            state={operationState(capabilities, 'update_persona')}
          >
            {agent ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-3 text-body text-fg-muted">
                  <span>
                    版本{' '}
                    <span className="tabular font-mono text-code">{agent.persona.version}</span>
                  </span>
                  <span>生成于 {agent.persona.generated_at || '—'}</span>
                </div>
                {PERSONA_FIELDS.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <Textarea
                      rows={field.rows}
                      value={personaDraft[field.key]}
                      onChange={(e) => {
                        setPersonaDraft((current) => ({ ...current, [field.key]: e.target.value }));
                      }}
                      placeholder="留空即清空这一段"
                    />
                  </Field>
                ))}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null || !personaDirty}
                    onClick={() => void savePersona()}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {busy === 'persona' ? '保存中…' : '保存画像'}
                  </Button>
                  <span className="text-body text-fg-muted">
                    {personaDirty ? '保存后画像版本 +1。' : '没有待保存的改动。'}
                  </span>
                </div>
              </div>
            ) : (
              <PendingLine text="正在读取当前画像…" loading={agentLoading} />
            )}
          </OperationSection>

          <OperationSection
            title="重新归纳画像"
            method="memory.regeneratePersona"
            state={operationState(capabilities, 'regenerate_persona')}
          >
            <p className="text-body text-fg-muted">
              让后端按现有技能与经验重新归纳一份画像，覆盖上面的全部段落。手工改动未保存的话会一并丢失。
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void regeneratePersona()}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', busy === 'regenerate' && 'animate-spin')} />
              {busy === 'regenerate' ? '归纳中…' : '重新归纳'}
            </Button>
          </OperationSection>

          <OperationSection
            title="退休扫描"
            method="memory.retirementScan"
            state={operationState(capabilities, 'retirement_scan')}
          >
            <p className="text-body text-fg-muted">
              三重门控（统计 / 画像漂移 / 模型）只出结论，不会真的退休任何 Agent。
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void runScan()}
            >
              <ScanSearch className="h-3.5 w-3.5" />
              {busy === 'scan' ? '扫描中…' : '扫描这个 Agent'}
            </Button>
            {busy === 'scan' && <PendingLine text="后端正在逐层评估…" loading />}
            {scans && scans.length === 0 && !busy && (
              <p className="mt-3 text-body text-fg-muted">后端这次没有返回任何评估结果。</p>
            )}
            {scans && scans.length > 0 && (
              <div className="mt-3 space-y-2">
                {scans.map((scan) => (
                  <ScanCard
                    key={scan.scan_id}
                    scan={scan}
                    onUseReason={(reason) => {
                      setRetireReason(reason);
                    }}
                  />
                ))}
              </div>
            )}
          </OperationSection>

          <OperationSection
            title="退休"
            method="memory.retireAgent"
            state={operationState(capabilities, 'retire_agent')}
          >
            <p className="text-body text-fg-muted">
              退休会把被引用过的技能迁入技能市场，未被引用的技能标记为独占保留；置信度低于 0.7
              的经验会被丢弃。
              <strong className="text-fg-secondary">退休完成后 Agent 实体会从库中移除</strong>
              ，只保留一条归档记录。名下还有在跑任务时先进入「预退休」（停止竞标与派发），
              等任务收尾时后端自动完成。对已归档的角色重复退休是幂等的。
            </p>
            <div className="mt-3 space-y-3">
              <Field label="退休原因">
                <ChoiceRow
                  options={RETIRE_REASONS}
                  value={retireReason}
                  onChange={setRetireReason}
                />
              </Field>
              <Field label="替代策略" hint="非 none 时后端会新建一个 __replacement 后缀的 Agent。">
                <ChoiceRow options={REPLACEMENTS} value={replacement} onChange={setReplacement} />
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setConfirming('retire');
                }}
              >
                <UserMinus className="h-3.5 w-3.5" />
                {busy === 'retire' ? '退休中…' : '退休这个 Agent'}
              </Button>
            </div>
            {retireResult && !retired && <RetireResultCard result={retireResult} />}
          </OperationSection>

          <OperationSection
            title="删除"
            method="memory.deleteAgent"
            state={operationState(capabilities, 'delete_agent')}
          >
            <p className="text-body text-fg-muted">
              硬删除，级联清除它的技能、经验、画像与缓冲区，不可撤销。想保留资产请先退休。
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                setConfirming('delete');
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {busy === 'delete' ? '删除中…' : '删除这个 Agent'}
            </Button>
          </OperationSection>
        </>
      )}

      {/* 退休成功会收起上面整块，但处置结果只在这里出现过一次 —— 收起后补摆在外层 */}
      {retired && retireResult && <RetireResultCard result={retireResult} />}

      <CreateAgentDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={onChanged}
      />

      <ConfirmDialog
        open={confirming === 'retire'}
        title="确认退休这个 Agent？"
        description="退休后它不再参与竞标；技能迁入市场，低置信度经验会被丢弃。退休完成时 Agent 实体会被移除，只留归档记录，不可撤销。"
        confirmLabel="退休"
        onConfirm={() => void runRetire()}
        onClose={() => {
          setConfirming(null);
        }}
      />

      <ConfirmDialog
        open={confirming === 'delete'}
        title="永久删除这个 Agent？"
        description="删除不可撤销。如果它还没退休，后端会拒绝这次删除并要求你再单独确认一次。"
        confirmLabel="删除"
        onConfirm={() => void runDelete(false)}
        onClose={() => {
          setConfirming(null);
        }}
      />

      {/* 第二次确认：后端原话在前，后果在后。用户必须再点一次才会带上 force。 */}
      <ConfirmDialog
        open={forceMessage !== null}
        title="它还没退休，仍要强制删除？"
        description={`后端原话：${forceMessage ?? ''} —— 强制删除会连同它的全部技能、经验与画像一起丢弃，技能不会迁入市场。`}
        confirmLabel="强制删除"
        onConfirm={() => void runDelete(true)}
        onClose={() => {
          setForceMessage(null);
        }}
      />
    </div>
  );
}

// ── 能力门控 ──

type OperationState =
  | { kind: 'pending' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string };

/** 能力清单还没回来时不预设可用；`unavailable` 时把后端给的 reason 原样交出去。 */
function operationState(
  capabilities: MemoryCapabilities | undefined,
  name: MemoryOperationName,
): OperationState {
  if (!capabilities) return { kind: 'pending' };
  const capability = capabilities.operations[name];
  if (capability.status === 'available') return { kind: 'available' };
  return { kind: 'unavailable', reason: capability.reason || '后端没有说明原因。' };
}

function OperationSection({
  title,
  method,
  state,
  children,
}: {
  title: string;
  /** 协议方法名，只作标题旁的灰色注解。 */
  method: string;
  state: OperationState;
  children: ReactNode;
}) {
  return (
    <Panel>
      <h4 className="flex flex-wrap items-baseline gap-2 text-title text-fg-primary">
        {title}
        <span className="font-mono text-code text-fg-faint">{method}</span>
      </h4>
      {state.kind === 'pending' && (
        <p className="mt-2 text-body text-fg-muted">正在读取后端能力声明…</p>
      )}
      {state.kind === 'unavailable' && (
        <p className="mt-2 text-body text-human-soft">后端未提供该操作：{state.reason}</p>
      )}
      {state.kind === 'available' && <div className="mt-3">{children}</div>}
    </Panel>
  );
}

// ── 小构件 ──

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-body text-fg-secondary">{label}</label>
      {children}
      {hint && <p className="mt-1 text-body text-fg-muted">{hint}</p>}
    </div>
  );
}

function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'flex items-baseline gap-1.5 rounded-chip border px-2 py-1 transition-colors',
              active
                ? 'border-command/60 bg-command/10'
                : 'border-edge bg-surface-panel hover:border-edge-strong',
            )}
          >
            <span className={cn('text-body', active ? 'text-command-soft' : 'text-fg-secondary')}>
              {option.label}
            </span>
            <span className="font-mono text-code text-fg-faint">{option.value}</span>
          </button>
        );
      })}
    </div>
  );
}

function PendingLine({ text, loading }: { text: string; loading?: boolean }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-body text-fg-muted">
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {text}
    </p>
  );
}

function AgentHeader({
  agent,
  loading,
  gone,
  roleId,
}: {
  agent: RpcAgentBoardAgentView | undefined;
  loading: boolean;
  /** 实体已不在库里的两种原因；两者都要收起下面所有按角色取数的分区。 */
  gone: 'deleted' | 'retired' | undefined;
  roleId: string;
}) {
  if (gone) {
    return (
      <Panel className="border-danger/30">
        <p className="text-body text-danger-soft">
          {gone === 'deleted'
            ? '这个 Agent 已被删除。左侧列表刷新后请另选一个。'
            : '这个 Agent 已退休完成，实体已从库中移除（技能已迁入市场池）。左侧列表刷新后请另选一个。'}
        </p>
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-title text-fg-primary">{agent?.name || '—'}</span>
        <IdChip value={roleId} label="角色" />
        {agent && (
          <Badge variant={agent.status === 'active' ? 'ok' : 'default'}>{agent.status}</Badge>
        )}
      </div>
      {agent ? (
        <p className="mt-1 text-body text-fg-muted">
          创建于 {agent.created_at || '—'} · 技能 {agent.skill_count} · 经验{' '}
          {agent.experience_count}
        </p>
      ) : (
        <PendingLine text="正在读取 Agent 详情…" loading={loading} />
      )}
    </Panel>
  );
}

function ScanCard({
  scan,
  onUseReason,
}: {
  scan: RpcRetirementScanResult;
  onUseReason: (reason: MemoryRetiredReason) => void;
}) {
  const suggested = scan.suggested_reason;
  return (
    <Panel className="bg-surface-void">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={scan.action === 'retire' ? 'danger' : scan.action === 'warn' ? 'human' : 'ok'}
        >
          {SCAN_ACTION_LABEL[scan.action] || '未知结论'}
        </Badge>
        <span className="font-mono text-code text-fg-faint">{scan.action}</span>
        <span className="text-body text-fg-muted">
          置信度 <span className="tabular font-mono text-code">{ratio(scan.confidence)}</span>
        </span>
        <span className="ml-auto">
          <IdChip value={scan.scan_id} label="扫描" />
        </span>
      </div>
      <p className="mt-1 text-body text-fg-muted">{scan.scanned_at || '—'}</p>

      {scan.error && (
        <p className="mt-2 flex items-start gap-2 text-body text-danger-soft">
          <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" />
          {scan.error}
        </p>
      )}

      {scan.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {scan.reasons.map((reason, index) => (
            <li key={`${scan.scan_id}-${String(index)}`} className="text-body text-fg-secondary">
              · {reason}
            </li>
          ))}
        </ul>
      )}

      {scan.layers.length > 0 && (
        <div className="mt-2 space-y-1">
          {scan.layers.map((layer) => (
            <div
              key={`${scan.scan_id}-${layer.layer}`}
              className="flex flex-wrap items-baseline gap-2 border-t border-edge pt-1 text-body text-fg-muted"
            >
              <span className="text-fg-secondary">{LAYER_LABEL[layer.layer] || layer.layer}</span>
              <span className="font-mono text-code text-fg-faint">{layer.layer}</span>
              <span>{SCAN_ACTION_LABEL[layer.action] || layer.action}</span>
              <span className="tabular font-mono text-code">{ratio(layer.confidence)}</span>
              {layer.skipped && <span className="text-human-soft">冷却期内跳过</span>}
              {typeof layer.persona_drift === 'number' && (
                <span>
                  漂移{' '}
                  <span className="tabular font-mono text-code">{ratio(layer.persona_drift)}</span>
                </span>
              )}
              {typeof layer.market_replaceability === 'number' && (
                <span>
                  可替代{' '}
                  <span className="tabular font-mono text-code">
                    {ratio(layer.market_replaceability)}
                  </span>
                </span>
              )}
              {typeof layer.experience_recoverability === 'number' && (
                <span>
                  可恢复{' '}
                  <span className="tabular font-mono text-code">
                    {ratio(layer.experience_recoverability)}
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {suggested && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-body text-fg-muted">建议原因</span>
          <span className="font-mono text-code text-fg-faint">{suggested}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onUseReason(suggested);
            }}
          >
            填入退休表单
          </Button>
        </div>
      )}
    </Panel>
  );
}

/**
 * 退休结果卡。两种终局要分开画：
 * - `pre_retired`：只置了 draining，`asset_disposition` 是 undefined —— 旧版直接解构它，
 *   一遇到「名下还有在跑任务」就白屏。这里既不解构也不说「已退休」。
 * - `retired`：finalize 完成，处置计数齐全，实体已删。
 */
function RetireResultCard({ result }: { result: RpcRetireResult }) {
  const disposition = result.asset_disposition;
  const pending = result.status === 'pre_retired';
  return (
    <Panel className="mt-3 bg-surface-void">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={pending ? 'human' : 'ok'}>{pending ? '预退休' : '已退休'}</Badge>
        {result.retired_reason && (
          <span className="font-mono text-code text-fg-faint">{result.retired_reason}</span>
        )}
        <span className="text-body text-fg-muted">{result.retired_at || '—'}</span>
      </div>
      {pending ? (
        <p className="mt-2 text-body text-fg-secondary">
          名下还有在跑的任务，已停止竞标与派发。等任务收尾时后端会自动完成退休并处置资产，
          此刻还没有处置结果。
        </p>
      ) : disposition ? (
        <p className="mt-2 text-body text-fg-secondary">
          技能迁入市场{' '}
          <span className="tabular font-mono text-code">{disposition.skills_retained}</span> ·
          技能丢弃{' '}
          <span className="tabular font-mono text-code">{disposition.skills_discarded}</span> ·
          经验保留{' '}
          <span className="tabular font-mono text-code">{disposition.experiences_retained}</span> ·
          经验丢弃{' '}
          <span className="tabular font-mono text-code">{disposition.experiences_discarded}</span>
        </p>
      ) : (
        <p className="mt-2 text-body text-fg-muted">后端没有返回资产处置结果。</p>
      )}
      {result.replacement_role_id && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-body text-fg-muted">已创建替代 Agent</span>
          <IdChip value={result.replacement_role_id} />
        </div>
      )}
    </Panel>
  );
}

// ── 新建 Agent 弹窗 ──

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [seed, setSeed] = useState('');
  const [constraints, setConstraints] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const reset = () => {
    setRoleId('');
    setName('');
    setTags('');
    setSeed('');
    setConstraints('');
    setError(undefined);
  };

  const close = () => {
    reset();
    onClose();
  };

  const canSubmit = roleId.trim().length > 0 && name.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || creating) return;
    setCreating(true);
    setError(undefined);
    const tagList = parseTags(tags);
    const constraintList = parseLines(constraints);
    const seedText = seed.trim();
    try {
      await memoryApi.createAgent({
        role_id: roleId.trim(),
        name: name.trim(),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
        ...(seedText ? { persona_seed: seedText } : {}),
        ...(constraintList.length > 0 ? { constraints: constraintList } : {}),
      });
      onCreated();
      reset();
      onClose();
    } catch (reason) {
      // 留在弹窗里：弹窗盖住了父组件的错误条，扔上去用户看不见，也没法就地改。
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} className="max-w-xl">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel bg-command/15 text-command-soft">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-title text-fg-primary">新建 Agent</h2>
            <p className="text-body text-fg-muted">角色标识一旦占用就不能再建同名的。</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="角色标识" hint="后端主键，创建后不可改。">
            <input
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
              }}
              placeholder="backend-dev"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="名称">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="后端开发"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="标签（可选）" hint="逗号或换行分隔。">
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
              }}
              placeholder="backend, api"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="画像种子（可选）" hint="生成初始画像摘要的种子文本。">
            <Textarea
              rows={3}
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value);
              }}
              placeholder="擅长服务端接口设计与数据库改造…"
            />
          </Field>
          <Field label="约束条目（可选 · 每行一条）">
            <Textarea
              rows={3}
              value={constraints}
              onChange={(e) => {
                setConstraints(e.target.value);
              }}
              placeholder={'不改动数据库迁移脚本\n只在 packages/api 下工作'}
            />
          </Field>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-panel border border-danger/30 bg-danger/10 px-3 py-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-danger-soft" />
            <p className="min-w-0 text-body text-fg-secondary">{error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit || creating} onClick={() => void submit()}>
            {creating ? '正在创建…' : '创建'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
