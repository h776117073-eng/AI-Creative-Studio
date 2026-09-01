import { BaseEngine, EngineConfigSchema, ProjectGraph, ProjectId, EventBus, globalEventBus, IEvent } from '@ai-creative-studio/core';
import { z } from 'zod';

const CreativeEngineConfigSchema=EngineConfigSchema.extend({maxProjects:z.number().optional().default(10),autoSaveInterval:z.number().optional().default(30000)});
type CreativeEngineConfig=z.infer<typeof CreativeEngineConfigSchema>;
export interface IProjectInfo{id:ProjectId;name:string;createdAt:number;updatedAt:number;type:'video'|'design'|'audio'|'presentation'|'image'|'3d'|'animation';resolution:{width:number;height:number};frameRate:number;duration:number}

type ProjectEvent=IEvent&{payload?:{projectId?:ProjectId;data?:unknown;path?:string}};

export class CreativeEngine extends BaseEngine{
 private projects=new Map<ProjectId,ProjectGraph>();private projectInfo=new Map<ProjectId,IProjectInfo>();private activeProjectId:ProjectId|null=null;private autoSaveTimer:NodeJS.Timeout|null=null;
 constructor(config:CreativeEngineConfig){super(CreativeEngineConfigSchema.parse(config));}
 protected async onInitialize():Promise<void>{this.eventBus.on('project:load' as any,(event:IEvent)=>this.handleProjectLoad(event as ProjectEvent));this.eventBus.on('project:save' as any,(event:IEvent)=>this.handleProjectSave(event as ProjectEvent));this.eventBus.on('project:close' as any,(event:IEvent)=>this.handleProjectClose(event as ProjectEvent));}
 protected override async onDestroy():Promise<void>{if(this.autoSaveTimer){clearInterval(this.autoSaveTimer);this.autoSaveTimer=null;}for(const projectId of this.projects.keys())this.closeProject(projectId);this.projects.clear();this.projectInfo.clear();}
 createProject(name:string,type:IProjectInfo['type'],options:{resolution?:{width:number;height:number};frameRate?:number;duration?:number}={}):ProjectId{const projectId=crypto.randomUUID() as ProjectId;const graph=new ProjectGraph(projectId);graph.addNode('project',{name,inputs:{type,...options}});const now=Date.now();const info:IProjectInfo={id:projectId,name,createdAt:now,updatedAt:now,type,resolution:options.resolution??{width:1920,height:1080},frameRate:options.frameRate??30,duration:options.duration??0};this.projects.set(projectId,graph);this.projectInfo.set(projectId,info);if(!this.activeProjectId)this.activeProjectId=projectId;return projectId;}
 loadProject(projectId:ProjectId,data:unknown):void{if(this.projects.has(projectId))throw new Error(`Project ${projectId} already loaded`);const graph=ProjectGraph.deserialize(data as any);this.projects.set(projectId,graph);this.activeProjectId=projectId;}
 closeProject(projectId:ProjectId):void{const graph=this.projects.get(projectId);if(!graph)return;graph.clear();this.projects.delete(projectId);this.projectInfo.delete(projectId);if(this.activeProjectId===projectId)this.activeProjectId=this.projects.keys().next().value||null;}
 getProject(projectId:ProjectId):ProjectGraph|undefined{return this.projects.get(projectId)}getActiveProject():ProjectGraph|undefined{return this.activeProjectId?this.projects.get(this.activeProjectId):undefined}getActiveProjectId():ProjectId|undefined{return this.activeProjectId??undefined}getAllProjects():IProjectInfo[]{return Array.from(this.projectInfo.values())}getProjectInfo(projectId:ProjectId):IProjectInfo|undefined{return this.projectInfo.get(projectId)}
 updateProjectInfo(projectId:ProjectId,updates:Partial<IProjectInfo>):void{const info=this.projectInfo.get(projectId);if(info)Object.assign(info,updates,{updatedAt:Date.now()})}
 switchProject(projectId:ProjectId):void{if(!this.projects.has(projectId))throw new Error(`Project ${projectId} not found`);this.activeProjectId=projectId}
 private handleProjectLoad(event:ProjectEvent):void{const{projectId,data}=event.payload||{};if(projectId&&data)this.loadProject(projectId,data)}
 private handleProjectSave(event:ProjectEvent):void{const{projectId}=event.payload||{};if(projectId)this.projects.get(projectId)?.serialize()}
 private handleProjectClose(event:ProjectEvent):void{const{projectId}=event.payload||{};if(projectId)this.closeProject(projectId)}
 getCapabilities():string[]{return['project:create','project:load','project:save','project:close','project:switch','scene:create','scene:delete','layer:add','layer:delete','layer:reorder','effect:apply','effect:chain','filter:apply','mask:create']}
}
