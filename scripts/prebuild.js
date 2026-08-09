/**
 * Run Python data processor before Next.js build so public/analysis.json exists.
 * Safe to run even if Python fails (dashboard will show "no data").
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const transcriptsDir = path.join(dataDir, 'transcripts');
const publicDir = path.join(root, 'public');

// Ensure public dir exists
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

try {
  execSync('python scripts/process_data.py', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATA_DIR: dataDir }
  });
} catch (e) {
  console.warn('Prebuild: process_data.py failed or no data yet. Run "npm run process" after adding data to data/transcripts/ and data/*.xlsx');
  // Write empty analysis so app doesn't 404
  const empty = {
    company: 'RH',
    generated_at: new Date().toISOString(),
    transcripts: [],
    summary: {},
    horizons_days: [7, 14, 21, 30]
  };
  fs.writeFileSync(path.join(publicDir, 'analysis.json'), JSON.stringify(empty, null, 2));
}
