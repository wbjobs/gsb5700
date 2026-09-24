/* UI  wiring：语音列表、偏好持久化、历史记录、段落高亮 */
(() => {
  // ---------- 浏览器支持检测 ----------
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    document.getElementById('unsupported').classList.remove('hidden');
    return;
  }
  document.getElementById('app').classList.remove('hidden');

  const $ = (id) => document.getElementById(id);
  const els = {
    text: $('textInput'), charCount: $('charCount'),
    btnPlay: $('btnPlay'), btnPause: $('btnPause'), btnStop: $('btnStop'),
    btnSample: $('btnSample'), btnClear: $('btnClear'),
    voice: $('voiceSelect'), autoLang: $('autoLang'),
    rate: $('rate'), pitch: $('pitch'), volume: $('volume'),
    rateVal: $('rateVal'), pitchVal: $('pitchVal'), volumeVal: $('volumeVal'),
    status: $('status'), progress: $('progress'), progressText: $('progressText'),
    readerSection: $('readerSection'), reader: $('reader'),
    historyList: $('historyList'),
  };

  const engine = new TTSEngine.Engine();
  let voices = [];
  let prefsSaveTimer = null;

  // ---------- 语音列表（异步加载） ----------
  function loadVoices() {
    const list = speechSynthesis.getVoices();
    if (!list.length) return; // 等待 voiceschanged
    voices = list;
    const current = els.voice.value;
    els.voice.innerHTML = '';
    list.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' ★' : ''}`;
      els.voice.appendChild(opt);
    });
    // 恢复之前的选择
    if (current && list.some((v) => v.voiceURI === current)) {
      els.voice.value = current;
    } else {
      const zh = list.find((v) => /^zh/i.test(v.lang));
      if (zh) els.voice.value = zh.voiceURI;
    }
    syncEngineVoice();
  }
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
  // 某些浏览器需主动触发一次
  setTimeout(loadVoices, 500);

  function findVoice(uri) {
    return voices.find((v) => v.voiceURI === uri) || null;
  }

  function syncEngineVoice() {
    engine.voice = findVoice(els.voice.value);
    engine.zhVoice = voices.find((v) => /^zh([-_]|$)/i.test(v.lang)) || null;
    engine.enVoice = voices.find((v) => /^en([-_]|$)/i.test(v.lang)) || null;
  }

  // ---------- 偏好持久化 ----------
  function collectPrefs() {
    return {
      voiceURI: els.voice.value,
      autoLang: els.autoLang.checked,
      rate: +els.rate.value,
      pitch: +els.pitch.value,
      volume: +els.volume.value,
    };
  }

  function savePrefs() {
    clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(() => DB.savePrefs(collectPrefs()).catch(() => {}), 300);
  }

  async function restorePrefs() {
    try {
      const p = await DB.loadPrefs();
      if (!p) return;
      if (p.rate != null) els.rate.value = p.rate;
      if (p.pitch != null) els.pitch.value = p.pitch;
      if (p.volume != null) els.volume.value = p.volume;
      els.autoLang.checked = !!p.autoLang;
      if (p.voiceURI) {
        // 语音可能尚未加载，等加载后恢复
        const trySet = () => {
          if (voices.some((v) => v.voiceURI === p.voiceURI)) {
            els.voice.value = p.voiceURI;
            syncEngineVoice();
          }
        };
        trySet();
        const origHandler = speechSynthesis.onvoiceschanged;
        speechSynthesis.onvoiceschanged = () => { origHandler(); trySet(); };
      }
      syncSliders();
    } catch (e) { /* IndexedDB 不可用时静默降级 */ }
  }

  function syncSliders() {
    engine.rate = +els.rate.value;
    engine.pitch = +els.pitch.value;
    engine.volume = +els.volume.value;
    engine.autoLang = els.autoLang.checked;
    els.rateVal.textContent = (+els.rate.value).toFixed(1);
    els.pitchVal.textContent = (+els.pitch.value).toFixed(1);
    els.volumeVal.textContent = (+els.volume.value).toFixed(1);
  }

  // ---------- 朗读视图渲染与高亮 ----------
  function renderReader() {
    els.reader.innerHTML = '';
    engine.paragraphs.forEach((p, i) => {
      const el = document.createElement('p');
      el.textContent = p;
      el.dataset.idx = i;
      el.addEventListener('click', () => {
        const chunkIdx = engine.queue.findIndex((c) => c.paraIndex === i);
        if (chunkIdx >= 0) {
          engine.play(chunkIdx);
          addHistoryRecord();
        }
      });
      els.reader.appendChild(el);
    });
    els.readerSection.classList.remove('hidden');
  }

  function highlightParagraph(paraIndex) {
    els.reader.querySelectorAll('p').forEach((el) => {
      const idx = +el.dataset.idx;
      el.classList.toggle('speaking', idx === paraIndex);
      el.classList.toggle('done', idx < paraIndex);
    });
    const cur = els.reader.querySelector(`p[data-idx="${paraIndex}"]`);
    if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearHighlight() {
    els.reader.querySelectorAll('p').forEach((el) => el.classList.remove('speaking', 'done'));
  }

  // ---------- 引擎事件 ----------
  engine.onStateChange = (state) => {
    els.btnPlay.disabled = state === 'playing';
    els.btnPause.disabled = state !== 'playing';
    els.btnStop.disabled = state === 'idle';
    els.btnPlay.textContent = state === 'paused' ? '▶ 继续' : '▶ 朗读';
    els.status.textContent = { idle: '就绪', playing: '朗读中…', paused: '已暂停' }[state];
    if (state === 'idle') {
      els.progress.value = 0;
      els.progressText.textContent = `0 / ${engine.queue.length} 段`;
    }
  };

  engine.onChunk = (paraIndex, chunkIndex, total) => {
    highlightParagraph(paraIndex);
    els.progress.max = total;
    els.progress.value = chunkIndex;
    els.progressText.textContent = `${chunkIndex + 1} / ${total} 段`;
  };

  engine.onEnd = () => {
    els.progress.value = els.progress.max;
    els.status.textContent = '朗读完成';
    clearHighlight();
  };

  engine.onError = (err) => {
    els.status.textContent = `出错：${err}`;
  };

  // ---------- 历史记录 ----------
  let historyRecorded = false;
  async function addHistoryRecord() {
    if (historyRecorded) return;
    historyRecorded = true;
    const text = els.text.value.trim();
    if (!text) return;
    try {
      await DB.addHistory({
        text: text.slice(0, 20000), // 记录截断保存，避免占满存储
        preview: text.slice(0, 60),
        chars: text.length,
        ...collectPrefs(),
      });
      renderHistory();
    } catch (e) { /* 静默 */ }
  }

  async function renderHistory() {
    let items = [];
    try { items = (await DB.getHistory()).reverse(); } catch (e) { /* 静默 */ }
    els.historyList.innerHTML = '';
    if (!items.length) {
      els.historyList.innerHTML = '<li class="history-empty">暂无记录</li>';
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'h-text';
      span.textContent = item.preview || item.text.slice(0, 60);
      span.title = '点击载入此文本';
      span.addEventListener('click', () => {
        els.text.value = item.text;
        updateCharCount();
        prepareText();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      meta.textContent = `${item.chars}字 · ${new Date(item.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const del = document.createElement('button');
      del.className = 'h-del';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        await DB.deleteHistory(item.id).catch(() => {});
        renderHistory();
      });
      li.append(span, meta, del);
      els.historyList.appendChild(li);
    });
  }

  // ---------- 文本准备 ----------
  function prepareText() {
    const text = els.text.value.trim();
    engine.setText(text);
    if (engine.paragraphs.length) {
      renderReader();
      els.progress.max = engine.queue.length;
      els.progress.value = 0;
      els.progressText.textContent = `0 / ${engine.queue.length} 段`;
    } else {
      els.readerSection.classList.add('hidden');
    }
  }

  function updateCharCount() {
    els.charCount.textContent = `${els.text.value.length} 字符`;
  }

  // ---------- 事件绑定 ----------
  els.text.addEventListener('input', () => {
    updateCharCount();
    historyRecorded = false;
    if (engine.state === 'idle') prepareText();
  });

  els.btnPlay.addEventListener('click', () => {
    if (engine.state === 'paused') { engine.resume(); return; }
    if (!engine.queue.length) prepareText();
    if (!engine.queue.length) {
      els.status.textContent = '请先输入文本';
      return;
    }
    syncSliders();
    syncEngineVoice();
    engine.play();
    addHistoryRecord();
  });

  els.btnPause.addEventListener('click', () => engine.pause());
  els.btnStop.addEventListener('click', () => { engine.stop(); clearHighlight(); });

  els.voice.addEventListener('change', () => {
    syncEngineVoice();
    engine.applyLiveChange();
    savePrefs();
  });
  els.autoLang.addEventListener('change', () => {
    syncSliders();
    engine.applyLiveChange();
    savePrefs();
  });

  [['rate', els.rate], ['pitch', els.pitch], ['volume', els.volume]].forEach(([key, el]) => {
    el.addEventListener('input', () => {
      syncSliders();
      engine.applyLiveChange();
      savePrefs();
    });
  });

  els.btnClear.addEventListener('click', () => {
    engine.stop();
    els.text.value = '';
    updateCharCount();
    clearHighlight();
    els.readerSection.classList.add('hidden');
    historyRecorded = false;
  });

  els.btnSample.addEventListener('click', () => {
    els.text.value = [
      '你好，世界！这是一个中英文混合的朗读示例。',
      'The quick brown fox jumps over the lazy dog. SpeechSynthesis API 让浏览器可以直接朗读文本。',
      '支持语速、音调、音量的调节，也可以随时暂停、继续或停止。You can switch voices at any time, even while speaking.',
      '超长文本会自动分片朗读，当前段落会高亮显示。Enjoy listening!',
    ].join('\n');
    updateCharCount();
    historyRecorded = false;
    prepareText();
  });

  // 页面关闭前保存偏好
  window.addEventListener('beforeunload', () => {
    clearTimeout(prefsSaveTimer);
    DB.savePrefs(collectPrefs()).catch(() => {});
  });

  // ---------- 初始化 ----------
  syncSliders();
  updateCharCount();
  restorePrefs();
  renderHistory();
})();
