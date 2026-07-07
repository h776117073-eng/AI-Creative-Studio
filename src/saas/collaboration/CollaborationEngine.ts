export type UserRole = "owner" | "admin" | "editor" | "reviewer";

export interface TeamMember {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  members: TeamMember[];
}

export interface LiveCursor {
  userId: string;
  userName: string;
  x: number;
  y: number;
  activeTrackId?: string;
  timestamp: number;
}

export interface ProjectComment {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  text: string;
  timelineTimeSec: number; // Linked directly to precise frame timing
  resolved: boolean;
  createdAt: string;
}

export interface ProjectHistoryState {
  id: string;
  projectId: string;
  timestamp: number;
  authorId: string;
  authorName: string;
  description: string;
  changesDeltaHex: string; // state change hash representing action delta
}

export class CollaborationEngine {
  private static instance: CollaborationEngine | null = null;
  private teams: Map<string, Team> = new Map();
  private projectComments: Map<string, ProjectComment[]> = new Map();
  private projectHistory: Map<string, ProjectHistoryState[]> = new Map();
  private liveCursors: Map<string, LiveCursor[]> = new Map(); // Key is projectId

  private constructor() {
    this.seedDemoTeam();
  }

  public static getInstance(): CollaborationEngine {
    if (!CollaborationEngine.instance) {
      CollaborationEngine.instance = new CollaborationEngine();
    }
    return CollaborationEngine.instance;
  }

  private seedDemoTeam(): void {
    const demoTeam: Team = {
      id: "team_demo_202",
      name: "Nebula Advertising Agency",
      ownerId: "usr_demo_101",
      members: [
        { userId: "usr_demo_101", email: "creator@creative.studio", displayName: "Alex Mercer", role: "owner", joinedAt: new Date().toISOString() },
        { userId: "usr_collab_222", email: "editor1@nebula.agency", displayName: "Sarah Chen", role: "editor", joinedAt: new Date().toISOString() },
        { userId: "usr_collab_333", email: "director@nebula.agency", displayName: "Marcus Aurelius", role: "reviewer", joinedAt: new Date().toISOString() },
      ],
    };

    this.teams.set(demoTeam.id, demoTeam);
  }

  public createTeam(name: string, ownerId: string): Team {
    const teamId = `team_${Date.now()}`;
    const newTeam: Team = {
      id: teamId,
      name,
      ownerId,
      members: [
        {
          userId: ownerId,
          email: "owner@team.com",
          displayName: "Team Owner",
          role: "owner",
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    this.teams.set(teamId, newTeam);
    return newTeam;
  }

  public inviteMember(teamId: string, email: string, displayName: string, role: UserRole): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    const newMemberId = `usr_invited_${Math.random().toString(36).substring(2, 6)}`;
    team.members.push({
      userId: newMemberId,
      email,
      displayName,
      role,
      joinedAt: new Date().toISOString(),
    });

    this.teams.set(teamId, team);
    return true;
  }

  public getTeamByUserId(userId: string): Team | null {
    for (const team of this.teams.values()) {
      if (team.members.some(m => m.userId === userId)) {
        return team;
      }
    }
    return null;
  }

  /**
   * Safe authorization checking based on user workspace assignments
   */
  public hasPermission(userId: string, teamId: string, action: "edit" | "export" | "admin" | "comment"): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    const member = team.members.find(m => m.userId === userId);
    if (!member) return false;

    if (member.role === "owner" || member.role === "admin") return true;
    if (member.role === "editor") return action !== "admin";
    if (member.role === "reviewer") return action === "comment";

    return false;
  }

  /**
   * Broadcast/cache live cursor movements of designers on the same timeline
   */
  public updateCursorPosition(projectId: string, userId: string, userName: string, x: number, y: number, trackId?: string): void {
    const active = this.liveCursors.get(projectId) || [];
    const filtered = active.filter(c => c.userId !== userId);
    
    filtered.push({
      userId,
      userName,
      x,
      y,
      activeTrackId: trackId,
      timestamp: Date.now(),
    });

    // Automatically expire cursors older than 15 seconds to prevent memory bloating
    const activeThreshold = Date.now() - 15000;
    const finalCursors = filtered.filter(c => c.timestamp > activeThreshold);

    this.liveCursors.set(projectId, finalCursors);
  }

  public getActiveCursors(projectId: string): LiveCursor[] {
    return this.liveCursors.get(projectId) || [];
  }

  /**
   * Synchronized Timeline Comments (Frame-accurate reviews)
   */
  public addComment(projectId: string, userId: string, userName: string, text: string, timeSec: number): ProjectComment {
    const comments = this.projectComments.get(projectId) || [];
    const newComment: ProjectComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      projectId,
      userId,
      userName,
      text,
      timelineTimeSec: timeSec,
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    comments.push(newComment);
    this.projectComments.set(projectId, comments);
    return newComment;
  }

  public resolveComment(projectId: string, commentId: string): boolean {
    const comments = this.projectComments.get(projectId) || [];
    const comment = comments.find(c => c.id === commentId);
    if (comment) {
      comment.resolved = true;
      this.projectComments.set(projectId, comments);
      return true;
    }
    return false;
  }

  public getComments(projectId: string): ProjectComment[] {
    return this.projectComments.get(projectId) || [];
  }

  /**
   * Tracking atomic track and effect commits for rollback
   */
  public commitVersionState(projectId: string, authorId: string, authorName: string, description: string, deltaHex: string): ProjectHistoryState {
    const history = this.projectHistory.get(projectId) || [];
    const version: ProjectHistoryState = {
      id: `v_${Date.now()}`,
      projectId,
      timestamp: Date.now(),
      authorId,
      authorName,
      description,
      changesDeltaHex: deltaHex,
    };

    history.push(version);
    this.projectHistory.set(projectId, history);
    return version;
  }

  public getVersionHistory(projectId: string): ProjectHistoryState[] {
    return this.projectHistory.get(projectId) || [];
  }

  public clear(): void {
    this.projectComments.clear();
    this.projectHistory.clear();
    this.liveCursors.clear();
  }
}
