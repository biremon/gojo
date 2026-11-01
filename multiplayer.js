/*
 * ======================================================================================
 * HỆ THỐNG MULTIPLAYER CHUYÊN NGHIỆP CHO JUJUTSU KAISEN:
 * 1. ⚔️ SOLO 1v1 PvP: PLAYER VS PLAYER (Đấu đối kháng 2 người chơi qua mạng)
 * 2. 🤝 CO-OP RAID BOSS: 2 NGƯỜI SĂN SIÊU BOSS (Hội đồng Calamity Boss tàn bạo)
 * ======================================================================================
 */

window.IS_PVP_MODE = false;
window.IS_COOP_MODE = false;

// Socket Singleton chia sẻ cho cả 2 chế độ
const SharedSocket = {
    socket: null,
    connected: false,

    getSocket() {
        if (typeof io === 'undefined') {
            console.warn('[SharedSocket] Thư viện Socket.io chưa được tải.');
            return null;
        }
        if (!this.socket) {
            this.socket = io();
            this.socket.on('connect', () => {
                console.log('[SharedSocket] Đã kết nối Socket.io! ID:', this.socket.id);
                this.connected = true;
            });
            this.socket.on('connect_error', (err) => {
                console.error('[SharedSocket] Lỗi kết nối:', err);
                this.connected = false;
            });
        }
        return this.socket;
    }
};

