import React from 'react';
import { useParams } from 'react-router-dom';
import { VireonReferenceWorkspace } from './VireonReferenceWorkspace';

export type WorkspaceType = 'video'|'design'|'motion'|'audio'|'presentation'|'image'|'brand'|'ai'|'storyboard';
export type PanelType = 'assets'|'layers'|'properties'|'effects'|'animation'|'audio'|'ai'|'history'|'export'|'templates';
export interface PanelState { id:string; type:PanelType; visible:boolean; width:number; collapsed:boolean; }

export function Workspace() {
  const { projectId = 'new' } = useParams<{ projectId:string }>();
  return <div className="h-screen w-screen overflow-hidden bg-[#080a0f]"><VireonReferenceWorkspace projectId={projectId} /></div>;
}
