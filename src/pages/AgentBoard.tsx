import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, Globe, Loader2, Sparkles, X } from 'lucide-react';
import { memoryApi } from '@/api/memory';
import { onBackendStatus } from '@/api/events';
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
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { useDemoStore } from '@/store/useDemoStore';
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
 * 能力门控读 v2/v4 的 `capabilities.operations`（键名与 RPC 方法名并非一一对应：
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

/**
 * 名册里状态徽章的色阶。
 * 与 `STATUS_LABEL` 解耦：翻译管"叫什么"，这里管"长什么样"。
 * 已创建/活跃 → 绿(可派活)，收尾中 → 橙(还在处理)，空闲/已退休 → 中性(无可用任务)。
 */
const ROSTER_STATUS_TONE: Record<string, BadgeProps['variant']> = {
  created: 'ok',
  active: 'ok',
  draining: 'human',
  idle: 'default',
  retired: 'default',
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
    let revision = 0;
    const off = onBackendStatus((status) => {
      const current = ++revision;
      detailToken.current += 1;
      setError(undefined);
      if (status.state !== 'ready') {
        setLoading(status.state === 'starting');
        if (status.state !== 'starting') {
          setAgents([]);
          setError(status.message || 'BCD 后端未运行');
        }
        return;
      }
      setLoading(true);
      void Promise.all([memoryApi.getCapabilities(), memoryApi.listAgents()])
        .then(([caps, listed]) => {
          if (current !== revision) return;
          setCapabilities(caps.capabilities);
          setAgents(listed.agents);
          const selected = selectedRef.current;
          if (selected && listed.agents.some((agent) => agent.role_id === selected)) {
            void loadDetail(selected);
          } else {
            setSelectedRoleId(undefined);
            setDetail(undefined);
            setDetailLoading(false);
          }
        })
        .catch((reason: unknown) => {
          if (current === revision) setError(errorMessage(reason));
        })
        .finally(() => {
          if (current === revision) setLoading(false);
        });
    });
    return () => {
      revision += 1;
      detailToken.current += 1;
      off();
    };
  }, [loadDetail]);

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

  /**
   * 「Agent 名册」是所有任务的横切视图：从任意一个任务跳进来之后，要有一个出口回到自己正
   * 在跑的那个任务。`selectTask` 内部已经把 `currentPage` 切回 `tasks`，并把活动项目的实时
   * 态带回来 —— 这是「页面级的关联视图」而不是「切换上下文」，所以复用现有导航动作。
   *
   * 没有活动任务时（用户从启动页直接进了控制台）：退回空的 `tasks` 页，靠 TaskBoard 的
   * 空状态引导，比送回启动页更连贯 —— 用户既然在控制台看过名册，就是带着项目进来的。
   */
  const backToTask = useCallback(() => {
    const state = useDemoStore.getState();
    if (state.activeTaskId) {
      state.selectTask(state.activeTaskId);
    } else {
      state.setPage('tasks');
    }
  }, []);

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
                    {/*
                      状态徽章:旧版全 13px、created 走 default(灰) —— 在新装上
                      几乎所有 Agent 都是「已创建」,满屏灰徽章跟「正常状态」混淆。
                      (a) 字号降到 11px(text-meta) —— 让 Agent 名称做主角,徽章退到
                          名字右边的次要指示位置,横向扫读时不再被徽章抢眼。
                      (b) 颜色按状态语义:已创建 / 活跃 = 绿(ok),收尾中 = 橙(human),
                          空闲 / 退休 / 未知 = 中性(default)。这条不光是「已创建变绿」,
                          是把名册里的状态条变成一个一眼可读的小信号灯:
                          「这个角色还在跑 / 还能派活 / 已经收尾 / 不在了」。
                    */}
                    <Badge
                      variant={ROSTER_STATUS_TONE[agent.status] ?? 'default'}
                      className="text-meta"
                    >
                      {STATUS_LABEL[agent.status] ?? agent.status}
                    </Badge>
                  </div>
                {/* role_id 走 brand purple：在名册里它是这个 Agent 唯一稳定的 ID —— 名称会被改名 / 标签会增减，
                    但 role_id 永远不变。把它染成紫色既能在多 Agent 横向扫读时一眼锁定"这行的归属"，
                    也跟 Agent Board 顶栏「选中」那枚紫色描边的语义保持一致。选 soft 而不是 DEFAULT：
                    12px 等宽、n 块并排，DEFAULT 太抢会压过名称那一行。 */}
                <div className="truncate font-mono text-code text-command-soft">
                  {agent.role_id}
                </div>
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
          {/*
            页头。原本在标题下挂了一行「来自 B Memory 的长期角色、技能与经验」——
            「B Memory」是研发代号,用户从来没见过。删掉之后标题区只剩个孤零零的 15px 标题,
            视觉上塌下去一半。
            用「当前视角」chip 补回:选中具体 Agent 时显示它的 role_id 截断;
            未选中时显示「全局视图 · 跨 Agent」。这两个状态都是**当下真相**,
            比一句产品话术更值得占这个位置。
          */}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-title text-fg-primary">Agent Memory</h1>
            {selectedRoleId ? (
              (() => {
                const selected = agents.find((a) => a.role_id === selectedRoleId);
                return (
                  <>
                    <IdChip value={selectedRoleId} label="查看" />
                    {selected && (
                      <Badge variant={selected.status === 'active' ? 'ok' : 'default'}>
                        {STATUS_LABEL[selected.status] ?? selected.status}
                      </Badge>
                    )}
                  </>
                );
              })()
            ) : (
              <span className="rounded-chip border border-edge bg-surface-panel px-1.5 text-meta text-fg-muted">
                全局视图 · 跨 Agent
              </span>
            )}
          </div>
          {/*
            返回任务界面的唯一全局出口。

            为什么要这一颗 ×：导航栏的「Agent 控制台」按钮把 `currentPage` 切成 `agents`
            之后，没有任何正面的方式回到正在跑的那个任务 —— 用户得去侧栏里翻项目、点任务、
            或者干脆先点开「返回启动页」再绕回来。这条路径在「控制台只是一个横切视图」
            的语义下是错的：用户**没想离开任务**，只是想看一眼名册里有没有合适的角色。

            · 放在主区页头（而不是名册侧栏）的原因：× 的作用对象是**整页**「返回任务」，不是
              「收起名册」。任务页的 × 历来都钉在主区右上角（设置抽屉、错误条都是这套），这里
              与它们共处一排，肌肉记忆能复用。
            · 命中范围：选中某角色 → 只收起名册/切到任务页是不够的，得连同「当前正在干活的
              任务上下文」一起带回去，所以走 `selectTask(activeTaskId)` 而不是裸 `setPage`。
              没有活动任务时退化为 setPage('tasks')，让 TaskBoard 的空状态接管。
          */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {/*
              原先挂在这里的 `SkillReviewBadge`(技能需人工审核 / 技能自动通过) 与
              `EmbeddingBadge`(哈希向量已降级 / 语义向量) 两枚能力徽章已经删除。
              那是 v2/v4 后端能力声明的反射结果 —— 对名册浏览 / 画像查看 / 技能晋升
              这些**面向用户**的动作没有可操作含义。能力门控在该处真正被执行
              的位置(技能晋升、记忆运维等)由各自面板的就近错误提示承担。
            */}
            <button
              type="button"
              onClick={backToTask}
              aria-label="返回任务界面"
              title="返回任务界面"
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-chip border border-edge bg-surface-panel text-fg-muted transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-fg-primary"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
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
      {/*
        Agent 概况 —— 旧版是一条 7 行的 KeyValueList（创建时间 / 任务量 / 竞标 / 成功率 /
        库存 / 最近任务 / 开销），所有事实同字号同字色挤在一起，扫一眼只能看到一堵「key：value」
        的字墙，**哪些是它作为 Agent 的核心数字、哪些只是参考时间戳**完全分不出来。
        这就是「扁平且冗杂」。

        重排为三档：
        ① **3 张 metric 卡** —— 总任务 / 成功率 / 活跃度（activity_score）。
           它们是这页里「值得被一眼记住」的三个数，所以字号提一档、占独立的视觉块。
        ② **4 条 inline 数据点** —— 竞标 / 库存 / 开销 / 中标率。
           重要但**不值得独占一格**的事实，挤成一行 monospace 形式。
        ③ **时间锚** —— 创建时间 + 最近任务。
           参考信息，不应该再占据主视觉。挪到最底，用 fg-faint，与主数据块分开。
        标签（tags）从「Panel 抬头下面」上移到「PanelHeader 内、最右」—— 它是身份的一部分，
        不是数据的一部分。头像 / 标题之后跟着 ID / 状态 / 标签，是名册卡里已经验证过的结构。
        任务量里那个 `tasks_completed / tasks_succeeded / tasks_failed` 子分布单独提到主指标下方一行
        —— 它是「总任务」这个数字的拆解，不是另一个独立事实。
      */}
      <Panel>
        <PanelHeader>
          Agent 概况
          <span className="font-mono text-code text-fg-faint">memory.getAgent</span>
          <span className="flex-1" />
          {(agent.tags ?? []).length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {(agent.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="rounded-chip border border-edge px-1.5 font-mono text-code text-fg-muted"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-faint" />}
        </PanelHeader>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MetricCard
            label="总任务"
            value={numText(raw.total_tasks)}
            hint={
              raw.total_tasks > 0
                ? `完成 ${numText(raw.tasks_completed)} · 失败 ${numText(raw.tasks_failed)}`
                : '尚未接过任务'
            }
          />
          <MetricCard
            label="成功率"
            value={percent(derived.success_rate)}
            hint={`中标率 ${percent(derived.bid_win_rate)}`}
            tone={derived.success_rate >= 0.7 ? 'ok' : derived.success_rate >= 0.4 ? 'idle' : 'danger'}
          />
          <MetricCard
            label="活跃度"
            value={percent(derived.activity_score)}
            hint={
              raw.last_task_at
                ? `上次任务 ${raw.last_task_at}`
                : '最近 14 天衰减为半'
            }
          />
        </div>

        {/*
          第二档：横向数据点。设计成 `<dl>` 是因为每个点本质是"k → v"的定义关系。
          HTML5 允许 `<div>` 把 `<dt> + <dd>` 组成 dl 的子组 —— DataPoint 返回 `<div>` 包一对 dt/dd，
          外层 `dl` 的 `flex flex-wrap` 把每组当成一个 flex item：窄窗下整组换行，不会把 dt / dd
          拆到两行。
          组内用 inline 排版让 k / v 同行基线对齐；4 个组之间靠外层 `gap-x-4 gap-y-1` 留节奏。
        */}
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <DataPoint k="竞标" v={`${numText(raw.tasks_bid)} 参 / ${numText(raw.tasks_won)} 中`} />
          <DataPoint
            k="库存"
            v={`${numText(agent.skill_count)} 技能 / ${numText(agent.experience_count)} 经验`}
          />
          <DataPoint k="均置信" v={fixed2(raw.avg_confidence)} />
          <DataPoint
            k="开销"
            v={
              typeof raw.token_cost_total === 'number'
                ? `${numText(raw.token_cost_total)} token`
                : '—'
            }
          />
        </dl>

        <p className="mt-3 flex flex-wrap items-center gap-x-3 border-t border-edge pt-2 text-meta text-fg-faint">
          <span>创建于 {agent.created_at || '后端未给出'}</span>
          <span aria-hidden>·</span>
          <span>最近任务 {raw.last_task_at ?? '后端未给出'}</span>
          {typeof raw.persona_drift === 'number' && (
            <>
              <span aria-hidden>·</span>
              <span>画像漂移 {percent(raw.persona_drift)}</span>
            </>
          )}
        </p>
      </Panel>

      {/*
        画像面板。旧版 5 个 PERSONA_FIELDS 全部用「label (13px muted) / value (13px secondary)、
        mt-3 上下间距」竖排 —— 整列 5 行同字号同色阶,扫读只能看见一堵字墙,看不出
        「summary 是这角色的 tagline」和「剩下 4 条是同一画像的 4 个分面」之间
        差着几个数量级的重要性。

        拆成两档:
        ① **summary 单独成段** —— 用 `text-fg-primary`(画像里唯一一处 primary)直接上。
           它的视觉重量是该 Agent 自我介绍的语调,不是又一条参考数据。
        ② **其余 4 个分面 2×2 网格** —— 每格是紧凑块,label 走 meta(11px) 顶上,
           value 走 body 紧贴。这样 (a) 信息密度跟一组 KG 指标相当,不占无谓的纵向;
           (b) 左列「技能 / 经验」、右列「近期 / 备注」在语义上是一对 —— 拥有什么 vs 经历过什么,
           网格把它们天然按列对齐。
        PanelHeader 里塞 `persona v{n}` + 「生成于」小注解,生成时间从原来孤悬的
        一行 muted paragraph 升级到抬头行内 chip —— 跟「Agent 概况」的 `memory.getAgent` 注解
        是同一档位。
        底部 footer 用 fg-faint 提示「改写在「生命周期」」并把那个 tab 的 key 写出来,
        把原版的「见 生命周期 标签页」从纯文字升级成带 tab key 锚点的 hint。
      */}
      <Panel>
        <PanelHeader>
          画像
          <span className="font-mono text-code text-fg-faint">
            persona v{agent.persona.version}
          </span>
          {agent.persona.generated_at && (
            <span className="font-mono text-meta text-fg-faint">
              · 生成于 {agent.persona.generated_at}
            </span>
          )}
        </PanelHeader>

        {(() => {
          const summary = agent.persona.summary;
          const facets = PERSONA_FIELDS.filter((f) => f.key !== 'summary');
          return (
            <>
              {summary ? (
                <p className="mt-3 whitespace-pre-wrap text-body text-fg-primary">
                  {summary}
                </p>
              ) : (
                <p className="mt-3 text-body text-fg-faint">后端没有给出摘要</p>
              )}

              {facets.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {facets.map((field) => {
                    const value = agent.persona[field.key];
                    return (
                      <div
                        key={field.key}
                        className="min-w-0 rounded-panel border border-edge bg-surface-void px-3 py-2"
                      >
                        <div className="text-meta text-fg-muted">{field.label}</div>
                        {value ? (
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-body text-fg-secondary">
                            {value}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-meta text-fg-faint">后端未给出</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="mt-3 flex flex-wrap items-center gap-x-1.5 border-t border-edge pt-2 text-meta text-fg-faint">
                改写与重生成在「生命周期」标签页
                <span className="rounded-chip border border-edge bg-surface-panel px-1.5 font-mono text-code text-fg-muted">
                  lifecycle
                </span>
                里。
              </p>
            </>
          );
        })()}
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

// ── Agent 概况里的小构件 ──

/**
 * 一格数据卡：标题 + 大数字 + 一行 hint。
 *
 * 数字字号 `text-title`（15px）。在 396px 宽的工作台里塞 3 列，每格实际 ~125px，
 * 24px 的 headline 会让数字和 hint 行都撑出滚动条 ——**字号越显，横向越紧**。
 * 15px 是这页能承担的最大字阶。
 *
 * 边框走 `border-edge`（R5 同一容器只有一种方式与背景区分；用色块填底会让"卡片感"压过"面板感"，
 * 跟外层 Panel 抢关系）。
 */
function MetricCard({
  label,
  value,
  hint,
  tone = 'idle',
}: {
  label: string;
  value: string;
  hint?: string;
  /** 数字本身的色：ok = 强表现，danger = 差，idle / human 走 fg-primary 不额外加色。
   *  默认 idle：避免 3 个数里有两个被染色，只让真正"偏一边"的数字出彩。 */
  tone?: 'ok' | 'danger' | 'idle' | 'human';
}) {
  return (
    <div className="rounded-panel border border-edge bg-surface-void px-3 py-2">
      <div className="text-meta text-fg-muted">{label}</div>
      <div
        className={cn(
          'mt-0.5 tabular text-title',
          tone === 'ok' && 'text-ok',
          tone === 'danger' && 'text-danger-soft',
          tone === 'human' && 'text-human-soft',
          tone === 'idle' && 'text-fg-primary',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-meta text-fg-faint">{hint}</div>}
    </div>
  );
}

/**
 * 横向数据点：k / v 同行，v 用 mono 数字 + 紧凑间距 —— 它是参考型数据，不该跟正文一个字号。
 *
 * 容器走 `<div>` 而非 Fragment：HTML5 允许 `<div>` 把一对 `<dt> + <dd>` 作为一个
 * dl 子组，外层 `dl` 的 `flex flex-wrap` 会把整组当成一个 flex item —— 在窄窗下
 * 整组换行，而不是 dt / dd 各自被 flex 当成兄弟项、互相断到两行。
 * 组内再用 inline 排版让 k / v 同行基线对齐。
 */
function DataPoint({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="inline text-meta text-fg-muted">{k}</dt>
      <dd className="ml-1.5 inline tabular text-code text-fg-secondary">{v}</dd>
    </div>
  );
}
