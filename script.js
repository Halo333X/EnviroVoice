// =====================================================
// CLASE: VOICE DETECTOR
// =====================================================

class VoiceDetector {
  constructor(stream, onVoiceChange) {
    this.stream = stream;
    this.onVoiceChange = onVoiceChange;
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.dataArray = null;
    this.isTalking = false;
    this.detectionInterval = null;
    
    // Configuración de umbrales
    this.threshold = -25;
    this.silenceThreshold = -30;
    this.silenceDelay = 500;
    this.lastSpeakTime = 0;
    
    this.init();
  }

  async init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      this.startDetection();
      console.log("✓ Voice detector initialized");
    } catch (error) {
      console.error("❌ Voice detector init error:", error);
    }
  }

  getVolumeDb() {
    this.analyser.getByteTimeDomainData(this.dataArray);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] - 128; // centrar
      sum += v * v;
    }

    const rms = Math.sqrt(sum / this.dataArray.length);
    const db = 20 * Math.log10(rms / 128);

    return db;
  }

  startDetection() {
    this.detectionInterval = setInterval(() => {
      const volumeDb = this.getVolumeDb();
      const now = Date.now();
      
      if (volumeDb > this.threshold) {
        this.lastSpeakTime = now;
        
        if (!this.isTalking) {
          this.isTalking = true;
          this.notifyChange(true, volumeDb);
        }
      } 
      else if (volumeDb < this.silenceThreshold && this.isTalking) {
        if (now - this.lastSpeakTime > this.silenceDelay) {
          this.isTalking = false;
          this.notifyChange(false, volumeDb);
        }
      }
      this.notifyChange(this.isTalking, volumeDb);
    });
  }

  notifyChange(isTalking, volumeDb) {
    if (this.onVoiceChange) {
      this.onVoiceChange(isTalking, volumeDb);
    }
  }

  setSensitivity(level) {
    switch (level) {
      case 'low':              // hablar normal sin gritar
        this.threshold = -40;  // habla desde voz baja
        this.silenceThreshold = -48; // silencio real
        break;

      case 'medium':           // buena para la mayoría
        this.threshold = -34;  // voz normal detectada rápido
        this.silenceThreshold = -44;
        break;

      case 'high':             // si quieres detectar susurros
        this.threshold = -30;  // casi cualquier voz activa
        this.silenceThreshold = -42;
        break;

      default:
        throw new Error(`Unknown sensitivity level: ${level}`);
    }
  }

  dispose() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    
    if (this.microphone) {
      this.microphone.disconnect();
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    console.log("✓ Voice detector disposed");
  }
}

// =====================================================
// CLASE: AudioEffectsManager
// Maneja efectos de audio (reverb, cave, underwater, etc.)
// =====================================================
class AudioEffectsManager {
  constructor() {
    this.reverb = null;
    this.filter = null;
    this.chorus = null;
    this.dynamicNodes = [];
    this.currentEffect = "none";
    this.inputNode = null; // Ahora será Tone.Gain
    this.processedStream = null;
    this.lastEffectChange = 0; // NUEVO: Para throttling
  }

  async init() {
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 });
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 1200 });
    this.chorus = new Tone.Chorus({
      frequency: 1.5,
      delayTime: 3.5,
      depth: 0.7,
      wet: 0.25,
    });
    await this.reverb.generate();
    console.log("✓ Audio effects initialized");
  }

  createInputNode(micVolume = 1.0) {
    // CRÍTICO: Usar Tone.Gain en lugar de nodo nativo
    this.inputNode = new Tone.Gain(micVolume);
    return this.inputNode;
  }

  async applyEffect(effect, peerConnections) {
    if (!this.inputNode) {
      console.error("❌ No input node available");
      return;
    }

    // CRÍTICO: Throttle para evitar cambios muy frecuentes
    const now = Date.now();
    if (this.currentEffect === effect && this.processedStream !== null) {
      return;
    }

    // Limitar a 1 cambio por segundo
    if (this.processedStream !== null && now - this.lastEffectChange < 1000) {
      return;
    }
    this.lastEffectChange = now;

    console.log(`🎨 Changing effect: ${this.currentEffect} → ${effect}`);

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const dest = audioContext.createMediaStreamDestination();

    // Limpiar efectos anteriores
    this.dynamicNodes.forEach((n) => {
      try {
        n.disconnect();
        if (n.dispose) n.dispose();
      } catch (e) {}
    });
    this.dynamicNodes = [];
    this.inputNode.disconnect();

    // Crear y conectar nuevos efectos
    switch (effect) {
      case "underwater":
        this.filter.type = "lowpass";
        this.filter.frequency.value = 500;
        this.filter.Q.value = 1;
        this.reverb.decay = 2.8;
        this.reverb.wet.value = 0.5;

        // CORRECTO: Todos son nodos de Tone.js
        this.inputNode.chain(this.filter, this.reverb, dest);
        break;

      case "cave":
        const caveDelay = new Tone.FeedbackDelay("0.15", 0.35);
        const caveReverb = new Tone.Reverb({ decay: 5, wet: 0.6 });
        const caveEQ = new Tone.EQ3(-2, 0, -1);
        this.dynamicNodes.push(caveDelay, caveReverb, caveEQ);

        await caveReverb.ready;

        // CORRECTO: Todos son nodos de Tone.js
        this.inputNode.chain(caveEQ, caveReverb, caveDelay, dest);
        break;

      case "mountain":
        const mountainDelay = new Tone.FeedbackDelay("0.25", 0.25);
        const mountainReverb = new Tone.Reverb({ decay: 4, wet: 0.35 });
        const mountainEQ = new Tone.EQ3(-2, 0, -1);
        this.dynamicNodes.push(mountainDelay, mountainReverb, mountainEQ);

        await mountainReverb.ready;

        this.inputNode.chain(mountainEQ, mountainReverb, mountainDelay, dest);
        break;

      case "buried":
        const muffled = new Tone.Filter({
          type: "lowpass",
          frequency: 250,
          Q: 2,
        });
        const secondFilter = new Tone.Filter({
          type: "highpass",
          frequency: 150,
          Q: 1,
        });

        const lfo = new Tone.LFO("0.3Hz", 200, 400).start();
        lfo.connect(muffled.frequency);

        const buriedReverb = new Tone.Reverb({ decay: 4, wet: 0.7 });
        const gainNode = new Tone.Gain(0.8);

        this.dynamicNodes.push(
          muffled,
          secondFilter,
          lfo,
          buriedReverb,
          gainNode
        );

        await buriedReverb.ready;

        this.inputNode.chain(
          secondFilter,
          muffled,
          buriedReverb,
          gainNode,
          dest
        );
        break;

        default:
          const noiseGate = new Tone.Gate(-45, 0.15); 
          const cleanFilter = new Tone.Filter({ type: "highpass", frequency: 80 });
          const lowpassFilter = new Tone.Filter({ type: "lowpass", frequency: 8000 });
          const compressor = new Tone.Compressor(-28, 2.5);
          
          this.dynamicNodes.push(noiseGate, cleanFilter, lowpassFilter, compressor);
          
          this.inputNode.chain(cleanFilter, noiseGate, lowpassFilter, compressor, dest);
          break;
    }

    this.processedStream = dest.stream;
    this.currentEffect = effect;

    if (this.processedStream && peerConnections && peerConnections.size > 0) {
      const newTrack = this.processedStream.getAudioTracks()[0];

      if (!newTrack) {
        console.error("❌ No audio track found in processedStream");
        return;
      }

      const updatePromises = [];

      peerConnections.forEach((peerData, gamertag) => {
        const pc = peerData.pc || peerData;
        const senders = pc.getSenders();
        const audioSender = senders.find(
          (s) => s.track && s.track.kind === "audio"
        );

        if (audioSender) {
          const promise = audioSender
            .replaceTrack(newTrack)
            .then(() => {
              console.log(`✓ Track replaced for ${gamertag} (${effect})`);
            })
            .catch((e) => {
              console.error(`❌ Error replacing track for ${gamertag}:`, e);
            });
          updatePromises.push(promise);
        }
      });

      await Promise.all(updatePromises);
      console.log(`✅ Effect applied to ${updatePromises.length} peer(s)`);
    }
  }

  updateVolume(volume, peerConnections = null) {
    if (this.inputNode) {
      const oldVolume = this.inputNode.gain.value;
      const changed = Math.abs(oldVolume - volume) > 0.05;

      this.inputNode.gain.value = volume;

      if (changed) {
        console.log(
          `🎚️ Volume: ${(oldVolume * 100).toFixed(0)}% → ${(
            volume * 100
          ).toFixed(0)}%`
        );
      }
    }
  }

  getProcessedStream() {
    return this.processedStream;
  }

  getCurrentEffect() {
    return this.currentEffect;
  }
}

