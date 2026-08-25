/**
 * 新建 Agent 弹窗。
 *
 * 从 `AgentAdminPanel` 里搬出来独立成文件：它建的是**另一个** Agent，与面板当前选中的那个
 * 无关，所以全局控制台（`OrgConsolePanel`）和单 Agent 的生命周期页都要用它。
 *
 * 错误留在弹窗里不往上抛：弹窗盖住了父组件的错误条，扔上去用户看不见，也没法就地改。
 */
import { useState } from 'react';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { memoryApi } from '@/api/memory';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Textarea';
import { errorText, INPUT_CLASS, parseTags } from '@/components/memory/memoryShared';

/** 每行一条，去掉空行。约束条目是 string[]，不是逗号分隔。 */
function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-body text-fg-secondary">{label}</span>
      {hint && <span className="ml-2 text-body text-fg-muted">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [seed, setSeed] = useState('');
  const [constraints, setConstraints] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const reset = () => {
    setRoleId('');
    setName('');
    setTags('');
    setSeed('');
    setConstraints('');
    setError(undefined);
  };

  const close = () => {
    reset();
    onClose();
  };

  const canSubmit = roleId.trim().length > 0 && name.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || creating) return;
    setCreating(true);
    setError(undefined);
    const tagList = parseTags(tags);
    const constraintList = parseLines(constraints);
    const seedText = seed.trim();
    try {
      await memoryApi.createAgent({
        role_id: roleId.trim(),
        name: name.trim(),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
        ...(seedText ? { persona_seed: seedText } : {}),
        ...(constraintList.length > 0 ? { constraints: constraintList } : {}),
      });
      onCreated();
      reset();
      onClose();
    } catch (reason) {
      // 留在弹窗里：弹窗盖住了父组件的错误条，扔上去用户看不见，也没法就地改。
      setError(errorText(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} className="max-w-xl">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel bg-command/15 text-command-soft">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-title text-fg-primary">新建 Agent</h2>
            <p className="text-body text-fg-muted">角色标识一旦占用就不能再建同名的。</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="角色标识" hint="后端主键，创建后不可改。">
            <input
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
              }}
              placeholder="backend-dev"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="名称">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="后端开发"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="标签（可选）" hint="逗号或换行分隔。">
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
              }}
              placeholder="backend, api"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="画像种子（可选）" hint="生成初始画像摘要的种子文本。">
            <Textarea
              rows={3}
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value);
              }}
              placeholder="擅长服务端接口设计与数据库改造…"
            />
          </Field>
          <Field label="约束条目（可选 · 每行一条）">
            <Textarea
              rows={3}
              value={constraints}
              onChange={(e) => {
                setConstraints(e.target.value);
              }}
              placeholder={'不改动数据库迁移脚本\n只在 packages/api 下工作'}
            />
          </Field>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-panel border border-danger/30 bg-danger/10 px-3 py-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-danger-soft" />
            <p className="min-w-0 text-body text-fg-secondary">{error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit || creating} onClick={() => void submit()}>
            {creating ? '正在创建…' : '创建'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
