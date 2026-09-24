# 文本朗读器

基于浏览器原生 SpeechSynthesis API 的纯前端文本朗读应用，无需构建、无依赖。

## 运行

由于使用 IndexedDB，建议通过 HTTP 服务打开（`file://` 下部分浏览器限制 IndexedDB）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- 输入/粘贴文本朗读，支持中英文混合、10 万字级超长文本
- 语音选择（处理 `voiceschanged` 异步加载）、语速/音调/音量调节（播放中实时生效）
- 播放 / 暂停 / 继续 / 停止；停止后从头开始
- 按段落逐段朗读，当前段落高亮并自动滚动；点击任意段落可从该段起播
- 「按段落自动选择中/英文语音」：根据段落中文字符占比自动切换语音
- 超长文本自动分片（≤200 字符、优先句子边界），规避 Chrome 长 utterance 中断 bug
- IndexedDB 持久化：朗读偏好（语音/语速/音调/音量）+ 最近 10 条朗读记录
- 浏览器不支持 SpeechSynthesis 时显示降级提示

## 文件结构

- `index.html` — 页面结构
- `css/style.css` — 样式
- `js/db.js` — IndexedDB 封装（prefs / history 两个 store）
- `js/tts.js` — 朗读引擎：分片、播放队列、暂停恢复、语音切换（generation 计数识别主动取消）
- `js/app.js` — UI  wiring、偏好持久化、历史记录、段落高亮