// =====================================================
// CLASE: PushToTalkManager
// Maneja el sistema de Push-to-Talk
// =====================================================
class PushToTalkManager {
  constructor(micManager, webrtcManager) {
    this.micManager = micManager;
    this.webrtcManager = webrtcManager;
    this.enabled = false;
    this.key = "KeyV";
    this.keyDisplay = "V";
    this.isKeyPressed = false;
    this.isTalking = false;
    this.onTalkingChange = null;
  }

  setWebRTCManager(webrtcManager) {
    this.webrtcManager = webrtcManager;
  }

  setEnabled(enabled) {
    this.enabled = enabled;

    if (enabled) {
      // Cuando se activa PTT, mutear completamente
      this.isTalking = false;
      this.isKeyPressed = false;
      this.muteAllSenders();
      this.notifyTalkingChange();
      console.log(
        `🎙️ Push-to-Talk enabled (Key: ${this.keyDisplay}) - Microphone MUTED by default`
      );
    } else {
      // Al desactivar PTT, activar el micrófono
      this.isTalking = true;
      this.unmuteAllSenders();
      this.notifyTalkingChange();
      console.log("🎙️ Push-to-Talk disabled - Microphone ACTIVE");
    }
  }

  // NUEVO: Mutear todos los senders de WebRTC
  muteAllSenders() {
    if (!this.webrtcManager || !this.webrtcManager.peerConnections) {
      console.log("⚠️ No WebRTC connections available to mute");
      return;
    }

    let mutedCount = 0;
    this.webrtcManager.peerConnections.forEach((pc, gamertag) => {
      // pc es directamente el RTCPeerConnection, no un objeto wrapper
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          sender.track.enabled = false;
          mutedCount++;
        }
      });
    });

    console.log(
      `🔇 Muted ${mutedCount} audio sender(s) across ${this.webrtcManager.peerConnections.size} peer(s)`
    );
  }

  // NUEVO: Desmutear todos los senders de WebRTC
  unmuteAllSenders() {
    if (!this.webrtcManager || !this.webrtcManager.peerConnections) {
      console.log("⚠️ No WebRTC connections available to unmute");
      return;
    }

    let unmutedCount = 0;
    this.webrtcManager.peerConnections.forEach((pc, gamertag) => {
      // pc es directamente el RTCPeerConnection, no un objeto wrapper
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          sender.track.enabled = true;
          unmutedCount++;
        }
      });
    });

    console.log(
      `🔊 Unmuted ${unmutedCount} audio sender(s) across ${this.webrtcManager.peerConnections.size} peer(s)`
    );
  }

  setKey(key, display) {
    this.key = key;
    this.keyDisplay = display;
    console.log(`🔑 PTT key changed to: ${display}`);
  }

  handleKeyDown(event) {
    if (!this.enabled) return;

    if (event.code === this.key && !this.isKeyPressed) {
      this.isKeyPressed = true;
      this.isTalking = true;

      // CRÍTICO: Activar todos los senders de WebRTC
      this.unmuteAllSenders();

      this.notifyTalkingChange();
      this.showTalkingIndicator();
      console.log("🎤 PTT: Talking...");
    }
  }

  handleKeyUp(event) {
    if (!this.enabled) return;

    if (event.code === this.key && this.isKeyPressed) {
      this.isKeyPressed = false;
      this.isTalking = false;

      // CRÍTICO: Mutear todos los senders de WebRTC
      this.muteAllSenders();

      this.notifyTalkingChange();
      this.hideTalkingIndicator();
      console.log("🔇 PTT: Stopped talking");
    }
  }

  showTalkingIndicator() {
    let indicator = document.getElementById("pttActiveIndicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "pttActiveIndicator";
      indicator.className = "ptt-active-indicator";
      indicator.textContent = `🎤 Talking (${this.keyDisplay})`;
      document.body.appendChild(indicator);
    }
  }

  hideTalkingIndicator() {
    const indicator = document.getElementById("pttActiveIndicator");
    if (indicator) {
      indicator.remove();
    }
  }

  setOnTalkingChange(callback) {
    this.onTalkingChange = callback;
  }

  notifyTalkingChange() {
    if (this.onTalkingChange) {
      this.onTalkingChange(this.isTalking);
    }
  }

  isSpeaking() {
    return this.isTalking;
  }

  isEnabled() {
    return this.enabled;
  }
}

// =====================================================
// CLASE: MicrophoneManager
// Maneja el micrófono del usuario
// =====================================================
class MicrophoneManager {
  constructor(audioEffects) {
    this.mediaStream = null;
    this.mediaStreamSource = null;
    this.audioEffects = audioEffects;
    this.isMuted = false;
  }

  async start(micVolume = 1.0) {
    // NUEVO: Validar que getUserMedia esté disponible
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Your browser doesn't support audio capture. " +
          "Please use HTTPS or try a different browser (Chrome, Firefox, Safari)."
      );
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = Tone.context.rawContext || Tone.context._context;

      this.mediaStreamSource = audioContext.createMediaStreamSource(
        this.mediaStream
      );
      const inputNode = this.audioEffects.createInputNode(micVolume);

      const dest = audioContext.createMediaStreamDestination();
      this.mediaStreamSource.connect(inputNode.input);
      await this.audioEffects.applyEffect("none", null);
      console.log("✓ Microphone started");
    } catch (error) {
      // Mejorar mensajes de error
      let errorMessage = "Error accessing microphone: ";

      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        errorMessage += "Permission denied. Please allow microphone access.";
      } else if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
      ) {
        errorMessage += "No microphone found. Please connect a microphone.";
      } else if (
        error.name === "NotReadableError" ||
        error.name === "TrackStartError"
      ) {
        errorMessage += "Microphone is being used by another application.";
      } else if (error.name === "OverconstrainedError") {
        errorMessage += "Microphone doesn't support the requested settings.";
      } else {
        errorMessage += error.message;
      }

      throw new Error(errorMessage);
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    console.log("✓ Microphone stopped");
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.mediaStream) {
      this.mediaStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = !this.isMuted));
    }
    return this.isMuted;
  }

  setEnabled(enabled) {
    if (this.mediaStream) {
      this.mediaStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = enabled));
    }
  }

  getStream() {
    return this.mediaStream;
  }

  isMicMuted() {
    return this.isMuted;
  }

  // NUEVO: Cambiar el dispositivo de micrófono
  async changeMicrophone(deviceId) {
    console.log(`🎤 Changing microphone to: ${deviceId}`);
    
    // Detener el micrófono actual
    this.stop();
    
    // Iniciar con el nuevo dispositivo
    try {
      // Modificar las constraints para usar el deviceId específico
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = Tone.context.rawContext || Tone.context._context;

      this.mediaStreamSource = audioContext.createMediaStreamSource(
        this.mediaStream
      );
      const inputNode = this.audioEffects.createInputNode(1.0);

      const dest = audioContext.createMediaStreamDestination();
      this.mediaStreamSource.connect(inputNode.input);
      await this.audioEffects.applyEffect("none", null);
      
      console.log("✓ Microphone changed successfully");
      return true;
    } catch (error) {
      console.error("❌ Error changing microphone:", error);
      throw error;
    }
  }

  // NUEVO: Obtener lista de dispositivos de audio disponibles
  static async getAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      console.log(`🎤 Found ${audioInputs.length} audio input devices`);
      return audioInputs;
    } catch (error) {
      console.error("❌ Error getting audio devices:", error);
      return [];
    }
  }
}

