export type MarketplaceItemCategory = "template" | "plugin" | "effect" | "preset" | "motion_graphic";
export type LicensingTier = "free" | "commercial" | "extended_enterprise";

export interface MarketplaceItem {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  description: string;
  category: MarketplaceItemCategory;
  priceUsd: number;
  rating: number;
  downloadsCount: number;
  previewUrl?: string;
  licensing: {
    tier: LicensingTier;
    terms: string;
  };
  supportedVersions: string[];
  isVerified: boolean;
  createdAt: string;
}

export interface ReviewEntry {
  id: string;
  itemId: string;
  reviewerName: string;
  rating: number; // 1 to 5 stars
  text: string;
  createdAt: string;
}

export interface CreatorLedger {
  creatorId: string;
  totalEarningsUsd: number;
  availableBalanceUsd: number;
  platformSplitRatio: number; // e.g. 0.85 means creator keeps 85%
  salesHistory: Array<{
    itemId: string;
    buyerName: string;
    purchasedPriceUsd: number;
    payoutUsd: number;
    timestamp: string;
  }>;
}

export class MarketplacePlatform {
  private static instance: MarketplacePlatform | null = null;
  private catalog: Map<string, MarketplaceItem> = new Map();
  private reviews: Map<string, ReviewEntry[]> = new Map(); // Key is itemId
  private ledgers: Map<string, CreatorLedger> = new Map();

  private constructor() {
    this.seedMarketplace();
  }

  public static getInstance(): MarketplacePlatform {
    if (!MarketplacePlatform.instance) {
      MarketplacePlatform.instance = new MarketplacePlatform();
    }
    return MarketplacePlatform.instance;
  }

  private seedMarketplace(): void {
    const demoItems: MarketplaceItem[] = [
      {
        id: "mkt_item_temp_01",
        creatorId: "usr_creator_900",
        creatorName: "Tokyo GFX Lab",
        title: "Cyberpunk Vertical Tiktok Ad Template",
        description: "An asset-rich 9:16 template syncing high speed Glitch filters and typography blocks with electronic drops.",
        category: "template",
        priceUsd: 12.50,
        rating: 4.9,
        downloadsCount: 1420,
        licensing: { tier: "commercial", terms: "Royalty free usage in paid social advertisements" },
        supportedVersions: ["v2.0", "v2.5"],
        isVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "mkt_item_plug_02",
        creatorId: "usr_creator_901",
        creatorName: "AI Tooling Corp",
        title: "Smart Auto-Slicing Sound Matcher",
        description: "Integrates with standard audio tracks to align camera cuts directly with beat fluctuations.",
        category: "plugin",
        priceUsd: 29.00,
        rating: 4.7,
        downloadsCount: 560,
        licensing: { tier: "extended_enterprise", terms: "Full lifetime commercial broadcast permission" },
        supportedVersions: ["v2.5"],
        isVerified: true,
        createdAt: new Date().toISOString(),
      },
    ];

    demoItems.forEach((item) => {
      this.catalog.set(item.id, item);
      
      // Initialize empty review streams
      this.reviews.set(item.id, [
        {
          id: `rev_${item.id}_1`,
          itemId: item.id,
          reviewerName: "John Doe",
          rating: 5,
          text: "Phenomenal layout, cut down editing times for client reels by 60%!",
          createdAt: new Date().toISOString(),
        }
      ]);
    });

    // Seed Ledger for Tokyo GFX Lab
    const tokyoLedger: CreatorLedger = {
      creatorId: "usr_creator_900",
      totalEarningsUsd: 17750.00,
      availableBalanceUsd: 4320.00,
      platformSplitRatio: 0.85, // Tokyo GFX takes 85%
      salesHistory: [
        {
          itemId: "mkt_item_temp_01",
          buyerName: "Creative Agency West",
          purchasedPriceUsd: 12.50,
          payoutUsd: 10.625,
          timestamp: new Date().toISOString(),
        }
      ],
    };

    this.ledgers.set("usr_creator_900", tokyoLedger);
  }

  public getCatalog(category?: MarketplaceItemCategory): MarketplaceItem[] {
    const items = Array.from(this.catalog.values());
    if (category) {
      return items.filter(item => item.category === category);
    }
    return items;
  }

  public getItem(id: string): MarketplaceItem | null {
    return this.catalog.get(id) || null;
  }

  /**
   * Publishes custom assets / plugins onto the platform
   */
  public publishItem(
    creatorId: string,
    creatorName: string,
    title: string,
    description: string,
    category: MarketplaceItemCategory,
    priceUsd: number,
    license: LicensingTier
  ): MarketplaceItem {
    const id = `mkt_item_${Date.now()}`;
    const newItem: MarketplaceItem = {
      id,
      creatorId,
      creatorName,
      title,
      description,
      category,
      priceUsd,
      rating: 5.0,
      downloadsCount: 0,
      licensing: {
        tier: license,
        terms: "Licensed under standard marketplace creator protection clauses",
      },
      supportedVersions: ["v2.5"],
      isVerified: false,
      createdAt: new Date().toISOString(),
    };

    this.catalog.set(id, newItem);
    return newItem;
  }

  /**
   * Records a purchase transaction and calculates platform/creator financial cuts
   */
  public purchaseItem(itemId: string, buyerName: string): boolean {
    const item = this.catalog.get(itemId);
    if (!item) return false;

    item.downloadsCount++;
    this.catalog.set(itemId, item);

    // Fetch or create creator's wallet/ledger
    let ledger = this.ledgers.get(item.creatorId);
    if (!ledger) {
      ledger = {
        creatorId: item.creatorId,
        totalEarningsUsd: 0,
        availableBalanceUsd: 0,
        platformSplitRatio: 0.80, // 80% default split
        salesHistory: [],
      };
    }

    const payout = item.priceUsd * ledger.platformSplitRatio;
    ledger.totalEarningsUsd += item.priceUsd;
    ledger.availableBalanceUsd += payout;
    ledger.salesHistory.push({
      itemId,
      buyerName,
      purchasedPriceUsd: item.priceUsd,
      payoutUsd: Number(payout.toFixed(4)),
      timestamp: new Date().toISOString(),
    });

    this.ledgers.set(item.creatorId, ledger);
    console.log(`[Marketplace] Transaction logged. Item "${item.title}" sold to "${buyerName}". Payout to Creator "${item.creatorName}": $${payout.toFixed(2)}.`);
    return true;
  }

  public addReview(itemId: string, reviewerName: string, rating: number, text: string): ReviewEntry {
    const list = this.reviews.get(itemId) || [];
    const review: ReviewEntry = {
      id: `rev_${Date.now()}`,
      itemId,
      reviewerName,
      rating: Math.max(1, Math.min(5, rating)),
      text,
      createdAt: new Date().toISOString(),
    };

    list.push(review);
    this.reviews.set(itemId, list);

    // Recalculate average rating
    const item = this.catalog.get(itemId);
    if (item) {
      const totalStars = list.reduce((accum, r) => accum + r.rating, 0);
      item.rating = Number((totalStars / list.length).toFixed(1));
      this.catalog.set(itemId, item);
    }

    return review;
  }

  public getReviews(itemId: string): ReviewEntry[] {
    return this.reviews.get(itemId) || [];
  }

  public getCreatorLedger(creatorId: string): CreatorLedger | null {
    return this.ledgers.get(creatorId) || null;
  }

  public clearAll(): void {
    this.catalog.clear();
    this.reviews.clear();
    this.ledgers.clear();
  }
}
