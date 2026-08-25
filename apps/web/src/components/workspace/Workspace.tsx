import React from 'react';
import { useParams } from 'react-router-dom';
import { MvpEditor } from '../mvp/MvpEditor';

export function Workspace() {
  const { projectId = 'new' } = useParams<{ projectId:string }>();
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0b0d12]">
      <MvpEditor projectId={projectId} />
    </div>
  );
}
