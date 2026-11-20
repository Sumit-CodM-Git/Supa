const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('../frontend/node_modules/typescript');

function settingsPage() {
  const states = [];
  let cursor = 0;
  let saved;
  const appearance = {font: 'Arial', size: 22, color: '#FFFFFF', outline_color: '#000000', background_color: '#000000', background: false, bold: true, italic: false, position: 'bottom', align: 'center', margin: 24, outline: 2, shadow: 0};
  const initial = {download_dir: '/downloads', max_concurrent: 2, default_caption_language: 'original', captions_enabled: false, auto_portrait: false, caption_style: appearance, keep_original: false, cookiefile: '/private/cookies.txt'};
  const jsx = (type, props) => ({type, props});
  const module = {exports: {}};
  const code = ts.transpileModule(fs.readFileSync('frontend/src/pages/Settings.tsx', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, require(name) {
    if (name === 'react') return {useEffect() {}, useState(value) { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], next => states[index] = next]; }};
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name === '../components/CaptionAppearance') return {defaultCaptionStyle: appearance, CaptionOverlay() {}};
    throw new Error(name);
  }});
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  return {render() {cursor = 0; return nodes(module.exports.default({settings: initial, pending: false, saved: false, onSave: value => saved = value}));}, saved: () => JSON.parse(JSON.stringify(saved))};
}

test('settings page saves caption appearance and language while preserving connection settings', () => {
  const app = settingsPage();
  let nodes = app.render();
  nodes.find(n => n.props?.['aria-label'] === 'Default caption language').props.onChange({target: {value: 'fr'}});
  nodes = app.render();
  nodes.find(n => n.type === 'input' && n.props.type === 'color').props.onChange({target: {value: '#FFCC00'}});
  app.render().find(n => n.type === 'form').props.onSubmit({preventDefault() {}});
  const saved = app.saved();
  assert.equal(saved.default_caption_language, 'fr');
  assert.equal(saved.caption_style.color, '#FFCC00');
  assert.equal(saved.cookiefile, '/private/cookies.txt');
  assert.equal(saved.download_dir, '/downloads');
});
