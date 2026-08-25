import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, Globe, Loader2, Sparkles, X } from 'lucide-react';
import { memoryApi } from '@/api/memory';
import type {
  MemoryCapabilities,
  MemoryMaintenanceEvidence,
  RpcAgentBoardAgentView,
  RpcAgentBoardListItem,
  RpcExperienceView,
  RpcPersonaView,
  RpcSkillView,
} from '@/api/types/memory';
import { AgentAdminPanel } from '@/components/memory/AgentAdminPanel';
import { MemoryOpsPanel } from '@/components/memory/MemoryOpsPanel';
import { OrgConsolePanel } from '@/components/memory/OrgConsolePanel';
import { SkillMarketPanel } from '@/components/memory/SkillMarketPanel';
import { SidePanel } from '@/components/SidePanel';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fold } from '@/components/ui/Fold';
import { IdChip } from '@/components/ui/IdChip';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { cn } from '@/lib/utils';

/**
 * Agent Memory —— 左侧名册 + 右侧分标签的记忆工作台。
 *
 * 为什么改成标签页：B 记忆的可写面已经铺开到 34 个 `memory.*` 方法，三块面板
 * （技能与市场 / 记忆运维 / 生命周期）任何一块单独展开都比原来整页还长。标签页每次只挂当前
 * 那一块，切页即重挂 —— 三块面板各自拉自己的数据、各自带取消标志，本页不替它们缓存，
 * 也不给它们喂数据。
 *
 * 本页自己只对四条后端事实负责：名册（memory.listAgents）、概况与画像（memory.getAgent）、
 * 技能与经验的只读清单（memory.listSkills / listExperiences）、维护证据与技能晋升
 * （memory.listMaintenance / promoteSkills）。其余读写入口全在面板里，本页不重复实现。
 *
 * ## 两级作用域
 *
 * 名册顶上钉着一行「全局」。选中它 = 组织级视图（`OrgConsolePanel`），装的是那些**不吃
 * role_id** 的调用：总览、跨 Agent 待审队列、全量退休扫描、重建索引、新建 Agent。选中某个
 * 具体 Agent 才出四个标签页。
 *
 * 这条轴是后补的：这些调用原先散在三块单 Agent 面板里，于是「看全局总览」「建新 Agent」都得
 * 先随便选中一个 Agent 才点得到 —— 旧的空状态提示里那句「新建 Agent 的入口在生命周期标签页，
 * 而那一页要先选中一个 Agent 才打得开」就是这个毛病的自白。
 *
 * 能力门控读 v2 的 `capabilities.operations`（33 个键，键名与 RPC 方法名并非一一对应：
 * 晋升是 `promote_skills`，详情是 `get_agent_persona`，上架是 `publish_skill`）。清单没回来
 * 之前不预设可用；后端说 unavailable 就把它给的 reason 原样摆出来，不画一个按下去必然报错的按钮。
 */

interface AgentDetail {
  agent: RpcAgentBoardAgentView;
  skills: RpcSkillView[];
  experiences: RpcExperienceView[];
  maintenance: MemoryMaintenanceEvidence[];
}

type MemoryTab = 'overview' | 'skills' | 'ops' | 'lifecycle';

const TABS: { key: MemoryTab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'skills', label: '技能与市场' },
  { key: 'ops', label: '记忆运维' },
  { key: 'lifecycle', label: '生命周期' },
];

/** 线上 `status` 声明为宽 string，这里只翻译认得的几个，认不出来的原样透出。 */
const STATUS_LABEL: Record<string, string> = {
  created: '已创建',
  active: '活跃',
  idle: '空闲',
  draining: '收尾中',
  retired: '已退休',
};

const REVIEW_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const REVIEW_TONE: Record<string, BadgeProps['variant']> = {
  pending: 'human',
  approved: 'ok',
  rejected: 'danger',
};

const MAINTENANCE_KIND_LABEL: Record<MemoryMaintenanceEvidence['kind'], string> = {
  experience_extraction: '经验提取',
  skill_promotion: '技能晋升',
};

const MAINTENANCE_STATUS_LABEL: Record<MemoryMaintenanceEvidence['status'], string> = {
  scheduled: '已排队',
  running: '执行中',
  completed: '已完成',
  skipped: '已跳过',
  failed: '失败',
};