// =====================================================
// CLASE: Participant
// Representa a un participante en la llamada
// =====================================================
class Participant {
  constructor(gamertag, isSelf = false) {
    this.gamertag = gamertag;
    this.isSelf = isSelf;
    this.distance = 0;
    this.volume = 1;
    this.gainNode = null;
    this.audioElement = null;
    this.source = null;
    this.customVolume = 1;
    this.skinUrl = this.generateSkinUrl(gamertag); // NUEVO: URL de la skin
  }

  // NUEVO: Generar URL de la skin usando mc-api.io
  generateSkinUrl(gamertag) {
    // Usar el endpoint de mc-api.io para Bedrock
    return `https://mc-api.io/render/face/${encodeURIComponent(
      gamertag
    )}/bedrock`;
  }

  setAudioNodes(gainNode, audioElement, source) {
    this.gainNode = gainNode;
    this.audioElement = audioElement;
    this.source = source;
  }

  setCustomVolume(volume) {
    this.customVolume = volume;
  }

  updateVolume(newVolume) {
    const finalVolume = newVolume * this.customVolume;
    this.volume = finalVolume;

    if (this.gainNode) {
      this.gainNode.gain.value = finalVolume;
    } else if (this.audioElement) {
      this.audioElement.volume = finalVolume;
    }
  }

  updateDistance(distance) {
    this.distance = distance;
  }

  cleanup() {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {}
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (e) {}
    }
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement.remove();
      } catch (e) {}
    }
  }

  getDisplayInfo() {
    return {
      gamertag: this.gamertag,
      isSelf: this.isSelf,
      distance: Math.round(this.distance),
      volume: this.volume,
      skinUrl: this.skinUrl, // NUEVO: Incluir URL de la skin
    };
  }
}

// =====================================================
// CLASE: ParticipantsManager
// Gestiona todos los participantes
// =====================================================
class ParticipantsManager {
  constructor() {
    this.participants = new Map();
    this.pendingNodes = new Map();
  }

  add(gamertag, isSelf = false) {
    if (this.participants.has(gamertag)) return;

    const participant = new Participant(gamertag, isSelf);

    // Verificar si hay nodos pendientes
    const pendingData = this.pendingNodes.get(gamertag);
    if (pendingData) {
      participant.setAudioNodes(
        pendingData.gainNode,
        pendingData.audioElement,
        pendingData.source
      );
      if (pendingData.gainNode) {
        pendingData.gainNode.gain.value = 1;
      }
      this.pendingNodes.delete(gamertag);
      console.log(`✓ Audio nodes assigned to ${gamertag}`);
    }

    this.participants.set(gamertag, participant);
  }

  remove(gamertag) {
    const participant = this.participants.get(gamertag);
    if (participant) {
      participant.cleanup();
      this.participants.delete(gamertag);
    }
  }

  get(gamertag) {
    return this.participants.get(gamertag);
  }

  has(gamertag) {
    return this.participants.has(gamertag);
  }

  getAll() {
    return Array.from(this.participants.values());
  }

  clear() {
    this.participants.forEach((p) => p.cleanup());
    this.participants.clear();
    this.pendingNodes.clear();
  }

  addPendingNode(gamertag, nodeData) {
    this.pendingNodes.set(gamertag, nodeData);
  }

  forEach(callback) {
    this.participants.forEach(callback);
  }
}

// =====================================================
// CLASE: WebRTCManager
// Maneja las conexiones WebRTC peer-to-peer
// =====================================================
class WebRTCManager {
  constructor(participantsManager, audioEffects, minecraft, onTrackReceived) {
    this.peerConnections = new Map();
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.minecraft = minecraft;
    this.onTrackReceived = onTrackReceived;
    this.ws = null;
    this.currentGamertag = "";
  }

  setWebSocket(ws) {
    this.ws = ws;
  }

  setGamertag(gamertag) {
    this.currentGamertag = gamertag;
  }

  async createPeerConnection(remoteGamertag) {
    if (this.peerConnections.has(remoteGamertag)) {
      console.log(`⚠️ Already exists connection with ${remoteGamertag}`);
      return this.peerConnections.get(remoteGamertag);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }, // NUEVO: Servidor STUN adicional
      ],
    });

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: "ice-candidate",
            candidate: e.candidate,
            from: this.currentGamertag,
            to: remoteGamertag,
          })
        );
      }
    };

    // Bandera para controlar renegociación
    pc._isInitialConnection = true;
    pc._reconnectAttempts = 0;

    // Manejo de renegociación - SOLO cuando la conexión ya está establecida
    pc.onnegotiationneeded = async () => {
      // Ignorar durante la conexión inicial
      if (pc._isInitialConnection) {
        console.log(
          `⏳ Skipping renegotiation with ${remoteGamertag} (initial connection in progress)`
        );
        return;
      }

      console.log(`🔄 Renegotiation needed with ${remoteGamertag}`);
      try {
        if (pc.signalingState !== "stable") {
          console.log(
            `⚠️ Signaling state is ${pc.signalingState}, skipping renegotiation`
          );
          return;
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "offer",
              offer: offer,
              from: this.currentGamertag,
              to: remoteGamertag,
            })
          );
          console.log(`✓ Renegotiation offer sent to ${remoteGamertag}`);
        }
      } catch (e) {
        console.error(`❌ Renegotiation failed with ${remoteGamertag}:`, e);
      }
    };

    // Audio entrante
    pc.ontrack = (event) => {
      console.log(`🎵 ${remoteGamertag} connected`);

      const remoteStream = event.streams[0];

      // Crear elemento de audio
      const audioElement = document.createElement("audio");
      audioElement.srcObject = remoteStream;
      audioElement.autoplay = true;
      audioElement.volume = 0; // Empezar silenciado
      audioElement.id = `audio-${remoteGamertag}`;
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);

      // Forzar reproducción
      audioElement.play().catch((err) => {
        console.warn(`⚠️ Autoplay blocked for ${remoteGamertag}`);
      });

      // Asignar al participante INMEDIATAMENTE
      const participant = this.participantsManager.get(remoteGamertag);
      if (participant) {
        participant.setAudioNodes(null, audioElement, null);
        participant.updateVolume(0); // Empezar muted, Minecraft actualizará

        // Forzar actualización después de medio segundo
        setTimeout(() => {
          if (this.minecraft && this.minecraft.isInGame()) {
            this.minecraft.processUpdate();
          }
        }, 500);
      } else {
        this.participantsManager.addPendingNode(remoteGamertag, {
          gainNode: null,
          audioElement,
          source: null,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(
        `🔌 ${remoteGamertag} - Connection state: ${pc.connectionState}`
      );

      if (pc.connectionState === "disconnected") {
        console.log(`🔌 ${remoteGamertag} disconnected`);
      }

      if (pc.connectionState === "failed") {
        console.log(
          `❌ ${remoteGamertag} connection failed - attempting reconnection...`
        );
        this.attemptReconnect(remoteGamertag);
      }

      if (pc.connectionState === "connected") {
        console.log(`✅ ${remoteGamertag} - Connection fully established`);
        pc._isInitialConnection = false;
        pc._reconnectAttempts = 0;

        setTimeout(() => {
          if (this.minecraft && this.minecraft.isInGame()) {
            this.minecraft.processUpdate();
          }
        }, 500);
      }
    };

    // MEJORADO: Manejo de estado ICE con restart automático
    pc.oniceconnectionstatechange = () => {
      console.log(`❄️ ${remoteGamertag} - ICE: ${pc.iceConnectionState}`);

      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        console.log(
          `✅ ${remoteGamertag} - ICE connection established successfully`
        );
        setTimeout(() => {
          if (this.minecraft && this.minecraft.isInGame()) {
            this.minecraft.processUpdate();
          }
        }, 500);
      }

      if (pc.iceConnectionState === "failed") {
        console.log(`❌ ${remoteGamertag} - ICE failed, attempting restart`);
        pc.restartIce();
      }
    };

    // Añadir audio local
    const processedStream = this.audioEffects.getProcessedStream();
    if (processedStream) {
      processedStream.getTracks().forEach((track) => {
        pc.addTrack(track, processedStream);
      });
    }

    this.peerConnections.set(remoteGamertag, pc);
    console.log(`🔗 ${remoteGamertag} connecting...`);

    return pc;
  }

  async attemptReconnect(remoteGamertag) {
    const oldPc = this.peerConnections.get(remoteGamertag);
    const attempts = (oldPc?._reconnectAttempts || 0) + 1;

    if (attempts > 3) {
      console.log(
        `❌ ${remoteGamertag} - Max reconnection attempts reached (3)`
      );
      return;
    }

    console.log(`🔄 ${remoteGamertag} - Reconnection attempt ${attempts}/3`);

    this.closePeerConnection(remoteGamertag);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      const pc = await this.createPeerConnection(remoteGamertag);
      pc._reconnectAttempts = attempts;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: "offer",
            offer: offer,
            from: this.currentGamertag,
            to: remoteGamertag,
          })
        );
      }
    } catch (e) {
      console.error(`❌ Reconnection failed with ${remoteGamertag}:`, e);
    }
  }

  async reconnectAllPeers() {
    console.log("🔄 RECONNECTING ALL PEERS...");

    const gamertags = Array.from(this.peerConnections.keys());

    if (gamertags.length === 0) {
      console.log("✓ No peers to reconnect");
      return;
    }

    console.log(`📋 Peers to reconnect: ${gamertags.join(", ")}`);

    this.closeAllConnections();
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const gamertag of gamertags) {
      try {
        console.log(`🔗 Reconnecting with ${gamertag}...`);
        const pc = await this.createPeerConnection(gamertag);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "offer",
              offer: offer,
              from: this.currentGamertag,
              to: gamertag,
            })
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (e) {
        console.error(`❌ Failed to reconnect with ${gamertag}:`, e);
      }
    }

    console.log("✅ Reconnection process complete");
  }

  closePeerConnection(gamertag) {
    const pc = this.peerConnections.get(gamertag);
    if (pc) {
      pc.close();
      this.peerConnections.delete(gamertag);
      console.log(`🔌 Connection closed with ${gamertag}`);
    }
  }

  closeAllConnections() {
    this.peerConnections.forEach((pc, gamertag) => {
      this.closePeerConnection(gamertag);
    });
  }

  getPeerConnection(gamertag) {
    return this.peerConnections.get(gamertag);
  }

  forEach(callback) {
    this.peerConnections.forEach(callback);
  }

  // NUEVO: Actualizar el stream de micrófono en todas las conexiones activas
  async updateMicrophoneStream(newStream) {
    console.log("🔄 Updating microphone stream in all peer connections...");
    
    if (!newStream) {
      console.error("❌ No new stream provided");
      return;
    }

    const audioTrack = newStream.getAudioTracks()[0];
    if (!audioTrack) {
      console.error("❌ No audio track in new stream");
      return;
    }

    // Actualizar el track en todas las conexiones activas
    this.peerConnections.forEach((pc, gamertag) => {
      const senders = pc.getSenders();
      const audioSender = senders.find(sender => sender.track?.kind === 'audio');
      
      if (audioSender) {
        audioSender.replaceTrack(audioTrack)
          .then(() => {
            console.log(`✓ Updated audio track for ${gamertag}`);
          })
          .catch((error) => {
            console.error(`❌ Error updating track for ${gamertag}:`, error);
          });
      }
    });

    console.log("✓ Microphone stream updated in all connections");
  }
}