// ======================================================================================
// 1. CHẾ ĐỘ SOLO 1v1 PvP (PLAYER VS PLAYER)
// ======================================================================================
const PvPNet = {
    roomCode: null,
    role: null, // 'p1' hoặc 'p2'
    myCharType: 'GOJO',
    opponentCharType: 'SUKUNA',
    opponent: null,
    syncTimer: 0,

    get socket() {
        return SharedSocket.getSocket();
    },
    get connected() {
        return SharedSocket.connected;
    },

    init() {
        const s = this.socket;
        if (!s) return false;

        // Xóa listener cũ tránh trùng lặp
        s.off('pvp_match_start');
        s.off('opponent_sync');
        s.off('opponent_action');
        s.off('take_hit');
        s.off('clash_push_update');
        s.off('opponent_wants_rematch');
        s.off('opponent_disconnected');

        // 1. Nhận tín hiệu vào trận 1v1
        s.on('pvp_match_start', (data) => {
            console.log('[PvPNet] Bắt đầu trận 1v1!', data);
            PvPUI.updateStatus('⚡ Đã tìm thấy đối thủ! Vào trận đấu...');

            const myInfo = data.players.find(p => p.id === s.id);
            const oppInfo = data.players.find(p => p.id !== s.id);
            if (!myInfo || !oppInfo) return;

            this.role = myInfo.role;
            this.myCharType = myInfo.charType;
            this.opponentCharType = oppInfo.charType;

            setTimeout(() => {
                PvPUI.closeModal();
                startPvPMatch(myInfo, oppInfo);
            }, 400);
        });

        // 2. Đồng bộ vị trí & máu đối thủ
        s.on('opponent_sync', (data) => {
            if (!this.opponent || !window.IS_PVP_MODE) return;
            this.opponent.targetX = data.x;
            this.opponent.targetY = data.y;
            this.opponent.targetAngle = data.angle;
            this.opponent.vx = data.vx || 0;
            this.opponent.vy = data.vy || 0;
            this.opponent.health = data.health;
            this.opponent.maxHealth = data.maxHealth || this.opponent.maxHealth;
            this.opponent.mana = data.mana;
            this.opponent.buffActive = data.buffActive;
            this.opponent.skillFActive = data.skillFActive;
            this.opponent.rctTimer = data.rctTimer;
            this.opponent.invuln = data.invuln;
            this.opponent.chargingKey = data.chargingKey;
            this.opponent.chargeRatio = data.chargeRatio || 0;
            this.opponent.domainActive = data.domainActive;
        });

        // 3. Đối thủ hành động (chiêu / đánh)
        s.on('opponent_action', (data) => {
            if (!this.opponent || !window.IS_PVP_MODE) return;
            this.handleOpponentAction(data);
        });

        // 4. Nhận sát thương khi bị đối thủ đánh trúng
        s.on('take_hit', (data) => {
            if (!window.IS_PVP_MODE || !player || player.health <= 0) return;
            player.health = Math.max(0, player.health - data.damage);
            if (data.kbAngle !== undefined && data.kbForce) {
                player.vx += Math.cos(data.kbAngle) * data.kbForce;
                player.vy += Math.sin(data.kbAngle) * data.kbForce;
            }
            if (window.JJKAudio) JJKAudio.sfx('player_hurt');
            if (window.Entities && Entities.damageTexts) {
                Entities.damageTexts.push({
                    x: player.x,
                    y: player.y - 70,
                    val: `💥 -${Math.floor(data.damage)}`,
                    life: 45,
                    vy: -1.8,
                    color: '#ff4757'
                });
            }

            if (player.health <= 0) {
                Game.endGame('DEFEAT! BẠN ĐÃ BỊ ĐỐI THỦ HẠ GỤC!', '#ff4757');
                if (s) s.emit('match_end', { winner: this.role === 'p1' ? 'p2' : 'p1' });
            }
        });

        // 5. Đấu Lãnh Địa 1v1
        s.on('clash_push_update', (data) => {
            if (!window.IS_PVP_MODE || !State.isDomainClash) return;
            State.clashGauge = Math.max(0, State.clashGauge - data.power);
            State.clashFaultPulse = 14;
            State.screenShake = Math.max(State.screenShake, 14);
            if (window.JJKAudio) JJKAudio.sfx('domain_clash_hit');

            if (State.clashGauge <= 3) {
                Game.shatterPlayerDomain();
            }
        });

        // 6. Tái đấu
        s.on('opponent_wants_rematch', () => {
            let sub = document.getElementById('end-modal-sub');
            if (sub) sub.innerText = "🔥 ĐỐI THỦ ĐANG CHỜ BẠN BẤM TÁI ĐẤU!";
        });

        // 7. Thoát trận
        s.on('opponent_disconnected', () => {
            let t = document.getElementById('center-text');
            if (t) {
                t.innerText = "⚠️ ĐỐI THỦ ĐÃ RỜI PHÒNG CHIẾN ĐẤU!";
                t.style.opacity = 1;
                t.style.color = '#ffa502';
            }
        });

        return true;
    },

    sendPlayerSync() {
        const s = this.socket;
        if (!s || !window.IS_PVP_MODE || !player) return;
        this.syncTimer++;
        if (this.syncTimer % 2 !== 0) return;

        s.emit('player_sync', {
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            angle: getAngle(player.x, player.y, Mouse.worldX, Mouse.worldY),
            health: player.health,
            maxHealth: player.maxHealth,
            mana: player.mana,
            maxMana: player.maxMana,
            buffActive: player.buffActive,
            skillFActive: player.skillFActive,
            rctTimer: player.rctTimer,
            invuln: player.invuln,
            chargingKey: player.chargingKey,
            chargeRatio: player.chargingKey ? clamp(player.chargeFrames / player.maxChargeFrames, 0, 1) : 0,
            domainActive: player.domainActive
        });
    },

    sendPlayerSkill(key, chargeMult, angle, x, y) {
        const s = this.socket;
        if (!s || !window.IS_PVP_MODE) return;
        s.emit('player_action', { type: 'skill', key, chargeMult, angle, x, y });
    },

    sendPlayerMelee(step, angle, x, y) {
        const s = this.socket;
        if (!s || !window.IS_PVP_MODE) return;
        s.emit('player_action', { type: 'melee', step, angle, x, y });
    },

    sendClashPush(power) {
        const s = this.socket;
        if (!s || !window.IS_PVP_MODE) return;
        s.emit('clash_push', { power });
    },

    requestRematch() {
        const s = this.socket;
        if (!s) return;
        s.emit('rematch_request');
        let sub = document.getElementById('end-modal-sub');
        if (sub) sub.innerText = "⏳ Đã gửi yêu cầu tái đấu! Đang đợi đối thủ xác nhận...";
    },

    handleOpponentAction(action) {
        const opp = this.opponent;
        if (!opp) return;

        if (action.type === 'melee') {
            opp.x = action.x;
            opp.y = action.y;
            opp.angle = action.angle;
            if (window.JJKAudio) JJKAudio.sfx('melee_swing');
            Entities.meleeArcs.push(new MeleeArc(opp.x, opp.y, action.angle, 160, opp.color, '#ffffff', 1, true));

            let dist = getDist(opp.x, opp.y, player.x, player.y);
            if (dist < 185 && !(player.charType === 'GOJO' && player.skillFActive)) {
                player.takeDamage(130);
                let kbAngle = getAngle(opp.x, opp.y, player.x, player.y);
                player.vx += Math.cos(kbAngle) * 22;
                player.vy += Math.sin(kbAngle) * 22;
                if (window.JJKAudio) JJKAudio.sfx('melee_hit');
            }
            return;
        }

        if (action.type === 'skill') {
            opp.x = action.x;
            opp.y = action.y;
            let ang = action.angle;
            let vx = Math.cos(ang);
            let vy = Math.sin(ang);
            let mult = action.chargeMult || 1.0;
            let key = action.key;

            if (opp.charType === 'GOJO') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('blue_orb');
                    Entities.blues.push(new BlueSingularity(opp.x + vx * 250, opp.y + vy * 250, 'boss', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('red_beam'); JJKAudio.voice('red_beam'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 58, vy * 58, 'red_beam', ang, 'boss', mult));
                } else if (key === 'C') {
                    if (window.JJKAudio) JJKAudio.sfx('teleport');
                    Entities.shockwaves.push(new Shockwave(opp.x, opp.y, '#00a8ff', 200));
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(opp.x, opp.y, '#00f3ff', 280));
                } else if (key === 'F') {
                    opp.skillFActive = true;
                    setTimeout(() => { if (opp) opp.skillFActive = false; }, 4000);
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('gojo_awaken'); }
                    opp.buffActive = true;
                    setTimeout(() => { if (opp) opp.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('hollow_purple'); JJKAudio.voice('hollow_purple'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 16, vy * 16, 'purple', ang, 'boss', mult * 1.5));
                } else if (key === 'B') {
                    this.triggerOpponentDomain();
                }
            } else if (opp.charType === 'SUKUNA') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('dismantle');
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 34, vy * 34, 'dismantle', ang, 'boss', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('fire_arrow'); JJKAudio.voice('fire_arrow'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 28, vy * 28, 'fire_arrow', ang, 'boss', mult));
                } else if (key === 'C') {
                    if (window.JJKAudio) { JJKAudio.sfx('cleave'); JJKAudio.voice('cleave'); }
                    Entities.shockwaves.push(new Shockwave(opp.x, opp.y, '#ff4757', 260));
                    if (getDist(player.x, player.y, opp.x, opp.y) < 260 && !(player.charType === 'GOJO' && player.skillFActive)) {
                        player.takeDamage(240 * mult);
                        player.vx += vx * 20;
                        player.vy += vy * 20;
                    }
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(opp.x, opp.y, '#ff0033', 300));
                } else if (key === 'F') {
                    if (window.JJKAudio) JJKAudio.sfx('domain_sukuna');
                    Entities.shrines.push(new MiniShrine(player.x, player.y, 'boss', mult, 'shrine'));
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('sukuna_chant'); }
                    opp.buffActive = true;
                    setTimeout(() => { if (opp) opp.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('world_slash'); JJKAudio.voice('world_slash'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 26, vy * 26, 'world_slash', ang, 'boss', mult * 1.5));
                } else if (key === 'B') {
                    this.triggerOpponentDomain();
                }
            } else if (opp.charType === 'YUTA') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('katana_slash');
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 32, vy * 32, 'katana_slash', ang, 'boss', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('cursed_speech'); JJKAudio.voice('cursed_speech'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 25, vy * 25, 'cursed_speech', ang, 'boss', mult));
                } else if (key === 'C') {
                    Entities.shrines.push(new MiniShrine(player.x, player.y, 'boss', mult, 'sky_breaker'));
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(opp.x, opp.y, '#ffeaa7', 300));
                } else if (key === 'F') {
                    opp.skillFActive = true;
                    setTimeout(() => { if (opp) opp.skillFActive = false; }, 4000);
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('rika_call'); }
                    opp.buffActive = true;
                    setTimeout(() => { if (opp) opp.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('love_beam'); JJKAudio.voice('love_beam'); }
                    Entities.projectiles.push(new Projectile(opp.x, opp.y, vx * 50, vy * 50, 'love_beam', ang, 'boss', mult * 1.4));
                } else if (key === 'B') {
                    this.triggerOpponentDomain();
                }
            }
        }
    },

    triggerOpponentDomain() {
        const opp = this.opponent;
        if (!opp || opp.domainActive) return;

        opp.domainActive = true;
        opp.domainRadius = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_RADIUS : 1600);
        opp.domainTimer = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_DURATION : 900);

        if (player.domainActive) {
            let midX = clamp((player.x + opp.x) * 0.5, opp.domainRadius + 80, CONSTANTS.WORLD_SIZE - opp.domainRadius - 80);
            let midY = clamp((player.y + opp.y) * 0.5, opp.domainRadius + 80, CONSTANTS.WORLD_SIZE - opp.domainRadius - 80);
            opp.domainCenter = { x: midX, y: midY };
            player.domainCenter = { x: midX, y: midY };
            player.domainTimer = Math.max(player.domainTimer, CONSTANTS.DOMAIN_DURATION);
            State.clashGauge = 50;
            State.isDomainClash = true;
            document.getElementById('domain-clash-ui').style.display = 'block';
        } else {
            opp.domainCenter = {
                x: clamp(opp.x, opp.domainRadius + 80, CONSTANTS.WORLD_SIZE - opp.domainRadius - 80),
                y: clamp(opp.y, opp.domainRadius + 80, CONSTANTS.WORLD_SIZE - opp.domainRadius - 80)
            };
        }

        pullEveryoneIntoDomain(opp.domainCenter.x, opp.domainCenter.y, opp.domainRadius);

        let dKey = opp.charType === 'GOJO' ? 'domain_gojo' : (opp.charType === 'SUKUNA' ? 'domain_sukuna' : 'domain_yuta');
        if (window.JJKAudio) {
            JJKAudio.sfx(dKey);
            JJKAudio.voice(dKey);
        }
    }
};

