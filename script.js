// =====================
// 1. DOM-Elemente holen
// =====================
const titleElem = document.getElementById('title-display'); // Überschrift
const messageElem = document.getElementById('message-display'); // Nachrichtenanzeige
const indexElem = document.getElementById('client-index'); // Zeigt die Nummer des Teilnehmers an
const canvas = document.getElementById('canvas'); // Das Zeichenfeld
const context = canvas.getContext('2d'); // Das "Werkzeug", mit dem wir auf das Canvas zeichnen können
const clearBtn = document.getElementById('clearBtn'); // "Leeren"-Button
const colorPickerBtn = document.getElementById('colorPickerBtn');
const colorPicker = document.getElementById('colorPicker');
const colorPickerPath = document.getElementById('colorPickerPath');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const messagesTextarea = document.getElementById('messages-textarea');

// =====================
// 2. Globale Variablen
// =====================
const webRoomsWebSocketServerAddr = 'https://nosch.uber.space/web-rooms/'; // Adresse des Servers
let clientId = null; // Die eigene Teilnehmernummer
let clientCount = 0; // Wie viele Teilnehmer sind insgesamt da
let pointerId = null; // Merkt sich, ob gerade gezeichnet wird
const touches = new Map(); // Speichert alle Linien aller Teilnehmer
let currentLine = null; // Die Linie, die gerade gezeichnet wird
let clearLockedUntil = 0; // Bis wann ist der Button gesperrt?
let clearLockTimeout = null;
let clearBtnDefaultText = 'Leeren';
let clearLockCountdownInterval = null;
const chatHistory = []; // Speichert alle Chat-Nachrichten
let hasDrawnSinceClear = false; // <--- NEU

// =====================
// 3. Spiel vorbereiten
// =====================
// Anfangszustand: Überschrift und Nachricht leer machen
titleElem.innerText = '';
messageElem.innerText = '';

// Canvas-Größe anpassen
function resizeCanvas() {
  // Seitenverhältnis wie im CSS (16:10)
  const maxWidth = Math.min(window.innerWidth - 40, 800);
  const aspect = 16 / 10;
  let width = maxWidth;
  let height = Math.round(width / aspect);

  // Auf kleinen Bildschirmen: Höhe darf nicht größer als 35% der Viewport-Höhe sein
  const maxHeight = Math.round(window.innerHeight * 0.35);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * aspect);
  }

  canvas.width = width;
  canvas.height = height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// =====================
// 4. Zeichenfunktionen
// =====================
function start() {
  resizeCanvas();
  // Pointer-Events
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Touch-Events verhindern das Scrollen auf dem Handy
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  requestAnimationFrame(onAnimationFrame);
}

function onPointerDown(e) {
  e.preventDefault();
  if (pointerId === null) {
    pointerId = e.pointerId;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (!touches.has(clientId)) touches.set(clientId, []);
    const color = colorPicker.value;
    const size = parseInt(document.getElementById('brushSize').value, 10);
    const createdAt = Date.now();
    currentLine = { points: [{ x, y }], color, size, createdAt };
    touches.get(clientId).push(currentLine);
    updateClearButtonState();
    sendRequest('*broadcast-message*', ['start', clientId, x, y, color, size, createdAt]);
    // Sperre nur setzen, wenn Canvas frisch geleert wurde:
    if (!hasDrawnSinceClear && clearLockedUntil < Date.now()) {
      hasDrawnSinceClear = true;
      const lockUntil = Date.now() + 90000; // 80 Sekunden Sperrzeit
      sendRequest('*broadcast-message*', ['clear-lock', lockUntil]);
      lockClearButtonUntil(lockUntil);
    }
    canvas.setPointerCapture(pointerId);
  }
}

function onPointerMove(e) {
  if (e.pointerId === pointerId && currentLine) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    currentLine.points.push({ x, y });
    sendRequest('*broadcast-message*', ['move', clientId, x, y]);
  }
}

function onPointerUp(e) {
  if (e.pointerId === pointerId) {
    e.preventDefault();
    currentLine = null;
    sendRequest('*broadcast-message*', ['end', clientId]);
    canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }
}

