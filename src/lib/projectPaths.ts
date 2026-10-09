const normalize = (value: string): string => value.replace(/\\/g, '/');

export function isAbsoluteFilePath(value: string): boolean {
  const path = normalize(value);
  return path.startsWith('/') || /^[a-z]:\//i.test(path);
}

/** Resolve against the submitted workspace, never against a matching folder basename. */
export function relativeProjectFileParts(
  filePath: string,
  workspacePath?: string,
): string[] | null {
  const path = normalize(filePath);
  if (!path || path.includes('\0') || path.endsWith('/')) return null;
  let relative = path;
  if (isAbsoluteFilePath(path)) {
    if (!workspacePath || !isAbsoluteFilePath(workspacePath)) return null;
    const root = normalize(workspacePath).replace(/\/+$/, '');
    const windows = /^[a-z]:/i.test(root) || root.startsWith('//');
    const candidate = windows ? path.toLowerCase() : path;
    const prefix = `${windows ? root.toLowerCase() : root}/`;
    if (!candidate.startsWith(prefix)) return null;
    relative = path.slice(root.length + 1);
  } else if (/^[a-z]:/i.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return null;
  }
  const parts = relative.split('/').filter((part) => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') ? parts : null;
}
