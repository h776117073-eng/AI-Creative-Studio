export type AppEventType =
  | 'project:open'
  | 'project:close'
  | 'project:created'
  | 'project:updated'
  | 'project:deleted'
  | 'project:duplicated'
  | 'media:import'
  | 'media:deleted'
  | 'timeline:updated'
  | 'playback:started'
  | 'playback:stopped'
  | 'playback:paused'
  | 'ai:command_executed'
  | 'ai:command_failed'
  | 'export:started'
  | 'export:completed'
  | 'export:failed'
  | 'asset:imported'
  | 'project:saved'
  | 'undo:performed'
  | 'redo:performed'
  | 'notification:added'
  | 'notification:read'
  | 'history:added'
  | 'settings:updated'
  | 'workspace:changed'
  | 'error:occurred'
  | 'auth:signedOut';

export interface AppEventPayload {
  type: AppEventType;
  payload: any;
  timestamp: number;
  sender: string;
}
