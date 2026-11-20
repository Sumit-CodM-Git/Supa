const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('../frontend/node_modules/typescript');

function editor(loadTranscript, defaults) {
  const state = [];
  let cursor = 0;
  let confirmed;
  let confirmedCaptions;
  let confirmedPortrait;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => state[index] = value];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = {current: initial};
      return state[index];
    },
    useEffect() {},
  };
  const jsx = (type, props) => ({type, props});
  const module = {exports: {}};
  const code = ts.transpileModule(fs.readFileSync('frontend/src/components/ClipEditor.tsx', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === './CaptionAppearance') return {CaptionOverlay() {}, defaultCaptionStyle: {font: 'Arial', size: 22, position: 'bottom', align: 'center', margin: 24}};
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
      if (name === '../api/client') return {apiUrl: path => 'http://127.0.0.1:8000/api' + path, getTranscript: loadTranscript || (async () => ({language: 'en', automatic: true, languages: ['en'], cues: [{start: 0, end: 5, text: 'Original transcript'}]}))};
      throw new Error(name);
    },
    URL, location: {href: 'http://127.0.0.1:8000/'},
  });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  return {
    render() {
      cursor = 0;
      return nodes(module.exports.default({defaults, duration: 100, videoId: 'abcdefghijk', formatLabel: '1080p', pending: false, onClose() {}, onConfirm: (ranges, captions, portrait) => { confirmed = ranges; confirmedCaptions = captions; confirmedPortrait = portrait; }}));
    },
    portrait: () => confirmedPortrait,
    captions: () => JSON.parse(JSON.stringify(confirmedCaptions ?? null)),
    confirmed: () => JSON.parse(JSON.stringify(confirmed ?? null)),
  };
}
const byLabel = (nodes, label) => nodes.find(node => node.props?.['aria-label'] === label);
const button = (nodes, text) => nodes.find(node => node.type === 'button' && node.props.children === text);

test('save ranges resets handles, preserves earlier clips, and queues only on confirmation', () => {
  const app = editor();
  let nodes = app.render();
  byLabel(nodes, 'Clip start time').props.onChange({target: {value: '10'}});
  nodes = app.render();
  byLabel(nodes, 'Clip end time').props.onChange({target: {value: '20'}});
  button(app.render(), 'Add selection').props.onClick();
  nodes = app.render();
  assert.equal(byLabel(nodes, 'Clip start time').props.value, 0);
  assert.equal(byLabel(nodes, 'Clip end time').props.value, 100);
  byLabel(nodes, 'Clip start time').props.onChange({target: {value: '30'}});
  byLabel(app.render(), 'Clip end time').props.onChange({target: {value: '40'}});
  button(app.render(), 'Add selection').props.onClick();
  assert.equal(app.confirmed(), null);
  nodes = app.render();
  button(nodes, 'Download 2 clips').props.onClick();
  assert.deepEqual(app.confirmed(), [{start: 10, end: 20}, {start: 30, end: 40}]);
});

test('delete removes only selected saved range and unsaved changes block confirmation', () => {
  const app = editor();
  button(app.render(), 'Add selection').props.onClick();
  byLabel(app.render(), 'Clip start time').props.onChange({target: {value: '25'}});
  assert.equal(button(app.render(), 'Download 1 clip').props.disabled, true);
  button(app.render(), 'Add selection').props.onClick();
  byLabel(app.render(), 'Delete clip 1').props.onClick();
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.deepEqual(app.confirmed(), [{start: 25, end: 100}]);
});

test('handles cannot cross and reset discards the unsaved range', () => {
  const app = editor();
  byLabel(app.render(), 'Clip end time').props.onChange({target: {value: '5'}});
  byLabel(app.render(), 'Clip start time').props.onChange({target: {value: '80'}});
  assert.ok(byLabel(app.render(), 'Clip start time').props.value < 5);
  button(app.render(), 'Reset current range').props.onClick();
  assert.equal(byLabel(app.render(), 'Clip start time').props.value, 0);
  assert.equal(byLabel(app.render(), 'Clip end time').props.value, 100);
});

