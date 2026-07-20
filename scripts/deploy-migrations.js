const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required for migration deployment\n');
  process.exit(1);
}

run('npx', ['prisma', 'migrate', 'deploy']);
if (process.env.RUN_SEED === 'true') run('npm', ['run', 'seed']);