// =====================================================
// CLASE: DistanceCalculator
// Calcula distancias y volumen basado en posición 3D
// =====================================================
class DistanceCalculator {
  constructor(maxDistance = 20) {
    this.maxDistance = maxDistance;
  }

  calculate(pos1, pos2) {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  volumeFromDistance(distance) {
    if (distance > this.maxDistance) return 0;
    return Math.pow(1 - distance / this.maxDistance, 2);
  }
}

// =====================================================
// CLASE: MinecraftIntegration
// Maneja la integración con Minecraft
// =====================================================
class MinecraftIntegration {
  constructor(
    participantsManager,
    audioEffects,
    micManager,
    distanceCalculator,
    webrtcManager
  ) {
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.micManager = micManager;
    this.distanceCalculator = distanceCalculator;
    this.webrtcManager = webrtcManager;
    this.minecraftData = null;
    this.currentGamertag = "";
    this.isPlayerInGame = false;
    this.remoteMuted = false;
    this.remoteDeafened = false;
    this.onMuteChange = null;
    this.onDeafenChange = null;
    this.playerVolumes = new Map();
    this.pushToTalkManager = null;
    this.lastMicVolume = null;
    this.lastEffectChange = 0;
    this.effectThrottleMs = 1000;
  }

  // NUEVO: Establecer referencia al PTT manager
  setPushToTalkManager(pttManager) {
    this.pushToTalkManager = pttManager;
  }

  setGamertag(gamertag) {
    this.currentGamertag = gamertag;
  }

  setOnMuteChange(callback) {
    this.onMuteChange = callback;
  }

  setOnDeafenChange(callback) {
    this.onDeafenChange = callback;
  }

  updateData(data) {
    this.minecraftData = data;
    this.processUpdate();
  }

  processUpdate() {
    if (!this.minecraftData || !this.currentGamertag) return;

    const playersList = Array.isArray(this.minecraftData)
      ? this.minecraftData
      : this.minecraftData.players;

    // Actualizar distancia máxima si viene en la config
    if (this.minecraftData.config && this.minecraftData.config.maxDistance) {
      const newMaxDistance = this.minecraftData.config.maxDistance;
      if (this.distanceCalculator.maxDistance !== newMaxDistance) {
        console.log(
          `📏 Max distance updated: ${this.distanceCalculator.maxDistance} → ${newMaxDistance}`
        );
        this.distanceCalculator.maxDistance = newMaxDistance;
      }
    }

    const myPlayer = playersList.find(
      (p) =>
        p.name.trim().toLowerCase() ===
        this.currentGamertag.trim().toLowerCase()
    );

    const wasInGame = this.isPlayerInGame;
    this.isPlayerInGame = !!myPlayer;

    if (!myPlayer) {
      this.handlePlayerNotInGame(wasInGame);
      return;
    }

    if (!wasInGame) {
      console.log("✓ Connected to Minecraft server");
    }

    // Manejar mute desde Minecraft
    const remoteMutedNow = myPlayer.data.isMuted || false;
    if (remoteMutedNow !== this.remoteMuted) {
      this.remoteMuted = remoteMutedNow;
      console.log(
        `🎤 Remote mute changed: ${this.remoteMuted ? "MUTED" : "UNMUTED"}`
      );

      if (this.onMuteChange) {
        this.onMuteChange(this.remoteMuted);
      }
    }

    // Manejar deafen desde Minecraft
    const remoteDeafenedNow = myPlayer.data.isDeafened || false;
    if (remoteDeafenedNow !== this.remoteDeafened) {
      this.remoteDeafened = remoteDeafenedNow;
      console.log(
        `🔇 Remote deafen changed: ${
          this.remoteDeafened ? "DEAFENED" : "UNDEAFENED"
        }`
      );

      if (this.onDeafenChange) {
        this.onDeafenChange(this.remoteDeafened);
      }
    }

    // MEJORADO: Aplicar volumen del micrófono solo si cambió
    if (
      myPlayer.data.micVolume !== undefined &&
      myPlayer.data.micVolume !== this.lastMicVolume
    ) {
      const micVolume = myPlayer.data.micVolume;
      this.lastMicVolume = micVolume;
      this.audioEffects.updateVolume(
        micVolume,
        this.webrtcManager?.peerConnections
      );
      console.log(
        `🎚️ Microphone volume updated: ${(micVolume * 100).toFixed(0)}%`
      );
    }

    // Aplicar volúmenes personalizados a los participantes
    if (myPlayer.data.customVolumes) {
      this.applyCustomVolumes(myPlayer.data.customVolumes);
    }

    // MEJORADO: Considerar Push-to-Talk al aplicar estado de mute
    const shouldBeMuted = this.micManager.isMicMuted() || this.remoteMuted;

    // Si PTT está activo, el micrófono está COMPLETAMENTE controlado por PTT
    // Minecraft NO debe interferir con el estado del micrófono
    if (!this.pushToTalkManager || !this.pushToTalkManager.isEnabled()) {
      // PTT no está activo - Minecraft controla el mute normalmente
      this.micManager.setEnabled(!shouldBeMuted);
    }
    // Si PTT está activo, NO hacemos nada aquí
    // PTT maneja todo el control de mute/unmute a través de las teclas

    this.applyEnvironmentalEffects(myPlayer);
    this.updateParticipantVolumes(myPlayer, playersList);
  }