// ======================================================================================
// 2. CHẾ ĐỘ CO-OP RAID BOSS (2 NGƯỜI SĂN SIÊU BOSS)
// ======================================================================================
const CoopNet = {
    roomCode: null,
    role: null, // 'p1' (Host quản lý boss) hoặc 'p2' (Khách)
    myCharType: 'GOJO',
    teammateCharType: 'YUTA',
    bossCharType: 'SUKUNA',
    teammate: null,
    syncTimer: 0,

    get socket() {
        return SharedSocket.getSocket();
    },
    get connected() {
        return SharedSocket.connected;
    },

    init() {
        const s = this.socket;
        if (!s) return false;

        s.off('coop_match_start');
        s.off('teammate_sync');
        s.off('teammate_action');
        s.off('boss_update');
        s.off('boss_cast_action');
        s.off('apply_boss_damage');
        s.off('teammate_clash_push');
        s.off('teammate_revived');
        s.off('teammate_wants_rematch');
        s.off('teammate_disconnected');

        // 1. Nhận tín hiệu vào trận săn boss
        s.on('coop_match_start', (data) => {
            console.log('[CoopNet] Bắt đầu săn boss Co-op!', data);
            CoopUI.updateStatus('⚡ Đã tìm thấy đồng đội! Trận đấu bắt đầu...');

            const myInfo = data.players.find(p => p.id === s.id);
            const teamInfo = data.players.find(p => p.id !== s.id);
            if (!myInfo || !teamInfo) return;

            this.role = myInfo.role;
            this.myCharType = myInfo.charType;
            this.teammateCharType = teamInfo.charType;
            this.bossCharType = data.bossType;

            setTimeout(() => {
                CoopUI.closeModal();
                startCoopRaidMatch(myInfo, teamInfo, data.bossType, data.bossSpawn);
            }, 500);
        });

        // 2. Đồng bộ vị trí đồng đội
        s.on('teammate_sync', (data) => {
            if (!this.teammate || !window.IS_COOP_MODE) return;
            this.teammate.targetX = data.x;
            this.teammate.targetY = data.y;
            this.teammate.targetAngle = data.angle;
            this.teammate.health = data.health;
            this.teammate.maxHealth = data.maxHealth || this.teammate.maxHealth;
            this.teammate.mana = data.mana;
            this.teammate.buffActive = data.buffActive;
            this.teammate.skillFActive = data.skillFActive;
            this.teammate.rctTimer = data.rctTimer;
            this.teammate.invuln = data.invuln;
            this.teammate.chargingKey = data.chargingKey;
            this.teammate.chargeRatio = data.chargeRatio || 0;
            this.teammate.domainActive = data.domainActive;
            this.teammate.isDowned = data.isDowned || false;
        });

        // 3. Đồng đội tung chiêu / đánh
        s.on('teammate_action', (data) => {
            if (!this.teammate || !window.IS_COOP_MODE) return;
            this.handleTeammateAction(data);
        });

        // 4. P2 nhận đồng bộ Boss từ P1
        s.on('boss_update', (data) => {
            if (this.role !== 'p2' || !boss || !window.IS_COOP_MODE) return;
            boss.targetX = data.x;
            boss.targetY = data.y;
            boss.targetAngle = data.angle;
            boss.health = data.health;
            boss.maxHealth = data.maxHealth || boss.maxHealth;
            boss.isPhase2 = data.isPhase2;
            boss.domainActive = data.domainActive;
            boss.domainTimer = data.domainTimer;
            boss.stunTimer = data.stunTimer;
            boss.rctTimer = data.rctTimer;
        });

        // 5. Boss tung chiêu (P2 nhận hiệu ứng)
        s.on('boss_cast_action', (data) => {
            if (this.role !== 'p2' || !boss || !window.IS_COOP_MODE) return;
            boss.executeSkillVisual(data.key, data.mult, data.angle, data.x, data.y);
        });

        // 6. Nhận sát thương P2 bắn trúng Boss
        s.on('apply_boss_damage', (data) => {
            if (this.role === 'p1' && boss && window.IS_COOP_MODE) {
                boss.takeDamage(data.damage, true);
            }
        });

        // 7. Đồng đội cùng đẩy thanh giằng co Lãnh Địa
        s.on('teammate_clash_push', (data) => {
            if (!State.isDomainClash || !window.IS_COOP_MODE) return;
            State.clashGauge = clamp(State.clashGauge + data.power, 0, 100);
            State.clashFaultPulse = 14;
            State.screenShake = Math.max(State.screenShake, 14);
            if (window.JJKAudio) JJKAudio.sfx('domain_clash_hit');
            if (State.clashGauge >= 97) Game.shatterBossDomain();
        });

        // 8. Đồng đội hồi sinh bạn
        s.on('teammate_revived', () => {
            if (!player || !window.IS_COOP_MODE) return;
            player.isDowned = false;
            player.health = player.maxHealth * 0.6;
            player.invuln = 120;
            if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
            Entities.shockwaves.push(new Shockwave(player.x, player.y, '#00f3ff', 420));
            let centerText = document.getElementById('center-text');
            if (centerText) {
                centerText.innerText = "✨ ĐỒNG ĐỘI ĐÃ HỒI SINH BẠN!";
                centerText.style.opacity = 1;
                centerText.style.color = '#00f3ff';
                setTimeout(() => { if (centerText && State.gameRunning) centerText.style.opacity = 0; }, 2000);
            }
        });

        // 9. Tái đấu
        s.on('teammate_wants_rematch', () => {
            let sub = document.getElementById('end-modal-sub');
            if (sub) sub.innerText = "🔥 ĐỒNG ĐỘI ĐANG CHỜ BẠN BẤM TÁI ĐẤU!";
        });

        // 10. Thoát phòng
        s.on('teammate_disconnected', () => {
            let t = document.getElementById('center-text');
            if (t) {
                t.innerText = "⚠️ ĐỒNG ĐỘI ĐÃ RỜI PHÒNG CHIẾN ĐẤU!";
                t.style.opacity = 1;
                t.style.color = '#ffa502';
            }
        });

        return true;
    },

    sendPlayerSync() {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE || !player) return;
        this.syncTimer++;
        if (this.syncTimer % 2 !== 0) return;

        s.emit('player_sync', {
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            angle: getAngle(player.x, player.y, Mouse.worldX, Mouse.worldY),
            health: player.health,
            maxHealth: player.maxHealth,
            mana: player.mana,
            maxMana: player.maxMana,
            buffActive: player.buffActive,
            skillFActive: player.skillFActive,
            rctTimer: player.rctTimer,
            invuln: player.invuln,
            chargingKey: player.chargingKey,
            chargeRatio: player.chargingKey ? clamp(player.chargeFrames / player.maxChargeFrames, 0, 1) : 0,
            domainActive: player.domainActive,
            isDowned: player.isDowned || false
        });
    },

    sendPlayerSkill(key, chargeMult, angle, x, y) {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE) return;
        s.emit('player_action', { type: 'skill', key, chargeMult, angle, x, y });
    },

    sendPlayerMelee(step, angle, x, y) {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE) return;
        s.emit('player_action', { type: 'melee', step, angle, x, y });
    },

    sendDamageToBoss(dmg) {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE) return;
        if (this.role === 'p2') s.emit('damage_boss', { damage: dmg });
    },

    sendCoopClashPush(power) {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE) return;
        s.emit('coop_clash_push', { power });
    },

    reviveTeammate() {
        const s = this.socket;
        if (!s || !window.IS_COOP_MODE) return;
        s.emit('revive_teammate');
    },

    requestRematch() {
        const s = this.socket;
        if (!s) return;
        s.emit('rematch_request');
        let sub = document.getElementById('end-modal-sub');
        if (sub) sub.innerText = "⏳ Đã gửi yêu cầu tái đấu! Đang đợi đồng đội xác nhận...";
    },

    handleTeammateAction(action) {
        const team = this.teammate;
        if (!team) return;

        if (action.type === 'melee') {
            team.x = action.x;
            team.y = action.y;
            team.angle = action.angle;
            if (window.JJKAudio) JJKAudio.sfx('melee_swing');
            Entities.meleeArcs.push(new MeleeArc(team.x, team.y, action.angle, 160, team.color, '#ffffff', 1, true));
            return;
        }

        if (action.type === 'skill') {
            team.x = action.x;
            team.y = action.y;
            let ang = action.angle;
            let vx = Math.cos(ang);
            let vy = Math.sin(ang);
            let mult = action.chargeMult || 1.0;
            let key = action.key;

            if (team.charType === 'GOJO') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('blue_orb');
                    Entities.blues.push(new BlueSingularity(team.x + vx * 250, team.y + vy * 250, 'player', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('red_beam'); JJKAudio.voice('red_beam'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 58, vy * 58, 'red_beam', ang, 'player', mult));
                } else if (key === 'C') {
                    if (window.JJKAudio) JJKAudio.sfx('teleport');
                    Entities.shockwaves.push(new Shockwave(team.x, team.y, '#00a8ff', 200));
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(team.x, team.y, '#00f3ff', 280));
                } else if (key === 'F') {
                    team.skillFActive = true;
                    setTimeout(() => { if (team) team.skillFActive = false; }, 4000);
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('gojo_awaken'); }
                    team.buffActive = true;
                    setTimeout(() => { if (team) team.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('hollow_purple'); JJKAudio.voice('hollow_purple'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 16, vy * 16, 'purple', ang, 'player', mult * 1.5));
                }
            } else if (team.charType === 'SUKUNA') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('dismantle');
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 34, vy * 34, 'dismantle', ang, 'player', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('fire_arrow'); JJKAudio.voice('fire_arrow'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 28, vy * 28, 'fire_arrow', ang, 'player', mult));
                } else if (key === 'C') {
                    if (window.JJKAudio) { JJKAudio.sfx('cleave'); JJKAudio.voice('cleave'); }
                    Entities.shockwaves.push(new Shockwave(team.x, team.y, '#ff4757', 260));
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(team.x, team.y, '#ff0033', 300));
                } else if (key === 'F') {
                    if (window.JJKAudio) JJKAudio.sfx('domain_sukuna');
                    Entities.shrines.push(new MiniShrine(team.x + vx * 200, team.y + vy * 200, 'player', mult, 'shrine'));
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('sukuna_chant'); }
                    team.buffActive = true;
                    setTimeout(() => { if (team) team.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('world_slash'); JJKAudio.voice('world_slash'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 26, vy * 26, 'world_slash', ang, 'player', mult * 1.5));
                }
            } else if (team.charType === 'YUTA') {
                if (key === 'Z') {
                    if (window.JJKAudio) JJKAudio.sfx('katana_slash');
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 32, vy * 32, 'katana_slash', ang, 'player', mult));
                } else if (key === 'X') {
                    if (window.JJKAudio) { JJKAudio.sfx('cursed_speech'); JJKAudio.voice('cursed_speech'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 25, vy * 25, 'cursed_speech', ang, 'player', mult));
                } else if (key === 'C') {
                    Entities.shrines.push(new MiniShrine(team.x + vx * 200, team.y + vy * 200, 'player', mult, 'sky_breaker'));
                } else if (key === 'E') {
                    if (window.JJKAudio) { JJKAudio.sfx('rct_heal'); JJKAudio.voice('rct_heal'); }
                    Entities.shockwaves.push(new Shockwave(team.x, team.y, '#ffeaa7', 300));
                } else if (key === 'F') {
                    team.skillFActive = true;
                    setTimeout(() => { if (team) team.skillFActive = false; }, 4000);
                } else if (key === 'R') {
                    if (window.JJKAudio) { JJKAudio.sfx('awaken_buff'); JJKAudio.voice('rika_call'); }
                    team.buffActive = true;
                    setTimeout(() => { if (team) team.buffActive = false; }, 6000);
                } else if (key === 'V') {
                    if (window.JJKAudio) { JJKAudio.sfx('love_beam'); JJKAudio.voice('love_beam'); }
                    Entities.projectiles.push(new Projectile(team.x, team.y, vx * 50, vy * 50, 'love_beam', ang, 'player', mult * 1.4));
                }
            }
        }
    }
};

