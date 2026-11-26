// 公開用フォルダ(_site)のファイルにバージョンを付ける(GitHub Actions のデプロイで実行)
//  - JS の相対 import と index.html の css/js 参照に ?v=<版> を付け、古いファイルと新しいファイルが混ざらないようにする
//  - version.json を書き出し、開いている画面が新しい版に気づけるようにする
// 使い方: node scripts/stamp-version.mjs _site <版>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) {
  console.error('usage: node scripts/stamp-version.mjs <dir> <version>');
  process.exit(1);
}
const v = encodeURIComponent(version);

function walk(d) {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let count = 0;
for (const file of walk(join(dir, 'js'))) {
  if (extname(file) !== '.js') continue;
  const src = readFileSync(file, 'utf8');
  // from './x.js' / import('./x.js') / import './x.js'(相対パスのみ。CDNのURLはそのまま)
  const out = src.replace(/((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, (m, pre, q, path) => {
    count++;
    return `${pre}${q}${path}?v=${v}${q}`;
  });
  writeFileSync(file, out);
}

const indexPath = join(dir, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html
  .replace('href="css/style.css"', `href="css/style.css?v=${v}"`)
  .replace('src="js/app.js"', `src="js/app.js?v=${v}"`)
  .replace('</head>', `  <meta name="app-version" content="${version}">\n</head>`);
writeFileSync(indexPath, html);
writeFileSync(join(dir, 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`stamped ${count} imports with v=${version}`);