  // NUEVO: Aplicar volúmenes personalizados a cada participante
  applyCustomVolumes(customVolumes) {
    this.participantsManager.forEach((participant, gamertag) => {
      if (participant.isSelf) return;

      // Buscar el volumen personalizado para este jugador
      const customVolume = customVolumes[gamertag];
      if (customVolume !== undefined) {
        participant.setCustomVolume(customVolume);
      }
    });
  }

  handlePlayerNotInGame(wasInGame) {
    if (wasInGame) console.log("❌ Disconnected from Minecraft server");

    this.micManager.setEnabled(false);

    // Silenciar a todos
    this.participantsManager.forEach((participant) => {
      if (!participant.isSelf) {
        participant.updateVolume(0);
      }
    });
  }

  applyEnvironmentalEffects(myPlayer) {
    const now = Date.now();
    if (now - this.lastEffectChange < this.effectThrottleMs) {
      return;
    }
    this.lastEffectChange = now;
    let targetEffect = "none";

    if (myPlayer.data.isUnderWater) targetEffect = "underwater";
    else if (myPlayer.data.isInCave) targetEffect = "cave";
    else if (myPlayer.data.isInMountain) targetEffect = "mountain";
    else if (myPlayer.data.isBuried) targetEffect = "buried";

    if (targetEffect !== this.audioEffects.getCurrentEffect()) {
      // ARREGLADO: Pasar las peer connections correctamente
      const peerConnections = this.webrtcManager?.peerConnections;
      this.audioEffects.applyEffect(targetEffect, peerConnections);
    }
  }

  updateParticipantVolumes(myPlayer, playersList) {
    this.participantsManager.forEach((participant, gamertag) => {
      if (participant.isSelf) return;

      const otherPlayer = playersList.find(
        (pl) => pl.name.trim().toLowerCase() === gamertag.trim().toLowerCase()
      );

      if (otherPlayer) {
        // Si el otro jugador está muteado, volumen = 0
        if (otherPlayer.data.isMuted) {
          participant.updateDistance(0);
          participant.updateVolume(0);
          return;
        }

        // Si YO estoy ensordecido, no escucho a nadie
        if (this.remoteDeafened) {
          participant.updateVolume(0);
          return;
        }

        const distance = this.distanceCalculator.calculate(
          myPlayer.location,
          otherPlayer.location
        );
        const volume = this.distanceCalculator.volumeFromDistance(distance);

        participant.updateDistance(distance);
        participant.updateVolume(volume);
      } else {
        participant.updateVolume(0);
      }
    });
  }

  isInGame() {
    return this.isPlayerInGame;
  }

  isRemoteMuted() {
    return this.remoteMuted;
  }

  // NUEVO: Verificar si está ensordecido remotamente
  isRemoteDeafened() {
    return this.remoteDeafened;
  }
}

// =====================================================
// CLASE: UIManager
// Maneja toda la interfaz de usuario
// =====================================================
class UIManager {
  constructor() {
    this.elements = {
      gamertagInput: document.getElementById("gamertagInput"),
      gamertagStatus: document.getElementById("gamertagStatus"),
      roomUrlInput: document.getElementById("roomUrlInput"),
      connectBtn: document.getElementById("connectToRoomBtn"),
      roomInfo: document.getElementById("roomInfo"),
      callControls: document.getElementById("callControls"),
      exitBtn: document.getElementById("exitBtn"),
      participantsList: document.getElementById("participantsList"),
      setupSection: document.getElementById("setupSection"),
      gameStatus: document.getElementById("gameStatus"),
      minecraftConnectContainer: document.createElement("div"),
      // NUEVO: Elementos de Push-to-Talk
      pttContainer: document.getElementById("pttContainer"),
      pttToggle: document.getElementById("pttToggle"),
      pttKeySelector: document.getElementById("pttKeySelector"),
      pttKeyInput: document.getElementById("pttKeyInput"),
      pttKeyDisplay: document.getElementById("pttKeyDisplay"),
      // NUEVO: Selector de micrófono
      micSelector: document.getElementById("micSelector"),
    };

    this.elements.minecraftConnectContainer.id = "minecraftConnectContainer";
    this.elements.gameStatus?.parentNode.insertBefore(
      this.elements.minecraftConnectContainer,
      this.elements.gameStatus.nextSibling
    );

    // NUEVO: Detectar si es PC (tiene teclado físico)
    this.isPC = this.detectPC();
    if (this.isPC && this.elements.pttContainer) {
      this.elements.pttContainer.style.display = "block";
    }
  }

  // NUEVO: Detectar si el usuario está en PC
  detectPC() {
    // Detectar por touch capability y tipo de dispositivo
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile =
      /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        userAgent
      );

    // Es PC si NO es táctil o NO es móvil
    return !isTouchDevice || !isMobile;
  }

  updateGamertagStatus(gamertag) {
    this.elements.gamertagStatus.textContent = gamertag
      ? `✓ Gamertag: ${gamertag}`
      : "⚠️ Enter your gamertag to continue";
    this.elements.gamertagStatus.style.color = gamertag ? "#22c55e" : "#ef4444";
  }

  updateRoomInfo(message) {
    this.elements.roomInfo.textContent = message;
  }

  showCallControls(show) {
    this.elements.setupSection.style.display = show ? "none" : "block";
    this.elements.callControls.style.display = show ? "flex" : "none";
  }

  updateGameStatus(isInGame) {
    if (!this.elements.gameStatus) return;

    if (isInGame) {
      this.elements.gameStatus.innerHTML =
        '<span style="color:#22c55e;">✓ Connected to Minecraft server</span>';
      this.clearMinecraftConnectUI();
    } else {
      this.elements.gameStatus.innerHTML =
        '<span style="color:#ef4444;">⚠️ Not connected to Minecraft server</span>';
      this.showMinecraftConnectUI();
    }
  }

  showMinecraftConnectUI() {
    const container = this.elements.minecraftConnectContainer;

    let infoText = document.getElementById("mcInfoText");
    if (!infoText) {
      infoText = document.createElement("p");
      infoText.id = "mcInfoText";
      infoText.textContent =
        "Haven't joined the server yet? Enter the IP and port here and we'll connect you!";
      infoText.style.marginBottom = "8px";
      container.appendChild(infoText);
    }

    let input = document.getElementById("mcServerInput");
    if (!input) {
      input = document.createElement("input");
      input.type = "text";
      input.id = "mcServerInput";
      input.placeholder = "hive.net:19132";
      input.className = "input-field";
      input.style.marginRight = "10px";
      container.appendChild(input);
    }

    const updateButton = () => {
      const existingBtn = document.getElementById("mcConnectBtn");
      if (input.value.trim() && !existingBtn) {
        const btn = document.createElement("button");
        btn.id = "mcConnectBtn";
        btn.className = "primary-btn";
        btn.textContent = "Connect to MC Server";
        btn.addEventListener("click", () => {
          const [ip, port] = input.value.split(":");
          if (!ip || !port) {
            alert("⚠️ Invalid format. Use IP:PORT");
            return;
          }
          window.location.href = `minecraft://connect?serverUrl=${ip}&serverPort=${port}`;
        });
        container.appendChild(btn);
      } else if (!input.value.trim()) {
        const existingBtn = document.getElementById("mcConnectBtn");
        if (existingBtn) existingBtn.remove();
      }
    };

    input.removeEventListener("input", updateButton);
    input.addEventListener("input", updateButton);
  }

