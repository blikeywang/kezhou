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
      this.profileKey = options.profiles?.[options.profile] ? options.profile : '';
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
    get cases() { return M.caseList(this.data, this.state.method, this.state.year); }
    get selected() { return this.cases[this.state.index]; }
    profileControls() {
      if (!Object.keys(this.options.profiles || {}).length) return '';
      const profile = this.options.profiles[this.profileKey];
      const interval = profile?.interval, span = profile?.months === 12 ? '1y' : '6m';
      const prefix = profile?.series === 'usd' ? 'usd-' : '';
      const button = (key, label, pressed) => '<button type="button" data-profile="' + key +
        '" aria-pressed="' + pressed + '">' + label + '</button>';
      return '<div class="hr-tools hr-profiles"><div class="hr-segment" role="group" aria-label="' + this.t('K 线周期','Candle interval') + '">' +
        button('', this.t('短窗口','Short window'), !this.profileKey) +
        button(prefix+'1d-'+span, this.t('日线','Daily'), interval === '1d') +
        button(prefix+'1w-'+span, this.t('周线','Weekly'), interval === '1w') + '</div>' +
        '<div class="hr-segment" role="group" aria-label="' + this.t('匹配长度','Matching length') + '">' +
        button(prefix+(interval || '1d')+'-6m', this.t('最近半年','Last 6 months'), span === '6m' && !!interval) +
        button(prefix+(interval || '1d')+'-1y', this.t('最近一年','Last year'), span === '1y' && !!interval) + '</div>' +
        (this.options.profiles['usd-1d-6m'] ? '<select class="hr-select" data-control="source" aria-label="' + this.t('历史数据源','Historical source') + '">' +
          '<option value="primary"' + (!prefix ? ' selected' : '') + '>Binance USDT · ' + this.t('K 线','OHLCV') + '</option>' +
          '<option value="usd"' + (prefix ? ' selected' : '') + '>Coin Metrics USD · ' + this.t('长期收盘线','Long close history') + '</option></select>' : '') + '</div>';
    }
    bindProfiles() {
      this.root.querySelectorAll('[data-profile]').forEach(button => {
        button.onclick = () => {
          if (this.profileKey === button.dataset.profile) return;
          this.profileKey = button.dataset.profile;
          this.load();
        };
      });
      const source = this.root.querySelector('[data-control=source]');
      if (source) source.onchange = () => {
        const p = this.options.profiles[this.profileKey];
        this.profileKey = (source.value === 'usd' ? 'usd-' : '') + (p?.interval || '1d') + '-' + (p?.months === 12 ? '1y' : '6m');
        this.load();
      };
    }
    async load() {
      this.stop(); this.removeCharts(); this.abort.abort();
      const controller = this.abort = new AbortController();
      const input = this.profileKey ? this.options.profiles[this.profileKey] : this.options.snapshot;
      this.descriptor = input;
      const asof = this.profileKey ? input?.asof : this.options.asof;
      this.key = this.options.symbol + ':' + asof + ':' + this.profileKey;
      this.state = Object.assign({method:this.profileKey ? 'year' : 'corr', year:'', index:0, reveal:0,
        indexed:!!this.profileKey, linked:!!this.profileKey, volume:true, context:'match', speed:750}, preferences.get(this.key));
      this.data = null;
      let reloadRequired = false;
      this.options.onProfileChange?.(this.profileKey, null, 'loading');
      this.root.innerHTML = this.profileControls() + '<div class="hr-empty" role="status">' + this.t('正在读取历史行情...', 'Loading historical prices...') + '</div>';
      this.bindProfiles();
      try {
        if (!input || (this.profileKey && !input.url)) throw new Error('No snapshot');
        let data = input;
        if (input.url) {
          if (!/^\.\/(replays|history-profiles)\/[A-Za-z0-9_-]+\.json$/.test(input.url)) throw new Error('Invalid snapshot URL');
          data = snapshots.get(input.url);
          if (!data) {
            const response = await fetch(input.url, {signal:controller.signal, credentials:'omit'});
            if (!response.ok) {
              reloadRequired = response.status === 404;
              throw new Error('Snapshot HTTP ' + response.status);
            }
            data = await response.json();
            M.validate(data, this.options.symbol, asof, input);
            if (snapshots.size >= 8) snapshots.delete(snapshots.keys().next().value);
            snapshots.set(input.url, data);
          }
        }
        if (this.destroyed || controller !== this.abort) return;
        this.data = M.validate(data, this.options.symbol, asof, input);
        if (this.data.dataKind === 'close-only') this.state.volume = false;
        if (!window.LightweightCharts) throw new Error('Chart library unavailable');
        const years = Object.keys(this.data.annualCases || {});
        if (!years.includes(this.state.year)) this.state.year = String(this.data.verdict?.leader || (years.includes('2018') ? '2018' : years.at(-1) || ''));
        if (this.state.method === 'year' && !years.length) this.state.method = 'corr';
        if (this.state.method !== 'year' && !this.data.cases[this.state.method]) this.state.method = 'corr';
        this.state.index = Math.min(this.state.index, this.cases.length - 1);
        this.state.reveal = M.clampReveal(this.selected, this.state.reveal);
        this.render();
        this.options.onProfileChange?.(this.profileKey, this.data, this.profileKey ? M.profileStatus(input) : 'fresh');
      } catch (error) {
        if (this.destroyed || controller !== this.abort || error.name === 'AbortError') return;
        this.removeCharts(); this.data = null;
        this.options.onProfileChange?.(this.profileKey, null, 'unavailable');
        const label = reloadRequired ? this.t('刷新快照','Reload snapshot') : this.t('重试','Retry');
        this.root.innerHTML = this.profileControls() + '<div class="hr-empty" role="status">' +
          (reloadRequired ? this.t('这份历史快照已失效或暂时缺失。', 'This historical snapshot has expired or is missing.') :
            this.t('这个窗口的历史数据暂不可用，可切换其他周期。', 'History for this window is unavailable. Other intervals remain accessible.')) +
          '<button class="hr-icon" type="button" title="' + label +
          '" aria-label="' + label + '"><i class="ti ti-refresh" aria-hidden="true"></i></button></div>';
        this.bindProfiles();
        this.root.querySelector('.hr-empty button').onclick = () => reloadRequired ? window.location.reload() : this.load();
      }
    }
    comparisonHTML() {
      if (!this.data.comparison) return '';
      const t = this.t.bind(this), v = this.data.verdict;
      const verdict = v.reason === 'higher' ? t('形状分数较高：','Higher shape score: ') + v.leader :
        v.reason === 'close' ? t('两年分数接近','Similar scores in both years') :
        v.reason === 'weak' ? t('两年的形状相似度均偏弱','Both years have weak shape similarity') : t('历史不足，暂不判断','Insufficient history to compare');
      const pct = n => (n >= 0 ? '+' : '') + (n*100).toFixed(1) + '%';
      return '<section class="hr-comparison" aria-label="2018 / 2023"><div class="hr-cycle-heading"><h4>2018 / 2023</h4><b>' + verdict + '</b></div>' +
        '<div class="hr-years">' + this.data.comparison.map(row => '<div class="hr-year"><div class="hr-year-title"><h4>' + row.year +
          '</h4><strong>' + (row.available ? row.score.toFixed(3) : '-') + '</strong>' + (row.available ?
            '<button type="button" class="hr-icon" data-year="' + row.year + '" title="' + t('打开','Open') + ' ' + row.year +
            t(' 年走势',' history') + '" aria-label="' + t('打开','Open') + ' ' + row.year + t(' 年走势',' history') + '"><i class="ti ti-chart-candle" aria-hidden="true"></i></button>' : '') + '</div>' +
          (row.available ? '<p>' + row.start + ' → ' + row.end + '</p><dl><div><dt>' + t('区间涨跌','Window return') + '</dt><dd>' + pct(row.return) +
            '</dd></div><div><dt>' + t('收盘最大回撤','Close drawdown') + '</dt><dd>' + pct(row.drawdown) + '</dd></div></dl><p class="hr-year-coverage">' +
            row.candidates + t(' 个可匹配终点 · ',' eligible endpoints · ') + row.eligibleStart + ' → ' + row.eligibleEnd + '</p>' :
            '<p>' + t('没有满足完整窗口与后续行情的样本','No complete window with forward history') + '</p>') + '</div>').join('') + '</div>' +
        '<p class="hr-cycle-note">' + t('同一标的、同一长度，按匹配终点年份归类；分数是对数收盘价形状相关性，不是上涨概率，也不代表涨跌幅、成交量或宏观条件相同。两年可用样本数可能不同，最高分不等于整轮牛熊周期相同。',
          'Same instrument and length; year refers to the match endpoint. Log-close correlation is not an up probability or evidence of equal returns, volume or macro conditions. Unequal coverage and best-case selection do not establish the same market cycle.') + '</p></section>';
    }
    summaryHTML() {
      if (!this.data.summary) return '';
      const t = this.t.bind(this), unit = this.data.interval === '1w' ? t('周','weeks') : this.data.group === 'crypto' ? t('天','days') : t('交易日','sessions');
      const pct = n => n == null ? '-' : (n*100).toFixed(1) + '%';
      return '<details class="hr-statistics"><summary>' + t('该窗口的历史后续统计','Forward statistics for this window') + '</summary><div class="tw"><table class="t"><thead><tr>' +
        [t('后续','Forward'),t('案例数','Cases'),t('上涨占比','Up rate'),t('收益中位数','Median return'),t('中间 50%','Middle 50%'),t('全样本上涨占比','Baseline up rate')].map(s => '<th>'+s+'</th>').join('') +
        '</tr></thead><tbody>' + this.data.summary.map(row => '<tr><td>+' + row.bars + ' ' + unit + '</td><td>' + row.n + '</td><td>' + pct(row.upRate) +
          '</td><td>' + pct(row.median) + '</td><td>' + pct(row.p25) + ' … ' + pct(row.p75) + '</td><td>' + pct(row.baseUpRate) + '</td></tr>').join('') +
        '</tbody></table></div><p class="hr-cycle-note">' + t('从完整历史选取 corr ≥ 0.50 的最多 20 个互不重叠匹配区间，不只限于当前查看年份；0.50 是筛选门槛，不是统计显著性。后续观察区间仍可能互相重叠，样本并非统计独立；所有后续数据均早于当前窗口。小样本比例不构成预测或回测收益。',
          'Up to 20 non-overlapping windows with corr ≥ 0.50 across the full history, not just the selected year. This threshold is not statistical significance. Forward horizons can overlap; samples are not independent. All outcomes predate the current window. Small-sample rates are not forecasts or strategy returns.') + '</p></details>';
    }
    coverageHTML() {
      const c = this.data.coverage || this.options.coverage;
      if (!c) return '';
      const t = this.t.bind(this), ref = c.lifecycle, cont = c.continuity;
      const labels = {
        'network-not-price':t('网络诞生不等于价格历史起点','Network genesis is not a price-history start'),
        'missing-early':t('尚缺早期历史','Early history missing'),
        'start-reached':t('已到核对起点，完整性未认证','Reference start reached; completeness not certified'),
        'before-reference':t('含更早记录，证券沿革需区分','Earlier records require security-lineage distinctions'),
        'unverified':t('上市／诞生起点尚未独立核实','Listing / inception start not independently verified'),
      };
      const kinds = {network:t('网络诞生','Network genesis'),ipo:t('IPO','IPO'),adr:t('美国 ADR 上市','US ADR listing'),
        'operating-ticker':t('现经营主体交易起点','Operating-company ticker start'),product:t('产品首个交易日','Product first trade')};
      const link = (url, label) => typeof url === 'string' && /^https:\/\//.test(url) ?
        '<a href="'+escape(url)+'" target="_blank" rel="noopener">'+escape(label)+'</a>' : escape(label);
      const gap = cont.missingCount == null ? t('未核对该产品的交易日历','Product trading calendar not audited') :
        cont.missingCount ? cont.missingCount+t(' 个疑似缺失时段，待核对停牌／交易所日历',' suspected missing intervals; check halts / exchange calendar') :
        t('区间内日历初筛未发现缺失时段','No missing intervals in the audited range');
      let note = ref?.note === 'spac-predecessor' ? t('早期记录属于 SPAC 前身，不代表现经营公司的历史经营表现。','Earlier prices belong to the SPAC predecessor, not the current operating company.') :
        ref?.note === 'us-listing-only' ? t('仅核对美国 ADR，不等同于台湾本股上市历史。','US ADR only; not the Taiwan-listed ordinary-share history.') :
        ref?.note === 'otc-before-nyse' ? t('IPO 先于 NYSE 上市，不能把 1979 年上市转板日当作最早发行日。','The OTC IPO predates the 1979 NYSE listing.') : '';
      if (c.dataKind === 'close-only') note += ' '+t('仅有 USD 参考收盘价，没有开高低或成交量；与 Binance USDT 独立匹配，不拼接。','USD reference closes only, without O/H/L or volume; matched independently, never spliced into Binance USDT.');
      const row = (name, value) => '<div><dt>'+name+'</dt><dd>'+value+'</dd></div>';
      return '<details class="hr-data-audit"><summary>'+t('历史覆盖','History coverage')+' · '+escape(c.first)+' → '+escape(c.last)+'<span>'+escape(labels[c.startStatus] || labels.unverified)+'</span></summary><dl>' +
        row(t('数据源／范围','Source / range'),link(c.sourceUrl,c.source || this.data.source)+' · '+escape(c.ticker)+' · '+escape(c.interval)+' · '+c.bars+t(' 条',' observations')) +
        row(t('已核对的起点','Verified reference start'),ref ? kinds[ref.kind]+' · '+link(ref.sourceUrl,ref.date) : t('未核实，不能用数据源首条价格代替上市日期','Unverified; first available price is not proof of listing date')) +
        (c.providerFirstDate ? row(t('上游首日字段','Provider first-date field'),escape(c.providerFirstDate)+t('（非独立上市证明）',' (not independent listing evidence)')) : '') +
        row(t('连续性初筛','Continuity screen'),escape(gap)) +
        row(t('初筛范围','Audited range'),escape(cont.from+' → '+cont.to)+' · '+escape(cont.calendar || '-')+
          (cont.uncheckedEarlierBars ? t(' · 更早未核对 ',' · Earlier unaudited: ')+cont.uncheckedEarlierBars+t(' 条',' bars') : '')) +
        (cont.unexpectedCount ? row(t('非预期交易日','Unexpected sessions'),cont.unexpectedCount+t(' 条，需复核日历／时间戳','; calendar / timestamps need review')) : '') +
        (cont.missingExamples?.length ? row(t('疑似缺口示例','Gap examples'),cont.missingExamples.map(escape).join(' · ')) : '') +
        (c.dataKind !== 'close-only' ? row(t('不完整／不一致 OHLC','Incomplete / inconsistent OHLC'),c.invalidCandles+t(' 条，保留原价，不补造 K 线',' bars; original closes preserved, no fabricated candles')) : '') +
        row(t('核对时间','Audit time'),escape(c.checkedAt)+(c.refreshStatus === 'cached' ? t(' · 缓存核对',' · cached audit') : '')) +
        '</dl><p>'+escape(note)+'</p><p>'+t('日期已覆盖、行情已更新，都不代表全历史完整；尚未完成跨数据源逐日验证。','A covered start date or fresh quote does not certify lifetime completeness; independent day-by-day source verification is not complete.')+'</p></details>';
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
      this.root.innerHTML = this.profileControls() + '<div class="hr-heading"><h3>' + (this.data.dataKind === 'close-only' ?
        t('相似历史 · 收盘线核对','Historical analogues · close comparison') : t('相似历史 · K 线核对', 'Historical analogues · chart comparison')) +
        '</h3><small>' + escape(this.data.source + ' · ' + this.data.ticker + ' · ' + this.data.interval + ' · ' + this.data.timeZone) + '</small></div>' +
        (this.profileKey ? '<p class="hr-profile-meta">' + this.data.window + t(' 个已完成观察值 · 收盘覆盖至 ',' completed observations · Closed through ') + escape(this.data.asofDay) +
          t(' · 历史起点 ',' · History starts ') + escape(this.data.historyStart) + '</p>' : '') + this.coverageHTML() + this.comparisonHTML() +
        '<div class="hr-tools"><div class="hr-segment" role="group" aria-label="' + t('匹配方法', 'Matching method') + '">' +
        '<button type="button" data-method="corr" title="' + t('corr 越大越相似', 'Higher correlation is more similar') + '">' + t('形状相似', 'Correlation') + '</button>' +
        (this.data.cases.dtw ? '<button type="button" data-method="dtw" title="' + t('DTW 距离越小越相似', 'Lower DTW distance is more similar') + '">' + t('节奏相似', 'DTW') + '</button>' : '') +
        (Object.keys(this.data.annualCases || {}).length ? '<button type="button" data-method="year" title="' +
          t('各年份内的形状相似案例', 'Correlation cases within each year') + '">' + t('按年核对', 'By year') + '</button>' : '') + '</div>' +
        (Object.keys(this.data.annualCases || {}).length ? '<select class="hr-select" data-control="year" aria-label="' + t('历史年份', 'Historical year') + '" hidden>' +
          Object.keys(this.data.annualCases).sort().reverse().map(year => '<option value="' + year + '">' + year + '</option>').join('') + '</select>' : '') +
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
        '<div class="hr-scope" role="status"></div>' +
        '<div class="hr-chart-grid">' + pane('current', t('当前窗口', 'Current window')) + pane('history', t('历史案例', 'Historical case')) + '</div>' +
        '<div class="hr-playback"><span class="hr-playback-label">' + t('历史后续走势', 'Historical continuation') + '</span>' +
        this.icon('rewind', 'player-skip-back', t('回到匹配终点', 'Back to match end')) +
        this.icon('back', 'player-track-prev', t('退一根', 'Previous bar')) +
        this.icon('play', 'player-play', t('播放后续', 'Play continuation')) +
        this.icon('step', 'player-track-next', t('前进一根', 'Next bar')) +
        '<input class="hr-timeline" data-control="timeline" type="range" min="0" step="1" aria-label="' + t('后续观察值数量', 'Revealed future observations') + '">' +
        '<output class="hr-progress"></output>' +
        '<select class="hr-select" data-control="speed" aria-label="' + t('播放速度', 'Playback speed') + '"><option value="1500">0.5x</option><option value="750">1x</option><option value="250">3x</option></select>' +
        this.icon('all', 'eye', t('展开全部后续', 'Reveal all continuation')) + '</div>' +
        '<div class="hr-status"><span class="hr-coverage"></span><span class="hr-result" aria-live="polite"></span></div>' +
        '<div class="hr-warning" role="status"></div>' + this.summaryHTML() + '<div class="hr-footer"><span>' +
        t('浅色区：参与匹配 · 金色边界：匹配终点 · 历史相似不代表未来', 'Shaded: matched window · Gold edge: match end · Similarity is not a forecast') +
        '</span><span><a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a> · <a href="./vendor/lightweight-charts/NOTICE" target="_blank" rel="noopener">Copyright (с) 2025 TradingView, Inc.</a></span>' +
        (this.data.dataKind === 'close-only' ? '<span><a href="https://docs.coinmetrics.io/packages/coin-metrics-community-data" target="_blank" rel="noopener">Coin Metrics · PriceUSD</a> · <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a></span>' : '') + '</div>';
      this.bindProfiles();
      this.onClick = event => {
        const button = event.target.closest('button');
        if (!button || !this.root.contains(button)) return;
        if ('profile' in button.dataset) return;
        if (button.dataset.year) {this.state.year = button.dataset.year; this.selectCase('year', 0);}
        else if (button.dataset.method) this.selectCase(button.dataset.method, 0);
        else if (button.dataset.price) {
          this.state.indexed = button.dataset.price === 'indexed';
          this.stop(); this.drawCharts(); this.updateControls();
        } else this.action(button.dataset.action);
      };
      this.root.addEventListener('click', this.onClick, {signal:this.abort.signal});
      this.root.addEventListener('change', event => {
        const control = event.target.dataset.control;
        if (control === 'case') this.selectCase(this.state.method, Number(event.target.value));
        if (control === 'year') {
          if (!this.data.annualCases?.[event.target.value]) return;
          this.stop(); this.state.year = event.target.value; this.selectCase('year', 0);
        }
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
      if (!['corr','dtw','year'].includes(method)) return;
      if (this.data && !M.caseList(this.data, method, this.state.year).length) return;
      this.stop();
      this.state.method = method;
      this.state.index = this.data ? Math.max(0, Math.min(index, this.cases.length - 1)) : index;
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
        pane.querySelector('.hr-dates').textContent = this.date(segment.startTime) + ' → ' +
          (this.data.interval === '1w' ? segment.endDate : this.date(segment.endTime));
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
        (this.data.dataKind === 'close-only' ? (this.state.indexed ? 'Index C ' : 'USD C ') + this.fmt(row[4]*factor) :
          ['O','H','L','C'].map((key, i) => key + ' ' + this.fmt(row[i+1] == null ? null : row[i+1]*factor)).join('  ')) +
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
      this.root.querySelectorAll('[data-year]').forEach(b => b.setAttribute('aria-pressed', this.state.method === 'year' && b.dataset.year === this.state.year));
      this.root.querySelectorAll('[data-price]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.price === 'indexed') === this.state.indexed));
      const select = query('[data-control=case]');
      const caseKey = this.state.method + ':' + this.state.year;
      if (select.dataset.method !== caseKey) {
        select.innerHTML = this.cases.map((s, i) =>
          '<option value="' + i + '">#' + (i+1) + ' · ' +
          escape(this.data.interval === '1w' ? s.endDate : this.date(s.endTime)) + ' · ' + (this.state.method !== 'dtw' ? 'corr ' + s.score.toFixed(3) : 'DTW ' + s.score.toFixed(2)) + '</option>').join('');
        select.dataset.method = caseKey;
      }
      select.value = String(this.state.index);
      const year = query('[data-control=year]');
      if (year) {year.hidden = this.state.method !== 'year'; year.value = this.state.year;}
      query('.hr-scope').textContent = this.state.method === 'year' ? (this.profileKey ? this.t('终点年份 ','Endpoint year ') : '') + this.state.year + this.t(
        ' · 年内 corr 前 ' + this.cases.length + ' 个非重叠案例 · 下方统计仍基于全历史样本',
        ' · Top ' + this.cases.length + ' non-overlapping correlation cases in this year · Statistics below use the full history') : '';
      query('[data-control=context]').value = this.state.context;
      query('[data-control=speed]').value = String(this.state.speed);
      query('[data-action=previous]').disabled = this.state.index === 0;
      query('[data-action=next]').disabled = this.state.index === this.cases.length - 1;
      query('[data-action=link]').setAttribute('aria-pressed', this.state.linked);
      query('[data-action=volume]').setAttribute('aria-pressed', this.state.volume);
      query('[data-action=volume]').disabled = this.data.dataKind === 'close-only';
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
      if (this.data.interval === '4h') warnings.push(this.t(
        '匹配窗口：60 根四小时 K 线，约 10 天；局部形态相似不代表整轮牛熊周期相同。',
        'Matching window: 60 four-hour bars, about 10 days. Local similarity does not establish an equivalent market cycle.'));
      if (this.data.dataKind === 'close-only') warnings.push(this.t(
        'USD 参考收盘线，无开高低和成交量；日期标注当日区间，收盘值在次日 UTC 00:00 确定，不是交易所 K 线。',
        'USD reference closes without O/H/L or volume. Dates label the day; its close is fixed at the following UTC midnight. Not exchange candles.'));
      else if ([this.data.current, this.selected].some(s => !s.bars.every(M.candleValid))) warnings.push(this.t(
        '部分 OHLC 不完整或结算价超出高低区间，相关图表以真实收盘线显示，未补造 K 线。',
        'Incomplete or inconsistent OHLC: affected charts use the original close line; no candles are fabricated.'));
      if ([this.data.current, this.selected].some(M.zeroRangeSegment)) warnings.push(this.t(
        '部分片段的源数据开、高、低全部等于收盘，改用收盘线显示；这些字段不足以核实日内振幅，不能视为完整日内结构。',
        'Some segments have source O/H/L equal to close throughout and are shown as close lines. These fields cannot verify intraday ranges or complete intraday structure.'));
      if (this.data.priceBasis === 'adjusted') warnings.push(this.t('价格按数据源复权口径。','Prices use source-adjusted OHLC.'));
      if (this.profileKey) {
        const status = M.profileStatus(this.descriptor);
        if (status !== 'fresh') warnings.push(this.t('数据更新延迟：显示上次可用快照，非当前行情。','Update delayed: showing the last available snapshot, not current prices.'));
      } else if (this.options.stale) warnings.push(this.t('缓存快照，非实时行情。','Cached snapshot, not live prices.'));
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