// ======================================================================================
// LỚP ĐỐI THỦ NGƯỜI THẬT (OPPONENT TRONG SOLO 1v1 PvP)
// ======================================================================================
class OpponentPlayer {
    constructor(charType, spawnX, spawnY) {
        this.charType = charType;
        this.x = spawnX;
        this.y = spawnY;
        this.targetX = spawnX;
        this.targetY = spawnY;
        this.vx = 0;
        this.vy = 0;
        this.angle = 0;
        this.targetAngle = 0;
        this.size = 46;
        this.color = charType === 'GOJO' ? '#0984e3' : (charType === 'SUKUNA' ? '#d63031' : '#e84393');
        this.maxHealth = 52000; // SIÊU TRÂU X10 MÁU TRONG CHẾ ĐỘ 1v1 PvP (52,000 HP)
        this.health = this.maxHealth;
        this.maxMana = 1200;
        this.mana = this.maxMana;

        this.domainActive = false;
        this.domainRadius = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_RADIUS : 1600);
        this.domainCenter = { x: spawnX, y: spawnY };
        this.domainTimer = 0;
        this.domainBurnoutTimer = 0;

        this.buffActive = false;
        this.skillFActive = false;
        this.rctTimer = 0;
        this.invuln = 0;
        this.stunTimer = 0;
        this.rushDisableTimer = 0;
        this.rushCooldown = 0;
        this.isPhase2 = false;
        this.chargingKey = null;
        this.chargeRatio = 0;
    }

    takeDamage(amt, bypassParry = false) {
        if (this.invuln > 0) return;
        if (this.charType === 'GOJO' && this.skillFActive) {
            Entities.damageTexts.push({ x: this.x, y: this.y - 65, val: "♾️ VÔ HẠN ĐỐI THỦ CHẶN!", life: 32, vy: -1.6, color: '#00f3ff' });
            return;
        }

        this.health = Math.max(0, this.health - amt);
        Entities.damageTexts.push({
            x: this.x + randomRange(-15, 15),
            y: this.y - 40,
            val: Math.floor(amt),
            life: 45,
            vy: -2,
            color: '#ffd32a'
        });

        if (PvPNet.socket) {
            let kbAngle = getAngle(player.x, player.y, this.x, this.y);
            PvPNet.socket.emit('player_hit', { damage: amt, kbAngle, kbForce: 18 });
        }

        if (this.health <= 0) {
            Game.endGame('👑 CHIẾN THẮNG! BẠN ĐÃ ĐÁNH BẠI ĐỐI THỦ!', '#00f3ff');
            if (PvPNet.socket) PvPNet.socket.emit('match_end', { winner: PvPNet.role });
        }
    }

    update() {
        this.x += (this.targetX - this.x) * 0.35;
        this.y += (this.targetY - this.y) * 0.35;
        this.angle += (this.targetAngle - this.angle) * 0.35;

        if (this.invuln > 0) this.invuln--;
        if (this.stunTimer > 0) this.stunTimer--;
        if (this.rctTimer > 0) this.rctTimer--;

        let bar = document.getElementById('boss-health-fill');
        if (bar) bar.style.width = Math.max(0, (this.health / this.maxHealth * 100)) + '%';
        let bossLabel = document.getElementById('boss-name-label') || document.getElementById('boss-char-label');
        if (bossLabel) bossLabel.innerText = `⚔️ [PVP ĐỐI THỦ] ${this.charType} HP: ${Math.floor(this.health)} / ${Math.floor(this.maxHealth)}`;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (this.buffActive || this.chargeRatio > 0.05) {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.arc(0, 0, 50 + Math.sin(State.frame * 0.2) * 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (this.skillFActive && this.charType === 'GOJO') {
            ctx.strokeStyle = 'rgba(0, 243, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, CONSTANTS.GOJO_INFINITY_RADIUS, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.rotate(this.angle);
        drawCharacterModel(ctx, this.charType, 1.15, this.invuln > 0, this.buffActive, this.skillFActive, this.rctTimer, this.chargeRatio);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = '#ff4757';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3.5;
        ctx.font = "bold 13px monospace";
        ctx.textAlign = 'center';
        let oppLabel = `⚔️ [ĐỐI THỦ] ${this.charType}`;
        ctx.strokeText(oppLabel, this.x, this.y - 48);
        ctx.fillText(oppLabel, this.x, this.y - 48);
        ctx.restore();
    }
}

// ======================================================================================
// LỚP ĐỒNG ĐỘI NGƯỜI THẬT (TEAMMATE TRONG CO-OP RAID BOSS)
// ======================================================================================
class TeammatePlayer {
    constructor(charType, spawnX, spawnY) {
        this.charType = charType;
        this.x = spawnX;
        this.y = spawnY;
        this.targetX = spawnX;
        this.targetY = spawnY;
        this.angle = 0;
        this.targetAngle = 0;
        this.size = 44;
        this.color = charType === 'GOJO' ? '#0984e3' : (charType === 'SUKUNA' ? '#d63031' : '#e84393');
        this.maxHealth = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.PLAYER_MAX_HP : 5200);
        this.health = this.maxHealth;
        this.mana = 1200;

        this.buffActive = false;
        this.skillFActive = false;
        this.rctTimer = 0;
        this.invuln = 0;
        this.isDowned = false;
        this.chargingKey = null;
        this.chargeRatio = 0;
        this.domainActive = false;
    }

    update() {
        this.x += (this.targetX - this.x) * 0.35;
        this.y += (this.targetY - this.y) * 0.35;
        this.angle += (this.targetAngle - this.angle) * 0.35;

        let bar = document.getElementById('teammate-health-fill');
        if (bar) bar.style.width = Math.max(0, (this.health / this.maxHealth * 100)) + '%';
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (this.isDowned) {
            ctx.fillStyle = '#ff4757';
            ctx.font = "bold 13px monospace";
            ctx.textAlign = 'center';
            ctx.fillText("⚠️ CẦN HỒI SINH (LẠI GẦN ẤN [E] RCT)", 0, -50);
            ctx.rotate(Math.PI / 2);
        } else {
            ctx.save();
            ctx.fillStyle = '#00f3ff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.font = "bold 13px monospace";
            ctx.textAlign = 'center';
            ctx.strokeText(`🤝 [ĐỒNG ĐỘI] ${this.charType}`, 0, -48);
            ctx.fillText(`🤝 [ĐỒNG ĐỘI] ${this.charType}`, 0, -48);
            ctx.restore();

            ctx.rotate(this.angle);
        }

        drawCharacterModel(ctx, this.charType, 1.1, this.invuln > 0, this.buffActive, this.skillFActive, this.rctTimer, this.chargeRatio);
        ctx.restore();
    }
}

// ======================================================================================
// SIÊU CẤP RAID BOSS TÀN BẠO (CỰC TRÂU • SIÊU NHANH • ĐÁNH SIÊU THỐN)
// ======================================================================================
class CalamityRaidBoss {
    constructor(bossType, spawnX, spawnY) {
        this.x = spawnX;
        this.y = spawnY;
        this.targetX = spawnX;
        this.targetY = spawnY;
        this.vx = 0;
        this.vy = 0;
        this.angle = 0;
        this.targetAngle = 0;
        this.size = 62;
        this.charType = bossType || 'SUKUNA';
        this.color = this.charType === 'GOJO' ? '#0984e3' : (this.charType === 'SUKUNA' ? '#d63031' : '#e84393');

        // Máu cực trâu cho 2 người cùng săn: 48,000 HP
        this.maxHealth = 48000;
        this.health = 48000;

        this.baseSpeed = 9.8;
        this.cooldown = 65;
        this.cooldownTimer = 60;
        this.meleeCd = 25;
        this.isPhase2 = false;

        this.domainActive = false;
        this.domainRadius = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_RADIUS : 1600);
        this.domainCenter = { x: spawnX, y: spawnY };
        this.domainTimer = 0;
        this.domainBurnoutTimer = 0;
        this.stunTimer = 0;
        this.rctTimer = 0;

        this.targetWho = 'p1';
        this.aggroSwitchTimer = 180;
    }

    activateDomain() {
        if ((this.domainBurnoutTimer || 0) > 0) return;
        if (!this.domainActive) {
            this.domainActive = true;
            this.stunTimer = 0;
            this.domainRadius = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_RADIUS : 1600);
            this.domainTimer = (typeof CONSTANTS !== 'undefined' ? CONSTANTS.DOMAIN_DURATION : 900);

            if (player && player.domainActive) {
                let midX = clamp((this.x + player.x) * 0.5, this.domainRadius + 80, CONSTANTS.WORLD_SIZE - this.domainRadius - 80);
                let midY = clamp((this.y + player.y) * 0.5, this.domainRadius + 80, CONSTANTS.WORLD_SIZE - this.domainRadius - 80);
                this.domainCenter = { x: midX, y: midY };
                player.domainCenter = { x: midX, y: midY };
                player.domainTimer = Math.max(player.domainTimer, CONSTANTS.DOMAIN_DURATION);
                State.clashGauge = 50;
                State.isDomainClash = true;
                let clashUI = document.getElementById('domain-clash-ui');
                if (clashUI) clashUI.style.display = 'block';
            } else {
                let cx = clamp((this.x * 0.65 + player.x * 0.35), this.domainRadius + 80, CONSTANTS.WORLD_SIZE - this.domainRadius - 80);
                let cy = clamp((this.y * 0.65 + player.y * 0.35), this.domainRadius + 80, CONSTANTS.WORLD_SIZE - this.domainRadius - 80);
                this.domainCenter = { x: cx, y: cy };
            }

            pullEveryoneIntoDomain(this.domainCenter.x, this.domainCenter.y, this.domainRadius);

            let dKey = this.charType === 'GOJO' ? 'domain_gojo' : (this.charType === 'SUKUNA' ? 'domain_sukuna' : 'domain_yuta');
            if (window.JJKAudio) {
                JJKAudio.sfx(dKey);
                JJKAudio.voice(dKey);
            }
        }
    }

    getNearestTarget() {
        if (!CoopNet.teammate || CoopNet.teammate.isDowned) return player;
        if (player && player.isDowned) return CoopNet.teammate;

        let d1 = getDist(this.x, this.y, player.x, player.y);
        let d2 = getDist(this.x, this.y, CoopNet.teammate.x, CoopNet.teammate.y);

        this.aggroSwitchTimer--;
        if (this.aggroSwitchTimer <= 0) {
            this.aggroSwitchTimer = 180 + Math.floor(Math.random() * 120);
            return (Math.random() > 0.5) ? player : CoopNet.teammate;
        }

        return (d1 < d2) ? player : CoopNet.teammate;
    }

    update() {
        if (CoopNet.role === 'p2') {
            this.x += (this.targetX - this.x) * 0.4;
            this.y += (this.targetY - this.y) * 0.4;
            this.angle += (this.targetAngle - this.angle) * 0.4;

            let bar = document.getElementById('boss-health-fill');
            if (bar) bar.style.width = Math.max(0, (this.health / this.maxHealth * 100)) + '%';
            return;
        }

        let currentTarget = this.getNearestTarget();
        if (!currentTarget) return;

        let dist = getDist(this.x, this.y, currentTarget.x, currentTarget.y);
        let ang = getAngle(this.x, this.y, currentTarget.x, currentTarget.y);
        this.angle = ang;

        let spd = this.baseSpeed * (this.isPhase2 ? 1.45 : 1.15);
        if (dist > 180) {
            this.x += Math.cos(ang) * spd;
            this.y += Math.sin(ang) * spd;
        } else {
            if (this.meleeCd <= 0) {
                this.meleeCd = this.isPhase2 ? 30 : 45;
                let isGojoInfinity = (currentTarget === player && player.charType === 'GOJO' && player.skillFActive);

                JJKAudio.sfx('melee_swing');
                Entities.meleeArcs.push(new MeleeArc(this.x, this.y, ang, 220, this.color, '#ffffff', 1, true));

                if (!isGojoInfinity) {
                    let lethalDmg = this.isPhase2 ? 580 : 380;
                    if (currentTarget === player) {
                        player.takeDamage(lethalDmg);
                        player.vx += Math.cos(ang) * 45;
                        player.vy += Math.sin(ang) * 45;
                    }
                    JJKAudio.sfx('melee_hit');
                    triggerImpactFrame(5, this.color, -0.15, 1.3, 35);
                }
            }
        }

        if (this.meleeCd > 0) this.meleeCd--;

        this.cooldownTimer--;
        if (this.cooldownTimer <= 0) {
            this.cooldownTimer = this.isPhase2 ? 45 : this.cooldown;
            this.castRaidSkill(currentTarget);
        }

        if (!this.domainActive && player && player.domainActive) {
            this.activateDomain();
        }

        let bar = document.getElementById('boss-health-fill');
        if (bar) bar.style.width = Math.max(0, (this.health / this.maxHealth * 100)) + '%';
        let bossLabel = document.getElementById('boss-name-label') || document.getElementById('boss-char-label');
        if (bossLabel) bossLabel.innerText = `⚔️ [PVP ĐỐI THỦ] ${this.charType} HP: ${Math.floor(this.health)} / ${Math.floor(this.maxHealth)}`;

        if (CoopNet.socket && State.frame % 2 === 0) {
            CoopNet.socket.emit('boss_sync', {
                x: this.x,
                y: this.y,
                angle: this.angle,
                health: this.health,
                maxHealth: this.maxHealth,
                isPhase2: this.isPhase2,
                domainActive: this.domainActive,
                domainTimer: this.domainTimer,
                stunTimer: this.stunTimer,
                rctTimer: this.rctTimer,
                targetWho: (currentTarget === player) ? 'p1' : 'p2'
            });
        }
    }

    castRaidSkill(target) {
        let skills = ['Z', 'X', 'C', 'V', 'F'];
        let key = skills[Math.floor(Math.random() * skills.length)];
        let ang = getAngle(this.x, this.y, target.x, target.y);
        let mult = this.isPhase2 ? 3.0 : 2.2;

        this.executeSkillVisual(key, mult, ang, this.x, this.y);

        if (CoopNet.socket) {
            CoopNet.socket.emit('boss_action', { key, mult, angle: ang, x: this.x, y: this.y });
        }
    }

    executeSkillVisual(key, mult, angle, x, y) {
        let vx = Math.cos(angle);
        let vy = Math.sin(angle);

        if (this.charType === 'SUKUNA') {
            if (key === 'Z') {
                if (window.JJKAudio) JJKAudio.sfx('dismantle');
                Entities.projectiles.push(new Projectile(x, y, vx * 40, vy * 40, 'dismantle', angle, 'boss', mult));
            } else if (key === 'X') {
                if (window.JJKAudio) { JJKAudio.sfx('fire_arrow'); JJKAudio.voice('fire_arrow'); }
                Entities.projectiles.push(new Projectile(x, y, vx * 32, vy * 32, 'fire_arrow', angle, 'boss', mult));
            } else if (key === 'C') {
                if (window.JJKAudio) { JJKAudio.sfx('cleave'); JJKAudio.voice('cleave'); }
                Entities.shockwaves.push(new Shockwave(x, y, '#ff4757', 320));
            } else if (key === 'V') {
                if (window.JJKAudio) { JJKAudio.sfx('world_slash'); JJKAudio.voice('world_slash'); }
                Entities.projectiles.push(new Projectile(x, y, vx * 30, vy * 30, 'world_slash', angle, 'boss', mult * 1.5));
            } else if (key === 'F') {
                if (window.JJKAudio) JJKAudio.sfx('domain_sukuna');
                Entities.shrines.push(new MiniShrine(player.x, player.y, 'boss', mult, 'shrine'));
            }
        } else if (this.charType === 'GOJO') {
            if (key === 'Z') {
                if (window.JJKAudio) JJKAudio.sfx('blue_orb');
                Entities.blues.push(new BlueSingularity(x + vx * 250, y + vy * 250, 'boss', mult));
            } else if (key === 'X') {
                if (window.JJKAudio) { JJKAudio.sfx('red_beam'); JJKAudio.voice('red_beam'); }
                Entities.projectiles.push(new Projectile(x, y, vx * 58, vy * 58, 'red_beam', angle, 'boss', mult));
            } else if (key === 'C') {
                if (window.JJKAudio) JJKAudio.sfx('teleport');
                Entities.shockwaves.push(new Shockwave(x, y, '#00a8ff', 240));
            } else if (key === 'V') {
                if (window.JJKAudio) { JJKAudio.sfx('hollow_purple'); JJKAudio.voice('hollow_purple'); }
                Entities.projectiles.push(new Projectile(x, y, vx * 18, vy * 18, 'purple', angle, 'boss', mult * 1.6));
            }
        }
    }

    takeDamage(amt, bypassParry = false) {
        this.health = Math.max(0, this.health - amt);

        Entities.damageTexts.push({
            x: this.x + randomRange(-25, 25),
            y: this.y - 65,
            val: Math.floor(amt),
            life: 48,
            vy: -2.2,
            color: '#ffd32a'
        });

        if (this.health <= this.maxHealth * 0.5 && !this.isPhase2) {
            this.isPhase2 = true;
            this.baseSpeed = 12.5;
            this.color = '#ff0055';
            triggerImpactFrame(10, '#ff0055', 0.25, 1.8, 60);
            if (window.JJKAudio) {
                JJKAudio.sfx('black_flash');
                JJKAudio.voice('sukuna_chant');
            }
            let centerText = document.getElementById('center-text');
            if (centerText) {
                centerText.innerText = "💀 CALAMITY RAID BOSS HÓA PHASE 2: BẠO NỘ TOÀN NĂNG!";
                centerText.style.opacity = 1;
                centerText.style.color = '#ff0055';
                setTimeout(() => { if (centerText && State.gameRunning) centerText.style.opacity = 0; }, 2600);
            }
        }

        if (this.health <= 0) {
            Game.endGame('👑 VICTORY! 2 BẠN ĐÃ TIÊU DIỆT SIÊU RAID BOSS!', '#00f3ff');
            if (CoopNet.socket) CoopNet.socket.emit('match_end', { winner: 'players' });
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        ctx.strokeStyle = this.isPhase2 ? '#ff0055' : this.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, 68 + Math.sin(State.frame * 0.15) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(this.angle);
        drawCharacterModel(ctx, this.charType, 1.45, false, this.isPhase2, false, 0, 0);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = '#ff4757';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.font = "bold 14px monospace";
        ctx.textAlign = 'center';
        let nameTag = `💀 [CALAMITY RAID BOSS] ${this.charType}`;
        ctx.strokeText(nameTag, this.x, this.y - 65);
        ctx.fillText(nameTag, this.x, this.y - 65);
        ctx.restore();
    }
}

