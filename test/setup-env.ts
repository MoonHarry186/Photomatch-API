import { config } from 'dotenv';

config({ quiet: true });
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.EMAIL_ADAPTER = 'fake';
process.env.OAUTH_ADAPTER = 'fake';
process.env.PUSH_ADAPTER = 'fake';
