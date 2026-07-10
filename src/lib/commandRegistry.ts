import { CommandDispatcher } from '../commands/CommandDispatcher';
import { EventBus } from '../events/EventBus';
import { ProjectService } from './projectService';
import { AssetService } from './assetService';
import { NotificationService, HistoryService, SettingsService, ExportService, AIService } from './services';
import type { Project, MediaAsset } from '../types';

const commandDispatcher = CommandDispatcher.getInstance();
const eventBus = EventBus.getInstance();

let initialized = false;

export function initializeCommandRegistry() {
  if (initialized) return;
  initialized = true;

  commandDispatcher.registerHandler('project:create', async (cmd) => {
    return ProjectService.createProject(cmd.payload);
  });

  commandDispatcher.registerHandler('project:delete', async (cmd) => {
    await ProjectService.deleteProject(cmd.payload.id);
    return { deleted: cmd.payload.id };
  });

  commandDispatcher.registerHandler('project:duplicate', async (cmd) => {
    return ProjectService.duplicateProject(cmd.payload.project);
  });

  commandDispatcher.registerHandler('project:update', async (cmd) => {
    await ProjectService.updateProject(cmd.payload.id, cmd.payload.updates);
    return { updated: cmd.payload.id };
  });

  commandDispatcher.registerHandler('project:togglePin', async (cmd) => {
    const project = cmd.payload.project as Project;
    await ProjectService.updateProject(project.id, { pinned: !project.pinned });
    return { toggled: project.id };
  });

  commandDispatcher.registerHandler('asset:import', async (cmd) => {
    return AssetService.importAsset(cmd.payload.file, cmd.payload.projectId);
  });

  commandDispatcher.registerHandler('asset:delete', async (cmd) => {
    await AssetService.deleteAsset(cmd.payload.id);
    return { deleted: cmd.payload.id };
  });

  commandDispatcher.registerHandler('ai:execute', async (cmd) => {
    return AIService.executeCommand(cmd.payload.query, cmd.payload.projectId);
  });

  commandDispatcher.registerHandler('export:create', async (cmd) => {
    return ExportService.create(cmd.payload.projectId, cmd.payload.format, cmd.payload.settings);
  });

  commandDispatcher.registerHandler('notification:markRead', async (cmd) => {
    NotificationService.markRead(cmd.payload.id);
    return { marked: cmd.payload.id };
  });

  commandDispatcher.registerHandler('notification:clearAll', async () => {
    NotificationService.clearAll();
    return { cleared: true };
  });

  commandDispatcher.registerHandler('history:add', async (cmd) => {
    return HistoryService.add(cmd.payload);
  });

  commandDispatcher.registerHandler('settings:update', async (cmd) => {
    await SettingsService.update(cmd.payload);
    return { updated: true };
  });

  commandDispatcher.registerHandler('undo', async () => {
    const result = await commandDispatcher.undo();
    eventBus.publish('undo:performed', { success: result }, 'CommandRegistry', { async: true });
    return { success: result };
  });

  commandDispatcher.registerHandler('redo', async () => {
    const result = await commandDispatcher.redo();
    eventBus.publish('redo:performed', { success: result }, 'CommandRegistry', { async: true });
    return { success: result };
  });
}
