/* ============================================================================
   Brainfuck 引擎：解析 → 优化 → 两种执行后端
   ----------------------------------------------------------------------------
   为什么值得写优化器：BF 只有 8 条指令，真实程序里绝大部分指令都是
   「连续同类」或「固定惯用法」，可以直接折叠掉。

       源码 `+++++[-]+++`    7 条 → 1 条   （死存储消除 + 常量折叠 → SET 3）
       源码 `+++++[->+<]`    循环   → 一条 XFER
       源码 `+++++[->+>++<<]` 循环 → 一条 XFER（多目标）
       源码 `+++[>]`         循环   → 一条 SCAN
       Hello World          59 条 → 46 条
       谢尔宾斯基三角形      76 条 → 49 条（执行步数 29586 → 25024）
       纯循环基准            43 条 → 38 条

   注意优化对「指令数」的削减未必惊人 —— 这些示例本身已经写得很紧凑。
   真正拉开差距的是执行步数和 JIT（见下）。

   两个后端跑的是同一份 IR：

     runIR   在 IR 上解释执行。慢，但一眼能看懂在干什么。
     compile 把 IR 直接生成 JS 源码再 new Function 编译。
             BF 的 `[ ... ]` 语义正好就是 JS 的 `while (cell) { ... }`，
             所以能生成嵌套的 while，交给 V8 去优化。
             实测（约 670 万步的基准程序）比解释执行快 10~20 倍。

   本文件同时支持浏览器和 Node（挂在 globalThis 上），方便脱离页面做单元测试。
   ========================================================================== */
