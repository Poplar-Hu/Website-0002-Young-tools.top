/* ============================================================================
   编解码引擎测试
   ----------------------------------------------------------------------------
   跑法（不需要任何依赖）：
       node test/codec.test.mjs

   两类断言：
     1. 已知向量 —— 拿标准里的固定答案对，确保实现没跑偏
     2. 往返测试 —— 编码再解码必须还原，含随机字符串
   ========================================================================== */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(here, '..', 'assets', 'codec.js')).href);

const C = globalThis.Codec;
const I = C.impl;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m) => { console.log(`  ✗ ${m}`); fail++; };
const eq = (label, got, want) => {
  if (got === want) ok(`${label} = ${JSON.stringify(got)}`);
  else no(`${label}\n        期望 ${JSON.stringify(want)}\n        实际 ${JSON.stringify(got)}`);
};

/* ══════════════════════════════════════════════════════════════════════
   1. 已知向量
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 1. 已知向量 ===');

console.log('\n--- Base64 / Base32（RFC 4648 附录 A 的测试向量）---');
const RFC = [['', '', ''], ['f', 'Zg==', 'MY======'], ['fo', 'Zm8=', 'MZXQ===='],
  ['foo', 'Zm9v', 'MZXW6==='], ['foob', 'Zm9vYg==', 'MZXW6YQ='],
  ['fooba', 'Zm9vYmE=', 'MZXW6YTB'], ['foobar', 'Zm9vYmFy', 'MZXW6YTBOI======']];
for (const [plain, b64, b32] of RFC) {
  eq(`base64("${plain}")`, I.base64Encode(plain, { pad: true }), b64);
  eq(`base64decode("${b64}")`, I.base64Decode(b64, {}), plain);
  eq(`base32("${plain}")`, I.base32Encode(plain), b32);
  eq(`base32decode("${b32}")`, I.base32Decode(b32), plain);
}

console.log('\n--- Base58（bitcoin 字母表）---');
eq('base58("")', I.base58Encode(''), '');
eq('base58("abc")', I.base58Encode('abc'), 'ZiCa');
eq('base58("hello world")', I.base58Encode('hello world'), 'StV1DL6CwTryKyV');
eq('base58decode("ZiCa")', I.base58Decode('ZiCa'), 'abc');
eq('base58decode("StV1DL6CwTryKyV")', I.base58Decode('StV1DL6CwTryKyV'), 'hello world');
// 全零字节与空输入是这套算法最容易写错的边界
eq('base58(两字节 0x0000)', I.base58Encode(String.fromCharCode(0, 0)), '11');
eq('base58decode("11")', Array.from(C.utf8Encode(I.base58Decode('11'))).join(','), '0,0');

console.log('\n--- 十六进制 ---');
eq('hex("abc")', I.hexEncode('abc', { upper: false, spaced: false }), '616263');
eq('hex 大写', I.hexEncode('abc', { upper: true, spaced: false }), '616263'.toUpperCase());
eq('hex 解码（含空格与 0x）', I.hexDecode('0x61 62 63'), 'abc');

console.log('\n--- 古典密码 ---');
eq('ROT13("Hello, World!")', I.rotN('Hello, World!', 13), 'Uryyb, Jbeyq!');
eq('ROT13 是自反的', I.rotN(I.rotN('Hello, World!', 13), 13), 'Hello, World!');
eq('Atbash("abc XYZ")', I.atbash('abc XYZ'), 'zyx CBA');
eq('摩尔斯("SOS")', I.morseEncode('SOS'), '... --- ...');
eq('摩尔斯解码', I.morseDecode('... --- ...'), 'SOS');
eq('摩尔斯("SOS HELP")', I.morseEncode('SOS HELP'), '... --- ... / .... . .-.. .--.');
eq('摩尔斯往返', I.morseDecode(I.morseEncode('SOS HELP')), 'SOS HELP');
eq('栅栏密码(3 栏)', I.railEncode('WEAREDISCOVEREDFLEEATONCE', 3), 'WECRLTEERDSOEEFEAOCAIVDEN');
eq('栅栏解码', I.railDecode('WECRLTEERDSOEEFEAOCAIVDEN', 3), 'WEAREDISCOVEREDFLEEATONCE');
eq('维吉尼亚(教科书例)', I.vigenere('ATTACKATDAWN', 'LEMON', 1), 'LXFOPVEFRNHR');
eq('维吉尼亚解码', I.vigenere('LXFOPVEFRNHR', 'LEMON', -1), 'ATTACKATDAWN');
eq('维吉尼亚保留大小写与非字母', I.vigenere('Attack at dawn!', 'LEMON', 1), 'Lxfopv ef rnhr!');

console.log('\n--- 摘要（RFC 标准测试向量）---');
eq('CRC32("123456789")', I.crc32('123456789'), 'cbf43926');
eq('MD5("")', I.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
eq('MD5("abc")', I.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
eq('MD5(quick brown fox)', I.md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
eq('MD5(55 字节边界)', I.md5('a'.repeat(55)), 'ef1772b6dff9a122358552954ad0df65');
eq('MD5(56 字节边界)', I.md5('a'.repeat(56)), '3b0c8ac703f828b04c6c197006d17218');
eq('MD5(64 字节)', I.md5('a'.repeat(64)), '014842d480b571495a4a0363793f7367');

const digests = [
  ['SHA-1', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
  ['SHA-256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['SHA-512', 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
];
for (const [algo, want] of digests) {
  const buf = await globalThis.crypto.subtle.digest(algo, C.utf8Encode('abc'));
  const got = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  eq(`${algo}("abc")`, got, want);
}

console.log('\n--- 文本编码 ---');
eq('URL 编码', I.urlEncode('a b&c=中', { component: true }), 'a%20b%26c%3D%E4%B8%AD');
eq('URL 解码', I.urlDecode('a%20b%26c%3D%E4%B8%AD', { component: true }), 'a b&c=中');
eq('HTML 实体编码', I.htmlEncode('<a href="x">&\'</a>', { asciiOnly: true, onlySpecial: false }),
  '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
eq('HTML 实体解码', I.htmlDecode('&lt;a&gt; &amp; &quot;x&quot; &#20013; &#x4E2D;'), '<a> & "x" 中 中');
eq('Unicode 转义', I.unicodeEncode('A中', { spaced: false }), '\\u0041\\u4E2D');
eq('Unicode 星平面（应该输出代理对）', I.unicodeEncode('🎉', { spaced: false }), '\\uD83C\\uDF89');
eq('Unicode 还原', I.unicodeDecode('\\u0041\\u4E2D'), 'A中');
eq('Unicode 还原代理对', I.unicodeDecode('\\uD83C\\uDF89'), '🎉');
eq('二进制表示', I.binaryEncode('Hi', { group: true }), '01001000 01101001');
eq('二进制还原', I.binaryDecode('01001000 01101001'), 'Hi');

/* ══════════════════════════════════════════════════════════════════════
   2. 往返测试
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 2. 往返测试 ===');

const STRINGS = ['', 'a', 'ab', 'abc', 'abcd', 'hello world',
  '你好，世界', '🎉 emoji 🚀 混合', 'Mixed 中英 123 !@#$%^&*()_+-=',
  '\n\t\r 空白 ', 'a'.repeat(200), '中文'.repeat(50)];

const ROUNDTRIP = [
  ['Base64', (s) => I.base64Encode(s, { pad: true }), (s) => I.base64Decode(s, {})],
  ['Base64(URL 安全,不补=)', (s) => I.base64Encode(s, { urlSafe: true, pad: false }), (s) => I.base64Decode(s, {})],
  ['Base32', (s) => I.base32Encode(s), (s) => I.base32Decode(s)],
  ['Base58', (s) => I.base58Encode(s), (s) => I.base58Decode(s)],
  ['Hex', (s) => I.hexEncode(s, { upper: false, spaced: false }), (s) => I.hexDecode(s)],
  ['Hex(大写带空格)', (s) => I.hexEncode(s, { upper: true, spaced: true }), (s) => I.hexDecode(s)],
  ['URL', (s) => I.urlEncode(s, { component: true }), (s) => I.urlDecode(s, { component: true })],
  ['HTML 实体', (s) => I.htmlEncode(s, { asciiOnly: true, onlySpecial: false }), (s) => I.htmlDecode(s)],
  ['Unicode 转义', (s) => I.unicodeEncode(s, { spaced: false }), (s) => I.unicodeDecode(s)],
  ['Unicode 转义(带空格)', (s) => I.unicodeEncode(s, { spaced: true }), (s) => I.unicodeDecode(s)],
  ['二进制', (s) => I.binaryEncode(s, { group: true }), (s) => I.binaryDecode(s)],
];

for (const [name, enc, dec] of ROUNDTRIP) {
  let bad = 0, example = '';
  for (const s of STRINGS) {
    let got;
    try { got = dec(enc(s)); } catch (e) { bad++; example = `${JSON.stringify(s)} → 抛错 ${e.message}`; continue; }
    if (got !== s) { bad++; example = `${JSON.stringify(s)} → ${JSON.stringify(got)}`; }
  }
  if (bad) no(`${name.padEnd(22)} ${bad}/${STRINGS.length} 个不还原  例：${example}`);
  else ok(`${name.padEnd(22)} ${STRINGS.length} 个样本全部还原`);
}

/* 随机字符串的往返（更能覆盖边界） */
{
  let seed = 20261002;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const randomStr = () => {
    const n = Math.floor(rnd() * 40);
    let s = '';
    for (let i = 0; i < n; i++) {
      let cp = Math.floor(rnd() * 0x2ffff) + 1;
      // 跳过代理区：孤立代理项是非法 Unicode，UTF-8 编码时会变成 U+FFFD，
      // 那种字符串本来就不可逆，考验的不是这些编解码器
      if (cp >= 0xd800 && cp <= 0xdfff) { i--; continue; }
      s += String.fromCodePoint(cp);
    }
    return s;
  };
  for (const [name, enc, dec] of ROUNDTRIP) {
    let bad = 0;
    for (let t = 0; t < 300; t++) {
      const s = randomStr();
      try { if (dec(enc(s)) !== s) bad++; } catch { bad++; }
    }
    if (bad) no(`${name} 随机 300 例：${bad} 个失败`);
  }
  if (!fail) ok('11 种编码 × 随机 300 例全部往返成功');
}

