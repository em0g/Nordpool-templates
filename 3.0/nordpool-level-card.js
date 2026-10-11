/*
 * nordpool-level-card – kompakt elpriskort med nivåerna Billigt / Normalt / Dyrt.
 *
 * Läser sensor.elpris från 3.0/nordpool_templates.yaml:
 *   attributes.prices      [[start_epoch_s, pris_kr], ...]
 *   attributes.cheap_max   pris <= cheap_max  → Billigt
 *   attributes.normal_max  pris <= normal_max → Normalt, annars Dyrt
 *
 * type: custom:nordpool-level-card
 * entity: sensor.elpris
 * title: Elpris SE3          # valfri
 * layout: bars               # bars | strip   (knappen i kortet växlar)
 * resolution: hour           # hour | quarter
 * unit: kr                   # kr | öre
 * decimals: 2                # standard 2 för kr, 0 för öre
 * cheap_window_hours: 3      # 0 = dölj "billigast"-fönstret
 * show_thresholds: false
 * height: 120                # staplarnas höjd i px
 * colors: { cheap: '#13a365', normal: '#e3a512', expensive: '#e5484d' }
 */

const VERSION = '3.0.0';

const DEFAULTS = {
  entity: 'sensor.elpris',
  layout: 'bars',
  resolution: 'hour',
  unit: 'kr',
  cheap_window_hours: 3,
  show_thresholds: false,
  height: 120,
};

const DEFAULT_COLORS = { cheap: '#13a365', normal: '#e3a512', expensive: '#e5484d' };
const LEVELS = [
  { key: 'cheap', name: 'Billigt' },
  { key: 'normal', name: 'Normalt' },
  { key: 'expensive', name: 'Dyrt' },
];

