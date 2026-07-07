import { Settings, Boxes } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { APP_VERSION } from '@/lib/version';

/** 设置弹窗：当前仅展示应用信息与版本号，后续可扩展偏好项。 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: { label: string; value: string }[] = [
    { label: '版本 · Version', value: `v${APP_VERSION}` },
    { label: '应用 · App', value: 'Polaris' },
    {
      label: '运行环境 · Runtime',
      value: navigator.userAgent.includes('Electron') ? 'Electron 桌面端' : '浏览器',
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} className="max-w-sm">
      <div className="p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-command/15 text-command-soft">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">设置</h2>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-lg border border-line bg-ink-900/60 p-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-command shadow-glow">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-display text-sm font-semibold text-white">Polaris</div>
          </div>
          <span className="ml-auto rounded-md border border-command/30 bg-command/10 px-2.5 py-1 font-mono text-xs text-command-soft">
            v{APP_VERSION}
          </span>
        </div>

        <dl className="mt-4 space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between rounded-md border border-line bg-ink-900/40 px-3 py-2"
            >
              <dt className="callsign text-[9px] text-slate-500">{r.label}</dt>
              <dd className="font-mono text-[12px] text-slate-200">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}
