export type NotificationCategory = "team_invite" | "render_complete" | "comment_received" | "marketplace_sale" | "system_alert";

export interface SaaSNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  category: NotificationCategory;
  isRead: boolean;
  linkUrl?: string;
  createdAt: string;
}

export class NotificationSystem {
  private static instance: NotificationSystem | null = null;
  private notifications: Map<string, SaaSNotification[]> = new Map(); // Key is userId

  private constructor() {}

  public static getInstance(): NotificationSystem {
    if (!NotificationSystem.instance) {
      NotificationSystem.instance = new NotificationSystem();
    }
    return NotificationSystem.instance;
  }

  public getNotifications(userId: string): SaaSNotification[] {
    return this.notifications.get(userId) || [];
  }

  /**
   * Pushes high priority notifications into the user alert deck
   */
  public pushNotification(
    userId: string,
    title: string,
    message: string,
    category: NotificationCategory,
    linkUrl?: string
  ): SaaSNotification {
    const list = this.notifications.get(userId) || [];
    
    const notif: SaaSNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      userId,
      title,
      message,
      category,
      isRead: false,
      linkUrl,
      createdAt: new Date().toISOString(),
    };

    list.unshift(notif); // Push to the top of the feed

    // Cap the notification history to 200 items to conserve browser memory
    if (list.length > 200) {
      list.pop();
    }

    this.notifications.set(userId, list);
    console.log(`[NotificationSystem] Alert dispatched to user "${userId}": [${category.toUpperCase()}] ${title} - ${message}`);
    return notif;
  }

  public markAsRead(userId: string, notificationId: string): boolean {
    const list = this.notifications.get(userId) || [];
    const notif = list.find(n => n.id === notificationId);
    if (notif) {
      notif.isRead = true;
      this.notifications.set(userId, list);
      return true;
    }
    return false;
  }

  public markAllAsRead(userId: string): void {
    const list = this.notifications.get(userId) || [];
    list.forEach(n => n.isRead = true);
    this.notifications.set(userId, list);
  }

  public clearNotifications(userId: string): void {
    this.notifications.set(userId, []);
  }

  public clearAll(): void {
    this.notifications.clear();
  }
}
