// Dev-only whitespace formatting using the operator's existing Playwright Babel bundle.
// No names are mangled, no optimizer runs, and no runtime dependency is added.
module.exports = () => ({ manipulateOptions(options) {
  const format = { compact: true, retainLines: true, comments: false };
  Object.assign(options, format, { sourceMaps: false });
  Object.assign(options.generatorOpts, format);
} });
if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const repo = path.resolve(__dirname, '..');
  const bundle = process.env.BABEL_BUNDLE || path.resolve(repo, '../shot-tools/node_modules/playwright/lib/transform/babelBundle.js');
  const babel = require(bundle);
  for (const name of ['app.js', 'model.js']) {
    const file = path.join(repo, 'dashboard', name), input = fs.readFileSync(file, 'utf8');
    const result = babel.babelTransform(input, file, true, [[__filename, {}]], false).code;
    new Function(result); // syntax-only check, does not execute browser code
    const output = result.replace(/^\s*\n/gm, '') + '\n';
    fs.writeFileSync(file, output);
    console.log(name + ': ' + Buffer.byteLength(input) + ' → ' + Buffer.byteLength(output));
  }
  const cssFile = path.join(repo, 'dashboard/app.css'), css = fs.readFileSync(cssFile, 'utf8');
  // Preserve quoted font names and their spaces; compact only punctuation and whitespace outside them.
  const parts = css.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g);
  const output = parts.map((s, i) => i % 2 ? s : s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,])\s*/g, '$1')).join('').trim() + '\n';
  fs.writeFileSync(cssFile, output);
  console.log('app.css: ' + Buffer.byteLength(css) + ' → ' + Buffer.byteLength(output));
}
