/**
 * Content Filter Utility
 * Blocks personal contact information from being shared in doubts/replies
 */

const PHONE_PATTERNS = [
  /\b\d{10}\b/g, // 10 digit phone numbers
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // Formatted phone numbers
  /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // International format
];

const EMAIL_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Standard email
];

const SOCIAL_MEDIA_PATTERNS = [
  /(?:instagram|ig|insta)[:\s]+@?[\w.]+/gi, // Require space/colon after keyword
  /(?:facebook|fb)[:\s]+[\w.]+/gi, // Require space/colon after keyword (prevents matching "fba" in words)
  /(?:twitter|tweet)[:\s]+@?[\w.]+/gi, // Require space/colon after keyword
  /(?:linkedin)[:\s]+[\w.]+/gi, // Require space/colon after keyword
  /(?:snapchat|snap)[:\s]+[\w.]+/gi, // Require space/colon after keyword
  /(?:whatsapp|wa)[:\s]+[\d+\s-]+/gi, // Require space/colon after keyword
  /(?:telegram|tg)[:\s]+@?[\w.]+/gi, // Require space/colon after keyword
];

const URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?(?:instagram|facebook|twitter|linkedin|snapchat|whatsapp|telegram)\.com\/[\w.]+/gi,
];

export interface FilterResult {
  filtered: string;
  violations: string[];
}

/**
 * Filters personal contact information from text content
 */
export function filterPersonalInfo(content: string): FilterResult {
  let filtered = content;
  const violations: string[] = [];

  // Check for phone numbers
  for (const pattern of PHONE_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        violations.push(`Phone number detected: ${match}`);
        filtered = filtered.replace(match, '[Phone number removed]');
      });
    }
  }

  // Check for email addresses
  for (const pattern of EMAIL_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        violations.push(`Email address detected: ${match}`);
        filtered = filtered.replace(match, '[Email removed]');
      });
    }
  }

  // Check for social media handles
  for (const pattern of SOCIAL_MEDIA_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        violations.push(`Social media handle detected: ${match}`);
        filtered = filtered.replace(match, '[Social media handle removed]');
      });
    }
  }

  // Check for social media URLs
  for (const pattern of URL_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        violations.push(`Social media URL detected: ${match}`);
        filtered = filtered.replace(match, '[Social media URL removed]');
      });
    }
  }

  return {
    filtered,
    violations,
  };
}

/**
 * Validates that content doesn't contain personal contact information
 * Throws an error if violations are found
 */
export function validateNoPersonalInfo(content: string): void {
  const result = filterPersonalInfo(content);
  if (result.violations.length > 0) {
    throw new Error(
      `Content contains personal contact information. Please remove: ${result.violations.join(', ')}`,
    );
  }
}