test('preview seeks to selected range, stops at end, and ignores other message sources', () => {
  let receive;
  let tick;
  let options;
  let time = 0;
  const calls = [];
  const parent = {postMessage() {}};
  const player = {pauseVideo: () => calls.push('pause'), seekTo: value => calls.push(['seek', value]), playVideo: () => calls.push('play'), getCurrentTime: () => time};
  const window = {addEventListener(type, callback) {if (type === 'message') receive = callback;}};
  vm.runInNewContext(fs.readFileSync('backend/preview/player.js', 'utf8'), {
    URLSearchParams, location: {search: '?video_id=abcdefghijk', origin: 'http://127.0.0.1:8000'},
    window, parent, setInterval: callback => {tick = callback; return 1;}, clearInterval() {},
    YT: {Player: function(id, config) {options = config; return player;}},
  });
  window.onYouTubeIframeAPIReady();
  options.events.onReady();
  receive({source: {}, data: {source: 'clip-editor', type: 'range', start: 10, end: 20}});
  assert.deepEqual(calls, []);
  receive({source: parent, data: {source: 'clip-editor', type: 'range', start: 10, end: 20}});
  assert.deepEqual(calls, [['seek', 10], 'play']);
  time = 20;
  tick();
  assert.equal(calls.at(-1), 'pause');
});


test('unified transcript edits preserve timing and are included only when captions are enabled', async () => {
  const app = editor();
  await button(app.render(), 'Load transcript').props.onClick();
  let nodes = app.render();
  byLabel(nodes, 'Transcript text').props.onChange({target: {value: 'Edited transcript'}});
  button(app.render(), 'Add selection').props.onClick();
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.deepEqual(app.captions(), [{start: 0, end: 5, text: 'Edited transcript'}]);
  nodes = app.render();
  nodes.find(node => node.type === 'input' && node.props.checked === true && node.props.type === 'checkbox').props.onChange({target: {checked: false}});
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.equal(app.captions(), null);
});

test('empty transcript blocks download and reset restores transcript', async () => {
  const app = editor();
  await button(app.render(), 'Load transcript').props.onClick();
  button(app.render(), 'Add selection').props.onClick();
  byLabel(app.render(), 'Transcript text').props.onChange({target: {value: ''}});
  assert.equal(button(app.render(), 'Download 1 clip').props.disabled, true);
  button(app.render(), 'Reset transcript edits').props.onClick();
  assert.equal(button(app.render(), 'Download 1 clip').props.disabled, false);
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'Original transcript');
});


test('rate limited load preserves edits and disables retries during cooldown', async () => {
  let calls = 0;
  const app = editor(async () => {
    calls++;
    if (calls === 1) return {language: 'en', automatic: true, languages: ['en'], cues: [{start: 0, end: 5, text: 'Original'}]};
    throw Object.assign(new Error('YouTube is temporarily limiting transcript requests.'), {retryAfter: 120});
  });
  await button(app.render(), 'Load transcript').props.onClick();
  byLabel(app.render(), 'Transcript text').props.onChange({target: {value: 'Keep my edits'}});
  await button(app.render(), 'Reload transcript').props.onClick();
  assert.equal(button(app.render(), 'Try again in 120s').props.disabled, true);
  await button(app.render(), 'Try again in 120s').props.onClick();
  assert.equal(calls, 2);
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'Keep my edits');
});

test('simultaneous clicks share the pending transcript request', async () => {
  let complete;
  let calls = 0;
  const app = editor(() => { calls++; return new Promise(resolve => {complete = resolve;}); });
  const first = button(app.render(), 'Load transcript').props.onClick();
  await button(app.render(), 'Loading transcript…').props.onClick();
  assert.equal(calls, 1);
  complete({language: 'en', automatic: true, languages: ['en'], cues: [{start: 0, end: 5, text: 'One request'}]});
  await first;
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'One request');
});