// ======================================================================================
// KHỞI ĐỘNG CÁC TRẬN ĐẤU
// ======================================================================================

// 1. Vào trận PvP 1v1
function startPvPMatch(myInfo, oppInfo) {
    window.IS_PVP_MODE = true;
    window.IS_COOP_MODE = false;

    if (window.JJKAudio) {
        JJKAudio.ensureReady();
        JJKAudio.sfx('game_start');
    }

    document.getElementById('character-select').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('timer-display').style.display = 'none';
    document.getElementById('miniboss-health-wrapper').style.display = 'none';

    let endModal = document.getElementById('game-end-modal');
    if (endModal) endModal.style.display = 'none';
    let bossWrapper = document.getElementById('boss-health-wrapper');
    if (bossWrapper) bossWrapper.style.display = 'flex';
    let teamWrapper = document.getElementById('teammate-health-wrapper');
    if (teamWrapper) teamWrapper.style.display = 'none';
    let bossLabel = document.getElementById('boss-name-label') || document.getElementById('boss-char-label');
    if (bossLabel) bossLabel.innerText = `⚔️ [PVP ĐỐI THỦ] ${oppInfo.charType} HP`;

    State.spawnedJogo = true;
    State.spawnedMahoraga = true;
    Entities.enemies = [];
    Entities.miniBosses = [];

    initWorldObstacles();

    player = new Player(myInfo.charType);
    player.x = myInfo.spawn.x;
    player.y = myInfo.spawn.y;
    // CẢ 2 BÊN TRONG SOLO 1v1 PvP SIÊU TRÂU X10 MÁU (52,000 HP)!
    player.baseMaxHealth = 52000;
    player.maxHealth = 52000;
    player.health = 52000;

    PvPNet.opponent = new OpponentPlayer(oppInfo.charType, oppInfo.spawn.x, oppInfo.spawn.y);
    PvPNet.opponent.maxHealth = 52000;
    PvPNet.opponent.health = 52000;
    boss = PvPNet.opponent;

    State.phase = 2;
    State.gameRunning = true;

    let centerText = document.getElementById('center-text');
    if (centerText) {
        centerText.innerText = `⚔️ SOLO 1v1: ${myInfo.charType} VS ${oppInfo.charType}!`;
        centerText.style.opacity = 1;
        centerText.style.color = '#00f3ff';
        centerText.style.transform = "translate(-50%, -50%) scale(1.35)";
        setTimeout(() => { if (centerText && State.gameRunning) centerText.style.opacity = 0; }, 2400);
    }

    Game.loop();
}

