// Conversão de áudio para mensagem de voz do WhatsApp: OGG/Opus, mono, 48 kHz —
// o mesmo formato de um áudio gravado no aplicativo. Usa WebCodecs
// (AudioEncoder) e um multiplexador Ogg mínimo. Expõe globalThis.OrbitaAudio.
(() => {
  "use strict";

  const RATE = 48000;
  const FRAME = 960; // 20 ms
  const PRE_SKIP = 312;

  // ---- CRC32 do Ogg (polinômio 0x04c11db7, sem reflexão)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      t[i] = r >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    return crc >>> 0;
  }

  function oggPage({ packets, granule, serial, seq, bos = false, eos = false }) {
    const lacing = [];
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) {
        lacing.push(255);
        n -= 255;
      }
      lacing.push(n);
    }
    const bodyLen = packets.reduce((a, p) => a + p.length, 0);
    const page = new Uint8Array(27 + lacing.length + bodyLen);
    const dv = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    page[4] = 0;
    page[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
    dv.setUint32(6, granule % 2 ** 32, true);
    dv.setUint32(10, Math.floor(granule / 2 ** 32), true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, seq, true);
    dv.setUint32(22, 0, true);
    page[26] = lacing.length;
    page.set(lacing, 27);
    let off = 27 + lacing.length;
    for (const p of packets) {
      page.set(p, off);
      off += p.length;
    }
    dv.setUint32(22, crc32(page), true);
    return page;
  }

  function opusHead() {
    const b = new Uint8Array(19);
    const dv = new DataView(b.buffer);
    b.set(new TextEncoder().encode("OpusHead"), 0);
    b[8] = 1; // versão
    b[9] = 1; // canais
    dv.setUint16(10, PRE_SKIP, true);
    dv.setUint32(12, RATE, true);
    dv.setInt16(16, 0, true);
    b[18] = 0;
    return b;
  }

  function opusTags() {
    const vendor = new TextEncoder().encode("Orbita");
    const b = new Uint8Array(8 + 4 + vendor.length + 4);
    const dv = new DataView(b.buffer);
    b.set(new TextEncoder().encode("OpusTags"), 0);
    dv.setUint32(8, vendor.length, true);
    b.set(vendor, 12);
    dv.setUint32(12 + vendor.length, 0, true);
    return b;
  }

  function muxOgg(packets, totalSamples) {
    const serial = (Math.random() * 2 ** 32) >>> 0;
    const pages = [oggPage({ packets: [opusHead()], granule: 0, serial, seq: 0, bos: true }), oggPage({ packets: [opusTags()], granule: 0, serial, seq: 1 })];
    let seq = 2;
    let granule = PRE_SKIP;
    const end = PRE_SKIP + totalSamples;
    // ~1 s por página (50 pacotes de 20 ms), sempre abaixo de 255 segmentos
    for (let i = 0; i < packets.length; i += 50) {
      const group = packets.slice(i, i + 50);
      granule += group.length * FRAME;
      const last = i + 50 >= packets.length;
      pages.push(oggPage({ packets: group, granule: last ? Math.min(granule, end) : granule, serial, seq: seq++, eos: last }));
    }
    return new Blob(pages, { type: "audio/ogg; codecs=opus" });
  }

  async function decodeToMono48k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new AudioContext();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(buf);
    } catch {
      throw new Error("Não foi possível ler este áudio. Use MP3, OGG, M4A, WAV ou WEBM.");
    } finally {
      ctx.close();
    }
    const length = Math.max(1, Math.ceil(decoded.duration * RATE));
    const off = new OfflineAudioContext(1, length, RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return { samples: rendered.getChannelData(0), duration: decoded.duration };
  }

  async function supported() {
    if (typeof AudioEncoder === "undefined") return false;
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 32000 });
      return Boolean(r.supported);
    } catch {
      return false;
    }
  }

  // Converte qualquer áudio que o navegador saiba decodificar em OGG/Opus.
  async function toOggOpus(blob) {
    if (!(await supported())) throw new Error("Este navegador não tem o codificador Opus (WebCodecs). Atualize o Chrome.");
    const { samples, duration } = await decodeToMono48k(blob);
    const packets = [];
    let failure = null;
    const enc = new AudioEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        packets.push(b);
      },
      error: (e) => (failure = e),
    });
    enc.configure({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000, application: "voip" } });
    for (let i = 0; i < samples.length; i += FRAME) {
      const frame = new Float32Array(FRAME);
      frame.set(samples.subarray(i, i + FRAME));
      const ad = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: Math.round((i / RATE) * 1e6), data: frame });
      enc.encode(ad);
      ad.close();
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    if (!packets.length) throw new Error("O áudio ficou vazio depois da conversão.");
    return { blob: muxOgg(packets, samples.length), duration, peaks: peaksOf(samples, 48) };
  }

  function peaksOf(samples, n) {
    const out = [];
    const step = Math.max(1, Math.floor(samples.length / n));
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * step; j < Math.min(samples.length, (i + 1) * step); j += 16) m = Math.max(m, Math.abs(samples[j]));
      out.push(m);
    }
    const max = Math.max(0.01, ...out);
    return out.map((v) => Math.round((v / max) * 100));
  }

  async function analyze(blob) {
    const { samples, duration } = await decodeToMono48k(blob);
    return { duration, peaks: peaksOf(samples, 48) };
  }

  // Gravação pelo microfone (MediaRecorder) com medidor de nível.
  async function startRecording(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      onLevel?.(peak / 128);
      raf = requestAnimationFrame(tick);
    };
    tick();
    rec.start(250);
    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ac.close();
    };
    return {
      stop: () =>
        new Promise((resolve) => {
          rec.onstop = () => {
            cleanup();
            resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
          };
          rec.stop();
        }),
      cancel: () => {
        rec.onstop = cleanup;
        rec.stop();
      },
    };
  }

  globalThis.OrbitaAudio = { supported, toOggOpus, analyze, startRecording };
})();
