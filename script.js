// =====================================================
// CONSTANTES GLOBALES
// =====================================================
const MAX_DISTANCE = 50; // Distancia máxima en bloques para el audio espacial

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
    this.inputNode = null;
    this.processedStream = null;
  }

  async init() {
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 });
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 1200 });
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0.25 });
    await this.reverb.generate();
    console.log("✓ Audio effects initialized");
  }

  createInputNode(micVolume = 1.0) {
    this.inputNode = new Tone.Gain(micVolume);
    return this.inputNode;
  }

  applyEffect(effect, peerConnections) {
    if (!this.inputNode) return;

    // Limpiar efectos anteriores
    this.dynamicNodes.forEach(n => {
      try { n.disconnect(); n.dispose(); } catch (e) {}
    });
    this.dynamicNodes = [];

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const dest = audioContext.createMediaStreamDestination();
    this.inputNode.disconnect();

    switch (effect) {
      case "underwater":
        this.filter.type = "lowpass";
        this.filter.frequency.value = 500;
        this.filter.Q.value = 1;
        this.reverb.decay = 2.8;
        this.reverb.wet.value = 0.5;
        this.inputNode.chain(this.filter, this.reverb, dest);
        break;

      case "cave":
        const caveDelay = new Tone.FeedbackDelay("0.15", 0.35);
        const caveReverb = new Tone.Reverb({ decay: 5, wet: 0.6 });
        const caveEQ = new Tone.EQ3(-2, 0, -1);
        this.dynamicNodes.push(caveDelay, caveReverb, caveEQ);
        this.inputNode.chain(caveEQ, caveReverb, caveDelay, dest);
        break;

      case "mountain":
        const mountainDelay = new Tone.FeedbackDelay("0.4", 0.45);
        const mountainReverb = new Tone.Reverb({ decay: 9, wet: 0.6 });
        const mountainEQ = new Tone.EQ3(-3, 1, -2);
        this.dynamicNodes.push(mountainDelay, mountainReverb, mountainEQ);
        this.inputNode.chain(mountainEQ, mountainReverb, mountainDelay, dest);
        break;

      case "buried":
        const muffled = new Tone.Filter({ type: "lowpass", frequency: 300, Q: 1 });
        const crusher = new Tone.BitCrusher(6);
        const lfo = new Tone.LFO("0.3Hz", 250, 600).start();
        lfo.connect(muffled.frequency);
        const buriedReverb = new Tone.Reverb({ decay: 3, wet: 0.5 });
        const gainNode = new Tone.Gain(0.9);
        this.dynamicNodes.push(muffled, crusher, lfo, buriedReverb, gainNode);
        this.inputNode.chain(crusher, muffled, buriedReverb, gainNode, dest);
        break;

      default:
        this.inputNode.connect(dest);
        break;
    }

    this.processedStream = dest.stream;
    this.currentEffect = effect;

    // CRÍTICO: Actualizar el track en TODAS las conexiones
    if (this.processedStream && peerConnections) {
      const newTrack = this.processedStream.getAudioTracks()[0];
      
      if (!newTrack) {
        console.error("❌ No audio track found in processedStream");
        return;
      }
      
      console.log(`🔄 Changing effect to: ${effect}`);
      
      peerConnections.forEach((pc, gamertag) => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === "audio");
        
        if (audioSender) {
          audioSender.replaceTrack(newTrack)
            .then(() => {
              console.log(`✓ Audio track updated for ${gamertag} (${effect})`);
            })
            .catch(e => {
              console.error(`❌ Error updating audio track for ${gamertag}:`, e);
            });
        } else {
          console.warn(`⚠️ No audio sender found for ${gamertag}`);
        }
      });
    }
  }

  updateVolume(volume) {
    if (this.inputNode) {
      this.inputNode.gain.value = volume;
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
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    const audioContext = Tone.context.rawContext || Tone.context._context;
    
    this.mediaStreamSource = audioContext.createMediaStreamSource(this.mediaStream);
    const inputNode = this.audioEffects.createInputNode(micVolume);

    const dest = audioContext.createMediaStreamDestination();
    this.mediaStreamSource.connect(inputNode.input);
    inputNode.connect(dest);
    
    this.audioEffects.processedStream = dest.stream;
    console.log("✓ Microphone started");
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
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
      this.mediaStream.getAudioTracks().forEach(track => track.enabled = !this.isMuted);
    }
    return this.isMuted;
  }

  setEnabled(enabled) {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => track.enabled = enabled);
    }
  }

  getStream() {
    return this.mediaStream;
  }

  isMicMuted() {
    return this.isMuted;
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
  }

  setAudioNodes(gainNode, audioElement, source) {
    this.gainNode = gainNode;
    this.audioElement = audioElement;
    this.source = source;
  }

  updateVolume(newVolume) {
    this.volume = newVolume;
    
    if (this.gainNode) {
      this.gainNode.gain.value = newVolume;
    } else if (this.audioElement) {
      this.audioElement.volume = newVolume;
    }
  }

  updateDistance(distance) {
    this.distance = distance;
  }

  cleanup() {
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch (e) {}
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
      volume: this.volume
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
    this.participants.forEach(p => p.cleanup());
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
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: e.candidate,
          from: this.currentGamertag,
          to: remoteGamertag
        }));
      }
    };

    // NUEVO: Manejo de renegociación cuando cambian los tracks
    pc.onnegotiationneeded = async () => {
      console.log(`🔄 Renegotiation needed with ${remoteGamertag}`);
      try {
        if (pc.signalingState !== 'stable') {
          console.log(`⚠️ Signaling state is ${pc.signalingState}, skipping renegotiation`);
          return;
        }
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            from: this.currentGamertag,
            to: remoteGamertag
          }));
          console.log(`✓ Renegotiation offer sent to ${remoteGamertag}`);
        }
      } catch (e) {
        console.error(`❌ Renegotiation failed with ${remoteGamertag}:`, e);
      }
    };

    // Audio entrante - SOLUCIÓN SIMPLIFICADA: Solo usar <audio> element
    pc.ontrack = (event) => {
      console.log(`🎵 ${remoteGamertag} connected`);
      
      const remoteStream = event.streams[0];
      
      // Crear elemento de audio (SIN AudioContext)
      const audioElement = document.createElement('audio');
      audioElement.srcObject = remoteStream;
      audioElement.autoplay = true;
      audioElement.volume = 0; // Empezar silenciado
      audioElement.id = `audio-${remoteGamertag}`;
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);
      
      // Forzar reproducción
      audioElement.play().catch(err => {
        console.warn(`⚠️ Autoplay blocked for ${remoteGamertag}`);
      });
      
      // Asignar al participante INMEDIATAMENTE
      const participant = this.participantsManager.get(remoteGamertag);
      if (participant) {
        participant.setAudioNodes(null, audioElement, null);
        
        // Calcular volumen inicial
        let volume = 0;
        if (participant.distance > 0 && this.minecraft && this.minecraft.isInGame()) {
          volume = participant.distance > MAX_DISTANCE ? 0 : Math.pow(1 - (participant.distance / MAX_DISTANCE), 2);
        }
        
        participant.updateVolume(volume);
        
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
          source: null 
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`🔌 ${remoteGamertag} - Connection state: ${pc.connectionState}`);
      
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.log(`🔌 ${remoteGamertag} disconnected`);
      }
      
      if (pc.connectionState === 'connected') {
        console.log(`✅ ${remoteGamertag} - Connection fully established`);
        // Forzar actualización de volumen
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
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log(`✅ ${remoteGamertag} - ICE connection established successfully`);
        // Forzar actualización de audio después de conexión exitosa
        setTimeout(() => {
          if (this.minecraft && this.minecraft.isInGame()) {
            this.minecraft.processUpdate();
          }
        }, 500);
      }
      
      if (pc.iceConnectionState === 'failed') {
        console.log(`❌ ${remoteGamertag} - ICE failed, attempting restart`);
        pc.restartIce();
      }
    };

    // Añadir audio local
    const processedStream = this.audioEffects.getProcessedStream();
    if (processedStream) {
      processedStream.getTracks().forEach(track => {
        pc.addTrack(track, processedStream);
      });
    }

    this.peerConnections.set(remoteGamertag, pc);
    console.log(`🔗 ${remoteGamertag} connecting...`);
    
    return pc;
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

  // NUEVO: Método para reconectar a todos los peers (solución drástica pero efectiva)
  async reconnectAllPeers() {
    console.log("🔄 RECONNECTING ALL PEERS...");
    
    // Guardar lista de gamertags antes de cerrar conexiones
    const gamertags = Array.from(this.peerConnections.keys());
    
    if (gamertags.length === 0) {
      console.log("✓ No peers to reconnect");
      return;
    }
    
    console.log(`📋 Peers to reconnect: ${gamertags.join(', ')}`);
    
    // Cerrar todas las conexiones
    this.closeAllConnections();
    
    // Esperar un momento para asegurar limpieza
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Reconectar con cada uno
    for (const gamertag of gamertags) {
      try {
        console.log(`🔗 Reconnecting with ${gamertag}...`);
        const pc = await this.createPeerConnection(gamertag);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            from: this.currentGamertag,
            to: gamertag
          }));
        }
        
        // Pequeña pausa entre conexiones para evitar sobrecarga
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (e) {
        console.error(`❌ Failed to reconnect with ${gamertag}:`, e);
      }
    }
    
    console.log("✅ Reconnection process complete");
  }
}