// 2. Vào trận Co-op Raid Boss
function startCoopRaidMatch(myInfo, teamInfo, bossType, bossSpawn) {
    window.IS_COOP_MODE = true;
    window.IS_PVP_MODE = false;

    if (window.JJKAudio) {
        JJKAudio.ensureReady();
        JJKAudio.sfx('game_start');
    }

    document.getElementById('character-select').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('timer-display').style.display = 'none';
    document.getElementById('miniboss-health-wrapper').style.display = 'none';

    let endModal = document.getElementById('game-end-modal');
    if (endModal) endModal.style.display = 'none';
    let bossWrapper = document.getElementById('boss-health-wrapper');
    if (bossWrapper) bossWrapper.style.display = 'flex';
    let teamWrapper = document.getElementById('teammate-health-wrapper');
    if (teamWrapper) teamWrapper.style.display = 'flex';
    let bossLabel = document.getElementById('boss-name-label') || document.getElementById('boss-char-label');
    if (bossLabel) bossLabel.innerText = `💀 CALAMITY RAID BOSS: ${bossType} (48,000 HP)`;

    State.spawnedJogo = true;
    State.spawnedMahoraga = true;
    Entities.enemies = [];
    Entities.miniBosses = [];

    initWorldObstacles();

    player = new Player(myInfo.charType);
    player.x = myInfo.spawn.x;
    player.y = myInfo.spawn.y;

    CoopNet.teammate = new TeammatePlayer(teamInfo.charType, teamInfo.spawn.x, teamInfo.spawn.y);
    boss = new CalamityRaidBoss(bossType, bossSpawn.x, bossSpawn.y);

    State.phase = 2;
    State.gameRunning = true;

    let centerText = document.getElementById('center-text');
    if (centerText) {
        centerText.innerText = `🤝 CO-OP RAID BOSS BẮT ĐẦU! HÃY HỘI ĐỒNG ${bossType}!`;
        centerText.style.opacity = 1;
        centerText.style.color = '#ffd32a';
        centerText.style.transform = "translate(-50%, -50%) scale(1.3)";
        setTimeout(() => { if (centerText && State.gameRunning) centerText.style.opacity = 0; }, 2600);
    }

    Game.loop();
}