function onAnimationFrame() {
  context.clearRect(0, 0, canvas.width, canvas.height);

  // Alle Linien aus allen Clients in ein Array sammeln
  let allLines = [];
  for (let lines of touches.values()) {
    for (let line of lines) {
      allLines.push(line);
    }
  }
  // Nach createdAt sortieren (älteste zuerst, neueste zuletzt)
  allLines.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // Jetzt in dieser Reihenfolge zeichnen
  for (let line of allLines) {
    if (line.points.length > 1) {
      context.save();
      context.strokeStyle = line.color || '#000';
      context.lineWidth = line.size || 3;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(line.points[0].x * canvas.width, line.points[0].y * canvas.height);
      for (let i = 1; i < line.points.length; i++) {
        context.lineTo(line.points[i].x * canvas.width, line.points[i].y * canvas.height);
      }
      context.stroke();
      context.restore();
    }
  }
  requestAnimationFrame(onAnimationFrame);
}

// =====================
// 5. Clear-Button-Logik
// =====================
function lockClearButtonUntil(timestamp) {
  clearLockedUntil = timestamp;
  updateClearButtonState();
  if (clearLockTimeout) clearTimeout(clearLockTimeout);
  const ms = timestamp - Date.now();
  if (ms > 0) {
    clearBtn.disabled = true;
    clearLockTimeout = setTimeout(() => {
      updateClearButtonState();
    }, ms);
  } else {
    updateClearButtonState();
  }
}

function updateClearButtonState() {
  let hasLines = false;
  for (const lines of touches.values()) {
    if (lines.length > 0) {
      hasLines = true;
      break;
    }
  }
  if (Date.now() < clearLockedUntil) {
    clearBtn.disabled = true;
    clearBtn.title = "Leeren ist für alle für 1 Minute nach dem ersten Strich gesperrt.";
    startClearLockCountdown();
  } else {
    clearBtn.disabled = !hasLines;
    clearBtn.title = "";
    clearBtn.textContent = clearBtnDefaultText;
    stopClearLockCountdown();
  }
}

function startClearLockCountdown() {
  stopClearLockCountdown();
  updateClearLockCountdownText();
  clearLockCountdownInterval = setInterval(updateClearLockCountdownText, 250);
}

function stopClearLockCountdown() {
  if (clearLockCountdownInterval) {
    clearInterval(clearLockCountdownInterval);
    clearLockCountdownInterval = null;
  }
}

function updateClearLockCountdownText() {
  const msLeft = clearLockedUntil - Date.now();
  if (msLeft > 0) {
    const sec = Math.ceil(msLeft / 1000);
    clearBtn.textContent = `Leeren (${sec}s)`;
  } else {
    clearBtn.textContent = clearBtnDefaultText;
    stopClearLockCountdown();
    updateClearButtonState();
  }
}

clearBtn.addEventListener('click', () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  touches.clear();
  hasDrawnSinceClear = false; 
  updateClearButtonState();
  sendRequest('*broadcast-message*', ['clear']);
});

// =====================
// 6. Chat-Funktionen
// =====================
function sendChatMessage() {
  const text = messageInput.value.trim();
  if (text.length > 0) {
    sendRequest('*broadcast-message*', ['chat', clientId, text]);
    const msg = `Du: ${text}`;
    chatHistory.push(msg);
    messagesTextarea.value += msg + '\n';
    messagesTextarea.scrollTop = messagesTextarea.scrollHeight;
    messageInput.value = '';
  }
}

sendButton.addEventListener('click', sendChatMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

// =====================
// 7. Farbwahl-Logik
// =====================
colorPickerBtn.addEventListener('click', () => {
  colorPicker.click();
});

function updateColorIcon() {
  colorPickerPath.setAttribute('fill', colorPicker.value);
}
colorPicker.addEventListener('input', updateColorIcon);
window.addEventListener('DOMContentLoaded', updateColorIcon);

// =====================
// 8. WebSocket-Verbindung
// =====================
const socket = new WebSocket(webRoomsWebSocketServerAddr);

socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'interactive-chat');
  sendRequest('*subscribe-client-count*');
  setInterval(() => socket.send(''), 30000);
});

