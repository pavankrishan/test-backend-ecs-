/**
 * Pricing Calculation Utilities
 * Handles session-based pricing with group discounts and hybrid model adjustments
 */

export type SessionCount = 10 | 20 | 30;
export type GroupSize = 1 | 2 | 3;
export type LearningMode = 'home' | 'hybrid'; // All are home tutor only, hybrid is half home/half online

export interface SessionPricingConfig {
  sessionCount: SessionCount;
  groupSize: GroupSize;
  learningMode: LearningMode;
}

export interface PricingResult {
  basePricePerSession: number;
  totalSessions: number;
  subtotal: number;
  groupDiscount: number;
  hybridAdjustment: number;
  finalPrice: number;
  pricePerSession: number;
  currency: string;
}

// Base pricing per session count
const SESSION_PRICING: Record<SessionCount, number> = {
  10: 200, // ₹200/session
  20: 150, // ₹150/session
  30: 120, // ₹120/session (discounted)
};

// Group discount percentages
const GROUP_DISCOUNTS: Record<GroupSize, number> = {
  1: 0,    // No discount for 1-on-1
  2: 10,   // 10% discount per student for 1-on-2
  3: 20,   // 20% discount per student for 1-on-3
};

// Hybrid model adjustment (10% increase)
const HYBRID_ADJUSTMENT = 10;

/**
 * Calculate pricing for session-based booking
 */
export function calculateSessionPricing(config: SessionPricingConfig): PricingResult {
  const { sessionCount, groupSize, learningMode } = config;

  // Base price per session based on session count
  const basePricePerSession = SESSION_PRICING[sessionCount];

  // Calculate subtotal (base price × number of sessions)
  const subtotal = basePricePerSession * sessionCount;

  // Apply group discount
  const groupDiscountPercent = GROUP_DISCOUNTS[groupSize];
  const groupDiscount = (subtotal * groupDiscountPercent) / 100;

  // Calculate price after group discount
  const priceAfterGroupDiscount = subtotal - groupDiscount;

  // Apply hybrid adjustment if applicable
  let hybridAdjustment = 0;
  if (learningMode === 'hybrid') {
    hybridAdjustment = (priceAfterGroupDiscount * HYBRID_ADJUSTMENT) / 100;
  }

  // Final price
  const finalPrice = priceAfterGroupDiscount + hybridAdjustment;

  // Price per session after all adjustments
  const pricePerSession = finalPrice / sessionCount;

  return {
    basePricePerSession,
    totalSessions: sessionCount,
    subtotal,
    groupDiscount,
    hybridAdjustment,
    finalPrice: Math.round(finalPrice),
    pricePerSession: Math.round(pricePerSession * 100) / 100, // Round to 2 decimal places
    currency: 'INR',
  };
}

/**
 * Convert price in rupees to paise (cents) for payment gateway
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert paise (cents) to rupees
 */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Get pricing breakdown description
 */
export function getPricingDescription(config: SessionPricingConfig, pricing: PricingResult): string {
  const { sessionCount, groupSize, learningMode } = config;
  
  let description = `${sessionCount} sessions × ₹${pricing.basePricePerSession}/session`;
  
  if (groupSize > 1) {
    description += ` (${GROUP_DISCOUNTS[groupSize]}% group discount)`;
  }
  
  if (learningMode === 'hybrid') {
    description += ` (+${HYBRID_ADJUSTMENT}% hybrid adjustment)`;
  }
  
  return description;
}

