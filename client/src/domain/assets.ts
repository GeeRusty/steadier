import type { Asset, AssetCondition, AssetWearLog, Workspace } from "./types";

export const ASSET_CONDITIONS: AssetCondition[] = [
  "unknown",
  "good",
  "fair",
  "worn",
  "needs-attention",
];
export const MAX_ASSETS = 300;
export const MAX_ASSET_LOGS_PER_ASSET = 500;
export const MAX_ASSET_LOGS_TOTAL = 5000;
export const MAX_ASSET_NAME_LENGTH = 120;
export const MAX_ASSET_CATEGORY_LENGTH = 80;
export const MAX_ASSET_LOG_TEXT_LENGTH = 2000;

export function isAssetCondition(value: unknown): value is AssetCondition {
  return (
    typeof value === "string" &&
    ASSET_CONDITIONS.includes(value as AssetCondition)
  );
}

function latestCondition(
  logs: AssetWearLog[],
  fallback: AssetCondition
): AssetCondition {
  return (
    [...logs].sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
    )[0]?.condition ?? fallback
  );
}

function withAsset(
  workspace: Workspace,
  assetId: string,
  update: (asset: Asset) => Asset
): Workspace {
  const assets = workspace.assets ?? [];
  let changed = false;
  const next = assets.map(asset => {
    if (asset.id !== assetId) return asset;
    const updated = update(asset);
    changed ||= updated !== asset;
    return updated;
  });
  return changed ? { ...workspace, assets: next } : workspace;
}

export function addAssetRecord(workspace: Workspace, asset: Asset): Workspace {
  const assets = workspace.assets ?? [];
  if (
    assets.length >= MAX_ASSETS ||
    assets.some(item => item.id === asset.id) ||
    !asset.name.trim() ||
    asset.name.length > MAX_ASSET_NAME_LENGTH ||
    asset.category.length > MAX_ASSET_CATEGORY_LENGTH
  ) {
    return workspace;
  }
  return { ...workspace, assets: [...assets, asset] };
}

export function updateAssetRecord(
  workspace: Workspace,
  assetId: string,
  patch: Pick<Asset, "name" | "category" | "projectId">,
  at: string
): Workspace {
  const name = patch.name.trim();
  const category = patch.category.trim();
  if (
    !name ||
    name.length > MAX_ASSET_NAME_LENGTH ||
    category.length > MAX_ASSET_CATEGORY_LENGTH
  ) {
    return workspace;
  }
  return withAsset(workspace, assetId, asset => {
    if (
      asset.name === name &&
      asset.category === category &&
      asset.projectId === patch.projectId
    ) {
      return asset;
    }
    return {
      ...asset,
      name,
      category,
      projectId: patch.projectId,
      updatedAt: at,
    };
  });
}

export function setAssetStatus(
  workspace: Workspace,
  assetId: string,
  status: Asset["status"],
  at: string
): Workspace {
  return withAsset(workspace, assetId, asset =>
    asset.status === status ? asset : { ...asset, status, updatedAt: at }
  );
}

export function removeAssetRecord(
  workspace: Workspace,
  assetId: string
): Workspace {
  const assets = workspace.assets ?? [];
  const next = assets.filter(asset => asset.id !== assetId);
  return next.length === assets.length
    ? workspace
    : { ...workspace, assets: next };
}

export function addAssetWearLog(
  workspace: Workspace,
  assetId: string,
  log: AssetWearLog
): Workspace {
  const assets = workspace.assets ?? [];
  const asset = assets.find(item => item.id === assetId);
  const totalLogs = assets.reduce(
    (total, item) => total + item.wearLogs.length,
    0
  );
  if (
    !asset ||
    asset.wearLogs.length >= MAX_ASSET_LOGS_PER_ASSET ||
    totalLogs >= MAX_ASSET_LOGS_TOTAL ||
    asset.wearLogs.some(item => item.id === log.id) ||
    !log.text.trim() ||
    log.text.length > MAX_ASSET_LOG_TEXT_LENGTH
  ) {
    return workspace;
  }
  return withAsset(workspace, assetId, current => {
    const wearLogs = [...current.wearLogs, log];
    return {
      ...current,
      wearLogs,
      condition: latestCondition(wearLogs, current.condition),
      updatedAt: log.updatedAt,
    };
  });
}

export function updateAssetWearLog(
  workspace: Workspace,
  assetId: string,
  logId: string,
  patch: Pick<AssetWearLog, "date" | "condition" | "text">,
  at: string
): Workspace {
  const text = patch.text.trim();
  if (!text || text.length > MAX_ASSET_LOG_TEXT_LENGTH) return workspace;
  return withAsset(workspace, assetId, asset => {
    const current = asset.wearLogs.find(log => log.id === logId);
    if (!current) return asset;
    const wearLogs = asset.wearLogs.map(log =>
      log.id === logId ? { ...log, ...patch, text, updatedAt: at } : log
    );
    return {
      ...asset,
      wearLogs,
      condition: latestCondition(wearLogs, asset.condition),
      updatedAt: at,
    };
  });
}

export function removeAssetWearLog(
  workspace: Workspace,
  assetId: string,
  logId: string,
  at: string
): Workspace {
  return withAsset(workspace, assetId, asset => {
    const wearLogs = asset.wearLogs.filter(log => log.id !== logId);
    if (wearLogs.length === asset.wearLogs.length) return asset;
    return {
      ...asset,
      wearLogs,
      condition: latestCondition(wearLogs, "unknown"),
      updatedAt: at,
    };
  });
}

/**
 * Links a task created through a separate owner-confirmed draft to one stable
 * wear-log occurrence. It never completes, retires or deletes the source.
 */
export function linkAssetWearLogTask(
  workspace: Workspace,
  assetId: string,
  logId: string,
  taskId: string,
  at: string
): Workspace {
  if (!workspace.tasks.some(task => task.id === taskId)) return workspace;
  return withAsset(workspace, assetId, asset => {
    const log = asset.wearLogs.find(item => item.id === logId);
    if (
      !log ||
      (log.taskId &&
        log.taskId !== taskId &&
        workspace.tasks.some(task => task.id === log.taskId))
    ) {
      return asset;
    }
    if (log.taskId === taskId) return asset;
    return {
      ...asset,
      wearLogs: asset.wearLogs.map(item =>
        item.id === logId ? { ...item, taskId, updatedAt: at } : item
      ),
      updatedAt: at,
    };
  });
}

/** Clear references when a linked Project or Task is removed. */
export function pruneAssetLinks(workspace: Workspace): Workspace {
  if (!workspace.assets?.length) return workspace;
  const projectIds = new Set(workspace.projects.map(project => project.id));
  const taskIds = new Set(workspace.tasks.map(task => task.id));
  let changed = false;
  const assets = workspace.assets.map(asset => {
    const projectId =
      asset.projectId && projectIds.has(asset.projectId)
        ? asset.projectId
        : null;
    const wearLogs = asset.wearLogs.map(log => {
      const taskId = log.taskId && taskIds.has(log.taskId) ? log.taskId : null;
      if (taskId !== log.taskId) changed = true;
      return taskId === log.taskId ? log : { ...log, taskId };
    });
    if (projectId !== asset.projectId) changed = true;
    return projectId === asset.projectId &&
      wearLogs.every((log, index) => log === asset.wearLogs[index])
      ? asset
      : { ...asset, projectId, wearLogs };
  });
  return changed ? { ...workspace, assets } : workspace;
}