/* 栅栏密码与维吉尼亚只在特定字符集上可逆 */
{
  let bad = 0;
  for (let rails = 2; rails <= 8; rails++) {
    for (const s of ['WEAREDISCOVEREDFLEEATONCE', 'HelloWorld', 'a', 'ab', 'abcde', 'x'.repeat(37)]) {
      if (I.railDecode(I.railEncode(s, rails), rails) !== s) bad++;
    }
  }
  if (bad) no(`栅栏密码往返：${bad} 个失败`); else ok('栅栏密码 2~8 栏往返全部成功');

  let vbad = 0;
  for (const key of ['KEY', 'LEMON', 'ABC', 'ZZZ']) {
    for (const s of ['ATTACKATDAWN', 'Hello World', 'a', 'ZzYy']) {
      if (I.vigenere(I.vigenere(s, key, 1), key, -1) !== s) vbad++;
    }
  }
  if (vbad) no(`维吉尼亚往返：${vbad} 个失败`); else ok('维吉尼亚多种密钥往返全部成功');
}

/* ══════════════════════════════════════════════════════════════════════
   3. 配方执行
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 3. 配方（配方链）===');
{
  const r = await C.runRecipe('aHR0cHMlM0ElMkYlMkZ3aG8teW91bmcudG9wJTJG',
    [{ id: 'b64-dec', params: {} }, { id: 'url-dec', params: { component: true } }]);
  eq('Base64 → URL 解码 两步链', r.text, 'https://who-young.top/');
  eq('步数统计', r.steps.length, 2);

  const empty = await C.runRecipe('hello', []);
  eq('空配方 = 原样输出', empty.text, 'hello');

  const j = await C.runRecipe(C.SAMPLES.find((s) => s.id === 'jwt').input, [{ id: 'jwt-dec', params: {} }]);
  if (j.text.includes('"alg": "HS256"') && j.text.includes('"name": "Populus Hu"')) ok('JWT 示例能解出 header 与 payload');
  else no(`JWT 解码结果不对：\n${j.text.split('\n').slice(0, 6).join('\n')}`);
}

/* ══════════════════════════════════════════════════════════════════════
   4. 错误处理 —— 必须抛出带 code 的 CodecError，页面才能查语言包
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 4. 错误处理 ===');
async function expectError(label, fn, wantCode, wantStep) {
  try {
    await fn();
    no(`${label}：本该抛错却成功了`);
  } catch (e) {
    if (e.code !== wantCode) { no(`${label}：错误码是 ${e.code}，期望 ${wantCode}`); return; }
    if (wantStep !== undefined && e.step !== wantStep) { no(`${label}：step 是 ${e.step}，期望 ${wantStep}`); return; }
    ok(`${label} → ${e.code}${e.step !== undefined ? ` (step ${e.step})` : ''}`);
  }
}
await expectError('Base64 里有非法字符', () => I.base64Decode('!!!!', {}), 'invalid-char');
await expectError('Hex 含非法字符', () => I.hexDecode('zz'), 'invalid-char');
await expectError('Hex 长度是奇数', () => I.hexDecode('abc'), 'bad-length');
await expectError('二进制长度不是 8 的倍数', () => I.binaryDecode('0101'), 'bad-length');
await expectError('摩尔斯里有未知符号', () => I.morseDecode('.... . .-.. .-.. --- .-.-.-.-'), 'invalid-char');
await expectError('维吉尼亚缺密钥', () => I.vigenere('abc', '', 1), 'need-param');
await expectError('JWT 分段不足', () => I.jwtDecode('onlyonepart'), 'bad-format');
await expectError('URL 里有坏的百分号转义', () => I.urlDecode('%E4%B8', { component: true }), 'bad-format');
// 配方里第 2 步出错时，错误要带上 step 索引
await expectError('配方第 2 步出错', () => C.runRecipe('!!!!',
  [{ id: 'rot13', params: {} }, { id: 'b64-dec', params: {} }]), 'invalid-char', 1);
await expectError('配方里有未知操作', () => C.runRecipe('x', [{ id: 'no-such-op', params: {} }]), 'unknown-op', 0);

/* ══════════════════════════════════════════════════════════════════════
   5. 注册表自检
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 5. 注册表自检 ===');
{
  const ids = C.OPS.map((o) => o.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) no(`操作 id 重复：${dup.join(', ')}`); else ok(`${ids.length} 个操作的 id 都不重复`);

  const catSet = new Set(Object.keys(C.CATS));
  const badCat = C.OPS.filter((o) => !catSet.has(o.cat));
  if (badCat.length) no(`分类不存在：${badCat.map((o) => o.id).join(', ')}`); else ok('每个操作的分类都有效');

  const noName = C.OPS.filter((o) => !o.name || !o.name.cn || !o.name.en || !o.name.jp);
  if (noName.length) no(`缺多语言名称：${noName.map((o) => o.id).join(', ')}`); else ok('每个操作都有 cn/en/jp 三种名称');

  const badParam = C.OPS.filter((o) => (o.params || []).some((p) => !p.key || !p.type || !p.label));
  if (badParam.length) no(`参数定义不完整：${badParam.map((o) => o.id).join(', ')}`); else ok('参数定义都完整');

  // 每个示例的配方都应当能真的跑通
  for (const s of C.SAMPLES) {
    try {
      const r = await C.runRecipe(s.input, s.recipe);
      if (!r.text.length) no(`示例「${s.id}」输出为空`);
      else ok(`示例「${s.id}」跑通（输出 ${r.text.length} 字符，${r.ms.toFixed(1)} ms）`);
    } catch (e) {
      no(`示例「${s.id}」执行失败：${e.code || e.message}${e.step !== undefined ? ` (step ${e.step})` : ''}`);
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
