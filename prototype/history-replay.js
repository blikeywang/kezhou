(function () {
  'use strict';
  const M = window.HistoryReplayModel;
  const snapshots = new Map();
  const preferences = new Map();
  let active = null;
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

  class Viewer {
    constructor(root, options) {
      this.root = root;
      this.options = options;
      this.abort = new AbortController();
      this.charts = [];
      this.timer = null;
      this.destroyed = false;
      this.key = options.symbol + ':' + options.asof;
      this.state = Object.assign({method:'corr', index:0, reveal:0, indexed:false,
        linked:false, volume:true, context:'match', speed:750}, preferences.get(this.key));
      this.zh = options.lang !== 'en';
      this.load();
    }
    t(zh, en) { return this.zh ? zh : en; }
    date(time) {
      const options = {timeZone:this.data.timeZone, year:'numeric', month:'2-digit', day:'2-digit'};
      if (this.data.interval === '4h') Object.assign(options, {hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
      return new Intl.DateTimeFormat(this.zh ? 'zh-CN' : 'en-GB', options).format(new Date(time * 1000));
    }
    fmt(value) {
      return value == null ? '-' : value.toLocaleString('en-US', {maximumFractionDigits: value < 1 ? 5 : 2});
    }
    get selected() { return this.data.cases[this.state.method][this.state.index]; }
    async load() {
      this.reloadRequired = false;
      this.root.innerHTML = '<div class="hr-empty" role="status">' + this.t('正在读取历史 K 线...', 'Loading historical candles...') + '</div>';
      try {
        const input = this.options.snapshot;
        if (!input) throw new Error('No snapshot');
        let data = input;
        if (input.url) {
          if (!/^\.\/replays\/[A-Za-z0-9_-]+\.json$/.test(input.url)) throw new Error('Invalid snapshot URL');
          data = snapshots.get(input.url);
          if (!data) {
            const response = await fetch(input.url, {signal:this.abort.signal, credentials:'omit'});
            if (!response.ok) {
              this.reloadRequired = response.status === 404;
              throw new Error('Snapshot HTTP ' + response.status);
            }
            data = await response.json();
            M.validate(data, this.options.symbol, this.options.asof);
            if (snapshots.size >= 8) snapshots.delete(snapshots.keys().next().value);
            snapshots.set(input.url, data);
          }
        }
        if (this.destroyed) return;
        this.data = M.validate(data, this.options.symbol, this.options.asof);
        if (!window.LightweightCharts) throw new Error('Chart library unavailable');
        this.state.index = Math.min(this.state.index, this.data.cases[this.state.method].length - 1);
        this.state.reveal = M.clampReveal(this.selected, this.state.reveal);
        this.render();
      } catch (error) {
        if (this.destroyed || error.name === 'AbortError') return;
        const label = this.reloadRequired ? this.t('刷新快照','Reload snapshot') : this.t('重试','Retry');
        this.root.innerHTML = '<div class="hr-empty" role="status">' +
          (this.reloadRequired ? this.t('这份历史快照已失效或暂时缺失。', 'This historical snapshot has expired or is missing.') :
            this.t('这份快照的 K 线暂不可用，统计结果仍可查看。', 'Candles are unavailable for this snapshot; statistics remain available.')) +
          '<button class="hr-icon" type="button" title="' + label +
          '" aria-label="' + label + '"><i class="ti ti-refresh" aria-hidden="true"></i></button></div>';
        this.root.querySelector('button').onclick = () => this.reloadRequired ? window.location.reload() : this.load();
      }
    }
    icon(action, name, label) {
      return '<button type="button" class="hr-icon" data-action="' + action + '" title="' + escape(label) +
        '" aria-label="' + escape(label) + '"><i class="ti ti-' + name + '" aria-hidden="true"></i></button>';
    }
    render() {
      const t = this.t.bind(this);
      const pane = (kind, title) => '<div class="hr-pane" data-pane="' + kind + '"><div class="hr-pane-head">' +
        '<div class="hr-pane-title"><b>' + escape(this.data.symbol) + ' · ' + title + '</b><span class="hr-badge ' + kind + '">' +
        t('匹配区间', 'Matched window') + ' · ' + this.data.window + t(' 根', ' bars') + '</span></div>' +
        '<div class="hr-dates"></div></div><div class="hr-ohlc"></div>' +
        '<div class="hr-chart-wrap"><div class="hr-chart"></div><div class="hr-shade"></div></div></div>';
      this.root.innerHTML = '<div class="hr-heading"><h3>' + t('相似历史 · K 线核对', 'Historical analogues · chart comparison') +
        '</h3><small>' + escape(this.data.source + ' · ' + this.data.ticker + ' · ' + this.data.interval + ' · ' + this.data.timeZone) + '</small></div>' +
        '<div class="hr-tools"><div class="hr-segment" role="group" aria-label="' + t('匹配方法', 'Matching method') + '">' +
        '<button type="button" data-method="corr" title="' + t('corr 越大越相似', 'Higher correlation is more similar') + '">' + t('形状相似', 'Correlation') + '</button><button type="button" data-method="dtw" title="' + t('DTW 距离越小越相似', 'Lower DTW distance is more similar') + '">' + t('节奏相似', 'DTW') + '</button></div>' +
        '<label class="hr-case-label"><select class="hr-select" data-control="case" aria-label="' + t('相似历史案例', 'Historical case') + '"></select></label>' +
        this.icon('previous', 'chevron-left', t('上一个案例', 'Previous case')) +
        this.icon('next', 'chevron-right', t('下一个案例', 'Next case')) + '</div>' +
        '<div class="hr-tools"><div class="hr-segment" role="group" aria-label="' + t('价格口径', 'Price scale') + '">' +
        '<button type="button" data-price="actual">' + t('真实价格', 'Price') + '</button><button type="button" data-price="indexed">' + t('起点 = 100', 'Start = 100') + '</button></div>' +
        '<select class="hr-select" data-control="context" aria-label="' + t('行情范围', 'Chart range') + '">' +
        '<option value="match">' + t('匹配区间', 'Matched window') + '</option><option value="context">' + t('前后行情', 'Surrounding context') + '</option></select>' +
        this.icon('link', 'link', t('两图按匹配位置联动', 'Link charts by matched bar position')) +
        this.icon('volume', 'chart-bar', t('成交量', 'Volume')) +
        this.icon('reset', 'focus-centered', t('重置视野', 'Reset view')) +
        this.icon('fullscreen', 'arrows-maximize', t('全屏', 'Fullscreen')) + '</div>' +
        '<div class="hr-chart-grid">' + pane('current', t('当前窗口', 'Current window')) + pane('history', t('历史案例', 'Historical case')) + '</div>' +
        '<div class="hr-playback"><span class="hr-playback-label">' + t('历史后续走势', 'Historical continuation') + '</span>' +
        this.icon('rewind', 'player-skip-back', t('回到匹配终点', 'Back to match end')) +
        this.icon('back', 'player-track-prev', t('退一根', 'Previous bar')) +
        this.icon('play', 'player-play', t('播放后续', 'Play continuation')) +
        this.icon('step', 'player-track-next', t('前进一根', 'Next bar')) +
        '<input class="hr-timeline" data-control="timeline" type="range" min="0" step="1" aria-label="' + t('后续 K 线根数', 'Revealed future bars') + '">' +
        '<output class="hr-progress"></output>' +
        '<select class="hr-select" data-control="speed" aria-label="' + t('播放速度', 'Playback speed') + '"><option value="1500">0.5x</option><option value="750">1x</option><option value="250">3x</option></select>' +
        this.icon('all', 'eye', t('展开全部后续', 'Reveal all continuation')) + '</div>' +
        '<div class="hr-status"><span class="hr-coverage"></span><span class="hr-result" aria-live="polite"></span></div>' +
        '<div class="hr-warning" role="status"></div><div class="hr-footer"><span>' +
        t('浅色区：参与匹配 · 金色边界：匹配终点 · 历史相似不代表未来', 'Shaded: matched window · Gold edge: match end · Similarity is not a forecast') +
        '</span><span><a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a> · <a href="./vendor/lightweight-charts/NOTICE" target="_blank" rel="noopener">Copyright (с) 2025 TradingView, Inc.</a></span></div>';
      this.onClick = event => {
        const button = event.target.closest('button');
        if (!button || !this.root.contains(button)) return;
        if (button.dataset.method) this.selectCase(button.dataset.method, 0);
        else if (button.dataset.price) {
          this.state.indexed = button.dataset.price === 'indexed';
          this.stop(); this.drawCharts(); this.updateControls();
        } else this.action(button.dataset.action);
      };
      this.root.addEventListener('click', this.onClick, {signal:this.abort.signal});
      this.root.addEventListener('change', event => {
        const control = event.target.dataset.control;
        if (control === 'case') this.selectCase(this.state.method, Number(event.target.value));
        if (control === 'context') {this.state.context = event.target.value; this.fit();}
        if (control === 'speed') {
          const playing = !!this.timer; this.stop(); this.state.speed = Number(event.target.value);
          if (playing) this.play();
        }
      }, {signal:this.abort.signal});
      this.root.querySelector('[data-control=timeline]').addEventListener('input', event => {
        this.stop(); this.reveal(Number(event.target.value));
      }, {signal:this.abort.signal});
      document.addEventListener('visibilitychange', () => {if (document.hidden) this.stop();}, {signal:this.abort.signal});
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.fullscreenElement === this.root) {
          document.exitFullscreen().catch(() => {});
        }
      }, {signal:this.abort.signal});
      document.addEventListener('fullscreenchange', () => {
        const full = document.fullscreenElement === this.root;
        const button = this.root.querySelector('[data-action=fullscreen]');
        button.setAttribute('aria-pressed', full);
        button.title = full ? this.t('退出全屏','Exit fullscreen') : this.t('全屏','Fullscreen');
        button.setAttribute('aria-label', button.title);
        button.querySelector('i').className = 'ti ti-arrows-' + (full ? 'minimize' : 'maximize');
      }, {signal:this.abort.signal});
      this.drawCharts();
      this.updateControls();
    }
    selectCase(method, index) {
      if (!['corr','dtw'].includes(method)) return;
      this.stop();
      this.state.method = method;
      this.state.index = this.data ? Math.max(0, Math.min(index, this.data.cases[method].length - 1)) : index;
      this.state.reveal = 0;
      if (this.data) {this.drawCharts(); this.updateControls();}
    }
    drawCharts() {
      this.removeCharts();
      const L = window.LightweightCharts;
      const styles = getComputedStyle(this.root);
      const color = key => styles.getPropertyValue(key).trim();
      this.charts = [this.data.current, this.selected].map((segment, index) => {
        const pane = this.root.querySelectorAll('.hr-pane')[index];
        pane.querySelector('.hr-dates').textContent = this.date(segment.startTime) + ' → ' + this.date(segment.endTime);
        const seriesData = M.seriesData(segment, index ? this.state.reveal : 0, this.state.indexed);
        const chart = L.createChart(pane.querySelector('.hr-chart'), {
          autoSize:true, layout:{background:{type:'solid',color:color('--pan2')},textColor:color('--ink2'),fontSize:10,attributionLogo:true},
          grid:{vertLines:{color:color('--line')},horzLines:{color:color('--line')}},
          crosshair:{mode:L.CrosshairMode.Normal},
          rightPriceScale:{borderColor:color('--line2'),minimumWidth:58},
          timeScale:{borderColor:color('--line2'),timeVisible:this.data.interval === '4h',secondsVisible:false,
            rightOffset:3,shiftVisibleRangeOnNewBar:false,lockVisibleTimeRangeOnResize:true,tickMarkMaxCharacterLength:7,
            tickMarkFormatter:(time,type) => M.axisLabel(time,
              type === L.TickMarkType.Year ? 'year' : type === L.TickMarkType.Month ? 'month' :
                type >= L.TickMarkType.Time ? 'time' : 'day', this.data.timeZone)},
          localization:{locale:this.zh?'zh-CN':'en-US',timeFormatter:time => this.date(time)},
          handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
          handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
        });
        const base = this.state.indexed ? 100 : segment.bars[segment.start][4];
        const precision = base < 1 ? 5 : base < 20 ? 3 : 2;
        const price = chart.addSeries(seriesData.candles ? L.CandlestickSeries : L.LineSeries, {
          upColor:'#29987b',downColor:'#d15f70',wickUpColor:'#29987b',wickDownColor:'#d15f70',borderVisible:false,
          color:color('--acc'),lineWidth:2,priceLineVisible:false,lastValueVisible:true,
          priceFormat:{type:'price',precision,minMove:10 ** -precision},
        });
        const volume = chart.addSeries(L.HistogramSeries, {priceScaleId:'volume',priceFormat:{type:'volume'},
          priceLineVisible:false,lastValueVisible:false,visible:this.state.volume});
        price.priceScale().applyOptions({scaleMargins:{top:.12,bottom:this.state.volume ? .22 : .08}});
        volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
        price.setData(seriesData.price);
        volume.setData(seriesData.volume);
        const markers = L.createSeriesMarkers(price, [
          {time:segment.startTime,position:'aboveBar',color:color('--acc'),shape:'circle',text:this.t('起点','Start')},
          {time:segment.endTime,position:'aboveBar',color:color('--gold'),shape:'circle',text:this.t('终点','End')},
        ]);
        const item = {chart,price,volume,markers,segment,pane,index};
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          this.shade(item);
          if (!range || !this.state.linked || this.syncing) return;
          const other = this.charts[1 - index];
          if (!other) return;
          const target = M.linkedRange(range, segment, other.segment);
          const existing = other.chart.timeScale().getVisibleLogicalRange();
          if (existing && Math.abs(target.from-existing.from)<.001 && Math.abs(target.to-existing.to)<.001) return;
          this.syncing = true; other.chart.timeScale().setVisibleLogicalRange(target); this.syncing = false;
        });
        chart.subscribeCrosshairMove(param => {
          const rowIndex = param.time == null ? -1 : segment.bars.findIndex(row => row[0] === param.time);
          this.legend(item, rowIndex < 0 ? segment.end + (index ? this.state.reveal : 0) : rowIndex);
          if (!this.state.linked || this.crossSync) return;
          const other = this.charts[1 - index];
          if (!other) return;
          this.crossSync = true;
          const target = rowIndex - segment.start + other.segment.start;
          const last = other.segment.end + (other.index ? this.state.reveal : 0);
          if (rowIndex < 0 || target < 0 || target > last) other.chart.clearCrosshairPosition();
          else {
            const row = other.segment.bars[target];
            const value = row[4] * (this.state.indexed ? 100/other.segment.bars[other.segment.start][4] : 1);
            other.chart.setCrosshairPosition(value, row[0], other.price);
            this.legend(other, target);
          }
          this.crossSync = false;
        });
        item.observer = new ResizeObserver(() => requestAnimationFrame(() => {if (!this.destroyed && this.charts.includes(item)) this.shade(item);}));
        item.observer.observe(pane.querySelector('.hr-chart'));
        this.legend(item, segment.end + (index ? this.state.reveal : 0));
        return item;
      });
      this.fit();
    }
    legend(item, index) {
      const row = item.segment.bars[index];
      if (!row) return;
      const factor = this.state.indexed ? 100 / item.segment.bars[item.segment.start][4] : 1;
      item.pane.querySelector('.hr-ohlc').textContent = this.date(row[0]) + '  ' +
        ['O','H','L','C'].map((key, i) => key + ' ' + this.fmt(row[i+1] == null ? null : row[i+1]*factor)).join('  ') +
        (row[5] == null ? '' : '  V ' + this.fmt(row[5]));
    }
    shade(item) {
      const scale = item.chart.timeScale();
      const bounds = M.bandCoordinates(scale, item.segment);
      const shade = item.pane.querySelector('.hr-shade');
      if (!bounds) {shade.style.display='none'; return;}
      const {left, right} = bounds;
      const width = scale.width();
      shade.style.display = right < 0 || left > width ? 'none' : 'block';
      shade.style.left = Math.max(0,left) + 'px';
      shade.style.width = Math.max(0,Math.min(width,right)-Math.max(0,left)) + 'px';
      shade.style.borderLeftWidth = left < 0 ? '0' : '1px';
      shade.style.borderRightWidth = right > width ? '0' : '1px';
    }
    fit() {
      this.syncing = true;
      this.charts.forEach(item => {
        const range = M.viewRange(item.segment, item.index ? this.state.reveal : 0, this.state.context);
        if (item.index && this.state.reveal) range.to = item.segment.end + this.state.reveal + 4;
        item.chart.timeScale().setVisibleLogicalRange(range);
        this.shade(item);
      });
      this.syncing = false;
    }
    reveal(count) {
      this.state.reveal = M.clampReveal(this.selected, count);
      const item = this.charts[1];
      const range = item.chart.timeScale().getVisibleLogicalRange();
      const data = M.seriesData(this.selected, this.state.reveal, this.state.indexed);
      this.syncing = true;
      item.price.setData(data.price); item.volume.setData(data.volume);
      if (range) {
        const last = this.selected.end + this.state.reveal;
        item.chart.timeScale().setVisibleLogicalRange({from:range.from, to:Math.max(this.selected.end+4,last+4)});
      }
      this.syncing = false;
      this.legend(item, this.selected.end + this.state.reveal);
      this.shade(item);
      if (this.state.reveal === M.futureCount(this.selected)) this.stop();
      this.updateControls();
    }
    updateControls() {
      if (!this.data) return;
      const query = selector => this.root.querySelector(selector);
      const count = M.futureCount(this.selected);
      this.root.querySelectorAll('[data-method]').forEach(b => b.setAttribute('aria-pressed', b.dataset.method === this.state.method));
      this.root.querySelectorAll('[data-price]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.price === 'indexed') === this.state.indexed));
      const select = query('[data-control=case]');
      if (select.dataset.method !== this.state.method) {
        select.innerHTML = this.data.cases[this.state.method].map((s, i) =>
          '<option value="' + i + '">#' + (i+1) + ' · ' +
          escape(this.date(s.endTime)) + ' · ' + (this.state.method === 'corr' ? 'corr ' + s.score.toFixed(3) : 'DTW ' + s.score.toFixed(2)) + '</option>').join('');
        select.dataset.method = this.state.method;
      }
      select.value = String(this.state.index);
      query('[data-control=context]').value = this.state.context;
      query('[data-control=speed]').value = String(this.state.speed);
      query('[data-action=previous]').disabled = this.state.index === 0;
      query('[data-action=next]').disabled = this.state.index === this.data.cases[this.state.method].length - 1;
      query('[data-action=link]').setAttribute('aria-pressed', this.state.linked);
      query('[data-action=volume]').setAttribute('aria-pressed', this.state.volume);
      ['rewind','back'].forEach(a => query('[data-action='+a+']').disabled = this.state.reveal === 0);
      ['step','play','all'].forEach(a => query('[data-action='+a+']').disabled = this.state.reveal === count);
      query('[data-control=timeline]').max = count;
      query('[data-control=timeline]').value = this.state.reveal;
      query('.hr-progress').textContent = '+' + this.state.reveal + ' / ' + count + this.t(' 根',' bars');
      query('.hr-coverage').textContent = this.t('案例覆盖：','Case coverage: ') + this.date(this.selected.bars[0][0]) + ' → ' +
        this.date(this.selected.bars[this.selected.bars.length-1][0]);
      const ret = M.forwardReturn(this.selected, this.state.reveal);
      query('.hr-result').textContent = ret == null ? this.t('后续尚未展开','Continuation hidden') :
        this.t('距匹配终点 ','Since match end ') + (ret>=0?'+':'') + (ret*100).toFixed(2) + '% · ' +
        this.date(this.selected.bars[this.selected.end+this.state.reveal][0]);
      query('.hr-result').className = 'hr-result' + (ret == null ? '' : ret >= 0 ? ' up' : ' dn');
      const warnings = [];
      if ([this.data.current, this.selected].some(s => !s.bars.every(M.candleValid))) warnings.push(this.t(
        '部分 OHLC 不完整或结算价超出高低区间，相关图表以真实收盘线显示，未补造 K 线。',
        'Incomplete or inconsistent OHLC: affected charts use the original close line; no candles are fabricated.'));
      if (this.data.priceBasis === 'adjusted') warnings.push(this.t('价格按数据源复权口径。','Prices use source-adjusted OHLC.'));
      if (this.options.stale) warnings.push(this.t('缓存快照，非实时行情。','Cached snapshot, not live prices.'));
      query('.hr-warning').textContent = warnings.join(' ');
      const label = this.timer ? this.t('暂停','Pause') : this.t('播放后续','Play continuation');
      query('[data-action=play]').title = label; query('[data-action=play]').setAttribute('aria-label',label);
      query('[data-action=play] i').className = 'ti ti-player-' + (this.timer ? 'pause' : 'play');
      preferences.set(this.key, Object.assign({}, this.state));
    }
    action(action) {
      if (action === 'previous') this.selectCase(this.state.method, this.state.index-1);
      if (action === 'next') this.selectCase(this.state.method, this.state.index+1);
      if (['rewind','back','step','all'].includes(action)) {
        this.stop(); this.reveal(action === 'rewind' ? 0 : action === 'all' ? M.futureCount(this.selected) :
          this.state.reveal + (action === 'step' ? 1 : -1));
      }
      if (action === 'play') this.timer ? this.stop() : this.play();
      if (action === 'link') {this.state.linked = !this.state.linked; this.updateControls();}
      if (action === 'volume') {
        this.state.volume = !this.state.volume;
        this.charts.forEach(item => {
          item.volume.applyOptions({visible:this.state.volume});
          item.price.priceScale().applyOptions({scaleMargins:{top:.12,bottom:this.state.volume ? .22 : .08}});
        });
        this.updateControls();
      }
      if (action === 'reset') this.fit();
      if (action === 'fullscreen') {
        const operation = document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen?.();
        if (operation) operation.catch(() => {});
      }
    }
    play() {
      this.stop();
      if (this.state.reveal >= M.futureCount(this.selected)) return;
      this.timer = setInterval(() => this.reveal(this.state.reveal+1), this.state.speed);
      this.updateControls();
    }
    stop() {
      if (this.timer) {clearInterval(this.timer); this.timer=null; this.updateControls();}
    }
    removeCharts() {
      this.charts.forEach(item => {item.observer.disconnect(); item.markers.detach(); item.chart.remove();});
      this.charts = [];
    }
    destroy() {
      this.stop(); this.destroyed = true; this.abort.abort(); this.removeCharts();
    }
  }
  window.HistoryReplay = {
    mount(root, options) {this.destroy(); if (root) active = new Viewer(root, options);},
    destroy() {if (active) active.destroy(); active = null;},
    selectCase(method, index) {if (active) active.selectCase(method, index);},
  };
})();
