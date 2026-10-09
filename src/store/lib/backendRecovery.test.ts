import { describe, expect, it } from 'vitest';
import type { TaskSnapshot } from '@/api/types/task';
import { createRequirementTask } from '@/data/tasks';
import { blankState } from './blankState';
import { recoverBackendTasks } from './backendRecovery';

function historicalTask(status: 'running' | 'completed' | 'interrupted'): TaskSnapshot {
  return {
    contract_version: 'task-snapshot.v0',
    schema_version: 'test',
    revision: 1,
    task: {
      task_id: 'previous-task',
      status,
      risk_level: 'low',
      spec: 'Previous project task',
      completion_criteria: ['Keep the delivered files'],
      affected_paths: [],
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      schema_version: 'test',
    },
    run_history: [
      {
        run_id: 'previous-run',
        task_id: 'previous-task',
        mode: 'single_agent',
        status,
        restartable: false,
      },
    ],
    warnings: [],
  };
}

describe('startup recovery', () => {
  it('restores the owning project and delivery workspace without opening it automatically', () => {
    const initial = blankState();
    const snapshot = historicalTask('completed');
    snapshot.task.workspace_path = 'C:\\Users\\tester\\Documents\\polaris-workspace\\cook';
    const recovered = recoverBackendTasks(initial, [snapshot]);
    const next = { ...initial, ...recovered };
    expect(next.activeProjectId).toBeNull();
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0].rootPath).toBe(snapshot.task.workspace_path);
    expect(next.tasks[0].projectId).toBe(next.projects[0].id);
    expect(next.tasks[0].contractWorkspacePath).toBe(snapshot.task.workspace_path);
    expect(recoverBackendTasks(recovered, [snapshot]).projects).toHaveLength(1);
  });
  it.each(['running', 'completed', 'interrupted'] as const)(
    'keeps the launcher visible when recovering a %s historical task',
    (status) => {
      const initial = blankState();
      const next = { ...initial, ...recoverBackendTasks(initial, [historicalTask(status)]) };
      expect(next.activeProjectId).toBeNull();
      expect(next.activeTaskId).toBeNull();
      expect(next.currentPage).toBe(initial.currentPage);
      expect(next.taskText).toBe('');
      expect(next.tasks[0].contractTaskId).toBe('previous-task');
      expect(next.liveRuns['previous-run'].status).toBe(
        status === 'interrupted' ? 'failed' : status,
      );
    },
  );

  it('does not steal a project or draft opened while backend startup was in flight', () => {
    const initial = {
      ...blankState(),
      activeProjectId: 'new-project',
      currentPage: 'file' as const,
      taskText: 'An unfinished draft',
      openedFile: { projectId: 'new-project', path: 'main.py' },
    };
    const next = { ...initial, ...recoverBackendTasks(initial, [historicalTask('completed')]) };
    expect(next.activeProjectId).toBe('new-project');
    expect(next.activeTaskId).toBeNull();
    expect(next.currentPage).toBe('file');
    expect(next.taskText).toBe('An unfinished draft');
    expect(next.openedFile).toEqual(initial.openedFile);
    expect(next.tasks[0].projectId).not.toBe('new-project');
  });

  it('keeps existing project associations and newer live observations on repeated recovery', () => {
    const snapshot = historicalTask('completed');
    const initial = {
      ...blankState(),
      activeProjectId: 'owned-project',
      activeTaskId: 'local-task',
      tasks: [
        {
          ...createRequirementTask('local-task', 'owned-project', 'Current task'),
          contractTaskId: snapshot.task.task_id,
        },
      ],
    };
    const first = recoverBackendTasks(initial, [snapshot, snapshot]);
    const current = {
      ...first,
      liveRuns: {
        ...first.liveRuns,
        'previous-run': { ...first.liveRuns['previous-run'], syncError: 'Latest observation' },
      },
    };
    const recovered = recoverBackendTasks(current, [snapshot]);
    expect(recovered.tasks).toHaveLength(1);
    expect(recovered.tasks[0]).toEqual(initial.tasks[0]);
    expect(recovered.liveRuns['previous-run']).toBe(current.liveRuns['previous-run']);
    expect(recovered.liveTasks[snapshot.task.task_id]).toBe(
      current.liveTasks[snapshot.task.task_id],
    );
    expect(Object.keys(recovered).sort()).toEqual(['liveRuns', 'liveTasks', 'projects', 'tasks']);
  });
});