socket.addEventListener("close", () => {
  clientId = null;
  document.body.classList.add('disconnected');
  sendRequest('*broadcast-message*', ['end', clientId]);
});

socket.addEventListener('message', (event) => {
  const data = event.data;
  if (data.length > 0) {
    const incoming = JSON.parse(data);
    const selector = incoming[0];
    switch (selector) {
      case '*client-id*':
        clientId = incoming[1] + 1;
        indexElem.innerHTML = `#${clientId}/${clientCount}`;
        start();
        sendRequest('*broadcast-message*', ['request-clear-lock']);
        sendRequest('*broadcast-message*', ['request-canvas', clientId]);
        sendRequest('*broadcast-message*', ['request-chat', clientId]);
        break;
      case '*client-count*':
        clientCount = incoming[1];
        indexElem.innerHTML = `#${clientId}/${clientCount}`;
        break;
      case 'start': {
        const id = incoming[1];
        const x = incoming[2];
        const y = incoming[3];
        const color = incoming[4] || '#000';
        const size = incoming[5] || 3;
        const createdAt = incoming[6] || Date.now();
        if (!touches.has(id)) touches.set(id, []);
        touches.get(id).push({ points: [{ x, y }], color, size, createdAt });
        updateClearButtonState();
        break;
      }
      case 'move': {
        const id = incoming[1];
        const x = incoming[2];
        const y = incoming[3];
        const lines = touches.get(id);
        if (lines && lines.length > 0) {
          lines[lines.length - 1].points.push({ x, y });
        }
        break;
      }
      case 'end': {
        break;
      }
      case 'clear': {
        touches.clear();
        hasDrawnSinceClear = false; // zurücksetzen auch bei remote-Leeren
        updateClearButtonState();
        break;
      }
      case 'chat': {
        const senderId = incoming[1];
        const text = incoming[2];
        const msg = `#${senderId}: ${text}`;
        chatHistory.push(msg);
        messagesTextarea.value += msg + '\n';
        messagesTextarea.scrollTop = messagesTextarea.scrollHeight;
        break;
      }
      case 'clear-lock': {
        const lockUntil = incoming[1];
        lockClearButtonUntil(lockUntil);
        break;
      }
      case 'request-clear-lock': {
        if (clearLockedUntil > Date.now()) {
          sendRequest('*broadcast-message*', ['clear-lock', clearLockedUntil]);
        }
        break;
      }
      case 'request-canvas': {
        const targetId = incoming[1];
        if (clientId === 1 && touches.size > 0) {
          const allLines = [];
          for (const [id, lines] of touches.entries()) {
            for (const line of lines) {
              allLines.push({ id, ...line });
            }
          }
          sendRequest('*broadcast-message*', ['canvas-data', targetId, allLines]);
        }
        break;
      }
      case 'canvas-data': {
        const targetId = incoming[1];
        const allLines = incoming[2];
        if (clientId === targetId) {
          touches.clear();
          for (const line of allLines) {
            if (!touches.has(line.id)) touches.set(line.id, []);
            touches.get(line.id).push({
              points: line.points,
              color: line.color,
              size: line.size,
              createdAt: line.createdAt || Date.now()
            });
          }
          updateClearButtonState();
        }
        break;
      }
      case 'request-chat': {
        const targetId = incoming[1];
        if (clientId === 1 && chatHistory.length > 0) {
          sendRequest('*broadcast-message*', ['chat-history', targetId, chatHistory]);
        }
        break;
      }
      case 'chat-history': {
        const targetId = incoming[1];
        const history = incoming[2];
        if (clientId === targetId) {
          messagesTextarea.value = '';
          for (const msg of history) {
            messagesTextarea.value += msg + '\n';
          }
          messagesTextarea.scrollTop = messagesTextarea.scrollHeight;
          chatHistory.length = 0;
          chatHistory.push(...history);
        }
        break;
      }
      case '*error*': {
        const message = incoming[1];
        console.warn('server error:', ...message);
        break;
      }
      default:
        break;
    }
  }
});

// =====================
// 9. Hilfsfunktionen
// =====================
function sendRequest(...message) {
  const str = JSON.stringify(message);
  socket.send(str);
}