// =====================================================
// CLASE: DistanceCalculator
// Calcula distancias y volumen basado en posición 3D
// =====================================================
class DistanceCalculator {
  constructor(maxDistance = MAX_DISTANCE) {
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
    return Math.pow(1 - (distance / this.maxDistance), 2);
  }
}

// =====================================================
// CLASE: MinecraftIntegration
// Maneja la integración con Minecraft
// =====================================================
class MinecraftIntegration {
  constructor(participantsManager, audioEffects, micManager, distanceCalculator, webrtcManager) {
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.micManager = micManager;
    this.distanceCalculator = distanceCalculator;
    this.webrtcManager = webrtcManager;
    this.minecraftData = null;
    this.currentGamertag = "";
    this.isPlayerInGame = false;
  }

  setGamertag(gamertag) {
    this.currentGamertag = gamertag;
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
      
    const myPlayer = playersList.find(
      p => p.name.trim().toLowerCase() === this.currentGamertag.trim().toLowerCase()
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

    this.micManager.setEnabled(!this.micManager.isMicMuted());
    this.applyEnvironmentalEffects(myPlayer);
    this.updateParticipantVolumes(myPlayer, playersList);
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
    let targetEffect = "none";
    
    if (myPlayer.data.isUnderWater) targetEffect = "underwater";
    else if (myPlayer.data.isInCave) targetEffect = "cave";
    else if (myPlayer.data.isInMountain) targetEffect = "mountain";
    else if (myPlayer.data.isBuried) targetEffect = "buried";

    if (targetEffect !== this.audioEffects.getCurrentEffect()) {
      // CRÍTICO: Pasar las conexiones WebRTC para actualizar los tracks
      this.audioEffects.applyEffect(targetEffect, this.webrtcManager?.peerConnections || null);
    }
  }

  updateParticipantVolumes(myPlayer, playersList) {
    this.participantsManager.forEach((participant, gamertag) => {
      if (participant.isSelf) return;

      const otherPlayer = playersList.find(
        pl => pl.name.trim().toLowerCase() === gamertag.trim().toLowerCase()
      );

      if (otherPlayer) {
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
      muteBtn: document.getElementById("muteBtn"),
      exitBtn: document.getElementById("exitBtn"),
      volumeSlider: document.getElementById("volumeSlider"),
      volumeValue: document.getElementById("volumeValue"),
      participantsList: document.getElementById("participantsList"),
      setupSection: document.getElementById("setupSection"),
      gameStatus: document.getElementById("gameStatus"),
      minecraftConnectContainer: document.createElement("div") // contenedor para input/button
    };

    // Inicializar contenedor para MC connect
    this.elements.minecraftConnectContainer.id = "minecraftConnectContainer";
    this.elements.gameStatus?.parentNode.insertBefore(
      this.elements.minecraftConnectContainer,
      this.elements.gameStatus.nextSibling
    );
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

  updateMuteButton(isMuted, isInGame) {
    if (!isInGame) {
      this.elements.muteBtn.textContent = "🔒 Locked";
      this.elements.muteBtn.className = "control-btn locked";
      this.elements.muteBtn.disabled = true;
    } else {
      this.elements.muteBtn.textContent = isMuted ? "🔇 Unmute" : "🎤 Mute";
      this.elements.muteBtn.className = isMuted ? "control-btn muted" : "control-btn";
      this.elements.muteBtn.disabled = false;
    }
  }

  updateVolumeDisplay(value) {
    this.elements.volumeValue.textContent = `${value}%`;
  }

  updateGameStatus(isInGame) {
    if (!this.elements.gameStatus) return;

    if (isInGame) {
      this.elements.gameStatus.innerHTML = '<span style="color:#22c55e;">✓ Connected to Minecraft server</span>';
      this.clearMinecraftConnectUI();
    } else {
      this.elements.gameStatus.innerHTML = '<span style="color:#ef4444;">⚠️ Not connected to Minecraft server</span>';
      this.showMinecraftConnectUI();
    }
  }

  showMinecraftConnectUI() {
    const container = this.elements.minecraftConnectContainer;

    // Crear texto explicativo solo si no existe
    let infoText = document.getElementById("mcInfoText");
    if (!infoText) {
      infoText = document.createElement("p");
      infoText.id = "mcInfoText";
      infoText.textContent = "Haven't joined the server yet? Enter the IP and port here and we'll connect you!";
      infoText.style.marginBottom = "8px"; // separación del input
      container.appendChild(infoText);
    }

    // Crear input solo si no existe
    let input = document.getElementById("mcServerInput");
    if (!input) {
      input = document.createElement("input");
      input.type = "text";
      input.id = "mcServerInput";
      input.placeholder = "hive.net:19132";
      input.className = "input-field"; // misma clase que tus otros inputs
      input.style.marginRight = "10px";
      container.appendChild(input);
    }

    // Función para actualizar botón
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

    participants.forEach(p => {
      const info = p.getDisplayInfo();
      const div = document.createElement("div");
      div.className = "participant";

      const distanceText = info.isSelf ? '' : ` - ${info.distance}m`;
      const volumeIcon = info.volume === 0 ? '🔇' : info.volume < 0.3 ? '🔉' : '🔊';

      div.innerHTML = `
        <span class="participant-icon">👤</span>
        <span class="participant-name">${info.gamertag}${info.isSelf ? ' (You)' : ''}${distanceText}</span>
        ${!info.isSelf ? `<span class="volume-indicator">${volumeIcon}</span>` : ''}
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

  getVolumeValue() {
    return parseInt(this.elements.volumeSlider.value);
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
    this.webrtc = new WebRTCManager(
      this.participantsManager,
      this.audioEffects,
      null, // minecraft se asigna después
      (participant) => this.onTrackReceived(participant)
    );
    this.minecraft = new MinecraftIntegration(
      this.participantsManager,
      this.audioEffects,
      this.micManager,
      this.distanceCalculator,
      this.webrtc
    );
    
    // Ahora asignar minecraft al webrtc
    this.webrtc.minecraft = this.minecraft;
    
    this.ws = null;
    this.currentGamertag = "";
    this.heartbeatInterval = null;
  }

  async init() {
    await this.audioEffects.init();
    this.setupEventListeners();
    console.log("✓ EnviroVoice initialized");
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

    this.ui.elements.muteBtn.addEventListener("click", () => this.toggleMute());
    this.ui.elements.exitBtn.addEventListener("click", () => this.exitCall());
    this.ui.elements.volumeSlider.addEventListener("input", () => this.updateVolume());
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
      
      // Limpiar conexiones previas
      this.webrtc.closeAllConnections();
      if (this.ws) this.ws.close();

      // Iniciar micrófono
      const volume = this.ui.getVolumeValue() / 100;
      await this.micManager.start(volume);

      // Configurar componentes
      this.webrtc.setGamertag(this.currentGamertag);
      this.minecraft.setGamertag(this.currentGamertag);

      // Conectar WebSocket
      this.ws = new WebSocket(url.replace("http", "ws"));
      this.webrtc.setWebSocket(this.ws);

      this.ws.onopen = () => this.onWebSocketOpen();
      this.ws.onmessage = (msg) => this.onWebSocketMessage(msg);
      this.ws.onerror = () => this.onWebSocketError();
      this.ws.onclose = () => this.exitCall();

    } catch (e) {
      alert("Error connecting to server: " + e.message);
      this.ui.updateRoomInfo("❌ Connection error");
    }
  }

  onWebSocketOpen() {
    this.ui.updateRoomInfo("✅ Connected to voice chat");
    
    this.ws.send(JSON.stringify({ type: 'join', gamertag: this.currentGamertag }));
    this.ws.send(JSON.stringify({ type: 'request-participants' }));

    this.ui.showCallControls(true);
    this.participantsManager.add(this.currentGamertag, true);
    this.updateUI();

    // Heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'heartbeat', gamertag: this.currentGamertag }));
      }
    }, 15000);
  }

  async onWebSocketMessage(msg) {
    const data = JSON.parse(msg.data);
    
    if (data.type === 'heartbeat') return;
    
    if (data.type === 'minecraft-update') {
      this.minecraft.updateData(data.data);
      this.updateUI();
      return;
    }

    await this.handleSignaling(data);
  }

  async handleSignaling(data) {
    try {
      if (data.type === 'join' && data.gamertag !== this.currentGamertag) {
        console.log(`👋 ${data.gamertag} joined the room`);
        this.participantsManager.add(data.gamertag, false);
        
        // Solo crear conexión con el nuevo participante (NO reconectar a todos)
        if (!this.webrtc.getPeerConnection(data.gamertag)) {
          const pc = await this.webrtc.createPeerConnection(data.gamertag);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          this.ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            from: this.currentGamertag,
            to: data.gamertag
          }));
        }
        this.updateUI();
      }
      else if (data.type === 'leave') {
        console.log(`👋 ${data.gamertag} left the room`);
        this.participantsManager.remove(data.gamertag);
        this.webrtc.closePeerConnection(data.gamertag);
        
        // SOLUCIÓN DRÁSTICA: Reconectar a TODOS cuando alguien sale
        console.log("⚡ Triggering full reconnection due to participant leaving");
        await this.webrtc.reconnectAllPeers();
        
        this.updateUI();
      }
      else if (data.type === 'offer' && data.to === this.currentGamertag) {
        console.log(`📨 Received offer from ${data.from}`);
        this.participantsManager.add(data.from, false);
        
        const pc = await this.webrtc.createPeerConnection(data.from);
        
        if (pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          this.ws.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            from: this.currentGamertag,
            to: data.from
          }));
          console.log(`📤 Sent answer to ${data.from}`);
        }
        this.updateUI();
      }
      else if (data.type === 'answer' && data.to === this.currentGamertag) {
        console.log(`📨 Received answer from ${data.from}`);
        const pc = this.webrtc.getPeerConnection(data.from);
        
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`✓ Answer applied for ${data.from}`);
        }
      }
      else if (data.type === 'ice-candidate' && data.to === this.currentGamertag) {
        const pc = this.webrtc.getPeerConnection(data.from);
        if (pc && data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      }
      else if (data.type === 'participants-list') {
        console.log(`📋 Received participants list: ${data.list.join(', ')}`);
        data.list.forEach(gt => {
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

  toggleMute() {
    if (!this.minecraft.isInGame() && !this.micManager.isMicMuted()) {
      alert("⚠️ You must join the Minecraft server before muting.");
      return;
    }

    this.micManager.toggleMute();
    this.updateUI();
  }

  updateVolume() {
    const volume = this.ui.getVolumeValue() / 100;
    this.audioEffects.updateVolume(volume);
    this.ui.updateVolumeDisplay(this.ui.getVolumeValue());
  }

  onTrackReceived(participant) {
    // Callback cuando se recibe un track de audio
    // Inicialmente silenciar hasta que Minecraft envíe las posiciones
    console.log(`📍 Audio track received for ${participant.gamertag}, muting until position is received`);
    participant.updateVolume(0);
    this.updateUI();
  }

  exitCall() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'leave', gamertag: this.currentGamertag }));
    }

    this.webrtc.closeAllConnections();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
    this.ui.updateMuteButton(
      this.micManager.isMicMuted(),
      this.minecraft.isInGame()
    );
    this.ui.updateGameStatus(this.minecraft.isInGame());
    this.ui.updateParticipantsList(this.participantsManager.getAll());
  }

  // Método de debug para verificar el estado del audio
  debugAudioState() {
    console.log("=== AUDIO STATE DEBUG ===");
    this.participantsManager.forEach((p, name) => {
      const info = {
        distance: p.distance.toFixed(1),
        volume: p.volume.toFixed(2),
        hasGainNode: !!p.gainNode,
        hasAudioElement: !!p.audioElement,
        hasSource: !!p.source,
        gainValue: p.gainNode?.gain.value.toFixed(2),
        audioVolume: p.audioElement?.volume.toFixed(2),
        gainConnected: p.gainNode?.numberOfOutputs > 0,
        sourceConnected: p.source?.numberOfOutputs > 0
      };
      console.log(`${name}:`, info);
      
      // Verificación crítica
      if (p.volume > 0 && !p.gainNode && !p.audioElement) {
        console.error(`❌ ${name} should have volume ${p.volume} but NO AUDIO NODES!`);
      }
      if (p.gainNode && Math.abs(p.gainNode.gain.value - p.volume) > 0.01) {
        console.warn(`⚠️ ${name} - Volume sync issue: volume=${p.volume} but gainNode=${p.gainNode.gain.value}`);
      }
    });
    
    // Verificar elementos <audio> sueltos en el DOM
    const audioElements = document.querySelectorAll('audio');
    console.log(`📻 Audio elements in DOM: ${audioElements.length}`);
    audioElements.forEach(el => {
      console.log(`  - ${el.id || 'no ID'}: paused=${el.paused}, volume=${el.volume.toFixed(2)}, srcObject=${!!el.srcObject}`);
    });
    
    console.log("========================");
  }

  // Método de prueba: Generar un tono de prueba
  testAudioOutput() {
    console.log("🔊 Generating test tone of 440Hz for 2 seconds...");
    
    const audioContext = Tone.context.rawContext || Tone.context._context;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = 440; // La (A4)
    gainNode.gain.value = 0.3; // Volumen moderado
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      console.log("✓ Test tone finished");
    }, 2000);
    
    console.log("If you don't hear anything, the problem is your audio system or browser");
  }

  // Diagnóstico de micrófono local
  diagnoseMicrophone() {
    console.log("=== MICROPHONE DIAGNOSIS ===");
    
    const stream = this.micManager.getStream();
    if (!stream) {
      console.error("❌ No microphone stream");
      return;
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    console.log("🎤 Microphone track:");
    console.log("  Enabled:", audioTrack.enabled);
    console.log("  ReadyState:", audioTrack.readyState);
    console.log("  Muted:", audioTrack.muted);
    console.log("  Label:", audioTrack.label);
    
    const processedStream = this.audioEffects.getProcessedStream();
    if (!processedStream) {
      console.error("❌ No processed stream");
      return;
    }
    
    const processedTrack = processedStream.getAudioTracks()[0];
    console.log("\n🔊 Processed Stream:");
    console.log("  Enabled:", processedTrack.enabled);
    console.log("  ReadyState:", processedTrack.readyState);
    console.log("  Muted:", processedTrack.muted);
    
    console.log("\n📡 WebRTC Connections:");
    let hasSenders = false;
    this.webrtc.forEach((pc, name) => {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === "audio");
      
      if (audioSender) {
        hasSenders = true;
        console.log(`  ${name}:`);
        console.log(`    Track enabled: ${audioSender.track.enabled}`);
        console.log(`    Track readyState: ${audioSender.track.readyState}`);
        console.log(`    Track ID: ${audioSender.track.id}`);
      } else {
        console.warn(`  ${name}: ❌ No audio sender`);
      }
    });
    
    if (!hasSenders) {
      console.error("❌ No audio is being sent to anyone");
    }
    
    console.log("\n=================================");
  }
  
  diagnoseWebRTC() {
    console.log("=== WEBRTC DIAGNOSIS ===");
    
    this.webrtc.forEach((pc, name) => {
      console.log(`\n👤 ${name}:`);
      console.log(`  Estado: ${pc.connectionState} | ICE: ${pc.iceConnectionState}`);
      
      // Ver tracks recibidos
      const receivers = pc.getReceivers();
      console.log(`  📥 Receivers: ${receivers.length}`);
      receivers.forEach((receiver, i) => {
        const track = receiver.track;
        if (track) {
          console.log(`    [${i}] ${track.kind}: enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`);
          
          // CRÍTICO: Ver si el track tiene audio
          if (track.kind === 'audio') {
            console.log(`    🎤 Audio track ID: ${track.id}`);
          }
        }
      });
      
      // Ver tracks enviados
      const senders = pc.getSenders();
      console.log(`  📤 Senders: ${senders.length}`);
      senders.forEach((sender, i) => {
        const track = sender.track;
        if (track) {
          console.log(`    [${i}] ${track.kind}: enabled=${track.enabled}, readyState=${track.readyState}`);
        }
      });
      
      // Estadísticas de audio
      if (receivers.length > 0) {
        receivers[0].getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              console.log(`  📊 Inbound Audio Statistics:`);
              console.log(`    Packets received: ${report.packetsReceived}`);
              console.log(`    Bytes received: ${report.bytesReceived}`);
              console.log(`    Packets lost: ${report.packetsLost || 0}`);
              console.log(`    Audio level: ${report.audioLevel || 'N/A'}`);
              
              // CRÍTICO: Si packetsReceived = 0, no está llegando audio
              if (report.packetsReceived === 0) {
                console.error(`    ❌ NO AUDIO PACKETS ARE BEING RECEIVED`);
              }
            }
          });
        });
      }
    });
    
    // Estado del micrófono local
    console.log(`\n🎤 Local Microphone:`);
    const myStream = this.micManager.getStream();
    if (myStream) {
      const audioTrack = myStream.getAudioTracks()[0];
      console.log(`  Enabled: ${audioTrack.enabled}`);
      console.log(`  ReadyState: ${audioTrack.readyState}`);
      console.log(`  Muted: ${audioTrack.muted}`);
      console.log(`  Label: ${audioTrack.label}`);
    } else {
      console.error(`  ❌ No microphone stream`);
    }
    
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
  
  // Exponer funciones de debug globalmente
  window.debugAudio = () => app.debugAudioState();
  window.testAudio = () => app.testAudioOutput();
  window.diagnoseWebRTC = () => app.diagnoseWebRTC();
  
  console.log("💡 Available Commands:");
  console.log("  - debugAudio() → Check audio state");
  console.log("  - testAudio() → Generate test tone (440Hz)");
  console.log("  - diagnoseWebRTC() → Comprehensive WebRTC diagnosis");
});
