import { useState, type KeyboardEvent } from 'react';
import { FolderPlus, ArrowRight, FolderSearch, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useDemoStore } from '@/store/useDemoStore';
import { pickProjectDirectory } from '@/lib/agentFs';

/** 新建项目 · 项目名（可选描述 + 桌面版可自选保存位置），创建后进入工作区 */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createProject = useDemoStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rootPath, setRootPath] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;
  const isDesktop = !!window.desktop;

  const reset = () => {
    setName('');
    setDescription('');
    setRootPath(null);
  };
  const handleClose = () => {
    reset();
    onClose();
  };
  const handleCreate = () => {
    if (!canSubmit) return;
    createProject(name, description, rootPath ?? undefined);
    reset();
    onClose();
  };
  const handlePickDirectory = async () => {
    const picked = await pickProjectDirectory('选择项目保存位置');
    if (picked) {
      setRootPath(picked.path);
      // 项目名为空时顺手用文件夹名补上
      if (!name.trim()) setName(picked.name);
    }
  };
  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-command/15 text-command-soft shadow-glow">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">新建项目</h2>
          </div>
        </div>

        <div className="mt-5">
          <label className="callsign mb-1.5 block text-[9px] text-slate-400">项目名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onNameKeyDown}
            autoFocus
            placeholder="例如：order-service"
            className="w-full rounded-md border border-line-bright bg-ink-900 px-3 py-2 font-mono text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40"
          />
        </div>

        <div className="mt-4">
          <label className="callsign mb-1.5 block text-[9px] text-slate-400">描述 · 可选</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="一句话说明这个项目做什么…"
          />
        </div>

        {isDesktop && (
          <div className="mt-4">
            <label className="callsign mb-1.5 block text-[9px] text-slate-400">保存位置</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePickDirectory}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-bright bg-ink-900 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
              >
                <FolderSearch className="h-3.5 w-3.5" /> 选择文件夹
              </button>
              {rootPath ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line-bright bg-ink-900 px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                    {rootPath}
                  </span>
                  <button
                    type="button"
                    title="恢复默认位置"
                    onClick={() => setRootPath(null)}
                    className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600">
                  默认：文档/polaris-workspace/&lt;项目名&gt;/
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
              Agent 生成的文件将写入该目录。
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canSubmit}>
            创建并进入 <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
