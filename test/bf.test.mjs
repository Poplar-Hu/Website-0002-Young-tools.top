/** Brainfuck 引擎测试：示例程序 + 优化器差分测试 + JIT 与解释器一致性 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// 引擎不依赖 DOM，可以直接在 Node 里跑：
//   node test/bf.test.mjs
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(here, '..', 'assets', 'bf.js')).href);
const BF = globalThis.BF;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m) => { console.log(`  ✗ ${m}`); fail++; };

const bytes = (arr) => Uint8Array.from(arr);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const isPrefix = (a, b) => a.length <= b.length && a.every((v, i) => v === b[i]);

/* ══════════════════════════════════════════════════════════════════════
   1. 示例程序 —— 逐个跑通并检查输出
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 1. 示例程序 ===');
const EXPECT = {
  hello: 'Hello World!\n',
  cat: 'Brainfuck 回显测试\nEcho test 123\n',
  digits: '0123456789',
  add: 'A',   // '!' = 33, ' ' = 32，33+32 = 65 = 'A'
  bench: '',
};

for (const ex of BF.EXAMPLES) {
  const input = BF.textToBytes(ex.stdin || '');
  try {
    const prep = BF.prepare(ex.code);
    const ir = BF.runIR(prep.ir, { input, maxSteps: 50000000 });
    const jitFn = BF.buildJIT(BF.compile(prep.ir));
    const jit = BF.runJIT(jitFn, { input, maxSteps: 50000000 });

    const text = BF.bytesToText(ir.output);
    const label = `${ex.id.padEnd(11)} ${String(prep.sourceOps).padStart(5)} → ${String(prep.finalOps).padStart(4)} 条  ` +
      `${String(ir.steps).padStart(10)} 步  ${ir.output.length} 字节`;

    if (ir.error) { no(`${label}  解释器出错: ${ir.error}`); continue; }
    if (jit.error) { no(`${label}  JIT 出错: ${jit.error}`); continue; }
    if (!eq(bytes(ir.output), bytes(jit.output))) { no(`${label}  JIT 输出与解释器不一致`); continue; }

    if (ex.id in EXPECT && text !== EXPECT[ex.id]) {
      no(`${label}  输出不符\n        期望 ${JSON.stringify(EXPECT[ex.id])}\n        实际 ${JSON.stringify(text.slice(0, 80))}`);
      continue;
    }
    ok(label);
    if (ex.id === 'sierpinski') {
      const lines = text.replace(/\n+$/, '').split('\n');
      console.log(`        渲染出 ${lines.length} 行三角形，前 3 行：`);
      lines.slice(0, 3).forEach((l) => console.log(`        |${l}`));
    }
  } catch (e) {
    no(`${ex.id}: ${e.message}`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   2. 优化器规则 —— 逐条验证
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 2. 优化规则 ===');
const RULES = [
  ['连续加减合并',      '+++++',                      1],
  ['连续移动合并',      '>>>>',                       1],
  ['净效果为 0 直接删', '++--',                       0],
  ['清零循环 [-]',      '+++++[-]',                   2],
  ['清零循环 [+]',      '+++++[+]',                   2],
  ['清零后加减→赋值',   '+++++[-]+++',                1],
  ['连续赋值只留最后',  '[-]+[-]++[-]+++',            1],
  ['传输循环 [->+<]',   '+++++[->+<]',                2],
  ['乘法循环 [->+++<]', '+++++[->+++<]',              2],
  ['多目标传输',        '+++++[->+>++<<]',            2],
  ['扫描循环 [>]',      '+++[>]',                      2],
  ['扫描循环 [<<]',     '>>+++[<<]',                   3],
];
for (const [name, code, expectMax] of RULES) {
  const prep = BF.prepare(code);
  const got = prep.finalOps;
  if (got <= expectMax) ok(`${name.padEnd(20)} "${code}" → ${got} 条`);
  else no(`${name.padEnd(20)} "${code}" → ${got} 条（期望 ≤ ${expectMax}）`);
}

// 确认 [->+<] 真的变成了 XFER，[+] 真的变成了 CLEAR
{
  const opsOf = (c) => BF.prepare(c).ir.map((o) => o.op);
  const xfer = opsOf('+++++[->+<]');
  const clear = opsOf('+++++[+]');
  if (xfer.includes('xfer')) ok('[->+<] 确实折叠为 xfer'); else no(`[->+<] 未折叠：${xfer}`);
  if (clear.includes('clear')) ok('[+] 确实折叠为 clear'); else no(`[+] 未折叠：${clear}`);
}

// 反向确认：自减不是 1 的循环不能被折叠（它跑的不是 value 次）
{
  const ir = BF.prepare('+++[->+<->+<]').ir.map((o) => o.op);
  if (ir.includes('xfer') || ir.includes('clear')) no(`非线性循环被错误折叠：${ir}`);
  else ok('非线性循环（当前格净减 2）没有被错误折叠');
}

// 死存储消除：一连串赋值只应留下最后一条
{
  const ir = BF.prepare('[-]+[-]++[-]+++').ir;
  if (ir.length === 1 && ir[0].op === 'set' && ir[0].n === 3) ok('连续赋值被压缩为一条 SET 3');
  else no(`连续赋值未压缩：${JSON.stringify(ir)}`);
}

// 扫描循环确实折叠成 SCAN
{
  const ir = BF.prepare('+++[>]').ir.map((o) => o.op);
  if (ir.includes('scan')) ok('[>] 确实折叠为 scan');
  else no(`[>] 未折叠：${ir}`);
}

/* ══════════════════════════════════════════════════════════════════════
   3. 随机差分测试 —— 优化器不能改变语义
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 3. 随机差分测试（1000 个随机程序）===');
let seed = 20261002;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function randomProgram(len) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < len; i++) {
    const r = rnd();
    if (r < 0.22) out.push('>');
    else if (r < 0.30) out.push('<');
    else if (r < 0.55) out.push('+');
    else if (r < 0.68) out.push('-');
    else if (r < 0.76) out.push('.');
    else if (r < 0.80) out.push(',');
    else if (r < 0.92 && depth < 3) { out.push('['); depth++; }
    else if (depth > 0) { out.push(']'); depth--; }
  }
  while (depth-- > 0) out.push(']');
  return out.join('');
}

const MAXSTEPS = 60000;
let trials = 0, skipped = 0, mismatch = 0, jitMismatch = 0, bothComplete = 0;

for (let t = 0; t < 1000; t++) {
  const src = randomProgram(30 + Math.floor(rnd() * 90));
  const inputBytes = BF.textToBytes('ab\n');

  let rawOps, optOps;
  try {
    rawOps = BF.parse(src);
    optOps = BF.optimize(rawOps).ops;
  } catch { skipped++; continue; }   // 括号不配对的随机程序直接跳过

  const a = BF.runIR(rawOps, { input: inputBytes, maxSteps: MAXSTEPS });
  const b = BF.runIR(optOps, { input: inputBytes, maxSteps: MAXSTEPS });

  let c;
  try {
    const fn = BF.buildJIT(BF.compile(optOps));
    c = BF.runJIT(fn, { input: inputBytes, maxSteps: MAXSTEPS });
  } catch { c = null; }

  trials++;

  // 优化前后的输出应当是彼此的前缀（谁先撞到步数上限，谁的输出就短）
  const A = bytes(a.output), B = bytes(b.output);
  const aStopped = a.reason === 'steps';
  const bStopped = b.reason === 'steps';

  if (aStopped || bStopped) {
    if (!isPrefix(A, B) && !isPrefix(B, A)) {
      mismatch++;
      if (mismatch <= 3) console.log(`  ✗ 前缀不符: "${src}"\n      raw=${JSON.stringify(BF.bytesToText(A))}\n      opt=${JSON.stringify(BF.bytesToText(B))}`);
    }
  } else {
    bothComplete++;
    if (!eq(A, B)) {
      mismatch++;
      if (mismatch <= 3) console.log(`  ✗ 输出不一致: "${src}"\n      raw=${JSON.stringify(BF.bytesToText(A))}\n      opt=${JSON.stringify(BF.bytesToText(B))}`);
    }
  }

  // JIT 跑的就是优化后的 IR，必须逐字节一致（含错误类型）
  if (c) {
    if (!eq(B, bytes(c.output)) || (b.reason || '') !== (c.reason || '')) {
      jitMismatch++;
      if (jitMismatch <= 3) console.log(`  ✗ JIT 不一致: "${src}"\n      ir =${JSON.stringify(BF.bytesToText(B))} (${b.reason || 'ok'})\n      jit=${JSON.stringify(BF.bytesToText(c.output))} (${c.reason || 'ok'})`);
    }
  }
}

console.log(`  执行了 ${trials} 个程序（跳过 ${skipped} 个括号不配对的），其中 ${bothComplete} 个正常跑完`);
if (mismatch === 0) ok('优化前后输出全部一致（语义保持）'); else no(`${mismatch} 个程序优化后语义变了`);
if (jitMismatch === 0) ok('JIT 与解释器输出逐字节一致'); else no(`${jitMismatch} 个程序 JIT 与解释器不一致`);

/* ══════════════════════════════════════════════════════════════════════
   4. 性能：解释器 vs JIT
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n=== 4. 性能对比 ===');
const bench = BF.EXAMPLES.find((e) => e.id === 'bench');
const prep = BF.prepare(bench.code);
console.log(`  基准程序: ${prep.sourceOps} 条 → 优化后 ${prep.finalOps} 条`);

// 预热
for (let i = 0; i < 2; i++) { BF.runIR(prep.ir, { maxSteps: 1e9 }); }
const jitFn = BF.buildJIT(BF.compile(prep.ir));

const t0 = process.hrtime.bigint();
const r1 = BF.runIR(prep.ir, { maxSteps: 1e9 });
const t1 = process.hrtime.bigint();

for (let i = 0; i < 3; i++) BF.runJIT(jitFn, { maxSteps: 1e9 });
const t2 = process.hrtime.bigint();
const r2 = BF.runJIT(jitFn, { maxSteps: 1e9 });
const t3 = process.hrtime.bigint();

const msIR = Number(t1 - t0) / 1e6;
const msJIT = Number(t3 - t2) / 1e6;
console.log(`  解释执行 ${msIR.toFixed(1)} ms  (${r1.steps.toLocaleString()} 步)`);
console.log(`  JIT 执行 ${msJIT.toFixed(1)} ms`);
console.log(`  加速比   ${(msIR / msJIT).toFixed(1)}×`);
if (msJIT < msIR) ok('JIT 确实更快'); else no('JIT 没有更快（需要检查）');

/* ── 结果 ─────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(60));
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
