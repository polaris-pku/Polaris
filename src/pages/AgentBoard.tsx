import { useState } from 'react';
import { ArrowRight, Users2, CheckCircle2, Sparkles, FilePlus2 } from 'lucide-react';
import { agents, getAgentById } from '@/data/agents';
import { recommendAgents } from '@/data/agentRecommendation';
import { useDemoStore } from '@/store/useDemoStore';
import { AgentCard } from '@/components/AgentCard';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { SidePanel } from '@/components/SidePanel';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { roleName } from '@/lib/roleNames';

export function AgentBoard() {
  const selectedAgentId = useDemoStore((s) => s.selectedAgentId);
  const assignedAgentIds = useDemoStore((s) => s.assignedAgentIds);
  const selectAgent = useDemoStore((s) => s.selectAgent);
  const assignAgent = useDemoStore((s) => s.assignAgent);
  const teamCustomizationEnabled = useDemoStore((s) => s.teamCustomizationEnabled);
  const enableTeamCustomization = useDemoStore((s) => s.enableTeamCustomization);
  const resetTeamToRecommended = useDemoStore((s) => s.resetTeamToRecommended);
  const setPage = useDemoStore((s) => s.setPage);
  const taskText = useDemoStore((s) => s.taskText);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);

  const [reqOpen, setReqOpen] = useState(false);

  const rec = recommendAgents(taskText);
  const recommendedIds = rec.ids;
  const hasRequirement = !!activeTaskId && taskText.trim().length > 0;

  const selectedAgent = selectedAgentId ? (getAgentById(selectedAgentId) ?? null) : null;
  const teamReady = assignedAgentIds.length >= 3;

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：抬头 + 卡片网格 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-end justify-between border-b border-edge px-6 py-4">
          <div>
            <h1 className="text-title text-fg-primary">团队</h1>
            <p className="mt-0.5 text-body text-fg-muted">组建你的 AI 工程团队</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 「团队 00 / 04」的分母是写死的 —— 真实 run 是单 agent，「0/4」在撒谎。只报实数。 */}
            <span className="text-body text-fg-secondary">
              团队 · <span className="tabular">{assignedAgentIds.length}</span> 人
            </span>
            {teamReady && <Badge variant="ok">团队就绪</Badge>}
            {teamCustomizationEnabled ? (
              <Button variant="secondary" size="sm" onClick={resetTeamToRecommended}>
                恢复推荐团队
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={enableTeamCustomization}>
                自定义团队
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {/* 推荐来源横幅：有需求 → 展示按需求推荐的理由；无需求 → 引导先输入需求 */}
          {hasRequirement ? (
            <Panel className="mb-5 flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-command-soft" />
              <div className="min-w-0">
                <div className="text-body text-fg-primary">已根据需求推荐团队</div>
                <p className="mt-0.5 text-body text-fg-secondary">{rec.reason}</p>
                <p className="mt-1 text-body text-fg-muted">
                  可直接采用，或点右上角「自定义团队」自行增删 Agent。
                </p>
              </div>
            </Panel>
          ) : (
            <Panel className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <FilePlus2 className="mt-0.5 h-4 w-4 shrink-0 text-command-soft" />
                <div>
                  <div className="text-body text-fg-primary">还没有需求</div>
                  <p className="mt-0.5 text-body text-fg-muted">
                    新建需求后，系统会据此推荐团队；你也可以先自行挑选 Agent。
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setReqOpen(true);
                }}
              >
                <FilePlus2 className="h-4 w-4" /> 新建需求
              </Button>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                assigned={assignedAgentIds.includes(agent.id)}
                recommended={recommendedIds.includes(agent.id)}
                onSelect={() => {
                  selectAgent(agent.id);
                }}
                onAssign={() => {
                  assignAgent(agent.id);
                }}
                showAssign={teamCustomizationEnabled}
              />
            ))}
          </div>

          {/* 团队概览 */}
          <Panel className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <Users2 className="h-4 w-4 text-command-soft" />
              <h2 className="text-title text-fg-primary">团队概览</h2>
              <span className="ml-2 text-body text-fg-muted">
                {hasRequirement
                  ? '系统已根据需求推荐团队（可点右上角「自定义团队」调整）'
                  : '新建需求后系统会据此推荐团队'}
              </span>
            </div>

            {assignedAgentIds.length === 0 ? (
              <p className="text-body text-fg-muted">当前团队为空。建议保持至少 3 名 Agent。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedAgentIds.map((id) => {
                  const a = getAgentById(id);
                  if (!a) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-panel border border-edge-strong bg-surface-raised px-3 py-1 text-body text-fg-primary"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
                      {a.name}
                      <span className="text-fg-muted">{roleName(a.role_id)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {teamReady && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge pt-4">
                <span className="text-body text-fg-secondary">
                  团队已就绪，可前往任务页下发任务。
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setPage('tasks');
                  }}
                >
                  前往任务 <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* 右：详情面板 */}
      <SidePanel
        side="right"
        title="Agent 详情"
        defaultWidth={360}
        minWidth={300}
        maxWidth={560}
        storageKey="agent-detail"
      >
        <AgentDetailPanel
          agent={selectedAgent}
          assigned={selectedAgent ? assignedAgentIds.includes(selectedAgent.id) : false}
          onAssign={() => {
            if (selectedAgent) assignAgent(selectedAgent.id);
          }}
          showAssign={teamCustomizationEnabled}
        />
      </SidePanel>

      <NewRequirementDialog
        open={reqOpen}
        onClose={() => {
          setReqOpen(false);
        }}
      />
    </div>
  );
}
