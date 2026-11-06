import { probeConfig } from './probe-config.js';

export function studentPageUrl(): string | null {
  const projectId = probeConfig.firebase.projectId;
  if (probeConfig.invalidJson || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) return null;
  return `https://${projectId}.web.app/student`;
}