  clearMinecraftConnectUI() {
    const container = this.elements.minecraftConnectContainer;
    container.innerHTML = "";
  }

  updateParticipantsList(participants) {
    this.elements.participantsList.innerHTML = "";

    participants.forEach((p) => {
      const info = p.getDisplayInfo();
      const div = document.createElement("div");
      div.className = "participant";

      const distanceText = info.isSelf ? "" : ` - ${info.distance}m`;
      const volumeIcon =
        info.volume === 0 ? "🔇" : info.volume < 0.3 ? "🔉" : "🔊";

      div.innerHTML = `
        <img 
          src="${info.skinUrl}" 
          alt="${info.gamertag}" 
          class="participant-skin"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"
        />
        <span class="participant-icon" style="display:none;">👤</span>
        <span class="participant-name">${info.gamertag}${
        info.isSelf ? " (You)" : ""
      }${distanceText}</span>
        ${
          !info.isSelf
            ? `<span class="volume-indicator">${volumeIcon}</span>`
            : ""
        }
      `;

      this.elements.participantsList.appendChild(div);
    });
  }

  getGamertag() {
    return this.elements.gamertagInput.value.trim();
  }

  getRoomUrl() {
    return this.elements.roomUrlInput.value.trim();
  }


  // NUEVO: Poblar el selector de micrófonos
  async populateMicrophoneSelector() {
    if (!this.elements.micSelector) {
      console.error("❌ Mic selector element not found");
      return;
    }

    try {
      // IMPORTANTE: Solicitar permisos de micrófono primero si no los tenemos
      // Esto asegura que enumerateDevices() devuelva los labels reales
      try {
        // Pedir un stream temporal solo para asegurar que tenemos permisos
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Detenerlo inmediatamente, solo lo necesitábamos para los permisos
        tempStream.getTracks().forEach(track => track.stop());
        console.log("✓ Microphone permissions confirmed");
      } catch (permError) {
        console.warn("⚠️ Could not get temporary mic access:", permError);
      }
      
      // Ahora sí, enumerar dispositivos - deberían tener labels
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      console.log(`🎤 Found ${audioInputs.length} audio input devices:`);
      audioInputs.forEach((device, index) => {
        console.log(`  [${index}] ${device.label || 'Unnamed'} (${device.deviceId.substring(0, 20)}...)`);
      });
      
      this.elements.micSelector.innerHTML = '';

      if (audioInputs.length === 0) {
        this.elements.micSelector.innerHTML = '<option value="">No microphones found</option>';
        this.elements.micSelector.disabled = true;
        return;
      }

      // Agregar una opción para cada dispositivo
      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        
        // Usar el label del dispositivo o un nombre genérico
        let label = device.label || `Microphone ${index + 1}`;
        
        // Si el label es muy largo, truncarlo
        if (label.length > 50) {
          label = label.substring(0, 47) + '...';
        }
        
        option.textContent = label;
        
        // Marcar como seleccionado el dispositivo "default" o el primero
        if (device.deviceId === 'default' || index === 0) {
          option.selected = true;
        }
        
        this.elements.micSelector.appendChild(option);
      });

      this.elements.micSelector.disabled = false;
      console.log(`✓ Loaded ${audioInputs.length} microphones into selector`);
      
      // Si solo hay un micrófono, mostrar mensaje informativo
      if (audioInputs.length === 1) {
        console.log(`ℹ️ Only one microphone detected. If you have multiple microphones, make sure they are connected and recognized by your system.`);
      }
    } catch (error) {
      console.error("❌ Error populating microphone selector:", error);
      this.elements.micSelector.innerHTML = '<option value="">Error loading microphones</option>';
      this.elements.micSelector.disabled = true;
    }
  }
  isPCDevice() {
    return this.isPC;
  }
}

// =====================================================
// CLASE PRINCIPAL: VoiceChatApp
// Coordina todos los componentes
// =====================================================
class VoiceChatApp {
  constructor() {
    this.ui = new UIManager();
    this.audioEffects = new AudioEffectsManager();
    this.micManager = new MicrophoneManager(this.audioEffects);
    this.participantsManager = new ParticipantsManager();
    this.distanceCalculator = new DistanceCalculator(20);
    this.voiceDetector = null;
    this.webrtc = new WebRTCManager(
      this.participantsManager,
      this.audioEffects,
      null,
      (participant) => this.onTrackReceived(participant)
    );
    this.pushToTalk = new PushToTalkManager(this.micManager, this.webrtc); // NUEVO: pasar webrtc
    this.minecraft = new MinecraftIntegration(
      this.participantsManager,
      this.audioEffects,
      this.micManager,
      this.distanceCalculator,
      this.webrtc
    );

    this.webrtc.minecraft = this.minecraft;
    this.minecraft.setPushToTalkManager(this.pushToTalk);

    // Callbacks para mute y deafen
    this.minecraft.setOnMuteChange((isMuted) => {
      console.log(
        `🎮 Minecraft mute changed: ${isMuted ? "MUTED" : "UNMUTED"}`
      );
      this.updateUI();
    });

    this.minecraft.setOnDeafenChange((isDeafened) => {
      console.log(
        `🎮 Minecraft deafen changed: ${isDeafened ? "DEAFENED" : "UNDEAFENED"}`
      );
      this.updateUI();
    });

    // NUEVO: Callback para cambios de Push-to-Talk
    this.pushToTalk.setOnTalkingChange((isTalking) => {
      // Notificar al servidor sobre el estado de habla
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: "ptt-status",
            gamertag: this.currentGamertag,
            isTalking: isTalking,
            isMuted: !isTalking, // Si NO está hablando, está muteado
          })
        );

