import { describe, expect, it } from 'vitest';
import { isAbsoluteFilePath, relativeProjectFileParts, sameProjectPath } from './projectPaths';

describe('project file paths', () => {
  it('compares routing workspaces using Windows and POSIX path rules', () => {
    expect(sameProjectPath('C:\\Work\\cook\\', 'c:/work/cook')).toBe(true);
    expect(sameProjectPath('\\\\SERVER\\Share\\cook', '//server/share/cook/')).toBe(true);
    expect(sameProjectPath('/work/cook/', '/work/cook')).toBe(true);
    expect(sameProjectPath('/work/Cook', '/work/cook')).toBe(false);
    expect(sameProjectPath('/work/cook-other', '/work/cook')).toBe(false);
    expect(sameProjectPath('', '')).toBe(false);
  });
  it('maps a Windows delivered file to its actual project root', () => {
    expect(
      relativeProjectFileParts(
        'C:\\Users\\tester\\Documents\\polaris-workspace\\天下\\hello_world.py',
        'C:\\Users\\tester\\Documents\\polaris-workspace\\天下',
      ),
    ).toEqual(['hello_world.py']);
  });

  it('preserves nested paths and repeated project names', () => {
    expect(
      relativeProjectFileParts('C:\\work\\project\\src\\project\\main.py', 'C:\\work\\project'),
    ).toEqual(['src', 'project', 'main.py']);
    expect(relativeProjectFileParts('src\\lib\\main.py')).toEqual(['src', 'lib', 'main.py']);
  });

  it('handles mixed separators, drive case and UNC shares', () => {
    expect(relativeProjectFileParts('c:/WORK/demo/src/main.py', 'C:\\work\\demo\\')).toEqual([
      'src',
      'main.py',
    ]);
    expect(
      relativeProjectFileParts('\\\\server\\share\\demo\\main.py', '\\\\SERVER\\share\\demo'),
    ).toEqual(['main.py']);
  });

  it('keeps POSIX case sensitivity and supports a root workspace', () => {
    expect(relativeProjectFileParts('/work/demo/main.py', '/work/demo')).toEqual(['main.py']);
    expect(relativeProjectFileParts('/Work/demo/main.py', '/work/demo')).toBeNull();
    expect(relativeProjectFileParts('/src/main.py', '/')).toEqual(['src', 'main.py']);
  });

  it.each([
    ['C:\\other\\hello_world.py', 'C:\\work\\demo'],
    ['C:\\work\\demo-other\\hello_world.py', 'C:\\work\\demo'],
    ['C:\\work\\demo\\..\\other.py', 'C:\\work\\demo'],
    ['../outside.py', undefined],
    ['src/../../outside.py', undefined],
    ['C:relative.py', undefined],
    ['file:///work/demo/main.py', '/work/demo'],
    ['/work/demo/main.py', undefined],
    ['src/', undefined],
    ['', undefined],
  ] as const)('does not invent a project file for %s', (file, root) => {
    expect(relativeProjectFileParts(file, root)).toBeNull();
  });

  it('recognizes absolute platform paths without treating relative paths as absolute', () => {
    for (const path of ['/work/main.py', 'C:\\work\\main.py', '\\\\server\\share\\main.py']) {
      expect(isAbsoluteFilePath(path)).toBe(true);
    }
    expect(isAbsoluteFilePath('src/main.py')).toBe(false);
  });
});
