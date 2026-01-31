import mongoose, { ConnectOptions } from 'mongoose';
import { connectMongo, disconnectMongo } from '@kodingcaravan/shared/databases/mongo/connection';

let connection: typeof mongoose | null = null;

export async function initMongo(overrides: Partial<ConnectOptions> = {}): Promise<typeof mongoose> {
  if (connection) {
    return connection;
  }

  connection = await connectMongo({
    appName: 'analytics-service',
    maxPoolSize: 20,
    ...overrides,
  });

  // eslint-disable-next-line no-console
  console.log('✅ MongoDB connected for Analytics Service');
  return connection;
}

export function getMongo(): typeof mongoose {
  if (!connection) {
    throw new Error('MongoDB not initialized. Call initMongo() first.');
  }
  return connection;
}

export async function closeMongo(): Promise<void> {
  if (!connection) {
    return;
  }

  await disconnectMongo();
  connection = null;
  // eslint-disable-next-line no-console
  console.log('✅ MongoDB disconnected for Analytics Service');
}

