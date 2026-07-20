import { config } from 'dotenv';

config({ quiet: true });
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