const ICON_BARS = 'M4 20h2V10H4v10zm5 0h2V4H9v16zm5 0h2v-7h-2v7zm5 0h2V8h-2v12z';
const ICON_STRIP = 'M3 10h18v4H3z M3 17h2v2H3z M9 17h2v2H9z M15 17h2v2h-2z';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function dayStart(ts) {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

function hourStart(ts) {
  const d = new Date(ts * 1000);
  d.setMinutes(0, 0, 0);
  return d.getTime() / 1000;
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function stepDecimals(step) {
  for (let d = 0; d < 4; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 3;
}

// Stapel med rundade hörn mot värdet och rak kant mot nollinjen.
function barPath(x, base, top, w, r) {
  const h = Math.abs(base - top);
  if (h < 1.5) top = base - 1.5;
  const up = top <= base;
  r = Math.max(0, Math.min(r, w / 2, Math.abs(base - top)));
  const s = up ? 1 : -1;
  return `M${x},${base}V${top + s * r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + s * r}V${base}Z`;
}

class NordpoolLevelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._width = 0;
    this._geo = null;
  }

  static getStubConfig(hass) {
    const found = Object.keys(hass?.states || {}).find((id) => {
      const a = hass.states[id].attributes;
      return Array.isArray(a.prices) && a.cheap_max !== undefined;
    });
    return { entity: found || DEFAULTS.entity };
  }

  setConfig(config) {
    if (!config) throw new Error('Ogiltig konfiguration');
    const cfg = { ...DEFAULTS, ...config };
    if (!['bars', 'strip'].includes(cfg.layout)) throw new Error('layout måste vara bars eller strip');
    if (!['hour', 'quarter'].includes(cfg.resolution)) throw new Error('resolution måste vara hour eller quarter');
    if (!['kr', 'öre', 'ore'].includes(cfg.unit)) throw new Error('unit måste vara kr eller öre');
    cfg.ore = cfg.unit !== 'kr';
    cfg.decimals = cfg.decimals ?? (cfg.ore ? 0 : 2);
    cfg.colors = { ...DEFAULT_COLORS, ...(config.colors || {}) };
    this._config = cfg;
    this._storeKey = `nordpool-level-card:${cfg.entity}:${cfg.title || ''}:${cfg.layout}`;
    let stored = null;
    try { stored = localStorage.getItem(this._storeKey); } catch (e) { /* privat läge m.m. */ }
    this._layout = stored === 'bars' || stored === 'strip' ? stored : cfg.layout;
    this._built = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config?.entity];
    if (st !== this._stateObj) {
      this._stateObj = st;
      this._render();
    }
  }

  connectedCallback() {
    this._timer = setInterval(() => this._render(), 60 * 1000);
    if (!this._ro && window.ResizeObserver) {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== this._width) {
          this._width = w;
          this._render();
        }
      });
    }
    if (this._chartEl) this._ro?.observe(this._chartEl);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._ro?.disconnect();
  }

  getCardSize() {
    return this._layout === 'strip' ? 2 : 3;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  // ---------- data ----------

  _data() {
    const st = this._stateObj;
    if (!st) return null;
    const a = st.attributes;
    let raw = a.prices;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }
    if (!Array.isArray(raw) || !raw.length) return null;
    const pts = raw
      .filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => ({ start: Number(p[0]), price: Number(p[1]) }))
      .sort((x, y) => x.start - y.start);
    if (!pts.length) return null;
    const step = Number(a.interval) || (pts.length > 1 ? pts[1].start - pts[0].start : 900);
    pts.forEach((p) => { p.end = p.start + step; });

    let cheapMax = parseFloat(a.cheap_max);
    let normalMax = parseFloat(a.normal_max);
    if (!isFinite(cheapMax) || !isFinite(normalMax)) {
      // Reserv om sensorn saknar gränser: percentil 35/70.
      const s = pts.map((p) => p.price).sort((x, y) => x - y);
      cheapMax = s[Math.floor((s.length - 1) * 0.35)];
      normalMax = s[Math.floor((s.length - 1) * 0.7)];
    }
    const level = (p) => (p <= cheapMax ? 0 : p <= normalMax ? 1 : 2);
    pts.forEach((p) => { p.level = level(p.price); });

    let items = pts;
    if (this._config.resolution === 'hour' && step < 3600) {
      const groups = new Map();
      pts.forEach((p) => {
        const h = hourStart(p.start);
        if (!groups.has(h)) groups.set(h, []);
        groups.get(h).push(p);
      });
      items = [...groups.entries()].map(([h, subs]) => {
        const price = subs.reduce((t, s) => t + s.price, 0) / subs.length;
        return { start: h, end: h + 3600, price, level: level(price), subs };
      });
    }
    return { pts, items, step, cheapMax, normalMax };
  }

  // ---------- formatering ----------

  _fmt(kr, decimals = this._config.decimals) {
    const v = this._config.ore ? kr * 100 : kr;
    return v.toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  _unit() {
    return this._config.ore ? 'öre/kWh' : 'kr/kWh';
  }

  _time(ts) {
    return new Date(ts * 1000).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  _dayWord(ts, nowTs) {
    const diff = Math.round((dayStart(ts) - dayStart(nowTs)) / 86400);
    if (diff === 0) return '';
    if (diff === 1) return 'imorgon';
    if (diff === -1) return 'igår';
    return new Date(ts * 1000).toLocaleDateString('sv-SE', { weekday: 'short' });
  }

  _color(level) {
    return this._config.colors[LEVELS[level].key];
  }

  // ---------- sammanfattning ----------

  _summary(d, nowTs) {
    const cur = d.pts.findIndex((p) => p.start <= nowTs && nowTs < p.end);
    if (cur < 0) return [];
    const parts = [];
    const lv = d.pts[cur].level;
    const next = d.pts.slice(cur + 1).find((p) => p.level !== lv);
    if (next) {
      const day = this._dayWord(next.start, nowTs);
      parts.push(`<span class="dot" style="background:${this._color(next.level)}"></span>${LEVELS[next.level].name} från <b>${this._time(next.start)}</b>${day ? ' ' + day : ''}`);
    } else {
      parts.push(`${LEVELS[lv].name} resten av perioden`);
    }

    const hours = Number(this._config.cheap_window_hours) || 0;
    const k = Math.round((hours * 3600) / d.step);
    const future = d.pts.slice(cur);
    if (k > 0 && future.length >= k) {
      let sum = 0;
      let best = Infinity;
      let bestI = 0;
      for (let i = 0; i < future.length; i++) {
        sum += future[i].price;
        if (i >= k) sum -= future[i - k].price;
        if (i >= k - 1 && sum < best) { best = sum; bestI = i - k + 1; }
      }
      const a = future[bestI];
      const b = future[bestI + k - 1];
      const day = this._dayWord(a.start, nowTs);
      parts.push(`Billigast ${hours} h <b>${this._time(a.start)}–${this._time(b.end)}</b>${day ? ' ' + day : ''} · ${this._fmt(best / k)}`);
    }
    return parts;
  }

  // ---------- rendering ----------

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="head">
          <div class="now"></div>
          <button class="toggle" title="Växla vy" aria-label="Växla vy"><svg viewBox="0 0 24 24"><path></path></svg></button>
        </div>
        <div class="summary"></div>
        <div class="chart"></div>
        <div class="foot"></div>
        <div class="tip" hidden></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._nowEl = $('.now');
    this._summaryEl = $('.summary');
    this._chartEl = $('.chart');
    this._footEl = $('.foot');
    this._tipEl = $('.tip');
    this._toggleEl = $('.toggle');
    this._toggleEl.addEventListener('click', () => this._toggleLayout());
    this._chartEl.addEventListener('pointermove', (e) => this._hover(e));
    this._chartEl.addEventListener('pointerdown', (e) => this._hover(e));
    this._chartEl.addEventListener('pointerleave', () => this._hideTip());
    if (this._ro) this._ro.observe(this._chartEl);
    this._built = true;
  }

  _toggleLayout() {
    this._layout = this._layout === 'bars' ? 'strip' : 'bars';
    try { localStorage.setItem(this._storeKey, this._layout); } catch (e) { /* ignorera */ }
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._built) this._build();
    this._hideTip();
    this._toggleEl.querySelector('path').setAttribute('d', this._layout === 'bars' ? ICON_STRIP : ICON_BARS);
    this.shadowRoot.querySelector('ha-card').classList.toggle('is-strip', this._layout === 'strip');

    const title = this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : '';
    if (!this._stateObj) {
      this._nowEl.innerHTML = `${title}<div class="warn">Entiteten ${esc(this._config.entity)} hittas inte</div>`;
      this._summaryEl.innerHTML = this._chartEl.innerHTML = this._footEl.innerHTML = '';
      return;
    }
    const d = this._data();
    if (!d) {
      this._nowEl.innerHTML = `${title}<div class="warn">Inga priser i ${esc(this._config.entity)}</div>`;
      this._summaryEl.innerHTML = this._chartEl.innerHTML = this._footEl.innerHTML = '';
      return;
    }
    this._d = d;
    const nowTs = Date.now() / 1000;
    const cur = d.pts.find((p) => p.start <= nowTs && nowTs < p.end);

    if (cur) {
      const c = this._color(cur.level);
      this._nowEl.innerHTML = `${title}
        <div class="row">
          <span class="price">${this._fmt(cur.price)}</span><span class="unit">${this._unit()}</span>
          <span class="chip" style="--c:${c}"><span class="dot" style="background:${c}"></span>${LEVELS[cur.level].name}</span>
        </div>`;
    } else {
      this._nowEl.innerHTML = `${title}<div class="row"><span class="price">–</span><span class="unit">${this._unit()}</span></div>`;
    }
    this._summaryEl.innerHTML = this._summary(d, nowTs).map((p) => `<span>${p}</span>`).join('');

    const width = this._width || this._chartEl.clientWidth || 360;
    if (this._layout === 'strip') this._renderStrip(d, nowTs, width);
    else this._renderBars(d, nowTs, width);
  }

  _xAxis(items, x0, slot, y, nowTs) {
    let out = '';
    items.forEach((it, i) => {
      const d = new Date(it.start * 1000);
      if (d.getMinutes() !== 0 || d.getHours() % 6 !== 0) return;
      const x = x0 + i * slot;
      const label = String(d.getHours()).padStart(2, '0');
      out += `<text class="axis" x="${x}" y="${y}" text-anchor="${i === 0 ? 'start' : 'middle'}">${label}</text>`;
    });
    return out;
  }

  _dayBounds(items) {
    // index där ett nytt dygn börjar (utom första)
    const out = [];
    for (let i = 1; i < items.length; i++) {
      if (dayStart(items[i].start) !== dayStart(items[i - 1].start)) out.push(i);
    }
    return out;
  }

  _renderBars(d, nowTs, width) {
    const items = d.items;
    const height = Number(this._config.height) || 120;
    const prices = items.map((i) => i.price);
    let lo = Math.min(0, ...prices);
    let hi = Math.max(0, ...prices);
    if (hi - lo < 1e-6) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const tickDec = stepDecimals(this._config.ore ? step * 100 : step);
    const tickLabels = ticks.map((v) => this._fmt(v, tickDec));
    const left = Math.max(...tickLabels.map((t) => t.length)) * 6.2 + 8;
    const top = 16;
    const bottom = 18;
    const plotW = Math.max(40, width - left - 2);
    const plotH = height;
    const y = (v) => top + ((hi - v) / (hi - lo)) * plotH;
    const slot = plotW / items.length;
    const gap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
    const bw = Math.max(0.5, slot - gap);
    const r = Math.min(3, bw / 3);
    const base = y(0);

    let svg = '';
    ticks.forEach((v, i) => {
      svg += `<line class="grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"></line>`;
      svg += `<text class="axis" x="${left - 6}" y="${y(v) + 3.5}" text-anchor="end">${tickLabels[i]}</text>`;
    });

    // dygnsgränser + etiketter
    const bounds = this._dayBounds(items);
    const starts = [0, ...bounds];
    starts.forEach((i) => {
      const x = left + i * slot;
      if (i > 0) svg += `<line class="daysep" x1="${x - gap / 2}" x2="${x - gap / 2}" y1="${top - 12}" y2="${top + plotH}"></line>`;
      const word = this._dayWord(items[i].start, nowTs) || 'idag';
      svg += `<text class="day" x="${x + (i > 0 ? 4 : 0)}" y="${top - 5}">${word.charAt(0).toUpperCase() + word.slice(1)}</text>`;
    });

    if (this._config.show_thresholds) {
      [d.cheapMax, d.normalMax].forEach((v) => {
        if (v > lo && v < hi) svg += `<line class="thr" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"></line>`;
      });
    }

    svg += `<rect class="hover" x="0" y="${top}" width="${slot}" height="${plotH}" visibility="hidden"></rect>`;
    items.forEach((it, i) => {
      const past = it.end <= nowTs;
      const x = left + i * slot + gap / 2;
      svg += `<path d="${barPath(x, base, y(it.price), bw, r)}" fill="${this._color(it.level)}"${past ? ' class="past"' : ''}></path>`;
    });
    if (lo < 0) svg += `<line class="zero" x1="${left}" x2="${left + plotW}" y1="${base}" y2="${base}"></line>`;

    // nu-markör
    const first = items[0].start;
    const last = items[items.length - 1].end;
    if (nowTs >= first && nowTs < last) {
      const idx = items.findIndex((it) => it.start <= nowTs && nowTs < it.end);
      const nx = left + (idx + (nowTs - items[idx].start) / (items[idx].end - items[idx].start)) * slot;
      svg += `<line class="now" x1="${nx}" x2="${nx}" y1="${top - 2}" y2="${top + plotH}"></line>`;
      svg += `<circle class="nowdot" cx="${nx}" cy="${top - 2}" r="3"></circle>`;
    }

    svg += this._xAxis(items, left, slot, top + plotH + 13, nowTs);
    const h = top + plotH + bottom;
    this._chartEl.innerHTML = `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${svg}</svg>`;
    this._geo = { left, slot, n: items.length, top, plotH };
    this._footEl.innerHTML = '';
  }

  _renderStrip(d, nowTs, width) {
    const items = d.items;
    const top = 6;
    const sh = 22;
    const left = 0;
    const plotW = width;
    const slot = plotW / items.length;
    const bounds = new Set(this._dayBounds(items));
    let svg = `<defs><clipPath id="clip"><rect x="0" y="${top}" width="${plotW}" height="${sh}" rx="6"></rect></clipPath></defs><g clip-path="url(#clip)">`;
    // slå ihop följande poster med samma nivå till en rektangel (inga sömmar)
    let runStart = 0;
    items.forEach((it, i) => {
      const nxt = items[i + 1];
      const past = it.end <= nowTs;
      const key = (x) => (x.end <= nowTs ? -1 : x.level);
      if (nxt && key(nxt) === key(it) && !bounds.has(i + 1)) return;
      const pad = bounds.has(runStart) ? 2 : 0;
      const x = left + runStart * slot + pad;
      svg += `<rect x="${x}" y="${top}" width="${(i + 1 - runStart) * slot - pad}" height="${sh}" fill="${this._color(it.level)}"${past ? ' class="past"' : ''}></rect>`;
      runStart = i + 1;
    });
    svg += `</g><rect class="hover" x="0" y="${top}" width="${slot}" height="${sh}" visibility="hidden"></rect>`;
    const first = items[0].start;
    const last = items[items.length - 1].end;
    if (nowTs >= first && nowTs < last) {
      const nx = left + ((nowTs - first) / (last - first)) * plotW;
      svg += `<line class="now strong" x1="${nx}" x2="${nx}" y1="${top - 4}" y2="${top + sh + 4}"></line>`;
      svg += `<path class="nowtri" d="M${nx - 4},${top + sh + 9}L${nx + 4},${top + sh + 9}L${nx},${top + sh + 4}Z"></path>`;
    }
    svg += this._xAxis(items, left, slot, top + sh + 20, nowTs);
    const h = top + sh + 24;
    this._chartEl.innerHTML = `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${svg}</svg>`;
    this._geo = { left, slot, n: items.length, top, plotH: sh };

    const minP = d.pts.reduce((m, p) => (p.price < m.price ? p : m));
    const maxP = d.pts.reduce((m, p) => (p.price > m.price ? p : m));
    const avg = d.pts.reduce((t, p) => t + p.price, 0) / d.pts.length;
    const when = (p) => {
      const day = this._dayWord(p.start, nowTs);
      return `${this._time(p.start)}${day ? ' ' + day : ''}`;
    };
    this._footEl.innerHTML = `
      <span>Snitt <b>${this._fmt(avg)}</b></span>
      <span>Min <b>${this._fmt(minP.price)}</b> ${when(minP)}</span>
      <span>Max <b>${this._fmt(maxP.price)}</b> ${when(maxP)}</span>`;
  }

  // ---------- tooltip ----------

  _hover(e) {
    const g = this._geo;
    const d = this._d;
    if (!g || !d) return;
    const rect = this._chartEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor((x - g.left) / g.slot);
    if (i < 0 || i >= g.n) return this._hideTip();
    const it = d.items[i];
    const hov = this._chartEl.querySelector('.hover');
    if (hov) {
      hov.setAttribute('x', g.left + i * g.slot);
      hov.setAttribute('visibility', 'visible');
    }
    const day = this._dayWord(it.start, Date.now() / 1000);
    let html = `<div class="t-when">${day ? day.charAt(0).toUpperCase() + day.slice(1) + ' ' : ''}${this._time(it.start)}–${this._time(it.end)}</div>
      <div class="t-price"><span class="dot" style="background:${this._color(it.level)}"></span><b>${this._fmt(it.price, Math.max(this._config.decimals, this._config.ore ? 1 : 3))}</b> ${this._unit()} · ${LEVELS[it.level].name}${it.subs ? ' <span class="muted">(snitt)</span>' : ''}</div>`;
    if (it.subs) {
      html += '<div class="t-subs">' + it.subs.map((s) =>
        `<span><span class="dot" style="background:${this._color(s.level)}"></span>${this._time(s.start).slice(3)}<b>${this._fmt(s.price)}</b></span>`).join('') + '</div>';
    }
    const tip = this._tipEl;
    tip.innerHTML = html;
    tip.hidden = false;
    const cardRect = this.shadowRoot.querySelector('ha-card').getBoundingClientRect();
    const tw = tip.offsetWidth;
    const cx = rect.left - cardRect.left + g.left + (i + 0.5) * g.slot;
    tip.style.left = `${Math.max(4, Math.min(cardRect.width - tw - 4, cx - tw / 2))}px`;
    tip.style.top = `${rect.top - cardRect.top - tip.offsetHeight + 4}px`;
  }

  _hideTip() {
    if (this._tipEl) this._tipEl.hidden = true;
    const hov = this._chartEl?.querySelector('.hover');
    if (hov) hov.setAttribute('visibility', 'hidden');
  }
}

