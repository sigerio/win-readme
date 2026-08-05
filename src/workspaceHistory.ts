export const WORKSPACE_HISTORY_KEY = "win-readme-workspace-history";
export const MAX_WORKSPACE_HISTORY = 5;

export function rememberWorkspace(history: string[], path: string): string[] {
  return [path, ...history.filter((item) => item !== path)].slice(0, MAX_WORKSPACE_HISTORY);
}
