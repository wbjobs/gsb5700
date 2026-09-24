(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $('unsupported-banner'),
    input: $('text-input'),
    charCount: $('char-count'),
    paraCount: $('para-count'),
    paraView: $('paragraph-view'),
    play: $('btn-play'),
    pause: $('btn-pause'),
    resume: $('btn-resume'),
    stop: $('btn-stop'),
    clear: $('btn-clear'),
    sample: $('btn-sample'),
    status: $('status-line'),
    progress: $('progress-bar'),
    voiceSelect: $('voice-select'),
    voiceLoading: $('voice-loading'),
    rate: $('rate-input'),
    rateValue: $('rate-value'),
    pitch: $('pitch-input'),
    pitchValue: $('pitch-value'),
    volume: $('volume-input'),
    volumeValue: $('volume-value'),
    historyList: $('history-list')
  };

  const SAMPLE_TEXT = [
    '欢迎使用文本朗读器！This is a mixed Chinese and English TTS demo. 它基于浏览器原生的 SpeechSynthesis API，无需任何服务器。',
    '你可以调整语速、音调和音量，也可以在不同语音之间切换。You can switch voices at any time, even while speaking.',
    '超长文本会自动分片朗读，当前段落会高亮显示。Pause and resume are supported, and your preferences are saved locally via IndexedDB.'
  ].join('\n');

  let voices = [];
  let speaker = null;
  let savePrefsTimer = null;
  let preferredVoiceURI = '';

  if (!TTS.supported) {
    els.banner.classList.remove('hidden');
    [els.play, els.pause, els.resume, els.stop].forEach((b) => { b.disabled = true; });
    els.voiceLoading.textContent = '语音合成不可用';
    els.voiceSelect.disabled = true;
  }

  speaker = new TTS.Speaker({
    state: updateTransport,
    chunk: onChunk,
    end: onEnd,
    error: (err) => { els.status.textContent = '朗读出错：' + err; }
  });

  function currentSettings() {
    return {
      voice: voices.find((v) => v.voiceURI === els.voiceSelect.value) || null,
      rate: parseFloat(els.rate.value),
      pitch: parseFloat(els.pitch.value),
      volume: parseFloat(els.volume.value)
    };
  }

  function updateTransport(state) {
    els.play.disabled = !TTS.supported || state === 'playing' || state === 'paused';
    els.pause.disabled = state !== 'playing';
    els.resume.disabled = state !== 'paused';
    els.stop.disabled = state === 'idle';
    if (state === 'playing') els.status.textContent = '正在朗读…';
    if (state === 'paused') els.status.textContent = '已暂停（位置已保留，可继续）';
    if (state === 'idle' && els.status.textContent.startsWith('正在朗读')) {
      els.status.textContent = '就绪';
    }
  }

  function onChunk({ chunkIndex, paraIndex, totalChunks }) {
    highlightParagraph(paraIndex);
    els.progress.style.width = ((chunkIndex + 1) / totalChunks * 100).toFixed(1) + '%';
    els.status.textContent = `正在朗读… 第 ${paraIndex + 1} 段（分片 ${chunkIndex + 1}/${totalChunks}）`;
  }

  function onEnd() {
    els.status.textContent = '朗读完成';
    els.progress.style.width = '100%';
    clearHighlight(true);
  }

  function renderParagraphs() {
    const text = els.input.value;
    els.charCount.textContent = text.length + ' 字';
    const paragraphs = TTS.splitParagraphs(text);
    els.paraCount.textContent = paragraphs.length + ' 段';
    els.paraView.innerHTML = '';
    if (paragraphs.length === 0) {
      els.paraView.innerHTML = '<p class="muted placeholder">输入文本后，这里会按段落显示，朗读时高亮当前段落。</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    paragraphs.forEach((para, i) => {
      const p = document.createElement('p');
      p.dataset.index = i;
      p.textContent = para;
      fragment.appendChild(p);
    });
    els.paraView.appendChild(fragment);
  }

  function highlightParagraph(index) {
    clearHighlight(false);
    const node = els.paraView.querySelector(`p[data-index="${index}"]`);
    if (node) {
      node.classList.add('speaking');
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function clearHighlight(markDone) {
    els.paraView.querySelectorAll('p.speaking').forEach((p) => {
      p.classList.remove('speaking');
      if (markDone) p.classList.add('done');
    });
  }

  function scheduleSavePrefs() {
    clearTimeout(savePrefsTimer);
    savePrefsTimer = setTimeout(() => {
      TtsDB.setPref('settings', {
        voiceURI: els.voiceSelect.value,
        rate: els.rate.value,
        pitch: els.pitch.value,
        volume: els.volume.value
      });
    }, 300);
  }

  function renderVoiceList(preferredURI) {
    els.voiceSelect.innerHTML = '';
    const sorted = [...voices].sort((a, b) => {
      const aZh = /^zh/i.test(a.lang) ? 0 : 1;
      const bZh = /^zh/i.test(b.lang) ? 0 : 1;
      return aZh - bZh || a.name.localeCompare(b.name);
    });
    for (const voice of sorted) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name}（${voice.lang}）${voice.default ? ' · 默认' : ''}`;
      els.voiceSelect.appendChild(option);
    }
    const match = sorted.find((v) => v.voiceURI === preferredURI)
      || sorted.find((v) => /^zh/i.test(v.lang))
      || sorted[0];
    if (match) els.voiceSelect.value = match.voiceURI;
    els.voiceLoading.classList.add('hidden');
    speaker.applySettings(currentSettings());
  }

  async function restorePrefs() {
    const prefs = await TtsDB.getPref('settings');
    if (!prefs) return;
    if (prefs.voiceURI) preferredVoiceURI = prefs.voiceURI;
    if (prefs.rate) { els.rate.value = prefs.rate; els.rateValue.textContent = parseFloat(prefs.rate).toFixed(1); }
    if (prefs.pitch) { els.pitch.value = prefs.pitch; els.pitchValue.textContent = parseFloat(prefs.pitch).toFixed(1); }
    if (prefs.volume) { els.volume.value = prefs.volume; els.volumeValue.textContent = parseFloat(prefs.volume).toFixed(2); }
    if (preferredVoiceURI && voices.length) renderVoiceList(preferredVoiceURI);
    speaker.applySettings(currentSettings());
  }

  async function renderHistory() {
    const items = await TtsDB.getAllHistory();
    els.historyList.innerHTML = '';
    if (items.length === 0) {
      els.historyList.innerHTML = '<li class="empty">暂无朗读记录</li>';
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      const preview = document.createElement('div');
      preview.textContent = item.preview || '(空文本)';
      const meta = document.createElement('div');
      meta.className = 'hist-meta';
      const time = new Date(item.createdAt).toLocaleString();
      meta.innerHTML = `<span>${item.charCount} 字</span><span>${time}</span>`;
      li.appendChild(preview);
      li.appendChild(meta);
      li.title = '点击恢复此文本';
      li.addEventListener('click', () => {
        speaker.stop();
        els.input.value = item.text;
        renderParagraphs();
        els.progress.style.width = '0';
        els.status.textContent = '已恢复历史文本';
      });
      els.historyList.appendChild(li);
    }
  }

  els.input.addEventListener('input', renderParagraphs);

  els.play.addEventListener('click', () => {
    const text = els.input.value.trim();
    if (!text) {
      els.status.textContent = '请先输入要朗读的文本';
      return;
    }
    const stats = speaker.load(text);
    speaker.applySettings(currentSettings());
    clearHighlight(false);
    els.paraView.querySelectorAll('p.done').forEach((p) => p.classList.remove('done'));
    els.progress.style.width = '0';
    speaker.play();
    const settings = currentSettings();
    TtsDB.addHistory({
      text,
      voiceURI: els.voiceSelect.value,
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume
    }).then(renderHistory);
    els.status.textContent = `正在朗读… 共 ${stats.paragraphs} 段 / ${stats.chunks} 个分片`;
  });

  els.pause.addEventListener('click', () => speaker.pause());
  els.resume.addEventListener('click', () => speaker.resume());
  els.stop.addEventListener('click', () => {
    speaker.stop();
    els.status.textContent = '已停止';
    els.progress.style.width = '0';
    clearHighlight(false);
  });

  els.clear.addEventListener('click', () => {
    speaker.stop();
    els.input.value = '';
    renderParagraphs();
    els.progress.style.width = '0';
    els.status.textContent = '就绪';
  });

  els.sample.addEventListener('click', () => {
    els.input.value = SAMPLE_TEXT;
    renderParagraphs();
  });

  els.voiceSelect.addEventListener('change', () => {
    preferredVoiceURI = els.voiceSelect.value;
    speaker.applySettings(currentSettings());
    scheduleSavePrefs();
  });

  function bindSlider(input, output, digits) {
    input.addEventListener('input', () => {
      output.textContent = parseFloat(input.value).toFixed(digits);
      speaker.applySettings(currentSettings());
      scheduleSavePrefs();
    });
  }
  bindSlider(els.rate, els.rateValue, 1);
  bindSlider(els.pitch, els.pitchValue, 1);
  bindSlider(els.volume, els.volumeValue, 2);

  if (TTS.supported) {
    TTS.loadVoices((list) => {
      voices = list;
      renderVoiceList(preferredVoiceURI || els.voiceSelect.value);
    });
  }

  renderParagraphs();
  restorePrefs();
  renderHistory();
})();
