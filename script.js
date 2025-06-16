const titleElem = document.getElementById('title-display');
const messageElem = document.getElementById('message-display');
const indexElem = document.getElementById('client-index');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const webRoomsWebSocketServerAddr = 'https://nosch.uber.space/web-rooms/';

let clientId = null;
let clientCount = 0;

titleElem.innerText = '';
messageElem.innerText = '';

function resizeCanvas() {
  const width = Math.min(window.innerWidth - 40, 800);
  canvas.width = width;
  canvas.height = 500;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function start() {
  resizeCanvas();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  requestAnimationFrame(onAnimationFrame);
}

let pointerId = null;

function onPointerDown(e) {
  e.preventDefault();
  if (pointerId === null) {
    pointerId = e.pointerId;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;
    if (!touches.has(clientId)) touches.set(clientId, []);
    const color = document.getElementById('colorPicker').value;
    const size = parseInt(document.getElementById('brushSize').value, 10);
    currentLine = { points: [{ x, y }], color, size };
    touches.get(clientId).push(currentLine);
    sendRequest('*broadcast-message*', ['start', clientId, x, y, color, size]);
    canvas.setPointerCapture(pointerId);
  }
}

function onPointerMove(e) {
  if (e.pointerId === pointerId && currentLine) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;
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

const touches = new Map();
let currentLine = null;

function onAnimationFrame() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let lines of touches.values()) {
    for (let line of lines) {
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
  }
  requestAnimationFrame(onAnimationFrame);
}

document.getElementById('clearBtn').addEventListener('click', () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  touches.clear();
  sendRequest('*broadcast-message*', ['clear']);
});

// Chat-Elemente
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const messagesTextarea = document.getElementById('messages-textarea');

// Nachricht senden
function sendChatMessage() {
  const text = messageInput.value.trim();
  if (text.length > 0) {
    sendRequest('*broadcast-message*', ['chat', clientId, text]);
    // Eigene Nachricht sofort anzeigen:
    messagesTextarea.value += 'Du: ' + text + '\n';
    messagesTextarea.scrollTop = messagesTextarea.scrollHeight;
    messageInput.value = '';
  }
}

// Button & Enter-Taste
sendButton.addEventListener('click', sendChatMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

const socket = new WebSocket(webRoomsWebSocketServerAddr);

socket.addEventListener('open', (event) => {
  sendRequest('*enter-room*', 'interactive-chat');
  sendRequest('*subscribe-client-count*');
  setInterval(() => socket.send(''), 30000);
});

socket.addEventListener("close", (event) => {
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
        if (!touches.has(id)) touches.set(id, []);
        touches.get(id).push({ points: [{ x, y }], color, size });
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
        const id = incoming[1];
        break;
      }
      case 'clear': {
        touches.clear();
        break;
      }
      case 'chat': {
        const id = incoming[1];
        const text = incoming[2];
        const prefix = id === clientId ? 'Du: ' : `User ${id}: `;
        messagesTextarea.value += prefix + text + '\n';
        messagesTextarea.scrollTop = messagesTextarea.scrollHeight;
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

function sendRequest(...message) {
  const str = JSON.stringify(message);
  socket.send(str);
}