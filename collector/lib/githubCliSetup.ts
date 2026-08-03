export interface GitHubCliInstallPlan {
  label: string;
  file: string;
  args: string[];
  requiresElevation: boolean;
}

/**
 * Choose a native GitHub CLI installation path without performing any work.
 * The caller is responsible for explicit user approval before executing it.
 */
export function selectGitHubCliInstallPlan(
  platform: NodeJS.Platform,
  available: ReadonlySet<string>,
): GitHubCliInstallPlan | null {
  if (platform === 'win32' && available.has('winget.exe')) {
    return {
      label: 'Windows Package Manager',
      file: 'winget.exe',
      args: [
        'install',
        '--id',
        'GitHub.cli',
        '--exact',
        '--source',
        'winget',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
      requiresElevation: false,
    };
  }

  if (platform === 'darwin' && available.has('brew')) {
    return {
      label: 'Homebrew',
      file: 'brew',
      args: ['install', 'gh'],
      requiresElevation: false,
    };
  }

  if (platform === 'linux') {
    if (available.has('apt-get')) {
      return {
        label: 'APT',
        file: 'apt-get',
        args: ['install', '-y', 'gh'],
        requiresElevation: true,
      };
    }
    if (available.has('dnf')) {
      return {
        label: 'DNF',
        file: 'dnf',
        args: ['install', '-y', 'gh'],
        requiresElevation: true,
      };
    }
    if (available.has('yum')) {
      return {
        label: 'YUM',
        file: 'yum',
        args: ['install', '-y', 'gh'],
        requiresElevation: true,
      };
    }
    if (available.has('pacman')) {
      return {
        label: 'Pacman',
        file: 'pacman',
        args: ['-S', '--noconfirm', 'github-cli'],
        requiresElevation: true,
      };
    }
    if (available.has('zypper')) {
      return {
        label: 'Zypper',
        file: 'zypper',
        args: ['--non-interactive', 'install', 'gh'],
        requiresElevation: true,
      };
    }
    if (available.has('apk')) {
      return {
        label: 'APK',
        file: 'apk',
        args: ['add', 'github-cli'],
        requiresElevation: true,
      };
    }
    if (available.has('brew')) {
      return {
        label: 'Homebrew on Linux',
        file: 'brew',
        args: ['install', 'gh'],
        requiresElevation: false,
      };
    }
  }

  return null;
}
