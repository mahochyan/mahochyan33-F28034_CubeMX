const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const required = [
  'index.html',
  'assets/app.css',
  'src/app.js',
  'src/store.js',
  'src/core/project_config.js',
  'src/core/constraint_checker.js',
  'src/core/codegen.js',
  'src/core/export_zip.js',
  'src/devices/TMS320F28034/pinmux_golden.json',
  'src/devices/TMS320F28034/packages/pnt80.json',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(dist, relative))) {
    throw new Error(`dist is missing ${relative}`);
  }
}
const forbiddenFiles = ['app.py', 'Dockerfile', 'docker-compose.yml', 'requirements.txt'];
for (const name of forbiddenFiles) {
  if (fs.existsSync(path.join(dist, name))) {
    throw new Error(`dist must not contain ${name}`);
  }
}
const golden = JSON.parse(fs.readFileSync(
  path.join(dist, 'src/devices/TMS320F28034/pinmux_golden.json'), 'utf8'));
if (golden.valid_option_count !== 127 || golden.options.length !== 127) {
  throw new Error(`unexpected MUX golden count: ${golden.valid_option_count}`);
}
console.log(`dist acceptance passed: ${required.length} required artifacts, MUX 127/127`);