test('selected transcript uses one editor and edits preserve captions outside the range', async () => {
  const app = editor(async () => ({language: 'en', automatic: true, languages: ['en'], cues: [
    {start: 0, end: 5, text: 'Outside before'},
    {start: 10, end: 15, text: 'First selected line'},
    {start: 15, end: 20, text: 'Second selected line'},
    {start: 25, end: 30, text: 'Outside after'},
  ]}));
  await button(app.render(), 'Load transcript').props.onClick();
  byLabel(app.render(), 'Clip start time').props.onChange({target: {value: '10'}});
  byLabel(app.render(), 'Clip end time').props.onChange({target: {value: '20'}});
  assert.equal(app.render().filter(node => node.type === 'textarea').length, 1);
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'First selected line\nSecond selected line');
  byLabel(app.render(), 'Transcript text').props.onChange({target: {value: 'First corrected line\nSecond selected line'}});
  button(app.render(), 'Add selection').props.onClick();
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.deepEqual(app.captions(), [
    {start: 0, end: 5, text: 'Outside before'},
    {start: 10, end: 15, text: 'First corrected line'},
    {start: 15, end: 20, text: 'Second selected line'},
    {start: 25, end: 30, text: 'Outside after'},
  ]);
});

test('pasting a paragraph preserves its text and distributes it across existing caption times', async () => {
  const app = editor(async () => ({language: 'en', automatic: true, languages: ['en'], cues: [
    {start: 0, end: 5, text: 'Old first line'}, {start: 5, end: 10, text: 'Old second line'},
  ]}));
  await button(app.render(), 'Load transcript').props.onClick();
  const paragraph = 'This is one complete rewritten passage with all of the words together.';
  byLabel(app.render(), 'Transcript text').props.onChange({target: {value: paragraph}});
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, paragraph);
  button(app.render(), 'Add selection').props.onClick();
  button(app.render(), 'Download 1 clip').props.onClick();
  const cues = app.captions();
  assert.deepEqual(cues.map(({start, end}) => ({start, end})), [{start: 0, end: 5}, {start: 5, end: 10}]);
  assert.equal(cues.map(cue => cue.text).join(' '), paragraph);
});

test('changing the range updates the unified text without losing earlier edits', async () => {
  const app = editor(async () => ({language: 'en', automatic: true, languages: ['en'], cues: [
    {start: 0, end: 5, text: 'First passage'}, {start: 10, end: 20, text: 'Second passage'},
  ]}));
  await button(app.render(), 'Load transcript').props.onClick();
  byLabel(app.render(), 'Clip end time').props.onChange({target: {value: '5'}});
  byLabel(app.render(), 'Transcript text').props.onChange({target: {value: 'Edited first passage'}});
  byLabel(app.render(), 'Clip end time').props.onChange({target: {value: '20'}});
  byLabel(app.render(), 'Clip start time').props.onChange({target: {value: '10'}});
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'Second passage');
  byLabel(app.render(), 'Only current selection').props.onChange({target: {checked: false}});
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'Edited first passage\nSecond passage');
});


test('automatic portrait framing is opt-in and accompanies confirmed clip downloads', () => {
  const app = editor();
  button(app.render(), 'Add selection').props.onClick();
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.equal(app.portrait(), false);
  byLabel(app.render(), 'Automatically follow people').props.onChange({target: {checked: true}});
  button(app.render(), 'Download 1 clip').props.onClick();
  assert.equal(app.portrait(), true);
  assert.deepEqual(app.confirmed(), [{start: 0, end: 100}]);
});


test('saved language and portrait defaults apply when opening the clip editor', async () => {
  let language;
  const app = editor(async (url, requested) => {
    language = requested;
    return {language: requested, automatic: true, languages: [requested], cues: [{start: 0, end: 5, text: 'Translated caption'}]};
  }, {default_caption_language: 'fr', captions_enabled: true, auto_portrait: true});
  assert.equal(byLabel(app.render(), 'Automatically follow people').props.checked, true);
  await button(app.render(), 'Load transcript').props.onClick();
  assert.equal(language, 'fr');
  assert.equal(byLabel(app.render(), 'Transcript text').props.value, 'Translated caption');
});
