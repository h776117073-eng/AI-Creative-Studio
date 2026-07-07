import WorkspaceManager from "../ui/editor/WorkspaceManager";
import { PageId } from "../types";

interface WorkspaceProps {
  onNavigate: (page: PageId) => void;
  projectName: string;
}

export default function Workspace({ onNavigate, projectName }: WorkspaceProps) {
  return (
    <WorkspaceManager onNavigate={onNavigate} projectName={projectName} />
  );
}

