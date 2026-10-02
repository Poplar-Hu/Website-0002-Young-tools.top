/* ============================================================================
   在线工具站 —— 共享脚本
   1) 导航栏交互（滚动加深、移动端菜单）
   2) window.Tools：各工具页复用的通用函数
   ========================================================================== */

(() => {
  'use strict';

  /* ── 导航栏：滚动后加深 ─────────────────────────────────────────────── */
  const navbar = document.getElementById('navbar');
  if (navbar) {
    const onScroll = () => navbar.classList.toggle('is-scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── 移动端菜单 ─────────────────────────────────────────────────────── */
  const toggle = document.getElementById('menu-toggle');
  const links = document.getElementById('nav-links');
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle('is-open', open);
      toggle.innerHTML = open ? '<i class="fa fa-times"></i>' : '<i class="fa fa-bars"></i>';
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!links.classList.contains('is-open')));
    links.addEventListener('click', (e) => { if (e.target.tagName === 'A') setOpen(false); });
  }
})();

/* ══════════════════════════════════════════════════════════════════════════
   通用工具函数
   ════════════════════════════════════════════════════════════════════════ */

window.Tools = (() => {
  'use strict';

  /** 触发浏览器下载 */
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 稍后释放，避免某些浏览器还没开始下载就失效
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
    downloadBlob(filename, new Blob([text], { type: mime }));
  }

  /** 复制到剪贴板；非安全上下文（http 且非 localhost）时降级到 execCommand */
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* 落到下面的降级分支 */ }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  /** 读取本地文件为文本（配合 <input type=file> 或拖放） */
  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file, 'utf-8');
    });
  }

  /** 防抖 */
  function debounce(fn, wait = 300) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** 右下角轻提示 */
  let toastEl = null;
  let toastTimer = null;
  function toast(message, kind = 'info') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'tools-toast';
      toastEl.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%) translateY(12px)',
        'padding:10px 20px', 'border-radius:999px', 'font-size:.9rem', 'font-weight:500',
        'color:#fff', 'z-index:999', 'pointer-events:none', 'opacity:0',
        'transition:opacity .25s, transform .25s', 'box-shadow:0 10px 25px -5px rgba(15,23,42,.35)',
        'max-width:90vw', 'text-align:center',
      ].join(';');
      document.body.appendChild(toastEl);
    }
    const colors = { info: '#3B82F6', ok: '#10B981', warn: '#F59E0B', error: '#EC4899' };
    toastEl.style.background = colors[kind] || colors.info;
    toastEl.textContent = message;
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(12px)';
    }, 1800);
  }

  /** 取当前时间戳，用作文件名后缀 */
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  return { downloadBlob, downloadText, copy, readTextFile, debounce, toast, stamp };
})();
