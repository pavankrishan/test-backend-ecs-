import 'dotenv/config';

async function main(): Promise<void> {
	const { getRedisClient, disconnectRedis } = await import(
		'../shared/databases/redis/connection'
	);
	const client = getRedisClient();
	try {
		const pong = await client.ping();
		console.log('Redis reachable:', pong);
		process.exitCode = 0;
	} catch (error) {
		console.error('Redis connectivity check failed:', error);
		process.exitCode = 2;
	} finally {
		await disconnectRedis();
	}
}

main();

