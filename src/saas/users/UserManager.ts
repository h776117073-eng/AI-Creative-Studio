export type AccountTier = "free" | "creator" | "professional" | "team" | "enterprise";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  accountTier: AccountTier;
  createdAt: string;
}

export interface UserPreferences {
  theme: "dark" | "light" | "system";
  language: string; // e.g. "en", "es", "fr", "ja"
  region: string;   // e.g. "US", "EU", "JP"
  autoBackupEnabled: boolean;
  proxyPreviewsEnabled: boolean;
  notificationPreferences: {
    emails: boolean;
    push: boolean;
    teamActivity: boolean;
  };
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  sessionTimeoutMinutes: number;
  ipWhiteList: string[];
}

export class UserManager {
  private static instance: UserManager | null = null;
  private users: Map<string, UserProfile> = new Map();
  private userPreferences: Map<string, UserPreferences> = new Map();
  private securityPrefs: Map<string, SecuritySettings> = new Map();
  private activeUserSession: UserProfile | null = null;

  private constructor() {
    this.seedDemoUser();
  }

  public static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  private seedDemoUser(): void {
    const demoUser: UserProfile = {
      id: "usr_demo_101",
      email: "creator@creative.studio",
      displayName: "Alex Mercer",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
      accountTier: "professional",
      createdAt: new Date().toISOString(),
    };

    const demoPrefs: UserPreferences = {
      theme: "dark",
      language: "en",
      region: "US",
      autoBackupEnabled: true,
      proxyPreviewsEnabled: true,
      notificationPreferences: {
        emails: true,
        push: true,
        teamActivity: true,
      },
    };

    const demoSec: SecuritySettings = {
      twoFactorEnabled: false,
      sessionTimeoutMinutes: 60,
      ipWhiteList: [],
    };

    this.users.set(demoUser.id, demoUser);
    this.userPreferences.set(demoUser.id, demoPrefs);
    this.securityPrefs.set(demoUser.id, demoSec);
    this.activeUserSession = demoUser; // Automatically log in the demo workspace user
  }

  public registerUser(
    email: string,
    displayName: string,
    tier: AccountTier = "free"
  ): UserProfile {
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const profile: UserProfile = {
      id: userId,
      email,
      displayName,
      accountTier: tier,
      createdAt: new Date().toISOString(),
    };

    const prefs: UserPreferences = {
      theme: "dark",
      language: "en",
      region: "US",
      autoBackupEnabled: true,
      proxyPreviewsEnabled: false,
    notificationPreferences: {
        emails: true,
        push: false,
        teamActivity: true,
      },
    };

    const sec: SecuritySettings = {
      twoFactorEnabled: false,
      sessionTimeoutMinutes: 120,
      ipWhiteList: [],
    };

    this.users.set(userId, profile);
    this.userPreferences.set(userId, prefs);
    this.securityPrefs.set(userId, sec);

    return profile;
  }

  public getActiveUser(): UserProfile | null {
    return this.activeUserSession;
  }

  public getProfile(userId: string): UserProfile | null {
    return this.users.get(userId) || null;
  }

  public updateProfile(userId: string, delta: Partial<UserProfile>): boolean {
    const profile = this.users.get(userId);
    if (!profile) return false;

    const updated = { ...profile, ...delta };
    this.users.set(userId, updated);
    if (this.activeUserSession?.id === userId) {
      this.activeUserSession = updated;
    }
    return true;
  }

  public getPreferences(userId: string): UserPreferences | null {
    return this.userPreferences.get(userId) || null;
  }

  public updatePreferences(userId: string, prefs: Partial<UserPreferences>): boolean {
    const existing = this.userPreferences.get(userId);
    if (!existing) return false;

    this.userPreferences.set(userId, { ...existing, ...prefs });
    return true;
  }

  public getSecuritySettings(userId: string): SecuritySettings | null {
    return this.securityPrefs.get(userId) || null;
  }

  public updateSecuritySettings(userId: string, settings: Partial<SecuritySettings>): boolean {
    const existing = this.securityPrefs.get(userId);
    if (!existing) return false;

    this.securityPrefs.set(userId, { ...existing, ...settings });
    return true;
  }

  public logout(): void {
    this.activeUserSession = null;
  }

  public login(userId: string): boolean {
    const profile = this.users.get(userId);
    if (profile) {
      this.activeUserSession = profile;
      return true;
    }
    return false;
  }
}