const MAINTENANCE_STATUS_TONE: Record<MemoryMaintenanceEvidence['status'], BadgeProps['variant']> =
  {
    scheduled: 'default',
    running: 'command',
    completed: 'ok',
    skipped: 'default',
    failed: 'danger',
  };

/** `verified` = 启动时真调过一次 embedding；`host_managed` = 由宿主保证，未自检。 */
const READINESS_LABEL: Record<string, string> = {
  verified: '已自检',
  host_managed: '宿主托管',
};

type PersonaTextField = Extract<
  keyof RpcPersonaView,
  'summary' | 'skills_overview' | 'experience_coverage' | 'recent_performance' | 'notes'
>;

const PERSONA_FIELDS: { key: PersonaTextField; label: string }[] = [
  { key: 'summary', label: '摘要' },
  { key: 'skills_overview', label: '技能概览' },
  { key: 'experience_coverage', label: '经验覆盖' },
  { key: 'recent_performance', label: '近期表现' },
  { key: 'notes', label: '备注' },
];

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * RPC 边界是不可信 JSON —— 后端 schema 把这些计数声明成必填，前端类型也跟着写成 `number`，
 * 但老数据与降级投影照样可能不带这个键。直接插进模板串会在界面上印出「undefined」，
 * 对 `.toFixed()` 直取更会当场抛异常白屏。缺就说缺。
 */
const numText = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';

const fixed2 = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';

const percent = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

