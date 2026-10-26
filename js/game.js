/* ============================================================
   蔬菜镇 · 游戏引擎
   ============================================================ */
(() => {
  'use strict';
  const D = window.GAME_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const sceneEl = $('#scene');
  const stage = $('#stage-ui');
  const overlayRoot = $('#overlay-root');
  const dlgEl = $('#dialogue');
  const flashEl = $('#flash');

  /* ---------------- 状态 ---------------- */
  const state = {
    chapter: 0,
    collected: new Set(),      // 线索 id
    asked: {},                 // resident -> {regular:[bool], follow:bool}
    testi: {},                 // resident -> {placed:bool}
    notes: new Set(),          // note1..3
    burnt: false,
    burntUnlocked: false,
    guided: {},                // resident -> true
    quizIndex: 0,
    archiveRead: new Set(),
    timer: 300,
    timerId: null,
    busy: false,
    sound: true,
    started: false
  };
  D.residents.forEach(id => { state.asked[id] = { regular: [false, false, false], follow: false }; });

  /* ================= 音频（无外部素材，纯合成） ================= */
  const audio = {
    ctx: null,
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq = 440, dur = 0.08, type = 'square', vol = 0.05) {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    click() { this.tone(660, 0.045, 'square', 0.035); },
    type() { this.tone(880 + Math.random() * 120, 0.02, 'square', 0.012); },
    chime() {
      if (!state.sound) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.24, 'sine', 0.06), i * 90));
    },
    tick() { this.tone(1200, 0.03, 'square', 0.03); },
    boom() {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      g.gain.value = 0.16;
      src.buffer = buffer;
      src.connect(g).connect(this.ctx.destination);
      src.start(t);
    },
    noise(dur = 0.2, vol = 0.05, filterFreq = 2400) {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const len = Math.max(1, this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = this.ctx.createBufferSource();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = filterFreq;
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t);
    },
    crunch() { this.noise(0.09, 0.13, 1500); this.tone(120 + Math.random() * 60, 0.09, 'sawtooth', 0.05); },
    heart() { this.tone(58, 0.32, 'sine', 0.16); setTimeout(() => this.tone(46, 0.4, 'sine', 0.12), 240); },
    spray() { this.noise(0.5, 0.12, 5200); },
    stamp() { this.tone(190, 0.09, 'square', 0.09); this.noise(0.09, 0.07, 700); },
    alarm() {
      if (!state.sound) return;
      [0, 520, 1040].forEach(dl => setTimeout(() => this.tone(760, 0.36, 'sawtooth', 0.06), dl));
    },
    bday() {
      if (!state.sound) return;
      const mel = [
        [392, 0], [392, 220], [440, 440], [392, 660], [523, 900], [494, 1200],
        [392, 1600], [392, 1820], [440, 2040], [392, 2260], [587, 2500], [523, 2800]
      ];
      const playOnce = () => {
        if (!state.sound || !state._bdayOn) return;
        mel.forEach(([f, dl]) => setTimeout(() => this.tone(f, 0.42, 'triangle', 0.05), dl));
      };
      state._bdayOn = true;
      playOnce();
      state._bdayId = setInterval(playOnce, 3200);
    },
    stopBday() {
      state._bdayOn = false;
      if (state._bdayId) { clearInterval(state._bdayId); state._bdayId = null; }
    },
    /* Lo-Fi 环境音：低频嗡鸣 + 遥远钟表滴答，用于前六幕悬疑氛围 */
    ambient() {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      this.stopAmbient();
      const t = this.ctx.currentTime;
      const drone = this.ctx.createOscillator();
      const droneG = this.ctx.createGain();
      drone.type = 'sine'; drone.frequency.value = 110;
      droneG.gain.value = 0.012;
      drone.connect(droneG).connect(this.ctx.destination);
      drone.start(t);
      this._drone = drone;
      this._ambientId = setInterval(() => {
        if (!state.sound) return;
        this.tone(820, 0.025, 'square', 0.008);
        setTimeout(() => this.tone(620, 0.02, 'square', 0.006), 180);
      }, 2400);
    },
    stopAmbient() {
      if (this._drone) { try { this._drone.stop(); } catch (e) {} this._drone = null; }
      if (this._ambientId) { clearInterval(this._ambientId); this._ambientId = null; }
    },
    /* 拆弹紧迫 8-bit 电子节拍 */
    bombBeat() {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      this.stopBombBeat();
      let step = 0;
      this._bombId = setInterval(() => {
        if (!state.sound) return;
        const kick = step % 4 === 0;
        const hat = step % 2 === 1;
        if (kick) this.tone(60, 0.12, 'sine', 0.13);
        if (hat) this.noise(0.04, 0.025, 8000);
        if (step % 8 === 4) this.tone(180, 0.08, 'square', 0.05);
        step++;
      }, 150);
    },
    stopBombBeat() {
      if (this._bombId) { clearInterval(this._bombId); this._bombId = null; }
    },
    stopAll() {
      this.stopAmbient(); this.stopBombBeat(); this.stopBday();
    },
    music() {
      if (!state.sound) return;
      const seq = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46];
      seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.035), i * 260));
    }
  };

  /* ================= 场景 ================= */
  let sceneSlot = 0;
  let currentScene = '';
  // WebP 支持检测：优先用 WebP，不支持则回退 jpg
  const SCENE_EXT = (() => {
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'webp' : 'jpg';
    } catch (e) { return 'jpg'; }
  })();
  function setScene(name, { dim = false, instant = false } = {}) {
    if (!name) return;
    const layers = [$('#bg-a'), $('#bg-b')];
    const next = layers[1 - sceneSlot];
    const cur = layers[sceneSlot];
    if (currentScene === name && next.classList.contains('on')) return;

    next.style.backgroundImage = `url(assets/scenes/${name}.${SCENE_EXT})`;
    $('#bg-bleed').style.backgroundImage = `url(assets/scenes/${name}.${SCENE_EXT})`;
    next.classList.toggle('dim', dim);
    if (instant) {
      next.style.transition = 'none';
      next.classList.add('on');
      cur.classList.remove('on');
      requestAnimationFrame(() => { next.style.transition = ''; });
    } else {
      next.classList.add('on');
      cur.classList.remove('on');
    }
    sceneSlot = 1 - sceneSlot;
    currentScene = name;
  }

  // 鼠标视差
  let px = 0, py = 0, tx = 0, ty = 0;
  window.addEventListener('mousemove', e => {
    px = (e.clientX / window.innerWidth - 0.5) * 2;
    py = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  (function loopParallax() {
    tx += (px - tx) * 0.06;
    ty += (py - ty) * 0.06;
    sceneEl.style.transform = `translate3d(${-tx * 10}px, ${-ty * 7}px, 0)`;
    requestAnimationFrame(loopParallax);
  })();

  /* ================= 小工具 ================= */
  function chapter(label) {
    $('#chapter-label').textContent = label;
  }
  function clockSet(text) { $('#clock-value').textContent = text; }
  function clockError(on) {
    $('#clock-chip').classList.toggle('err', !!on);
    if (!on) return;
    let n = 0;
    clockSet('??:??');
    const id = setInterval(() => {
      const pool = '0123456789:';
      let s = '';
      for (let i = 0; i < 5; i++) s += pool[(Math.random() * pool.length) | 0];
      clockSet(s);
      if (++n > 26) { clearInterval(id); clockSet('??:??'); }
    }, 70);
  }
  function doFx(fx) {
    if (!fx) return;
    if (fx.includes('shake')) {
      document.body.classList.remove('shake');
      void document.body.offsetWidth;
      document.body.classList.add('shake');
      setTimeout(() => document.body.classList.remove('shake'), 500);
    }
    if (fx.includes('glitch')) {
      document.body.classList.remove('glitch');
      void document.body.offsetWidth;
      document.body.classList.add('glitch');
      setTimeout(() => document.body.classList.remove('glitch'), 900);
    }
    if (fx.includes('flash')) {
      flashEl.classList.add('on');
      setTimeout(() => flashEl.classList.remove('on'), 240);
    }
  }
  function whiteOut(ms = 700) {
    flashEl.classList.add('on', 'hold');
    return wait(ms);
  }
  function whiteIn(ms = 600) {
    flashEl.classList.remove('hold');
    flashEl.classList.remove('on');
    return wait(ms);
  }
  function toast(text, ms = 1900) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }
  function nameOf(who) {
    if (!who || who === 'narr') return '旁白';
    return (D.characters[who] && D.characters[who].name) || who;
  }
  function imgOf(who) {
    return (D.characters[who] && D.characters[who].img) || '';
  }

  /* ================= 对话系统 ================= */
  const dlg = {
    lines: [], idx: -1, done: null, typing: false, tId: null,
    full: '', shown: 0, active: false, locked: false
  };

  function playDialogue(lines, done) {
    dlg.lines = lines.slice();
    dlg.idx = -1;
    dlg.done = done || null;
    dlg.active = true;
    dlg.locked = false;
    dlgEl.classList.remove('hidden');
    nextLine();
  }
  function nextLine() {
    dlg.idx++;
    if (dlg.idx >= dlg.lines.length) return endDialogue();
    const line = dlg.lines[dlg.idx];
    if (line.scene) setScene(line.scene, { dim: !!line.dim });
    if (line.fx) doFx(line.fx);
    if (line.bgfx) { /* reserved */ }
    renderPortraits(line);
    $('#dlg-speaker').textContent = line.speaker || nameOf(line.who);
    $('#dlg-actions').innerHTML = '';
    dlg.locked = false;

    if (line.choices) {
      typeText(line.text, () => {
        dlg.locked = true;
        renderChoices(line);
        $('#dlg-hint').textContent = '请选择';
      });
    } else {
      typeText(line.text);
    }
  }
  function renderPortraits(line) {
    const left = $('#dlg-portrait-left');
    const right = $('#dlg-portrait-right');
    const who = line.who;
    if (!who || who === 'narr') {
      left.classList.add('hidden'); right.classList.add('hidden');
      return;
    }
    if (who === 'tomato') {
      left.classList.remove('hidden'); right.classList.add('hidden');
      left.querySelector('img').src = imgOf('tomato');
    } else {
      right.classList.remove('hidden'); left.classList.add('hidden');
      right.querySelector('img').src = imgOf(who);
    }
  }
  function typeText(text, cb) {
    const el = $('#dlg-text');
    dlg.full = text || '';
    dlg.shown = 0;
    dlg.typing = true;
    el.textContent = '';
    $('#dlg-hint').textContent = '';
    clearInterval(dlg.tId);
    let i = 0;
    dlg.tId = setInterval(() => {
      if (i >= dlg.full.length) {
        clearInterval(dlg.tId);
        dlg.typing = false;
        $('#dlg-hint').textContent = dlg.locked ? '' : '点击继续 ▼';
        if (cb) cb();
        return;
      }
      // 一次多吐几个字符，速度更自然
      const step = 1 + (Math.random() < 0.35 ? 1 : 0);
      el.textContent += dlg.full.slice(i, i + step);
      i += step;
      if (i % 3 === 0) audio.type();
    }, 26);
  }
  function finishType() {
    clearInterval(dlg.tId);
    dlg.typing = false;
    $('#dlg-text').textContent = dlg.full;
    if (dlg.locked) return;
    $('#dlg-hint').textContent = '点击继续 ▼';
  }
  function renderChoices(line) {
    const box = $('#dlg-actions');
    box.innerHTML = '';
    line.choices.forEach(ch => {
      const b = document.createElement('button');
      b.className = 'pix-btn' + (ch.style === 'primary' ? ' primary' : '');
      b.textContent = ch.label;
      b.onclick = e => {
        e.stopPropagation();
        audio.click();
        box.innerHTML = '';
        dlg.locked = false;
        if (ch.action) ch.action();
        else nextLine();
      };
      box.appendChild(b);
    });
  }
  function endDialogue() {
    dlgEl.classList.add('hidden');
    dlg.active = false;
    const cb = dlg.done;
    dlg.done = null;
    if (cb) cb();
  }
  dlgEl.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    if (!dlg.active) return;
    if (dlg.typing) return finishType();
    if (dlg.locked) return;
    audio.click();
    nextLine();
  });

  /* ================= 弹层 ================= */
  const overlayStack = [];
  function openOverlay(html, { className = '', closable = true, onClose = null } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay ' + className;
    ov.innerHTML = `
      ${closable ? '<button class="ov-close" aria-label="关闭">✕</button>' : ''}
      <div class="ov-inner" style="display:contents">${html}</div>`;
    overlayRoot.appendChild(ov);
    overlayStack.push(ov);
    if (closable) {
      ov.querySelector('.ov-close').onclick = () => { audio.click(); closeOverlay(ov); };
    }
    ov._onClose = onClose;
    return ov;
  }
  function closeOverlay(ov) {
    if (!ov || !ov.parentNode) return;
    ov.classList.add('closing');
    const idx = overlayStack.indexOf(ov);
    if (idx >= 0) overlayStack.splice(idx, 1);
    setTimeout(() => {
      ov.remove();
      if (ov._onClose) ov._onClose();
    }, 180);
  }
  function closeTopOverlay() {
    const ov = overlayStack[overlayStack.length - 1];
    if (ov) closeOverlay(ov);
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeTopOverlay();
  });

  /* ================= 标题页 ================= */
  const TITLE = '失踪的胡萝卜到底是不是时间的尽头';
  const TITLE2 = '——为什么7个居民也能是小镇啊喂？';

  function bootTitle() {
    state.started = false;
    setScene('town_square_spring', { instant: true });
    clockError(true);
    chapter('序章 · 锚点丢失');
    document.body.classList.add('title-mode');
    stage.innerHTML = `
      <div class="title-screen">
        <h1 class="title-main">${TITLE}</h1>
        <div class="title-sub">${TITLE2}</div>
        <div class="title-boot" id="title-boot">
          <div class="boot-line" data-i="0"><span class="cyan">›</span> <span class="boot-txt"></span></div>
          <div class="boot-line" data-i="1"><span class="cyan">›</span> <span class="boot-txt"></span></div>
          <div class="boot-line" data-i="2"><span class="cyan">›</span> <span class="boot-txt"></span></div>
        </div>
        <button class="pix-btn primary title-start" id="btn-start">开始调查 ▶</button>
        <div class="floppy-tags">
          <span class="floppy-tag">[ 锚点 ]</span>
          <span class="floppy-tag">[ 乱流 ]</span>
          <span class="floppy-tag">[ 证物 ]</span>
          <span class="floppy-tag">[ 拟态 ]</span>
        </div>
      </div>`;

    const boot = [
      { plain: '蔬菜镇的时间，是靠一根胡萝卜维持的。', html: '蔬菜镇的时间，是靠一根胡萝卜维持的。' },
      { plain: '丰收庆典前夜，它不见了。', html: '丰收庆典前夜，<span class="warn">它不见了。</span>' },
      { plain: '你是一个路过的番茄侦探 —— 你来自「外面」。', html: '你是一个路过的番茄侦探 —— <span class="hl">你来自「外面」。</span>' }
    ];
    (async () => {
      for (let i = 0; i < boot.length; i++) {
        const lineEl = $(`.boot-line[data-i="${i}"]`, stage);
        if (!lineEl) return;
        lineEl.classList.add('on');
        const txt = $('.boot-txt', lineEl);
        const plain = boot[i].plain;
        for (let k = 1; k <= plain.length; k++) {
          txt.textContent = plain.slice(0, k);
          await wait(38);
        }
        txt.innerHTML = boot[i].html;
        await wait(460);
      }
    })();

    $('#btn-start').onclick = () => {
      audio.init(); audio.chime();
      stage.innerHTML = '';
      document.body.classList.remove('title-mode');
      startGame();
    };
  }

  function startGame() {
    state.started = true;
    audio.ambient();
    act1();
  }

  /* ================= 第一幕 ================= */
  function act1() {
    chapter('第一幕 · 失踪');
    setScene('town_square_spring');
    clockError(true);
    playDialogue([
      { who: 'narr', text: '蔬菜镇的时间，是靠一根胡萝卜维持的。' },
      { who: 'narr', text: '每天早上六点，广场中央那根一米长的巨型胡萝卜会抖一下，缨子指向东边。全镇七个蔬菜水果就知道：该起床了。' },
      { who: 'narr', text: '中午十二点，抖第二下：该吃饭了。\n晚上六点，抖第三下：该收摊了。' },
      { who: 'narr', text: '这根胡萝卜不是展品，它是时钟。' },
      { who: 'narr', text: '丰收庆典前夜，它不见了。', fx: 'glitch' },
      { who: 'narr', text: '你是一个路过的番茄侦探。你来自“外面”，所以你有“外面”的概念。', scene: 'town_square' },
      { who: 'onion', text: '不只是胡萝卜不见了。你听——', scene: 'town_square_dawn', fx: 'shake' },
      { who: 'narr', text: '你侧耳倾听。镇上的钟全在乱响。' },
      { who: 'eggplant', text: '现在是凌晨两点！……呼啊——（打了个哈欠）' },
      { who: 'chili', text: '才十二点！我辣椒素素说十二点就是十二点！' },
      { who: 'radish', text: '已……已经十点了……我、我确定……' },
      { who: 'narr', text: '没有一个人说的时间是对的。' },
      { who: 'onion', text: '胡萝卜是时间锚。它一消失，全镇的时间就开始漂。你必须在庆典开始前找到它，否则——' },
      { who: 'tomato', text: '否则什么？' },
      { who: 'onion', text: '否则我们连“明天”什么时候来，都不知道了。' },
      { who: 'narr', text: '去仓库看看。失踪的地方，总会留下点什么。' }
    ], () => {
      chapter('第二幕 · 搜证');
      act2();
    });
  }

  /* ================= 第二幕 · 搜证 ================= */
  function act2() {
    chapter('第二幕 · 搜证');
    state.loc = state.loc || 'warehouse';
    renderEvidence();
    if (!state._act2intro) {
      state._act2intro = true;
      setTimeout(() => {
        playDialogue([
          { who: 'tomato', text: '（仓库门虚掩着。空气里有一股……辣椒粉的味道。）' },
          { who: 'narr', text: '点亮场景里所有可疑的地方。每件东西都有两面。' }
        ]);
      }, 300);
    }
  }

  function renderEvidence() {
    const loc = D.clueLocations.find(l => l.id === state.loc);
    setScene(loc.scene, { dim: false });
    const got = state.collected.size;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const hotspotHTML = loc.hotspots.map(h => {
      const done = state.collected.has(h.id);
      return `<button class="hotspot ${done ? 'done' : ''}" style="left:${h.x}%;top:${h.y}%"
        data-clue="${h.id}" title="${h.label}">
        <span class="hs-dot">${h.icon}</span>
        <span class="hs-label">${h.label}</span>
      </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="loc-tabs">
          ${D.clueLocations.map(l =>
            `<button class="loc-tab ${l.id === loc.id ? 'active' : ''}" data-loc="${l.id}">${l.name}</button>`
          ).join('')}
        </div>
        <div class="hotspot-frame spot-mode ${isTouch ? 'touch-mode' : ''}" id="spot-frame">
          ${hotspotHTML}
          <div class="spot-overlay" id="spot-overlay" style="z-index:30"></div>
        </div>
        <div class="spot-hint">${isTouch ? '点击发光的可疑区域' : '移动光斑 · 照亮可疑的地方'}</div>
        <div class="progress-chip">线索 <b>${got}</b> / 6</div>
        <div class="tip-bar" id="evidence-tip">
          ${got >= 6 ? '六条线索都在这了。去侦探事务所，把它们钉上墙。' : '每条线索都有两面。'}
        </div>
        ${got >= 6 ? '<button class="pix-btn primary next-act" id="to-act3" style="right:22px;bottom:150px;position:absolute">去侦探事务所 ▶</button>' : ''}
      </div>`;

    const frame = $('#spot-frame');
    if (!isTouch) {
      const spot = $('#spot-overlay');
      const moveSpot = e => {
        const r = frame.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        spot.style.setProperty('--mx', x + '%');
        spot.style.setProperty('--my', y + '%');
      };
      frame.addEventListener('pointermove', moveSpot);
      frame.addEventListener('pointerdown', moveSpot);
      spot.style.setProperty('--mx', '50%');
      spot.style.setProperty('--my', '50%');
    }

    $$('.loc-tab', stage).forEach(b => b.onclick = () => {
      audio.click();
      state.loc = b.dataset.loc;
      renderEvidence();
    });
    $$('.hotspot', stage).forEach(b => b.onclick = () => {
      audio.click();
      openClue(b.dataset.clue);
    });
    const next = $('#to-act3');
    if (next) next.onclick = () => { audio.click(); act3(); };
  }

  function openClue(id, readOnly = false) {
    const c = D.clues[id];
    if (!c) return;
    const known = state.collected.has(id);
    const html = `
      <div class="clue-scene">
        <div class="clue-card" id="clue-card">
          <div class="clue-face front">
            <div class="holo"></div>
            <div class="clue-head">
              <div>
                <div class="clue-tag">${c.tag}</div>
                <div class="clue-title">${c.title}</div>
              </div>
              <div class="clue-stamp">${c.stamp}</div>
            </div>
            <div class="clue-body">${escapeHTML(c.surface)}</div>
            <div class="clue-foot">
              <span class="clue-hint">表面 · SURFACE</span>
              <button class="pix-btn" id="flip-btn">翻到背面 →</button>
            </div>
          </div>
          <div class="clue-face back">
            <div class="holo"></div>
            <div class="clue-head">
              <div>
                <div class="clue-tag">${c.tag}</div>
                <div class="clue-title">${c.title} · 另一面</div>
              </div>
              <div class="clue-stamp">${c.stamp}</div>
            </div>
            <div class="clue-deep-label">深层 · HIDDEN LAYER</div>
            <div class="clue-deep">${escapeHTML(c.deep)}</div>
            <div class="clue-foot">
              <span class="clue-hint">${readOnly || known ? '已收入线索墙' : '再想一想，这一面说明什么？'}</span>
              <button class="pix-btn mint" id="keep-btn">${readOnly || known ? '收起' : '收入档案 ✓'}</button>
            </div>
          </div>
        </div>
      </div>`;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const ov = openOverlay(html, { className: 'clue-ov' + (isTouch ? ' drawer' : '') });
    const card = $('#clue-card', ov);
    const sceneWrap = $('.clue-scene', ov);

    // 鼠标 3D 倾斜 + 镭射反光（仅桌面端）
    if (!isTouch) {
      const onMove = e => {
        if (card.classList.contains('flipped')) return;
        const r = sceneWrap.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        sceneWrap.style.transform = `rotateY(${dx * 14}deg) rotateX(${-dy * 12}deg)`;
        const holo = $('.front .holo', ov);
        if (holo) {
          holo.style.backgroundPosition = `${(dx + 0.5) * 100}% ${(dy + 0.5) * 100}%`;
        }
      };
      sceneWrap.addEventListener('mousemove', onMove);
      sceneWrap.addEventListener('mouseleave', () => { sceneWrap.style.transform = ''; });
    }

    const flip = () => {
      audio.click();
      card.classList.add('flipped');
      sceneWrap.style.transform = '';
    };
    $('#flip-btn', ov).onclick = e => { e.stopPropagation(); flip(); };
    // 移动端：点击卡片任意处翻面
    if (isTouch) {
      $('.clue-face.front', ov).addEventListener('click', e => {
        if (e.target.closest('button')) return;
        flip();
      });
    }
    $('#keep-btn', ov).onclick = e => {
      e.stopPropagation();
      audio.click();
      if (!known && !readOnly) {
        state.collected.add(id);
        audio.chime();
        toast('获得线索：' + c.title);
      }
      closeOverlay(ov);
      if (!readOnly) renderEvidence();
      updateClueBadge();
    };
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function updateClueBadge() {
    const btn = $('#btn-clueboard');
    if (!btn) return;
    btn.textContent = `线索墙 ${state.collected.size}/6`;
  }

  /* ================= 线索墙 ================= */
  function openClueBoard() {
    const ids = Array.from(state.collected);
    const cards = ids.map(id => {
      const c = D.clues[id];
      return `<div class="board-card" data-clue="${id}" style="--r:${(Math.random() * 3 - 1.5).toFixed(1)}deg">
        <div class="bc-thumb">${iconOf(id)}</div>
        <div class="bc-title">${c.title}</div>
        <div class="bc-tag">${c.tag}</div>
      </div>`;
    }).join('');
    const html = `
      <div class="board-wrap">
        <div class="board-cork"></div>
        <div class="board-inner">
          <div class="board-head">
            <h3>番茄侦探的线索墙</h3>
            <span style="font-size:12px;letter-spacing:.14em;color:rgba(248,240,221,.7)">
              ${ids.length} / 6 条线索 · 点击查看
            </span>
          </div>
          <div class="board-grid">
            ${cards || '<div class="board-empty">还没有线索。<br>去仓库和广场基座找找吧。</div>'}
          </div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'board-ov' });
    $$('.board-card', ov).forEach(b => b.onclick = () => {
      audio.click();
      openClue(b.dataset.clue, true);
    });
  }
  function iconOf(id) {
    return ({
      ticket: '罚', watch: '表', shovel: '铲',
      carrotTop: '缨', powder: '粉', debt: '欠'
    })[id] || '？';
  }

  /* ================= 第三幕 · 黑夜寻人 + 时间轴 ================= */
  const NIGHT_SPOTS = {
    watermelon: { x: 14, y: 76 },
    onion:      { x: 21, y: 58 },
    radish:     { x: 36, y: 70 },
    potato:     { x: 50, y: 64 },
    chili:      { x: 63, y: 72 },
    eggplant:   { x: 79, y: 56 },
    apple:      { x: 86, y: 76 }
  };

  function testiOf(id) {
    if (!state.testi[id]) state.testi[id] = { dropped: false, placed: false };
    return state.testi[id];
  }
  function placedCount() {
    return D.residents.filter(id => state.testi[id] && state.testi[id].placed).length;
  }

  function act3() {
    chapter('第三幕 · 七个人，七个时间');
    setScene('town_square_night', { dim: true });
    renderNight();
    if (!state._act3intro) {
      state._act3intro = true;
      setTimeout(() => playDialogue([
        { who: 'tomato', text: '（灯全灭了。广场上，只剩七个影子。）' },
        { who: 'narr', text: '移动光斑，照亮他们。问完三句话，他们会掉下一张证词。' },
        { who: 'tomato', text: '（然后把证词钉在时间轴上——钉错，他们会抗议。）' }
      ]), 300);
    }
  }

  function renderNight() {
    const placed = placedCount();
    const witnesses = D.residents.map(id => {
      const ch = D.characters[id];
      const t = testiOf(id);
      const cls = [
        'witness',
        t.placed ? 'stamped' : '',
        state._lit === id ? 'lit' : ''
      ].join(' ');
      return `<button class="${cls}" data-res="${id}" style="left:${NIGHT_SPOTS[id].x}%;top:${NIGHT_SPOTS[id].y}%">
        <img src="${ch.img}" alt="${ch.name}">
        <span class="wname">${ch.name}${t.placed ? ' ✓' : ''}</span>
      </button>`;
    }).join('');

    const tray = D.residents.filter(id => {
      const t = testiOf(id);
      return t.dropped && !t.placed;
    }).map(id => {
      const t = D.testimonies[id];
      return `<div class="testi-card" data-res="${id}">
        <span class="tc-thumb">${t.time}</span>
        <span class="tc-body">
          <span class="tc-name">${D.characters[id].name}</span><br>
          <span class="tc-time">${t.say}</span>
        </span>
      </div>`;
    }).join('');

    const slots = D.timeline.map(item => {
      const t = testiOf(item.id);
      return `<div class="tl-slot" data-res="${item.id}">
        <span class="tl-time">${item.time}</span>
        ${t.placed
          ? `<span class="tl-fill"><img src="${D.characters[item.id].img}" alt="">${D.characters[item.id].name}</span>`
          : '<span class="tl-fill" style="opacity:.4">空</span>'}
      </div>`;
    }).join('');

    document.body.classList.remove('drift-1', 'drift-2', 'drift-3', 'drift-4', 'drift-5', 'drift-6', 'drift-7');
    if (placed > 0) document.body.classList.add('drift-' + Math.min(7, placed));

    stage.innerHTML = `
      <div class="act-wrap night-wrap">
        <div class="spot-overlay" id="night-spot" style="z-index:23"></div>
        <div class="spot-hint">移动光斑 · 在黑暗里找到他们</div>
        <div class="act-title"><h2>七个人，七个时间</h2><p>证词已钉 ${placed} / 7</p></div>
        ${witnesses}
        <div class="testi-tray" id="testi-tray">
          ${tray ? '<span class="tray-label">待钉证词 · 拖到时间轴</span>' + tray : ''}
        </div>
        <div class="tl-panel">
          <div class="tl-head"><span>TIME LINE · 16:00 → 次日 06:00</span><span>证词 <b>${placed}</b> / 7</span></div>
          <div class="tl-slots" id="tl-slots">${slots}</div>
        </div>
        ${placed >= 7 ? '<button class="pix-btn primary" id="to-act4" style="position:absolute;left:50%;bottom:118px;transform:translateX(-50%);z-index:29">仓库后面 · 下到地窖 ▶</button>' : ''}
      </div>`;

    bindNightSpotlight();
    bindNightWitnesses();
    bindTestimonyDrag();
    const next = $('#to-act4');
    if (next) next.onclick = () => { audio.click(); selfReflection(() => act4()); };
  }

  function bindNightSpotlight() {
    const spot = $('#night-spot');
    const move = e => {
      spot.style.setProperty('--mx', e.clientX + 'px');
      spot.style.setProperty('--my', e.clientY + 'px');
      $$('.witness', stage).forEach(w => {
        const r = w.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy);
        w.classList.toggle('lit', d < 155);
      });
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerdown', move);
    spot.style.setProperty('--mx', window.innerWidth / 2 + 'px');
    spot.style.setProperty('--my', window.innerHeight / 2 + 'px');
  }

  function bindNightWitnesses() {
    $$('.witness', stage).forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.res;
        const t = testiOf(id);
        if (!btn.classList.contains('lit')) {
          audio.tone(180, 0.08, 'square', 0.04);
          toast('太黑了。用光斑照亮他。');
          return;
        }
        audio.click();
        if (t.dropped && !t.placed) {
          toast('先把证词钉到时间轴上。');
          return;
        }
        if (t.placed && !state.asked[id].follow) {
          openFollowUp(id);
          return;
        }
        if (t.placed) {
          toast(`${D.characters[id].name}：该说的都说了。`);
          return;
        }
        openInterview(id);
      };
    });
  }

  function bindTestimonyDrag() {
    const slots = $$('.tl-slot', stage);
    $$('.testi-card', stage).forEach(card => {
      const id = card.dataset.res;
      let sx = 0, sy = 0, dragging = false, ghost = null;

      const down = e => {
        if (e.button !== undefined && e.button !== 0) return;
        sx = e.clientX; sy = e.clientY;
        dragging = false;
        card.setPointerCapture && card.setPointerCapture(e.pointerId);
        const mv = ev => {
          if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
            dragging = true;
            ghost = document.createElement('div');
            ghost.className = 'testi-ghost';
            const t = D.testimonies[id];
            ghost.textContent = `${t.time} · ${D.characters[id].name}`;
            document.body.appendChild(ghost);
            card.style.opacity = '.35';
          }
          if (dragging && ghost) {
            ghost.style.left = ev.clientX + 'px';
            ghost.style.top = ev.clientY + 'px';
            slots.forEach(s => s.classList.toggle('hover',
              s.getBoundingClientRect().left < ev.clientX &&
              s.getBoundingClientRect().right > ev.clientX &&
              s.getBoundingClientRect().top < ev.clientY &&
              s.getBoundingClientRect().bottom > ev.clientY));
          }
        };
        const up = ev => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          if (ghost) ghost.remove();
          ghost = null;
          slots.forEach(s => s.classList.remove('hover'));
          card.style.opacity = '';
          if (!dragging) {
            const picked = card.classList.toggle('picked');
            $$('.testi-card', stage).forEach(c => { if (c !== card) c.classList.remove('picked'); });
            if (picked) toast('已拿起。点时间轴上的格子钉住它。');
            return;
          }
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const slot = el && el.closest('.tl-slot');
          if (slot) placeTesti(id, slot);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      };
      card.addEventListener('pointerdown', down);
    });

    slots.forEach(slot => {
      slot.onclick = () => {
        const picked = $('.testi-card.picked', stage);
        if (!picked) return;
        placeTesti(picked.dataset.res, slot);
      };
    });
  }

  function placeTesti(id, slot) {
    const t = testiOf(id);
    if (t.placed) return;
    if (slot.dataset.res !== id) {
      audio.tone(150, 0.16, 'sawtooth', 0.06);
      slot.classList.add('bad');
      setTimeout(() => slot.classList.remove('bad'), 700);
      const protest = {
        onion: '……我那时候，真的在办公室。',
        eggplant: '瞎说！我那会儿正在夜市收摊！',
        radish: '不、不是这个时间……我、我确定……',
        chili: '放屁！我十二点整在仓库门口！',
        potato: '八点……八点我在煮汤……真的……',
        apple: '六点，我在收水果摊呀。',
        watermelon: '下午四点……我在晒太阳……'
      }[id];
      toast(protest || '时间不对。');
      return;
    }
    t.placed = true;
    t.dropped = true;
    audio.stamp();
    renderNight();
    setTimeout(() => openFollowUp(id), 560);
  }

  function openFollowUp(id) {
    const ch = D.characters[id];
    const data = D.interrogations[id];
    state.asked[id].follow = true;
    playDialogue([
      { who: 'tomato', text: `（时间对上了。现在，问那一句。）` },
      { who: 'tomato', text: data.follow.q },
      { who: id, text: data.follow.a }
    ], () => {
      audio.chime();
      toast('深度追问完成：' + ch.name);
      renderNight();
    });
  }

  function openInterview(id) {
    const ch = D.characters[id];
    const data = D.interrogations[id];
    const st = state.asked[id];
    const t = testiOf(id);

    const qHTML = () => data.questions.map((q, i) => `
      <button class="qbtn ${st.regular[i] ? 'asked' : ''}" data-qi="${i}">
        <span class="qmark">Q${i + 1}</span>${q.q}
      </button>`).join('') + (t.placed
        ? `<button class="qbtn follow ${st.follow ? 'asked' : ''}" data-follow="1">${data.follow.q}</button>`
        : `<button class="qbtn lens" id="iv-lens" ${st.regular.every(Boolean) && !t.dropped ? '' : 'disabled'}>
             ${t.dropped ? '追问 · 先把证词钉上时间轴' : '追问 · 凑近，看穿它'}
           </button>`);

    const progress = `已问 ${st.regular.filter(Boolean).length} / 3 · ${t.placed ? '证词已钉' : t.dropped ? '证词待钉' : '证词未获得'}`;

    const html = `
      <div class="interview">
        <div class="iv-left">
          <img src="${ch.img}" alt="${ch.name}">
          <div class="iv-name">${ch.name}</div>
          <div class="iv-role">${ch.tag}</div>
        </div>
        <div class="iv-right">
          <div class="iv-head">
            <h4>问话记录 · ${ch.name}</h4>
            <span class="iv-progress">${progress}</span>
          </div>
          <div class="iv-qs" id="iv-qs">${qHTML()}</div>
          <div class="iv-answer empty" id="iv-answer">选择一个你想问的问题。</div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'interview-ov' });
    const answer = $('#iv-answer', ov);

    function bind() {
      $$('#iv-qs .qbtn', ov).forEach(btn => {
        btn.onclick = () => {
          if (btn.disabled) return;
          audio.click();
          if (btn.id === 'iv-lens') {
            closeOverlay(ov);
            setTimeout(() => startMinigame(id, () => {
              testiOf(id).dropped = true;
              toast('证词掉落：' + D.testimonies[id].time);
              renderNight();
            }), 240);
            return;
          }
          if (btn.dataset.follow) {
            st.follow = true;
            showAnswer(data.follow.a, ch.name, true);
            setTimeout(() => { toast('追问完成：' + ch.name); audio.chime(); }, 420);
          } else {
            const qi = Number(btn.dataset.qi);
            st.regular[qi] = true;
            showAnswer(data.questions[qi].a, ch.name, false);
          }
          $('.iv-progress', ov).textContent =
            `已问 ${st.regular.filter(Boolean).length} / 3 · ${t.placed ? '证词已钉' : t.dropped ? '证词待钉' : '证词未获得'}`;
          $('#iv-qs', ov).innerHTML = qHTML();
          bind();
        };
      });
    }
    function showAnswer(text, name, isFollow) {
      answer.classList.remove('empty');
      answer.innerHTML = `<div class="ans-name">${name}${isFollow ? ' · 追问' : ''}</div>${escapeHTML(text)}`;
      answer.scrollTop = answer.scrollHeight;
    }
    bind();
    ov._onClose = () => { renderNight(); };
  }

  /* ---------------- 七人七色 · 放大镜小游戏 ---------------- */
  const MINI_META = {
    onion:      { t: '聚光灯 · 找茬',  s: '洋葱镇长 · 努力装威严' },
    eggplant:   { t: '打断施法',       s: '茄子紫紫 · 满嘴跑火车' },
    radish:     { t: '填空缝合',       s: '萝卜彩蛋 · 惊恐结巴' },
    chili:      { t: '物理降温',       s: '辣椒素素 · 暴躁护短' },
    potato:     { t: '节奏安抚',       s: '土豆泥泥 · 极度愧疚' },
    apple:      { t: '记忆碎片',       s: '苹果原原 · 好奇又恐惧' },
    watermelon: { t: '物理叫醒',       s: '西瓜呱呱 · 自欺欺人' }
  };

  function startMinigame(id, cb) {
    const meta = MINI_META[id];
    const ov = openOverlay(`
      <div class="mini">
        <div class="mini-head"><span class="mt">${meta.t}</span><span class="ms">${meta.s}</span></div>
        <div class="mini-body" id="mini-body"><div class="lens-frame"></div></div>
        <button class="mini-skip" id="mini-skip">番茄侦探的直觉：真相就在眼前 ›</button>
      </div>`, { className: 'mini-ov', closable: false });
    const body = $('#mini-body', ov);
    let done = false;
    let cleanup = null;

    const finish = (skipped = false) => {
      if (done) return;
      done = true;
      if (cleanup) cleanup();
      const d = document.createElement('div');
      d.className = 'mini-done';
      d.textContent = skipped ? '跳过' : '破 防';
      body.appendChild(d);
      audio.chime();
      setTimeout(() => { closeOverlay(ov); cb(); }, 900);
    };

    const skip = $('#mini-skip', ov);
    setTimeout(() => { if (skip) skip.classList.add('show'); }, 22000);
    if (skip) skip.onclick = () => finish(true);

    const fn = {
      onion: miniOnion, eggplant: miniEggplant, radish: miniRadish,
      chili: miniChili, potato: miniPotato, apple: miniApple, watermelon: miniWatermelon
    }[id];
    if (fn) cleanup = fn(body, finish) || null;
    ov._onClose = () => { if (cleanup) cleanup(); };
  }

  function miniOnion(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-onion">
        <img src="${D.characters.onion.img}" alt="">
        <div class="mg-spot-dark" id="mg-dark"></div>
        <button class="mg-crown" id="mg-crown" aria-label="皇冠">冠</button>
      </div>
      <div class="mini-tip">用光斑扫过它的皇冠——它在抖</div>`);
    const dark = $('#mg-dark', body);
    const crown = $('#mg-crown', body);
    const move = e => {
      const r = body.getBoundingClientRect();
      dark.style.setProperty('--sx', ((e.clientX - r.left) / r.width * 100) + '%');
      dark.style.setProperty('--sy', ((e.clientY - r.top) / r.height * 100) + '%');
      const cr = crown.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (cr.left + cr.width / 2), e.clientY - (cr.top + cr.height / 2));
      crown.classList.toggle('hot', d < 120);
    };
    body.addEventListener('pointermove', move);
    crown.onclick = () => {
      if (!crown.classList.contains('hot')) return;
      audio.tick();
      finish();
    };
    return () => body.removeEventListener('pointermove', move);
  }

  function miniEggplant(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-eggplant">
        <img src="${D.characters.eggplant.img}" alt="">
        <div class="mg-bubble" id="lie-bubble">我跟你说，我昨天在夜市烤茄子，烤到半夜……</div>
      </div>
      <div class="mini-tip">它说到“烤茄子”时，红字会闪。眼疾手快 —— 点它</div>`);
    const bubble = $('#lie-bubble', body);
    const sayings = [
      '我跟你说，我昨天在夜市烤茄子，烤到半夜……',
      '我茄子紫紫做生意，从不缺斤少两，我跟你说……',
      '那天晚上我一直在收摊，真的，我发誓……',
      '你别听土豆瞎说，我一个茄子能藏什么？'
    ];
    let timer = null, misses = 0, dur = 280, finished = false;
    let li = 0;

    const cycle = () => {
      if (finished) return;
      bubble.style.left = (34 + Math.random() * 32) + '%';
      bubble.style.top = (18 + Math.random() * 26) + '%';
      bubble.innerHTML = sayings[li++ % sayings.length] + '<span class="lie-char" id="lie-char">谎</span>';
      const lie = $('#lie-char', bubble);
      void lie.offsetWidth;
      lie.classList.add('on');
      lie.style.fontSize = (misses >= 3 ? '34px' : '26px');
      timer = setTimeout(() => {
        lie.classList.remove('on');
        misses++;
        if (misses >= 3) dur = 1900;
        setTimeout(cycle, 780 + Math.random() * 500);
      }, dur);
    };
    bubble.onclick = e => {
      const lie = e.target.closest('#lie-char');
      if (lie) {
        finished = true;
        clearTimeout(timer);
        audio.tone(1400, 0.1, 'triangle', 0.06);
        finish();
        return;
      }
      // 主动点对话框 = 打断它，把“谎”字定格
      clearTimeout(timer);
      const cur = $('#lie-char', bubble);
      if (cur) {
        cur.classList.add('on', 'frozen');
        setTimeout(() => {
          if (finished) return;
          cur.classList.remove('frozen');
          cycle();
        }, 1900);
      }
    };
    cycle();
    return () => { finished = true; clearTimeout(timer); };
  }

  function miniRadish(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-radish">
        <div class="mg-sentence">我 <span class="blank" data-b="0">?</span> <span class="blank" data-b="1">?</span> 表哥 <span class="blank" data-b="2">?</span> 音</div>
        <div class="mg-scatter" id="scatter"></div>
      </div>
      <div class="mini-tip">点出正确的字，帮他把话说完</div>`);
    const target = ['在', '帮', '录'];
    const pool = ['在', '帮', '录', '偷', '藏', '凶', '哭', '逃'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const scatter = $('#scatter', body);
    const spots = [[9, 47], [24, 60], [40, 48], [55, 66], [69, 49], [82, 63], [16, 73], [61, 78]];
    scatter.innerHTML = pool.map((c, i) => {
      const [lx, ty] = spots[i % spots.length];
      return `<button class="mg-char" data-c="${c}" style="left:${lx}%;top:${ty}%;animation-delay:${(i * 0.3).toFixed(1)}s">${c}</button>`;
    }).join('');
    let step = 0;
    $$('.mg-char', scatter).forEach(ch => {
      ch.onclick = () => {
        if (step >= target.length) return;
        if (ch.dataset.c !== target[step]) {
          ch.classList.add('wrong');
          audio.tone(150, 0.1, 'sawtooth', 0.05);
          setTimeout(() => ch.classList.remove('wrong'), 420);
          return;
        }
        audio.type();
        ch.classList.add('used');
        const blank = $(`.blank[data-b="${step}"]`, body);
        blank.textContent = target[step];
        blank.classList.add('ok');
        step++;
        if (step >= target.length) setTimeout(() => finish(), 420);
      };
    });
    return null;
  }

  function miniChili(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-chili burning" id="mg-chili">
        <img src="${D.characters.chili.img}" alt="">
        <div class="mg-fire">▲ ▲ ▲</div>
        <div class="mg-heat"></div>
        <div class="mg-bucket" id="mg-bucket">冰水</div>
      </div>
      <div class="mini-tip">太热了，得找点冰的 —— 把冰水桶拖到它头上</div>`);
    const chili = $('#mg-chili', body);
    const bucket = $('#mg-bucket', body);
    let offX = 0, offY = 0, moved = false;

    const down = e => {
      const r = bucket.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      bucket.style.left = r.left + 'px';
      bucket.style.top = r.top + 'px';
      bucket.style.bottom = 'auto';
      moved = false;
      bucket.setPointerCapture && bucket.setPointerCapture(e.pointerId);
    };
    const move = e => {
      if (!bucket.style.top) return;
      moved = true;
      bucket.style.left = (e.clientX - offX) + 'px';
      bucket.style.top = (e.clientY - offY) + 'px';
    };
    const up = e => {
      if (!moved) { toast('把冰水拖到辣椒头上。'); return; }
      const img = $('img', chili).getBoundingClientRect();
      const br = bucket.getBoundingClientRect();
      const d = Math.hypot(
        (br.left + br.width / 2) - (img.left + img.width / 2),
        (br.top + br.height / 2) - (img.top + img.height / 2)
      );
      if (d < 150) {
        audio.spray();
        chili.classList.remove('burning');
        $('img', chili).style.filter = 'grayscale(.55) brightness(.72)';
        setTimeout(() => finish(), 620);
      } else {
        toast('差一点。对准它的头。');
      }
    };
    bucket.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }

  function miniPotato(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-potato">
        <img src="${D.characters.potato.img}" alt="">
        <div class="mg-heartbar"><i id="heart"></i></div>
        <canvas class="mg-wave" id="wave" width="1240" height="300"></canvas>
        <div class="mg-beat-hint" id="beat-hint">跟着波浪起伏 · 在波峰点击 · 安抚 0 / 6</div>
      </div>`);
    const cv = $('#wave', body);
    const ctx = cv.getContext('2d');
    const heart = $('#heart', body);
    const hint = $('#beat-hint', body);
    let raf = null, good = 0, t0 = performance.now(), alive = true;

    const paint = now => {
      if (!alive) return;
      const t = (now - t0) / 1000;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0,255,204,.16)';
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,255,204,.75)';
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const y = H / 2 + Math.sin((x / W) * Math.PI * 4) * H * 0.3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      const p = (t * 0.42) % 1;
      const mx = p * W;
      const my = H / 2 + Math.sin(p * Math.PI * 4) * H * 0.3;
      ctx.fillStyle = '#ffe94a';
      ctx.fillRect(mx - 5, my - 5, 10, 10);
      ctx.strokeStyle = 'rgba(255,233,74,.4)';
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);

    const beat = () => {
      const p = ((performance.now() - t0) / 1000 * 0.42) % 1;
      if (Math.abs(Math.sin(p * Math.PI * 4)) > 0.72) {
        good++;
        audio.heart();
        heart.style.width = Math.min(100, 15 + good * 14) + '%';
        hint.textContent = `跟着波浪起伏 · 在波峰点击 · 安抚 ${good} / 6`;
        if (good >= 6) {
          alive = false;
          cancelAnimationFrame(raf);
          audio.chime();
          setTimeout(() => finish(), 520);
        }
      } else {
        audio.tone(140, 0.07, 'square', 0.03);
      }
    };
    cv.addEventListener('pointerdown', beat);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }

  function miniApple(body, finish) {
    const frags = [
      { c: '大', x: 16, y: 26 },
      { c: '黑', x: 72, y: 22 },
      { c: '出', x: 22, y: 62 },
      { c: '不', x: 74, y: 58 }
    ];
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-apple">
        <img src="${D.characters.apple.img}" alt="">
        <div class="mg-qmark" id="qmark">?</div>
        ${frags.map((f, i) => `<button class="mg-frag" data-f="${i}" style="left:${f.x}%;top:${f.y}%;animation-delay:${i * 0.4}s">${f.c}</button>`).join('')}
      </div>
      <div class="mini-tip">收齐 4 块记忆碎片，拼出「外面」</div>`);
    let got = 0;
    $$('.mg-frag', body).forEach(f => {
      f.onclick = () => {
        if (f.classList.contains('got')) return;
        f.classList.add('got');
        got++;
        audio.tone(900 + got * 90, 0.06, 'square', 0.04);
        if (got >= 4) {
          const q = $('#qmark', body);
          q.textContent = '!';
          q.style.color = 'var(--mint)';
          q.style.borderColor = 'var(--mint)';
          setTimeout(() => finish(), 560);
        }
      };
    });
    return null;
  }

  function miniWatermelon(body, finish) {
    body.insertAdjacentHTML('beforeend', `
      <div class="mg-watermelon">
        <div class="mg-wm" id="wm">
          <div class="mg-zzz">Zzz</div>
          <img src="${D.characters.watermelon.img}" alt="" style="height:clamp(180px,36vh,320px)">
          <div class="mg-glasses">墨镜</div>
        </div>
      </div>
      <div class="mini-tip" id="wm-tip">左右快速摇晃他（或连续点击） · 摇晃 0%</div>`);
    const wm = $('#wm', body);
    const tip = $('#wm-tip', body);
    let shake = 0, lastX = null, dragging = false, finished = false;

    const add = v => {
      shake = Math.min(460, shake + v);
      const pct = Math.min(100, Math.round(shake / 460 * 100));
      tip.textContent = `左右快速摇晃他（或连续点击） · 摇晃 ${pct}%`;
      wm.classList.add('shaking');
      clearTimeout(wm._shakeT);
      wm._shakeT = setTimeout(() => wm.classList.remove('shaking'), 140);
      if (shake >= 460 && !finished) {
        finished = true;
        wm.classList.remove('shaking');
        wm.classList.add('woke');
        audio.tone(1200, 0.12, 'triangle', 0.06);
        setTimeout(() => finish(), 760);
      }
    };
    const down = e => { dragging = true; lastX = e.clientX; };
    const move = e => {
      if (!dragging) return;
      add(Math.abs(e.clientX - lastX));
      lastX = e.clientX;
    };
    const up = () => { dragging = false; lastX = null; };
    wm.addEventListener('pointerdown', down);
    wm.addEventListener('click', () => add(34));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clearTimeout(wm._shakeT);
    };
  }

  /* ---------------- 番茄自省 · 镜子彩蛋 ---------------- */
  function selfReflection(done) {
    const layer = document.createElement('div');
    layer.className = 'self-layer';
    layer.innerHTML = `
      <div class="self-spot" id="self-spot"></div>
      <div class="self-center">
        <div class="self-title">你真的来自「外面」吗？</div>
        <div class="self-mirror" id="self-mirror">
          <img id="self-img" src="${D.characters.tomato.img}" alt="">
        </div>
        <div class="self-tip">把光移到镜子上</div>
      </div>`;
    document.body.appendChild(layer);

    const spot = $('#self-spot', layer);
    const mirror = $('#self-mirror', layer);
    const img = $('#self-img', layer);
    const tip = $('.self-tip', layer);
    let lit = false;

    const move = e => {
      spot.style.setProperty('--mx', e.clientX + 'px');
      spot.style.setProperty('--my', e.clientY + 'px');
      if (lit) return;
      const r = mirror.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < 130) { lit = true; awaken(); }
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerdown', move);
    spot.style.setProperty('--mx', window.innerWidth / 2 + 'px');
    spot.style.setProperty('--my', window.innerHeight / 2 + 'px');

    async function awaken() {
      audio.tone(1200, 0.12, 'triangle', 0.05);
      mirror.classList.add('lit');
      tip.textContent = '……镜子里是谁？';
      await wait(900);

      for (let i = 0; i < 3; i++) {
        img.src = `assets/finale/dish_tomato.${SCENE_EXT}`;
        mirror.classList.add('glitch');
        audio.noise(0.12, 0.07, 2400);
        await wait(230);
        img.src = D.characters.tomato.img;
        mirror.classList.remove('glitch');
        await wait(230);
      }

      img.src = `assets/finale/dish_tomato.${SCENE_EXT}`;
      mirror.classList.add('crack');
      audio.noise(0.38, 0.12, 3000);
      audio.heart();
      document.body.classList.add('shake');
      tip.textContent = '……那盘菜，是你吗？';
      await wait(950);
      document.body.classList.remove('shake');
      layer.classList.add('out');
      await wait(480);
      layer.remove();
      done();
    }
  }

  /* ================= 第四幕 · 地窖 ================= */
  function act4() {
    chapter('第四幕 · 地窖');
    setScene('cellar');
    playDialogue([
      { who: 'narr', text: '地窖不大，角落里堆着杂物。空气里有蜡油和土的味道。' },
      { who: 'narr', text: '墙上没有公告，只有一排刻痕——像有人用指甲划的，一道一道，密密麻麻，数不清。' },
      { who: 'tomato', text: '（烛火晃了一下。刻痕旁边，贴着几张泛黄的纸片。）' }
    ], () => {
      stage.innerHTML = `
        <div class="act-wrap">
          <div class="cellar-flicker"></div>
          <div class="tip-bar">凑近墙面，看清那些字。</div>
          <button class="pix-btn primary" id="approach" style="position:absolute;left:50%;bottom:150px;transform:translateX(-50%)">凑近墙面</button>
        </div>`;
      $('#approach').onclick = () => { audio.click(); showWall(); };
    });
  }

  function showWall() {
    stage.innerHTML = '';
    setScene('cellar_wall');
    const hotspots = D.cellarHotspots.map(h => {
      const locked = h.id === 'burnt' && !state.burntUnlocked;
      const done = h.id === 'burnt' ? state.burnt : state.notes.has(h.id);
      if (locked) return '';
      return `<button class="hotspot ${done ? 'done' : ''}" style="left:${h.x}%;top:${h.y}%"
        data-note="${h.id}" title="${h.label}">
        <span class="hs-dot">${h.id === 'burnt' ? '焦' : '记'}</span>
        <span class="hs-label">${h.label}</span>
      </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="cellar-flicker"></div>
        <div class="act-title"><h2>CELLAR · 刻痕</h2><p>36525 天 · 三道指甲印</p></div>
        <div class="hotspot-frame scratch-mode" id="wall-frame">
          ${hotspots}
          <div class="wall-glow" id="wall-glow"></div>
        </div>
        <div class="progress-chip">便签 <b>${state.notes.size}</b> / 3</div>
        <div class="tip-bar" id="cellar-tip">
          ${state.notes.size < 3 ? '先看完三张便签。' : (state.burnt ? '真相就在那张烧焦的纸上。' : '墙的最下面，还有半张烧焦的纸。')}
        </div>
        ${(state.notes.size >= 3 && state.burnt)
          ? '<button class="pix-btn primary" id="to-accuse" style="position:absolute;right:22px;bottom:150px">指认真相 ▶</button>'
          : ''}
      </div>`;

    const frame = $('#wall-frame');
    const glow = $('#wall-glow');
    if (frame && glow) {
      frame.addEventListener('pointermove', e => {
        const r = frame.getBoundingClientRect();
        glow.style.setProperty('--wx', ((e.clientX - r.left) / r.width * 100) + '%');
        glow.style.setProperty('--wy', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    }

    $$('.hotspot', stage).forEach(b => b.onclick = () => {
      audio.click();
      openNote(b.dataset.note);
    });

    /* 右键 / 长按呼出复古终端菜单 */
    let pressTimer = null;
    const openTermMenu = (clientX, clientY) => {
      closeTermMenu();
      const menu = document.createElement('div');
      menu.className = 'term-menu';
      menu.innerHTML = `<div class="tm-title">TIME BUREAU · SHELL</div>`;
      const items = [
        { label: '查看底层代码', action: () => { toast('底层代码已加密 · 权限不足'); closeTermMenu(); } },
        { label: '时间管理局协议 #7', action: () => { toast('协议 #7：实验体不得拥有"明天"的概念'); closeTermMenu(); } },
        { label: '重启实验体 7 名', action: null, locked: true },
        { label: '退出终端', action: closeTermMenu }
      ];
      items.forEach((it, idx) => {
        const btn = document.createElement('button');
        btn.className = 'tm-item' + (it.locked ? ' locked' : '');
        btn.innerHTML = `<span class="tm-label"></span><span class="tm-cursor"></span>`;
        menu.appendChild(btn);
        const full = `> ${it.label}${it.locked ? ' [LOCKED]' : ''}`;
        let ci = 0;
        setTimeout(() => {
          const labelEl = btn.querySelector('.tm-label');
          const typeTimer = setInterval(() => {
            if (ci < full.length) {
              labelEl.textContent += full[ci];
              audio.type();
              ci++;
            } else {
              clearInterval(typeTimer);
              btn.querySelector('.tm-cursor').remove();
            }
          }, 28);
        }, idx * 120);
        if (!it.locked) btn.onclick = it.action;
      });
      // 定位（避免溢出屏幕）
      menu.style.left = Math.min(clientX, window.innerWidth - 240) + 'px';
      menu.style.top = Math.min(clientY, window.innerHeight - 220) + 'px';
      document.body.appendChild(menu);
      state._termMenu = menu;
    };
    frame.addEventListener('contextmenu', e => { e.preventDefault(); openTermMenu(e.clientX, e.clientY); });
    frame.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 2) return;
      pressTimer = setTimeout(() => openTermMenu(e.clientX, e.clientY), 600);
    });
    frame.addEventListener('pointerup', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    frame.addEventListener('pointerleave', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });

    const n = $('#to-accuse');
    if (n) n.onclick = () => { audio.click(); act5(); };
  }

  function closeTermMenu() {
    if (state._termMenu) { state._termMenu.remove(); state._termMenu = null; }
  }
  document.addEventListener('click', e => {
    if (state._termMenu && !e.target.closest('.term-menu')) closeTermMenu();
  });

  function openNote(id) {
    const note = D.cellarNotes[id];
    const isBurnt = id === 'burnt';
    const cls = id === 'note2' ? 'red' : (isBurnt ? 'hot' : '');
    const lines = note.body.split('\n');
    const lineHTML = lines.map((l, i) => {
      if (isBurnt && /编号 LAB-7/.test(l)) {
        return `<div class="line"><span id="lab7-link" style="text-decoration:underline;cursor:pointer">${escapeHTML(l)}</span></div>`;
      }
      if (isBurnt && /清理协议/.test(l)) {
        return `<div class="line"><span class="glitch-line">${escapeHTML(l)}</span></div>`;
      }
      return `<div class="line">${escapeHTML(l)}</div>`;
    }).join('');

    const html = `
      <div class="note-card ${cls}" id="note-card">
        <div class="note-title">${note.title}</div>
        <div class="note-style">${note.style}</div>
        <div class="note-body" id="note-body">${lineHTML}</div>
        ${isBurnt ? '<div class="ember"></div><span class="smoke"></span><span class="smoke" style="left:72%;animation-delay:1.2s"></span>' : ''}
      </div>`;
    const ov = openOverlay(html, { className: 'note-ov' });
    const card = $('#note-card', ov);

    if (isBurnt) {
      const crumble = document.createElement('div');
      crumble.className = 'crumble';
      card.appendChild(crumble);
      setTimeout(() => crumble.remove(), 1200);
      audio.boom();
      doFx('shake');
    } else if (id === 'note1') {
      audio.stamp();
      audio.tone(120, 0.5, 'sine', 0.08);
    } else if (id === 'note2') {
      audio.type();
    } else {
      audio.noise(0.2, 0.06, 3600);
    }

    // 文字逐行浮现（烧焦残页更慢）
    const per = isBurnt ? 520 : 340;
    $$('.line', ov).forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('on');
        if (isBurnt && /清理协议/.test(el.textContent)) {
          doFx('glitch');
          audio.alarm();
        }
      }, 180 + i * per);
    });

    const lab7 = $('#lab7-link', ov);
    if (lab7) lab7.onclick = () => { audio.click(); lab7Surprise(); };

    setTimeout(() => {
      if (isBurnt) {
        state.burnt = true;
        audio.chime();
        toast('真相：LAB-7 · 清理协议');
      } else {
        state.notes.add(id);
      }
    }, isBurnt ? 1400 : 300);

    ov._onClose = () => {
      if (!isBurnt) state.notes.add(id);
      updateWallProgress();
      if (!isBurnt && state.notes.size >= 3 && !state._converged && !state.burnt) {
        setTimeout(convergeNotes, 340);
      }
    };
  }

  function lab7Surprise() {
    const chip = $('#clock-chip');
    chip.classList.remove('err');
    chip.classList.add('alert');
    const lbl = $('.clock-label', chip);
    if (lbl) lbl.textContent = '剩余生存时间';
    clockSet('24:00:00');
    document.body.classList.add('glitch');
    setTimeout(() => document.body.classList.remove('glitch'), 900);
    audio.alarm();
    toast('LAB-7 已读到 · 系统开始倒数');
  }

  function convergeNotes() {
    state._converged = true;
    const notes = ['note1', 'note2', 'note3'].map((id, i) => {
      const n = D.cellarNotes[id];
      return `<div class="cv-card" style="--rot:${-5 + i * 5}deg">
        <div class="cv-num">00${i + 1}</div>
        <div class="cv-text">${escapeHTML(n.body.split('\n').slice(0, 2).join(' '))}</div>
      </div>`;
    }).join('');
    const ov = openOverlay(`<div class="converge-wrap"><div class="cv-row">${notes}</div><div class="cv-flash"></div></div>`,
      { className: 'converge-ov', closable: false });
    audio.stamp();
    setTimeout(() => audio.stamp(), 400);
    setTimeout(() => audio.stamp(), 800);
    setTimeout(() => {
      state.burntUnlocked = true;
      closeOverlay(ov);
      updateWallProgress();
      toast('右下角，有半张烧焦的纸。');
      audio.tone(90, 0.6, 'sawtooth', 0.05);
    }, 1700);
  }

  function updateWallProgress() {
    if (currentScene === 'cellar_wall') showWall();
  }

  /* ================= 第五幕 · 指认 ================= */
  function act5() {
    chapter('第五幕 · 指认');
    setScene('cellar', { dim: true });
    const html = `
      <div class="accuse-wrap">
        <div class="accuse-card">
          <div class="accuse-head">
            <span class="ac-tag">指认 · ACCUSATION</span>
            <h3>胡萝卜到底去哪了？</h3>
            <p>你只会有一次机会。想清楚。</p>
          </div>
          <div class="accuse-opts" id="acc-opts">
            ${D.accusations.map(a => `
              <button class="accuse-opt" data-id="${a.id}">
                <span class="ao-key">${a.id}</span>
                <span class="ao-text">${a.text}</span>
              </button>`).join('')}
          </div>
          <div class="accuse-reply" id="acc-reply"></div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'accuse-ov', closable: false });
    const reply = $('#acc-reply', ov);
    let locked = false;

    $$('.accuse-opt', ov).forEach(btn => btn.onclick = () => {
      if (locked) return;
      audio.click();
      const a = D.accusations.find(x => x.id === btn.dataset.id);
      if (a.ok) {
        locked = true;
        btn.classList.add('right');
        reply.textContent = a.reply;
        audio.chime();
        setTimeout(() => {
          closeOverlay(ov);
          playDialogue([
            { who: 'tomato', text: '（不是偷。是“被带走”，也是“想被找到”。）' },
            { who: 'narr', text: '地窖最深处，有一扇小门。门上挂着一块牌子：“时间管理局 · 观察哨”。', fx: 'glitch' },
            { who: 'narr', text: '门没锁。' }
          ], () => act6());
        }, 1400);
      } else {
        btn.classList.add('wrong');
        reply.textContent = a.reply;
        document.body.classList.remove('shake');
        void document.body.offsetWidth;
        document.body.classList.add('shake');
        setTimeout(() => {
          btn.classList.remove('wrong');
          document.body.classList.remove('shake');
        }, 700);
      }
    });
  }

  /* ================= 第六幕 · 时间管理局绝密终端 ================= */
  function act6() {
    chapter('第六幕 · 观察哨');
    setScene('observation_post');
    state.archiveRead = new Set();

    const hi = s => String(s)
      .replace(/时间锚/g, '<span class="term-key">时间锚</span>')
      .replace(/清理协议/g, '<span class="term-key">清理协议</span>')
      .replace(/自主意识指数/g, '<span class="term-cyan">自主意识指数</span>');

    const itemsHTML = D.archive.map((a, i) => `
      <div class="term-item ${a.special ? 'special' : ''}" data-i="${i}">
        <div class="ti-y">${a.year}</div>
        <div class="ti-t">${hi(a.text)}</div>
        <div class="ti-n">备注：${hi(a.note)}</div>
        ${a.deleted ? `<div class="ti-n"><span class="deleted">[数据已删除] ${a.deleted}</span></div>` : ''}
      </div>`).join('');

    const html = `
      <div class="terminal-wrap" id="term-wrap">
        <div class="term-crt"></div>
        <div class="term-rec"><i></i>REC · OBSERVATION POST / 007</div>

        <div class="term-panel tp-side">
          <div class="tp-k">TIME MANAGEMENT BUREAU</div>
          <div class="tp-k" style="color:rgba(232,65,58,.85)">绝密 · 观察哨终端</div>
          <div style="margin-top:16px">
            <div class="tp-k">自主意识指数</div>
            <div class="tp-v red" id="idx-val">17.3%</div>
          </div>
          <div class="tp-sub">实验体：7 名<br>形态：蔬菜 / 水果<br>状态：未觉醒</div>
          <div class="term-index">
            <div class="tp-k">历史数据</div>
            <div class="bar"><i id="idx-bar"></i></div>
            <div class="tp-sub" id="idx-count">0 / 7</div>
          </div>
          <div class="term-index">
            <div class="tp-k">清理协议</div>
            <div class="tp-v" id="clean-val" style="font-size:17px;color:rgba(0,255,255,.55)">未激活</div>
          </div>
        </div>

        <div class="term-archive" id="term-archive">
          <div class="ta-head">
            <span>⚠ 载入历史数据 · 蔬菜镇实验记录</span>
            <span id="arc-progress">0/7</span>
          </div>
          ${itemsHTML}
        </div>

        <div class="term-slider">
          <div class="track">
            <div class="knob" id="tl-knob"></div>
            <div class="ticks"><span>100</span><span>90</span><span>70</span><span>50</span><span>30</span><span>10</span><span>1</span></div>
          </div>
        </div>

        <div class="crosshair" id="term-cross">+</div>

        <div class="term-dialog" id="term-dialog">
          <img id="td-img" src="${D.characters.heihei.img}" alt="">
          <div style="flex:1">
            <div class="td-name" id="td-name">茄子黑黑</div>
            <div class="td-text" id="td-text"></div>
          </div>
          <button class="td-next" id="td-next">继续 ▼</button>
        </div>
      </div>`;

    const ov = openOverlay(html, {
      className: 'term-ov', closable: false,
      onClose: () => { clearInterval(flick); }
    });

    const idxVal = $('#idx-val', ov);
    const idxBar = $('#idx-bar', ov);
    const idxCount = $('#idx-count', ov);
    const arcProg = $('#arc-progress', ov);
    const knob = $('#tl-knob', ov);
    const cleanVal = $('#clean-val', ov);
    const cross = $('#term-cross', ov);
    const dlg = $('#term-dialog', ov);

    /* 红色十字准星跟随 */
    ov.addEventListener('pointermove', e => {
      cross.style.left = e.clientX + 'px';
      cross.style.top = e.clientY + 'px';
    });

    /* 第 100 年条目：标题偶尔“数据丢失” */
    const specialItem = $('.term-item.special', ov);
    const specialTitle = $('.ti-y', specialItem);
    const realTitle = specialTitle.textContent;
    const flick = setInterval(() => {
      if (specialItem.classList.contains('open')) return;
      specialTitle.textContent = '第 [数据丢失] 年';
      setTimeout(() => {
        if (!specialItem.classList.contains('open')) specialTitle.textContent = realTitle;
      }, 640);
    }, 2900);

    /* 终端内对话 */
    let typingId = null;
    function say(who, text, next) {
      const ch = D.characters[who] || D.characters.heihei;
      dlg.classList.add('on');
      $('#td-img', ov).src = ch.img;
      $('#td-name', ov).textContent = ch.name;
      const el = $('#td-text', ov);
      el.textContent = '';
      let i = 0;
      clearInterval(typingId);
      typingId = setInterval(() => {
        el.textContent += text.slice(i, i + 2);
        i += 2;
        if (i % 8 === 0) audio.type();
        if (i >= text.length) {
          clearInterval(typingId);
          typingId = null;
          el.textContent = text;
        }
      }, 26);
      const btn = $('#td-next', ov);
      btn.onclick = () => {
        audio.click();
        if (typingId) {
          clearInterval(typingId);
          typingId = null;
          el.textContent = text;
          return;
        }
        btn.onclick = null;
        if (next) next();
      };
    }

    const intro = [
      ['heihei', '……你来了。我们等很久了。'],
      ['lala', '规章第 7 条：不得干预。所以我们只能等。'],
      ['heihei', '一百年前就知道。每天记录、检查、上报。点“确认”。'],
      ['lala', '现在，你是“外面的人”。底层代码管不了你。'],
      ['heihei', '先看档案。每一条，都是我们没敢做的事。']
    ];
    let ii = 0;
    const step = () => {
      if (ii >= intro.length) {
        dlg.classList.remove('on');
        $('#term-archive', ov).classList.add('ready');
        return;
      }
      const [w, t] = intro[ii++];
      say(w, t, step);
    };
    step();

    let unlocked = 0;
    let locked = false;

    function triggerAlarm() {
      if (locked) return;
      locked = true;
      clearInterval(flick);
      audio.alarm();
      doFx('shake');
      document.body.classList.add('shake');
      idxVal.textContent = '17.3% [极度危险]';
      idxVal.classList.add('danger');
      cleanVal.textContent = '已激活';
      cleanVal.style.color = 'var(--red)';
      cleanVal.style.textShadow = '0 0 14px rgba(232,65,58,.9)';
      knob.style.top = '92%';
      dlg.classList.remove('on');
      $$('.term-item', ov).forEach(x => x.classList.add('open', 'alarm'));

      const warn = document.createElement('div');
      warn.className = 'term-warning';
      warn.innerHTML = `
        <div class="tw-t">【 清理协议已激活 】</div>
        <div class="tw-v" id="tw-count">05:00</div>
        <div style="font-size:12px;letter-spacing:.14em;color:rgba(255,255,255,.72);margin-top:10px">
          自毁程序将在 300 秒后执行 · 编号 LAB-7
        </div>
        <div style="font-size:12px;letter-spacing:.1em;color:rgba(255,183,197,.9);margin-top:8px">
          在它归零之前，先让它们学会看时间。
        </div>
        <button class="pix-btn primary" id="tw-go" style="margin-top:18px">去叫醒它们 ▶</button>`;
      ov.appendChild(warn);

      const countEl = $('#tw-count', warn);
      let left = 300;
      const cid = setInterval(() => {
        left--;
        const m = String(Math.floor(left / 60)).padStart(2, '0');
        const s = String(left % 60).padStart(2, '0');
        countEl.textContent = `${m}:${s}`;
        if (left % 2 === 0) audio.tick();
        if (left <= 0) { clearInterval(cid); countEl.textContent = '00:00'; }
      }, 1000);

      $('#tw-go', warn).onclick = () => {
        audio.click();
        clearInterval(cid);
        document.body.classList.remove('shake');
        closeOverlay(ov);
        act7();
      };
    }

    $$('.term-item', ov).forEach(it => it.onclick = () => {
      if (locked) return;
      const i = Number(it.dataset.i);
      const a = D.archive[i];
      if (a.special && unlocked < D.archive.length - 1) {
        audio.tone(170, 0.2, 'sawtooth', 0.06);
        toast('载入权限不足 · 请先阅读全部历史数据', 1600);
        it.classList.add('denied');
        setTimeout(() => it.classList.remove('denied'), 520);
        return;
      }
      if (it.classList.contains('open')) return;
      it.classList.add('open');
      audio.tick();
      audio.noise(0.1, 0.03, 950);
      unlocked++;
      state.archiveRead.add(String(i));
      const p = unlocked / D.archive.length;
      arcProg.textContent = `${unlocked}/7`;
      idxCount.textContent = `${unlocked} / 7`;
      idxBar.style.width = (p * 100) + '%';
      knob.style.top = Math.min(p * 92, 92) + '%';
      idxVal.textContent = (17.3 + unlocked * 0.4).toFixed(1) + '%';
      if (a.special) setTimeout(triggerAlarm, 420);
    });
  }

  /* ================= 第七幕 · 引导 ================= */
  function act7() {
    chapter('第七幕 · 引导');
    setScene('sanatorium_garden');
    renderGuidance();
    if (!state._act7intro) {
      state._act7intro = true;
      setTimeout(() => playDialogue([
        { who: 'narr', text: '窗外，胡萝卜躺在躺椅上，缨子耷拉着，旁边放着一杯果汁。' },
        { who: 'narr', text: '它抖了一下——不是报时，是伸懒腰。' },
        { who: 'onion', text: '它……它从来没伸过懒腰。' },
        { who: 'apple', text: '它从来没喝过果汁。' },
        { who: 'watermelon', text: '它从来没……晒过太阳。' },
        { who: 'radish', text: '表哥……' },
        { who: 'potato', text: '它说它累了。我以为它只是说说。' },
        { who: 'narr', text: '胡萝卜睁开眼睛，看到窗外的七个人。' },
        { who: 'carrot', text: '你们来了。\n我休假呢。\n我累了。你们自己想办法吧。' },
        { who: 'tomato', text: '（现在，轮到你了。你已经知道每个人心里卡着什么。）' }
      ]), 260);
    }
  }

  function renderGuidance() {
    const doneCount = D.residents.filter(id => state.guided[id]).length;
    const cards = D.residents.map(id => {
      const ch = D.characters[id];
      const g = D.guidances[id];
      const done = !!state.guided[id];
      return `<div class="guide-card ${done ? 'done' : ''}" data-res="${id}">
        <div class="gc-top">
          <img src="${ch.img}" alt="${ch.name}">
          <div>
            <div class="gc-name">${ch.name}</div>
            <div class="gc-dilemma">“${g.dilemma}”</div>
          </div>
        </div>
        ${done
          ? `<div class="gc-awaken">✓ 它学会了：${g.awaken}</div>`
          : `<div class="guide-opts">${g.options.map((o, i) =>
              `<button class="gopt" data-opt="${i}">${o}</button>`).join('')}</div>`}
      </div>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="guide-wrap">
          <div class="roster-head">
            <h2>教它们“自己看时间”</h2>
            <p>已唤醒 ${doneCount} / 7</p>
          </div>
          <div class="guide-grid">${cards}</div>
          ${doneCount >= 7 ? '<button class="pix-btn primary" id="to-act8" style="margin-top:20px">它们醒了 ▶</button>' : ''}
        </div>
      </div>`;

    $$('.gopt', stage).forEach(btn => btn.onclick = () => {
      const card = btn.closest('.guide-card');
      const id = card.dataset.res;
      const g = D.guidances[id];
      const idx = Number(btn.dataset.opt);
      if (idx === g.correct) {
        audio.chime();
        state.guided[id] = true;
        btn.classList.add('right');
        setTimeout(() => renderGuidance(), 420);
      } else {
        audio.tone(180, 0.16, 'sawtooth', 0.05);
        btn.classList.add('wrong');
        setTimeout(() => btn.classList.remove('wrong'), 500);
      }
    });

    const next = $('#to-act8');
    if (next) next.onclick = () => {
      audio.click();
      playDialogue([
        { who: 'chili', text: '……太阳偏西了。', scene: 'sanatorium_garden' },
        { who: 'eggplant', text: '影子拉长了。' },
        { who: 'radish', text: '土……土干了。' },
        { who: 'potato', text: '我……我饿了。' },
        { who: 'onion', text: '原来……饿了就是饿了，不用等六点。' },
        { who: 'watermelon', text: '我晒了一辈子太阳，今天才第一次“看见”它。' },
        { who: 'apple', text: '那……那我们是不是……有点像人了？' },
        { who: 'carrot', text: '像了。' },
        { who: 'tomato', text: '像多少？' },
        { who: 'carrot', text: '像个人了。' },
        { who: 'narr', text: '电脑屏幕上，自主意识指数从 17.3% 跳到 100%。', fx: 'flash' },
        { who: 'heihei', text: '……一百年了。' },
        { who: 'lala', text: '终于。' },
        { who: 'narr', text: '然后——仓库深处传来“嘀——嘀——嘀——”。', fx: 'shake' },
        { who: 'potato', text: '那个盒子……不是我藏的……' }
      ], () => act8());
    };
  }

  /* ================= 第八幕 · 炸弹 ================= */
  function act8() {
    chapter('第八幕 · 炸弹');
    setScene('bomb_box');
    audio.stopAmbient();
    audio.bombBeat();
    state.timer = 300;
    state.quizIndex = 0;

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="bomb-wrap">
          <div class="bomb-timer" id="bomb-timer"><span class="lbl">LAB-7 · 自毁倒计时</span><span id="timer-val">05:00</span></div>
          <div class="quiz-card">
            <div class="qc-head">
              <span class="qc-index" id="qc-index">Q01 / 30</span>
              <span class="qc-timegain" id="qc-gain">答对 +10 秒 · 目标 10:00</span>
            </div>
            <div class="quiz-q" id="qc-q">…</div>
            <div class="quiz-opts" id="qc-opts"></div>
            <div class="quiz-feedback" id="qc-fb">盒子上贴着：实验体清理程序 · 自毁协议 · 编号 LAB-7</div>
            <div class="quiz-hintline">
              <span>答对 30 题，倒计时延长至 10:00</span>
              <button class="linklike" id="skip-quiz">剧情模式：跳过答题 ›</button>
            </div>
          </div>
        </div>
      </div>`;

    const timerVal = $('#timer-val');
    const timerBox = $('#bomb-timer');

    function fmt(s) {
      s = Math.max(0, Math.ceil(s));
      const m = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return `${m}:${ss}`;
    }
    function paint() {
      timerVal.textContent = fmt(state.timer);
      timerBox.classList.toggle('safe', state.timer >= 600);
    }
    paint();

    state.timerId = setInterval(() => {
      if (!state.started) return;
      state.timer -= 1;
      paint();
      if (state.timer <= 30 && state.timer > 0) {
        audio.tick();
        if (state.timer % 2 === 0) doFx('glitch');
      }
      if (state.timer <= 0) {
        clearInterval(state.timerId);
        state.timerId = null;
        timeUp();
      }
    }, 1000);

    function timeUp() {
      audio.stopBombBeat();
      whiteOut(300);
      audio.boom();
      setTimeout(() => {
        stage.innerHTML = `
          <div class="act-wrap" style="display:grid;place-items:center;background:rgba(10,4,10,.85)">
            <div style="text-align:center">
              <div style="font-family:var(--font-en);font-size:72px;color:var(--red);letter-spacing:.1em;text-shadow:0 0 30px rgba(232,65,58,.8)">TIME UP</div>
              <p style="margin-top:10px;font-size:15px;letter-spacing:.16em;color:var(--paper)">时间到了。但盒子没有炸。</p>
              <p style="margin-top:6px;font-size:13px;letter-spacing:.1em;color:rgba(248,240,221,.6)">它只是想让你再试一次。</p>
              <button class="pix-btn primary" id="retry" style="margin-top:24px">重新开始拆弹 ▶</button>
            </div>
          </div>`;
        whiteIn(400);
        $('#retry').onclick = () => { audio.click(); act8(); };
      }, 700);
    }

    function nextQuestion() {
      const idx = state.quizIndex;
      const q = D.quiz[idx];
      $('#qc-index').textContent = `Q${String(idx + 1).padStart(2, '0')} / 30`;
      $('#qc-q').textContent = q[0];
      const opts = $('#qc-opts');
      opts.innerHTML = q[1].map((t, i) =>
        `<button class="qopt" data-i="${i}">${String.fromCharCode(65 + i)}. ${t}</button>`).join('');
      $('#qc-fb').textContent = '';
      $$('.qopt', opts).forEach(btn => btn.onclick = () => {
        if (btn.disabled) return;
        audio.click();
        const chosen = Number(btn.dataset.i);
        const isLast = idx === D.quiz.length - 1;
        $$('.qopt', opts).forEach(b => b.disabled = true);
        if (chosen === q[2]) {
          btn.classList.add('right', 'bounce');
          /* 答对：齿轮剧烈转动发金光 */
          timerBox.classList.add('gear-burst');
          setTimeout(() => timerBox.classList.remove('gear-burst'), 600);
          state.timer = Math.min(state.timer + 10, 900);
          $('#qc-fb').textContent = isLast
            ? '✓ 正确。系统沉默了三秒，然后松开了引线。'
            : '✓ 正确。倒计时 +10 秒。';
          audio.tone(1050, 0.12, 'triangle', 0.05);
          state.quizIndex++;
          paint();
          if (state.quizIndex >= D.quiz.length) return setTimeout(reachTen, 900);
          setTimeout(nextQuestion, 760);
        } else {
          btn.classList.add('wrong');
          $$('.qopt', opts)[q[2]].classList.add('right');
          /* 答错：全屏剧烈震动 + 齿轮卡死冒黑烟 */
          document.body.classList.add('quiz-shake');
          timerBox.classList.add('gear-stuck');
          setTimeout(() => {
            document.body.classList.remove('quiz-shake');
            timerBox.classList.remove('gear-stuck');
          }, 500);
          state.timer = Math.max(5, state.timer - 5);
          $('#qc-fb').textContent = isLast
            ? '✗ 不对。系统还在等你的回答。'
            : '✗ 不对。倒计时 -5 秒。';
          audio.tone(160, 0.18, 'sawtooth', 0.05);
          paint();
          if (isLast) {
            setTimeout(nextQuestion, 1100);
            return;
          }
          state.quizIndex++;
          setTimeout(nextQuestion, 760);
        }
      });
    }

    let reached = false;
    function reachTen() {
      if (reached) return;
      reached = true;
      audio.stopBombBeat();
      clearInterval(state.timerId);
      state.timerId = null;
      state.timer = 600;
      paint();
      audio.chime();
      $('#qc-q').textContent = '倒计时已延长至 10:00。';
      $('#qc-opts').innerHTML = '';
      $('#qc-fb').textContent = '拆弹专家，现在——剪断一根线。';
      const btn = document.createElement('button');
      btn.className = 'pix-btn primary';
      btn.textContent = '去剪线 ▶';
      btn.style.marginTop = '10px';
      btn.onclick = () => { audio.click(); clearInterval(state.timerId); act9(); };
      $('#qc-opts').appendChild(btn);
    }

    nextQuestion();

    $('#skip-quiz').onclick = () => {
      audio.click();
      state.timer = 600;
      paint();
      reachTen();
    };
  }

  /* ================= 第九幕 · 剪线 ================= */
  function act9() {
    chapter('第九幕 · 剪线');
    setScene('cut_wires');
    const wires = [
      { x: 28, color: '#ff2b3d', name: '红线', meaning: '情感 · 辣椒素素的护短' },
      { x: 50, color: '#1f7bff', name: '蓝线', meaning: '规则 · 规章第七条' },
      { x: 72, color: '#ffe12b', name: '黄线', meaning: '时间 · 胡萝卜的一百年' }
    ];
    stage.innerHTML = `
      <div class="act-wrap">
        <div class="cut-wrap">
          ${wires.map(w => `
            <button class="wire" data-color="${w.name}" style="left:${w.x}%;color:${w.color}">
              <span class="wire-line"></span>
              <span class="wire-tip"></span>
              <span class="wire-label">${w.name}</span>
              <span class="wire-meaning">${w.meaning}</span>
            </button>`).join('')}
        </div>
        <div class="act-title" style="top:auto;bottom:120px">
          <h2>剪断一根</h2>
          <p>不管剪哪条，都会爆炸。但也许……爆炸不是结束。</p>
        </div>
      </div>`;

    let cut = false;
    $$('.wire', stage).forEach(w => w.onclick = () => {
      if (cut) return;
      cut = true;
      audio.click();
      audio.boom();
      whiteOut(420);
      const label = w.dataset.color;
      setTimeout(() => {
        stage.innerHTML = '';
        endingIntro(label);
        whiteIn(420);
      }, 900);
    });
  }

  /* ================= 第十幕 · 结局 ================= */
  async function endingIntro(cutColor) {
    chapter('终幕 · 外面的路');
    setScene('cut_wires');
    await wait(200);
    playDialogue([
      { who: 'narr', text: `你剪断了${cutColor}。\n——白光。不是爆炸的白光，是被记得的白光。`, fx: 'flash' },
      { who: 'narr', text: '底层协议：检测到实验体自主意识觉醒。\n限制解除。\n实验体 7 名，已获得外出权限。\n自毁程序：终止。' },
      { who: 'narr', text: '白光散去，远处出现一条路。', scene: 'road_outside' },
      { who: 'narr', text: '七个居民走向外面。' },
      { who: 'eggplant', text: '（茄子紫紫走在最后面，突然停下来，从口袋里掏出一根茄子，放在仓库门口。）' },
      { who: 'chili', text: '你干嘛？' },
      { who: 'eggplant', text: '还债。它不在，我先放这儿。等它休假回来，自己拿。' },
      { who: 'watermelon', text: '它要一根茄子干什么？' },
      { who: 'eggplant', text: '不知道。但我欠了两年，总得还。' },
      { who: 'narr', text: '然后它转身，追上了大家。' },
      { who: 'carrot', text: '谢谢你。\n你帮他们醒了。\n也帮他们走了。\n现在——该拆那个盒子了。\n里面还有东西。' }
    ], () => endingFinale());
  }

  function endingFinale() {
    chapter('终幕 · 最后的晚餐');
    setScene('road_outside');
    flashEl.classList.remove('hold', 'on');
    audio.ambient();
    const html = `
      <div class="ending-wrap">
        <div class="polaroid" id="polaroid">
          <div class="photo-canvas" id="photo-canvas">
            <canvas id="photo-shot" width="1200" height="750" style="width:100%;height:100%;display:block"></canvas>
          </div>
        </div>
        <div class="ending-actions" id="end-actions">
          <div style="position:relative">
            <div class="end-arrow" id="end-arrow">
              <span class="ea-txt">点击查看隐藏档案</span>
              <span class="ea-line"></span>
              <span class="ea-head"></span>
            </div>
            <button class="pix-btn primary" id="save-photo">保存合照</button>
          </div>
          <button class="pix-btn" id="open-card">打开盒子里的贺卡</button>
          <button class="pix-btn" id="open-3d">3D 角色档案</button>
        </div>
      </div>`;
    /* 结局引导：微弱提示音 + 箭头呼吸 */
    const hintId = setInterval(() => {
      if (!state.sound) return;
      audio.tone(880, 0.06, 'triangle', 0.03);
    }, 1200);

    const ov = openOverlay(html, { className: 'ending-ov', closable: false, onClose: () => clearInterval(hintId) });
    drawGroupPhoto($('#photo-shot', ov));
    spawnPetals(ov);

    $('#save-photo', ov).onclick = () => {
      audio.chime();
      clearInterval(hintId);
      const c = $('#photo-shot', ov);
      c.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '蔬菜镇·合影.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      });
      const acts = $('#end-actions', ov);
      acts.style.opacity = '.25';
      acts.style.pointerEvents = 'none';
      setTimeout(() => startRealFinale(ov), 460);
    };
    $('#open-card', ov).onclick = () => openCards(ov);
    $('#open-3d', ov).onclick = () => open3DArchive();
  }

  /* -------- 终章：现实硬切 -------- */
  async function startRealFinale(ov) {
    audio.stopAll();
    const pol = $('#polaroid', ov);
    audio.crunch();
    pol.classList.add('crumple');
    await wait(960);

    const fin = document.createElement('div');
    fin.className = 'fin-layer';
    fin.innerHTML = `
      <div class="fin-shot" id="fin-shot"></div>
      <div class="film-grain" id="fin-grain"></div>
      <div class="fin-caption" id="fin-cap"></div>
      <div class="fin-glitch" id="fin-glitch"></div>`;
    document.body.appendChild(fin);

    const shot = $('#fin-shot', fin);
    const cap = $('#fin-cap', fin);
    const grain = $('#fin-grain', fin);
    const glitch = $('#fin-glitch', fin);

    /* 9 帧提线木偶定格序列：首选写实图，缺失时回退到现有菜品图 */
    const fallback = {
      table_food: 'dish_carrot',
      woman_lookdown: 'human_eyes',
      woman_eat_carrot: 'dish_carrot',
      woman_eat_eggplant: 'dish_eggplant',
      woman_eat_chili: 'dish_chili',
      woman_eat_potato: 'dish_potato',
      woman_eat_onion: 'dish_onion',
      woman_eat_fruit: 'dish_fruit',
      woman_stare: 'human_eyes'
    };
    const frames = [
      ['table_food', '一大桌菜 · 六道菜整齐排列'],
      ['woman_lookdown', '女人低头看着桌面'],
      ['woman_eat_carrot', '红烧胡萝卜块'],
      ['woman_eat_eggplant', '油焖茄子'],
      ['woman_eat_chili', '干煸双辣椒'],
      ['woman_eat_potato', '软烂土豆块'],
      ['woman_eat_onion', '金黄洋葱圈'],
      ['woman_eat_fruit', '西瓜果切 · 苹果片'],
      ['woman_stare', '……']
    ];
    const imgCache = {};
    function resolveImg(name) {
      return new Promise(res => {
        const tryUrl = `assets/finale/${name}.${SCENE_EXT}`;
        const probe = new Image();
        probe.onload = () => res(tryUrl);
        probe.onerror = () => res(`assets/finale/${fallback[name] || 'dish_carrot'}.${SCENE_EXT}`);
        probe.src = tryUrl;
      });
    }
    shot.classList.add('dishes', 'on', 'puppet');
    for (let i = 0; i < frames.length; i++) {
      const [name, label] = frames[i];
      const url = imgCache[name] || (imgCache[name] = await resolveImg(name));
      shot.style.backgroundImage = `url(${url})`;
      if (i === frames.length - 1) {
        /* 第 9 帧：女人死盯屏幕 —— 突然放大、颗粒加重、完全静止 */
        shot.classList.remove('puppet', 'dishes');
        shot.classList.add('stare');
        grain.classList.add('heavy');
        cap.textContent = '';
        audio.heart();
        await wait(1500);
        audio.heart();
        await wait(1500);
      } else {
        cap.textContent = `FINAL DISH · ${String(i + 1).padStart(3, '0')} / ${label}`;
        audio.crunch();
        await wait(400);
      }
    }

    /* 雪花碎裂 → 回到像素广场 */
    glitch.classList.add('on');
    audio.noise(0.9, 0.14, 3000);
    shot.classList.remove('on', 'stare');
    await wait(850);
    fin.remove();
    closeOverlay(ov);
    setScene('town_square_dawn');
    await wait(520);

    playDialogue([
      { who: 'tomato', text: '你看……他们走了。' },
      { who: 'tomato', text: '可是，我为什么闻到了……胡萝卜浓汤的味道？' },
      { who: 'tomato', text: '喂，你刚刚…有没有吃饭……？' }
    ], () => showBirthday());
  }

  /* -------- 终章：时间的礼物 -------- */
  async function showBirthday() {
    const black = document.createElement('div');
    black.className = 'fin-black';
    black.innerHTML = '<div class="fin-cursor"></div><div class="fin-hint">TIME REMAINING · ∞</div>';
    document.body.appendChild(black);
    await wait(2300);

    const layer = document.createElement('div');
    layer.className = 'birthday-wrap';
    layer.innerHTML = `
      <div class="confetti" id="bday-conf"></div>
      <div class="bday-card">
        <div class="bd-kicker">A GIFT FROM TIME · 时间管理局 · 私人包裹</div>
        <h2>你好，生日快乐！</h2>
        <p class="bd-line">游戏只是游戏，祝你生日快乐呀！</p>
        <p class="bd-line">相信你会把时间把握在自己手里。</p>
        <p class="bd-line">相信你是自由的，有力量的，保持思考的灵魂！</p>
        <p class="bd-line">祝福你身体健康、平安快乐！</p>
        <div class="life-box">
          <div class="lb-k">恭喜你来到这个世界上</div>
          <div class="lb-v" id="life-counter">[ 计算中… ]</div>
        </div>
        <div class="bd-sign">自由专用 <span class="bd-heart"></span></div>
        <div class="bday-actions">
          <button class="pix-btn primary" id="bd-3d">3D 角色档案</button>
          <button class="pix-btn" id="bd-cards">打开盒子里的旧贺卡</button>
          <button class="pix-btn ghost" id="bd-restart" style="background:rgba(21,14,43,.06);color:var(--ink);border-color:var(--ink);box-shadow:none">↺ 重新开始</button>
        </div>
      </div>`;
    document.body.appendChild(layer);
    black.remove();
    audio.bday();

    const conf = $('#bday-conf', layer);
    const colors = ['#ffb7c5', '#00ffcc', '#ffe94a', '#8b00ff', '#e8413a', '#00ffff'];
    for (let i = 0; i < 80; i++) {
      const c = document.createElement('i');
      c.style.left = (Math.random() * 100).toFixed(2) + '%';
      c.style.background = colors[i % colors.length];
      c.style.width = (4 + Math.random() * 5).toFixed(0) + 'px';
      c.style.height = (8 + Math.random() * 8).toFixed(0) + 'px';
      c.style.animationDuration = (3.6 + Math.random() * 4).toFixed(1) + 's';
      c.style.animationDelay = (-Math.random() * 6).toFixed(1) + 's';
      conf.appendChild(c);
    }

    startLifeCounter($('#life-counter', layer));
    $('#bd-3d', layer).onclick = () => open3DArchive();
    $('#bd-cards', layer).onclick = () => openCards(null);
    $('#bd-restart', layer).onclick = () => { audio.click(); location.reload(); };
  }

  function startLifeCounter(el) {
    const start = new Date('2004-10-04T00:00:00+08:00');
    const tick = () => {
      let diff = Date.now() - start.getTime();
      if (diff < 0) { el.textContent = '[ 时间还没开始 ]'; return; }
      const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
      diff -= years * (1000 * 60 * 60 * 24 * 365.25);
      const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.44));
      diff -= months * (1000 * 60 * 60 * 24 * 30.44);
      const days = Math.floor(diff / 86400000);
      diff -= days * 86400000;
      const hours = Math.floor(diff / 3600000);
      diff -= hours * 3600000;
      const minutes = Math.floor(diff / 60000);
      diff -= minutes * 60000;
      const seconds = Math.floor(diff / 1000);
      el.textContent = `[ ${years} 年 ${months} 月 ${days} 日 ${hours} 时 ${minutes} 分 ${seconds} 秒 ]`;
    };
    tick();
    setInterval(tick, 1000);
  }


  /* -------- 合照绘制 -------- */
  function drawGroupPhoto(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, '#ffd9e6');
    sky.addColorStop(0.55, '#ffe9c9');
    sky.addColorStop(1, '#ffe0b8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // 太阳
    const sun = ctx.createRadialGradient(W * 0.5, H * 0.42, 10, W * 0.5, H * 0.42, 190);
    sun.addColorStop(0, 'rgba(255,246,194,1)');
    sun.addColorStop(0.45, 'rgba(255,209,102,.95)');
    sun.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(W * 0.5, H * 0.42, 190, 0, Math.PI * 2); ctx.fill();

    // 云
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    [[W * 0.18, H * 0.22, 90], [W * 0.78, H * 0.18, 76], [W * 0.62, H * 0.3, 58]].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.7, y + r * 0.15, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x - r * 0.7, y + r * 0.18, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    });

    // 草地
    const grass = ctx.createLinearGradient(0, H * 0.5, 0, H);
    grass.addColorStop(0, '#a8e29a');
    grass.addColorStop(1, '#6fbd60');
    ctx.fillStyle = grass;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.52);
    ctx.quadraticCurveTo(W * 0.5, H * 0.44, W, H * 0.52);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    // 土路
    ctx.fillStyle = '#e8c79b';
    ctx.beginPath();
    ctx.moveTo(W * 0.5, H * 0.5);
    ctx.lineTo(W * 0.62, H);
    ctx.lineTo(W * 0.38, H);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(W * 0.5, H * 0.5);
    ctx.lineTo(W * 0.55, H);
    ctx.lineTo(W * 0.45, H);
    ctx.closePath(); ctx.fill();

    // 角色
    const lineup = D.photoLineup.slice().sort((a, b) => a.y - b.y);
    let pending = lineup.length;
    lineup.forEach(item => {
      const ch = D.characters[item.id];
      const img = new Image();
      img.onload = () => {
        const h = 250 * (item.s || 1);
        const w = h * (img.width / img.height);
        const x = W * item.x / 100 - w / 2;
        const y = H * item.y / 100 - h * 0.5;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.18)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 10;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
        if (--pending === 0) done();
      };
      img.onerror = () => { if (--pending === 0) done(); };
      img.src = ch.img;
    });

    function done() {
      // 手写标题
      ctx.fillStyle = 'rgba(58,44,71,.85)';
      ctx.font = 'bold 30px "VT323", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('VEGETABLE TOWN · 7 RESIDENTS', W / 2, H * 0.93);
      // 颗粒
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 900; i++) {
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
    }
    if (lineup.length === 0) done();
  }

  function spawnPetals(container) {
    const layer = document.createElement('div');
    layer.className = 'petals';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      p.className = 'petal';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (7 + Math.random() * 8).toFixed(1) + 's';
      p.style.animationDelay = (-Math.random() * 10).toFixed(1) + 's';
      p.style.transform = `scale(${(0.6 + Math.random()).toFixed(2)})`;
      layer.appendChild(p);
    }
    container.appendChild(layer);
  }

  /* -------- 贺卡 -------- */
  function openCards(parentOv) {
    const ov = openOverlay(`
      <div class="card-frame">
        <img id="card-img" src="assets/cards/card_normal.jpg" alt="贺卡">
        <div class="card-switch">
          <button class="pix-btn" id="card-normal">普通版 · THANK YOU</button>
          <button class="pix-btn" id="card-bday">生日版 · HAPPY BIRTHDAY</button>
          <a class="pix-btn primary" id="card-dl" download="蔬菜镇·贺卡.jpg" href="assets/cards/card_normal.jpg">下载贺卡</a>
        </div>
      </div>`, { className: 'card-ov' });
    $('#card-normal', ov).onclick = () => {
      audio.click();
      $('#card-img', ov).src = 'assets/cards/card_normal.jpg';
      $('#card-dl', ov).href = 'assets/cards/card_normal.jpg';
      $('#card-dl', ov).download = '蔬菜镇·贺卡-普通版.jpg';
    };
    $('#card-bday', ov).onclick = () => {
      audio.click();
      $('#card-img', ov).src = 'assets/cards/card_birthday.jpg';
      $('#card-dl', ov).href = 'assets/cards/card_birthday.jpg';
      $('#card-dl', ov).download = '蔬菜镇·贺卡-生日版.jpg';
    };
  }

  /* ================= 3D 档案室 ================= */
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function open3DArchive() {
    const chars = Object.values(D.characters);
    const html = `
      <div class="archive3d">
        <div class="a3d-side">
          <h4>CHARACTERS · 3D</h4>
          ${chars.map((c, i) => `
            <button class="a3d-item ${i === 0 ? 'active' : ''}" data-cid="${c.id}">
              <img src="${c.img}" alt="">
              <span>${c.name}</span>
            </button>`).join('')}
        </div>
        <div class="a3d-stage" id="a3d-stage">
          <div class="a3d-loading" id="a3d-loading">LOADING 3D …</div>
          <div class="a3d-meta">
            <div class="n" id="a3d-name"></div>
            <div class="t" id="a3d-tag"></div>
          </div>
          <div class="a3d-tip" id="a3d-tip">拖拽旋转 · 滚轮缩放</div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'a3d-ov' });
    const stageEl = $('#a3d-stage', ov);
    let viewer = null;

    function select(id) {
      const c = chars.find(x => x.id === id) || chars[0];
      $$('.a3d-item', ov).forEach(b => b.classList.toggle('active', b.dataset.cid === c.id));
      $('#a3d-name', ov).textContent = c.name;
      $('#a3d-tag', ov).textContent = c.tag;
      if (viewer) viewer.show(c.img);
      else {
        const img = $('#a3d-fallback-img', ov);
        if (img) img.src = c.img;
      }
    }

    function mountFallback(msg) {
      const l = $('#a3d-loading', ov);
      if (l) l.remove();
      $('#a3d-tip', ov).textContent = '2D 设定图 · 与 3D 贴图同源';
      const fb = document.createElement('div');
      fb.className = 'a3d-fallback';
      fb.innerHTML = `<img id="a3d-fallback-img" src="${chars[0].img}" alt="">
        <div class="a3d-note">${msg}</div>`;
      stageEl.appendChild(fb);
      select(chars[0].id);
    }

    $$('.a3d-item', ov).forEach(btn => {
      btn.onclick = () => { audio.click(); select(btn.dataset.cid); };
    });

    if (!hasWebGL()) {
      mountFallback('本机 WebGL 不可用 · 显示 2D 设定图');
      return;
    }

    import('./archive3d.js').then(mod => {
      viewer = mod.createArchive3D(stageEl);
      const l = $('#a3d-loading', ov);
      if (l) l.remove();
      select(chars[0].id);
      ov._cleanup = () => viewer.dispose();
      ov._onClose = () => viewer.dispose();
    }).catch(err => {
      console.error(err);
      mountFallback('3D 渲染初始化失败 · 已切换为 2D 设定图');
    });
  }

  /* ================= HUD 事件 ================= */
  $('#btn-clueboard').onclick = () => { audio.click(); openClueBoard(); };
  $('#btn-archive3d').onclick = () => { audio.click(); open3DArchive(); };
  $('#btn-sound').onclick = e => {
    state.sound = !state.sound;
    e.currentTarget.textContent = state.sound ? 'SFX ON' : 'SFX OFF';
    if (state.sound) { audio.init(); audio.click(); }
  };

  /* ================= 启动 ================= */
  updateClueBadge();
  bootTitle();

  /* 隐藏启动 Loading（等首屏场景图开始渲染后淡出） */
  const bootLdr = $('#boot-loader');
  if (bootLdr) {
    setTimeout(() => {
      bootLdr.classList.add('out');
      setTimeout(() => bootLdr.remove(), 600);
    }, 700);
  }
})();
