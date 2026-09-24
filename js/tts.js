/* 朗读引擎：分片、队列播放、暂停恢复、语音切换 */
const TTSEngine = (() => {
  const MAX_CHUNK = 200; // 单片最大字符数，规避 Chrome 长文本中断 bug
  const SENTENCE_END = /[。！？；.!?;；\n]/;

  // 把一段长文本按句子边界切成 <= MAX_CHUNK 的片
  function chunkParagraph(text) {
    const chunks = [];
    let rest = text;
    while (rest.length > MAX_CHUNK) {
      let cut = -1;
      // 在窗口内从后往前找句子边界
      for (let i = MAX_CHUNK; i > MAX_CHUNK / 2; i--) {
        if (SENTENCE_END.test(rest[i - 1])) { cut = i; break; }
      }
      if (cut === -1) {
        // 找不到句子边界，退而求其次找逗号/空格
        for (let i = MAX_CHUNK; i > MAX_CHUNK / 2; i--) {
          if (/[,，、\s]/.test(rest[i - 1])) { cut = i; break; }
        }
      }
      if (cut === -1) cut = MAX_CHUNK; // 硬切
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) chunks.push(rest);
    return chunks;
  }

  // 全文 -> 段落 -> 片，记录每片所属段落
  function buildQueue(text) {
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const queue = [];
    paragraphs.forEach((para, paraIndex) => {
      chunkParagraph(para).forEach((piece) => queue.push({ text: piece, paraIndex }));
    });
    return { paragraphs, queue };
  }

  function isMostlyChinese(text) {
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    return cjk > text.replace(/\s/g, '').length / 2;
  }

  class Engine {
    constructor() {
      this.synth = window.speechSynthesis;
      this.state = 'idle'; // idle | playing | paused
      this.paragraphs = [];
      this.queue = [];
      this.index = 0;
      this.voice = null;
      this.zhVoice = null;
      this.enVoice = null;
      this.autoLang = false;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this._utterance = null;
      this._generation = 0; // 用于识别被主动取消的 utterance
      // 回调
      this.onStateChange = null;
      this.onChunk = null; // (paraIndex, chunkIndex, total)
      this.onEnd = null;
      this.onError = null;
    }

    setText(text) {
      this.stop();
      const { paragraphs, queue } = buildQueue(text);
      this.paragraphs = paragraphs;
      this.queue = queue;
      this.index = 0;
    }

    _pickVoice(chunkText) {
      if (!this.autoLang) return this.voice;
      const preferred = isMostlyChinese(chunkText) ? this.zhVoice : this.enVoice;
      return preferred || this.voice;
    }

    _speakCurrent() {
      if (this.index >= this.queue.length) {
        this._finish();
        return;
      }
      const chunk = this.queue[this.index];
      const gen = this._generation;
      const u = new SpeechSynthesisUtterance(chunk.text);
      const voice = this._pickVoice(chunk.text);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = this.rate;
      u.pitch = this.pitch;
      u.volume = this.volume;

      u.onstart = () => {
        if (gen !== this._generation) return;
        if (this.onChunk) this.onChunk(chunk.paraIndex, this.index, this.queue.length);
      };
      u.onend = () => {
        if (gen !== this._generation) return; // 被主动取消，忽略
        this.index++;
        if (this.state === 'playing') this._speakCurrent();
      };
      u.onerror = (e) => {
        if (gen !== this._generation) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        if (this.onError) this.onError(e.error);
        this.index++;
        if (this.state === 'playing') this._speakCurrent();
      };

      this._utterance = u;
      this.synth.speak(u);
    }

    play(fromIndex) {
      if (!this.queue.length) return false;
      if (typeof fromIndex === 'number') this.index = fromIndex;
      if (this.index >= this.queue.length) this.index = 0;
      this.stopInternal();
      this.state = 'playing';
      this._notify();
      this._speakCurrent();
      return true;
    }

    pause() {
      if (this.state !== 'playing') return;
      this.synth.pause();
      this.state = 'paused';
      this._notify();
    }

    resume() {
      if (this.state !== 'paused') return;
      // 部分浏览器 resume 失效，兜底：若 500ms 后仍 paused 且未在说话，从当前片重播
      this.synth.resume();
      this.state = 'playing';
      this._notify();
      setTimeout(() => {
        if (this.state === 'playing' && !this.synth.speaking && !this.synth.pending) {
          this._generation++;
          this.synth.cancel();
          this._speakCurrent();
        }
      }, 500);
    }

    stopInternal() {
      this._generation++;
      this.synth.cancel();
    }

    stop() {
      this.stopInternal();
      this.state = 'idle';
      this.index = 0;
      this._notify();
    }

    _finish() {
      this.state = 'idle';
      this.index = 0;
      this._notify();
      if (this.onEnd) this.onEnd();
    }

    // 参数变更：播放中则从当前片用新参数重播
    applyLiveChange() {
      if (this.state === 'playing') {
        this._generation++;
        this.synth.cancel();
        this._speakCurrent();
      }
    }

    _notify() {
      if (this.onStateChange) this.onStateChange(this.state);
    }
  }

  return { Engine, buildQueue, isMostlyChinese, MAX_CHUNK };
})();