// ======================================================================================
// GIAO DIỆN PHÒNG CHỜ PvP 1v1
// ======================================================================================
const PvPUI = {
    selectedChar: 'GOJO',

    openModal() {
        const modal = document.getElementById('pvp-modal');
        if (modal) modal.style.display = 'flex';
        const coopM = document.getElementById('coop-modal');
        if (coopM) coopM.style.display = 'none';

        if (typeof io === 'undefined') {
            this.updateStatus('⚠️ CHƯA KẾT NỐI SERVER!\nBạn đang mở file trực tiếp (file://).\nVui lòng vào trình duyệt mở:\n👉 http://localhost:3000');
            return;
        }

        PvPNet.init();
    },

    closeModal() {
        const modal = document.getElementById('pvp-modal');
        if (modal) modal.style.display = 'none';
    },

    switchToCoop() {
        this.closeModal();
        CoopUI.openModal();
    },

    selectChar(charType, btnEl) {
        this.selectedChar = charType;
        document.querySelectorAll('.pvp-char-btn').forEach(btn => {
            btn.style.borderColor = '#555';
            btn.style.background = 'rgba(0,0,0,0.5)';
            btn.style.color = '#888';
        });
        if (btnEl) {
            btnEl.style.borderColor = '#00f3ff';
            btnEl.style.background = 'rgba(9, 132, 227, 0.35)';
            btnEl.style.color = '#00f3ff';
        }
    },

    updateStatus(msg) {
        let box = document.getElementById('pvp-status-box');
        let txt = document.getElementById('pvp-status-text');
        if (box && txt) {
            box.style.display = 'block';
            txt.innerText = msg;
        }
    },

    ensureConnected() {
        if (typeof io === 'undefined') {
            this.updateStatus('⚠️ Hãy mở game qua http://localhost:3000');
            return false;
        }
        PvPNet.init();
        return true;
    },

    createRoom() {
        if (!this.ensureConnected()) return;
        this.updateStatus('⏳ Đang tạo phòng Solo 1v1...');
        const s = PvPNet.socket;
        if (!s) return;
        s.emit('create_room', { charType: this.selectedChar, mode: 'pvp' }, (res) => {
            if (res && res.success) {
                PvPNet.roomCode = res.roomCode;
                PvPNet.role = res.role;
                this.updateStatus(`👑 PHÒNG ĐÃ TẠO: [ ${res.roomCode} ]\nĐang đợi người chơi thứ 2 vào phòng...`);
            } else {
                this.updateStatus('❌ Không thể tạo phòng, vui lòng thử lại!');
            }
        });
    },

    joinRoom() {
        if (!this.ensureConnected()) return;
        let input = document.getElementById('pvp-room-input');
        let code = input ? input.value.trim() : '';
        if (!code) {
            alert('Vui lòng nhập mã phòng 4 số!');
            return;
        }
        this.updateStatus(`⏳ Đang tham gia phòng ${code}...`);
        const s = PvPNet.socket;
        if (!s) return;
        s.emit('join_room', { roomCode: code, charType: this.selectedChar }, (res) => {
            if (res && res.success) {
                PvPNet.roomCode = res.roomCode;
                PvPNet.role = res.role;
                this.updateStatus(`✅ Đã vào phòng ${code}! Đang chuẩn bị vào chiến...`);
            } else {
                this.updateStatus(`❌ Lỗi: ${(res && res.message) || 'Không thể vào phòng'}`);
            }
        });
    },

    quickMatch() {
        if (!this.ensureConnected()) return;
        this.updateStatus('🔍 Đang tìm đối thủ ngẫu nhiên...');
        const s = PvPNet.socket;
        if (!s) return;
        s.emit('quick_match', { charType: this.selectedChar, mode: 'pvp' }, (res) => {
            if (res && res.success) {
                PvPNet.roomCode = res.roomCode;
                PvPNet.role = res.role;
                if (res.isWaiting) {
                    this.updateStatus(`👑 Đang chờ đối thủ tham gia (Mã phòng: ${res.roomCode})...`);
                } else {
                    this.updateStatus('⚡ Đã tìm thấy đối thủ! Đang vào trận...');
                }
            } else {
                this.updateStatus('❌ Lỗi khi tìm trận!');
            }
        });
    }
};

