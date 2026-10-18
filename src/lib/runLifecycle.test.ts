import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressRibbon } from '@/components/run/ProgressRibbon';
import type { RunEvent } from '@/api/types/rpc';
import type { LiveRunState } from '@/store/types';
import type { DemoTask } from '@/types';
import { buildEventGraph } from './eventGraph';
import { missionLineOf, phaseSegments } from './missionLine';
import { projectProtocolFlow } from './protocolFlow';
import { terminalRunStatus } from './runTimeline';

// Same lifecycle shapes as the multi-role Council runtime; no tool content or user data.
function lifecycle(): RunEvent[] {
  const events: RunEvent[] = [];
  const add = (type: string, payload: Record<string, unknown> = {}) => {
    events.push({
      event_id: `event-${events.length}`,
      sequence: events.length,
      run_id: 'run-1',
      task_id: 'task-1',
      type,
      source: 'coordinator',
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, events.length)).toISOString(),
      payload,
      schema_version: 'v0.1',
    });
  };
  add('task.created');
  add('run.created');
  add('agent.execution_requested', { role_id: 'primary' });
  add('driver.turn_started', { role_id: 'primary' });
  add('driver.turn_completed', { role_id: 'primary' });
  add('agent.execution_completed', { role_id: 'primary', status: 'completed' });
  add('council.started');
  for (const role of ['proposer', 'reviewer', 'synthesizer']) {
    add('driver.prompt_dispatching', { role_id: role });
    add('driver.turn_started', { role_id: role });
    add('driver.tool_failed', { role_id: role });
    add('driver.turn_completed', { role_id: role, stop_reason: 'end_turn' });
    add('driver.disconnected', { role_id: role });
  }
  add('council.review.completed');
  add('council.completed');
  add('artifact.selected');
  add('handler.started', { cursor: 'gate' });
  add('worktree.materialized', { files_written: 7 });
  add('handler.completed', { cursor: 'gate', next_cursor: 'deliver' });
  add('handler.started', { cursor: 'deliver' });
  add('artifact.delivered');
  add('handler.completed', { cursor: 'deliver', next_cursor: 'done' });
  add('run.completed', { status: 'completed' });
  return events;
}

describe('delivery lifecycle consistency', () => {
  const task = { contractRunId: 'run-1', contractTaskStatus: 'completed' } as DemoTask;
  const timeline = lifecycle();
  const live: LiveRunState = {
    runId: 'run-1',
    taskId: 'task-1',
    status: 'running',
    timeline: [],
    snapshot: null,
    error: null,
  };

  it('never announces delivery during a running review, even with an early completed Task snapshot', () => {
    const beforeDelivery = timeline.slice(
      0,
      timeline.findIndex((event) => event.type === 'council.completed'),
    );
    const mission = missionLineOf({
      task,
      live: { ...live, timeline: beforeDelivery },
      now: Date.now(),
    });
    expect(mission.state).toBe('running');
    expect(mission.headline).not.toContain('已交付');
    const phases = phaseSegments(buildEventGraph(beforeDelivery, 'running').nodes);
    expect(phases.find((phase) => phase.key === 'review')?.active).toBe(true);
    expect(phases.find((phase) => phase.key === 'delivery')?.done).toBe(0);
  });

  it('terminal heading, Agent cards and all observed phase counts agree after the final event', () => {
    const done = { ...live, status: 'completed' as const, timeline };
    const mission = missionLineOf({ task, live: done, now: Date.now() });
    const { nodes } = buildEventGraph(timeline, 'completed');
    expect(mission.headline).toContain('已交付 · 7 个文件');
    expect(nodes.filter((node) => node.label === 'Agent Work')).toHaveLength(4);
    expect(nodes.every((node) => node.status === 'done')).toBe(true);
    expect(nodes.every((node) => node.summary !== '执行中' && !node.spanStartedAt)).toBe(true);
    for (const phase of phaseSegments(nodes)) {
      expect(phase.active).toBe(false);
      expect(phase.done).toBe(phase.total);
    }
    // Optional/unobserved protocol nodes stay unobserved, not fabricated as complete.
    const protocol = projectProtocolFlow(timeline, 'completed');
    expect(protocol.some((node) => node.status === 'pending')).toBe(true);
    expect(protocol.find((node) => node.code === 'N18')?.status).toBe('done');
  });

  it('interruption closes the run without a successful terminal state', () => {
    expect(terminalRunStatus('run.interrupted')).toBe('interrupted');
  });

  it.each(['waiting_help', 'blocked', 'running', 'failed', 'cancelled'] as const)(
    'does not report delivered progress when a completed Run belongs to a %s Task',
    (contractTaskStatus) => {
      const pendingTask = { ...task, contractTaskStatus };
      const doneRun = { ...live, status: 'completed' as const, timeline };
      const mission = missionLineOf({ task: pendingTask, live: doneRun, now: Date.now() });
      const phases = phaseSegments(buildEventGraph(timeline, 'completed').nodes, mission.state);
      expect(mission.state).not.toBe('completed');
      expect(phases.find((phase) => phase.key === 'delivery')).toMatchObject({
        done: 0,
        active: false,
      });
      const markup = renderToStaticMarkup(createElement(ProgressRibbon, { phases }));
      const deliveryLabel = markup.slice(markup.lastIndexOf('<span>交付</span>'));
      expect(deliveryLabel).not.toContain('aria-label="已完成"');
      expect([...markup.matchAll(/style="width:(\d+)%"/g)].pop()?.[1]).toBe('0');
    },
  );

  it('uses Task completion for the delivery phase even before the graph has caught up', () => {
    const phases = phaseSegments([], 'completed');
    expect(phases.find((phase) => phase.key === 'delivery')).toMatchObject({
      done: 1,
      total: 1,
      active: false,
    });
  });

  it('does not reuse stale completed graph nodes while waiting for a Run snapshot', () => {
    const mission = missionLineOf({ task, live: undefined, now: Date.now() });
    expect(mission.state).toBe('running');
    expect(
      phaseSegments(buildEventGraph(timeline, 'completed').nodes, mission.state).find(
        (phase) => phase.key === 'delivery',
      )?.done,
    ).toBe(0);
  });

  it('keeps Mailbox wait incomplete and only checks delivery after the continuation Task completes', () => {
    const doneRun = { ...live, status: 'completed' as const, timeline };
    const nodes = buildEventGraph(timeline, 'completed').nodes;
    for (const contractTaskStatus of ['waiting_help', 'running', 'completed'] as const) {
      const mission = missionLineOf({
        task: { ...task, contractTaskStatus },
        live: doneRun,
        now: Date.now(),
      });
      const delivery = phaseSegments(nodes, mission.state).find(
        (phase) => phase.key === 'delivery',
      );
      expect(delivery?.done === delivery?.total).toBe(mission.state === 'completed');
      if (contractTaskStatus === 'waiting_help') {
        expect(mission.headline).toContain('尚未交付');
      }
    }
  });
});