        console.log(`📡 PTT status sent: ${isTalking ? "TALKING" : "MUTED"}`);
      }
    });

    this.ws = null;
    this.currentGamertag = "";
    this.heartbeatInterval = null;
  }

  async init() {
    // NUEVO: Validar HTTPS (requerido para getUserMedia en móviles)
    this.checkHTTPS();

    await this.audioEffects.init();
    this.setupEventListeners();
    this.setupPushToTalk();
    console.log("✓ EnviroVoice initialized");
  }

  // NUEVO: Verificar si estamos en HTTPS
  checkHTTPS() {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "";

    const isHTTPS = window.location.protocol === "https:";

    if (!isHTTPS && !isLocalhost) {
      console.warn(
        "⚠️ Not using HTTPS - Microphone may not work on mobile devices"
      );

      // Mostrar advertencia en la UI
      const warning = document.createElement("div");
      warning.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #f59e0b;
        color: white;
        padding: 12px;
        text-align: center;
        font-size: 0.9rem;
        z-index: 9999;
        font-weight: 600;
      `;
      warning.innerHTML =
        "⚠️ Warning: Not using HTTPS. Microphone may not work on mobile devices.";
      document.body.prepend(warning);
    }
  }

  setupEventListeners() {
    this.ui.elements.gamertagInput.addEventListener("input", (e) => {
      this.currentGamertag = e.target.value.trim();
      this.ui.updateGamertagStatus(this.currentGamertag);
    });

    this.ui.elements.connectBtn.addEventListener("click", async () => {
      if (Tone.context.state !== "running") {
        await Tone.start();
        console.log("✓ AudioContext activated");
      }
      this.connectToRoom();
    });

    this.ui.elements.exitBtn.addEventListener("click", () => this.exitCall());
  }

  // NUEVO: Configurar Push-to-Talk
  setupPushToTalk() {
    if (!this.ui.isPCDevice()) {
      console.log("📱 Mobile device detected - Push-to-Talk disabled");
      return;
    }

    let isListeningForKey = false;
    let keyListener = null;

    // Toggle de PTT
    this.ui.elements.pttToggle.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      this.pushToTalk.setEnabled(enabled);

      console.log("🎮 PTT Toggle:", enabled);
      console.log(
        "🎮 pttKeySelector element:",
        this.ui.elements.pttKeySelector
      );

      if (this.ui.elements.pttKeySelector) {
        this.ui.elements.pttKeySelector.style.display = enabled
          ? "flex"
          : "none";
        console.log("✓ Selector display set to:", enabled ? "flex" : "none");
      } else {
        console.error("❌ pttKeySelector element not found!");
      }

      // Enviar estado inmediatamente cuando cambia el toggle
      if (this.ws && this.ws.readyState === 1) {
        const isTalking = enabled ? false : true;
        const isMuted = enabled ? true : false;

        this.ws.send(
          JSON.stringify({
            type: "ptt-status",
            gamertag: this.currentGamertag,
            isTalking: isTalking,
            isMuted: isMuted,
          })
        );

        console.log(
          `📡 PTT toggle changed: ${
            enabled ? "ENABLED (muted)" : "DISABLED (talking)"
          }`
        );
      }
    });

    // Selector de tecla
    this.ui.elements.pttKeyInput.addEventListener("click", () => {
      if (isListeningForKey) return; // Ya está escuchando

      isListeningForKey = true;
      this.ui.elements.pttKeyInput.classList.add("listening");
      this.ui.elements.pttKeyInput.textContent = "Press any key...";
      this.ui.elements.pttKeyDisplay.textContent = "Listening...";

      // Remover listener anterior si existe
      if (keyListener) {
        document.removeEventListener("keydown", keyListener);
      }

      // Crear nuevo listener
      keyListener = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const key = e.code;
        const display = this.getKeyDisplay(e);

        this.pushToTalk.setKey(key, display);
        this.ui.elements.pttKeyInput.textContent = display;
        this.ui.elements.pttKeyDisplay.textContent = `Press and hold ${display} to talk`;
        this.ui.elements.pttKeyInput.classList.remove("listening");

        // Limpiar
        document.removeEventListener("keydown", keyListener);
        keyListener = null;
        isListeningForKey = false;
      };

      document.addEventListener("keydown", keyListener);
    });

    // Event listeners para keydown/keyup (PTT funcional)
    document.addEventListener("keydown", (e) => {
      // No procesar si estamos seleccionando una tecla
      if (isListeningForKey) return;
      this.pushToTalk.handleKeyDown(e);
    });

    document.addEventListener("keyup", (e) => {
      // No procesar si estamos seleccionando una tecla
      if (isListeningForKey) return;
      this.pushToTalk.handleKeyUp(e);
    });

    console.log("✓ Push-to-Talk initialized");
  }

  // NUEVO: Obtener nombre legible de la tecla
  getKeyDisplay(event) {
    if (event.key.length === 1) return event.key.toUpperCase();

    const keyMap = {
      Space: "SPACE",
      ShiftLeft: "LEFT SHIFT",
      ShiftRight: "RIGHT SHIFT",
      ControlLeft: "LEFT CTRL",
      ControlRight: "RIGHT CTRL",
      AltLeft: "LEFT ALT",
      AltRight: "RIGHT ALT",
      Tab: "TAB",
      CapsLock: "CAPS LOCK",
      Enter: "ENTER",
      Backspace: "BACKSPACE",
    };

    return keyMap[event.code] || event.code;
  }

  async connectToRoom() {
    const url = this.ui.getRoomUrl();

    if (!this.currentGamertag) {
      alert("⚠️ Enter your gamertag to continue");
      return;
    }
    if (!url) {
      alert("⚠️ Enter a valid room URL");
      return;
    }

    try {
      this.ui.updateRoomInfo("Connecting to server...");

      this.webrtc.closeAllConnections();
      if (this.ws) this.ws.close();

      // MEJORADO: Mejor manejo de errores al iniciar el micrófono
      try {
        await this.micManager.start(1.0);
      } catch (micError) {
        console.error("Microphone error:", micError);
        let userMessage = "❌ Could not access microphone.\n\n";

        if (micError.message.includes("doesn't support")) {
          userMessage += "Your browser doesn't support microphone access.\n\n";
          userMessage += "Solutions:\n";
          userMessage += "• Make sure you're using HTTPS (https://...)\n";
          userMessage += "• Try using Chrome, Firefox, or Safari\n";
          userMessage += "• If on iPhone/iPad, use Safari (not Chrome)";
        } else if (micError.message.includes("Permission denied")) {
          userMessage += "Microphone permission was denied.\n\n";
          userMessage += "Solutions:\n";
          userMessage += "• Click the 🔒 icon in the address bar\n";
          userMessage += "• Allow microphone access\n";
          userMessage += "• Reload the page and try again";
        } else {
          userMessage += micError.message;
        }

        alert(userMessage);
        this.ui.updateRoomInfo("❌ Microphone error - Check permissions");
        return;
      }

      // Inicializar Voice Detector
      const micStream = this.micManager.getStream();
      if (micStream) {
        this.voiceDetector = new VoiceDetector(micStream, (isTalking, volumeDb) => {
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
              type: "voice-detection",
              gamertag: this.currentGamertag,
              isTalking: isTalking,
              volume: volumeDb
            }));
          }
        });
        
        this.voiceDetector.setSensitivity('high');
      }

      this.webrtc.setGamertag(this.currentGamertag);
      this.minecraft.setGamertag(this.currentGamertag);

      this.ws = new WebSocket(url.replace("http", "ws"));
      this.webrtc.setWebSocket(this.ws);

      this.ws.onopen = () => this.onWebSocketOpen();
      this.ws.onmessage = (msg) => this.onWebSocketMessage(msg);
      this.ws.onerror = () => this.onWebSocketError();
      this.ws.onclose = () => this.exitCall();
    } catch (e) {
      console.error("Connection error:", e);
      alert("Error connecting to server: " + e.message);
      this.ui.updateRoomInfo("❌ Connection error");
    }
  }

  async onWebSocketOpen() {
    this.ui.updateRoomInfo("✅ Connected to voice chat");

    this.ws.send(
      JSON.stringify({ type: "join", gamertag: this.currentGamertag })
    );
    this.ws.send(JSON.stringify({ type: "request-participants" }));

    // NUEVO: Enviar estado inicial de PTT
    const isPTTEnabled = this.pushToTalk.isEnabled();
    const isTalking = isPTTEnabled ? this.pushToTalk.isSpeaking() : true;
    const isMuted = isPTTEnabled ? !this.pushToTalk.isSpeaking() : false;

    this.ws.send(
      JSON.stringify({
        type: "ptt-status",
        gamertag: this.currentGamertag,
        isTalking: isTalking,
        isMuted: isMuted,
      })
    );

    console.log(
      `📡 Initial PTT state sent: ${isTalking ? "TALKING" : "MUTED"}`
    );

    this.ui.showCallControls(true);
    this.participantsManager.add(this.currentGamertag, true);
    this.updateUI();


    // NUEVO: Cargar lista de micrófonos disponibles
    await this.ui.populateMicrophoneSelector();
    
    // NUEVO: Event listener para cambio de micrófono
    if (this.ui.elements.micSelector) {
      const micChangeHandler = async (e) => {
        const deviceId = e.target.value;
        if (!deviceId) return;
        
        try {
          console.log(`🎤 User selected microphone: ${deviceId}`);
          
          // Cambiar el micrófono
          await this.micManager.changeMicrophone(deviceId);
          
          // Reinicializar el voice detector con el nuevo stream
          if (this.voiceDetector) {
            this.voiceDetector.dispose();
          }
          
          const micStream = this.micManager.getStream();
          if (micStream) {
            this.voiceDetector = new VoiceDetector(micStream, (isTalking, volumeDb) => {
              if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                  type: "voice-detection",
                  gamertag: this.currentGamertag,
                  isTalking: isTalking,
                  volume: volumeDb
                }));
              }
            });
            
            this.voiceDetector.setSensitivity('high');
          }
          
          // Reinicializar WebRTC con el nuevo micrófono
          await this.webrtc.updateMicrophoneStream(micStream);
          
          console.log("✅ Microphone changed successfully");
        } catch (error) {
          console.error("❌ Error changing microphone:", error);
          alert("Error changing microphone: " + error.message);
        }
      };
      
      // Remover listener anterior si existe
      this.ui.elements.micSelector.removeEventListener('change', this.micChangeHandler);
      this.micChangeHandler = micChangeHandler;
      this.ui.elements.micSelector.addEventListener('change', this.micChangeHandler);
    }
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({ type: "heartbeat", gamertag: this.currentGamertag })
        );
      }
    }, 15000);
  }

  async onWebSocketMessage(msg) {
    const data = JSON.parse(msg.data);

    if (data.type === "heartbeat") return;

    if (data.type === "minecraft-update") {
      this.minecraft.updateData(data.data);

      // NUEVO: Procesar estados de mute desde Minecraft
      if (data.muteStates) {
        const myState = data.muteStates.find(
          (s) => s.gamertag === this.currentGamertag
        );

        if (myState) {
          // Actualizar mute si cambió desde Minecraft
          if (myState.isMuted !== this.minecraft.remoteMuted) {
            this.minecraft.remoteMuted = myState.isMuted;
            console.log(
              `🎮 Minecraft mute changed: ${
                myState.isMuted ? "MUTED" : "UNMUTED"
              }`
            );

            // Si PTT NO está activo, aplicar el cambio inmediatamente
            if (!this.pushToTalk || !this.pushToTalk.isEnabled()) {
              this.mic.setEnabled(!myState.isMuted);
            }
          }

          // Actualizar volumen de micrófono si cambió
          if (myState.micVolume !== undefined) {
            const currentVolume = this.audioEffects.inputNode?.gain.value || 1;
            if (Math.abs(currentVolume - myState.micVolume) > 0.01) {
              console.log(
                `🎚️ Minecraft volume changed: ${(
                  myState.micVolume * 100
                ).toFixed(0)}%`
              );
              this.audioEffects.updateVolume(
                myState.micVolume,
                this.webrtc?.peerConnections
              );
            }
          }

          // Actualizar deafen
          if (myState.isDeafened !== this.minecraft.remoteDeafened) {
            this.minecraft.remoteDeafened = myState.isDeafened;
            console.log(
              `🔇 Minecraft deafen changed: ${
                myState.isDeafened ? "DEAFENED" : "UNDEAFENED"
              }`
            );

            // Si está deafened, mutear también
            if (myState.isDeafened) {
              this.minecraft.remoteMuted = true;
              if (!this.pushToTalk || !this.pushToTalk.isEnabled()) {
                this.mic.setEnabled(false);
              }
            }
          }
        }
      }

      this.updateUI();
      return;
    }

    await this.handleSignaling(data);
  }

  async handleSignaling(data) {
    try {
      if (data.type === "join" && data.gamertag !== this.currentGamertag) {
        console.log(`👋 ${data.gamertag} joined the room`);
        this.participantsManager.add(data.gamertag, false);

        if (!this.webrtc.getPeerConnection(data.gamertag)) {
          const pc = await this.webrtc.createPeerConnection(data.gamertag);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          this.ws.send(
            JSON.stringify({
              type: "offer",
              offer: offer,
              from: this.currentGamertag,
              to: data.gamertag,
            })
          );
        }
        this.updateUI();
      } else if (data.type === "leave") {
        console.log(`👋 ${data.gamertag} left the room`);
        this.participantsManager.remove(data.gamertag);
        this.webrtc.closePeerConnection(data.gamertag);

        // Reconectar a todos cuando alguien sale
        console.log(
          "⚡ Triggering full reconnection due to participant leaving"
        );
        await this.webrtc.reconnectAllPeers();

        this.updateUI();
      } else if (data.type === "offer" && data.to === this.currentGamertag) {
        console.log(`📨 Received offer from ${data.from}`);
        this.participantsManager.add(data.from, false);

        const pc = await this.webrtc.createPeerConnection(data.from);

        if (
          pc.signalingState === "stable" ||
          pc.signalingState === "have-local-offer"
        ) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          this.ws.send(
            JSON.stringify({
              type: "answer",
              answer: answer,
              from: this.currentGamertag,
              to: data.from,
            })
          );
          console.log(`📤 Sent answer to ${data.from}`);
        }
        this.updateUI();
      } else if (data.type === "answer" && data.to === this.currentGamertag) {
        console.log(`📨 Received answer from ${data.from}`);
        const pc = this.webrtc.getPeerConnection(data.from);

        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`✓ Answer applied for ${data.from}`);
        }
      } else if (
        data.type === "ice-candidate" &&
        data.to === this.currentGamertag
      ) {
        const pc = this.webrtc.getPeerConnection(data.from);
        if (pc && data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } else if (data.type === "participants-list") {
        console.log(`📋 Received participants list: ${data.list.join(", ")}`);
        data.list.forEach((gt) => {
          if (gt !== this.currentGamertag) {
            this.participantsManager.add(gt, false);
          }
        });
        this.updateUI();
      }
    } catch (e) {
      console.error("Error in signaling:", e);
    }
  }

  onWebSocketError() {
    this.ui.updateRoomInfo("❌ Connection error");
    this.exitCall();
  }

  onTrackReceived(participant) {
    console.log(
      `📍 Audio track received for ${participant.gamertag}, muting until position is received`
    );
    participant.updateVolume(0);
    this.updateUI();
  }

  exitCall() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({ type: "leave", gamertag: this.currentGamertag })
      );
    }

    this.webrtc.closeAllConnections();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.voiceDetector) {
      this.voiceDetector.dispose();
      this.voiceDetector = null;
    }

    this.micManager.stop();
    this.participantsManager.clear();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.ui.showCallControls(false);
    this.ui.updateRoomInfo("");
    this.updateUI();
  }

  updateUI() {
    this.ui.updateGameStatus(this.minecraft.isInGame());
    this.ui.updateParticipantsList(this.participantsManager.getAll());
  }

  // Métodos de debug
  debugAudioState() {
    console.log("=== AUDIO STATE DEBUG ===");
    this.participantsManager.forEach((p, name) => {
      const info = {
        distance: p.distance.toFixed(1),
        volume: p.volume.toFixed(2),
        customVolume: p.customVolume.toFixed(2),
        hasAudioElement: !!p.audioElement,
        audioVolume: p.audioElement?.volume.toFixed(2),
      };
      console.log(`${name}:`, info);
    });

    const audioElements = document.querySelectorAll("audio");
    console.log(`📻 Audio elements in DOM: ${audioElements.length}`);
    audioElements.forEach((el) => {
      console.log(
        `  - ${el.id || "no ID"}: paused=${
          el.paused
        }, volume=${el.volume.toFixed(2)}, srcObject=${!!el.srcObject}`
      );
    });

    console.log("========================");
  }

  testAudioOutput() {
    console.log("🔊 Generating test tone of 440Hz for 2 seconds...");

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.3;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      console.log("✓ Test tone finished");
    }, 2000);
  }

  diagnoseWebRTC() {
    console.log("=== WEBRTC DIAGNOSIS ===");

    this.webrtc.forEach((pc, name) => {
      console.log(`\n👤 ${name}:`);
      console.log(
        `  Estado: ${pc.connectionState} | ICE: ${pc.iceConnectionState}`
      );

      const receivers = pc.getReceivers();
      console.log(`  📥 Receivers: ${receivers.length}`);
      receivers.forEach((receiver, i) => {
        const track = receiver.track;
        if (track) {
          console.log(
            `    [${i}] ${track.kind}: enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`
          );
        }
      });

      const senders = pc.getSenders();
      console.log(`  📤 Senders: ${senders.length}`);
      senders.forEach((sender, i) => {
        const track = sender.track;
        if (track) {
          console.log(
            `    [${i}] ${track.kind}: enabled=${track.enabled}, readyState=${track.readyState}`
          );
        }
      });
    });

    console.log("\n======================");
  }
}

// =====================================================
// INICIALIZACIÓN
// =====================================================
let app;

window.addEventListener("DOMContentLoaded", async () => {
  app = new VoiceChatApp();
  await app.init();

  window.debugAudio = () => app.debugAudioState();
  window.testAudio = () => app.testAudioOutput();
  window.diagnoseWebRTC = () => app.diagnoseWebRTC();
});