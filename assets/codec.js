/* ============================================================================
   编码 / 解码引擎
   ----------------------------------------------------------------------------
   设计成一个「配方（recipe）」模型：左侧挑操作，串成一条链，数据依次流过。
   这样 Base64 → URL 解码、Hex → 文本 这类常见需求就是两步而已。

   每个操作签名统一为：
       run(text, params) -> string | Promise<string>

   内部需要字节时临时转（UTF-8），对调用方始终是「文本进、文本出」——
   少一层心智负担，也让链式组合天然成立。

   与 bf.js 一样，本文件不依赖 DOM，挂在 globalThis 上，
   所以可以直接用 node 跑 round-trip 测试。
   ========================================================================== */
(function (root) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 基础工具
     ════════════════════════════════════════════════════════════════════════ */
  const utf8Encode = (s) => new TextEncoder().encode(s);
  const utf8Decode = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));

  /** 带错误码的异常 —— 页面据此查语言包，而不是把英文/中文硬编码在引擎里 */
  class CodecError extends Error {
    constructor(code, vars) {
      super(code);
      this.name = 'CodecError';
      this.code = code;
      this.vars = vars || {};
    }
  }
  const fail = (code, vars) => { throw new CodecError(code, vars); };

  const toHex = (bytes, upper) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    .replace(upper ? /[a-f]/g : /$^/, (c) => c.toUpperCase());

  /* ══════════════════════════════════════════════════════════════════════
     1. Base64 / Base32 / Base58 / Hex
     ════════════════════════════════════════════════════════════════════════ */
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_REV = (() => { const m = new Map(); for (let i = 0; i < 64; i++) m.set(B64[i], i); return m; })();

  function base64Encode(text, p) {
    const bytes = utf8Encode(text);
    const table = p.urlSafe ? B64.slice(0, 62) + '-_' : B64;
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += table[b0 >> 2];
      out += table[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      if (b1 === undefined) { if (p.pad) out += '=='; break; }
      out += table[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      if (b2 === undefined) { if (p.pad) out += '='; break; }
      out += table[b2 & 63];
    }
    return out;
  }

  function base64Decode(text) {
    // '+' 与 '-'、'/' 与 '_' 不会互相冲突，所以两种字母表可以无条件兼容
    const s = String(text).replace(/[\s\r\n]/g, '')
      .replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of s) {
      const v = B64_REV.get(ch);
      if (v === undefined) fail('invalid-char', { ch });
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
    }
    return utf8Decode(out);
  }

  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const B32_REV = (() => { const m = new Map(); for (let i = 0; i < 32; i++) m.set(B32[i], i); return m; })();

  function base32Encode(text) {
    const bytes = utf8Encode(text);
    let out = '', buf = 0, bits = 0;
    for (const b of bytes) {
      buf = (buf << 8) | b;
      bits += 8;
      while (bits >= 5) { bits -= 5; out += B32[(buf >> bits) & 31]; }
    }
    if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
    while (out.length % 8) out += '=';
    return out;
  }

  function base32Decode(text) {
    const s = String(text).toUpperCase().replace(/[\s\r\n=]/g, '');
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of s) {
      const v = B32_REV.get(ch);
      if (v === undefined) fail('invalid-char', { ch });
      buf = (buf << 5) | v;
      bits += 5;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
    }
    return utf8Decode(out);
  }

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const B58_REV = (() => { const m = new Map(); for (let i = 0; i < 58; i++) m.set(B58[i], i); return m; })();

  function base58Encode(text) {
    const bytes = utf8Encode(text);
    // 累加器从空数组开始（不是 [0]）—— 否则全零输入会多出一个 '1'
    const digits = [];
    for (const b of bytes) {
      let carry = b;
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '';
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';   // 前导 0 字节 → '1'
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  function base58Decode(text) {
    const s = String(text).replace(/[\s\r\n]/g, '');
    if (!s) return '';
    const bytes = [];
    for (const ch of s) {
      const v = B58_REV.get(ch);
      if (v === undefined) fail('invalid-char', { ch });
      let carry = v;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0);
    bytes.reverse();
    return utf8Decode(bytes);
  }

  function hexEncode(text, p) {
    const h = toHex(utf8Encode(text), p.upper);
    if (!p.spaced) return h;
    return h.replace(/(..)(?=.)/g, '$1 ');
  }

  function hexDecode(text) {
    const s = String(text).replace(/0x/gi, '').replace(/[\s\r\n,:-]/g, '');
    if (s.length % 2) fail('bad-length', { what: 'hex' });
    if (/[^0-9a-fA-F]/.test(s)) {
      const bad = s.match(/[^0-9a-fA-F]/)[0];
      fail('invalid-char', { ch: bad });
    }
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return utf8Decode(out);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 文本编码：URL / HTML 实体 / Unicode 转义 / 二进制
     ════════════════════════════════════════════════════════════════════════ */
  const urlEncode = (text, p) => (p.component ? encodeURIComponent(text) : encodeURI(text));
  const urlDecode = (text, p) => {
    try { return p.component ? decodeURIComponent(text) : decodeURI(text); }
    catch (e) { fail('bad-format', { detail: 'URI' }); }
  };

  const HTML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', times: '×', divide: '÷', laquo: '«', raquo: '»', middot: '·', deg: '°', euro: '€', pound: '£', yen: '¥', sect: '§', para: '¶' };
  const HTML_NAMED_REV = (() => {
    const m = new Map();
    for (const [k, v] of Object.entries(HTML_NAMED)) m.set(v, k);
    return m;
  })();

  function htmlEncode(text, p) {
    return Array.from(text).map((ch) => {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      if (ch === "'") return '&#39;';
      if (!p.onlySpecial) {
        const named = HTML_NAMED_REV.get(ch);
        if (named) return `&${named};`;
      }
      const cp = ch.codePointAt(0);
      if (cp > 126 && !p.asciiOnly) return `&#${cp};`;
      return ch;
    }).join('');
  }

  function htmlDecode(text) {
    return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
        return String.fromCodePoint(cp);
      }
      return Object.prototype.hasOwnProperty.call(HTML_NAMED, body) ? HTML_NAMED[body] : whole;
    });
  }

  const unicodeEncode = (text, p) => Array.from(text).map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xffff) return '\\u' + cp.toString(16).padStart(4, '0').toUpperCase();
    // 星平面字符要拆成代理对
    const s = cp - 0x10000;
    const hi = 0xd800 + (s >> 10);
    const lo = 0xdc00 + (s & 0x3ff);
    return '\\u' + hi.toString(16).padStart(4, '0').toUpperCase() + '\\u' + lo.toString(16).padStart(4, '0').toUpperCase();
  }).join(p.spaced ? ' ' : '');

  function unicodeDecode(text) {
    return String(text)
      // 「空格分隔的转义序列」里的分隔空格要去掉。只删「后面还紧跟着转义」的那些，
      // 否则 `\u4E2D A` 这种末尾的字面空格会被误删。
      .replace(/(\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})\s+(?=\\u|U\+|&#)/g, '$1')
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (w, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (w, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/U\+([0-9a-fA-F]{4,6})/g, (w, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (w, d) => String.fromCodePoint(Number(d)));
  }

  const binaryEncode = (text, p) => {
    const bits = Array.from(utf8Encode(text), (b) => b.toString(2).padStart(8, '0'));
    return p.group ? bits.join(' ') : bits.join('');
  };

  function binaryDecode(text) {
    const s = String(text).replace(/[^01]/g, '');
    if (!s.length) return '';
    if (s.length % 8) fail('bad-length', { what: 'binary' });
    const out = new Uint8Array(s.length / 8);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 8, 8), 2);
    return utf8Decode(out);
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 古典密码
     ════════════════════════════════════════════════════════════════════════ */
  const isUpper = (c) => c >= 65 && c <= 90;
  const isLower = (c) => c >= 97 && c <= 122;

  function rotN(text, shift) {
    const n = ((shift % 26) + 26) % 26;
    return String(text).replace(/[a-zA-Z]/g, (ch) => {
      const base = isUpper(ch.charCodeAt(0)) ? 65 : 97;
      return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
    });
  }

  const atbash = (text) => String(text).replace(/[a-zA-Z]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (isUpper(c)) return String.fromCharCode(90 - (c - 65));
    return String.fromCharCode(122 - (c - 97));
  });

  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
    I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
    Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
    Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
    '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
    ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
    '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
  };
  const MORSE_REV = (() => { const m = new Map(); for (const [k, v] of Object.entries(MORSE)) m.set(v, k); return m; })();

  function morseEncode(text) {
    return String(text).toUpperCase().split(/\s+/).filter(Boolean).map((word) =>
      Array.from(word).map((ch) => {
        if (ch === ' ') return '';
        if (!MORSE[ch]) fail('invalid-char', { ch });
        return MORSE[ch];
      }).join(' ')
    ).join(' / ');
  }

  function morseDecode(text) {
    return String(text).trim().split(/\s*\/\s*/).map((word) =>
      word.trim().split(/\s+/).filter(Boolean).map((code) => {
        const ch = MORSE_REV.get(code);
        if (ch === undefined) fail('invalid-char', { ch: code });
        return ch;
      }).join('')
    ).join(' ');
  }

  function railEncode(text, rails) {
    const n = Math.max(2, rails | 0);
    const rows = Array.from({ length: n }, () => []);
    let r = 0, dir = 1;
    for (const ch of text) {
      rows[r].push(ch);
      if (r === 0) dir = 1; else if (r === n - 1) dir = -1;
      r += dir;
    }
    return rows.map((x) => x.join('')).join('');
  }

  function railDecode(text, rails) {
    const n = Math.max(2, rails | 0);
    const chars = Array.from(text);
    const len = chars.length;
    // 先算出每一行有多少个字符
    const counts = new Array(n).fill(0);
    let r = 0, dir = 1;
    for (let i = 0; i < len; i++) {
      counts[r]++;
      if (r === 0) dir = 1; else if (r === n - 1) dir = -1;
      r += dir;
    }
    // 按行切分，再按之字形读回
    const rows = [];
    let pos = 0;
    for (let i = 0; i < n; i++) { rows.push(chars.slice(pos, pos + counts[i])); pos += counts[i]; }
    const idx = new Array(n).fill(0);
    const out = [];
    r = 0; dir = 1;
    for (let i = 0; i < len; i++) {
      out.push(rows[r][idx[r]++]);
      if (r === 0) dir = 1; else if (r === n - 1) dir = -1;
      r += dir;
    }
    return out.join('');
  }

  function vigenere(text, key, sign) {
    const k = String(key).replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (!k) fail('need-param', { what: 'key' });
    let i = 0;
    return String(text).replace(/[a-zA-Z]/g, (ch) => {
      const base = isUpper(ch.charCodeAt(0)) ? 65 : 97;
      const shift = k.charCodeAt(i % k.length) - 65;
      i++;
      const v = (ch.charCodeAt(0) - base + sign * shift + 26 * 5) % 26;
      return String.fromCharCode(v + base);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 摘要 / 校验
     ════════════════════════════════════════════════════════════════════════ */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(text) {
    const bytes = utf8Encode(text);
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }

  /** RFC 1321 的直译。Web Crypto 不支持 MD5，所以得自己实现。 */
  function md5(text) {
    const bytes = utf8Encode(text);
    const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

    const len = bytes.length;
    const bitLen = len * 8;
    // 补一个 0x80，再补零到 56 (mod 64)，最后 8 字节放原始长度（小端）
    const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLen >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let j = 0; j < 64; j++) {
        let F, g;
        if (j < 16) { F = (B & C) | (~B & D); g = j; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; }
        F = (F + A + K[j] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << S[j]) | (F >>> (32 - S[j])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }

    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, a0 >>> 0, true);
    ov.setUint32(4, b0 >>> 0, true);
    ov.setUint32(8, c0 >>> 0, true);
    ov.setUint32(12, d0 >>> 0, true);
    return toHex(out, false);
  }

  async function webDigest(algo, text) {
    if (!root.crypto || !root.crypto.subtle) fail('no-webcrypto', { algo });
    const buf = await root.crypto.subtle.digest(algo, utf8Encode(text));
    return toHex(new Uint8Array(buf), false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 其他
     ════════════════════════════════════════════════════════════════════════ */
  function jwtDecode(text) {
    const parts = String(text).trim().split('.');
    if (parts.length < 2) fail('bad-format', { detail: 'JWT' });
    const seg = (s) => {
      try { return JSON.parse(base64Decode(s.replace(/-/g, '+').replace(/_/g, '/'))); }
      catch (e) { return null; }
    };
    const head = seg(parts[0]);
    const body = seg(parts[1]);
    if (!head && !body) fail('bad-format', { detail: 'JWT' });

    const lines = [];
    lines.push('── header ──');
    lines.push(head ? JSON.stringify(head, null, 2) : '(解不出)');
    lines.push('');
    lines.push('── payload ──');
    lines.push(body ? JSON.stringify(body, null, 2) : '(解不出)');
    if (parts.length > 2) {
      lines.push('');
      lines.push('── signature ──');
      lines.push(parts[2]);
    }
    if (body && typeof body.exp === 'number') {
      lines.push('');
      lines.push(`exp: ${new Date(body.exp * 1000).toISOString()}${body.exp * 1000 < Date.now() ? '  ← 已过期' : ''}`);
    }
    return lines.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. 操作注册表
     ════════════════════════════════════════════════════════════════════════ */
  const CATS = {
    base:    { cn: 'Base 编码', en: 'Base encoding', jp: 'Base エンコード' },
    text:    { cn: '文本编码', en: 'Text encoding', jp: 'テキストエンコード' },
    classic: { cn: '古典密码', en: 'Classical ciphers', jp: '古典暗号' },
    hash:    { cn: '摘要 / 校验', en: 'Digest / checksum', jp: 'ハッシュ / チェックサム' },
    misc:    { cn: '其他', en: 'Misc', jp: 'その他' },
  };

  const P = {
    urlSafe: () => ({ key: 'urlSafe', type: 'bool', def: true, label: { cn: 'URL 安全', en: 'URL-safe', jp: 'URL セーフ' } }),
    pad:     () => ({ key: 'pad', type: 'bool', def: true, label: { cn: '补 = 号', en: 'Pad with =', jp: '= で埋める' } }),
    upper:   () => ({ key: 'upper', type: 'bool', def: false, label: { cn: '大写', en: 'Uppercase', jp: '大文字' } }),
    spaced:  () => ({ key: 'spaced', type: 'bool', def: true, label: { cn: '空格分组', en: 'Space between bytes', jp: 'バイト間に空白' } }),
    group:   () => ({ key: 'group', type: 'bool', def: true, label: { cn: '空格分组', en: 'Space between bytes', jp: 'バイト間に空白' } }),
    component: () => ({ key: 'component', type: 'bool', def: true, label: { cn: '含保留字符', en: 'Encode reserved chars', jp: '予約文字も変換' } }),
    asciiOnly: () => ({ key: 'asciiOnly', type: 'bool', def: true, label: { cn: '只转 ASCII', en: 'ASCII only', jp: 'ASCII のみ' } }),
    onlySpecial: () => ({ key: 'onlySpecial', type: 'bool', def: false, label: { cn: '只转特殊字符', en: 'Special chars only', jp: '特殊文字のみ' } }),
    shift: (def) => ({ key: 'shift', type: 'number', def, min: 0, max: 25, label: { cn: '位移', en: 'Shift', jp: 'シフト' } }),
    rails: (def) => ({ key: 'rails', type: 'number', def, min: 2, max: 20, label: { cn: '栏数', en: 'Rails', jp: 'レール数' } }),
    key:   (def) => ({ key: 'key', type: 'text', def, label: { cn: '密钥', en: 'Key', jp: '鍵' } }),
  };

  const OPS = [
    /* ── Base ────────────────────────────────────────────────────────── */
    { id: 'b64-enc', cat: 'base', name: { cn: 'Base64 编码', en: 'Base64 encode', jp: 'Base64 エンコード' },
      params: [P.urlSafe(), P.pad()], run: base64Encode },
    { id: 'b64-dec', cat: 'base', name: { cn: 'Base64 解码', en: 'Base64 decode', jp: 'Base64 デコード' },
      params: [P.urlSafe()], run: base64Decode },
    { id: 'b32-enc', cat: 'base', name: { cn: 'Base32 编码', en: 'Base32 encode', jp: 'Base32 エンコード' },
      params: [], run: (t) => base32Encode(t) },
    { id: 'b32-dec', cat: 'base', name: { cn: 'Base32 解码', en: 'Base32 decode', jp: 'Base32 デコード' },
      params: [], run: (t) => base32Decode(t) },
    { id: 'b58-enc', cat: 'base', name: { cn: 'Base58 编码', en: 'Base58 encode', jp: 'Base58 エンコード' },
      params: [], run: (t) => base58Encode(t) },
    { id: 'b58-dec', cat: 'base', name: { cn: 'Base58 解码', en: 'Base58 decode', jp: 'Base58 デコード' },
      params: [], run: (t) => base58Decode(t) },
    { id: 'hex-enc', cat: 'base', name: { cn: '十六进制编码', en: 'Hex encode', jp: '16 進エンコード' },
      params: [P.upper(), P.spaced()], run: hexEncode },
    { id: 'hex-dec', cat: 'base', name: { cn: '十六进制解码', en: 'Hex decode', jp: '16 進デコード' },
      params: [], run: (t) => hexDecode(t) },

    /* ── 文本 ────────────────────────────────────────────────────────── */
    { id: 'url-enc', cat: 'text', name: { cn: 'URL 编码', en: 'URL encode', jp: 'URL エンコード' },
      params: [P.component()], run: urlEncode },
    { id: 'url-dec', cat: 'text', name: { cn: 'URL 解码', en: 'URL decode', jp: 'URL デコード' },
      params: [P.component()], run: urlDecode },
    { id: 'html-enc', cat: 'text', name: { cn: 'HTML 实体编码', en: 'HTML entity encode', jp: 'HTML 実体参照エンコード' },
      params: [P.onlySpecial()], run: htmlEncode },
    { id: 'html-dec', cat: 'text', name: { cn: 'HTML 实体解码', en: 'HTML entity decode', jp: 'HTML 実体参照デコード' },
      params: [], run: (t) => htmlDecode(t) },
    { id: 'uni-enc', cat: 'text', name: { cn: 'Unicode 转义', en: 'Unicode escape', jp: 'Unicode エスケープ' },
      params: [{ key: 'spaced', type: 'bool', def: false, label: { cn: '空格分隔', en: 'Space separated', jp: '空白区切り' } }], run: unicodeEncode },
    { id: 'uni-dec', cat: 'text', name: { cn: 'Unicode 还原', en: 'Unicode unescape', jp: 'Unicode アンエスケープ' },
      params: [], run: (t) => unicodeDecode(t) },
    { id: 'bin-enc', cat: 'text', name: { cn: '二进制表示', en: 'To binary', jp: '2 進表現' },
      params: [P.group()], run: binaryEncode },
    { id: 'bin-dec', cat: 'text', name: { cn: '二进制还原', en: 'From binary', jp: '2 進から復元' },
      params: [], run: (t) => binaryDecode(t) },

    /* ── 古典密码 ────────────────────────────────────────────────────── */
    { id: 'rot13', cat: 'classic', name: { cn: 'ROT13', en: 'ROT13', jp: 'ROT13' },
      params: [], run: (t) => rotN(t, 13) },
    { id: 'rot-n', cat: 'classic', name: { cn: 'ROT-N 位移', en: 'ROT-N', jp: 'ROT-N' },
      params: [P.shift(5)], run: (t, p) => rotN(t, Number(p.shift) || 0) },
    { id: 'rot-brute', cat: 'classic', name: { cn: 'ROT 暴力枚举', en: 'ROT brute force', jp: 'ROT 総当たり' },
      params: [], run: (t) => Array.from({ length: 26 }, (_, i) => `ROT${String(i).padStart(2)}: ${rotN(t, i)}`).join('\n') },
    { id: 'atbash', cat: 'classic', name: { cn: 'Atbash 反转字母表', en: 'Atbash', jp: 'Atbash' },
      params: [], run: (t) => atbash(t) },
    { id: 'morse-enc', cat: 'classic', name: { cn: '摩尔斯电码编码', en: 'Morse encode', jp: 'モールス符号エンコード' },
      params: [], run: (t) => morseEncode(t) },
    { id: 'morse-dec', cat: 'classic', name: { cn: '摩尔斯电码解码', en: 'Morse decode', jp: 'モールス符号デコード' },
      params: [], run: (t) => morseDecode(t) },
    { id: 'rail-enc', cat: 'classic', name: { cn: '栅栏密码编码', en: 'Rail fence encode', jp: 'レールフェンス暗号化' },
      params: [P.rails(3)], run: (t, p) => railEncode(t, Number(p.rails) || 3) },
    { id: 'rail-dec', cat: 'classic', name: { cn: '栅栏密码解码', en: 'Rail fence decode', jp: 'レールフェンス復号' },
      params: [P.rails(3)], run: (t, p) => railDecode(t, Number(p.rails) || 3) },
    { id: 'vig-enc', cat: 'classic', name: { cn: '维吉尼亚编码', en: 'Vigenère encode', jp: 'ヴィジュネル暗号化' },
      params: [P.key('KEY')], run: (t, p) => vigenere(t, p.key, 1) },
    { id: 'vig-dec', cat: 'classic', name: { cn: '维吉尼亚解码', en: 'Vigenère decode', jp: 'ヴィジュネル復号' },
      params: [P.key('KEY')], run: (t, p) => vigenere(t, p.key, -1) },

    /* ── 摘要 ────────────────────────────────────────────────────────── */
    { id: 'crc32', cat: 'hash', name: { cn: 'CRC32', en: 'CRC32', jp: 'CRC32' },
      params: [], run: (t) => crc32(t) },
    { id: 'md5', cat: 'hash', name: { cn: 'MD5', en: 'MD5', jp: 'MD5' },
      params: [], run: (t) => md5(t) },
    { id: 'sha1', cat: 'hash', name: { cn: 'SHA-1', en: 'SHA-1', jp: 'SHA-1' },
      params: [], run: (t) => webDigest('SHA-1', t) },
    { id: 'sha256', cat: 'hash', name: { cn: 'SHA-256', en: 'SHA-256', jp: 'SHA-256' },
      params: [], run: (t) => webDigest('SHA-256', t) },
    { id: 'sha512', cat: 'hash', name: { cn: 'SHA-512', en: 'SHA-512', jp: 'SHA-512' },
      params: [], run: (t) => webDigest('SHA-512', t) },

    /* ── 其他 ────────────────────────────────────────────────────────── */
    { id: 'jwt-dec', cat: 'misc', name: { cn: 'JWT 解码', en: 'JWT decode', jp: 'JWT デコード' },
      params: [], run: (t) => jwtDecode(t) },
  ];

  const OPS_BY_ID = (() => { const m = new Map(); for (const o of OPS) m.set(o.id, o); return m; })();

  /* ══════════════════════════════════════════════════════════════════════
     7. 执行配方
     ════════════════════════════════════════════════════════════════════════ */
  /**
   * 依次执行配方里的每个操作。
   * 返回 { text, ms, steps }。
   *
   * 出错时默认抛出（错误上带 step 索引）。传 { throwOnError: false } 则
   * 返回 { text: 出错前的结果, error }，页面据此既能报错、又不丢掉已算出的部分。
   */
  async function runRecipe(text, recipe, options) {
    const o = Object.assign({ throwOnError: true }, options || {});
    const t0 = performance.now();
    let out = String(text);
    const steps = [];

    const abort = (err, i) => {
      err.step = i;
      if (o.throwOnError) throw err;
      return { text: out, ms: performance.now() - t0, steps, error: err };
    };

    for (let i = 0; i < recipe.length; i++) {
      const step = recipe[i];
      const op = OPS_BY_ID.get(step.id);
      if (!op) return abort(new CodecError('unknown-op', { id: step.id }), i);
      const s0 = performance.now();
      try {
        out = await op.run(out, step.params || {});
      } catch (e) {
        return abort(e instanceof CodecError ? e : new CodecError('bad-format', { detail: e.message }), i);
      }
      steps.push({ id: op.id, ms: performance.now() - s0 });
    }
    return { text: out, ms: performance.now() - t0, steps };
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 示例配方
     ════════════════════════════════════════════════════════════════════════ */
  const SAMPLES = [
    {
      id: 'jwt',
      name: { cn: '解一个 JWT', en: 'Decode a JWT', jp: 'JWT を解く' },
      note: { cn: 'JWT 就是两段 Base64URL 拼起来的 JSON', en: 'A JWT is just two Base64URL-encoded JSON blobs', jp: 'JWT は Base64URL で符号化した JSON が 2 つ並んだもの' },
      input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlBvcHVsdXMgSHUiLCJpYXQiOjE3NjcyMjU2MDAsImV4cCI6MTc2NzIyOTIwMH0.dQw4w9WgXcQ7Kk8mZ1pN3vB6yT2xL5aR9cE4fH0jS8o',
      recipe: [{ id: 'jwt-dec', params: {} }],
    },
    {
      id: 'b64-url',
      name: { cn: 'Base64 → URL 解码', en: 'Base64 → URL decode', jp: 'Base64 → URL デコード' },
      note: { cn: '最常见的两层嵌套：参数先 Base64 再 URL 编码', en: 'The classic double wrap: Base64 inside a URL parameter', jp: '定番の二重ラップ：URL パラメータの中の Base64' },
      input: 'aHR0cHMlM0ElMkYlMkZ3aG8teW91bmcudG9wJTJGJUU1JUI3JUE1JUU1JTg1JUI3JUU3JUFFJUIxJTNGZnJvbSUzRGJhc2U2NA==',
      recipe: [{ id: 'b64-dec', params: { urlSafe: true } }, { id: 'url-dec', params: { component: true } }],
    },
    {
      id: 'hex-text',
      name: { cn: '十六进制 → 文本', en: 'Hex → text', jp: '16 進 → テキスト' },
      note: { cn: '带空格、带 0x 前缀都能识别', en: 'Handles spaces and 0x prefixes', jp: '空白や 0x 接頭辞も受け付けます' },
      input: 'E4 BD A0 E5 A5 BD EF BC 8C E4 B8 96 E7 95 8C',
      recipe: [{ id: 'hex-dec', params: {} }],
    },
    {
      id: 'rot',
      name: { cn: 'ROT 暴力枚举', en: 'ROT brute force', jp: 'ROT 総当たり' },
      note: { cn: '不知道位移量时，把 26 种可能一次列出来', en: 'When you do not know the shift, list all 26', jp: 'シフト量が不明なら 26 通りを全部出す' },
      input: 'Uryyb, Jbeyq!',
      recipe: [{ id: 'rot-brute', params: {} }],
    },
    {
      id: 'morse',
      name: { cn: '摩尔斯电码', en: 'Morse code', jp: 'モールス符号' },
      note: { cn: '字母之间空格，单词之间 /', en: 'Letters split by spaces, words by /', jp: '文字は空白、単語は / で区切ります' },
      input: 'SOS HELP',
      recipe: [{ id: 'morse-enc', params: {} }],
    },
    {
      id: 'digest',
      name: { cn: '一次算全部摘要', en: 'All digests at once', jp: 'ハッシュを一括計算' },
      note: { cn: '同一份输入串上 CRC32 / MD5 / SHA-256 —— 注意这是链式，不推荐这样用', en: 'Note this is a chain (each step feeds the next), which is not what you want for digests', jp: 'これはチェーン（前の出力が次に入る）なので、ハッシュ用途には不向きです' },
      input: 'hello',
      recipe: [{ id: 'sha256', params: {} }],
    },
  ];

  /* ══════════════════════════════════════════════════════════════════════ */
  root.Codec = {
    CodecError, OPS, OPS_BY_ID, CATS, SAMPLES,
    runRecipe,
    utf8Encode, utf8Decode, toHex,
    // 单独暴露一份，方便测试逐项 round-trip
    impl: { base64Encode, base64Decode, base32Encode, base32Decode, base58Encode, base58Decode,
      hexEncode, hexDecode, urlEncode, urlDecode, htmlEncode, htmlDecode,
      unicodeEncode, unicodeDecode, binaryEncode, binaryDecode,
      rotN, atbash, morseEncode, morseDecode, railEncode, railDecode, vigenere,
      crc32, md5, jwtDecode },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
