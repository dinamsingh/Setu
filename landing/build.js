import fs from 'node:fs';
import path from 'node:path';

const dist = 'dist';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Copy index.html
fs.copyFileSync('index.html', path.join(dist, 'index.html'));

// Copy _headers
if (fs.existsSync('_headers')) {
  fs.copyFileSync('_headers', path.join(dist, '_headers'));
}

// Copy assets
if (fs.existsSync('assets')) {
  fs.cpSync('assets', path.join(dist, 'assets'), { recursive: true });
}

// Copy public contents if any
if (fs.existsSync('public')) {
  fs.cpSync('public', dist, { recursive: true });
}

console.log('Build completed successfully: all landing assets ready in dist/');
