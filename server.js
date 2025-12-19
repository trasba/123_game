const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const sessions = {};

// Helper to get sorted players
const getSortedPlayers = (roomId) => {
    if (!sessions[roomId]) return [];
    return [...sessions[roomId].players].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
};

io.on('connection', (socket) => {
    socket.on('setTimerLimit', ({ roomId, limit }) => {
        const session = sessions[roomId];
        if (session && socket.id === session.ownerId) {
            session.timeLimit = parseInt(limit) || 10;
            // Broadcast to everyone so their UI stays in sync (optional)
            io.to(roomId).emit('limitUpdated', session.timeLimit);
        }
    });

    socket.on('joinSession', ({ roomId, name, isOwner }) => {
        if (!sessions[roomId]) {
            if (!isOwner) return socket.emit('errorMsg', 'Session does not exist.');
            sessions[roomId] = { ownerId: socket.id, players: [], timerActive: false, timeLimit: 10 };
        }

        const session = sessions[roomId];
        if (isOwner) session.ownerId = socket.id;

        const existingPlayer = session.players.find(p => p.name === name);
        if (existingPlayer) {
            existingPlayer.id = socket.id;
        } else {
            session.players.push({ id: socket.id, name, choice: null, isOwner });
        }

        socket.join(roomId);
        io.to(roomId).emit('updatePlayers', getSortedPlayers(roomId));
        socket.emit('joined', { isOwner, roomId });
    });

    socket.on('startTimer', (roomId) => {
        const session = sessions[roomId];
        if (session && socket.id === session.ownerId) {
            session.timerActive = true;
            session.players.forEach(p => p.choice = null);

            // Uses the stored session.timeLimit
            io.to(roomId).emit('timerStarted', session.timeLimit);

            let timeLeft = session.timeLimit;
            const interval = setInterval(() => {
                timeLeft--;
                if (timeLeft + 1 <= 0) {
                    clearInterval(interval);
                    session.timerActive = false;
                    io.to(roomId).emit('reveal', getSortedPlayers(roomId));
                }
            }, 1000);
        }
    });

    socket.on('makeChoice', ({ roomId, choice }) => {
        const session = sessions[roomId];
        if (session?.timerActive) {
            const player = session.players.find(p => p.id === socket.id);
            if (player) player.choice = choice;
        }
    });

    socket.on('leaveSession', (roomId) => {
        socket.leave(roomId);
        if (sessions[roomId]) {
            sessions[roomId].players = sessions[roomId].players.filter(p => p.id !== socket.id);
            io.to(roomId).emit('updatePlayers', getSortedPlayers(roomId));
        }
    });

    socket.on('kickPlayer', ({ roomId, playerId }) => {
        const session = sessions[roomId];
        if (session && socket.id === session.ownerId) {
            session.players = session.players.filter(p => p.id !== playerId);
            io.to(playerId).emit('kicked');
            io.to(roomId).emit('updatePlayers', getSortedPlayers(roomId));
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in sessions) {
            const session = sessions[roomId];
            const index = session.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                session.players.splice(index, 1);
                io.to(roomId).emit('updatePlayers', getSortedPlayers(roomId));
            }
        }
    });

    socket.on('updatePlayers', (players) => {
        const list = document.getElementById('playerList');
        list.innerHTML = '<strong>Players:</strong>';

        players.forEach(p => {
            const isMe = p.id === socket.id;
            const div = document.createElement('div');
            div.className = 'player-item';

            // Apply special styling if it's the current user
            if (isMe) {
                div.style.fontWeight = 'bold';
                div.style.backgroundColor = '#e7f3ff'; // Light blue tint
                div.style.borderRadius = '5px';
            }

            div.innerHTML = `
            <span>${p.name} ${isMe ? '(You)' : ''}</span>
            <div>
                <span id="reveal-${p.id}" class="reveal-val"></span>
                ${(amIOwner && !p.isOwner) ? `<button class="kick-btn" onclick="kick('${p.id}')">Kick</button>` : ''}
            </div>
        `;
            list.appendChild(div);
        });
    });

});


server.listen(3000, () => console.log('Server running on http://localhost:3000'));