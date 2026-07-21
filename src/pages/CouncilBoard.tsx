import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  FileCode2,
  GitBranch,
  MessagesSquare,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IdChip } from '@/components/ui/IdChip';

type DataRecord = Record<string, unknown>;

export function CouncilBoard() {
  const setPage = useDemoStore((state) => state.setPage);
  const replay = useDemoStore(selectActiveReplay);
  const snapshot = replay?.liveSnapshot;
  const council = snapshot?.council;

  if (!snapshot || !council) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Scale}
          title="当前没有真实 Council 结果"
          hint="请创建 Council 模式任务；后端快照产生后，这里会显示提案、评审、综合结论和角色会话。"
          action={
            <Button variant="secondary" size="sm" onClick={() => setPage('tasks')}>
              返回任务
            </Button>
          }
        />
      </div>
    );
  }

  const proposals = council.proposals ?? [];
  const reviews = council.reviews ?? [];
  const sessions = collectSessions(snapshot.agent_runs, snapshot.run?.session_id);
  const statusVariant =
    council.status === 'completed' ? 'ok' : council.status === 'failed' ? 'danger' : 'command';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-6 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Scale className="h-5 w-5 text-human" />
            <h1 className="text-title text-fg-primary">Council 结果</h1>
            <Badge variant={statusVariant}>{council.status}</Badge>
            <Badge variant="default">后端只读快照</Badge>
          </div>
          <p className="mt-1 text-body text-fg-muted">
            {council.decision_mode ?? 'decision mode 未提供'} ·{' '}
            {council.verdict ?? 'verdict 未产生'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IdChip value={snapshot.run_id} label="Run ID" />
          {council.decision_id && <IdChip value={council.decision_id} label="Decision ID" />}
          <Button variant="secondary" size="sm" onClick={() => setPage('tasks')}>
            <ArrowLeft className="h-4 w-4" /> 返回任务
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto p-6">
        <section>
          <SectionTitle icon={GitBranch} title="角色 Session" count={sessions.length} />
          {sessions.length === 0 ? (
            <EmptyLine>快照尚未提供 session_id</EmptyLine>
          ) : (
            <div className="overflow-hidden rounded-panel border border-edge">
              <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(200px,1.5fr)_minmax(120px,0.8fr)] gap-3 border-b border-edge bg-surface-raised px-3 py-2 text-body text-fg-muted">
                <span>角色</span>
                <span>Session ID</span>
                <span>最近事件</span>
              </div>
              {sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="grid grid-cols-[minmax(120px,0.7fr)_minmax(200px,1.5fr)_minmax(120px,0.8fr)] gap-3 border-b border-edge px-3 py-2 last:border-b-0"
                >
                  <span className="truncate text-body text-fg-primary">{session.role}</span>
                  <span className="truncate font-mono text-code text-fg-secondary">
                    {session.sessionId}
                  </span>
                  <span className="truncate text-body text-fg-muted">{session.eventType}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={FileCode2} title="提案" count={proposals.length} />
          {proposals.length === 0 ? (
            <EmptyLine>后端快照尚未返回 proposals</EmptyLine>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {proposals.map((proposal, index) => (
                <RecordCard
                  key={recordKey(proposal, 'proposal_id', index)}
                  title={recordText(proposal, 'summary') || `提案 ${index + 1}`}
                  id={recordText(proposal, 'proposal_id')}
                  record={proposal}
                  fields={[
                    'agent_id',
                    'affected_paths',
                    'assumptions',
                    'known_risks',
                    'completion_evidence',
                    'artifact_refs',
                  ]}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={MessagesSquare} title="评审" count={reviews.length} />
          {reviews.length === 0 ? (
            <EmptyLine>后端快照尚未返回 reviews</EmptyLine>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {reviews.map((review, index) => (
                <RecordCard
                  key={recordKey(review, 'review_id', index)}
                  title={recordText(review, 'reason') || `评审 ${index + 1}`}
                  id={recordText(review, 'review_id')}
                  record={review}
                  fields={[
                    'proposal_id',
                    'reviewer_id',
                    'verdict',
                    'unmet_criteria',
                    'evidence_refs',
                  ]}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={CheckCircle2} title="综合与输出" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <ResultBlock title="Synthesis" value={council.synthesis} />
            <ResultBlock title="Output" value={council.output} />
            <ResultBlock title="Result" value={council.result} />
          </div>
        </section>

        <section>
          <SectionTitle icon={ShieldAlert} title="后续约束" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <StringList title="Required next actions" values={council.required_next_actions} />
            <StringList title="Blocked by" values={council.blocked_by} />
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Scale;
  title: string;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-command-soft" />
      <h2 className="text-title text-fg-primary">{title}</h2>
      {count !== undefined && <Badge variant="default">{count}</Badge>}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-edge px-4 py-5 text-body text-fg-muted">
      {children}
    </div>
  );
}

function RecordCard({
  title,
  id,
  record,
  fields,
}: {
  title: string;
  id: string;
  record: DataRecord;
  fields: string[];
}) {
  return (
    <article className="rounded-panel border border-edge bg-surface-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-title text-fg-primary">{title}</h3>
        {id && <IdChip value={id} />}
      </div>
      <dl className="mt-3 space-y-2">
        {fields.flatMap((field) =>
          record[field] === undefined
            ? []
            : [
                <div key={field} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <dt className="text-body text-fg-muted">{field}</dt>
                  <dd className="whitespace-pre-wrap break-words text-body text-fg-secondary">
                    {formatValue(record[field])}
                  </dd>
                </div>,
              ],
        )}
      </dl>
    </article>
  );
}

function ResultBlock({ title, value }: { title: string; value?: DataRecord }) {
  return (
    <article className="min-h-36 rounded-panel border border-edge bg-surface-panel p-4">
      <h3 className="text-title text-fg-primary">{title}</h3>
      <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-code text-fg-secondary">
        {value ? JSON.stringify(value, null, 2) : '未提供'}
      </pre>
    </article>
  );
}

function StringList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-panel border border-edge bg-surface-panel p-4">
      <h3 className="text-title text-fg-primary">{title}</h3>
      {values.length === 0 ? (
        <p className="mt-2 text-body text-fg-muted">无</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {values.map((value) => (
            <li key={value} className="flex gap-2 text-body text-fg-secondary">
              <CircleDot className="mt-1 h-3 w-3 shrink-0 text-command-soft" /> {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function collectSessions(agentRuns: DataRecord[], runSessionId?: string) {
  const sessions = new Map<string, { sessionId: string; role: string; eventType: string }>();
  if (runSessionId) {
    sessions.set(runSessionId, {
      sessionId: runSessionId,
      role: 'execution',
      eventType: 'run session',
    });
  }
  for (const event of agentRuns) {
    const sessionId = recordText(event, 'session_id');
    if (!sessionId) continue;
    sessions.set(sessionId, {
      sessionId,
      role: recordText(event, 'role_id') || recordText(event, 'agent_id') || 'agent',
      eventType: recordText(event, 'type') || 'agent event',
    });
  }
  return [...sessions.values()];
}

function recordText(record: DataRecord, key: string): string {
  return typeof record[key] === 'string' ? record[key] : '';
}

function recordKey(record: DataRecord, key: string, index: number): string {
  return recordText(record, key) || String(index);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => formatValue(entry)).join('\n') || '无';
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
