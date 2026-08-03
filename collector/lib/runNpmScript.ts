import { execFileSync } from 'node:child_process';

export interface NpmInvocation {
  file: string;
  args: string[];
}

function assertSafeArg(value: string): void {
  if (!/^[a-zA-Z0-9_:@./=+-]+$/.test(value)) {
    throw new Error(`Unsafe internal npm argument: ${value}`);
  }
}

export function buildNpmInvocation(
  platform: NodeJS.Platform,
  script: string,
  extra: string[] = [],
  comSpec = process.env.ComSpec,
): NpmInvocation {
  const npmArgs = ['run', script, ...extra];

  if (platform === 'win32') {
    npmArgs.forEach(assertSafeArg);
    return {
      file: comSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...npmArgs].join(' ')],
    };
  }

  return { file: 'npm', args: npmArgs };
}

export function runNpmScript(script: string, extra: string[] = [], cwd = process.cwd()): void {
  const invocation = buildNpmInvocation(process.platform, script, extra);
  execFileSync(invocation.file, invocation.args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
}
