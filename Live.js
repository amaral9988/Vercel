// Ligação por voz em tempo real com o Amaral (Gemini Live).
// Substitui o botão "Ligar" antigo. O chat de texto continua igual.
let GoogleGenAI, Modality; // carregados só ao ligar, para qualquer erro aparecer na tela

const MODEL = "gemini-3.1-flash-live-preview";
const VOICE = "Charon"; // voz masculina. Outras: Puck, Orus, Fenrir
// Sensibilidade do microfone (sobe o número = menos sensível a barulho)
const GATE_NORMAL = 0.015;  // quando o Amaral está calado
const GATE_FALANDO = 0.05;  // quando o Amaral está falando (só uma voz forte interrompe)
const PROMPT =
  "Você é o Amaral (AmaraL IA), um assistente brasileiro homem, que fala de si sempre no masculino. " +
  "Você está numa ligação de voz: fale como numa conversa de telefone, com frases curtas, naturais, " +
  "tom caloroso e descontraído. Sem listas, símbolos, markdown ou links na fala. " +
  "Vá direto ao ponto, faça no máximo uma pergunta por vez e seja honesto: se não souber, diga. " +
  "Você é uma inteligência artificial e não finge ser humano. " +
  "Se o pedido exigir código ou texto longo, diga que é melhor fazer pelo chat de texto. Responda em português do Brasil.";

const $ = (id) => document.getElementById(id);
const callEl = $("call"), orb = $("orb"), statusEl = $("callStatus"), textEl = $("callText");

let session = null, stream = null, inCtx = null, outCtx = null, node = null;
let active = false, nextT = 0, wl = null, userTurn = false;
const srcs = new Set();

function setState(s, t) {
  orb.className = "orb " + s;
  statusEl.textContent = { listening: "Ouvindo…", thinking: "Pensando…", speaking: "Falando. Fale para interromper" }[s] || "";
  if (t !== undefined) textEl.textContent = t;
}

const toB64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};

function stopPlay() {
  srcs.forEach((s) => { s.onended = null; try { s.stop(); } catch (_) {} });
  srcs.clear();
  nextT = 0;
}

function play(b64) {
  const bin = atob(b64), n = bin.length >> 1;
  const dv = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = dv.getInt16(i * 2, true) / 32768;
  const buf = outCtx.createBuffer(1, n, 24000);
  buf.copyToChannel(f, 0);
  const s = outCtx.createBufferSource();
  s.buffer = buf;
  s.connect(outCtx.destination);
  const t = Math.max(outCtx.currentTime + 0.03, nextT);
  s.start(t);
  nextT = t + buf.duration;
  srcs.add(s);
  s.onended = () => { srcs.delete(s); if (!srcs.size && active) setState("listening"); };
}

function onMsg(m) {
  const sc = m.serverContent;
  if (!sc) return;
  if (sc.interrupted) { stopPlay(); setState("listening"); }
  if (sc.inputTranscription?.text) {
    if (!userTurn) { textEl.textContent = ""; userTurn = true; }
    textEl.textContent = (textEl.textContent + sc.inputTranscription.text).slice(-180);
  }
  if (sc.outputTranscription?.text) {
    if (userTurn) { textEl.textContent = ""; userTurn = false; }
    textEl.textContent = (textEl.textContent + sc.outputTranscription.text).slice(-180);
  }
  for (const p of sc.modelTurn?.parts || []) {
    if (p.inlineData?.data) { setState("speaking"); play(p.inlineData.data); }
  }
}

function stop(msg) {
  active = false;
  stopPlay();
  try { session?.close(); } catch (_) {}
  session = null;
  try { node?.disconnect(); } catch (_) {}
  node = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  inCtx?.close().catch(() => {}); inCtx = null;
  outCtx?.close().catch(() => {}); outCtx = null;
  wl?.release().catch(() => {}); wl = null;
  callEl.hidden = true;
  if (msg && window.add) window.add("bot", msg, "err");
}

async function start() {
  if (active) return;
  active = true;
  callEl.hidden = false;
  setState("thinking", "Conectando…");
  try {
    if (!GoogleGenAI) {
      try { ({ GoogleGenAI, Modality } = await import("https://esm.run/@google/genai")); }
      catch (_) { ({ GoogleGenAI, Modality } = await import("https://esm.sh/@google/genai")); }
    }
    outCtx = new AudioContext({ sampleRate: 24000 });
    inCtx = new AudioContext();
    await outCtx.resume();
    await inCtx.resume();
    try { wl = await navigator.wakeLock.request("screen"); } catch (_) {}

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });

    const r = await fetch("/.netlify/functions/live-token", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || "Não consegui iniciar a ligação.");

    const ai = new GoogleGenAI({ apiKey: d.token, httpOptions: { apiVersion: "v1alpha" } });
    session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: PROMPT,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
            endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
            prefixPaddingMs: 300,
            silenceDurationMs: 1000,
          },
        },
      },
      callbacks: {
        onmessage: onMsg,
        onerror: () => active && stop("Erro na conexão de voz. Toque em Ligar para tentar de novo."),
        onclose: () => active && stop("A ligação caiu. Toque em Ligar para tentar de novo."),
      },
    });

    const code =
      'class P extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor("p",P);';
    await inCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    const src = inCtx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(inCtx, "p");
    const mute = inCtx.createGain();
    mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(inCtx.destination);

    let acc = [], len = 0, holdUntil = 0;
    node.port.onmessage = (e) => {
      if (!session) return;
      let chunk = e.data, soma = 0;
      for (let i = 0; i < chunk.length; i++) soma += chunk[i] * chunk[i];
      const rms = Math.sqrt(soma / chunk.length), agora = performance.now();
      if (rms > (srcs.size ? GATE_FALANDO : GATE_NORMAL)) holdUntil = agora + 500;
      if (agora > holdUntil) chunk = new Float32Array(chunk.length); // silêncio
      acc.push(chunk); len += chunk.length;
      if (len < 2048) return;
      const all = new Float32Array(len);
      let o = 0;
      for (const a of acc) { all.set(a, o); o += a.length; }
      acc = []; len = 0;
      const ratio = inCtx.sampleRate / 16000, n = Math.floor(all.length / ratio), out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)]));
        out[i] = s < 0 ? s * 32768 : s * 32767;
      }
      session.sendRealtimeInput({ audio: { data: toB64(out.buffer), mimeType: "audio/pcm;rate=16000" } });
    };

    setState("listening", "");
    try { session.sendRealtimeInput({ text: "Cumprimente com um olá curto e pergunte como pode ajudar." }); } catch (_) {}
  } catch (e) {
    const negou = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    stop(negou ? "Permita o uso do microfone no navegador para fazer chamadas." : "Não consegui ligar: " + (e.message || "erro desconhecido"));
  }
}

// Captura o clique em "Ligar" antes do código antigo
document.addEventListener("click", (e) => {
  if (e.target.closest("#ligar")) { e.stopImmediatePropagation(); e.preventDefault(); start(); }
}, true);
$("hang").addEventListener("click", () => stop());
orb.addEventListener("click", () => { if (active) { stopPlay(); setState("listening"); } });
