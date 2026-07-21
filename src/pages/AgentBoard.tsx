import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Database, FilePlus2, Loader2, RefreshCw } from 'lucide-react';
import { loadMemoryAgents } from '@/api/memory';
import { useDemoStore } from '@/store/useDemoStore';
import type { Agent } from '@/types';
import { AgentCard } from '@/components/AgentCard';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { SidePanel } from '@/components/SidePanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export function AgentBoard() {
  const selectedAgentId = useDemoStore((s) => s.selectedAgentId);
  const selectAgent = useDemoStore((s) => s.selectAgent);
  const [reqOpen, setReqOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setAgents(await loadMemoryAgents());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedAgent = selectedAgentId
    ? (agents.find((agent) => agent.id === selectedAgentId) ?? null)
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：抬头 + 卡片网格 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div>
            <h1 className="text-title text-fg-primary">Agent 角色</h1>
            <p className="mt-0.5 text-body text-fg-muted">B 角色画像与持久化记忆</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={loadError ? 'danger' : 'ok'}>
              <Database className="h-3.5 w-3.5" /> B Memory · {agents.length}
            </Badge>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
            </Button>
            <Button variant="primary" size="sm" onClick={() => setReqOpen(true)}>
              <FilePlus2 className="h-4 w-4" /> 新建需求
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && agents.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-body text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在读取 B Memory
            </div>
          ) : loadError ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle className="h-5 w-5 text-human-soft" />
              <div>
                <p className="text-body text-fg-primary">B Memory 连接失败</p>
                <p className="mt-1 max-w-lg text-body text-fg-muted">{loadError}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void refresh()}>
                <RefreshCw className="h-4 w-4" /> 重试
              </Button>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-body text-fg-muted">
              B Memory 中暂无角色
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgentId === agent.id}
                  assigned={false}
                  recommended={false}
                  onSelect={() => selectAgent(agent.id)}
                  onAssign={() => {}}
                  showAssign={false}
                />
              ))}
            </div>
          )}
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
          assigned={false}
          onAssign={() => {}}
          showAssign={false}
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
