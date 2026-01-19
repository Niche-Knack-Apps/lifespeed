/**
 * esbuild configuration for At the Speed of Life
 *
 * Concatenates JS files in dependency order and minifies for production.
 *
 * Usage:
 *   npm run bundle        - Development build (no minification)
 *   npm run bundle:prod   - Production build (minified)
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isProduction = process.env.NODE_ENV === 'production';
const rendererDir = path.join(process.cwd(), 'renderer');
const jsDir = path.join(rendererDir, 'js');
const distDir = path.join(rendererDir, 'dist');

// Files in dependency order
const jsFiles = [
    'platform.js',
    'frontmatter.js',
    'entries.js',
    'search.js',
    'tags.js',
    'finder.js',
    'images.js',
    'files.js',
    'editor.js',
    'gestures.js',
    'settings.js',
    'about.js',
    'scroll-sync.js',
    'app.js'
];

async function build() {
    console.log(`[esbuild] Building ${isProduction ? 'production' : 'development'} bundle...`);

    // Ensure dist directory exists
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    // Read and concatenate all JS files
    let concatenated = `// At the Speed of Life Bundle - Built ${new Date().toISOString()}\n`;
    concatenated += `// ${isProduction ? 'Production' : 'Development'} build\n\n`;

    for (const file of jsFiles) {
        const filePath = path.join(jsDir, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            concatenated += `\n// ===== ${file} =====\n`;
            concatenated += content;
            concatenated += '\n';
        } else {
            console.warn(`[esbuild] Warning: ${file} not found`);
        }
    }

    // Write concatenated file
    const tempFile = path.join(distDir, 'app.concat.js');
    fs.writeFileSync(tempFile, concatenated);

    // Use esbuild to transform/minify
    const result = await esbuild.build({
        entryPoints: [tempFile],
        outfile: path.join(distDir, 'app.bundle.js'),
        bundle: false,
        minify: isProduction,
        sourcemap: true,
        target: ['chrome120'],
        platform: 'browser',
        format: 'iife',
        legalComments: isProduction ? 'none' : 'inline',
        logLevel: 'info',
    });

    // Clean up temp file
    fs.unlinkSync(tempFile);

    // Get file sizes
    const bundlePath = path.join(distDir, 'app.bundle.js');
    const stats = fs.statSync(bundlePath);
    const sizeKB = (stats.size / 1024).toFixed(2);

    console.log(`[esbuild] Bundle created: dist/app.bundle.js (${sizeKB} KB)`);

    if (result.errors.length > 0) {
        console.error('[esbuild] Errors:', result.errors);
    }
    if (result.warnings.length > 0) {
        console.warn('[esbuild] Warnings:', result.warnings);
    }

    return result;
}

build().catch((err) => {
    console.error('[esbuild] Build failed:', err);
    process.exit(1);
});
