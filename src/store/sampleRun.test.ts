import { beforeEach, describe, expect, it } from 'vitest';
import { useDemoStore } from '@/store/useDemoStore';
import { sampleRunReplay, sampleRunSnapshot } from '@/data/sampleRun';

/**
 * 后端真实 run 样例回放的集成测试（走真实 store 推进）：
 *   加载样例 → 建样例项目 + 回放任务（contractTaskId 即真实 task_id）；
 *   推进全程 → Council 直通（Gate=allow）、时间线用真实事件文案、
 *   事件通道收到回放的契约事件、末态 delivery。
 */

const s = () => useDemoStore.getState();

beforeEach(() => {
  s().resetDemo();
});

describe('样例 run 回放（run_be712da2）', () => {
  it('加载样例：建项目与回放任务，回填真实 task_id', () => {
    s().loadSampleRun();
    expect(s().activeProjectId).toBeTruthy();
    const task = s().tasks.find((t) => t.id === s().activeTaskId);
    expect(task?.replay?.snapshot.run_id).toBe(sampleRunSnapshot.run_id);
    expect(task?.contractTaskId).toBe(sampleRunSnapshot.task_id);
    expect(s().stage).toBe('analyzing');
    expect(s().currentPage).toBe('tasks');
  });

  it('执行泳道由后端派单驱动：single_agent 只有 acp-external 一条执行子链', () => {
    s().loadSampleRun();
    expect(s().assignedAgentIds).toEqual(['acp-external']);
    const nodes = s().nodes;
    // 图由快照参与者正向生成：没有 mock 模板的 -be/-te 双泳道
    expect(nodes.some((n) => n.id.endsWith('-be') || n.id.endsWith('-te'))).toBe(false);
    // 执行子链的泳道与 owner 都是被派单 agent 的真实身份
    const n7 = nodes.find((n) => n.id === 'n7-executing-acp-external');
    expect(n7?.lane).toBe('acp-external');
    expect(n7?.owner).toBe('acp-external · claude');
    // 执行段每列恰好 1 个节点（1 个 agent = 1 条子链）
    expect(nodes.filter((n) => n.column === 7)).toHaveLength(1);
    // N10 fan-in 指向该子链的 N9，无悬空依赖
    const ids = new Set(nodes.map((n) => n.id));
    expect(nodes.find((n) => n.id === 'n10-task-completed')?.deps).toEqual([
      'n9-artifact-acp-external',
    ]);
    expect(nodes.every((n) => n.deps.every((d) => ids.has(d)))).toBe(true);
  });

  it('重复加载不重复建项目，直接切回已有回放任务', () => {
    s().loadSampleRun();
    const projectId = s().activeProjectId;
    const projectCount = s().projects.length;
    const taskCount = s().tasks.length;
    s().loadSampleRun();
    expect(s().projects.length).toBe(projectCount);
    expect(s().tasks.length).toBe(taskCount);
    expect(s().activeProjectId).toBe(projectId);
  });

  it('推进全程：Council 直通、真实事件回放、末态 delivery', () => {
    s().loadSampleRun();
    s().useRecommendedWorkflow();
    for (let i = 0; i < 40 && s().stage === 'executing'; i += 1) {
      s().nextStep();
    }
    // 快照无 Council 证据：全程不进 council，也无需裁决即达交付
    expect(s().stage).toBe('delivery');
    expect(s().confirmedCouncilOptionId).toBeNull();

    // 时间线只用快照 timeline 原文（后端给什么显示什么）
    const texts = s().timeline.map((e) => e.text);
    expect(texts.some((t) => t.includes('RunCompleted'))).toBe(true);
    expect(texts).toContain('TaskCreated');
    // mock 剧本的鉴权场景文案不应串入回放
    expect(texts.some((t) => t.includes('鉴权中间件'))).toBe(false);

    // 事件通道收到回放的契约事件（frozen 词表 + 真实 run_id）
    const events = s().backendEvents;
    expect(events.some((e) => e.event_type === 'gate.result')).toBe(true);
    const done = events.find((e) => e.event_type === 'run.completed');
    expect(done?.run_id).toBe(sampleRunSnapshot.run_id);
  });

  it('回放内容由快照程序化派生：原文、真实时间戳、无编造', () => {
    // 后端事实：N2 的 TaskCreated 事件 id 即真实 task_id
    const n2 = sampleRunReplay.nodeFacts['n2-create-task'];
    expect(n2?.[0]).toMatchObject({ key: 'TaskCreated', value: sampleRunSnapshot.task_id });
    // N16 checkpoint：runtime_state 与幽灵产物 artifact-i7meflfh 全部上屏
    const n16 = sampleRunReplay.nodeFacts['n16-checkpoint'];
    expect(n16?.some((f) => f.key === 'runtime_state.resume_cursor')).toBe(true);
    expect(n16?.some((f) => f.value.includes('artifact-i7meflfh'))).toBe(true);

    // 时间戳诚实性：timeline 事件无时间戳 → 序号；mailbox 消息有 → 真实时刻
    expect(sampleRunReplay.nodeLogs['n2-create-task']?.time).toMatch(/^#\d+$/);
    expect(sampleRunReplay.nodeLogs['n4-claim']?.time).toBe('01:47:30');

    // 后端未提供工具事件流 → 不虚构文件操作；Council 无数据 → 场景为空不套 mock
    expect(sampleRunReplay.nodeFileOps).toEqual({});
    expect(sampleRunReplay.scenario.council.options).toHaveLength(0);
    // N14 无数据、N13 只有 GateResult 事件（未附 decision，不下 allow 结论）
    expect(sampleRunReplay.nodeFacts['n14-council']).toEqual([]);
    expect(sampleRunReplay.nodeFacts['n13-gate']?.map((f) => f.key)).toEqual(['GateResult']);
  });
});
