/**
 * Mongoose Connection Singleton
 * 
 * CRITICAL: This module provides a single mongoose instance that MUST be used
 * by all models. This ensures:
 * 1. All models use the same mongoose instance that gets connected
 * 2. Models are registered on the connected instance
 * 3. No race conditions between model registration and connection
 * 
 * Usage in models:
 *   import mongoose from '../config/mongoose';
 *   // CRITICAL: Use safe guard pattern to prevent OverwriteModelError during retries
 *   export const MyModel = mongoose.models.MyModel || mongoose.model('MyModel', MySchema);
 * 
 * Usage in repositories/services:
 *   import { getMongoConnection } from '../config/database';
 *   await getMongoConnection(); // Ensures connection before queries
 */

import mongoose from 'mongoose';

// CRITICAL: Disable Mongoose buffering at module load time
// This MUST be done before any models are imported/defined
// With bufferCommands=false, queries fail immediately if connection isn't ready
// This forces us to ensure connection is ready before queries
mongoose.set('bufferCommands', false);

// Export the mongoose instance
// All models MUST import from this module, not from 'mongoose' directly
export default mongoose;
