const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Phục vụ file tĩnh
app.use(express.static(path.join(__dirname)));

// Quản lý phòng: Hỗ trợ cả PvP 1v1 và Co-op Raid Boss
const rooms = new Map();

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

io.on('connection', (socket) => {
    console.log(`[Socket] Kết nối mới: ${socket.id}`);

    // 1. TẠO PHÒNG (P1) - Hỗ trợ cả mode 'pvp' và 'coop'
    socket.on('create_room', ({ charType, mode }, callback) => {
        const roomCode = generateRoomCode();
        const selectedMode = mode || 'pvp';
        socket.join(roomCode);
        socket.currentRoom = roomCode;

        const roomData = {
            code: roomCode,
            mode: selectedMode, // 'pvp' hoặc 'coop'
            hostId: socket.id,
            status: 'waiting',
            players: {
                [socket.id]: {
                    id: socket.id,
                    role: 'p1',
                    charType: charType || 'GOJO',
                    rematch: false
                }
            }
        };

        rooms.set(roomCode, roomData);
        console.log(`[Room ${roomCode}] Tạo bởi P1 (${selectedMode.toUpperCase()}): ${socket.id} (${charType})`);

        if (typeof callback === 'function') {
            callback({ success: true, roomCode, role: 'p1', mode: selectedMode });
        }
    });

    // 2. VÀO PHÒNG (P2)
    socket.on('join_room', ({ roomCode, charType }, callback) => {
        const code = (roomCode || '').trim();
        const room = rooms.get(code);

        if (!room) {
            return callback && callback({ success: false, message: 'Mã phòng không tồn tại!' });
        }

        const playerIds = Object.keys(room.players);
        if (playerIds.length >= 2) {
            return callback && callback({ success: false, message: 'Phòng đã đủ 2 người!' });
        }

        socket.join(code);
        socket.currentRoom = code;

        room.players[socket.id] = {
            id: socket.id,
            role: 'p2',
            charType: charType || (room.mode === 'pvp' ? 'SUKUNA' : 'YUTA'),
            rematch: false
        };
        room.status = 'in_game';

        console.log(`[Room ${code}] P2 (${room.mode.toUpperCase()}): ${socket.id} (${charType}) đã tham gia`);

        if (typeof callback === 'function') {
            callback({ success: true, roomCode: code, role: 'p2', mode: room.mode });
        }

        const p1Id = playerIds[0];
        const p2Id = socket.id;
        const p1Char = room.players[p1Id].charType;
        const p2Char = room.players[p2Id].charType;

        if (room.mode === 'coop') {
            // KHỞI ĐỘNG CHẾ ĐỘ CO-OP RAID BOSS
            const bossType = (p1Char === 'SUKUNA' || p2Char === 'SUKUNA') ? 'GOJO' : 'SUKUNA';
            const coopStartPayload = {
                roomCode: code,
                bossType: bossType,
                bossSpawn: { x: 2500, y: 2500 },
                players: [
                    { id: p1Id, role: 'p1', charType: p1Char, spawn: { x: 2200, y: 2750 } },
                    { id: p2Id, role: 'p2', charType: p2Char, spawn: { x: 2800, y: 2750 } }
                ]
            };
            io.to(code).emit('coop_match_start', coopStartPayload);
            console.log(`[Co-op Raid] Phòng ${code} BẮT ĐẦU SĂN BOSS ${bossType}!`);
        } else {
            // KHỞI ĐỘNG CHẾ ĐỘ SOLO 1v1 PvP
            const pvpStartPayload = {
                roomCode: code,
                players: [
                    { id: p1Id, role: 'p1', charType: p1Char, spawn: { x: 2150, y: 2500 } },
                    { id: p2Id, role: 'p2', charType: p2Char, spawn: { x: 2850, y: 2500 } }
                ]
            };
            io.to(code).emit('pvp_match_start', pvpStartPayload);
            console.log(`[PvP 1v1] Trận solo phòng ${code} BẮT ĐẦU: ${p1Char} vs ${p2Char}!`);
        }
    });

    // 3. TÌM TRẬN NHANH (QUICK MATCH)
    socket.on('quick_match', ({ charType, mode }, callback) => {
        const selectedMode = mode || 'pvp';

        // Tìm phòng cùng mode đang chờ
        for (let [code, r] of rooms) {
            if (r.status === 'waiting' && r.mode === selectedMode && Object.keys(r.players).length === 1) {
                socket.join(code);
                socket.currentRoom = code;
                const p1Id = Object.keys(r.players)[0];

                r.players[socket.id] = {
                    id: socket.id,
                    role: 'p2',
                    charType: charType || (selectedMode === 'pvp' ? 'SUKUNA' : 'YUTA'),
                    rematch: false
                };
                r.status = 'in_game';

                if (typeof callback === 'function') {
                    callback({ success: true, roomCode: code, role: 'p2', mode: selectedMode });
                }

                const p1Char = r.players[p1Id].charType;
                const p2Char = r.players[socket.id].charType;

                if (selectedMode === 'coop') {
                    const bossType = (p1Char === 'SUKUNA' || p2Char === 'SUKUNA') ? 'GOJO' : 'SUKUNA';
                    io.to(code).emit('coop_match_start', {
                        roomCode: code,
                        bossType: bossType,
                        bossSpawn: { x: 2500, y: 2500 },
                        players: [
                            { id: p1Id, role: 'p1', charType: p1Char, spawn: { x: 2200, y: 2750 } },
                            { id: socket.id, role: 'p2', charType: p2Char, spawn: { x: 2800, y: 2750 } }
                        ]
                    });
                } else {
                    io.to(code).emit('pvp_match_start', {
                        roomCode: code,
                        players: [
                            { id: p1Id, role: 'p1', charType: p1Char, spawn: { x: 2150, y: 2500 } },
                            { id: socket.id, role: 'p2', charType: p2Char, spawn: { x: 2850, y: 2500 } }
                        ]
                    });
                }
                return;
            }
        }

        // Chưa có phòng -> Tạo phòng mới
        const roomCode = generateRoomCode();
        socket.join(roomCode);
        socket.currentRoom = roomCode;
        rooms.set(roomCode, {
            code: roomCode,
            mode: selectedMode,
            hostId: socket.id,
            status: 'waiting',
            players: {
                [socket.id]: { id: socket.id, role: 'p1', charType: charType || 'GOJO', rematch: false }
            }
        });

        if (typeof callback === 'function') {
            callback({ success: true, roomCode, role: 'p1', mode: selectedMode, isWaiting: true });
        }
    });

    // 4. ĐỒNG BỘ VỊ TRÍ, MÁU THỜI GIAN THỰC (Bắn cả teammate_sync và opponent_sync)
    socket.on('player_sync', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('opponent_sync', data);
        socket.to(socket.currentRoom).emit('teammate_sync', data);
    });

    // 5. ĐỒNG BỘ HÀNH ĐỘNG TUNG CHIÊU / CẬN CHIẾN
    socket.on('player_action', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('opponent_action', data);
        socket.to(socket.currentRoom).emit('teammate_action', data);
    });

    // 6. CO-OP RAID BOSS SYNC (P1 gửi trạng thái Calamity Boss cho P2)
    socket.on('boss_sync', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('boss_update', data);
    });

    socket.on('boss_action', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('boss_cast_action', data);
    });

    socket.on('damage_boss', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('apply_boss_damage', data);
    });

    socket.on('coop_clash_push', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('teammate_clash_push', data);
    });

    socket.on('revive_teammate', () => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('teammate_revived');
    });

    // 7. PvP 1v1 SÁT THƯƠNG & ĐẤU LÃNH ĐỊA
    socket.on('player_hit', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('take_hit', data);
    });

    socket.on('clash_push', (data) => {
        if (!socket.currentRoom) return;
        socket.to(socket.currentRoom).emit('clash_push_update', data);
    });

    // 8. TÁI ĐẤU (REMATCH)
    socket.on('rematch_request', () => {
        const code = socket.currentRoom;
        if (!code || !rooms.has(code)) return;
        const room = rooms.get(code);

        if (room.players[socket.id]) {
            room.players[socket.id].rematch = true;
        }

        socket.to(code).emit('opponent_wants_rematch');
        socket.to(code).emit('teammate_wants_rematch');

        // Khi cả 2 người cùng bấm tái đấu
        const pIds = Object.keys(room.players);
        if (pIds.length === 2 && room.players[pIds[0]].rematch && room.players[pIds[1]].rematch) {
            room.players[pIds[0]].rematch = false;
            room.players[pIds[1]].rematch = false;

            const p1Char = room.players[pIds[0]].charType;
            const p2Char = room.players[pIds[1]].charType;

            if (room.mode === 'coop') {
                const bossType = (p1Char === 'SUKUNA' || p2Char === 'SUKUNA') ? 'GOJO' : 'SUKUNA';
                io.to(code).emit('coop_match_start', {
                    roomCode: code,
                    bossType: bossType,
                    bossSpawn: { x: 2500, y: 2500 },
                    players: [
                        { id: pIds[0], role: 'p1', charType: p1Char, spawn: { x: 2200, y: 2750 } },
                        { id: pIds[1], role: 'p2', charType: p2Char, spawn: { x: 2800, y: 2750 } }
                    ]
                });
            } else {
                io.to(code).emit('pvp_match_start', {
                    roomCode: code,
                    players: [
                        { id: pIds[0], role: 'p1', charType: p1Char, spawn: { x: 2150, y: 2500 } },
                        { id: pIds[1], role: 'p2', charType: p2Char, spawn: { x: 2850, y: 2500 } }
                    ]
                });
            }
        }
    });

    // 9. KẾT THÚC TRẬN
    socket.on('match_end', (data) => {
        if (!socket.currentRoom) return;
        io.to(socket.currentRoom).emit('game_over', data);
    });

    // 10. NGẮT KẾT NỐI
    socket.on('disconnect', () => {
        const code = socket.currentRoom;
        if (code && rooms.has(code)) {
            const room = rooms.get(code);
            delete room.players[socket.id];
            socket.to(code).emit('opponent_disconnected', { message: 'Người chơi đối phương đã thoát phòng!' });
            socket.to(code).emit('teammate_disconnected', { message: 'Đồng đội đã thoát phòng!' });

            if (Object.keys(room.players).length === 0) {
                rooms.delete(code);
                console.log(`[Room ${code}] Đã đóng hoàn toàn.`);
            }
        }
        console.log(`[Socket] Ngắt kết nối: ${socket.id}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🔥 JUJUTSU KAISEN SERVER: HỖ TRỢ CẢ CO-OP & SOLO 1v1!`);
    console.log(`🌐 Truy cập cục bộ: http://localhost:${PORT}`);
    console.log(`====================================================`);
});