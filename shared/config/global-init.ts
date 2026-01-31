// shared/config/global-init.ts

import "./global-env"; // Load .env file (safe - no validation at import time)
import logger from "./logger";
import type { Logger } from "winston";

// Declare global logger type
declare global {
    var logger: Logger;
}

// Attach logger globally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).logger = logger;

// Only log if not in build context (NODE_ENV might not be set during build)
// This prevents build failures if logger tries to access env vars
if (process.env.NODE_ENV !== undefined) {
    logger.info("✅ Global logger initialized");
}