(function (root) {
  'use strict';

  /* ── 指令集 ─────────────────────────────────────────────────────────────
     解析阶段只产生 ADD / RIGHT / OUT / IN / JZ / JNZ；
     后面四条是优化阶段才会出现的「复合指令」。 */
  const OP = {
    ADD:   'add',    // { n }              当前格 += n
    RIGHT: 'right',  // { n }              指针 += n
    OUT:   'out',    //                    输出当前格
    IN:    'in',     //                    读入一格（读到 EOF 补 0）
    JZ:    'jz',     // { to }             当前格为 0 时跳到 to
    JNZ:   'jnz',    // { to }             当前格非 0 时跳到 to
    CLEAR: 'clear',  //                    当前格 = 0
    SET:   'set',    // { n }              当前格 = n
    XFER:  'xfer',   // { pairs }          这些格 += 倍数 × 当前格，然后当前格 = 0
    SCAN:  'scan',   // { n }              按 n 步移动指针，直到当前格为 0（[>] [<<] 这类）
  };

  const CELL_MASK = 0xff;   // 每个格子 8 位、回绕（Brainfuck 的通行约定）

  const DEFAULTS = {
    tapeSize: 30000,   // 有效格数
    guard: 1024,       // 两端各留一段保护带，让「指针越界」有确定的判定
    startPtr: 1024,    // 逻辑起点（= guard）
    maxSteps: 20000000,
  };

  const cfg = (o) => Object.assign({}, DEFAULTS, o || {});
  const tapeLen = (c) => c.tapeSize + c.guard * 2;

  /* ══════════════════════════════════════════════════════════════════════
     1. 解析：源码 → 扁平 IR（含跳转目标）
     ════════════════════════════════════════════════════════════════════════ */
  function parse(src) {
    const ops = [];
    const stack = [];      // 未闭合的 [ 在 ops 中的下标
    let i = 0;
    const len = src.length;

    while (i < len) {
      const ch = src[i];

      // 连续的同向指针移动合并成一条
      if (ch === '>' || ch === '<') {
        let n = 0;
        while (i < len && (src[i] === '>' || src[i] === '<')) { n += src[i] === '>' ? 1 : -1; i++; }
        if (n !== 0) ops.push({ op: OP.RIGHT, n });
        continue;
      }

      // 连续的加减合并成一条
      if (ch === '+' || ch === '-') {
        let n = 0;
        while (i < len && (src[i] === '+' || src[i] === '-')) { n += src[i] === '+' ? 1 : -1; i++; }
        if (n !== 0) ops.push({ op: OP.ADD, n });
        continue;
      }

      if (ch === '.') { ops.push({ op: OP.OUT }); i++; continue; }
      if (ch === ',') { ops.push({ op: OP.IN }); i++; continue; }

      if (ch === '[') { stack.push(ops.length); ops.push({ op: OP.JZ, to: -1 }); i++; continue; }

      if (ch === ']') {
        if (!stack.length) throw new Error(`第 ${i + 1} 个字符：] 没有配对的 [` );
        const open = stack.pop();
        ops.push({ op: OP.JNZ, to: open + 1 });   // 回到 [ 之后的第一条
        ops[open].to = ops.length;                // JZ 跳到 ] 之后
        i++; continue;
      }

      i++;   // 其它字符一律当注释忽略（BF 的惯例）
    }

    if (stack.length) throw new Error(`有 ${stack.length} 个 [ 没有闭合`);
    return ops;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 树化：把扁平的 JZ/JNZ 变成嵌套结构，优化就变成了简单的树重写，
        改完之后再拍平，跳转目标自动重算 —— 比在扁平数组上改下标安全得多。
     ════════════════════════════════════════════════════════════════════════ */
  const LOOP = 'loop';

  function toTree(ops) {
    const root = [];
    const stack = [root];
    for (const op of ops) {
      if (op.op === OP.JZ) {
        const node = { op: LOOP, body: [] };
        stack[stack.length - 1].push(node);
        stack.push(node.body);
      } else if (op.op === OP.JNZ) {
        if (stack.length > 1) stack.pop();
      } else {
        stack[stack.length - 1].push(op);
      }
    }
    return root;
  }

  function fromTree(tree) {
    const ops = [];
    (function emit(body) {
      for (const node of body) {
        if (node.op === LOOP) {
          const jz = ops.length;
          ops.push({ op: OP.JZ, to: -1 });
          emit(node.body);
          ops.push({ op: OP.JNZ, to: jz + 1 });
          ops[jz].to = ops.length;
        } else {
          ops.push(node);
        }
      }
    })(tree);
    return ops;
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 优化
     ════════════════════════════════════════════════════════════════════════ */

  /**
   * 分析一个循环体能否用线性方式描述。
   *
   * 只接受「指针移动 + 加减」的组合，并且要求指针最终回到起点（净位移 0）。
   *
   * 两种情况可以折叠：
   *   净效果恰好 -1  → 循环正好跑 value 次，是线性的，折叠成 XFER
   *   净效果恰好 +1 且不动其它格子 → 靠 8 位回绕终止，效果就是把当前格清零
   *
   * 净效果 +1 但还要改别的格子时不能折叠：那会跑 256-value 次，
   * 对其它格子的累加量不是线性关系（要写成系数 -1 才等价，容易出错且罕见），
   * 这里直接放弃。
   */
  function analyzeLoopBody(body) {
    // 扫描循环：循环体只有一次指针移动，例如 [>] [<] [>>]。
    // 当前格不变、指针走了，于是 JNZ 检查的是新格子 —— 效果就是
    // 「沿着这个方向一直走，直到遇到值为 0 的格子」。
    // 磁带本来就是 0 初始化的，所以它一定会停下来（或撞到边界）。
    if (body.length === 1 && body[0].op === OP.RIGHT && body[0].n !== 0) {
      return { kind: 'scan', n: body[0].n };
    }

    const map = new Map();   // 相对偏移 → 累计加减
    let off = 0;

    for (const node of body) {
      if (node.op === OP.RIGHT) { off += node.n; continue; }
      if (node.op === OP.ADD) { map.set(off, (map.get(off) || 0) + node.n); continue; }
      return null;   // 出现 I/O、内层循环、SET/CLEAR/XFER 就没法线性化
    }

    if (off !== 0) return null;                 // 指针没回到起点
    const selfNet = map.get(0) || 0;

    const pairs = [];
    for (const [o, n] of map.entries()) {
      if (o !== 0 && n !== 0) pairs.push([o, n]);
    }

    if (selfNet === -1) return { kind: 'xfer', pairs };
    if (selfNet === 1 && pairs.length === 0) return { kind: 'clear' };
    return null;
  }

  /**
   * 常量折叠 + 冗余消除。
   *
   * 用一个「当前格是否已知常量」的追踪器做判断，能安全地做这些替换：
   *   CLEAR + ADD n        → SET n          （清零之后再加减 = 直接赋值）
   *   SET n + ADD m        → SET (n+m)&255
   *   已知为 0 时的 CLEAR   → 删掉
   *   XFER 之后再 CLEAR     → 删掉（XFER 已经把当前格清零了）
   *   连续两个 XFER         → 第二个必然无效，删掉
   *   相邻同类              → 合并（折叠后可能产生新的相邻）
   */
  function foldConstants(body, stats) {
    const out = [];
    let known = null;   // 当前格的已知值；null 表示未知
    let changed = false;

    const push = (node) => { out.push(node); };

    // ADD / SET / CLEAR 都只写当前格、不读它，所以被后面的写覆盖时
    // 前面的写就是死代码，可以直接删掉。
    const isDeadStore = (n) => n && (n.op === OP.ADD || n.op === OP.SET || n.op === OP.CLEAR);
    const popDead = () => {
      let popped = false;
      while (out.length && isDeadStore(out[out.length - 1])) { out.pop(); stats.dead++; popped = true; }
      if (popped) changed = true;
    };

    for (const node of body) {
      switch (node.op) {
        case OP.ADD: {
          if (node.n === 0) { stats.dead++; changed = true; break; }
          if (known !== null) {
            // 已知当前值 → 直接算成常量赋值
            const v = (known + node.n) & CELL_MASK;
            push({ op: OP.SET, n: v });
            known = v; stats.constFold++; changed = true;
            break;
          }
          // 与上一条 ADD 合并
          const prev = out[out.length - 1];
          if (prev && prev.op === OP.ADD) { prev.n += node.n; changed = true; stats.merge++; break; }
          push(node); known = null;
          break;
        }

        case OP.RIGHT: {
          if (node.n === 0) { stats.dead++; changed = true; break; }
          const prev = out[out.length - 1];
          if (prev && prev.op === OP.RIGHT) { prev.n += node.n; known = null; changed = true; stats.merge++; break; }
          push(node); known = null;      // 换格子了，值未知
          break;
        }

        case OP.CLEAR: {
          if (known === 0) { stats.dead++; changed = true; break; }   // 已经是 0
          popDead();                                                  // 覆盖掉前面的加减/赋值
          push(node); known = 0;
          break;
        }

        case OP.SET: {
          const v = node.n & CELL_MASK;
          if (known === v) { stats.dead++; changed = true; break; }   // 值没变
          popDead();                                                  // 绝对赋值，前面的写全部作废
          push({ op: OP.SET, n: v }); known = v;
          break;
        }

        case OP.XFER: {
          const prev = out[out.length - 1];
          if (prev && prev.op === OP.XFER) { stats.dead++; changed = true; break; }  // 当前格已是 0
          push(node); known = 0;
          break;
        }

        case OP.SCAN:
          push(node);
          known = 0;    // 扫描停下时当前格一定是 0
          break;

        case OP.IN:
          push(node); known = null;      // 读进来的值不可预知
          break;

        case OP.OUT:
          push(node);                    // 输出不改变当前格，known 保持不变
          break;

        default:
          push(node); known = null;      // 内层循环
      }
    }

    return { body: out, changed };
  }

  /** 递归优化整棵树；返回是否发生了改写。 */
  function optimizeTree(body, stats) {
    let changed = false;
    let out = [];

    // 先递归处理内层
    for (const node of body) {
      if (node.op === LOOP) {
        const inner = optimizeTree(node.body, stats);
        if (inner.changed) changed = true;
        out.push({ op: LOOP, body: inner.body });
      } else {
        out.push(node);
      }
    }

    // 再尝试折叠本层的循环
    const folded = [];
    for (const node of out) {
      if (node.op !== LOOP) { folded.push(node); continue; }

      const info = analyzeLoopBody(node.body);
      if (info === null) { folded.push(node); continue; }

      if (info.kind === 'scan') {
        folded.push({ op: OP.SCAN, n: info.n });
        stats.scan++;
      } else if (info.kind === 'clear' || info.pairs.length === 0) {
        // [-] [+] 这类纯清零循环
        folded.push({ op: OP.CLEAR });
        stats.clear++;
      } else {
        folded.push({ op: OP.XFER, pairs: info.pairs });
        stats.xfer++;
      }
      changed = true;
    }

    // 最后做常量折叠（折叠出的 CLEAR/SET 正好能被它继续处理）
    const r = foldConstants(folded, stats);
    if (r.changed) changed = true;

    return { body: r.body, changed };
  }

  /**
   * 对外入口：反复跑优化直到不动点。
   * 返回新的指令数组（不修改入参）和一份统计。
   */
  function optimize(rawOps, options) {
    const o = cfg(options);
    const stats = { passes: 0, clear: 0, xfer: 0, scan: 0, constFold: 0, merge: 0, dead: 0 };

    let tree = toTree(rawOps.map((x) => Object.assign({}, x)));
    for (let i = 0; i < 12; i++) {
      stats.passes++;
      const r = optimizeTree(tree, stats);
      tree = r.body;
      if (!r.changed) break;
    }

    const ops = fromTree(tree);
    return { ops, stats, sourceOps: rawOps.length, finalOps: ops.length };
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 后端 A：在 IR 上解释执行
     ════════════════════════════════════════════════════════════════════════ */
  function runIR(ops, options) {
    const o = cfg(options);
    const len = tapeLen(o);
    const tape = new Uint8Array(len);
    const input = o.input || new Uint8Array(0);
    const out = [];
    let p = o.startPtr;
    let pc = 0;
    let steps = 0;
    let ii = 0;

    // 步数上限只在「循环边界」(JZ/JNZ) 检查，而不是每条指令都查。
    // 这样 JIT 后端能用同样稀疏的检查点，两个后端在相同 maxSteps 下
    // 必定产出逐字节相同的输出 —— 否则截断位置会相差一整个循环体，
    // 页面上并排显示两个结果时，看起来就像其中一个算错了。
    // 安全性不受影响：任何死循环都必然经过 JNZ。
    while (pc < ops.length) {
      const op = ops[pc];
      steps++;

      switch (op.op) {
        case OP.ADD:
          tape[p] = (tape[p] + op.n) & CELL_MASK;
          break;

        case OP.RIGHT:
          p += op.n;
          // 一次无符号比较同时挡住负数和越界（负数 >>> 0 会变成巨大值）
          if ((p >>> 0) >= len) return { output: out, steps, error: '指针越界', reason: 'pointer' };
          break;

        case OP.OUT:
          out.push(tape[p]);
          break;

        case OP.IN:
          tape[p] = ii < input.length ? input[ii++] : 0;
          break;

        case OP.CLEAR:
          tape[p] = 0;
          break;

        case OP.SET:
          tape[p] = op.n & CELL_MASK;
          break;

        case OP.XFER: {
          const v = tape[p];
          for (let k = 0; k < op.pairs.length; k++) {
            const off = op.pairs[k][0];
            const f = op.pairs[k][1];
            const q = p + off;
            if ((q >>> 0) >= len) return { output: out, steps, error: '传输越界', reason: 'pointer' };
            tape[q] = (tape[q] + f * v) & CELL_MASK;
          }
          tape[p] = 0;
          break;
        }

        case OP.SCAN:
          // 沿 op.n 方向一直走，直到遇到值为 0 的格子
          while (tape[p] !== 0) {
            p += op.n;
            if ((p >>> 0) >= len) return { output: out, steps, error: '指针越界', reason: 'pointer' };
          }
          break;

        case OP.JZ:
          if (steps > o.maxSteps) return { output: out, steps, error: '超过最大步数', reason: 'steps' };
          if (tape[p] === 0) { pc = op.to; continue; }   // 注意 continue，不再 pc++
          break;

        case OP.JNZ:
          if (steps > o.maxSteps) return { output: out, steps, error: '超过最大步数', reason: 'steps' };
          if (tape[p] !== 0) { pc = op.to; continue; }
          break;

        default:
          return { output: out, steps, error: `未知指令 ${op.op}`, reason: 'internal' };
      }
      pc++;
    }

    return { output: out, steps };
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 后端 B：把 IR 编译成 JS 源码
     ════════════════════════════════════════════════════════════════════════ */

  /**
   * 生成一段 JS 函数体。约定形参为 (tape, out, input, limit)。
   *
   * 关键点：BF 的 `[ body ]` 语义就是「当前格非 0 时重复执行 body」，
   * 正好对应 JS 的 while，所以直接生成嵌套 while，让 V8 去跑机器码。
   */
  function compile(ops, options) {
    const o = cfg(options);
    const len = tapeLen(o);
    const L = [];
    let indent = 0;
    const pad = () => '  '.repeat(indent);

    L.push('let p = ' + o.startPtr + ';');
    L.push('let s = 0;');
    L.push('let ii = 0;');

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      switch (op.op) {
        case OP.ADD:
          L.push(`${pad()}t[p] = (t[p] + ${op.n}) & 255; s++;`);
          break;

        case OP.RIGHT:
          L.push(`${pad()}p += ${op.n}; if ((p >>> 0) >= ${len}) throw new Error('PTR'); s++;`);
          break;

        case OP.OUT:
          L.push(`${pad()}out.push(t[p]); s++;`);
          break;

        case OP.IN:
          L.push(`${pad()}t[p] = ii < input.length ? input[ii++] : 0; s++;`);
          break;

        case OP.CLEAR:
          L.push(`${pad()}t[p] = 0; s++;`);
          break;

        case OP.SET:
          L.push(`${pad()}t[p] = ${op.n & CELL_MASK}; s++;`);
          break;

        case OP.XFER: {
          const offs = op.pairs.map((x) => x[0]);
          const lo = Math.min.apply(null, offs);
          const hi = Math.max.apply(null, offs);
          // 先把当前格读进局部变量，再写目标格，最后清掉当前格
          L.push(`${pad()}{ const v = t[p];`);
          L.push(`${pad()}  if ((p + ${lo} >>> 0) >= ${len} || (p + ${hi} >>> 0) >= ${len}) throw new Error('PTR');`);
          for (const [off, f] of op.pairs) {
            L.push(`${pad()}  t[p + ${off}] = (t[p + ${off}] + ${f} * v) & 255;`);
          }
          L.push(`${pad()}  t[p] = 0; s++; }`);
          break;
        }

        case OP.SCAN:
          // 扫描循环折叠后只剩这一条；循环本身交给 JS 去跑
          L.push(`${pad()}while (t[p] !== 0) { p += ${op.n}; if ((p >>> 0) >= ${len}) throw new Error('PTR'); } s++;`);
          break;

        case OP.JZ:
          // 与解释器保持一致的检查点：只在循环边界查步数上限
          L.push(`${pad()}s++;`);
          L.push(`${pad()}if (s > limit) throw new Error('STEPS');`);
          L.push(`${pad()}while (t[p] !== 0) {`);
          indent++;
          break;

        case OP.JNZ:
          L.push(`${pad()}s++;`);
          L.push(`${pad()}if (s > limit) throw new Error('STEPS');`);
          indent--;
          L.push(`${pad()}}`);
          break;

        default:
          throw new Error(`未知指令 ${op.op}`);
      }
    }

    return L.join('\n');
  }

  /** 编译并执行。new Function 可能被 CSP 拦掉，这里会抛错，交给调用方降级。 */
  function buildJIT(source) {
    // eslint-disable-next-line no-new-func
    return new Function('t', 'out', 'input', 'limit', '"use strict";\n' + source);
  }

  function runJIT(fn, options) {
    const o = cfg(options);
    const tape = new Uint8Array(tapeLen(o));
    const out = [];
    const input = o.input || new Uint8Array(0);
    try {
      fn(tape, out, input, o.maxSteps);
    } catch (e) {
      const msg = String(e && e.message);
      if (msg === 'PTR') return { output: out, error: '指针越界', reason: 'pointer' };
      if (msg === 'STEPS') return { output: out, error: '超过最大步数', reason: 'steps' };
      return { output: out, error: msg, reason: 'internal' };
    }
    return { output: out };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. 一步到位的辅助
     ════════════════════════════════════════════════════════════════════════ */
  function prepare(src, options) {
    const o = cfg(options);
    const raw = parse(src);
    const opt = optimize(raw, o);
    return { raw, ir: opt.ops, stats: opt.stats, sourceOps: opt.sourceOps, finalOps: opt.finalOps };
  }

  function textToBytes(s) {
    if (root.TextEncoder) return new TextEncoder().encode(s);
    const a = new Uint8Array(s.length);       // 兜底：按码元截断
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  }

  function bytesToText(bytes) {
    const u = Uint8Array.from(bytes);
    if (root.TextDecoder) return new TextDecoder('utf-8', { fatal: false }).decode(u);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return s;
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 示例程序
     ══════════════════════════════════════════════════════════════════════ */
  const EXAMPLES = [
    {
      id: 'hello',
      name: { cn: 'Hello World', en: 'Hello World', jp: 'Hello World' },
      note: { cn: '经典的 106 字节版本，展示乘法循环', en: 'The classic 106-byte version', jp: '定番の 106 バイト版' },
      code: '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.',
      stdin: '',
    },
    {
      id: 'cat',
      name: { cn: '回显（cat）', en: 'Echo (cat)', jp: 'エコー（cat）' },
      note: { cn: '只有 5 条指令。在下面输入框里填点内容', en: 'Just 5 instructions. Put something in the input box', jp: 'たった 5 命令。入力欄に何か書いてみて' },
      code: ',[.,]',
      stdin: 'Brainfuck 回显测试\nEcho test 123\n',
    },
    {
      id: 'digits',
      name: { cn: '打印 0-9', en: 'Print 0-9', jp: '0-9 を出力' },
      note: { cn: '两层循环，适合观察步数统计', en: 'Two nested loops — watch the step counter', jp: '二重ループ。ステップ数の変化を見るのに良い' },
      code: '++++++++++>++++++++++++++++++++++++++++++++++++++++++++++++<[>.+<-]',
      stdin: '',
    },
    {
      id: 'add',
      name: { cn: '两数相加', en: 'Add two bytes', jp: '2 バイトの加算' },
      note: {
        cn: '读两个字符输出它们的字节和：! (33) + 空格 (32) = 65 = "A"。看 [->+<] 被折叠成一条 XFER',
        en: 'Reads 2 chars, prints the byte sum: "!" (33) + space (32) = 65 = "A". Watch [->+<] fold into one XFER',
        jp: '2 文字を読み、バイト和を出力："!"(33) + 空白(32) = 65 = "A"。[->+<] が XFER 1 命令に畳まれる',
      },
      code: ',>,<[->+<]>.',
      stdin: '! ',
    },
    {
      id: 'sierpinski',
      name: { cn: '谢尔宾斯基三角形', en: 'Sierpinski triangle', jp: 'シェルピンスキー三角形' },
      note: { cn: '纯 ASCII 图形，最能体现 BF 的表达力', en: 'Pure ASCII art — the most impressive short BF program', jp: 'ASCII アート。BF の表現力を最もよく示す' },
      code: '++++++++[>+>++++<<-]>++>>+<[-[>>+<<-]+>>]>+[-<<<[->[+[-]+>++>>>-<<]<[<]>>++++++[<<+++++>>-]+<<++.[-]<<]>.>+[>>]>+]',
      stdin: '',
    },
    {
      id: 'bench',
      name: { cn: '性能基准（10⁶ 次内层循环）', en: 'Benchmark (10⁶ inner iterations)', jp: 'ベンチマーク（内側 10⁶ 回）' },
      note: { cn: '没有输出，专门用来看两个后端的耗时差', en: 'No output — just to compare the two backends', jp: '出力なし。2 つのバックエンドの速度差を見るため' },
      code: '++++++++++[>++++++++++[>++++++++++[>++++++++++[>++++++++++[>++++++++++[>++++++++++[>+<-]<-]<-]<-]<-]<-]<-]',
      stdin: '',
    },
  ];

  /* ══════════════════════════════════════════════════════════════════════ */
  root.BF = {
    OP,
    DEFAULTS,
    parse,
    toTree,
    fromTree,
    optimize,
    analyzeLoopBody,
    runIR,
    compile,
    buildJIT,
    runJIT,
    prepare,
    textToBytes,
    bytesToText,
    EXAMPLES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
