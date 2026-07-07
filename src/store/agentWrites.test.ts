import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDemoStore } from '@/store/useDemoStore';

/**
 * Agent 生成文件落盘链路的集成测试（stub 桌面桥，走真实 store 推进）：
 *   N7 节点激活 → gate:allow 写操作自动落盘；
 *   权限确认"允许" → 挂起写操作落盘 + 项目文件树同步；
 *   权限"拒绝" → 不落盘。
 */

const writeTextFile = vi.fn(
  async (payload: { projectName: string; rootPath?: string; path: string; content: string }) => ({
    ok: true as const,
    absPath: `${payload.rootPath ?? `/ws/${payload.projectName}`}/${payload.path}`,
  }),
);
const chooseDirectory = vi.fn(async () => ({ path: '/repos/legacy-order', name: 'legacy-order' }));
const readDirectoryTree = vi.fn(async () => ({
  ok: true as const,
  tree: [{ name: 'src', children: [{ name: 'main.ts' }] }, { name: 'README.md' }],
  truncated: false,
}));

vi.stubGlobal('window', {
  desktop: {
    isDesktop: true,
    fs: { writeTextFile, chooseDirectory, readDirectoryTree, reveal: vi.fn() },
  },
});

const s = () => useDemoStore.getState();

/** 推进工作流直到 N7 执行段（-be/-te 并行列）点亮。 */
function advanceToN7(rootPath?: string) {
  s().createProject('电商订单系统', undefined, rootPath);
  s().createTask('为订单资源实现 RBAC 权限控制');
  s().useRecommendedWorkflow();
  for (
    let i = 0;
    i < 30 && !s().nodes.some((n) => n.id === 'n7-executing-be' && n.status === 'active');
    i++
  ) {
    s().nextStep();
  }
  expect(s().nodes.some((n) => n.id === 'n7-executing-be' && n.status === 'active')).toBe(true);
}

describe('agent 生成文件落盘', () => {
  beforeEach(() => {
    s().resetDemo();
    writeTextFile.mockClear();
  });

  it('N7 激活时自动落盘 gate:allow 的写操作，挂权限的不写', async () => {
    advanceToN7();

    await vi.waitFor(() => {
      expect(s().agentFileWrites['fop-be-03']?.status).toBe('written');
      expect(s().agentFileWrites['fop-te-03']?.status).toBe('written');
    });
    // 挂着权限请求的那条（permissionMatrix.ts）必须等人确认
    expect(s().agentFileWrites['fop-be-04']).toBeUndefined();

    expect(writeTextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: '电商订单系统',
        path: 'src/auth/permissionService.ts',
        content: expect.stringContaining('hasPermission'),
      }),
    );
  });

  it('权限确认"允许"后落盘，并把文件挂进项目文件树', async () => {
    advanceToN7();
    s().resolveFilePermission('fop-be-04', { outcome: 'selected', optionId: 'allow-once' });

    await vi.waitFor(() => {
      const r = s().agentFileWrites['fop-be-04'];
      expect(r?.status).toBe('written');
    });

    const project = s().projects.find((p) => p.id === s().activeProjectId);
    const auth = project?.files
      .find((n) => n.name === 'src')
      ?.children?.find((n) => n.name === 'auth');
    expect(auth?.children?.some((n) => n.name === 'permissionMatrix.ts')).toBe(true);
  });

  it('自定义保存路径的项目：写入请求携带 rootPath', async () => {
    advanceToN7('/custom/order-service');

    await vi.waitFor(() => {
      expect(s().agentFileWrites['fop-be-03']?.status).toBe('written');
    });
    expect(writeTextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: '/custom/order-service',
        path: 'src/auth/permissionService.ts',
      }),
    );
    const r = s().agentFileWrites['fop-be-03'];
    expect(r?.status === 'written' && r.absPath).toBe(
      '/custom/order-service/src/auth/permissionService.ts',
    );
  });

  it('从文件夹打开项目：扫描文件树并进入；同目录不重复建项目', async () => {
    const error = await s().openProjectFromFolder();
    expect(error).toBeNull();

    const project = s().projects.find((p) => p.id === s().activeProjectId);
    expect(project?.name).toBe('legacy-order');
    expect(project?.rootPath).toBe('/repos/legacy-order');
    expect(project?.files).toEqual([
      { name: 'src', children: [{ name: 'main.ts' }] },
      { name: 'README.md' },
    ]);

    // 再开同一目录：切回已有项目而不是新建
    const countBefore = s().projects.length;
    await s().openProjectFromFolder();
    expect(s().projects.length).toBe(countBefore);
    expect(s().activeProjectId).toBe(project?.id);
  });

  it('openFile 进入文件查看页；closeFile 返回；删除已打开文件自动关闭', () => {
    s().createProject('电商订单系统');
    s().createTask('为订单资源实现 RBAC 权限控制');
    const projectId = s().activeProjectId!;
    s().addFile(projectId, 'src/auth/permissionService.ts');

    s().openFile(projectId, 'src/auth/permissionService.ts');
    expect(s().currentPage).toBe('file');
    expect(s().openedFile).toEqual({ projectId, path: 'src/auth/permissionService.ts' });

    s().closeFile();
    expect(s().currentPage).toBe('tasks');
    expect(s().openedFile).toBeNull();

    // 删除正在查看的文件 → 查看页关闭
    s().openFile(projectId, 'src/auth/permissionService.ts');
    s().deleteFile(projectId, 'src/auth/permissionService.ts');
    expect(s().openedFile).toBeNull();
    expect(s().currentPage).toBe('tasks');
  });

  it('buildProjectTrace 汇出执行审计快照（任务时间线 + 人机确认 + 落盘回执）', async () => {
    advanceToN7();
    s().resolveFilePermission('fop-be-04', { outcome: 'selected', optionId: 'allow-once' });
    await vi.waitFor(() => {
      expect(s().agentFileWrites['fop-be-04']?.status).toBe('written');
    });

    const trace = s().buildProjectTrace(s().activeProjectId!);
    expect(trace?.format).toBe('polaris-agent-trace');
    expect(trace?.project.name).toBe('电商订单系统');
    expect(trace?.tasks).toHaveLength(1);
    expect(trace?.tasks[0].timeline.length).toBeGreaterThan(0);
    expect(trace?.tasks[0].filePermissionOutcomes?.['fop-be-04']?.optionId).toBe('allow-once');
    expect(trace?.agentFileWrites['fop-be-04']?.status).toBe('written');
  });

  it('权限"拒绝"不落盘', async () => {
    advanceToN7();
    writeTextFile.mockClear();
    s().resolveFilePermission('fop-be-04', { outcome: 'selected', optionId: 'reject' });

    // 等一拍确保没有异步写入发生
    await new Promise((r) => setTimeout(r, 20));
    expect(s().agentFileWrites['fop-be-04']).toBeUndefined();
    expect(writeTextFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/auth/permissionMatrix.ts' }),
    );
  });
});