export function AgentBoard() {
  const [capabilities, setCapabilities] = useState<MemoryCapabilities>();
  const [agents, setAgents] = useState<RpcAgentBoardListItem[]>([]);
  /** undefined = 全局档（组织级视图）；有值 = 选中了某个 Agent。 */
  const [selectedRoleId, setSelectedRoleId] = useState<string>();
  const [detail, setDetail] = useState<AgentDetail>();
  const [tab, setTab] = useState<MemoryTab>('overview');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string>();

  // 选中项要在稳定的回调（面板的 onChanged）里读到最新值，又不能让回调每次换引用。
  const selectedRef = useRef<string | undefined>(undefined);
  selectedRef.current = selectedRoleId;
  // 详情拉取的世代号：切 Agent / 重拉都 +1，落后的响应直接丢弃。
  const detailToken = useRef(0);

  const handleError = useCallback((message: string) => {
    setError(message);
  }, []);

  const loadDetail = useCallback((roleId: string) => {
    const token = (detailToken.current += 1);
    setDetailLoading(true);
    return Promise.all([
      memoryApi.getAgent(roleId),
      memoryApi.listSkills(roleId),
      memoryApi.listExperiences(roleId),
      memoryApi.listMaintenance(roleId),
    ])
      .then(([agent, skills, experiences, maintenance]) => {
        if (token !== detailToken.current) return;
        setDetail({
          agent: agent.agent,
          skills: skills.skills,
          experiences: experiences.experiences,
          maintenance: maintenance.maintenance,
        });
      })
      .catch((reason: unknown) => {
        if (token === detailToken.current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (token === detailToken.current) setDetailLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([memoryApi.getCapabilities(), memoryApi.listAgents()])
      .then(([caps, listed]) => {
        if (!active) return;
        setCapabilities(caps.capabilities);
        setAgents(listed.agents);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRoleId) {
      detailToken.current += 1;
      setDetail(undefined);
      setDetailLoading(false);
      return;
    }
    void loadDetail(selectedRoleId);
  }, [selectedRoleId, loadDetail]);

  /**
   * 三块面板写成功后的统一回调：重拉名册 + 重拉当前 Agent 的详情。
   * 名册里已经没有当前 Agent 时（它刚被删除）不再去拉一次注定 404 的详情，直接清空选中项 ——
   * 名册里消失本身就是删除成功的回执。
   */
  const handleChanged = useCallback(() => {
    void memoryApi
      .listAgents()
      .then((listed) => {
        setAgents(listed.agents);
        const current = selectedRef.current;
        if (!current) return;
        if (!listed.agents.some((agent) => agent.role_id === current)) {
          setSelectedRoleId(undefined);
          return;
        }
        void loadDetail(current);
      })
      .catch((reason: unknown) => {
        setError(errorMessage(reason));
      });
  }, [loadDetail]);

  const promote = async () => {
    const roleId = selectedRoleId;
    if (!roleId || promoting) return;
    setPromoting(true);
    setError(undefined);
    try {
      const result = await memoryApi.promoteSkills(roleId, 'polaris-ui');
      setDetail((current) =>
        current
          ? { ...current, maintenance: [result.maintenance, ...current.maintenance] }
          : current,
      );
      // 晋升会新建 pending 技能，技能数与名册卡片上的计数都变了。
      handleChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-body text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在读取 B Memory…
      </div>
    );
  }

  if (error && agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={AlertTriangle} title="B Memory 不可用" hint={error} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <SidePanel
        side="left"
        title="Agent 名册"
        defaultWidth={300}
        minWidth={240}
        maxWidth={420}
        storageKey="agent-memory-roster"
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-body text-fg-secondary">Agent 名册</span>
            <span className="tabular text-meta text-fg-muted">{agents.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {/*
              全局档钉在最上面。它不是「没选中」的占位 —— 组织级的那几个调用本来就不吃
              role_id，硬塞进某个 Agent 的标签页才是错的。
            */}
            <button
              type="button"
              onClick={() => {
                setSelectedRoleId(undefined);
              }}
              className={cn(
                'w-full rounded-panel border bg-surface-panel p-3 text-left transition-colors hover:border-edge-strong',
                selectedRoleId === undefined ? 'border-command/60' : 'border-edge',
              )}
            >
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-fg-primary">全局</span>
              </div>
              <p className="mt-1 text-body text-fg-secondary">
                总览 · 待审队列 · 全量扫描 · 重建索引 · 新建 Agent
              </p>
            </button>

            {agents.map((agent) => (
              <button
                key={agent.role_id}
                type="button"
                onClick={() => {
                  setSelectedRoleId(agent.role_id);
                }}
                className={cn(
                  'w-full rounded-panel border bg-surface-panel p-3 text-left transition-colors hover:border-edge-strong',
                  selectedRoleId === agent.role_id ? 'border-command/60' : 'border-edge',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body text-fg-primary">
                    {agent.name}
                  </span>
                  <Badge variant={agent.status === 'active' ? 'ok' : 'default'}>
                    {STATUS_LABEL[agent.status] ?? agent.status}
                  </Badge>
                </div>
                <div className="truncate font-mono text-code text-fg-muted">{agent.role_id}</div>
                <p className="mt-1 line-clamp-2 text-body text-fg-secondary">
                  {agent.persona_summary || '暂无画像摘要'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(agent.tags ?? []).slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-chip border border-edge px-1.5 font-mono text-code text-fg-muted"
                    >
                      {tag}
                    </span>
                  ))}
                  <span className="ml-auto text-body text-fg-muted">
                    技能 <span className="tabular">{agent.skill_count}</span> · 经验{' '}
                    <span className="tabular">{agent.experience_count}</span>
                  </span>
                </div>
              </button>
            ))}
            {agents.length === 0 && (
              <p className="px-1 py-3 text-body text-fg-muted">后端返回的名册是空的。</p>
            )}
          </div>
        </div>
      </SidePanel>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-end justify-between gap-4 border-b border-edge px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-title text-fg-primary">Agent Memory</h1>
            <p className="mt-0.5 text-body text-fg-muted">
              来自 PostgreSQL 的长期角色、技能与经验。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <SkillReviewBadge capabilities={capabilities} />
            <EmbeddingBadge capabilities={capabilities} />
          </div>
        </header>

        {error && (
          <div className="shrink-0 px-6 pt-4">
            <Panel className="flex items-start gap-2 border-human/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-human-soft" />
              <span className="min-w-0 flex-1 text-body text-fg-secondary">{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                }}
                aria-label="收起这条错误"
                title="收起"
                className="rounded-chip p-1 text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg-primary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Panel>
          </div>
        )}

        {selectedRoleId ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-1">
              <div role="tablist" aria-label="Memory 视图" className="flex items-center gap-1">
                {TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={item.key === tab}
                    onClick={() => {
                      setTab(item.key);
                    }}
                    className={cn(
                      'rounded-chip px-2 py-1 text-body transition-colors',
                      item.key === tab
                        ? 'bg-surface-raised text-fg-primary'
                        : 'text-fg-muted hover:text-fg-secondary',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="min-w-0 flex-1 truncate text-body text-fg-secondary">
                {detail?.agent.name ?? '正在读取…'}
              </span>
              {detail && (
                <>
                  <Badge variant={detail.agent.status === 'active' ? 'ok' : 'default'}>
                    {STATUS_LABEL[detail.agent.status] ?? detail.agent.status}
                  </Badge>
                  <span className="font-mono text-code text-fg-faint">{detail.agent.status}</span>
                </>
              )}
              <IdChip value={selectedRoleId} label="角色" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {tab === 'overview' && (
                <OverviewTab
                  detail={detail}
                  loading={detailLoading}
                  capabilities={capabilities}
                  promoting={promoting}
                  onPromote={() => void promote()}
                />
              )}
              {tab === 'skills' && (
                <SkillMarketPanel
                  roleId={selectedRoleId}
                  capabilities={capabilities}
                  onError={handleError}
                  onChanged={handleChanged}
                />
              )}
              {tab === 'ops' && (
                <MemoryOpsPanel
                  roleId={selectedRoleId}
                  capabilities={capabilities}
                  onError={handleError}
                  onChanged={handleChanged}
                />
              )}
              {tab === 'lifecycle' && (
                <AgentAdminPanel
                  roleId={selectedRoleId}
                  capabilities={capabilities}
                  onError={handleError}
                  onChanged={handleChanged}
                />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-1">
              <Globe className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
              <span className="text-body text-fg-primary">全局</span>
              <span className="min-w-0 flex-1 truncate text-body text-fg-muted">
                不属于任何单个 Agent 的操作
              </span>
              <span className="tabular text-meta text-fg-muted">Agent {agents.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {agents.length === 0 && (
                <div className="mb-4">
                  <EmptyState
                    icon={Brain}
                    title="后端还没有任何 Agent"
                    hint="用下面的「新建 Agent」建第一个，或者等系统在派发任务时自动衍生。"
                  />
                </div>
              )}
              <OrgConsolePanel
                capabilities={capabilities}
                onError={handleError}
                onChanged={handleChanged}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 概览页：本页自己负责的那部分事实 ──

function OverviewTab({
  detail,
  loading,
  capabilities,
  promoting,
  onPromote,
}: {
  detail: AgentDetail | undefined;
  loading: boolean;
  capabilities: MemoryCapabilities | undefined;
  promoting: boolean;
  onPromote: () => void;
}) {
  if (!detail) {
    return (
      <p className="flex items-center gap-2 text-body text-fg-muted">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? '正在加载详情…' : '详情没有取到，原因见上方的错误说明。'}
      </p>
    );
  }

  const { agent, skills, experiences, maintenance } = detail;
  const raw = agent.metrics.raw;
  const derived = agent.metrics.derived;
  const reviewMode = capabilities?.skill_review.mode;
  const pendingSkills = skills.filter((skill) => skill.review_status === 'pending').length;
  const negativeExperiences = experiences.filter(
    (experience) => experience.type === 'negative',
  ).length;
  const openMaintenance = maintenance.filter(
    (item) => item.status === 'scheduled' || item.status === 'running',
  ).length;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          Agent 概况
          <span className="font-mono text-code text-fg-faint">memory.getAgent</span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-faint" />}
        </PanelHeader>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(agent.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="rounded-chip border border-edge px-1.5 font-mono text-code text-fg-muted"
            >
              {tag}
            </span>
          ))}
          {(agent.tags ?? []).length === 0 && (
            <span className="text-body text-fg-faint">没有标签</span>
          )}
        </div>
        <div className="mt-2">
          <KeyValueList>
            <KeyValue k="创建时间" v={agent.created_at || '后端未给出'} />
            <KeyValue
              k="任务量"
              v={`总 ${numText(raw.total_tasks)} · 完成 ${numText(raw.tasks_completed)} · 成功 ${numText(raw.tasks_succeeded)} · 失败 ${numText(raw.tasks_failed)}`}
            />
            <KeyValue
              k="竞标"
              v={`参与 ${numText(raw.tasks_bid)} · 中标 ${numText(raw.tasks_won)}`}
            />
            <KeyValue
              k="成功率"
              v={`${percent(derived.success_rate)} · 中标率 ${percent(derived.bid_win_rate)}`}
            />
            <KeyValue
              k="库存"
              v={`技能 ${numText(agent.skill_count)} · 经验 ${numText(agent.experience_count)} · 平均置信 ${fixed2(raw.avg_confidence)}`}
            />
            <KeyValue k="最近任务" v={raw.last_task_at ?? '后端未给出'} />
            <KeyValue k="开销" v={`累计 ${numText(raw.token_cost_total)} token`} />
          </KeyValueList>
        </div>
      </Panel>

      <Panel>
        <PanelHeader>
          画像
          <span className="font-mono text-code text-fg-faint">
            persona v{agent.persona.version}
          </span>
        </PanelHeader>
        <p className="mt-1 text-body text-fg-muted">
          生成于 {agent.persona.generated_at || '后端未给出'}；改写与重生成在「生命周期」里。
        </p>
        <div className="mt-3 space-y-3">
          {PERSONA_FIELDS.map((field) => {
            const value = agent.persona[field.key];
            return (
              <div key={field.key}>
                <div className="text-body text-fg-muted">{field.label}</div>
                {value ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-body text-fg-secondary">{value}</p>
                ) : (
                  <p className="mt-0.5 text-body text-fg-faint">后端未给出</p>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <PromoteCard capabilities={capabilities} promoting={promoting} onPromote={onPromote} />

      {/* 三块只读清单收进 Fold：默认折叠，展开才向下推 —— 概览页不因为库存多就变成一条长滚动。
          容器只画三边，最后一条 Fold 自己的 border-b 就是盒子的底边。 */}
      <div className="overflow-hidden rounded-panel border-x border-t border-edge">
        <Fold
          id="agent-skills"
          title="技能"
          meta={String(skills.length)}
          status={pendingSkills > 0 ? 'human' : 'idle'}
          fact={
            skills.length === 0
              ? '后端没有返回技能'
              : pendingSkills > 0
                ? `${pendingSkills} 条待审核`
                : '全部已审核'
          }
        >
          {skills.length === 0 ? (
            <p className="text-body text-fg-muted">后端没有返回技能。</p>
          ) : (
            <div className="space-y-2">
              {skills.map((skill) => (
                <Panel key={skill.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body text-fg-primary">
                      {skill.description}
                    </span>
                    <Badge variant={REVIEW_TONE[skill.review_status] ?? 'default'}>
                      {REVIEW_LABEL[skill.review_status] ?? skill.review_status}
                    </Badge>
                    <span className="font-mono text-code text-fg-faint">{skill.review_status}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-body text-fg-muted">{skill.content}</p>
                </Panel>
              ))}
            </div>
          )}
        </Fold>

        <Fold
          id="agent-experiences"
          title="经验"
          meta={String(experiences.length)}
          fact={
            experiences.length === 0
              ? '后端没有返回经验'
              : `负经验 ${negativeExperiences} 条 / 共 ${experiences.length} 条`
          }
        >
          {experiences.length === 0 ? (
            <p className="text-body text-fg-muted">后端没有返回经验。</p>
          ) : (
            <div className="space-y-2">
              {experiences.map((experience) => (
                <Panel key={experience.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body text-fg-primary">
                      {experience.description}
                    </span>
                    <Badge variant={experience.type === 'negative' ? 'danger' : 'ok'}>
                      {experience.type === 'negative' ? '负经验' : '正经验'}
                    </Badge>
                    <span className="font-mono text-code text-fg-faint">{experience.type}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-body text-fg-muted">{experience.content}</p>
                  <p className="mt-1 text-body text-fg-muted">
                    置信 <span className="tabular">{fixed2(experience.confidence)}</span> · 被引用{' '}
                    <span className="tabular">{experience.referenced_count}</span> 次
                  </p>
                </Panel>
              ))}
            </div>
          )}
        </Fold>

        <Fold
          id="agent-maintenance"
          title="维护证据"
          meta={String(maintenance.length)}
          status={openMaintenance > 0 ? 'running' : 'idle'}
          fact={
            maintenance.length === 0
              ? '后端没有返回维护证据'
              : openMaintenance > 0
                ? `${openMaintenance} 条还在进行`
                : '全部已结束'
          }
        >
          {maintenance.length === 0 ? (
            <p className="text-body text-fg-muted">后端没有返回维护证据。</p>
          ) : (
            <div className="space-y-2">
              {maintenance.map((item) => (
                <MaintenanceCard key={item.maintenance_ref} item={item} reviewMode={reviewMode} />
              ))}
            </div>
          )}
        </Fold>
      </div>
    </div>
  );
}

/**
 * 技能晋升。能力键是 `promote_skills` —— 后端即使声明 available 也总附一句 reason，
 * 说明晋升出来的技能会不会自动通过，所以这里把它原样带出来。
 */
function PromoteCard({
  capabilities,
  promoting,
  onPromote,
}: {
  capabilities: MemoryCapabilities | undefined;
  promoting: boolean;
  onPromote: () => void;
}) {
  const capability = capabilities?.operations.promote_skills;
  const autoApprove = capabilities?.skill_review.mode === 'auto_approve';

  return (
    <Panel>
      <PanelHeader>
        技能晋升
        <span className="font-mono text-code text-fg-faint">memory.promoteSkills</span>
      </PanelHeader>
      {!capability && <p className="mt-2 text-body text-fg-muted">正在读取后端能力清单…</p>}
      {capability?.status === 'unavailable' && (
        <p className="mt-2 text-body text-human-soft">
          后端未提供该操作：{capability.reason || '后端没有说明原因。'}
        </p>
      )}
      {capability?.status === 'available' && (
        <>
          <p className="mt-2 text-body text-fg-muted">
            把这个 Agent 的高置信经验汇总成技能。
            {autoApprove
              ? '后端配置为自动通过，晋升出来的技能立刻生效。'
              : '晋升出来的技能保持待审核，要在「技能与市场」里逐条处理。'}
          </p>
          {capability.reason && (
            <p className="mt-1 text-body text-fg-faint">后端说明：{capability.reason}</p>
          )}
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={onPromote}
            disabled={promoting}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {promoting ? '处理中…' : '从经验晋升技能'}
          </Button>
        </>
      )}
    </Panel>
  );
}

function MaintenanceCard({
  item,
  reviewMode,
}: {
  item: MemoryMaintenanceEvidence;
  reviewMode: MemoryCapabilities['skill_review']['mode'] | undefined;
}) {
  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body text-fg-primary">{MAINTENANCE_KIND_LABEL[item.kind]}</span>
        <span className="font-mono text-code text-fg-faint">{item.kind}</span>
        <Badge variant={MAINTENANCE_STATUS_TONE[item.status]}>
          {MAINTENANCE_STATUS_LABEL[item.status]}
        </Badge>
        <span className="ml-auto">
          <IdChip value={item.maintenance_ref} label="证据" />
        </span>
      </div>
      <p className="mt-1 text-body text-fg-muted">
        {item.completed_at || item.created_at || '后端未给出时间'}
      </p>
      {item.error && <p className="mt-1 text-body text-danger-soft">{item.error}</p>}
      {item.warnings.map((warning, index) => (
        <p
          key={`${item.maintenance_ref}-warning-${String(index)}`}
          className="mt-1 text-body text-human-soft"
        >
          {warning}
        </p>
      ))}
      {item.kind === 'skill_promotion' && reviewMode === 'manual' && (
        <p className="mt-1 text-body text-human-soft">
          生成的技能保持待审核，去「技能与市场」逐条通过。
        </p>
      )}
    </Panel>
  );
}

// ── 页头的两枚能力徽章 ──

/** `skill_review.mode` 是 v2 新增：它决定晋升出来的技能要不要人工过一遍。 */
function SkillReviewBadge({ capabilities }: { capabilities?: MemoryCapabilities }) {
  const mode = capabilities?.skill_review.mode;
  if (!mode) return null;
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={mode === 'manual' ? 'human' : 'ok'}>
        {mode === 'manual' ? '技能需人工审核' : '技能自动通过'}
      </Badge>
      <span className="font-mono text-code text-fg-faint">{mode}</span>
    </span>
  );
}

function EmbeddingBadge({ capabilities }: { capabilities?: MemoryCapabilities }) {
  const embedding = capabilities?.embedding;
  if (!embedding) return null;
  // 哈希向量是本地跑通链路用的降级实现，语义检索在这一档基本没有意义。
  const degraded = embedding.provider === 'HashEmbeddingProvider';
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={degraded ? 'human' : 'ok'}>
        {degraded
          ? '哈希向量 · 已降级'
          : `语义向量 · ${READINESS_LABEL[embedding.readiness] ?? embedding.readiness}`}
      </Badge>
      <span className="font-mono text-code text-fg-faint">
        {embedding.provider} · {embedding.readiness}
      </span>
    </span>
  );
}