// ======================================================================================
// GIAO DIỆN PHÒNG CHỜ CO-OP RAID BOSS
// ======================================================================================
const CoopUI = {
    selectedChar: 'GOJO',

    openModal() {
        const modal = document.getElementById('coop-modal');
        if (modal) modal.style.display = 'flex';
        const pvpM = document.getElementById('pvp-modal');
        if (pvpM) pvpM.style.display = 'none';

        if (typeof io === 'undefined') {
            this.updateStatus('⚠️ CHƯA KẾT NỐI SERVER!\nBạn đang mở file trực tiếp (file://).\nVui lòng vào trình duyệt mở:\n👉 http://localhost:3000');
            return;
        }

        CoopNet.init();
    },

    closeModal() {
        const modal = document.getElementById('coop-modal');
        if (modal) modal.style.display = 'none';
    },

    switchToPvP() {
        this.closeModal();
        PvPUI.openModal();
    },

    selectChar(charType, btnEl) {
        this.selectedChar = charType;
        document.querySelectorAll('.coop-char-btn').forEach(btn => {
            btn.style.borderColor = '#555';
            btn.style.background = 'rgba(0,0,0,0.5)';
            btn.style.color = '#888';
        });
        if (btnEl) {
            btnEl.style.borderColor = '#ffd32a';
            btnEl.style.background = 'rgba(255, 211, 42, 0.3)';
            btnEl.style.color = '#ffd32a';
        }
    },

    updateStatus(msg) {
        let box = document.getElementById('coop-status-box');
        let txt = document.getElementById('coop-status-text');
        if (box && txt) {
            box.style.display = 'block';
            txt.innerText = msg;
        }
    },

    ensureConnected() {
        if (typeof io === 'undefined') {
            this.updateStatus('⚠️ Hãy mở game qua http://localhost:3000');
            return false;
        }
        CoopNet.init();
        return true;
    },

    createRoom() {
        if (!this.ensureConnected()) return;
        this.updateStatus('⏳ Đang tạo phòng Co-op Raid Boss...');
        const s = CoopNet.socket;
        if (!s) return;
        s.emit('create_room', { charType: this.selectedChar, mode: 'coop' }, (res) => {
            if (res && res.success) {
                CoopNet.roomCode = res.roomCode;
                CoopNet.role = res.role;
                this.updateStatus(`👑 PHÒNG CO-OP: [ ${res.roomCode} ]\nĐang đợi đồng đội vào cùng săn Boss...`);
            } else {
                this.updateStatus('❌ Không thể tạo phòng, vui lòng thử lại!');
            }
        });
    },

    joinRoom() {
        if (!this.ensureConnected()) return;
        let input = document.getElementById('coop-room-input');
        let code = input ? input.value.trim() : '';
        if (!code) {
            alert('Vui lòng nhập mã phòng 4 số!');
            return;
        }
        this.updateStatus(`⏳ Đang tham gia phòng ${code}...`);
        const s = CoopNet.socket;
        if (!s) return;
        s.emit('join_room', { roomCode: code, charType: this.selectedChar }, (res) => {
            if (res && res.success) {
                CoopNet.roomCode = res.roomCode;
                CoopNet.role = res.role;
                this.updateStatus(`✅ Đã vào phòng ${code}! Đang chuẩn bị săn Boss...`);
            } else {
                this.updateStatus(`❌ Lỗi: ${(res && res.message) || 'Không thể vào phòng'}`);
            }
        });
    },

    quickMatch() {
        if (!this.ensureConnected()) return;
        this.updateStatus('🔍 Đang tìm đồng đội săn Boss...');
        const s = CoopNet.socket;
        if (!s) return;
        s.emit('quick_match', { charType: this.selectedChar, mode: 'coop' }, (res) => {
            if (res && res.success) {
                CoopNet.roomCode = res.roomCode;
                CoopNet.role = res.role;
                if (res.isWaiting) {
                    this.updateStatus(`👑 Đang chờ đồng đội tham gia (Mã phòng: ${res.roomCode})...`);
                } else {
                    this.updateStatus('⚡ Đã tìm thấy đồng đội! Đang vào săn Boss...');
                }
            } else {
                this.updateStatus('❌ Lỗi khi tìm đồng đội!');
            }
        });
    }
};

window.PvPNet = PvPNet;
window.PvPUI = PvPUI;
window.CoopNet = CoopNet;
window.CoopUI = CoopUI;
// Giữ alias tương thích
window.Net = PvPNet;
window.NetUI = PvPUI;