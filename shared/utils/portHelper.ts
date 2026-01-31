/**
 * Port Helper Utilities
 * Handles port validation, conflict detection, and error handling
 */

import logger from "../config/logger";
import net from "net";

/**
 * Check if a port is available
 */
export const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.listen(port, () => {
            server.once('close', () => {
                resolve(true);
            });
            server.close();
        });
        
        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};

/**
 * Get port from environment with validation and conflict detection
 */
export const getServicePort = async (
    serviceName: string,
    envVarName: string,
    _defaultPort: number
): Promise<number> => {
    const envPort = process.env[envVarName] || process.env.PORT;

    if (!envPort) {
        const msg = `Missing ${envVarName}${envVarName !== 'PORT' ? ` (or PORT)` : ''} for ${serviceName}. Please set it in your .env`;
        logger.error(msg);
        throw new Error(msg);
    }

    const port = parseInt(envPort, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
        const msg = `Invalid port number ${envPort} for ${serviceName}. Please fix ${envVarName} in your .env`;
        logger.error(msg);
        throw new Error(msg);
    }

    const available = await isPortAvailable(port);
    if (!available) {
        const msg = `Port ${port} is already in use for ${serviceName}. ` +
            `Stop the other process or change ${envVarName} in .env`;
        logger.error(msg);
        throw new Error(msg);
    }

    logger.info(`Using port ${port} for ${serviceName} from ${process.env[envVarName] ? envVarName : 'PORT'}`);
    return port;
};

/**
 * Get port synchronously (for cases where async is not possible)
 * Still checks for conflicts but warns instead of throwing
 */
export const getServicePortSync = (
    serviceName: string,
    envVarName: string,
    _defaultPort: number
): number => {
    const envPort = process.env[envVarName] || process.env.PORT;

    if (!envPort) {
        const msg = `Missing ${envVarName}${envVarName !== 'PORT' ? ` (or PORT)` : ''} for ${serviceName}. Please set it in your .env`;
        logger.error(msg);
        throw new Error(msg);
    }

    const port = parseInt(envPort, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
        const msg = `Invalid port number ${envPort} for ${serviceName}. Please fix ${envVarName} in your .env`;
        logger.error(msg);
        throw new Error(msg);
    }

    if (process.env[envVarName]) {
        logger.debug(`Using port ${port} for ${serviceName} from ${envVarName}`);
    } else if (process.env.PORT) {
        logger.debug(`Using port ${port} for ${serviceName} from PORT`);
    }

    return port;
};

