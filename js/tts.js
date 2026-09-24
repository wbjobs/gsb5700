const TTS = (() => {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const MAX_CHUNK_LEN = 180;

  function splitParagraphs(text) {
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function splitSentences(paragraph) {
    const parts = paragraph.match(/[^。！？；.!?;…]+[。！？；.!?;…]*["'”’）)]?|\S+$/g);
    return parts ? parts.map((s) => s.trim()).filter(Boolean) : [paragraph];
  }

  function chunkParagraph(paragraph, maxLen) {
    const sentences = splitSentences(paragraph);
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      if (sentence.length > maxLen) {
        if (current) { chunks.push(current); current = ''; }
        for (let i = 0; i < sentence.length; i += maxLen) {
          chunks.push(sentence.slice(i, i + maxLen));
        }
      } else if ((current + sentence).length > maxLen) {
        chunks.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function buildQueue(paragraphs) {
    const queue = [];
    paragraphs.forEach((para, paraIndex) => {
      for (const text of chunkParagraph(para, MAX_CHUNK_LEN)) {
        queue.push({ text, paraIndex });
      }
    });
    return queue;
  }

  class Speaker {
    constructor(handlers) {
      this.handlers = handlers;
      this.paragraphs = [];
      this.queue = [];
      this.index = 0;
      this.state = 'idle';
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this._utterance = null;
      this._generation = 0;
      this._keepAliveTimer = null;
    }

    load(text) {
      this.stop();
      this.paragraphs = splitParagraphs(text);
      this.queue = buildQueue(this.paragraphs);
      this.index = 0;
      return { paragraphs: this.paragraphs.length, chunks: this.queue.length };
    }

    get totalChunks() { return this.queue.length; }
    get currentParagraph() {
      return this.queue[this.index] ? this.queue[this.index].paraIndex : -1;
    }

    play() {
      if (!supported || this.queue.length === 0) return;
      if (this.state === 'playing' || this.state === 'paused') return;
      this._cancelPending();
      this._setState('playing');
      this._startKeepAlive();
      this._speakCurrent();
    }

    pause() {
      if (this.state !== 'playing') return;
      this._setState('paused');
      this._stopKeepAlive();
      try { speechSynthesis.pause(); } catch (err) { /* 部分浏览器不支持 */ }
    }

    resume() {
      if (this.state !== 'paused') return;
      this._setState('playing');
      this._startKeepAlive();
      if (speechSynthesis.paused) {
        try { speechSynthesis.resume(); } catch (err) { /* 忽略 */ }
      } else {
        this._speakCurrent();
      }
    }

    stop() {
      this._setState('idle');
      this._stopKeepAlive();
      this._cancelPending();
      this.index = 0;
    }

    applySettings({ voice, rate, pitch, volume }) {
      if (voice !== undefined) this.voice = voice;
      if (rate !== undefined) this.rate = rate;
      if (pitch !== undefined) this.pitch = pitch;
      if (volume !== undefined) this.volume = volume;
      if (this.state === 'playing') {
        this._cancelPending();
        this._speakCurrent();
      }
    }

    _speakCurrent() {
      if (this.state !== 'playing') return;
      const item = this.queue[this.index];
      if (!item) { this._finish(); return; }
      const generation = this._generation;

      const utterance = new SpeechSynthesisUtterance(item.text);
      if (this.voice) utterance.voice = this.voice;
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;
      utterance.volume = this.volume;

      utterance.onstart = () => {
        this._emit('chunk', {
          chunkIndex: this.index,
          paraIndex: item.paraIndex,
          totalChunks: this.queue.length
        });
      };
      utterance.onend = () => {
        if (generation !== this._generation) return;
        this.index += 1;
        if (this.index >= this.queue.length) {
          this._finish();
        } else {
          this._speakCurrent();
        }
      };
      utterance.onerror = (event) => {
        if (generation !== this._generation || event.error === 'interrupted' || event.error === 'canceled') return;
        this._emit('error', event.error);
        this.index += 1;
        if (this.index >= this.queue.length) {
          this._finish();
        } else {
          this._speakCurrent();
        }
      };

      this._utterance = utterance;
      speechSynthesis.speak(utterance);
    }

    _finish() {
      this._stopKeepAlive();
      this._setState('idle');
      this.index = 0;
      this._emit('end');
    }

    _cancelPending() {
      this._generation += 1;
      try { speechSynthesis.cancel(); } catch (err) { /* 忽略 */ }
    }

    _setState(state) {
      this.state = state;
      this._emit('state', state);
    }

    _emit(type, payload) {
      if (this.handlers && typeof this.handlers[type] === 'function') {
        this.handlers[type](payload);
      }
    }

    _startKeepAlive() {
      this._stopKeepAlive();
      this._keepAliveTimer = setInterval(() => {
        if (this.state === 'playing' && !speechSynthesis.paused) {
          try { speechSynthesis.resume(); } catch (err) { /* 忽略 */ }
        }
      }, 10000);
    }

    _stopKeepAlive() {
      if (this._keepAliveTimer) {
        clearInterval(this._keepAliveTimer);
        this._keepAliveTimer = null;
      }
    }
  }

  function loadVoices(onChange) {
    if (!supported) { onChange([]); return () => {}; }
    let lastSignature = '';
    const deliver = () => {
      const voices = speechSynthesis.getVoices();
      const signature = voices.map((v) => v.voiceURI).join('|');
      if (voices.length > 0 && signature !== lastSignature) {
        lastSignature = signature;
        onChange(voices);
      }
    };
    deliver();
    speechSynthesis.addEventListener('voiceschanged', deliver);
    const retryTimer = setInterval(() => {
      deliver();
      if (lastSignature) clearInterval(retryTimer);
    }, 500);
    setTimeout(() => clearInterval(retryTimer), 10000);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', deliver);
      clearInterval(retryTimer);
    };
  }

  return { supported, Speaker, loadVoices, splitParagraphs };
})();
