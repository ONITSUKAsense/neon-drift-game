/**
 * 把 index.html + css + js + 字体 打包成单个 HTML 文件（dist/neon-drift.html）。
 * 产物可以直接双击、离线打开，不需要任何服务器。
 *
 *   node build.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(resolve(root, p), 'utf8');

let html = await read('index.html');
let css = await read('css/style.css');
const js = await read('js/neon-drift.js');

// 字体 -> base64 内联
const fontFiles = ['monoton-400', 'chakrapetch-400', 'chakrapetch-600', 'chakrapetch-700'];
for (const name of fontFiles) {
  const buf = await readFile(resolve(root, `fonts/${name}.woff2`));
  const b64 = buf.toString('base64');
  css = css.replaceAll(`url('../fonts/${name}.woff2')`, `url(data:font/woff2;base64,${b64})`);
}

if (css.includes('../fonts/')) {
  throw new Error('还有未内联的字体引用：' + css.match(/\.\.\/fonts\/[^)]+/g)?.join(', '));
}

html = html
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="js/neon-drift.js"></script>',
    `<script type="module">\n${js}\n</script>`
  );

if (html.includes('src="js/') || html.includes('href="css/')) {
  throw new Error('打包后仍存在外部资源引用');
}

await mkdir(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist/neon-drift.html');
await writeFile(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✅ ${out}  (${kb} KB)`);
