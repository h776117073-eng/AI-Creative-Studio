import { RootState, ProjectState, TimelineState, WorkspaceState, UIState, AIState, UserState } from './store.js';
import { NodeId } from '@ai-creative-studio/core';

export type Selector<T> = (state: RootState) => T;

export const selectProject: Selector<ProjectState | null> = state => state.project;
export const selectProjectId: Selector<string | null> = state => state.project?.id ?? null;
export const selectProjectName: Selector<string> = state => state.project?.name ?? '';
export const selectSelectedNodes: Selector<NodeId[]> = state => state.project ? Array.from(state.project.selectedNodeIds) : [];
export const selectCurrentTime: Selector<number> = state => state.project?.currentTime ?? 0;
export const selectPlaybackState: Selector<'playing'|'paused'|'stopped'> = state => state.project?.playbackState ?? 'stopped';
export const selectCanvasZoom: Selector<number> = state => state.project?.zoom ?? 1;
export const selectCanvasPan: Selector<{x:number;y:number}> = state => state.project?.panOffset ?? {x:0,y:0};
export const selectTimeline: Selector<TimelineState> = state => state.timeline;
export const selectTracks: Selector<TimelineState['tracks']> = state => state.timeline.tracks;
export const selectTrackById = (trackId:string): Selector<TimelineState['tracks'][0]|undefined> => state => state.timeline.tracks.find(t=>t.id===trackId);
export const selectClips = (state:RootState) => state.timeline.tracks.flatMap(t=>t.clips);
export const selectClipById = (clipId:string) => (state:RootState) => state.timeline.tracks.flatMap(t=>t.clips).find(c=>c.id===clipId);
export const selectSelectedClips = (state:RootState) => state.timeline.tracks.flatMap(t=>t.clips).filter(c=>state.timeline.selectedClipIds.has(c.id));
export const selectDuration: Selector<number> = state => state.timeline.duration;
export const selectMarkers: Selector<TimelineState['markers']> = state => state.timeline.markers;
export const selectWorkspace: Selector<WorkspaceState> = state => state.workspace;
export const selectActiveWorkspace: Selector<WorkspaceState['activeWorkspace']> = state => state.workspace.activeWorkspace;
export const selectPanels: Selector<WorkspaceState['panels']> = state => state.workspace.panels;
export const selectVisiblePanels = (state:RootState) => state.workspace.panels.filter(p=>p.visible);
export const selectCollapsedState = (state:RootState) => ({sidebar:state.workspace.sidebarCollapsed,inspector:state.workspace.inspectorCollapsed});
export const selectUI: Selector<UIState> = state => state.ui;
export const selectIsLoading: Selector<boolean> = state => state.ui.isLoading;
export const selectActiveModal: Selector<string|null> = state => state.ui.activeModal;
export const selectNotifications: Selector<UIState['notifications']> = state => state.ui.notifications;
export const selectCommandPaletteOpen: Selector<boolean> = state => state.ui.commandPaletteOpen;
export const selectAssetBrowserOpen: Selector<boolean> = state => state.ui.assetBrowserOpen;
export const selectAI: Selector<AIState> = state => state.ai;
export const selectCommandHistory: Selector<AIState['commandHistory']> = state => state.ai.commandHistory;
export const selectCurrentAITask: Selector<AIState['currentTask']> = state => state.ai.currentTask;
export const selectAIAgents: Selector<AIState['agents']> = state => state.ai.agents;
export const selectUser: Selector<UserState|null> = state => state.user;
export const selectUserPreferences = (state:RootState) => state.user?.preferences ?? null;
export const selectTheme: Selector<'light'|'dark'|'system'> = state => state.user?.preferences.theme ?? 'system';
export const selectAutoSaveEnabled: Selector<boolean> = state => state.user?.preferences.autoSave ?? true;
export const selectCollaboration = (state:RootState) => state.collaboration;
export const selectCollaborators = (state:RootState) => state.collaboration.collaborators;
export const selectCursorPositions = (state:RootState) => state.collaboration.cursorPositions;

export function createMemoizedSelector<T,R>(selector:Selector<T>,transform:(value:T)=>R):Selector<R>{let lastValue:T|undefined;let lastResult!:R;return state=>{const current=selector(state);if(current!==lastValue){lastValue=current;lastResult=transform(current);}return lastResult;};}

type SelectorTuple = readonly Selector<any>[];
export function createSelector<T extends SelectorTuple,R>(selectors:T,combiner:(...args:{[K in keyof T]:ReturnType<T[K]>})=>R):Selector<R>{let lastArgs:any[]|undefined;let lastResult!:R;return state=>{const currentArgs=selectors.map(s=>s(state));const changed=!lastArgs||currentArgs.some((arg,i)=>arg!==lastArgs![i]);if(changed){lastArgs=currentArgs;lastResult=combiner(...currentArgs as any);}return lastResult;};}
