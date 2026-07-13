import { Fold } from '@/components/ui/Fold';

/**
 * ⑥「需求」—— 恒有（没有 run 时右栏就只有它）。
 *
 * 需求原文在这里是**散文**，不是一个 run 期间恒 disabled 的 textarea。
 * 那个常驻输入框占着主层两行 + 边框 + 标签，却在 99% 的时间里不可编辑 ——
 * 它把「这是一段可以读的文字」伪装成「这是一个可以填的表单」。
 */
export function RequirementFold({
  text,
  completionCriteria,
  evidence,
}: {
  text: string;
  completionCriteria: string[];
  /** 有 run 时给出「需求受理」那一步背后的原始事件 */
  evidence?: { count: number; onOpen: () => void };
}) {
  const firstLine = text.split('\n').find((line) => line.trim()) ?? '';

  return (
    <Fold id="fold-requirement" title="需求" fact={firstLine} evidence={evidence}>
      <p className="whitespace-pre-wrap break-words text-body text-fg-secondary">
        {text || '（空）'}
      </p>
      {completionCriteria.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2">
          <p className="mb-1 text-body text-fg-muted">验收标准</p>
          <ul className="flex flex-col gap-0.5">
            {completionCriteria.map((item) => (
              <li key={item} className="flex gap-1.5 text-body text-fg-secondary">
                <span className="text-fg-faint">·</span>
                <span className="min-w-0 break-words">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Fold>
  );
}