const STYLE = `
  :host { display: block; }
  ha-card {
    display: block;
    position: relative;
    padding: 12px 14px 10px;
    overflow: visible;
    color: var(--primary-text-color);
  }
  .head { display: flex; align-items: flex-start; gap: 8px; }
  .now { flex: 1; min-width: 0; }
  .title { font-size: 0.8rem; color: var(--secondary-text-color); margin-bottom: 2px; letter-spacing: .02em; }
  .row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .price { font-size: 1.75rem; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .unit { font-size: 0.85rem; color: var(--secondary-text-color); margin-right: 4px; }
  .chip {
    align-self: center;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 8px; border-radius: 999px;
    font-size: 0.8rem; font-weight: 600;
    background: color-mix(in srgb, var(--c) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; flex: none; }
  .chip .dot { margin-right: 0; }
  .toggle {
    border: 0; background: none; padding: 4px; margin: -2px -4px 0 0; cursor: pointer; border-radius: 8px;
    color: var(--secondary-text-color); line-height: 0;
  }
  .toggle:hover { background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .toggle svg { width: 20px; height: 20px; fill: currentColor; }
  .summary, .foot {
    display: flex; flex-wrap: wrap; gap: 2px 14px;
    font-size: 0.8rem; color: var(--secondary-text-color); margin-top: 4px;
  }
  .summary b, .foot b { color: var(--primary-text-color); font-weight: 600; font-variant-numeric: tabular-nums; }
  .summary:empty, .foot:empty { display: none; }
  .chart { position: relative; margin-top: 8px; touch-action: pan-y; user-select: none; }
  .is-strip .chart { margin-top: 6px; }
  svg { display: block; overflow: visible; }
  .axis, .day { font-size: 10px; fill: var(--secondary-text-color); font-family: inherit; }
  .day { font-weight: 600; }
  .grid { stroke: var(--divider-color, rgba(127,127,127,.25)); stroke-width: 1; stroke-dasharray: 2 3; }
  .zero { stroke: var(--secondary-text-color); stroke-width: 1; opacity: .5; }
  .daysep { stroke: var(--secondary-text-color); stroke-width: 1; opacity: .35; }
  .thr { stroke: var(--secondary-text-color); stroke-width: 1; stroke-dasharray: 4 3; opacity: .6; }
  .past { fill: var(--secondary-text-color); opacity: .3; }
  .now { stroke: var(--primary-text-color); stroke-width: 1.5; opacity: .75; }
  .nowdot, .nowtri { fill: var(--primary-text-color); }
  .hover { fill: var(--primary-text-color); opacity: .08; pointer-events: none; }
  .tip {
    position: absolute; z-index: 2; pointer-events: none;
    padding: 7px 10px; border-radius: 10px;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, rgba(127,127,127,.3));
    box-shadow: 0 4px 14px rgba(0,0,0,.18);
    font-size: 0.8rem; white-space: nowrap;
  }
  .tip[hidden] { display: none; }
  .t-when { color: var(--secondary-text-color); margin-bottom: 2px; }
  .t-subs { display: flex; gap: 10px; margin-top: 4px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .t-subs b { color: var(--primary-text-color); font-weight: 500; margin-left: 4px; }
  .t-subs .dot { width: 6px; height: 6px; margin-right: 3px; }
  .muted { color: var(--secondary-text-color); font-weight: 400; }
  .warn { color: var(--error-color, #db4437); font-size: 0.9rem; padding: 4px 0; }
`;

if (!customElements.get('nordpool-level-card')) customElements.define('nordpool-level-card', NordpoolLevelCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'nordpool-level-card',
  name: 'Nordpool prisnivå',
  description: 'Kompakt elpriskort med nivåerna Billigt / Normalt / Dyrt',
  preview: true,
});
console.info(`%c NORDPOOL-LEVEL-CARD %c ${VERSION} `, 'background:#13a365;color:#fff', '');
