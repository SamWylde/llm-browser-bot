const fs = require('fs');
const path = require('path');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

// Copy .yaml files from src to dist
const srcDir = path.join(__dirname, '../src');
const distDir = path.join(__dirname, '../dist');

fs.readdirSync(srcDir).forEach(file => {
    if (file.endsWith('.yaml')) {
        fs.copyFileSync(
            path.join(srcDir, file),
            path.join(distDir, file)
        );
        console.log(`Copied ${file} to dist/`);
    }
});
