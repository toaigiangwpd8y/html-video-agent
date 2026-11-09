export type KnowledgeData = Record<string, any>;
export type DiscoveryStep = { id: string; title: string; action: string; observed: string; screenshot?: string; snapshot?: string };
export type FeatureView = KnowledgeData & { discoverySteps: DiscoveryStep[] };
export type CliOptions = {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

export function runKnowledgeCli(argv: string[], options: CliOptions): Promise<number>;
export function createWorkspaceReader(dataDir: string, options?: Record<string, unknown>): {
  readonly lastGood: KnowledgeData | null;
  readonly counters: Record<string, number>;
  readKnowledge(): KnowledgeData;
  invalidate(): void;
};
export function createDiagnosticsReader(dataDir: string): {
  readonly counters: Record<string, number>;
  read(options?: { after?: string | null; limit?: number }): { events: KnowledgeData[]; cursor: string | null; hasMore: boolean; resync: boolean; gap: boolean };
  head(): { cursor: string | null; gap: boolean };
};
export function effectiveHeartbeatAt(dataDir: string, run: KnowledgeData): string | null;
export function startRun(dataDir: string, scope: KnowledgeData, browserInfo?: KnowledgeData | null, options?: Record<string, unknown>): { run: KnowledgeData; receipt: KnowledgeData; work: KnowledgeData };
export function writePresence(dataDir: string, input: KnowledgeData): Promise<KnowledgeData>;
export function auditCoverage(data: KnowledgeData): KnowledgeData;
export function summary(data: KnowledgeData): KnowledgeData;
export function tasks(data: KnowledgeData): KnowledgeData[];
export function withWorkspaceLock<T>(dir: string, callback: () => Promise<T> | T, options?: { timeoutMs?: number }): Promise<T>;
export function buildFeatureView(data: KnowledgeData, featureId: string): FeatureView;
export function buildResearchProjection(data: KnowledgeData, options?: { featureId?: string; contextId?: string }): KnowledgeData;
export function buildExplorerHead(data: KnowledgeData, now: Date, options?: Record<string, unknown>): KnowledgeData;
export function buildExplorerState(data: KnowledgeData, now: Date, options?: Record<string, unknown>): KnowledgeData;
export function createServer(options?: { dataDir?: string; staticDir?: string; now?: () => Date; dashboardUrl?: string }): import('node:http').Server;

export const DEMO_PATH: string;
export const SAFE_ID: RegExp;
export const STATUSES: string[];
export function workspacePath(arg?: string): string;
export function assetPath(dir: string, relative: string): string;
export function loadWorkspace(dir: string): KnowledgeData;
export function initWorkspace(dir: string, name?: string, url?: string): string;
export function migrateWorkspace(dir: string): KnowledgeData;
export function checkWorkspace(dir: string): KnowledgeData;
export function summary(data: KnowledgeData): KnowledgeData;
export function tasks(data: KnowledgeData): KnowledgeData[];
export function getFeature(dir: string, id: string): KnowledgeData;
export function applyObservation(dir: string, observation: KnowledgeData, options?: Record<string, unknown>): KnowledgeData;
export function exportDocs(dir: string, options?: { force?: boolean; check?: boolean }): KnowledgeData;
export function getWorkPacket(dir: string, options?: { contextId?: string; runId?: string }): KnowledgeData;
export function createDraft(packet: KnowledgeData, options?: { workspaceDir?: string; runId?: string }): KnowledgeData;
